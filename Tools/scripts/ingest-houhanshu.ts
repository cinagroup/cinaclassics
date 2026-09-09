// 《后汉书》（纪传 + 志）入库脚本：
//   从 cinaclassics 库文本（史藏/正史/后汉书.md）生成素材仓库 books/05：
//   text/00.md（总目）+ 001..090.md（纪传，上下分卷合并）+ 091..120.md（志三十篇）
//   及 book.cfg。
//   结构：目录区 = 纪传百条（卷一上..卷九十）+ 志目三十条（志第一..第三十）；
//   正文标记 = 「后汉书卷X 篇名」「后汉书志第X 名」（首条无前缀）。
//   卷号匹配采用中文数值精确比较（避免 卷五十/卷五十一 前缀碰撞）；
//   源文献个别卷缺正文标记时，其内容并入前一卷文件，该卷以仅题名占位。
//
// 用法：npx tsx scripts/ingest-houhanshu.ts [库文本路径]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveRepoRoot } from './repo.js';

const SRC = process.argv[2] ?? 'E:/cinagroup/cinaclassics/史藏/正史/后汉书.md';
const REPO = resolveRepoRoot();
const BOOK_DIR = path.join(REPO, 'books', '05');
const TEXT_DIR = path.join(BOOK_DIR, 'text');

const CRLF = '\r\n';
const strip = (l: string) => l.replace(/[\s　]/g, '');
const NUMCLS = '[一二三四五六七八九十百零中上下之]';

function para(lines: string[]): string {
  return lines.map((l) => l.trim()).filter((l) => l.length > 0).join(CRLF + CRLF);
}

function cnVal(s: string): number {
  const core = s.replace(/[上下中之]+$/g, '');
  let total = 0, num = 0;
  const M: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  for (const ch of core) {
    if (M[ch]) num = M[ch];
    else if (ch === '十') total += (num || 1) * 10, num = 0;
    else if (ch === '百') total += (num || 1) * 100, num = 0;
  }
  return total + num;
}

const baseOf = (num: string) => { let n = num; while (/[上下]$/.test(n)) n = n.slice(0, -1); return n; };

