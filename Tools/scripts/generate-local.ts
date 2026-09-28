// 本地生成脚本：优先使用 .r2build 按书子集（与线上字体同源，内嵌字体兼容性最佳），
// 无子集时回落全量字体。不依赖 Workers/R2，用于排版引擎验证与成品导出。
// 用法：npm run local -- --book 01 --from 1 --to 2 [--mr] [--pages 5] [--no-stamps] [--out out/xx.pdf]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { AssetSource, FsAssetSource } from '../src/engine/assets.js';
import { generate, Shelf } from '../src/engine/pipeline.js';
import { resolveRepoRoot } from './repo.js';

const REPO_ROOT = resolveRepoRoot();
// 子集产物目录：本包内 .r2build（font-subset.ts 产物，随目录移动不变）
const BUILD_DIR = path.resolve(import.meta.dirname, '../.r2build');

// 覆盖式素材源：优先 .r2build（子集字体 + 改写的 cfg），回落仓库目录
class OverlayAssetSource implements AssetSource {
  constructor(private base: FsAssetSource, private overlay: FsAssetSource) {}
  async readText(key: string) {
    return (await this.overlay.readText(key)) ?? (await this.base.readText(key));
  }
  async readBytes(key: string) {
    return (await this.overlay.readBytes(key)) ?? (await this.base.readBytes(key));
  }
  async list(prefix: string) {
    const a = await this.overlay.list(prefix);
    const b = await this.base.list(prefix);
    return [...new Set([...a, ...b])];
  }
}

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

  const assets: AssetSource = new OverlayAssetSource(new FsAssetSource(REPO_ROOT), new FsAssetSource(BUILD_DIR));
  const subTag = (shelf === 'books_mr' ? 'sub-mr-' : 'sub-') + bookId;
  if (!existsSync(path.join(BUILD_DIR, 'fonts', subTag))) {
    console.log(`提示：未发现按书字体子集 fonts/${subTag}（npm run font-subset -- --book ${bookId}${shelf === 'books_mr' ? ' --mr' : ''}），本次将嵌入全量字体，PDF 体积较大。`);
  }
  console.log(`Cinaclassics — 本地生成 ${shelf}/${bookId} 文本 ${from} 至 ${to}${maxPages ? `（测试 ${maxPages} 页）` : ''}${stamps ? '' : '（无印章）'}`);
  const t0 = Date.now();
  const result = await generate(assets, {
    bookId, shelf, from, to, maxPages, stamps,
    fullFontsEmbed: true, // 本地成品导出：完整内嵌字体（Acrobat 兼容）
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
