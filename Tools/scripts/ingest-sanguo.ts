// 《三国志通俗演义》（嘉靖壬午本）入库脚本：
//   从 cinaclassics 库文本（集藏/小说/三国志通俗演义嘉靖壬午本.md）生成素材仓库
//   books/02/text/01.txt..24.txt（24 卷，一卷一文件）与 00.txt（庸愚子序 + 修髯子引 + 总目）、
//   以及 book.cfg。
//
// 用法：npx tsx scripts/ingest-sanguo.ts [库文本路径]
//   库文本默认取 E:\cinagroup\cinaclassics\集藏\小说\三国志通俗演义嘉靖壬午本.md

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveRepoRoot } from './repo.js';

const SRC =
  process.argv[2] ?? 'E:/cinagroup/cinaclassics/集藏/小说/三国志通俗演义嘉靖壬午本.md';
const REPO = resolveRepoRoot();
const BOOK_DIR = path.join(REPO, 'books', '02');
const TEXT_DIR = path.join(BOOK_DIR, 'text');

const CRLF = '\r\n';

function para(lines: string[]): string {
  // 段落整理：去掉段首全角/半角空白与孤行空白，一行一段（引擎按行分段重排）
  return lines
    .map((l) => l.replace(/^[\s　]+/, '').replace(/\s+$/, ''))
    .filter((l) => l.length > 0)
    .join(CRLF + CRLF);
}

