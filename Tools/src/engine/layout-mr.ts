// 多栏排版引擎 — vrain_mr.pl 的忠实 TS 移植（books_mr：族谱/字典等多横栏版式）
//
// 与 vrain.pl 主版的差异（均已按原版保留）：
//   - '^' 标记：多栏模式下跳转到下一栏
//   - '%' 恒为整页换页（无半页判断）
//   - try_st：字体不支持时尝试简繁转换（原版两书均关闭；转换器未随引擎内置）
//   - onlyperiod_color：归一化句号的着色
//   - if_tpcenter：版心标题/页码居左（0）或居中（1）
//   - if_book_vline：《》转直线侧标（1 时跳过书名号本身；0 时书名号作为普通字符绘制）
//   - 无标记系统/顶格/波浪线/度量微调/回退加粗；批注无圆框方框与拉丁旋转
//   - 简易封面样式不同（无底色填充、#cccccc 细线、gray 粗线）
//   - 版心页码纵向间距用 title_ydis（主版固定 1.1）
//   - 列末标点 y 微调为 margins_bottom+10（主版 +5）

import { AssetSource } from './assets.js';
import { charSet, flag, num, parseCfg, RawCfg, str } from './cfg.js';
import { FontSet } from './fonts.js';
import { buildRules, prepareText } from './text.js';
import { LayoutResult, Op, PageOps } from './types.js';
import { ZH_NUMS } from './zhnum-data.js';

export interface LayoutMrOptions {
  bookId: string;
  from?: number;
  to?: number;
  maxPages?: number;
  debugBlue?: boolean;
}

const trunc = Math.trunc;

