// 长直线检测：找整幅扫描中的版框竖线/横线
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const png = PNG.sync.read(readFileSync(process.argv[2]));
const W = png.width, H = png.height;
const lum = (i) => (png.data[i] * 0.299 + png.data[i + 1] * 0.587 + png.data[i + 2] * 0.114);

// 竖线：某 x 列在大部分 y 上为墨
const vlines = [];
for (let x = 0; x < W; x++) {
  let c = 0;
  for (let y = 400; y < H; y++) if (lum((y * W + x) * 4) < 140) c++;
  if (c > (H - 400) * 0.75) vlines.push({ x, c });
}
// 聚类相邻
const vgroups = [];
for (const v of vlines) {
  const g = vgroups[vgroups.length - 1];
  if (g && v.x - g.x1 <= 3) { g.x1 = v.x; g.cnt++; } else vgroups.push({ x0: v.x, x1: v.x, cnt: 1 });
}
console.log('竖线组:', vgroups.map((g) => `${g.x0}-${g.x1}(w${g.x1 - g.x0 + 1})`).join(' '));

const hlines = [];
for (let y = 0; y < H; y++) {
  let c = 0;
  for (let x = 0; x < W; x++) if (lum((y * W + x) * 4) < 140) c++;
  if (c > W * 0.75) hlines.push({ y, c });
}
const hgroups = [];
for (const v of hlines) {
  const g = hgroups[hgroups.length - 1];
  if (g && v.y - g.y1 <= 3) { g.y1 = v.y; g.cnt++; } else hgroups.push({ y0: v.y, y1: v.y, cnt: 1 });
}
console.log('横线组:', hgroups.map((g) => `${g.y0}-${g.y1}(h${g.y1 - g.y0 + 1})`).join(' '));
