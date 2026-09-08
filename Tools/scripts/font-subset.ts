// 按书生成字体子集，用于 Workers 部署（绕开 128MB 内存限制）
//
// 原理：跑一遍全量字体排版，从 TextOp 精确收集每个字体实际绘制的字符集，
// 再用 fonteditor-core 生成保留 cmap 的子集 TTF，输出到
// .r2build/fonts/sub-<bookId>/，并生成改写 fontN 指向子集的 book.cfg。
// 最后用子集字体重跑排版，与全量版逐指令对比自检。
//
// 子集器说明：HarfBuzz（subset-font）对本素材仓的启功组合字体在大字符集下
// 会静默产出空 glyf 或报错，故改用 fonteditor-core（字蛛等中文子集工作流同款）。
//
// 用法：npx tsx scripts/font-subset.ts --book 01 [--mr] [--from 1] [--to 2]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Font as FontEditor } from 'fonteditor-core';
import { FsAssetSource, AssetSource } from '../src/engine/assets.js';
import { parseCfg } from '../src/engine/cfg.js';
import { FontSet } from '../src/engine/fonts.js';
import { runLayout } from '../src/engine/layout.js';
import { runLayoutMr } from '../src/engine/layout-mr.js';
import { ZH_NUMS } from '../src/engine/zhnum-data.js';
import { resolveRepoRoot } from './repo.js';

const REPO_ROOT = resolveRepoRoot();
// 子集产物目录：本包内 .r2build（随目录移动不变）
const BUILD_DIR = path.resolve(import.meta.dirname, '../.r2build');

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

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

// 用 fonteditor-core 生成子集字体：保留 cmap、compound2simple 拆解复合字形。
// （HarfBuzz/subset-font 对本仓启功组合字体在大字符集下会静默产出空 glyf 或报错；
//   pdf-lib 内嵌子集不含独立 cmap，无法作为独立 TTF 供 fontkit 复读，故用 fonteditor。）
async function subsetFontFile(bytes: Buffer, chars: string[]): Promise<Buffer> {
  const codes = chars.map((c) => c.codePointAt(0)!).filter((cp) => cp !== undefined);
  const font = FontEditor.create(bytes, {
    type: 'ttf', hinting: false, compound2simple: true, subset: codes,
  });
  return Buffer.from(font.write({ type: 'ttf', hinting: false }));
}

