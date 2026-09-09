// 渲染层：将排版指令流落到 PDF（pdf-lib）
// 对应 Perl 版 PDF::Builder 的用法：ttfont 嵌入、textlabel 逐字打印、gfx 绘制图形

import fontkit from '@pdf-lib/fontkit';
import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFFont,
  PDFPage,
  rgb,
  degrees,
} from 'pdf-lib';
import { AssetSource } from './assets.js';
import { FontSet } from './fonts.js';
import { LayoutResult, Op } from './types.js';

// 颜色解析：'black' | 'white' | 'blue' | '#RRGGBB'
const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [1, 1, 1],
  blue: [0, 0, 1],
  red: [1, 0, 0],
};
function parseColor(c: string): [number, number, number] {
  if (NAMED[c]) return NAMED[c];
  if (/^#[0-9a-fA-F]{6}$/.test(c)) {
    return [
      parseInt(c.slice(1, 3), 16) / 255,
      parseInt(c.slice(3, 5), 16) / 255,
      parseInt(c.slice(5, 7), 16) / 255,
    ];
  }
  return [0, 0, 0];
}

type EmbeddedImage = Awaited<ReturnType<PDFDocument['embedJpg']>> | Awaited<ReturnType<PDFDocument['embedPng']>>;

export interface RenderOptions {
  /** 完整内嵌字体（subset:false，含 cmap，Acrobat 兼容；内存占用高，仅限本地导出）。
   *  默认 false：pdf-lib 二次子集（嵌入最小字体，内存友好，适合 Workers）。 */
  fullFontsEmbed?: boolean;
}

export async function renderPdf(
  layout: LayoutResult,
  fonts: FontSet,
  assets: AssetSource,
  pageW: number,
  pageH: number,
  options?: RenderOptions,
): Promise<Uint8Array> {
  const fullFontsEmbed = options?.fullFontsEmbed === true;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  // 嵌入字体
  const fontCache = new Map<string, PDFFont>();
  const usedFonts = new Set<string>();
  for (const page of layout.pages) {
    for (const op of page.ops) {
      if (op.t === 'text') usedFonts.add(op.font);
    }
  }
  for (const name of usedFonts) {
    const file = fonts.get(name);
    if (!file) throw new Error(`字体未加载：${name}`);
    // fullFontsEmbed：加载的字体（按书子集）整体内嵌，保留 cmap/name 等全表，
    // Acrobat 可正常提取；否则 pdf-lib 二次子集仅保留渲染必需表（缺 cmap，
    // Acrobat 会报「无法提取内嵌字体」，浏览器渲染不受影响）。
    fontCache.set(name, await doc.embedFont(file.bytes as unknown as ArrayBuffer, { subset: !fullFontsEmbed }));
  }

  // 嵌入背景图（画布/封面，整页复用同一对象）；印章等贴图按扩展名嵌入
  const imgCache = new Map<string, EmbeddedImage>();
  const loadImage = async (key: string) => {
    if (imgCache.has(key)) return imgCache.get(key)!;
    const bytes = await assets.readBytes(key);
    if (bytes === null) throw new Error(`图片不存在：${key}`);
    const img = /\.png$/i.test(key)
      ? await doc.embedPng(bytes as unknown as ArrayBuffer)
      : await doc.embedJpg(bytes as unknown as ArrayBuffer);
    imgCache.set(key, img);
    return img;
  };

  // 预加载全部贴图（ImageOp），渲染阶段同步消费，避免落盘竞态
  for (const pageInfo of layout.pages) {
    for (const op of pageInfo.ops) {
      if (op.t === 'image') await loadImage(op.key);
    }
  }

  for (const pageInfo of layout.pages) {
    const page = doc.addPage([pageW, pageH]);
    if (pageInfo.background) {
      const img = await loadImage(pageInfo.background);
      page.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH });
    }
    for (const op of pageInfo.ops) drawOp(page, op, fontCache, imgCache);
  }

  // 文档信息
  doc.setTitle(layout.title);
  doc.setAuthor(layout.author);
  doc.setSubject('Cinaclassics · 中华古籍全文库');
  doc.setKeywords(['Cinaclassics', '中华古籍全文库', '古籍', '直排']);
  doc.setCreator('Cinaclassics');
  doc.setProducer('Cinaclassics · 古籍刻本风格直排电子书排版引擎');

  // 自动目录（书签）
  if (layout.outlines.length > 0) attachOutlines(doc, layout.outlines);

  // useObjectStreams=true：对象打包进对象流并压缩交叉引用（gs 压缩在 Workers 不可用，
  // 字体子集 + 对象流即本版的"压缩"等价实现）
  return await doc.save({ useObjectStreams: true });
}

