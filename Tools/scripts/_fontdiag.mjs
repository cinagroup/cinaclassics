// 诊断 v3：FontDescriptor → FontFile2 → 解压 → 表结构
import fs from 'node:fs';
import zlib from 'node:zlib';
import { PDFDocument, PDFName, PDFRawStream, PDFDict } from 'pdf-lib';

const pdfPath = process.argv[2] ?? 'out/《后汉书》百二十卷.pdf';
const bytes = fs.readFileSync(pdfPath);
const doc = await PDFDocument.load(bytes, { updateMetadata: false });

fs.mkdirSync('out/fontdiag', { recursive: true });

const isDict = (o) => o instanceof PDFDict;
for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
  if (!isDict(obj)) continue;
  if (obj.get(PDFName.of('Type'))?.toString?.() !== '/FontDescriptor') continue;
  const fontName = obj.get(PDFName.of('FontName'))?.toString?.() ?? 'Unknown';
  const ffRef = obj.get(PDFName.of('FontFile2'));
  if (!ffRef) { console.log(fontName, ': 无 FontFile2'); continue; }
  const stream = doc.context.lookup(ffRef);
  if (!(stream instanceof PDFRawStream)) { console.log(fontName, ': FontFile2 非流'); continue; }
  let data = Buffer.from(stream.contents);
  const filter = stream.dict.get(PDFName.of('Filter'))?.toString?.() ?? '';
  if (filter.includes('FlateDecode')) data = zlib.inflateSync(data);
  const tag = fontName.replace(/[^\w.-]/g, '_');
  fs.writeFileSync(`out/fontdiag/${tag}.ttf`, data);
  // 表结构
  const n = data.readUInt16BE(4);
  const tabs = [];
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    tabs.push(data.toString('ascii', o, o + 4) + ':' + data.readUInt32BE(o + 12));
  }
  console.log(`${fontName} | 解压后 ${data.length}B | 表: ${tabs.join(' ')}`);
}
console.log('提取目录: out/fontdiag');
