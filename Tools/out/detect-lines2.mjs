// 分区横线检测：node out/detect-lines2.mjs <png> <x0> <x1>
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const png = PNG.sync.read(readFileSync(process.argv[2]));
const W = png.width, H = png.height;
const [X0, X1] = process.argv.slice(3).map(Number);
const lum = (i) => (png.data[i] * 0.299 + png.data[i + 1] * 0.587 + png.data[i + 2] * 0.114);
const hlines = [];
for (let y = 0; y < H; y++) {
  let c = 0;
  for (let x = X0; x <= X1; x++) if (lum((y * W + x) * 4) < 140) c++;
  if (c > (X1 - X0) * 0.85) hlines.push(y);
}
const g = [];
for (const y of hlines) {
  const last = g[g.length - 1];
  if (last && y - last.y1 <= 3) last.y1 = y; else g.push({ y0: y, y1: y });
}
console.log(`x∈[${X0},${X1}] 横线组:`, g.map((v) => `${v.y0}-${v.y1}`).join(' ') || '无');

// 区域墨量分布（行带 100px 粒度）看内容位置
for (let y = 0; y < H; y += 100) {
  let c = 0;
  for (let yy = y; yy < Math.min(y + 100, H); yy++)
    for (let x = X0; x <= X1; x++) if (lum((yy * W + x) * 4) < 140) c++;
  const bar = '#'.repeat(Math.round((c / ((X1 - X0) * 100)) * 100));
  console.log(`y ${String(y).padStart(4)}-${String(Math.min(y + 100, H)).padStart(4)}: ${(c / ((X1 - X0) * 100) * 100).toFixed(1)}% ${bar}`);
}
