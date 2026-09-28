// 生成各书目的元数据 meta.json（书名/作者/文本清单/印章可用性）：
//   扫描 books/ 与 books_mr/ 下含 book.cfg 的书目，汇总文本清单（.md，排序），
//   以各文件首行（（…）题名）为展示标签，写入 books/<id>/meta.json 供 Worker
//   的 /meta 接口与排版服务页面使用。
//
// 用法：npx tsx scripts/gen-meta.ts

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseCfg } from '../src/engine/cfg.js';
import { resolveRepoRoot } from './repo.js';

const REPO = resolveRepoRoot();
const SHELVES: Array<'books' | 'books_mr'> = ['books', 'books_mr'];

async function main() {
  for (const shelf of SHELVES) {
    const shelfDir = path.join(REPO, shelf);
    if (!existsSync(shelfDir)) continue;
    for (const id of (await readdir(shelfDir)).sort()) {
      const bookDir = path.join(shelfDir, id);
      if (!existsSync(path.join(bookDir, 'book.cfg'))) continue;
      const cfg = parseCfg(await readFile(path.join(bookDir, 'book.cfg'), 'utf8'));
      const title = String(cfg['title'] ?? id);
      const author = String(cfg['author'] ?? '');

      const textDir = path.join(bookDir, 'text');
      const texts: Array<{ file: string; label: string }> = [];
      if (existsSync(textDir)) {
        for (const f of (await readdir(textDir)).sort()) {
          if (!f.endsWith('.md')) continue;
          const head = (await readFile(path.join(textDir, f), 'utf8')).split(/\r?\n/)[0] ?? '';
          const label = head.replace(/^[（(]|[）)]$/g, '').replace(/@/g, ' ').trim();
          texts.push({ file: f, label: label || f });
        }
      }

      const stamps = existsSync(path.join(bookDir, 'stamps.cfg'));
      const meta = { id, title, author, stamps, texts };
      await writeFile(path.join(bookDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
      console.log(`[${shelf}/${id}] ${title} · ${author} · 文本 ${texts.length}`);
    }
  }
  console.log('meta.json 生成完毕');
}

main().catch((err) => {
  console.error('生成失败：', err);
  process.exit(1);
});
