import fs from 'node:fs';
const raw = fs.readFileSync('E:/cinagroup/cinaclassics/史藏/正史/汉书.md', 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/);
const NUM = '[一二三四五六七八九十百零中上下]';
const re = new RegExp('^卷(' + NUM + '+)[　\\s]+(.+)$');
console.log('正则源:', re.source);
let pass = 0, fail = 0;
const fails = [];
for (let i = 4; i < 124; i++) {
  const s = lines[i].trim();
  if (re.test(s)) pass++;
  else { fail++; if (fails.length < 5) fails.push((i + 1) + ':' + s.slice(0, 30)); }
}
console.log('目录匹配:', pass, '不匹配:', fail, fails.join(' | '));
