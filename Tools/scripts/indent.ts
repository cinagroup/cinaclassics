// 整段缩进文本格式化 — indentxt.pl 通用核心的 TS 移植（书籍预处理工具，本地使用）
//
// 原版为 book 01 定制（含年号提示、卷末插入等 hack，未移植）；此处保留通用核心：
// 行首 Sn 标识（n 为一至两位数字：首位=首列缩进字数，次位=后续列缩进字数），
// 将该段文本按列高重排，使每列列首补足缩进空格（@），夹批跨列时用 】【 重新括起。
//
// 用法：npx tsx scripts/indent.ts --book 01 --shelf books --from 1 --to 2
//   读取 books/01/tmp/<N>.txt，写出 books/01/text/<N>.txt

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseCfg, splitPipeList } from '../src/engine/cfg.js';
import { buildRules } from '../src/engine/text.js';
import { resolveRepoRoot } from './repo.js';

const REPO_ROOT = resolveRepoRoot();

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};

async function main() {
  const bookId = arg('book', '01')!;
  const shelf = arg('shelf', 'books')!;
  const from = parseInt(arg('from', '1')!, 10);
  const to = parseInt(arg('to', '1')!, 10);
  const bookDir = path.join(REPO_ROOT, shelf, bookId);

  const cfg = parseCfg(await readFile(path.join(bookDir, 'book.cfg'), 'utf8'));
  const rowNum = Number(cfg['row_num']);

  // 不占位标点集（含按标记开关追加的符号，与 indentxt.pl 一致）
  const extraNop: string[] = [];
  const on = (k: string) => cfg[k] === '1';
  if (on('if_tag_bookline')) extraNop.push('《', '》');
  if (on('if_tag_rectframe')) extraNop.push('〔', '〕');
  if (on('if_tag_circleframe')) extraNop.push('〈', '〉');
  if (on('if_tag_textzoom')) extraNop.push('（', '）');
  if (on('if_tag_circlenote')) extraNop.push('｛', '｝');
  if (on('if_tag_pointnote')) extraNop.push('＜', '＞');
  if (on('if_tag_linenote')) extraNop.push('［', '］');
  const rules = buildRules(cfg, extraNop);

  const replaceComma = splitPipeList(cfg['exp_replace_comma'] ?? '')
    .filter((kv) => kv.length >= 2).map((kv) => [kv[0], kv[1]] as [string, string]);
  const replaceNumber = splitPipeList(cfg['exp_replace_number'] ?? '')
    .filter((kv) => kv.length >= 2).map((kv) => [kv[0], kv[1]] as [string, string]);
  const deleteSet = new Set(splitPipeList(cfg['exp_delete_comma'] ?? ''));
  const noCommaSet = new Set(splitPipeList(cfg['exp_nocomma'] ?? ''));
  const onlyPeriodSet = new Set(splitPipeList(cfg['exp_onlyperiod'] ?? ''));
  const ifNoComma = cfg['if_nocomma'] === '1';
  const ifOnlyPeriod = cfg['if_onlyperiod'] === '1';

  const textDir = path.join(bookDir, 'text');
  await mkdir(textDir, { recursive: true });

  for (let pid = from; pid <= to; pid++) {
    const content = await readFile(path.join(bookDir, 'tmp', `${pid}.txt`), 'utf8');
    let out = '';

    for (const rawLine of content.split(/\r?\n/)) {
      let s = rawLine;
      if (s.trim() === '') continue;
      s = s.replace(/\s/g, '');
      // 标点/数字替换、删除、归一化（与排版前处理一致）
      for (const [k, v] of replaceComma) s = s.split(k).join(v);
      if (!/^S\d/u.test(s)) {
        for (const [k, v] of replaceNumber) s = s.split(k).join(v);
      }
      if (deleteSet.size > 0) s = [...s].filter((ch) => !deleteSet.has(ch)).join('');
      if (ifNoComma && noCommaSet.size > 0) {
        s = [...s].filter((ch) => !noCommaSet.has(ch)).join('');
      }
      if (ifOnlyPeriod) {
        s = [...s].map((ch) => (onlyPeriodSet.has(ch) ? '。' : ch)).join('');
        s = s.replace(/。+/g, '。');
        s = s.replace(/^。/, '');
        s = s.split('〕。').join('〕');
      }

      // S 缩进重排（indentxt.pl 通用核心）
      const m = s.match(/^S(\d+)(.*)$/u);
      if (m) {
        const sns = m[1];
        const sn1 = Number(sns[0]);
        const sn2 = sns.length > 1 ? Number(sns[1]) : 0;
        const lchars = [...m[2]];
        const nchars: string[] = [];
        let flflag = 1; // 首列标识
        let rflag = 0; // 夹批标识
        let cnt = 0; // 列字数计数器（夹批按 0.5 计）

        while (lchars.length > 0) {
          const lchar = lchars.shift() as string;
          const snum = flflag === 1 ? sn1 : sn2;
          if (lchar === '【') {
            nchars.push(lchar);
            rflag = 1;
            cnt = Math.trunc(cnt + 0.5);
            continue;
          }
          if (lchar === '】') {
            nchars.push(lchar);
            rflag = 0;
            continue;
          }
          if (rules.textNopSet.has(lchar) || rules.commentNopSet.has(lchar)) {
            nchars.push(lchar);
            continue;
          }
          if (rflag === 0) {
            cnt = Math.trunc(cnt + 0.5) + 1; // 正文字符：计数器向上取整进位
            if (cnt === 1) {
              nchars.push('@'.repeat(snum) + lchar); // 列首缩进
            } else if (cnt <= rowNum - snum) {
              nchars.push(lchar);
            } else {
              lchars.unshift(lchar); // 放回，下一列重排
              flflag = 0;
              cnt = 0;
            }
          } else {
            cnt += 0.5; // 夹批字符
            if (cnt === 0.5) {
              nchars.push('@@'.repeat(snum) + '】【' + lchar); // 列首缩进并重新括起夹批
            } else if (Math.trunc(cnt + 0.5) <= rowNum - snum) {
              nchars.push(lchar);
            } else {
              lchars.unshift(lchar);
              flflag = 0;
              cnt = 0;
            }
          }
        }
        s = nchars.join('');
      }
      out += `${s}\n`;
    }

    await writeFile(path.join(textDir, `${pid}.txt`), out);
    console.log(`tmp/${pid}.txt -> text/${pid}.txt`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