async function main() {
  const raw = (await readFile(SRC, 'utf8')).replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);

  // ---------- 目录 ----------
  const tocJuans: { num: string; title: string }[] = [];
  const tocZhi: { num: string; title: string }[] = [];
  for (let n = 2; n < 132; n++) {
    const s = lines[n].trim();
    let m = s.match(new RegExp(`^卷(${NUMCLS}+) ([^ ].+)$`));
    if (m) { tocJuans.push({ num: m[1], title: m[2] }); continue; }
    m = s.match(/^志(第[一二三四五六七八九十]+) ([^ ].+)$/);
    if (m) { tocZhi.push({ num: m[1], title: m[2] }); continue; }
  }
  if (tocJuans.length !== 100) throw new Error(`纪传目录 ${tocJuans.length} ≠ 100`);
  if (tocZhi.length !== 30) throw new Error(`志目录 ${tocZhi.length} ≠ 30`);

  // ---------- 正文标记识别 ----------
  const bodyStart = lines.findIndex((l, idx) => idx >= 135 && strip(l).startsWith('卷' + tocJuans[0].num));
  if (bodyStart < 0) throw new Error('未找到正文首卷标记');
  const markers: Array<{ line: number; v: number }> = [];
  for (let n = bodyStart; n < lines.length; n++) {
    const s = strip(lines[n]);
    const m = s.match(/^(?:后汉书)?卷([一二三四五六七八九十百零中上下之]+)(?![一二三四五六七八九十百零中上下之])/);
    if (m) {
      const v = cnVal(m[1]);
      if (v >= 1 && v <= 90) markers.push({ line: n, v });
    }
  }
  const zhiMarkers: Array<{ line: number }> = [];
  {
    let jz = 0;
    for (let n = bodyStart; n < lines.length; n++) {
      const s = strip(lines[n]);
      if (jz < 30 && s.startsWith('后汉书志' + tocZhi[jz].num)) { zhiMarkers.push({ line: n }); jz++; }
    }
    if (jz !== 30) throw new Error(`志标记 ${jz} ≠ 30`);
  }
  if (markers.length < 90) throw new Error(`纪传标记仅 ${markers.length} 个`);
  if (zhiMarkers.length !== 30) throw new Error(`志标记 ${zhiMarkers.length} ≠ 30`);

  // ---------- 对齐：标记值 → 目录条目（数值精确；标记缺失的目录卷并入前一卷文件） ----------
  const segs: Array<{ tocIdx: number; title: string; start: number }> = [];
  {
    let ti = 0;
    for (const mk of markers) {
      while (ti < 100 && cnVal(baseOf(tocJuans[ti].num)) < mk.v) {
        // 该基卷正文标记缺失：跳过（其内容已并入前段），以仅题名占位
        segs.push({ tocIdx: ti, title: `（卷${tocJuans[ti].num}@${tocJuans[ti].title}）（原卷正文标记缺失）`, start: mk.line });
        ti++;
      }
      if (ti < 100 && cnVal(baseOf(tocJuans[ti].num)) === mk.v) {
        segs.push({ tocIdx: ti, title: `（卷${tocJuans[ti].num}@${tocJuans[ti].title}）`, start: mk.line });
        ti++;
      }
    }
    while (ti < 100) {
      segs.push({ tocIdx: ti, title: `（卷${tocJuans[ti].num}@${tocJuans[ti].title}）（原卷正文标记缺失）`, start: lines.length });
      ti++;
    }
  }
  const zhiSegs: Array<{ tocIdx: number; title: string; start: number }> = [];
  {
    let tj = 0;
    for (const mk of zhiMarkers) {
      while (tj < 30 && cnVal(tocZhi[tj].num.replace(/^第/, '')) < mk.v) {
        zhiSegs.push({ tocIdx: tj, title: `（志${tocZhi[tj].num}@${tocZhi[tj].title}）`, start: mk.line });
        tj++;
      }
      if (tj < 30 && cnVal(tocZhi[tj].num.replace(/^第/, '')) === mk.v) {
        zhiSegs.push({ tocIdx: tj, title: `（志${tocZhi[tj].num}@${tocZhi[tj].title}）`, start: mk.line });
        tj++;
      }
    }
    while (tj < 30) {
      zhiSegs.push({ tocIdx: tj, title: `（志${tocZhi[tj].num}@${tocZhi[tj].title}）`, start: lines.length });
      tj++;
    }
  }
  if (segs.length !== 100) throw new Error(`基卷号分组 ${segs.length} ≠ 100`);
  if (zhiSegs.length !== 30) throw new Error(`志篇分组 ${zhiSegs.length} ≠ 30`);

  // ---------- 切分正文（纪传按基卷号合并：上下分卷同文件） ----------
  const segContents = segs.map((sg, gi) => {
    const end = gi + 1 < segs.length ? segs[gi + 1].start : lines.length;
    const paras: string[] = [];
    for (let n = sg.start + 1; n < end; n++) {
      const s = strip(lines[n]);
      if (s) paras.push(s);
    }
    return { base: cnVal(baseOf(tocJuans[sg.tocIdx].num)), title: sg.title, paras };
  });
  const juanFiles: Array<{ file: string; chunks: string[] }> = [];
  for (const sc of segContents) {
    const chunk = sc.title + (sc.paras.length ? CRLF + CRLF + para(sc.paras) : '');
    const last = juanFiles[juanFiles.length - 1];
    if (last && last.base === sc.base) {
      last.chunks.push(chunk);
    } else {
      juanFiles.push({ file: `${String(juanFiles.length + 1).padStart(3, '0')}.md`, base: sc.base, chunks: [chunk] });
    }
  }
  if (juanFiles.length !== 90) throw new Error(`纪传文件 ${juanFiles.length} ≠ 90`);
  const zhiParts = zhiSegs.map((sg, gi) => {
    const end = gi + 1 < zhiSegs.length ? zhiSegs[gi + 1].start : lines.length;
    const paras: string[] = [];
    for (let n = sg.start + 1; n < end; n++) {
      const s = strip(lines[n]);
      if (s) paras.push(s);
    }
    return { file: `${String(91 + gi).padStart(3, '0')}.md`, title: sg.title, paras };
  });

  // ---------- 输出 ----------
  await mkdir(TEXT_DIR, { recursive: true });
  const files: Array<[string, string]> = [];
  files.push(['00.md', para(['（后汉书总目）']) + CRLF + CRLF
    + tocJuans.map((e) => `卷${e.num}@${e.title}`).join(CRLF) + CRLF + CRLF
    + tocZhi.map((e) => `志${e.num}@${e.title}`).join(CRLF) + CRLF]);
  for (const jf of juanFiles) {
    files.push([jf.file, jf.chunks.join(CRLF + CRLF) + CRLF]);
  }
  for (const p of zhiParts) {
    files.push([p.file, p.title + (p.paras.length ? CRLF + CRLF + para(p.paras) : '') + CRLF]);
  }
  for (const [name, content] of files) {
    await writeFile(path.join(TEXT_DIR, name), content, 'utf8');
  }

  // book.cfg：复制 books/04 配置，改书名/作者
  const tpl = await readFile(path.join(REPO, 'books', '04', 'book.cfg'), 'utf8');
  const cfg = tpl
    .replace(/^title=.*$/m, 'title=后汉书')
    .replace(/^author=.*$/m, 'author=宋范晔');
  await writeFile(path.join(BOOK_DIR, 'book.cfg'), cfg, 'utf8');

  console.log(`完成：纪传 ${mergedCount(juanFiles)} 卷（${segContents.length} 部）、志 ${zhiParts.length} 篇`);
  console.log(`输出：${TEXT_DIR}（00.md + 001..090.md + 091..120.md）与 book.cfg`);
  console.log(`排版调用：--book 05 --from 1 --to 121（00=总目，001..090=纪传卷，091..120=志）`);
}

function mergedCount(parts: Array<{ file: string }>): number {
  return new Set(parts.map((p) => p.file)).size;
}

main().catch((err) => {
  console.error('入库失败：', err);
  process.exit(1);
});
