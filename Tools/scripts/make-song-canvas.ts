// 生成宋式界栏背景 canvas/24_song.jpg：
//   以 24_black_blank.jpg 为底，抹去其烘焙的 24 列界栏（94.17px 间距），
//   按宋式 20 列网格（113px 间距，半叶十行）重画界栏；版心条/鱼尾/边框不动。
// 用法：npx tsx scripts/make-song-canvas.ts

import { writeFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const SRC = 'canvas/24_black_blank.jpg';
const DST = 'canvas/24_song.jpg';
const W = 2480;
const H = 1860;

// 旧 24 列界栏 x 坐标（渲染页实测：x = 2430 - 94.17k，k=1..23，不含框线50/2430与版心边1180/1300）
const OLD_RULES = [
  144, 238, 332, 427, 521, 615, 709, 803, 897, 992, 1086,
  1394, 1488, 1582, 1677, 1771, 1865, 1959, 2053, 2147, 2242, 2336,
];
// 新 20 列界栏（双叶拼版：右半叶 1300..2430、左半叶 50..1180，各 9 条内部界栏）
const NEW_RULES = [
  1413, 1526, 1639, 1752, 1865, 1978, 2091, 2204, 2317,
  163, 276, 389, 502, 615, 728, 841, 954, 1067,
];

async function main() {
  const img = await loadImage(SRC);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);
  const image = ctx.getImageData(0, 0, W, H);
  const d = image.data;

  const lum = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
  };

  // 界栏纵向范围：取一条旧界栏探测暗像素范围
  let y0 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    if (lum(2147, y) < 150) {
      if (y0 < 0) y0 = y;
      y1 = y;
    }
  }
  // 收敛到主体范围（去噪：首尾孤立暗点）
  while (y1 - y0 > 10 && lum(2147, y1) >= 150) y1--;
  while (y1 - y0 > 10 && lum(2147, y0) >= 150) y0++;
  console.log(`界栏纵向范围 y ∈ [${y0}, ${y1}]`);

  // 旧界栏线色（沿旧线取暗像素中位色）
  const samples: [number, number, number][] = [];
  for (let y = y0 + 40; y < y1 - 40; y += 17) {
    const i = (y * W + 2147) * 4;
    if (lum(2147, y) < 150) samples.push([d[i], d[i + 1], d[i + 2]]);
  }
  samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  const [r0, g0, b0] = samples[Math.floor(samples.length / 2)] ?? [40, 35, 30];
  console.log(`界栏色样本 rgb(${r0},${g0},${b0})，样本数 ${samples.length}`);

  // 抹旧线：x±2 置为两侧干净纸色均值（旧线间距 94，取 x±6 采样）
  for (const rx of OLD_RULES) {
    for (let y = y0; y <= y1; y++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = rx + dx;
        if (x < 0 || x >= W) continue;
        const ia = (y * W + (rx - 6)) * 4;
        const ib = (y * W + (rx + 6)) * 4;
        const t = (dx + 2) / 4;
        const i = (y * W + x) * 4;
        d[i] = Math.round(d[ia] * (1 - t) + d[ib] * t);
        d[i + 1] = Math.round(d[ia + 1] * (1 - t) + d[ib + 1] * t);
        d[i + 2] = Math.round(d[ia + 2] * (1 - t) + d[ib + 2] * t);
      }
    }
  }

  // 画新线：1px 主线 + 两侧 0.5 强度的过渡，宽度与旧线视觉一致（旧线约 1-2px）
  const put = (x: number, y: number, k: number) => {
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    const i = (y * W + x) * 4;
    d[i] = Math.round(d[i] * (1 - k) + r0 * k);
    d[i + 1] = Math.round(d[i + 1] * (1 - k) + g0 * k);
    d[i + 2] = Math.round(d[i + 2] * (1 - k) + b0 * k);
  };
  for (const nx of NEW_RULES) {
    for (let y = y0; y <= y1; y++) {
      put(nx, y, 1);
      put(nx - 1, y, 0.45);
      put(nx + 1, y, 0.45);
    }
  }

  ctx.putImageData(image, 0, 0);
  const buf = canvas.toBuffer('image/jpeg', 92);
  await writeFile(DST, buf);
  console.log(`已输出 ${DST}（${(buf.length / 1024).toFixed(0)} KB）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