export async function runLayoutMr(
  assets: AssetSource,
  fonts: FontSet,
  opts: LayoutMrOptions,
): Promise<LayoutResult> {
  const bookId = opts.bookId;
  const from = opts.from ?? 1;
  const to = opts.to ?? 1;
  const maxPages = opts.maxPages;
  const debugBlue = opts.debugBlue ?? Boolean(maxPages);

  // ---------- 配置 ----------
  const bookRawTxt = await assets.readText(`books_mr/${bookId}/book.cfg`);
  if (bookRawTxt === null) throw new Error(`未发现书籍排版配置文件 books_mr/${bookId}/book.cfg`);
  const book: RawCfg = parseCfg(bookRawTxt);

  const canvasId = str(book, 'canvas_id');
  if (!canvasId) throw new Error("未定义背景图ID 'canvas_id'");
  const canvasRawTxt = await assets.readText(`canvas/${canvasId}.cfg`);
  if (canvasRawTxt === null) throw new Error(`未发现背景图cfg配置文件 canvas/${canvasId}.cfg`);
  const canvas: RawCfg = parseCfg(canvasRawTxt);

  const title = str(book, 'title');
  const author = str(book, 'author');
  let rowNum = num(book, 'row_num');
  const rowDeltaY = num(book, 'row_delta_y');

  const fontSlots = [1, 2, 3, 4, 5].map((i) => str(book, `font${i}`)).filter((n) => n !== '');
  interface FontParam { textSize: number; commSize: number; rotate: number }
  const fontParam: Record<string, FontParam> = {};
  for (const slot of [1, 2, 3, 4, 5]) {
    const fn = str(book, `font${slot}`);
    if (!fn) continue;
    fontParam[fn] = {
      textSize: num(book, `text_font${slot}_size`),
      commSize: num(book, `comment_font${slot}_size`),
      rotate: num(book, `font${slot}_rotate`),
    };
  }
  const fn1 = fontSlots[0];
  if (!fn1) throw new Error("主字体'font1'未定义");

  const fontsOrder = [1, 2, 3, 4, 5].map((i) => str(book, `font${i}`));
  const tfns = [...str(book, 'text_fonts_array')]
    .map((d) => fontsOrder[Number(d) - 1])
    .filter((f): f is string => Boolean(f));
  const cfns = [...str(book, 'comment_fonts_array')]
    .map((d) => fontsOrder[Number(d) - 1])
    .filter((f): f is string => Boolean(f));
  const allFns = fontsOrder.filter((f): f is string => Boolean(f));

  const trySt = flag(book, 'try_st'); // 简繁转换（原版两书均关闭；转换器未内置，此处仅保留开关语义）

  const textFontColor = str(book, 'text_font_color', 'black');
  const commentFontColor = str(book, 'comment_font_color', 'black');
  const coverTitleFontSize = num(book, 'cover_title_font_size');
  const coverTitleY = num(book, 'cover_title_y');
  const coverAuthorFontSize = num(book, 'cover_author_font_size');
  const coverAuthorY = num(book, 'cover_author_y');
  const coverFontColor = str(book, 'cover_font_color', 'black');
  const titlePostfixDefined = 'title_postfix' in book;
  const titlePostfix = str(book, 'title_postfix');
  const titleDirectory = flag(book, 'title_directory');
  const ifTpcenter = num(book, 'if_tpcenter', 1); // 0 = 居左
  const titleFontSize = num(book, 'title_font_size');
  const titleFontColor = str(book, 'title_font_color', 'black');
  const titleY = num(book, 'title_y');
  const titleYdis = num(book, 'title_ydis', 1);
  const pagerFontSize = num(book, 'pager_font_size');
  const pagerFontColor = str(book, 'pager_font_color', 'black');
  const pagerY = num(book, 'pager_y');
  const onlyperiodColor = str(book, 'onlyperiod_color'); // 归一化句号颜色（空则用正文色）
  const ifOnlyPeriod = flag(book, 'if_onlyperiod');

  const ifBookVline = num(book, 'if_book_vline');
  const blineW = num(book, 'book_line_width', 1);
  const blineC = str(book, 'book_line_color', 'black');

  const textCommaNopSize = num(book, 'text_comma_nop_size', 1);
  const textCommaNopX = num(book, 'text_comma_nop_x');
  const textCommaNopY = num(book, 'text_comma_nop_y');
  const textComma90Size = num(book, 'text_comma_90_size', 1);
  const textComma90X = num(book, 'text_comma_90_x');
  const textComma90Y = num(book, 'text_comma_90_y');
  const commentCommaNopSize = num(book, 'comment_comma_nop_size', 1);
  const commentCommaNopX = num(book, 'comment_comma_nop_x');
  const commentCommaNopY = num(book, 'comment_comma_nop_y');
  const commentComma90Size = num(book, 'comment_comma_90_size', 1);
  const commentComma90X = num(book, 'comment_comma_90_x');
  const commentComma90Y = num(book, 'comment_comma_90_y');

  const rules = buildRules(book, []);
  const textNopSet = rules.textNopSet;
  const commentNopSet = rules.commentNopSet;
  const textComma90Set = charSet(str(book, 'text_comma_90'));
  const commentComma90Set = charSet(str(book, 'comment_comma_90'));

  const W = num(canvas, 'canvas_width');
  const H = num(canvas, 'canvas_height');
  const marginTop = num(canvas, 'margins_top');
  const marginBottom = num(canvas, 'margins_bottom');
  const marginRight = num(canvas, 'margins_right');
  const colNum = num(canvas, 'leaf_col');
  const lcWidth = num(canvas, 'leaf_center_width');
  const blineWUse = blineW;

  // ---------- 位置坐标网格（与主版相同的两种多栏布局） ----------
  const cw = (W - num(canvas, 'margins_left') - marginRight - lcWidth) / colNum;
  const rh = (H - marginTop - marginBottom) / rowNum;
  const posL: [number, number][] = [[0, 0]];
  const posR: [number, number][] = [[0, 0]];
  const multirowsNum = num(canvas, 'multirows_num');
  const ifMultirows = flag(canvas, 'if_multirows');
  const multirowsHl = num(book, 'multirows_horizontal_layout');

  if (ifMultirows && multirowsNum !== 1) {
    if (rowNum % multirowsNum !== 0) throw new Error('多横栏模式下，每列字数应是栏数的倍数');
    const rrowNum = rowNum / multirowsNum;
    if (multirowsHl === 1) {
      // 横向整叶换行（族谱）
      for (let rid = 1; rid <= multirowsNum; rid++) {
        for (let i = 1; i <= colNum; i++) {
          for (let j = 1; j <= rrowNum; j++) {
            const px = i <= colNum / 2
              ? W - marginRight - cw * i
              : W - marginRight - cw * i - lcWidth;
            const py = H - marginTop - rrowNum * (rid - 1) * rh - rh * j + rowDeltaY;
            posL.push([px, py]);
            posR.push([px + cw / 2, py]);
          }
        }
      }
    }
    if (multirowsHl === 2) {
      // 横向半叶换行（字典）
      for (let rid = 1; rid <= multirowsNum; rid++) {
        for (let i = 1; i <= colNum / 2; i++) {
          for (let j = 1; j <= rrowNum; j++) {
            const px = W - marginRight - cw * i;
            const py = H - marginTop - rrowNum * (rid - 1) * rh - rh * j + rowDeltaY;
            posL.push([px, py]);
            posR.push([px + cw / 2, py]);
          }
        }
      }
      for (let rid = 1; rid <= multirowsNum; rid++) {
        for (let i = colNum / 2 + 1; i <= colNum; i++) {
          for (let j = 1; j <= rrowNum; j++) {
            const px = W - marginRight - cw * i - lcWidth;
            const py = H - marginTop - rrowNum * (rid - 1) * rh - rh * j + rowDeltaY;
            posL.push([px, py]);
            posR.push([px + cw / 2, py]);
          }
        }
      }
    }
    rowNum = rrowNum;
  } else {
    for (let i = 1; i <= colNum; i++) {
      for (let j = 1; j <= rowNum; j++) {
        const px = i <= colNum / 2
          ? W - marginRight - cw * i
          : W - marginRight - cw * i - lcWidth;
        const py = H - marginTop - rh * j + rowDeltaY;
        posL.push([px, py]);
        posR.push([px + cw / 2, py]);
      }
    }
  }

  const pageCharsNum = ifMultirows && multirowsNum !== 1
    ? colNum * rowNum * multirowsNum
    : colNum * rowNum;

  // ---------- 读取源文本（与主版一致的预处理，另加 vline 时去除书名号计数） ----------
  const textKeys = (await assets.list(`books_mr/${bookId}/text`))
    .filter((k) => {
      const name = k.split('/').pop() ?? '';
      return !name.startsWith('.') && /\.txt$/i.test(name);
    })
    .sort();
  let ifText000 = false;
  let ifText999 = false;
  const dats: string[] = [''];
  for (const key of textKeys) {
    const name = key.split('/').pop() ?? '';
    if (/^0+\.txt$/i.test(name)) ifText000 = true;
    if (name === '999.txt') ifText999 = true;
    const content = await assets.readText(key);
    if (content === null) continue;
    dats.push(prepareText(content, rowNum, rules, {
      stripBookMarks: ifBookVline === 1,
      stripT: false,
    }));
  }

  // ---------- 加载字体 ----------
  for (const fn of fontSlots) {
    const bytes = await assets.readBytes(`fonts/${fn}`);
    if (bytes === null) throw new Error(`未发现字体 fonts/${fn}`);
    await fonts.load(fn, bytes);
  }

  // ---------- 指令流与页面管理 ----------
  const pages: PageOps[] = [];
  const outlines: { title: string; pageIndex: number }[] = [];
  const firstPages: number[] = [];
  const cur = (): PageOps => pages[pages.length - 1];
  const emit = (op: Op) => cur().ops.push(op);
  const emitText = (
    x: number, y: number, char: string, font: string, size: number,
    color: string, rotate: number,
  ) => emit({ t: 'text', x, y, char, font, size, color, rotate });

  const drawCenterTitle = (tpchars: string[]) => {
    for (let i = 0; i < tpchars.length; i++) {
      const ch = tpchars[i];
      const fn = fonts.pickFont(ch, tfns);
      if (!fn) continue;
      const fs = titleFontSize;
      let fx = W / 2 - fs / 2;
      if (ifTpcenter === 0) fx = -fs / 2; // 标题不居中时位于左侧
      const fy = titleY - fs * i * titleYdis;
      emitText(fx, fy, ch, fn, fs, titleFontColor, 0);
    }
  };

  const newContentPage = (tpchars: string[]) => {
    pages.push({ background: `canvas/${canvasId}.jpg`, backgroundCover: false, ops: [] });
    drawCenterTitle(tpchars);
  };

  // ---------- 封面 ----------
  const coverBytes = await assets.readBytes(`books_mr/${bookId}/cover.jpg`);
  if (coverBytes !== null) {
    pages.push({ background: `books_mr/${bookId}/cover.jpg`, backgroundCover: true, ops: [] });
  } else {
    pages.push({ background: null, backgroundCover: false, ops: [] });
    let plx = W / 2;
    if (W < H) plx = W;
    emit({ t: 'line', x1: plx - 50, y1: H, x2: plx - 50, y2: 0, w: 1, c: '#cccccc' });
    emit({ t: 'line', x1: plx + 50, y1: H, x2: plx + 50, y2: 0, w: 1, c: '#cccccc' });
    for (let lid = 0; lid <= H / 200; lid++) {
      emit({ t: 'line', x1: plx - 50, y1: H - 200 * lid, x2: plx + 50, y2: H - 200 * lid, w: 1, c: '#cccccc' });
    }
    emit({ t: 'line', x1: plx, y1: H, x2: plx, y2: 0, w: 20, c: 'gray' });
    // 封面标题
    const tchars = [...title];
    for (let i = 0; i < tchars.length; i++) {
      const fs = coverTitleFontSize;
      const fn = fonts.pickFont(tchars[i], tfns);
      if (!fn) continue;
      const fx = fs;
      const fy = H - coverTitleY - fs * i * 1.2;
      emitText(fx, fy, tchars[i], fn, fs, coverFontColor, 0);
    }
    // 封面作者
    const achars = [...author];
    for (let i = 0; i < achars.length; i++) {
      const fs = coverAuthorFontSize;
      const fn = fonts.pickFont(achars[i], tfns);
      if (!fn) continue;
      const fx = fs / 2;
      const fy = H - coverAuthorY - fs * i * 1.2;
      emitText(fx, fy, achars[i], fn, fs, coverFontColor, 0);
    }
  }

  // ---------- 主排版循环 ----------
  let pid = 0;
  let pcnt = 0;
  const outlineSeen = new Set<string>();
  let flagTbook = 0;
  let flagRbook = 0;

  for (let tid = from; tid <= to; tid++) {
    if (maxPages !== undefined && pid === maxPages) break;

    const dat = dats[tid] ?? '';
    const chars: string[] = [...dat];
    let rchars: string[] = [];
    let last: [number, number] = [0, 0];

    let tpchars: string[];
    if (titlePostfixDefined) {
      const cid = ifText000 ? tid - 1 : tid;
      let tpost = titlePostfix.replace('X', ZH_NUMS[String(cid)] ?? '');
      if (cid === 0) tpost = '序';
      if (ifText999 && tid === dats.length - 1) tpost = '附';
      tpchars = [...(title + tpost)];
    } else {
      tpchars = [...title];
    }
    const tptitle = tpchars.join('');
    if (tptitle && !outlineSeen.has(tptitle)) {
      outlineSeen.add(tptitle);
      outlines.push({ title: tptitle, pageIndex: pid + 1 });
    }

    newContentPage(tpchars);
    firstPages.push(pages.length - 1);

    outer: while (true) {
      // RCHARS：满页或正文处理完 → 打印页码、新建页
      if (pcnt === pageCharsNum || chars.length === 0) {
        pid++;
        pcnt = 0;
        const pzh = ZH_NUMS[String(pid)] ?? '';
        const pcharsZh = [...pzh];
        for (let i = 0; i < pcharsZh.length; i++) {
          const pc = pcharsZh[i];
          let px = W / 2 - pagerFontSize / 2;
          if (ifTpcenter === 0) px = -pagerFontSize / 2;
          const py = pagerY - pagerFontSize * i * titleYdis;
          emitText(px, py, pc, fn1, pagerFontSize, pagerFontColor, 0);
        }
        if (chars.length === 0) break outer; // 注：原版此处不检查 @rchars
        newContentPage(tpchars);
      }

      // 批注双排（页内跨列、跨页）
      if (rchars.length > 0) {
        let rctmp = rchars.filter((ch) => !commentNopSet.has(ch)).join('');
        if (ifBookVline === 1) rctmp = rctmp.split('《').join('').split('》').join('');
        const rlen = [...rctmp].length;
        const cnt = rlen % 2 === 0 ? rlen / 2 : trunc(rlen / 2) + 1;
        const pcol = trunc(pcnt / rowNum) + 1; // 同主版：原版条件恒假，pcol 恒为此式

        const start = trunc(pcnt) + 1;
        const rPos: [number, number][] = [];
        if (pcnt + cnt <= pcol * rowNum) {
          const end = trunc(pcnt + cnt);
          for (let k = start; k <= end; k++) rPos.push(posR[k]);
          for (let k = start; k <= end; k++) rPos.push(posL[k]);
        } else {
          const end = pcol * rowNum;
          for (let k = start; k <= end; k++) rPos.push(posR[k]);
          for (let k = start; k <= end; k++) rPos.push(posL[k]);
        }

        let rlast: [number, number] = [0, 0];
        while (rchars.length > 0) {
          const rc0 = rchars.shift() as string;
          let rc = rc0;
          if (rc === '《') {
            flagRbook = 1;
            if (ifBookVline === 1) continue;
          }
          if (rc === '》') {
            flagRbook = 0;
            if (ifBookVline === 1) continue;
          }

          let fn = fonts.pickFont(rc, cfns);
          // try_st：字体不支持时尝试简繁转换（原版两书均关闭；转换器未内置，直接跳过）
          if (!fn) { rc = '□'; fn = fonts.pickFont('□', cfns) ?? fn1; }
          const param = fontParam[fn] ?? { textSize: 0, commSize: 0, rotate: 0 };
          let fsize = param.commSize;
          let fcolor = commentFontColor;
          let fdgrees = param.rotate;
          let fx: number;
          let fy: number;

          if (commentNopSet.has(rc)) {
            [fx, fy] = rlast;
            fsize *= commentCommaNopSize;
            fx += (cw / 2) * commentCommaNopX;
            fy -= rh * commentCommaNopY;
            if (fy - marginBottom < 10) fy = marginBottom + 10;
          } else {
            const rpref = rPos.shift();
            if (!rpref) { rchars.unshift(rc); continue outer; }
            [fx, fy] = rpref;
            rlast = rpref;
            fx += (cw - fsize * 2) / 4;
            fy += (rh - fsize) / 4;
            if (commentComma90Set.has(rc)) {
              fdgrees = -90;
              fsize *= commentComma90Size;
              fx += (cw / 2) * commentComma90X;
              fy += rh * commentComma90Y;
            }
            pcnt += 0.5;
          }
          if (ifOnlyPeriod && rc === '。') fcolor = onlyperiodColor || fcolor;
          if (debugBlue && fn !== cfns[0]) fcolor = 'blue';
          emitText(fx, fy, rc, fn, fsize, fcolor, fdgrees);
          if (ifBookVline === 1 && flagRbook === 1) {
            let ply = fy + rh * 0.7;
            if (ply >= H - marginTop) ply = H - marginTop - 5;
            emit({ t: 'line', x1: fx - 1, y1: fy - rh * 0.3, x2: fx - 1, y2: ply, w: blineWUse, c: blineC });
          }
        }
        if (rchars.length > 0) continue outer;
        pcnt = trunc(pcnt + 0.5);
        if (pcnt === pageCharsNum) continue outer;
      }

      // 正文文字
      if (chars.length === 0) continue outer;
      const char0 = chars.shift() as string;
      let char = char0;

      if (char === '$') {
        chars.splice(0, rowNum - 1);
        if (pcnt === 0 || pcnt === pageCharsNum / 2) continue outer;
        if (pcnt < pageCharsNum / 2) pcnt = pageCharsNum / 2;
        else pcnt = pageCharsNum;
        continue outer;
      }
      if (char === '^') {
        // 多栏模式下跳转到下一栏
        chars.splice(0, rowNum - 1);
        const rowChars = pageCharsNum / multirowsNum;
        if (pcnt % rowChars !== 0) {
          pcnt = (trunc(pcnt / rowChars) + 1) * rowChars;
        }
        continue outer;
      }
      if (char === '%') {
        chars.splice(0, rowNum - 1);
        pcnt = pageCharsNum;
        continue outer;
      }
      if (char === '&') {
        chars.splice(0, rowNum - 1);
        if (pcnt <= pageCharsNum - rowNum + 1) {
          pcnt = pageCharsNum - rowNum;
          continue outer;
        }
      }
      if (char === '《') {
        flagTbook = 1;
        if (ifBookVline === 1) continue outer;
      }
      if (char === '》') {
        flagTbook = 0;
        if (ifBookVline === 1) continue outer;
      }

      if (char === '【') {
        let rdat = '';
        while (chars.length > 0) {
          const rchar = chars.shift() as string;
          if (rchar === '】') break;
          rdat += rchar;
        }
        rchars = [...rdat];
        continue outer;
      } else {
        if (pcnt < pageCharsNum) pcnt++;
        if (pcnt <= pageCharsNum) {
          let fn = fonts.pickFont(char, tfns);
          // try_st 同上：转换器未内置，跳过
          if (!fn) { char = '□'; fn = fonts.pickFont('□', tfns) ?? fn1; }
          const param = fontParam[fn] ?? { textSize: 0, commSize: 0, rotate: 0 };
          let fsize = param.textSize;
          let fcolor = textFontColor;
          let fdgrees = param.rotate;
          let [fx, fy] = posL[pcnt];

          if (textNopSet.has(char)) {
            fsize *= textCommaNopSize;
            [fx, fy] = last;
            fx += cw * textCommaNopX;
            fy -= rh * textCommaNopY;
            if (fy - marginBottom < 10) fy = marginBottom + 10;
            pcnt--;
          } else {
            if (textComma90Set.has(char)) {
              fsize *= textComma90Size;
              fx += cw * textComma90X;
              fy += rh * textComma90Y;
              fdgrees = -90;
            } else {
              fx += (cw - fsize) / 2;
            }
            last = posL[pcnt];
          }
          if (ifOnlyPeriod && char === '。') fcolor = onlyperiodColor || fcolor;
          if (debugBlue && fn !== fn1) fcolor = 'blue';
          emitText(fx, fy, char, fn, fsize, fcolor, fdgrees);
          if (ifBookVline === 1 && flagTbook === 1) {
            let ply = fy + rh * 0.7;
            if (ply >= H - marginTop) ply = H - marginTop - 5;
            emit({ t: 'line', x1: fx - 2, y1: fy - rh * 0.3, x2: fx - 2, y2: ply, w: blineWUse, c: blineC });
          }

          // 页尾前瞻：非占位标点提前打印
          if (pcnt === pageCharsNum && chars.length > 0) {
            const nextChar = chars.shift() as string;
            if (textNopSet.has(nextChar)) {
              const [nfx0, nfy0] = posL[pcnt];
              const nfs = fsize * textCommaNopSize;
              let nfx = nfx0 + cw * textCommaNopX;
              let nfy = nfy0 - rh * textCommaNopY;
              if (nfy - marginBottom < 10) nfy = marginBottom + 10;
              emitText(nfx, nfy, nextChar, fn1, nfs, fcolor, fdgrees);
            } else {
              chars.unshift(nextChar);
            }
          }
        }
      }
      if (maxPages !== undefined && pid === maxPages) break outer;
    }
  }

  if (!titleDirectory) outlines.length = 0;
  void allFns;

  return { pages, outlines, title, author, firstPages };
}
