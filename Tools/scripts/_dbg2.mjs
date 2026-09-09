import fs from 'node:fs';
const raw = fs.readFileSync('E:/cinagroup/cinaclassics/史藏/正史/汉书.md', 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/);
for (const idx of [25, 37]) {
  const s = lines[idx];
  console.log('行', idx + 1, '长度', s.length, JSON.stringify(s));
  const codes = [];
  for (const ch of s) codes.push(ch.codePointAt(0).toString(16));
  console.log('  码点:', codes.join(' '));
  const NUM = '[一二三四五六七八九十百零中上下]';
  const re = new RegExp('^卷(' + NUM + '+)[　\\s]+(.+)$');
  console.log('  匹配:', re.test(s));
}