async function main() {
  const raw = (await readFile(SRC, 'utf8')).replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);

  // ---------- 目录区：24 个「卷之X」组，每组 10 则题 ----------
  const ZE_RE = /^卷之[一二三四五六七八九十]+$/;
  const toc: string[][] = []; // toc[k] = 第 k 卷（0 基）的 10 个则题
  let i = 0;
  while (toc.length < 24 && i < lines.length) {
    if (ZE_RE.test(lines[i].trim())) {
      const titles: string[] = [];
      let j = i + 1;
      while (titles.length < 10 && j < lines.length) {
        const t = lines[j].trim();
        if (t.length > 1) titles.push(t);
        j++;
      }
      if (titles.length !== 10) throw new Error(`目录卷 ${toc.length + 1} 则题不足 10：${titles.length}`);
      toc.push(titles);
      i = j;
    } else {
      i++;
    }
  }
  if (toc.length !== 24) throw new Error(`目录仅解析出 ${toc.length} 卷`);
  const flatTitles = toc.flat(); // 240 则，按序

  // ---------- 序/引（目录区之后、正文首则题之前） ----------
  const bodyStart = lines.findIndex((l, k) => k >= i && l.trim() === flatTitles[0]);
  if (bodyStart < 0) throw new Error('未找到正文首则题：' + flatTitles[0]);
  const prefaceLines = lines.slice(0, bodyStart);
  const seqIdx = prefaceLines.findIndex((l, k) => /^序$/.test(l.trim()) && k > 0);
  const yinIdx = prefaceLines.findIndex((l) => /^引$/.test(l.trim()));
  if (seqIdx < 0 || yinIdx < 0) throw new Error(`未找到序/引：序=${seqIdx} 引=${yinIdx}`);
  const xuParas = para(prefaceLines.slice(seqIdx + 1, yinIdx));
  const yinParas = para(prefaceLines.slice(yinIdx + 1));

  // ---------- 正文切分 ----------
  // 源文献正文则题与目录偶有出入，以目录题名为准，规则：
  //   题行 === 目录第 k 题                → 关闭当前则，开启第 k 则
  //   题行 === 目录第 k-1 题（重复上一题）→ 同上（源文献讹误，新则依目录第 k 题出之）
  //   题行 === 目录第 k+1 题（缺题）      → 第 k 题正文无题行：出空则（仅题名），
  //                                         其内容已并入前则，再开启第 k+1 则
  // 附录（三国志宗僚等）不入卷，归 999.txt（引擎版心后缀「附」）。
  const APPENDIX_HEAD = '三国志宗僚';
  const bodyLines = lines.slice(bodyStart);
  const appendixStart = bodyLines.findIndex((l) => l.trim() === APPENDIX_HEAD);
  if (appendixStart < 0) throw new Error('未找到附录起始：' + APPENDIX_HEAD);
  const scanEnd = bodyStart + appendixStart;

  // 题行匹配：完全相等，或正文题行在目录题基础上带后缀（如「姜维洮西败魏兵三犯中原」，
  // 差 ≤8 字）。不做字符重合度等宽松匹配——长段落天然包含题行用字，必然误判。
  const fuzzy = (a: string, b: string): boolean => {
    if (a === b) return true;
    return Math.abs(a.length - b.length) <= 8 && (a.startsWith(b) || b.startsWith(a));
  };

  interface Ze { title: string; paras: string[] }
  const zes: Ze[] = [];
  const fixes: string[] = [];
  let curTitle: string | null = null;
  let curParas: string[] = [];
  let k = 0;
  const closeZe = () => {
    if (curTitle !== null) zes.push({ title: curTitle, paras: curParas });
    curTitle = null;
    curParas = [];
  };
  for (let n = bodyStart; n < scanEnd; n++) {
    const line = lines[n].trim();
    if (line.length === 0) continue;
    // 命中位置：精确/模糊依序判定（k 正常、k-1 重复、更远跳进）
    let j = -1;
    if (k < flatTitles.length && fuzzy(line, flatTitles[k])) j = k;
    else if (k > 0 && k - 1 < flatTitles.length && fuzzy(line, flatTitles[k - 1])) j = k - 1;
    else {
      for (let m = k + 1; m < Math.min(k + 8, flatTitles.length); m++) {
        if (fuzzy(line, flatTitles[m])) {
          j = m;
          break;
        }
      }
    }
    if (j < 0 || (j === k - 1 && k >= flatTitles.length)) {
      curParas.push(line);
      continue;
    }
    closeZe();
    if (j === k - 1) {
      fixes.push(`正文题「${line}」重复上一则 → 新则依目录作「${flatTitles[k]}」`);
    } else if (j > k) {
      for (let m = k; m < j; m++) {
        fixes.push(`目录「${flatTitles[m]}」正文无题行 → 补空则，内容并入前则`);
        zes.push({ title: flatTitles[m], paras: [] });
      }
    } else if (line !== flatTitles[j]) {
      fixes.push(`则 ${j + 1} 正文题「${line}」→ 依目录作「${flatTitles[j]}」`);
    }
    // 重复题行（j=k-1）时新则取目录预期题 flat[k]，其余取命中题 flat[j]
    const newIdx = j === k - 1 ? k : j;
    curTitle = flatTitles[newIdx];
    curParas = [];
    k = newIdx + 1;
  }
  closeZe();
  if (k !== flatTitles.length) {
    throw new Error(`则切分不完整：${k}/${flatTitles.length}（止于「${flatTitles[k]}」，残留题行「${curParas[0] ?? ''}」）`);
  }
  if (zes.length !== flatTitles.length) throw new Error(`则数异常：${zes.length} ≠ ${flatTitles.length}`);

  // ---------- 输出 ----------
  await mkdir(TEXT_DIR, { recursive: true });

  const files: Array<[string, string]> = [];
  // 00.txt：序 + 引 + 总目
  const tocText = toc
    .map((titles, gi) => `（卷之${ZH_NUM[gi]}）` + CRLF + CRLF + titles.join(CRLF))
    .join(CRLF + CRLF);
  files.push([
    '00.txt',
    para(['（庸愚子序）']) + CRLF + CRLF + xuParas + CRLF + CRLF +
      para(['（修髯子引）']) + CRLF + CRLF + yinParas + CRLF + CRLF +
      para(['（三国志通俗演义总目）']) + CRLF + CRLF + tocText + CRLF,
  ]);
  // 01..24.txt：一卷一文件（第 gi 卷 = 则 gi*10..gi*10+9），则题加（）强调
  for (let gi = 0; gi < 24; gi++) {
    const part = zes
      .slice(gi * 10, gi * 10 + 10)
      .map((z) => `（${z.title}）` + CRLF + CRLF + para(z.paras))
      .join(CRLF + CRLF);
    files.push([`${String(gi + 1).padStart(2, '0')}.txt`, part + CRLF]);
  }
  // 999.txt：附录（版心后缀「附」）
  files.push([
    '999.txt',
    para(['（三国志宗僚）']) + CRLF + CRLF +
      para(lines.slice(bodyStart + appendixStart + 1, lines.length)) + CRLF,
  ]);

  for (const [name, content] of files) {
    await writeFile(path.join(TEXT_DIR, name), content, 'utf8');
  }

  // book.cfg：完整复制 books/01 的配置（同画布/字体/标点与标记规则），仅改书名与作者
  const tpl = await readFile(path.join(REPO, 'books', '01', 'book.cfg'), 'utf8');
  const cfg = tpl
    .replace(/^title=.*$/m, 'title=三国志通俗演义')
    .replace(/^author=.*$/m, 'author=明罗贯中');
  await writeFile(path.join(BOOK_DIR, 'book.cfg'), cfg, 'utf8');

  const zeParas = zes.reduce((a, z) => a + z.paras.length, 0);
  console.log(`完成：目录 24 卷 × 10 则，正文 ${zeParas} 段，附录 ${APPENDIX_HEAD}`);
  if (fixes.length) console.log('则题修正：\n  ' + fixes.join('\n  '));
  console.log(`输出：${TEXT_DIR}（00.txt + 01..24.txt + 999.txt）与 ${BOOK_DIR}${path.sep}book.cfg`);
  console.log(`排版调用：--book 02 --from 1 --to 26（00=序引总目，01..24=卷，999=附）`);
}

const ZH_NUM = [
  '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '二十一', '二十二', '二十三', '二十四',
];

main().catch((err) => {
  console.error('入库失败：', err);
  process.exit(1);
});
