# Cinaclassics — 古籍刻本风格直排电子书排版引擎

Cinaclassics（[中华古籍全文库](../README.md)）的古籍刻本风格排版引擎：将中文文本排版为刻本风格的直排（竖排）PDF 电子书，文字可选取、可检索，自带书签目录，支持普通版式与族谱/字典多栏版式、印章贴放、多字体回退与度量微调。排版核心为纯计算（位置网格、标点处理、批注双排、标记系统、多字体回退、度量微调、回退加粗），输出绘制指令流；渲染层用 [pdf-lib](https://github.com/Hopding/pdf-lib) + [fontkit](https://github.com/foliojs/fontkit) 生成 PDF（字体子集嵌入、底层算子实现文本填充+描边加粗、底层对象写入书签目录），可运行于 Cloudflare Workers（含本地 workerd）与 Node.js。

> **标识说明**：品牌与基础设施标识统一为 Cinaclassics —— Worker 名 `cinaclassics`、R2 桶 `cinaclassics-assets`、素材仓库环境变量 `CINACLASSICS_ASSETS`（兼容历史值 `VRAIN_REPO`）。更名前的旧 Worker `vrain` 与旧桶 `vrain-assets` 如仍在运行，可择期下线（见[部署到 Cloudflare](#部署到-cloudflare)）。

> **目录位置**：本包位于 `cinaclassics/Tools`（包体直接置于 Tools 根目录）。排版素材（字体/背景图/书籍文本，`fonts/` `canvas/` `books/` `books_mr/` `db/`）由独立的素材仓库提供：默认自本包位置逐级向上探测名为 `vRain` 的同级目录（当前为 `E:\cinagroup\vRain`）；素材仓库在别处时设置环境变量 `CINACLASSICS_ASSETS` 指向其根目录。

## 功能一览

- **直排位置网格**：自右向左、自上而下逐字落位，打满一叶自动换叶/换页
- **双版式**：主版式（`books/`）与多栏版式（`books_mr/`：族谱/字典，含 `^` 跳栏、`onlyperiod_color`、`if_tpcenter`、`if_book_vline`）
- **正文与批注**：批注小字双排、圆角框；标点替换/归一化/过滤
- **特殊标记系统**：书名波浪线、圆角方框、圆形框、圈注/点注/线注、字体缩放
- **字体策略**：多字体互补回退、度量微调保持视觉一致、回退字体描边加粗
- **印章贴放**：`books/<id>/stamps.cfg` 声明式驱动
- **输出**：自动生成 PDF 书签目录；字体子集 + 对象流压缩（Ghostscript 无法运行于 Workers，此为本版的等价压缩实现）

### 与 Perl 工具链的兼容对照

素材仓库中的 Perl 脚本与本引擎的能力对照：

| Perl 组件 | TS 对应 | 状态 |
|---|---|---|
| `vrain.pl`（主版式） | `src/engine/layout.ts` | ✓ 已移植 |
| `vrain_mr.pl`（族谱/字典多栏） | `src/engine/layout-mr.ts` | ✓ 已移植（`^`跳栏、`onlyperiod_color`、`if_tpcenter`、`if_book_vline`；`try_st` 简繁转换未内置——原版两书均关闭） |
| `addyin.pl`（印章贴放） | `src/engine/stamps.ts` + `books/<id>/stamps.cfg` | ✓ 声明式等价（省略 Image::Magick 重采样/二值化，PDF 等比缩放贴放） |
| `indentxt.pl`（S 缩进重排） | `scripts/indent.ts` | ✓ 通用核心（原版 book-01 专属 hack 未移植） |
| Ghostscript 压缩（`-c`） | 字体子集 + `useObjectStreams` | △ 等价替代（gs 无法运行于 Workers） |

## 验证状态

- `books/01`（虞初新志）：全书 29 页 = 29 页，逐页字符数一致；封面/正文印章位置与 export 版一致
- `books_mr/01`（賈府族譜）：3 页 = 3 页，逐页字符数一致（275/275、33/33）
- `books_mr/02`（說文解字）：5 页 = 5 页，视觉一致（参考 PDF 全字嵌入的 ToUnicode 对生僻字提取失真，字符数差异系提取假象）
- `books/02`（三国志通俗演义·嘉靖壬午本）：`scripts/ingest-sanguo.ts` 从库文本生成 24 卷 + 序/引/总目 + 宗僚附录，全书 914 页本地与线上生成一致
- Node 全书约 2-3s（虞初新志规模）；三国演义全书约 50s；线上单请求受 Workers CPU 30s 限制，长书按 `from`/`to` 分卷请求

## 目录结构

```
src/engine/         排版引擎（纯计算，无 I/O）
  cfg.ts            cfg 配置解析（兼容素材仓库注释/空白规则）
  text.ts           文本预处理（标点替换/归一化/段落补齐）
  layout.ts         主版式排版循环
  layout-mr.ts      多栏版式（族谱/字典）
  stamps.ts         印章贴放（stamps.cfg 驱动）
  fonts.ts          字体回退检测 + 度量微调（fontkit）
  render.ts         指令流 → PDF（pdf-lib）
  pipeline.ts       生成管线（书架选择 + 印章 + 渲染）
  assets.ts         素材加载（FsAssetSource / R2AssetSource）
  zhnum-data.ts     中文数字表（db/num2zh_jid.txt 生成）
src/index.ts        Worker 入口（路由）
scripts/
  repo.ts           素材仓库定位（环境变量优先 + 逐级向上探测，各脚本共用）
  generate-local.ts 本地 Node 生成（--mr 选择多栏书架）
  font-subset.ts    按书字体子集（--mr 支持两书架，未用字体置空；子集器为 fonteditor-core）
  ingest-sanguo.ts  三国志通俗演义（嘉靖壬午本）库文本 → books/02 排版素材
  make-sanguo-cover.ts 三国志通俗演义封面图绘制
  indent.ts         S 缩进文本重排
  r2-push.ts        素材上传 R2（--local / --remote）
  pdf2png.ts        PDF 转 PNG（视觉对照用）
```

## 本地开发

```bash
npm install
npm run local -- --book 01 --from 1 --to 2          # 主版式（books/）
npm run local -- --book 01 --mr --from 1 --to 1     # 多栏版式（books_mr/）
npm run local -- --book 01 --from 1 --to 2 --no-stamps   # 跳过印章
npm run r2:push:local                              # 素材上传本地模拟 R2
npm run dev                                        # wrangler dev → http://127.0.0.1:8787
```

API：

- `GET /` — 使用说明
- `GET /books` — 列出书籍（`books` 主版 + `mr` 多栏版）
- `GET /generate?book=01&from=1&to=2` — 生成 PDF
  - `shelf=mr`：多栏书架（books_mr/）
  - `pages=N`：测试模式（对应素材仓库工具的 `-z`）
  - `stamps=0`：跳过印章（默认存在 stamps.cfg 时自动应用）

## 部署到 Cloudflare

```bash
# 0. 认证：设置环境变量（免交互，CI 可用）
export CLOUDFLARE_API_TOKEN=...        # Windows 用户级环境变量亦可用 PowerShell 读取注入

# 1. 生成按书字体子集（关键：全量字体 92MB 会超 Workers 128MB 内存限制，error 1102）
npx tsx scripts/font-subset.ts --book 01 --from 1 --to 2        # 主版（books/01）
npx tsx scripts/font-subset.ts --book 01 --mr --from 1 --to 1   # 多栏版（books_mr/01）
npx tsx scripts/font-subset.ts --book 02 --mr --from 1 --to 1   # 多栏版（books_mr/02）
#    自动改写 .r2build 下的 book.cfg 指向子集目录（未用字体置空），并全指令对比自检

# 2. 创建 R2 桶并上传素材（r2-push 优先推送 .r2build 产物）
npx wrangler r2 bucket create cinaclassics-assets
npm run r2:push                                    # 远端，逐文件 wrangler r2 object put --remote

# 3. 部署 Worker
npm run deploy                                     # wrangler deploy
```

部署实例：<https://cinaclassics.cinagroup.workers.dev>

- `GET /books` → `{"books":["01"],"mr":["01","02"]}`
- `GET /generate?book=01&from=1&to=2` → 全书 29 页 PDF（含印章）
- `GET /generate?book=01&shelf=mr&from=1&to=1` → 族谱多栏版
- 服务端 TTFB 约 4~9s

### 已知限制与注意事项

- **内存**：直接用全量字体（92MB）会触发 Workers `error code: 1102`（128MB 超限）。务必先跑 `font-subset.ts` 生成按书子集并 `r2:push`。新增/修改书目后需重新生成。
- **印章**：`books/<id>/stamps.cfg` 存在时自动应用（`stamps=0` 跳过）；省略了 Perl 版 Image::Magick 的重采样与 11.jpg 二值化特例。
- **try_st 简繁转换**：素材仓库 Perl 版的转换依赖 Encode::HanConvert，未随引擎内置（原版两本书均关闭，原作者也标注"不建议开启"）。
- **CPU 时长**：付费版单请求 30s CPU 上限。本书规模服务端实测 4~9s；更长的书建议按卷分片（`from`/`to`）或改用 Queues/Workflows。
- **Windows 上传坑**：`execFileSync('npx', args, {shell:true})` 会丢数组参数（`--remote` 静默失效、全传进本地模拟桶），r2-push.ts 已改为手工拼接命令串。
- **提取假象说明**：参考 PDF（PDF::Builder 全字嵌入）文本提取对生僻字会输出垃圾字符（`╯` 等）或丢失，字符数对比时以视觉与位置为准；本版按源文本码点嵌入子集，提取结果与源文本一致。

## 工程沿革与许可

Cinaclassics 排版引擎的版式算法与素材格式兼容 [shanleiguang/vRain](https://github.com/shanleiguang/vRain)（Perl 工具链，MIT License，Copyright (c) 2025 shanleiguang），在其基础上以 TypeScript 独立实现并面向 Workers 运行时重构，素材仓库沿用其目录约定（素材仓库目录名 `vRain` 与历史环境变量 `VRAIN_REPO` 即源于此，现由 `CINACLASSICS_ASSETS` 取代、旧名仍兼容）。

`layout.ts` 按原版变量名移植（`pcnt` 字位指针、`pid` 页计数、`posL/posR` 左右半列坐标等），`goto RCHARS` 映射为外层循环 `continue`。原版两处语义陷阱已按原行为保留并注释：

- `if($pcnt+1 % $row_num == 0)`：`%` 优先级高于 `+`，条件恒假，`pcol` 恒为 `int(pcnt/row_num)+1`
- 批注圆角框连接补齐的条件 `'commn'`（永不等于 `'comm'`），批注框不连接

渲染差异说明：参考 PDF（PDF::Builder 全字嵌入）文本提取会显示简体字形（如 胆/书），系其 ToUnicode 映射假象；本版按源文本码点嵌入子集，提取结果与源文本一致，视觉字形相同。
