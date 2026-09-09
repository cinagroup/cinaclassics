// 《汉书》（程高本式整理文本，120 卷目）入库脚本：
//   从 cinaclassics 库文本（史藏/正史/汉书.md）生成素材仓库 books/04：
//   text/00.txt（总目）+ 001.txt..120.txt（一卷一文件）及 book.cfg。
//   库文本结构：目录区 120 条「卷号 + 篇名」单行；正文卷标记样式混杂
//   （卷号与篇名同行/粘连、或篇名在下一行），按目录卷号顺序匹配解析，
//   篇名一律依目录（标记行无篇名时下一同文行视为篇名行并跳过）。
//
// 用法：npx tsx scripts/ingest-hanshu.ts [库文本路径]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveRepoRoot } from './repo.js';

const SRC = process.argv[2] ?? 'E:/cinagroup/cinaclassics/史藏/正史/汉书.md';
const REPO = resolveRepoRoot();
const BOOK_DIR = path.join(REPO, 'books', '04');
const TEXT_DIR = path.join(BOOK_DIR, 'text');

const CRLF = '\r\n';
const strip = (l: string) => l.replace(/[\s　]/g, '');
const NUM = '[一二三四五六七八九十百零中上下之]';
const MARK = (num: string) => new RegExp(`^卷${num}([　\\s]|$)`);

function para(lines: string[]): string {
  return lines.map((l) => l.trim()).filter((l) => l.length > 0).join(CRLF + CRLF);
}

async function main() {
  const raw = (await readFile(SRC, 'utf8')).replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);

  // ---------- 目录：120 条「卷号 篇名」 ----------
  const toc: { num: string; title: string }[] = [];
  let i = 0;
  while (toc.length < 120 && i < lines.length) {
    const s = lines[i].trim();
    const m = s.match(new RegExp(`^卷(${NUM}+)(?:（[^）]*）)?[　\\s]+(.+)$`));
    if (m) {
      toc.push({ num: m[1], title: m[2].trim() });
      i++;
    } else i++;
  }
  if (toc.length !== 120) throw new Error(`目录仅 ${toc.length} 条`);
  const tocEnd = i; // 目录区结束（0 基）

  // ---------- 正文：按目录卷号顺序匹配标记 ----------
  const juan: { title: string; paras: string[] }[] = [];
  let cur: { title: string; paras: string[] } | null = null;
  let k = 0;
  for (let n = tocEnd; n < lines.length; n++) {
    const s = strip(lines[n]);
    if (!s) continue;
    if (k >= 120) {
      if (cur) cur.paras.push(s);
      continue;
    }
    const marker = '卷' + toc[k].num;
    if (s.startsWith(marker)) {
      if (cur) juan.push(cur);
      cur = { title: toc[k].title, paras: [] };
      const rest = s.slice(marker.length);
      if (!rest) {
        // 篇名可能在下一行（如「卷十五上」+「王子侯表第三上」）：若下一非空行等于目录篇名则跳过
        let j = n + 1;
        while (j < lines.length && !strip(lines[j])) j++;
        if (strip(lines[j]) === toc[k].title) n = j;
      }
      k++;
    } else if (cur) {
      cur.paras.push(s);
    }
  }
  if (cur) juan.push(cur);
  if (k !== 120) throw new Error(`正文卷数 ${k} ≠ 120`);
  const empties = juan.map((h, z) => (h.paras.length === 0 ? z + 1 : 0)).filter((z) => z);
  if (empties.length) console.log(`空卷（仅题名，源文献如此）：第 ${empties.join('、')} 卷`);

  // ---------- 输出 ----------
  // 上下分卷（卷一上/卷一下…）合并为同一基卷号文件，使文件序 = 卷号序 = 版心卷次
  const baseOf = (num: string) => { let n = num; while (/[上下中之]$/.test(n)) n = n.slice(0, -1); return n; };
  await mkdir(TEXT_DIR, { recursive: true });
  const files: Array<[string, string]> = [];
  files.push(['00.md', para(['（汉书总目）']) + CRLF + CRLF + toc.map((e) => `卷${e.num}@${e.title}`).join(CRLF) + CRLF]);
  const groups: Array<{ base: string; file: string; chunks: string[] }> = [];
  juan.forEach((h, z) => {
    const base = baseOf(toc[z].num);
    const chunk = `（卷${toc[z].num}@${h.title}）` + (h.paras.length ? CRLF + CRLF + para(h.paras) : '');
    const last = groups[groups.length - 1];
    if (last && last.base === base) {
      last.chunks.push(chunk);
    } else {
      groups.push({ base, file: `${String(groups.length + 1).padStart(3, '0')}.md`, chunks: [chunk] });
    }
  });
  for (const g of groups) {
    files.push([g.file, g.chunks.join(CRLF + CRLF) + CRLF]);
  }
  if (groups.length !== 100) throw new Error(`基卷号分组数 ${groups.length} ≠ 100`);
  for (const [name, content] of files) {
    await writeFile(path.join(TEXT_DIR, name), content, 'utf8');
  }

  // book.cfg：复制 books/03 配置，改书名/作者；版心后缀 卷X（X=卷序）
  const tpl = await readFile(path.join(REPO, 'books', '03', 'book.cfg'), 'utf8');
  const cfg = tpl
    .replace(/^title=.*$/m, 'title=汉书')
    .replace(/^author=.*$/m, 'author=汉班固')
    .replace(/^title_postfix=.*$/m, 'title_postfix=卷X #版心后缀：卷一..卷百二十；00.txt 为序');
  await writeFile(path.join(BOOK_DIR, 'book.cfg'), cfg, 'utf8');

  const paras = juan.reduce((a, h) => a + h.paras.length, 0);
  console.log(`完成：基卷 ${groups.length}（含上下分卷共 120 卷），${paras} 段`);
  console.log(`输出：${TEXT_DIR}（00.txt + 001..100.txt）与 book.cfg`);
  console.log(`排版调用：--book 04 --from 1 --to 101（00=总目）`);
}

main().catch((err) => {
  console.error('入库失败：', err);
  process.exit(1);
});