async function collectAndSubset(shelf: 'books' | 'books_mr', bookId: string, from: number, to: number) {
  const base = new FsAssetSource(REPO_ROOT);
  const subTag = shelf === 'books_mr' ? `sub-mr-${bookId}` : `sub-${bookId}`;
  console.log(`[${bookId}@${shelf}] 全量字体排版收集用字（文本 ${from} 至 ${to}）...`);
  const layoutOpts = { bookId, from, to };
  const layout = shelf === 'books_mr'
    ? await runLayoutMr(base, new FontSet(), layoutOpts)
    : await runLayout(base, new FontSet(), layoutOpts);

  // 每字体实际绘制字符集
  const used = new Map<string, Set<string>>();
  for (const page of layout.pages) {
    for (const op of page.ops) {
      if (op.t !== 'text') continue;
      if (!used.has(op.font)) used.set(op.font, new Set());
      used.get(op.font)!.add(op.char);
    }
  }

  // 保险字符：度量参考字 '国'（computeScales 用）、兜底 □、点注顿号、中文数字全表
  const insurance = new Set<string>(['国', '□', '、', ...Object.values(ZH_NUMS).join('')]);

  const subDir = path.join(BUILD_DIR, 'fonts', subTag);
  await mkdir(subDir, { recursive: true });
  const cfgRaw = await base.readText(`${shelf}/${bookId}/book.cfg`);
  const cfg = parseCfg(cfgRaw ?? '');
  const nameMap = new Map<string, string>();

  for (const [fontName, chars] of used) {
    const all = new Set([...chars, ...insurance]);
    const bytes = await fontBytes(base, fontName);
    const t0 = Date.now();
    const sub = await subsetFontFile(bytes, [...all]);
    validateSubset(sub, fontName);
    const subName = `${subTag}/${fontName}`;
    await writeFile(path.join(subDir, fontName), sub);
    nameMap.set(fontName, subName);
    console.log(`  ${fontName}: ${bytes.length} -> ${sub.length} bytes（${all.size} 字符，${Date.now() - t0}ms）`);
  }

  // 改写 book.cfg 的 fontN：用到的指向子集；未用到的置空（避免 Workers 加载全量字体）
  let cfgOut = cfgRaw ?? '';
  for (let slot = 1; slot <= 5; slot++) {
    const key = `font${slot}`;
    const m = cfgOut.match(new RegExp(`^${key}=(.*)$`, 'm'));
    if (!m) continue;
    const orig = m[1].trim();
    if (!orig) continue;
    if (nameMap.has(orig)) {
      cfgOut = cfgOut.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${nameMap.get(orig)}`);
    } else {
      cfgOut = cfgOut.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=`);
    }
  }
  const cfgDir = path.join(BUILD_DIR, shelf, bookId);
  await mkdir(cfgDir, { recursive: true });
  await writeFile(path.join(cfgDir, 'book.cfg'), cfgOut);
  console.log(`  book.cfg 已改写指向 ${subTag}/`);

  // 自检：子集字体重跑排版，逐指令对比
  console.log('自检：子集字体重跑排版对比...');
  const overlay = new OverlayAssetSource(base, new FsAssetSource(BUILD_DIR));
  const fonts2 = new FontSet();
  const layout2 = shelf === 'books_mr'
    ? await runLayoutMr(overlay, fonts2, layoutOpts)
    : await runLayout(overlay, fonts2, layoutOpts);

  if (layout.pages.length !== layout2.pages.length) {
    console.error(`FAIL 页数不一致: ${layout.pages.length} vs ${layout2.pages.length}`);
    process.exit(1);
  }
  let diff = 0;
  for (let i = 0; i < layout.pages.length; i++) {
    const a = layout.pages[i].ops;
    const b = layout2.pages[i].ops;
    if (a.length !== b.length) {
      console.error(`FAIL 第 ${i} 页指令数不一致: ${a.length} vs ${b.length}`);
      diff += Math.abs(a.length - b.length);
      continue;
    }
    for (let k = 0; k < a.length; k++) {
      const oa = a[k] as { font?: string };
      const fa = oa.font ? nameMap.get(oa.font) ?? oa.font : undefined;
      if (JSON.stringify({ ...a[k], font: fa }) !== JSON.stringify(b[k])) {
        if (diff < 3) console.error(`  差异 第${i}页#${k}:`, JSON.stringify(a[k]).slice(0, 80), '!=', JSON.stringify(b[k]).slice(0, 80));
        diff++;
      }
    }
  }
  if (diff > 0) {
    console.error(`FAIL 共 ${diff} 处指令差异`);
    process.exit(1);
  }
  console.log(`PASS：${layout.pages.length} 页全部指令（文字/图形/字体）与全量字体版完全一致`);
  console.log(`产物：${path.relative(REPO_ROOT, BUILD_DIR)}（r2-push 将优先推送）`);
}

const fontBytesCache = new Map<string, Buffer>();
async function fontBytes(base: FsAssetSource, fontName: string): Promise<Buffer> {
  let b = fontBytesCache.get(fontName);
  if (!b) {
    const raw = await base.readBytes(`fonts/${fontName}`);
    if (!raw) throw new Error(`未发现字体 fonts/${fontName}`);
    b = Buffer.from(raw);
    fontBytesCache.set(fontName, b);
  }
  return b;
}

// 校验子集字体：轮廓表非空（HarfBuzz 式静默失败的防护；字符覆盖由自检排版保证）
function validateSubset(sub: Buffer, fontName: string): void {
  const n = sub.readUInt16BE(4);
  for (let i = 0; i < n; i++) {
    const off = 12 + i * 16;
    const tag = sub.toString('ascii', off, off + 4);
    if ((tag === 'glyf' || tag === 'CFF ') && sub.readUInt32BE(off + 12) > 0) return;
  }
  throw new Error(`${fontName}: 子集轮廓表为空`);
}

const bookId = arg('book', '01')!;
const shelf = (process.argv.includes('--mr') ? 'books_mr' : 'books') as 'books' | 'books_mr';
const from = parseInt(arg('from', '1')!, 10);
const to = parseInt(arg('to', '1')!, 10);
await collectAndSubset(shelf, bookId, from, to);
