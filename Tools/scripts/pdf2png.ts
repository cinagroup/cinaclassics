// 将 PDF 渲染为 PNG（用于排版结果与样张的视觉对照）
// 用法：npx tsx scripts/pdf2png.ts --pdf <path> --out <dir> [--pages 1,2,3] [--scale 0.5]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { PNG } from 'pngjs';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

async function main() {
  const pdfPath = arg('pdf');
  const outDir = arg('out', 'out/png');
  const scale = parseFloat(arg('scale', '0.5')!);
  const pagesArg = arg('pages');
  const pageList = pagesArg ? pagesArg.split(',').map((s) => parseInt(s, 10)) : null;
  if (!pdfPath) throw new Error('缺少 --pdf');

  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = await import('node:fs/promises').then((fs) => fs.readFile(pdfPath));
  const doc = await getDocument({
    data: new Uint8Array(data),
    useSystemFonts: false,
    standardFontDataUrl: undefined,
  }).promise;

  await mkdir(outDir, { recursive: true });
  const total = pageList ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);
  for (const p of total) {
    if (p < 1 || p > doc.numPages) continue;
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale });
    const w = Math.floor(viewport.width);
    const h = Math.floor(viewport.height);
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      canvas,
    } as never).promise;

    const png = new PNG({ width: w, height: h });
    const imgData = ctx.getImageData(0, 0, w, h);
    png.data.set(imgData.data);
    const buf = PNG.sync.write(png);
    const name = `${path.basename(pdfPath, '.pdf')}-p${String(p).padStart(2, '0')}.png`;
    await writeFile(path.join(outDir, name), buf);
    console.log(`page ${p}/${doc.numPages} -> ${path.join(outDir, name)} (${w}x${h})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