function drawOp(
  page: PDFPage,
  op: Op,
  fontCache: Map<string, PDFFont>,
  imgCache: Map<string, EmbeddedImage>,
): void {
  switch (op.t) {
    case 'text': {
      const font = fontCache.get(op.font);
      if (!font) return;
      const [r, g, b] = parseColor(op.color);
      if (op.boldStroke !== undefined) {
        // 回退字体模拟加粗：文本渲染模式 2（填充+描边）
        page.pushOperators(
          rawOp('w', [op.boldStroke]),
          rawOp('RG', [r, g, b]),
          rawOp('Tr', [2]),
        );
        page.drawText(op.char, {
          x: op.x, y: op.y, font, size: op.size,
          color: rgb(r, g, b), rotate: degrees(op.rotate),
        });
        page.pushOperators(rawOp('Tr', [0]));
      } else {
        page.drawText(op.char, {
          x: op.x, y: op.y, font, size: op.size,
          color: rgb(r, g, b), rotate: degrees(op.rotate),
        });
      }
      break;
    }
    case 'line': {
      const [r, g, b] = parseColor(op.c);
      page.drawLine({
        start: { x: op.x1, y: op.y1 },
        end: { x: op.x2, y: op.y2 },
        thickness: op.w,
        color: rgb(r, g, b),
      });
      break;
    }
    case 'wavy':
      // 引擎已将波浪线展开为 line 序列，此处仅类型完备性兜底
      break;
    case 'circleStroke': {
      const [r, g, b] = parseColor(op.c);
      page.drawCircle({ x: op.x, y: op.y, size: op.r, borderWidth: op.w, borderColor: rgb(r, g, b) });
      break;
    }
    case 'circleFill': {
      const [r, g, b] = parseColor(op.c);
      page.drawCircle({ x: op.x, y: op.y, size: op.r, color: rgb(r, g, b) });
      break;
    }
    case 'rectFill': {
      const [r, g, b] = parseColor(op.c);
      page.drawRectangle({ x: op.x, y: op.y, width: op.w, height: op.h, color: rgb(r, g, b) });
      break;
    }
    case 'image': {
      // 高度按图片纵横比自适应（等价原版 Image::Magick 等比缩放后贴放）
      const img = imgCache.get(op.key);
      if (img) {
        page.drawImage(img, { x: op.x, y: op.y, width: op.width, height: op.width * (img.height / img.width) });
      }
      break;
    }
  }
}

// 构造原始 PDF 内容流算子。注意：算子名必须是普通字符串（如 'w'、'RG'、'Tr'），
// 传 PDFName 会使 sizeInBytes() 返回 NaN，导致整页内容流序列化为空。
function rawOp(name: string, args: number[]): PDFOperator {
  return PDFOperator.of(
    name as unknown as Parameters<typeof PDFOperator.of>[0],
    args.map((n) => PDFNumber.of(n)),
  );
}

// 用底层对象写入 /Outlines（pdf-lib 无高层书签 API）
function attachOutlines(doc: PDFDocument, items: { title: string; pageIndex: number }[]): void {
  const ctx = doc.context;
  const outlinesRef = ctx.nextRef();
  const itemRefs = items.map(() => ctx.nextRef());

  items.forEach((it, i) => {
    const page = doc.getPage(Math.min(it.pageIndex, doc.getPageCount() - 1));
    const dict = PDFDict.withContext(ctx);
    dict.set(PDFName.of('Title'), PDFHexString.fromText(it.title));
    dict.set(PDFName.of('Parent'), outlinesRef);
    dict.set(PDFName.of('Dest'), ctx.obj([page.ref, PDFName.of('Fit')]));
    if (i > 0) dict.set(PDFName.of('Prev'), itemRefs[i - 1]);
    if (i < items.length - 1) dict.set(PDFName.of('Next'), itemRefs[i + 1]);
    ctx.assign(itemRefs[i], dict);
  });

  ctx.assign(outlinesRef, ctx.obj({
    Type: 'Outlines',
    First: itemRefs[0],
    Last: itemRefs[items.length - 1],
    Count: items.length,
  }));
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}
