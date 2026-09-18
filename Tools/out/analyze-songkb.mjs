// 一次性分析脚本：量化宋刻本书影的版式（行数/每行字数/大小字比例）
// 用法：node out/analyze-songkb.mjs <png路径>
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const png = PNG.sync.read(readFileSync(process.argv[2]));
const W = png.width, H = png.height;
const lum = (i) => (png.data[i] * 0.299 + png.data[i + 1] * 0.587 + png.data[i + 2] * 0.114);
const ink = new Uint8Array(W * H);
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++)
    ink[y * W + x] = lum((y * W + x) * 4) < 140 ? 1 : 0;

// 水平投影：每行 y 的墨量 → 找版框上下边（长黑线）
const rowInk = new Array(H).fill(0);
for (let y = 0; y < H; y++) {
  let c = 0;
  for (let x = 0; x < W; x++) c += ink[y * W + x];
  rowInk[y] = c;
}
// 垂直投影：每列 x 的墨量 → 找版框左右边
const colInk = new Array(W).fill(0);
for (let x = 0; x < W; x++) {
  let c = 0;
  for (let y = 0; y < H; y++) c += ink[y * W + x];
  colInk[x] = c;
}

const topEdge = rowInk.findIndex((v) => v > W * 0.5);
const btmEdge = H - 1 - [...rowInk].reverse().findIndex((v) => v > W * 0.5);
const leftEdge = colInk.findIndex((v) => v > H * 0.5);
const rightEdge = W - 1 - [...colInk].reverse().findIndex((v) => v > H * 0.5);
console.log(`版框: left=${leftEdge} right=${rightEdge} top=${topEdge} bottom=${btmEdge}`);
console.log(`版框尺寸: ${rightEdge - leftEdge} x ${btmEdge - topEdge} (宽x高) 比例=${((rightEdge - leftEdge) / (btmEdge - topEdge)).toFixed(3)}`);

// 文本区（去边框线 ±6px）
const T = topEdge + 6, B = btmEdge - 6, L = leftEdge + 6, R = rightEdge - 6;

// 列检测：在文本区内，x 向滑窗墨量（窗口=3px），找低墨谷分列
const win = 3;
const colProfile = [];
for (let x = L; x <= R; x++) {
  let c = 0;
  for (let y = T; y <= B; y++) {
    for (let dx = 0; dx < win; dx++) if (x + dx <= R) c += ink[y * W + x + dx];
  }
  colProfile.push({ x, v: c });
}
// 用谷检测找列分隔：v < 均值*0.15 的连续区段中点为分隔
const meanV = colProfile.reduce((s, p) => s + p.v, 0) / colProfile.length;
const gaps = [];
let gs = -1;
for (let i = 0; i < colProfile.length; i++) {
  const low = colProfile[i].v < meanV * 0.12;
  if (low && gs < 0) gs = i;
  if (!low && gs >= 0) { gaps.push(Math.round((colProfile[gs].x + colProfile[i - 1].x + win) / 2)); gs = -1; }
}
if (gs >= 0) gaps.push(Math.round((colProfile[gs].x + colProfile[colProfile.length - 1].x + win) / 2));
console.log(`列分隔谷 x ≈ [${gaps.join(', ')}] → ${gaps.length - 1} 列（若左右两半）`);

// 对每个检测到的列区间，做 y 向投影找字高
function bandsOf(x0, x1) {
  const prof = [];
  for (let y = T; y <= B; y++) {
    let c = 0;
    for (let x = x0; x <= x1; x++) c += ink[y * W + x];
    prof.push({ y, v: c });
  }
  const m = prof.reduce((s, p) => s + p.v, 0) / prof.length;
  const bs = [];
  let s = -1;
  for (let i = 0; i < prof.length; i++) {
    const on = prof[i].v > m * 0.10;
    if (on && s < 0) s = i;
    if ((!on || i === prof.length - 1) && s >= 0) {
      const y0 = prof[s].y, y1 = prof[i].y;
      if (y1 - y0 >= 6) bs.push({ y0, y1, h: y1 - y0 });
      s = -1;
    }
  }
  return bs;
}

// 取第2列（右起第一列为正文首页首列附近；避开版心，版心约在中缝 gaps 中部）
// 输出最右 4 列的字带高度序列
const cols = [];
for (let i = 0; i < gaps.length - 1; i++) cols.push([gaps[i], gaps[i + 1]]);
const rightCols = cols.slice(-5);
for (const [x0, x1] of rightCols) {
  const bs = bandsOf(x0 + 1, x1 - 1);
  const hs = bs.map((b) => b.h);
  const hsSorted = [...hs].sort((a, b) => a - b);
  const med = hsSorted.length ? hsSorted[Math.floor(hsSorted.length / 2)] : 0;
  console.log(`列 x[${x0},${x1}] 宽=${x1 - x0}: ${bs.length} 字带, 高度中位=${med}, 序列=[${hs.join(',')}]`);
}
