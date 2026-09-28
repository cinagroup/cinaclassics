// 引擎绘制指令集：排版引擎只做纯计算，产出指令流，渲染器负责落到 PDF
// 指令按页分组，页内顺序即 z 序（先画在下层）

export interface TextOp {
  t: 'text';
  x: number;
  y: number;
  char: string;
  font: string; // 字体文件名
  size: number;
  color: string;
  rotate: number; // PDF 角度，正为逆时针
  boldStroke?: number; // 设置时用填充+描边（render mode 2）模拟加粗
}

export interface LineOp {
  t: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  c: string;
}

// 书名号波浪线：以折线段近似正弦
export interface WavyOp {
  t: 'wavy';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  c: string;
}

export interface CircleStrokeOp {
  t: 'circleStroke';
  x: number;
  y: number;
  r: number;
  w: number;
  c: string;
}

export interface CircleFillOp {
  t: 'circleFill';
  x: number;
  y: number;
  r: number;
  c: string;
}

export interface RectFillOp {
  t: 'rectFill';
  x: number;
  y: number;
  w: number;
  h: number;
  c: string;
}

/** 印章/图片贴放（addyin 等价）：宽度按指定值缩放，高度按图片纵横比自适应 */
export interface ImageOp {
  t: 'image';
  x: number;
  y: number;
  width: number; // 绘制宽度；高度 = width * (图高/图宽)
  key: string; // 素材 key（png/jpg）
}

export type Op =
  | TextOp
  | LineOp
  | WavyOp
  | CircleStrokeOp
  | CircleFillOp
  | RectFillOp
  | ImageOp;

export interface PageOps {
  /** null = 封面页（无刻本背景） */
  background: string | null; // 背景图素材 key
  backgroundCover: boolean; // true = 使用封面图片整页铺满
  ops: Op[];
}

export interface OutlineItem {
  title: string;
  pageIndex: number; // 0-based
}

export interface LayoutResult {
  pages: PageOps[];
  outlines: OutlineItem[];
  title: string;
  author: string;
  /** 每个文本序号（1 起）对应的首页 pageIndex（0 起，含封面） */
  firstPages: number[];
}
