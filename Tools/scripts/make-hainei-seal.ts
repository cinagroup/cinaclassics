// 生成「海内典籍」藏版印并烙入书叶画布（canvas/<id>.jpg）：
//   白文竖排四字、赭红底 #8d493a、圆角残边，6 倍超采样绘制后缩放烙入。
// 用法：npx tsx scripts/make-hainei-seal.ts --canvas canvas/<id>.jpg --x 1259 --y 1680 --w 21 --h 123
//   各画布原兀雨印位：24_black_blank 1259,1680,21,123 | 24_black/18_red 1259,1680,21,124
//   mr_4/mr_5/28_paper 1253,1680,24,128 | 24_paper 1257,1680,23,126 | iphone15pm 1408,1110,24,124

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { resolveRepoRoot } from './repo.js';

const REPO = resolveRepoRoot();

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

// 印面规格（画布坐标系）
const SEAL = {
  x: parseInt(arg('x', '1259')!, 10),
  y: parseInt(arg('y', '1680')!, 10),
  w: parseInt(arg('w', '21')!, 10),
  h: parseInt(arg('h', '123')!, 10),
  color: '#8d493a',
};
const CANVAS_PATH = path.resolve(REPO, 'canvas', arg('canvas', '24_black_blank.jpg')!);
const TEXT = '海内典籍';
const SS = 6; // 超采样倍率

// 可复现伪随机（残边形状固定，重跑不漂移）
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** 在 6 倍超采样画布上绘制印章，返回带透明背景的印章位图 */
function drawSeal(): ReturnType<typeof createCanvas> {
  const w = SEAL.w * SS;
  const h = SEAL.h * SS;
  const cv = createCanvas(w, h);
  const ctx = cv.getContext('2d');

  // 印底：圆角矩形
  const r = 4 * SS;
  ctx.fillStyle = SEAL.color;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, h, r);
  ctx.fill();

  // 白文：四字竖排均布
  const n = TEXT.length;
  const padY = h * 0.075;
  const cell = (h - padY * 2) / n;
  const fs = Math.min(cell * 0.96, w * 0.94);
  ctx.fillStyle = '#f6efe7';
  ctx.font = `${fs}px qiji`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    ctx.fillText(TEXT[i], w / 2, padY + cell * (i + 0.5));
  }

  // 残边：沿四边随机剜去小豁口（模拟钤印磨损）
  const rand = rng(20260908);
  ctx.globalCompositeOperation = 'destination-out';
  const notches = 26;
  for (let i = 0; i < notches; i++) {
    const edge = i % 4;
    const t = rand();
    const rr = (0.6 + rand() * 1.6) * SS;
    let cx: number, cy: number;
    if (edge === 0) { cx = t * w; cy = 0; }        // 上
    else if (edge === 1) { cx = w; cy = t * h; }   // 右
    else if (edge === 2) { cx = t * w; cy = h; }   // 下
    else { cx = 0; cy = t * h; }                   // 左
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.fill();
  }
  // 印面斑驳：随机细小剔白
  for (let i = 0; i < 14; i++) {
    const cx = (0.15 + rand() * 0.7) * w;
    const cy = (0.06 + rand() * 0.88) * h;
    ctx.beginPath();
    ctx.arc(cx, cy, (0.3 + rand() * 0.7) * SS, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  return cv;
}

async function main() {
  // 字体注册（印章文字与正文同源：启功体）
  const { GlobalFonts } = await import('@napi-rs/canvas');
  GlobalFonts.registerFromPath(path.join(REPO, 'fonts', 'qiji-combo.ttf'), 'qiji');

  const seal = drawSeal();

  const img = await loadImage(CANVAS_PATH);
  const cv = createCanvas(img.width, img.height);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0);
  ctx.drawImage(seal, SEAL.x, SEAL.y, SEAL.w, SEAL.h);

  const jpg = await cv.encode('jpeg', 92);
  await writeFile(CANVAS_PATH, jpg);
  console.log(`已烙入「${TEXT}」印：${CANVAS_PATH}（印面 ${SEAL.w}×${SEAL.h} @ ${SEAL.x},${SEAL.y}，${(jpg.length / 1024).toFixed(0)} KB）`);

  // 复核裁剪图
  const check = createCanvas(SEAL.w * 12, SEAL.h * 12);
  const cctx = check.getContext('2d');
  cctx.imageSmoothingEnabled = true;
  cctx.drawImage(cv, SEAL.x - 8, SEAL.y - 12, SEAL.w + 16, SEAL.h + 24, 0, 0, check.width, check.height);
  const checkName = 'out/hainei-seal-check-' + path.basename(CANVAS_PATH, '.jpg') + '.png';
  await writeFile(checkName, check.toBuffer('image/png'));
  console.log('复核图：' + checkName);
}

main().catch((err) => {
  console.error('印章合成失败：', err);
  process.exit(1);
});
