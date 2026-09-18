// 版式周期分析：自相关找列距 pitch，再按 pitch 切列测每列字数与大/小字带高度
// 用法：node out/analyze-songkb2.mjs <png> <left> <top> <right> <bottom>
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const png = PNG.sync.read(readFileSync(process.argv[2]));
const W = png.width, H = png.height;
const [L0, T0, R0, B0] = process.argv.slice(3).map(Number);
const lum = (i) => (png.data[i] * 0.299 + png.data[i + 1] * 0.587 + png.data[i + 2] * 0.114);
const inkAt = (x, y) => (lum((y * W + x) * 4) < 140 ? 1 : 0);

// x 向剖面（框内）
const prof = [];
for (let x = L0; x <= R0; x++) {
  let c = 0;
  for (let y = T0; y <= B0; y++) c += inkAt(x, y);
  prof.push(c);
}
const mean = prof.reduce((a, b) => a + b, 0) / prof.length;
const dev = prof.map((v) => v - mean);

// 自相关
let best = { lag: 0, r: -1 };
for (let lag = 20; lag < 120; lag++) {
  let s = 0;
  for (let i = 0; i + lag < dev.length; i++) s += dev[i] * dev[i + lag];
  const r = s / (dev.length - lag);
  if (r > best.r) best = { lag, r };
}
console.log(`x 剖面自相关最强 lag(列距)=${best.lag}px, r=${(best.r / (dev.reduce((a, b) => a + b * b, 0) / dev.length)).toFixed(2)}`);
console.log(`框宽 ${R0 - L0} / ${best.lag} = ${((R0 - L0) / best.lag).toFixed(1)} 列`);

// y 向剖面自相关（整框，含大小字混合）
const yprof = [];
for (let y = T0; y <= B0; y++) {
  let c = 0;
  for (let x = L0; x <= R0; x++) c += inkAt(x, y);
  yprof.push(c);
}
const ymean = yprof.reduce((a, b) => a + b, 0) / yprof.length;
const ydev = yprof.map((v) => v - ymean);
let bestY = { lag: 0, r: -1 };
for (let lag = 10; lag < 80; lag++) {
  let s = 0;
  for (let i = 0; i + lag < ydev.length; i++) s += ydev[i] * ydev[i + lag];
  const r = s / (ydev.length - lag);
  if (r > bestY.r) bestY = { lag, r };
}
console.log(`y 剖面自相关最强 lag=${bestY.lag}px → 框高/${bestY.lag} = ${((B0 - T0) / bestY.lag).toFixed(1)}`);

// 按列距切列，找每列的字带（连通 y 段）并统计带高分布
const cols = [];
for (let x = L0; x + best.lag <= R0; x += best.lag) cols.push([x, x + best.lag]);
const TH = 6; // 最小带高
for (const [x0f, x1f] of cols) {
  const cx0 = Math.round(x0f + (x1f - x0f) * 0.1);
  const cx1 = Math.round(x1f - (x1f - x0f) * 0.1);
  const bands = [];
  let s = -1, run = 0;
  const flush = (yEnd) => {
    if (s >= 0 && yEnd - s >= TH) bands.push({ y0: s, y1: yEnd, h: yEnd - s });
    s = -1;
  };
  for (let y = T0; y <= B0; y++) {
    let c = 0;
    for (let x = cx0; x < cx1; x++) c += inkAt(x, y);
    const on = c >= 2;
    if (on) { if (s < 0) s = y; run = 0; } else if (s >= 0 && ++run > 4) {
      flush(y - 4);
    }
  }
  flush(B0);
  const hs = bands.map((b) => b.h).sort((a, b) => a - b);
  const groups = {};
  for (const h of hs) groups[Math.round(h / 5) * 5] = (groups[Math.round(h / 5) * 5] || 0) + 1;
  console.log(`列 x[${x0f.toFixed(0)},${x1f.toFixed(0)}]: ${bands.length}带 高度分组=${JSON.stringify(groups)} 序列=[${bands.map((b) => b.h).join(',')}]`);
}
