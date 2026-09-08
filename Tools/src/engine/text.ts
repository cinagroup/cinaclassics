// 文本预处理 — 等价 vrain.pl 读入 text/*.txt 的逐行处理与段落补齐逻辑

import { splitPipeList } from './cfg.js';

export interface TextPrepRules {
  /** 标点替换规则 a→b */
  replaceComma: [string, string][];
  /** 数字替换规则 */
  replaceNumber: [string, string][];
  /** 正则删除字符集（如 ．-─〖〗 等） */
  deleteComma: Set<string>;
  /** 无标点模式：过滤的标点 */
  noComma: Set<string>;
  ifNoComma: boolean;
  /** 标点归一化：归一为句号的标点 */
  onlyPeriod: Set<string>;
  ifOnlyPeriod: boolean;
  /** 正文/批注中不占字符位的标点（含特殊标记符号） */
  textNopSet: Set<string>;
  commentNopSet: Set<string>;
}

export function buildRules(cfg: {
  exp_replace_comma?: string;
  exp_replace_number?: string;
  exp_delete_comma?: string;
  if_nocomma?: string;
  exp_nocomma?: string;
  if_onlyperiod?: string;
  exp_onlyperiod?: string;
  text_comma_nop?: string;
  comment_comma_nop?: string;
}, extraNop: string[]): TextPrepRules {
  const pair = (s?: string): [string, string][] =>
    splitPipeList(s ?? '')
      .filter((kv) => kv.length >= 2)
      .map((kv) => [kv[0], kv[1]] as [string, string]);

  return {
    replaceComma: pair(cfg.exp_replace_comma),
    replaceNumber: pair(cfg.exp_replace_number),
    deleteComma: new Set(splitPipeList(cfg.exp_delete_comma ?? '')),
    noComma: new Set(splitPipeList(cfg.exp_nocomma ?? '')),
    ifNoComma: cfg.if_nocomma === '1',
    onlyPeriod: new Set(splitPipeList(cfg.exp_onlyperiod ?? '')),
    ifOnlyPeriod: cfg.if_onlyperiod === '1',
    textNopSet: new Set([
      ...splitPipeList(cfg.text_comma_nop ?? ''),
      ...extraNop,
    ]),
    commentNopSet: new Set([
      ...splitPipeList(cfg.comment_comma_nop ?? ''),
      ...extraNop,
    ]),
  };
}

/**
 * 读入一个文本文件内容，返回拼装好的 dat 字符串
 * （含全部标记与补齐空格，供排版主循环逐字消费）。
 * rowNum 为当前（多栏模式下已折算的）每列字数。
 * opts.stripBookMarks：mr 版 if_book_vline=1 时，计数副本额外去除《》
 * opts.stripT：主版去除行首 T 标记及其后 1 字（mr 版无此标记，传 false）
 */
export function prepareText(
  content: string,
  rowNum: number,
  rules: TextPrepRules,
  opts?: { stripBookMarks?: boolean; stripT?: boolean },
): string {
  let dat = '';
  for (const rawLine of content.split(/\r?\n/)) {
    let s = rawLine;
    if (s.trim() === '') continue;
    s = s.replace(/\s/g, '');

    // 标点替换 / 数字替换
    for (const [k, v] of rules.replaceComma) s = s.split(k).join(v);
    for (const [k, v] of rules.replaceNumber) s = s.split(k).join(v);

    // 标点删除
    if (rules.deleteComma.size > 0) {
      s = [...s].filter((ch) => !rules.deleteComma.has(ch)).join('');
    }
    // 无标点模式
    if (rules.ifNoComma && rules.noComma.size > 0) {
      s = [...s].filter((ch) => !rules.noComma.has(ch)).join('');
    }
    // 标点归一化为句读
    if (rules.ifOnlyPeriod) {
      s = [...s].map((ch) => (rules.onlyPeriod.has(ch) ? '。' : ch)).join('');
      s = s.replace(/。+/g, '。');
      s = s.replace(/^。/, '');
    }
    // @ 代表空格
    s = s.split('@').join(' ');

    const tmpstr = s; // 保留完整文本（打印用）
    let rnum = 0; // 夹批双排占用的正文位数

    // 计数用副本：去掉 T 标记及其后 1 字（顶格处理中该字上移一位；仅主版）
    if (opts?.stripT !== false) s = s.replace(/^T.{1}/u, '');
    // 去掉不占字符位标点（含特殊标记符号）
    if (rules.textNopSet.size > 0) {
      s = [...s].filter((ch) => !rules.textNopSet.has(ch)).join('');
    }
    if (rules.commentNopSet.size > 0) {
      s = [...s].filter((ch) => !rules.commentNopSet.has(ch)).join('');
    }
    if (opts?.stripBookMarks) {
      s = s.split('《').join('').split('》').join('');
    }
    // 夹批双排计数：逐个标注取半，奇数向上取整
    for (const m of s.matchAll(/【(.*?)】/gu)) {
      const len = [...m[1]].length;
      rnum += len % 2 === 0 ? len / 2 : Math.trunc(len / 2) + 1;
    }
    s = s.replace(/【.*?】/gu, '');

    const chars = [...s];
    const total = chars.length + rnum;
    // 段落末尾补齐至列高整数倍
    const spacesNum = rowNum - total + Math.trunc(total / rowNum) * rowNum;
    dat += tmpstr;
    if (spacesNum > 0 && spacesNum < rowNum) dat += ' '.repeat(spacesNum);
  }
  return dat;
}
