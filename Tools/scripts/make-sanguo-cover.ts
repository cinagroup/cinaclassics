// 生成 books/02 封面图（books/02/cover.jpg）：
//   宣纸底色 + 左上白签条双框 + 竖排书名「三國志通俗演義」与作者「明羅貫中撰」，
//   字体用素材仓库 fonts/qiji-combo.ttf（与正文同款刻本体）。
// 用法：npx tsx scripts/make-sanguo-cover.ts

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { resolveRepoRoot } from './repo.js';

const REPO = resolveRepoRoot();
const BOOK_DIR = path.join(REPO, 'books', '02');

async function main() {
  GlobalFonts.registerFromPath(path.join(REPO, 'fonts', 'qiji-combo.ttf'), 'qiji');

  const W = 2480;
  const H = 1860;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 宣纸底
  ctx.fillStyle = '#f2ead9';
  ctx.fillRect(0, 0, W, H);
  // 右侧界栏（与引擎无画布封面的装饰线一致）
  ctx.strokeStyle = '#e8dfc9';
  ctx.lineWidth = 4;
  for (const x of [W / 2 - 100, W / 2 + 100]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 400) {
    ctx.beginPath();
    ctx.moveTo(W / 2 - 100, y);
    ctx.lineTo(W / 2 + 100, y);
    ctx.stroke();
  }

  // 签条：白底黑双框
  const slipX = 140;
  const slipY = 90;
  const slipW = 560;
  const slipH = 1720;
  ctx.fillStyle = '#fdfcf8';
  ctx.fillRect(slipX, slipY, slipW, slipH);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 10;
  ctx.strokeRect(slipX + 30, slipY + 30, slipW - 60, slipH - 60);
  ctx.lineWidth = 3;
  ctx.strokeRect(slipX + 52, slipY + 52, slipW - 104, slipH - 104);

  // 书名（竖排，字间 1.15 倍）
  const title = '三國志通俗演義';
  const fs1 = 120;
  ctx.fillStyle = '#111';
  ctx.font = `${fs1}px qiji`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tx = slipX + slipW / 2;
  let ty = slipY + 170;
  for (const ch of title) {
    ctx.fillText(ch, tx, ty);
    ty += fs1 * 1.15;
  }

  // 作者（小字竖排，书名下留白接排）
  const author = '明羅貫中撰';
  const fs2 = 84;
  ctx.font = `${fs2}px qiji`;
  let ay = ty + 90;
  for (const ch of author) {
    ctx.fillText(ch, tx, ay);
    ay += fs2 * 1.2;
  }

  const jpg = await canvas.encode('jpeg', 92);
  const out = path.join(BOOK_DIR, 'cover.jpg');
  await writeFile(out, jpg);
  console.log(`已生成封面：${out}（${W}×${H}，${(jpg.length / 1024).toFixed(0)} KB）`);
}

main().catch((err) => {
  console.error('封面生成失败：', err);
  process.exit(1);
});
