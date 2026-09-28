// 《红楼梦》（程高本 120 回）入库脚本：
//   从 cinaclassics 库文本（集藏/小说/红楼梦.md）生成素材仓库 books/03：
//   text/00.txt（总目）+ 001.txt..120.txt（一回一文件）及 book.cfg。
//   库文本结构：目录区 120 条「回号行 + 两行联目」；正文回目标记为整行式
//   （第X回　上联　下联）与独立式（回号行 + 一行联目）混杂，按目录回号顺序
//   匹配消除正文「第X回中…」之类内容行的假阳性。
//
// 用法：npx tsx scripts/ingest-hongloumeng.ts [库文本路径]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveRepoRoot } from './repo.js';

const SRC = process.argv[2] ?? 'E:/cinagroup/cinaclassics/集藏/小说/红楼梦.md';
const REPO = resolveRepoRoot();
const BOOK_DIR = path.join(REPO, 'books', '03');
const TEXT_DIR = path.join(BOOK_DIR, 'text');

const CRLF = '\r\n';
const strip = (l: string) => l.replace(/[\s　]/g, '');
const NUM = '[一二三四五六七八九十百零]';
// 联目等分处插 @ 空格（回目皆为对仗，长度均等）
const couplet = (s: string) => (s.length >= 6 && s.length % 2 === 0 ? s.slice(0, s.length / 2) + '@' + s.slice(s.length / 2) : s);

function para(lines: string[]): string {
  return lines.map((l) => l.trim()).filter((l) => l.length > 0).join(CRLF + CRLF);
}

async function main() {
  const raw = (await readFile(SRC, 'utf8')).replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);

  // ---------- 目录：120 条「回号行 + 两行联目」 ----------
  const toc: { num: string; p1: string; p2: string }[] = [];
  let i = 0;
  while (toc.length < 120 && i < lines.length) {
    const m = strip(lines[i]).match(new RegExp(`^第(${NUM}+)回$`));
    if (m) {
      const p1 = strip(lines[i + 1]);
      const p2 = strip(lines[i + 2]);
      if (!p1 || !p2) throw new Error(`目录第 ${toc.length + 1} 条联目缺失`);
      toc.push({ num: m[1], p1, p2 });
      i += 3;
    } else i++;
  }
  if (toc.length !== 120) throw new Error(`目录仅 ${toc.length} 条`);
  const tocEnd = i; // 目录区结束（0 基）

  // ---------- 正文：按目录回号顺序匹配标记 ----------
  const hui: { title: string; paras: string[] }[] = [];
  const fixes: string[] = [];
  let cur: { title: string; paras: string[] } | null = null;
  let k = 0;
  for (let n = tocEnd; n < lines.length; n++) {
    const s = strip(lines[n]);
    if (!s) continue;
    if (k >= 120) {
      if (cur) cur.paras.push(s);
      continue;
    }
    const expected = '第' + toc[k].num + '回';
    if (s.startsWith(expected)) {
      if (cur) hui.push(cur);
      const rest = s.slice(expected.length);
      // 联目粘连正文起句时（如「…大承笞挞却说王夫人…」），按目录联目截断
      const full = toc[k].p1 + toc[k].p2;
      let title = rest;
      if (rest.length > full.length && rest.startsWith(full)) {
        title = full;
        fixes.push(`第 ${k + 1} 回联目粘连正文，已截断`);
      }
      if (rest) {
        // 整行式：rest 即联目
        cur = { title: couplet(title), paras: [] };
        if (title !== full) fixes.push(`第 ${k + 1} 回正文联目与目录不同（依正文）：${title}`);
      } else {
        // 独立式：联目在下一非空行
        let j = n + 1;
        while (j < lines.length && !strip(lines[j])) j++;
        cur = { title: couplet(strip(lines[j])), paras: [] };
        n = j;
      }
      k++;
    } else if (cur) {
      cur.paras.push(s);
    }
  }
  if (cur) hui.push(cur);
  if (k !== 120) throw new Error(`正文回数 ${k} ≠ 120`);
  const empty = hui.findIndex((h) => h.paras.length === 0);
  if (empty >= 0) throw new Error(`第 ${empty + 1} 回无正文`);

  // ---------- 输出 ----------
  await mkdir(TEXT_DIR, { recursive: true });
  const files: Array<[string, string]> = [];
  // 00.txt：总目
  const tocText = toc
    .map((e) => `第${e.num}回@${couplet(e.p1 + e.p2)}`)
    .join(CRLF);
  files.push(['00.md', para(['（红楼梦总目）']) + CRLF + CRLF + tocText + CRLF]);
  // 001..120.txt：一回一文件
  hui.forEach((h, z) => {
    const body = para(h.paras);
    files.push([
      `${String(z + 1).padStart(3, '0')}.md`,
      `（第${toc[z].num}回@${h.title}）` + CRLF + CRLF + body + CRLF,
    ]);
  });
  for (const [name, content] of files) {
    await writeFile(path.join(TEXT_DIR, name), content, 'utf8');
  }

  // book.cfg：复制 books/02 配置，改书名/作者/版心后缀
  const tpl = await readFile(path.join(REPO, 'books', '02', 'book.cfg'), 'utf8');
  const cfg = tpl
    .replace(/^title=.*$/m, 'title=红楼梦')
    .replace(/^author=.*$/m, 'author=清曹雪芹')
    .replace(/^title_postfix=.*$/m, 'title_postfix=第X回 #版心后缀：第一回..第一百二十回；00.txt 为序');
  await writeFile(path.join(BOOK_DIR, 'book.cfg'), cfg, 'utf8');

  const paras = hui.reduce((a, h) => a + h.paras.length, 0);
  console.log(`完成：120 回，${paras} 段`);
  if (fixes.length) console.log('联目差异（依正文）：\n  ' + fixes.slice(0, 10).join('\n  ') + (fixes.length > 10 ? `\n  …共 ${fixes.length} 处` : ''));
  console.log(`输出：${TEXT_DIR}（00.txt + 001..120.txt）与 book.cfg`);
  console.log(`排版调用：--book 03 --from 1 --to 121（00=总目）`);
}

main().catch((err) => {
  console.error('入库失败：', err);
  process.exit(1);
});
