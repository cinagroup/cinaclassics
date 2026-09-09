// 生成管线：书籍配置 → 排版（主版/多栏版）→ 印章（可选）→ PDF 渲染

import { AssetSource } from './assets.js';
import { num, parseCfg, RawCfg, str } from './cfg.js';
import { FontSet } from './fonts.js';
import { runLayout } from './layout.js';
import { runLayoutMr } from './layout-mr.js';
import { renderPdf } from './render.js';
import { applyStamps, parseStamps, StampCanvas, stampCanvasFromCfg } from './stamps.js';
import { LayoutResult } from './types.js';

export type Shelf = 'books' | 'books_mr';

export interface GenerateOptions {
  bookId: string;
  shelf: Shelf;
  from: number;
  to: number;
  maxPages?: number;
  debugBlue?: boolean;
  /** 印章：默认自动（存在 stamps.cfg 时应用），false 强制关闭 */
  stamps?: boolean;
  /** 完整内嵌字体（含 cmap，Acrobat 兼容；内存占用较高，适合本地导出成品）。
   *  默认 false：嵌入最小字体子集（内存友好，适合 Workers 按需生成）。 */
  fullFontsEmbed?: boolean;
}

export interface GenerateResult {
  pdfBytes: Uint8Array;
  layout: LayoutResult;
  pageW: number;
  pageH: number;
  stamped: boolean;
}

export async function generate(
  assets: AssetSource,
  opts: GenerateOptions,
): Promise<GenerateResult> {
  const bookCfgKey = `${opts.shelf}/${opts.bookId}/book.cfg`;
  const cfgTxt = await assets.readText(bookCfgKey);
  if (cfgTxt === null) throw new Error(`未发现书籍配置 ${bookCfgKey}`);
  const cfg = parseCfg(cfgTxt);

  const fonts = new FontSet();
  const layoutOpts = {
    bookId: opts.bookId,
    from: opts.from,
    to: opts.to,
    maxPages: opts.maxPages,
    debugBlue: opts.debugBlue,
  };
  const layout = opts.shelf === 'books_mr'
    ? await runLayoutMr(assets, fonts, layoutOpts)
    : await runLayout(assets, fonts, layoutOpts);

  // 印章（books[_mr]/<id>/stamps.cfg 存在时）
  let stamped = false;
  if (opts.stamps !== false) {
    const stampsTxt = await assets.readText(`${opts.shelf}/${opts.bookId}/stamps.cfg`);
    if (stampsTxt !== null) {
      const canvasId = str(cfg, 'canvas_id');
      const canvasTxt = await assets.readText(`canvas/${canvasId}.cfg`);
      if (canvasTxt !== null) {
        const canvas: RawCfg = parseCfg(canvasTxt);
        const sc: StampCanvas = stampCanvasFromCfg(canvas, num(cfg, 'row_num'));
        stamped = applyStamps(layout, parseStamps(stampsTxt), sc, `${opts.shelf}/${opts.bookId}`);
      }
    }
  }

  const canvasId = str(cfg, 'canvas_id');
  const canvasTxt = await assets.readText(`canvas/${canvasId}.cfg`);
  if (canvasTxt === null) throw new Error(`未发现背景配置 canvas/${canvasId}.cfg`);
  const canvas = parseCfg(canvasTxt);
  const pageW = num(canvas, 'canvas_width');
  const pageH = num(canvas, 'canvas_height');

  const pdfBytes = await renderPdf(layout, fonts, assets, pageW, pageH, { fullFontsEmbed: opts.fullFontsEmbed === true });
  return { pdfBytes, layout, pageW, pageH, stamped };
}
