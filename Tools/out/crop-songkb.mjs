// 裁剪 PNG：node out/crop-songkb.mjs <png> <x0> <y0> <x1> <y1> <out>
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const [src, x0, y0, x1, y1, dst] = process.argv.slice(2);
const png = PNG.sync.read(readFileSync(src));
const w = +x1 - +x0, h = +y1 - +y0;
const out = new PNG({ width: w, height: h });
PNG.bitblt(png, out, +x0, +y0, w, h, 0, 0);
writeFileSync(dst, PNG.sync.write(out));
console.log(`${dst}: ${w}x${h}`);
