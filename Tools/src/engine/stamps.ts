// 印章贴放 — books/<id>/addyin.pl 的通用化等价
//
// 原版 addyin.pl 为硬编码的印章位置表（页|列|行|列数|图片），逐 PDF 后处理盖印；
// 本实现改为书籍目录下的 stamps.cfg 声明式配置，在渲染指令流上追加 ImageOp。
//
// stamps.cfg 每行格式（# 为注释）：
//   <页>|<列>|<行>|<列数>|<图片素材key>
//   页：PDF 绝对页码（1 起，含封面）；tN = 第 N 个文本的首页；t* = 每个文本的首页
//   列：起始列（可为小数，如 22.5）；行：起始行；列数：占几列宽
// 坐标计算与原版一致：x = W - 右边距 - 列宽*列（超过半页减叶心宽），y = 下边距 + 行高*(行-1)

import { parseCfg, RawCfg } from './cfg.js';
import { LayoutResult } from './types.js';

export interface StampSpec {
  pageExpr: string; // '12' | 't1' | 't*'
  col: number;
  row: number;
  cols: number;
  image: string;
}

export function parseStamps(content: string): StampSpec[] {
  const out: StampSpec[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const parts = line.split('|');
    if (parts.length !== 5) continue;
    const [pageExpr, col, row, cols, image] = parts.map((p) => p.trim());
    out.push({
      pageExpr,
      col: parseFloat(col),
      row: parseFloat(row),
      cols: parseFloat(cols),
      image,
    });
  }
  return out;
}

export interface StampCanvas {
  width: number; // canvas_width
  height: number;
  marginRight: number;
  marginBottom: number;
  colWidth: number; // cw
  rowHeight: number; // rh
  colNum: number;
  leafCenterWidth: number; // lc_width
}

/** 将印章指令追加到排版结果的对应页（就地修改，返回是否生效） */
export function applyStamps(
  layout: LayoutResult,
  stamps: StampSpec[],
  canvas: StampCanvas,
  bookPrefix: string, // 素材相对目录（books/01 或 books_mr/01），图片 key 若未带前缀则拼接
): boolean {
  let applied = 0;
  for (const st of stamps) {
    const targets: number[] = [];
    if (st.pageExpr === 't*') {
      targets.push(...layout.firstPages);
    } else if (/^t\d+$/i.test(st.pageExpr)) {
      const idx = layout.firstPages[parseInt(st.pageExpr.slice(1), 10) - 1];
      if (idx !== undefined) targets.push(idx);
    } else {
      const n = parseInt(st.pageExpr, 10);
      if (!Number.isNaN(n)) targets.push(n - 1); // PDF 1-based → 0-based pageIndex
    }

    const iw = st.cols * canvas.colWidth;
    let ix = canvas.width - canvas.marginRight - canvas.colWidth * st.col;
    if (st.col > canvas.colNum / 2) ix -= canvas.leafCenterWidth;
    const iy = canvas.marginBottom + canvas.rowHeight * (st.row - 1);

    const key = st.image.includes('/') ? st.image : `${bookPrefix}/yin/${st.image}`;
    for (const pageIndex of targets) {
      const page = layout.pages[pageIndex];
      if (!page) continue;
      page.ops.push({ t: 'image', x: ix, y: iy, width: iw, key });
      applied++;
    }
  }
  return applied > 0;
}

// 复用 cfg 解析器读取 canvas 尺寸；rowNum 来自书籍配置（原版 addyin 同样用未折算的 row_num 计算 rh）
export function stampCanvasFromCfg(canvas: RawCfg, rowNum: number): StampCanvas {
  const W = Number(canvas['canvas_width']);
  const H = Number(canvas['canvas_height']);
  const colNum = Number(canvas['leaf_col']);
  const lc = Number(canvas['leaf_center_width']);
  const cw = (W - Number(canvas['margins_left']) - Number(canvas['margins_right']) - lc) / colNum;
  const rh = (H - Number(canvas['margins_top']) - Number(canvas['margins_bottom'])) / rowNum;
  return {
    width: W,
    height: H,
    marginRight: Number(canvas['margins_right']),
    marginBottom: Number(canvas['margins_bottom']),
    colWidth: cw,
    rowHeight: rh,
    colNum,
    leafCenterWidth: lc,
  };
}

export { parseCfg };
