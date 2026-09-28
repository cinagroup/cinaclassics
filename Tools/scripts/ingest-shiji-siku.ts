// 《史记》（钦定四库全书本）入库脚本：
//   从库文本（史藏/正史/史记四库.md）生成素材仓库 books/06：
//   text/00.md（总目）+ 001..130.md（卷一..卷一百三十，各卷含卷末考证）及 book.cfg。
//   每卷结构 = 「史记卷N」题记 + 撰注人署名行 + 篇名 + 正文（【】集解/索隐/正义为夹批）
//           + 卷末「史记卷N考证」。文本标记 = 「（卷N@篇名）」（缩放标题，同后汉书例）。
//   源文本为逐页 OCR：行边界多为页界而非段界，故各卷正文并为一股连续排版；
//   页面残迹（钦定四库全书 / <史部,…> / 卷末重复题记与考证头 / 空页行）剔除；
//   撰注人署名行 OCR 常并行或换行不一，按行尾「撰/集解(觧)/索隠(隐)/正义」特征吸收。
//   卷起识别双轨：优先「史记卷N」题记且次行为署名行；OCR 缺失题记的卷以正文首行
//   篇名锚点补齐（篇名序数按部类换算卷号：本纪N/表N+12/书N+22/世家N+30/列传N+60）。
//   中文数值比较容忍「史纪」「巻」「一百十一／一百一十一」等异写。
//
// 用法：npx tsx scripts/ingest-shiji-siku.ts [库文本路径]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ZH_NUMS } from '../src/engine/zhnum-data.js';
import { resolveRepoRoot } from './repo.js';

const SRC = process.argv[2] ?? 'E:/cinagroup/cinaclassics/史藏/正史/史记四库.md';
const REPO = resolveRepoRoot();
const BOOK_DIR = path.join(REPO, 'books', '06');
const TEXT_DIR = path.join(BOOK_DIR, 'text');

const CRLF = '\r\n';
const strip = (l: string) => l.replace(/[\s　]/g, '');
const JUAN_RE = /^史[记纪][卷巻]([一二三四五六七八九十百零]+)$/;
const KAOZHENG_RE = /^史[记纪][卷巻]([一二三四五六七八九十百零]+)考证$/;
const BIAOM_RE = /^([^【】]{1,12})(本纪|表|书|世家|列传)(第[一二三四五六七八九十百]+)$/;
const SEC_OFFSET: Record<string, number> = { 本纪: 0, 表: 12, 书: 22, 世家: 30, 列传: 60 };

function cnVal(s: string): number {
  let total = 0, num = 0;
  const M: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  for (const ch of s) {
    if (M[ch]) num = M[ch];
    else if (ch === '十') total += (num || 1) * 10, num = 0;
    else if (ch === '百') total += (num || 1) * 100, num = 0;
    else if (ch === '零') num = 0;
  }
  return total + num;
}

const isArtifact = (s: string) => s === '钦定四库全书' || /^<史部.*>$/.test(s);

/** 撰注人署名行：行尾为 撰/集解/索隠/正义 且无夹批括号（OCR 可能两行并一行） */
const isCredit = (s: string) =>
  s.length > 0 && s.length <= 40 && !s.includes('【') && !s.includes('】')
  && /(撰|集[解觧]|索[隠隐]|正义)$/.test(s);

