// 本地生成脚本：不依赖 Workers/R2，直接读仓库目录，用于排版引擎验证
// 用法：npm run local -- --book 01 --from 1 --to 2 [--mr] [--pages 5] [--no-stamps] [--out out/xx.pdf]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FsAssetSource } from '../src/engine/assets.js';
import { generate, Shelf } from '../src/engine/pipeline.js';
import { resolveRepoRoot } from './repo.js';

const REPO_ROOT = resolveRepoRoot();

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

async function main() {
  const bookId = arg('book', '01')!;
  const shelf: Shelf = process.argv.includes('--mr') ? 'books_mr' : 'books';
  const from = parseInt(arg('from', '1')!, 10);
  const to = parseInt(arg('to', '1')!, 10);
  const pagesArg = arg('pages');
  const maxPages = pagesArg ? parseInt(pagesArg, 10) : undefined;
  const stamps = !process.argv.includes('--no-stamps');

  const assets = new FsAssetSource(REPO_ROOT);
  console.log(`Cinaclassics — 本地生成 ${shelf}/${bookId} 文本 ${from} 至 ${to}${maxPages ? `（测试 ${maxPages} 页）` : ''}${stamps ? '' : '（无印章）'}`);
  const t0 = Date.now();
  const result = await generate(assets, {
    bookId, shelf, from, to, maxPages, stamps,
  });
  console.log(`排版完成：${result.layout.pages.length} 页，印章=${result.stamped}，${Date.now() - t0} ms`);

  const outDir = path.resolve(import.meta.dirname, '../out');
  await mkdir(outDir, { recursive: true });
  const outName = arg('out') ?? `《${result.layout.title}》文本${from}至${to}${maxPages ? '_test' : ''}.pdf`;
  const outPath = path.join(outDir, outName);
  await writeFile(outPath, result.pdfBytes);
  console.log(`已输出：${outPath}（${(result.pdfBytes.length / 1024 / 1024).toFixed(2)} MB，总耗时 ${Date.now() - t0} ms）`);
}

main().catch((err) => {
  console.error('生成失败：', err);
  process.exit(1);
});