async function main() {
  const raw = (await readFile(SRC, 'utf8')).replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/);
  const N = lines.length;
  const nextNonEmpty = (n: number) => {
    for (let j = n + 1; j < N; j++) if (strip(lines[j]) !== '') return j;
    return -1;
  };

  // ---------- 正文起点：首个后跟署名行的「史记卷一」 ----------
  let bodyStart = -1;
  for (let n = 300; n < N; n++) {
    if (strip(lines[n]) !== '史记卷一') continue;
    const j = nextNonEmpty(n);
    if (j >= 0 && isCredit(strip(lines[j]))) { bodyStart = n; break; }
  }
  if (bodyStart < 0) throw new Error('未找到正文首卷标记');

  // ---------- 卷起识别：题记标记（次行为署名行）----------
  const startOf = new Map<number, number>(); // 卷号 → 起始行
  const anomalies: string[] = [];
  for (let n = bodyStart; n < N; n++) {
    const s = strip(lines[n]);
    const m = s.match(JUAN_RE);
    if (!m) continue;
    const j = nextNonEmpty(n);
    if (j < 0 || !isCredit(strip(lines[j]))) continue; // 卷末重复题记等
    const v = cnVal(m[1]);
    if (startOf.has(v)) anomalies.push(`L${n + 1}:${s}（重复）`);
    else startOf.set(v, n);
  }

  // ---------- 篇名锚点补齐：题记缺失的卷 ----------
  for (let v = 1; v <= 130; v++) {
    if (startOf.has(v)) continue;
    const from = v > 1 && startOf.has(v - 1) ? startOf.get(v - 1)! : bodyStart;
    let to = N;
    for (const [w, ln] of startOf) if (ln > from && ln < to) to = ln;
    let hit = -1;
    for (let n = from + 1; n < to; n++) {
      const m = strip(lines[n]).match(BIAOM_RE);
      if (m && SEC_OFFSET[m[2]] + cnVal(m[3].slice(1)) === v) { hit = n; break; }
    }
    if (hit < 0) throw new Error(`卷${v}：题记与篇名锚点均缺失`);
    startOf.set(v, hit);
    anomalies.push(`卷${v}：题记缺失，以篇名锚点 L${hit + 1} 补齐`);
  }
  if (anomalies.length) console.log(`提示 ${anomalies.length} 条：\n  ` + anomalies.join('\n  '));

  // ---------- 逐卷整理 ----------
  interface Juan { juan: number; title: string; credits: string; body: string; kz: string }
  const juans: Juan[] = [];
  const warnings: string[] = [];
  const startsSorted = [...startOf.entries()].sort((a, b) => a[1] - b[1]);
  for (let si = 0; si < startsSorted.length; si++) {
    const [juan, start] = startsSorted[si];
    const end = si + 1 < startsSorted.length ? startsSorted[si + 1][1] : N;

    let n = start + 1;
    // 署名行（汉太史令司马迁撰／裴骃集解／司马贞索隐／张守节正义，OCR 或并行）
    const creditList: string[] = [];
    while (n < end) {
      const s = strip(lines[n]);
      if (s === '') { n++; continue; }
      if (isCredit(s) && creditList.length < 6) { creditList.push(s); n++; continue; }
      break;
    }
    if (!creditList.length) warnings.push(`卷${juan}：未识别署名行`);

    // 篇名（题记在卷则以次行充任；锚点在卷则锚点行即篇名）；
    // 署名行 OCR 有不带注体后缀者（如「…张守节」），篇名位遇之则并入署名顺延
    let title = '';
    if (strip(lines[start]).match(BIAOM_RE)) {
      title = strip(lines[start]);
    } else {
      for (;;) {
        while (n < end && strip(lines[n]) === '') n++;
        const cand = strip(lines[n] ?? '');
        if (cand && !cand.includes('【') && /(撰|集[解觧]|索[隠隐]|正义|守节)$/.test(cand) && cand.length <= 40) {
          creditList.push(cand);
          n++;
          continue;
        }
        title = cand;
        n++;
        break;
      }
    }
    if (!title || title.includes('【')) throw new Error(`卷${juan}：篇名异常「${title}」`);

    // 正文 + 卷末考证（考证头保留首见，余为页界重复，剔除）
    const bodyParts: string[] = [];
    const kzParts: string[] = [];
    let kzSeen = false;
    let inKz = false;
    for (; n < end; n++) {
      const s = strip(lines[n]);
      if (s === '' || isArtifact(s)) continue;
      const mk = s.match(JUAN_RE);
      if (mk && cnVal(mk[1]) === juan) continue; // 卷末重复题记
      const kz = s.match(KAOZHENG_RE);
      if (kz) {
        const kv = cnVal(kz[1]);
        if (kv !== juan) { warnings.push(`卷${juan}：他卷考证头 L${n + 1}「${s}」`); continue; }
        if (!kzSeen) {
          kzSeen = true;
          inKz = true;
          kzParts.push(`史记卷${ZH_NUMS[String(juan)]}考证`);
        }
        continue;
      }
      (inKz ? kzParts : bodyParts).push(s);
    }
    if (!kzSeen) warnings.push(`卷${juan}：未见卷末考证`);
    juans.push({
      juan,
      title,
      credits: creditList.join(''),
      body: bodyParts.join(''),
      kz: kzParts.join(''),
    });
  }
  juans.sort((a, b) => a.juan - b.juan);
  const empty = juans.filter((j) => !j.body);
  if (empty.length) throw new Error(`空卷：${empty.map((j) => j.juan).join('、')}`);

  // ---------- 输出 ----------
  await mkdir(TEXT_DIR, { recursive: true });
  const files: Array<[string, string]> = [];
  files.push(['00.md', `（史记总目）` + CRLF + CRLF
    + juans.map((e) => `卷${ZH_NUMS[String(e.juan)]}@${e.title}`).join(CRLF) + CRLF]);
  for (const j of juans) {
    const paras = [
      `（卷${ZH_NUMS[String(j.juan)]}@${j.title}）`,
      j.credits,
      j.body,
      ...(j.kz ? [j.kz] : []),
    ].filter((p) => p);
    files.push([`${String(j.juan).padStart(3, '0')}.md`, paras.join(CRLF + CRLF) + CRLF]);
  }
  for (const [name, content] of files) {
    await writeFile(path.join(TEXT_DIR, name), content, 'utf8');
  }

  // book.cfg：复制 books/05 配置，改书名/作者
  const tpl = await readFile(path.join(REPO, 'books', '05', 'book.cfg'), 'utf8');
  const cfg = tpl
    .replace(/^title=.*$/m, 'title=史记')
    .replace(/^author=.*$/m, 'author=汉司马迁');
  await writeFile(path.join(BOOK_DIR, 'book.cfg'), cfg, 'utf8');

  if (warnings.length) console.log(`警告 ${warnings.length} 条：\n  ` + warnings.join('\n  '));
  console.log(`完成：${juans.length} 卷（含卷末考证 ${juans.filter((j) => j.kz).length} 卷）`);
  console.log(`输出：${TEXT_DIR}（00.md + 001..130.md）与 book.cfg`);
  console.log(`排版调用：--book 06 --from 1 --to 131（00=总目，001..130=卷一..卷一百三十）`);
}

main().catch((err) => {
  console.error('入库失败：', err);
  process.exit(1);
});
