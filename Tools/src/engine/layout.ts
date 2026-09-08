// 排版引擎 — vrain.pl 主循环的忠实 TS 移植
//
// 与 Perl 版的对应关系（便于对照审计）：
//   $pcnt → pcnt（页内标准字位指针，批注占 0.5）
//   $pid  → pid（已完成的正文页计数）
//   @pos_l/@pos_r → posL/posR（左半列/右半列坐标，下标 0 为占位）
//   goto RCHARS → continue outer（外层 while 循环顶部）
//   $vpage->text->textlabel(...) → emitText(...)
//   draw_line/draw_wavy_line/draw_circle0/draw_circle1/draw_rect0/draw_rect1 → emit* 原语序列

import { AssetSource } from './assets.js';
import { charSet, flag, num, parseCfg, RawCfg, str } from './cfg.js';
import { FontSet } from './fonts.js';
import { buildRules, prepareText } from './text.js';
import { LayoutResult, Op, OutlineItem, PageOps } from './types.js';
import { ZH_NUMS } from './zhnum-data.js';

export interface LayoutOptions {
  bookId: string;
  from?: number; // 起始文本序号
  to?: number; // 结束文本序号
  maxPages?: number; // 测试模式页数（对应 -z）
  debugBlue?: boolean; // 测试模式回退字体标蓝（对应 -z 的视觉提示）
  verbose?: boolean;
}

interface FontParam {
  textSize: number;
  commSize: number;
  rotate: number;
}

const PINYIN_CHARS = 'āáǎàōóǒòēéěèīíǐìūúǔùǖǘǚǜü';
const isLatinLike = (ch: string) => /[a-z]/i.test(ch) || PINYIN_CHARS.includes(ch);

const trunc = Math.trunc;

export async function runLayout(
  assets: AssetSource,
  fonts: FontSet,
  opts: LayoutOptions,
): Promise<LayoutResult> {
  const bookId = opts.bookId;
  const from = opts.from ?? 1;
  const to = opts.to ?? 1;
  const maxPages = opts.maxPages;
  const debugBlue = opts.debugBlue ?? Boolean(maxPages);

  // ---------- 读取书籍与背景配置 ----------
  const bookRawTxt = await assets.readText(`books/${bookId}/book.cfg`);
  if (bookRawTxt === null) throw new Error(`未发现书籍排版配置文件 books/${bookId}/book.cfg`);
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

  // 字体槽位（主字体 font1 必填）
  const fontSlots = [1, 2, 3, 4, 5].map((i) => str(book, `font${i}`)).filter((n) => n !== '');
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

  // 颜色 / 尺寸参数
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
  const titleFontSize = num(book, 'title_font_size');
  const titleFontColor = str(book, 'title_font_color', 'black');
  const titleY = num(book, 'title_y');
  const titleYdis = num(book, 'title_ydis', 1);
  const pagerFontSize = num(book, 'pager_font_size');
  const pagerFontColor = str(book, 'pager_font_color', 'black');
  const pagerY = num(book, 'pager_y');

  // 标点参数
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

  // 特殊标记开关
  const ifTagBl = flag(book, 'if_tag_bookline');
  const ifTagRf = flag(book, 'if_tag_rectframe');
  const ifTagCf = flag(book, 'if_tag_circleframe');
  const ifTagTz = flag(book, 'if_tag_textzoom');
  const ifTagCn = flag(book, 'if_tag_circlenote');
  const ifTagPn = flag(book, 'if_tag_pointnote');
  const ifTagLn = flag(book, 'if_tag_linenote');
  const blineW = num(book, 'book_line_width', 1);
  const blineC = str(book, 'book_line_color', 'black');
  const textZoom = num(book, 'text_zoom', 1);
  const rectType = num(book, 'rect_type');
  const rectBcolor = str(book, 'rect_bcolor', 'black');
  const rectFcolor = str(book, 'rect_fcolor', 'black');
  const textRty = num(book, 'text_rect_y');
  const textRth = num(book, 'text_rect_h');
  const textRtr = num(book, 'text_rect_r');
  const commRty = num(book, 'comm_rect_y');
  const commRth = num(book, 'comm_rect_h');
  const commRtr = num(book, 'comm_rect_r');
  const textCy = num(book, 'text_circle_y');
  const textCr = num(book, 'text_circle_r', 1);
  const textCf = num(book, 'text_circle_f', 1);
  const commCy = num(book, 'comm_circle_y');
  const commCr = num(book, 'comm_circle_r', 1);
  const commCf = num(book, 'comm_circle_f', 1);
  const circleType = num(book, 'circle_type');
  const circleBcolor = str(book, 'circle_bcolor', 'black');
  const circleFcolor = str(book, 'circle_fcolor', 'white');
  const textNoteOx = num(book, 'text_note_ox');
  const textNoteOy = num(book, 'text_note_oy');
  const textNoteOr = num(book, 'text_note_or');
  const textNoteOw = num(book, 'text_note_ow');
  const textNoteOc = str(book, 'text_note_oc', 'black');
  const textNotePx = num(book, 'text_note_px');
  const textNotePy = num(book, 'text_note_py');
  const textNotePs = num(book, 'text_note_ps');
  const textNotePc = str(book, 'text_note_pc', 'black');
  const textNoteLx = num(book, 'text_note_lx');
  const textNoteLy = num(book, 'text_note_ly');
  const textNoteLw = num(book, 'text_note_lw');
  const textNoteLc = str(book, 'text_note_lc', 'black');
  const ifFontMetricAdjust = flag(book, 'if_font_metric_adjust');
  const ifFallbackBold = flag(book, 'if_fallback_bold');
  const fallbackBoldStrokeWidth = num(book, 'fallback_bold_stroke_width', 1);

  // 启用的标记符号计入不占位标点集合
  const extraNop: string[] = [];
  if (ifTagBl) extraNop.push('《', '》');
  if (ifTagRf) extraNop.push('〔', '〕');
  if (ifTagCf) extraNop.push('〈', '〉');
  if (ifTagTz) extraNop.push('（', '）');
  if (ifTagCn) extraNop.push('｛', '｝');
  if (ifTagPn) extraNop.push('＜', '＞');
  if (ifTagLn) extraNop.push('［', '］');

  const rules = buildRules(book, extraNop);
  const textNopSet = rules.textNopSet;
  const commentNopSet = rules.commentNopSet;
  const textComma90Set = charSet(str(book, 'text_comma_90'));
  const commentComma90Set = charSet(str(book, 'comment_comma_90'));

  // 背景参数
  const W = num(canvas, 'canvas_width');
  const H = num(canvas, 'canvas_height');
  const marginTop = num(canvas, 'margins_top');
  const marginBottom = num(canvas, 'margins_bottom');
  const marginLeft = num(canvas, 'margins_left');
  const marginRight = num(canvas, 'margins_right');
  const colNum = num(canvas, 'leaf_col');
  const lcWidth = num(canvas, 'leaf_center_width');
  const ohm = num(canvas, 'outline_hmargin');
  const olw = num(canvas, 'outline_width');
  const ilw = num(canvas, 'inline_width');
  const ovm = num(canvas, 'outline_vmargin');
  const ifMultirows = flag(canvas, 'if_multirows');
  const multirowsNum = num(canvas, 'multirows_num');
  const multirowsHl = num(book, 'multirows_horizontal_layout');
  const logoText = str(canvas, 'logo_text');

  // ---------- 位置坐标网格 ----------
  const cw = (W - marginLeft - marginRight - lcWidth) / colNum;
  const rh = (H - marginTop - marginBottom) / rowNum;
  const posL: [number, number][] = [[0, 0]]; // 下标 0 占位
  const posR: [number, number][] = [[0, 0]];

  if (ifMultirows && multirowsNum !== 1) {
    if (rowNum % multirowsNum !== 0) throw new Error('多横栏模式下，每列字数应是栏数的倍数');
    const rrowNum = rowNum / multirowsNum;
    if (multirowsHl === 1) {
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

  // ---------- 读取源文本 ----------
  const textKeys = (await assets.list(`books/${bookId}/text`))
    .filter((k) => {
      const name = k.split('/').pop() ?? '';
      return !name.startsWith('.') && /\.txt$/i.test(name);
    })
    .sort();
  let ifText000 = false;
  let ifText999 = false;
  for (const key of textKeys) {
    const name = key.split('/').pop() ?? '';
    if (/^0+\.txt$/i.test(name)) ifText000 = true;
    if (name === '999.txt') ifText999 = true;
  }
  // 懒加载：只读取 from..to 范围内的文本并并行加载（Workers 上避免全量 R2 往返；
  // 未命中槽位留空，排版循环本就只访问 from..to）
  const dats: string[] = [''];
  const lo = Math.max(1, from);
  const hi = Math.min(to, textKeys.length);
  await Promise.all(
    Array.from({ length: Math.max(0, hi - lo + 1) }, (_, k) => lo + k).map(async (tid) => {
      const content = await assets.readText(textKeys[tid - 1]);
      dats[tid] = content === null ? '' : prepareText(content, rowNum, rules);
    }),
  );

  // ---------- 加载字体与度量微调 ----------
  for (const fn of fontSlots) {
    const bytes = await assets.readBytes(`fonts/${fn}`);
    if (bytes === null) throw new Error(`未发现字体 fonts/${fn}`);
    await fonts.load(fn, bytes);
  }
  let fontScale: Record<string, number> = {};
  if (ifFontMetricAdjust) {
    fontScale = fonts.computeScales(fontSlots, tfns[0], '国', 100);
  }

  // ---------- 指令流与页面管理 ----------
  const pages: PageOps[] = [];
  const outlines: OutlineItem[] = [];
  const cur = (): PageOps => pages[pages.length - 1];
  const emit = (op: Op) => cur().ops.push(op);
  const emitText = (
    x: number, y: number, char: string, font: string, size: number,
    color: string, rotate: number, boldStroke?: number,
  ) => emit({ t: 'text', x, y, char, font, size, color, rotate, boldStroke });

  // draw_wavy_line — 书名波浪线（正弦采样折线）
  const emitWavy = (x1: number, y1: number, x2: number, y2: number, w: number, c: string) => {
    const amplitude = 1.25;
    const wavelength = 10;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) return;
    const angle = Math.atan2(dy, dx);
    const segments = trunc(length / (wavelength / 5));
    let px = x1;
    let py = y1;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const distance = t * length;
      const wave = amplitude * Math.sin((2 * Math.PI * distance) / wavelength);
      const x = x1 + Math.cos(angle) * distance - Math.sin(angle) * wave;
      const y = y1 + Math.sin(angle) * distance + Math.cos(angle) * wave;
      if (i > 0) emit({ t: 'line', x1: px, y1: py, x2: x, y2: y, w, c });
      px = x;
      py = y;
    }
  };

  // draw_rect0 — 带边框圆角方框（四角圆 + 内外矩形，单字符）
  const emitRect0 = (x: number, y: number, w: number, h: number, r: number, c: string) => {
    emit({ t: 'circleFill', x, y, r, c });
    emit({ t: 'circleFill', x: x + w, y, r, c });
    emit({ t: 'circleFill', x, y: y + h, r, c });
    emit({ t: 'circleFill', x: x + w, y: y + h, r, c });
    emit({ t: 'rectFill', x: x - r, y, w: w + 2 * r, h, c });
    emit({ t: 'rectFill', x, y: y - r, w, h: h + 2 * r, c });
  };

  // draw_rect1 — 不带边框圆角方框（多字符连续，含跨字符连接补齐）
  const emitRect1 = (
    x: number, y: number, w: number, h: number, r: number,
    kind: 'text' | 'comm', n: number, lastChar: string, lastY: number, c: string,
  ) => {
    emit({ t: 'circleFill', x, y, r, c });
    emit({ t: 'circleFill', x: x + w, y, r, c });
    emit({ t: 'circleFill', x, y: y + h, r, c });
    emit({ t: 'circleFill', x: x + w, y: y + h, r, c });
    emit({ t: 'rectFill', x: x - r, y, w: w + 2 * r, h, c });
    emit({ t: 'rectFill', x, y: y - r, w, h: h + 2 * r, c });
    if (y < H - marginTop - rh) {
      if (n > 1 && lastChar !== ' ') {
        const cnth = kind === 'text' ? r * textRtr : r * commRtr;
        // 注：Perl 原版批注分支条件为 'commn'（永不成立），此处保持相同行为：仅正文连接补齐
        if (kind === 'text') {
          emit({ t: 'rectFill', x: x - r, y: y + h, w: w + 2 * r, h: cnth, c });
          emit({ t: 'rectFill', x: x - r, y: y + h, w: r, h: 2 * r, c });
          emit({ t: 'rectFill', x: x + w, y: y + h, w: r, h: 2 * r, c });
        }
      }
    }
  };

  // 版心标题（每页叶心内竖排）
  const drawCenterTitle = (tpchars: string[]) => {
    if (lcWidth <= 0) return;
    for (let i = 0; i < tpchars.length; i++) {
      const ch = tpchars[i];
      const fn = fonts.pickFont(ch, tfns);
      if (!fn) continue;
      let fs = titleFontSize;
      if (ifFontMetricAdjust) fs *= fontScale[fn] ?? 1;
      const fx = W / 2 - fs / 2;
      const fy = titleY - fs * i * titleYdis;
      emitText(fx, fy, ch, fn, fs, titleFontColor, 0);
    }
  };

  const newContentPage = (tpchars: string[]) => {
    pages.push({ background: `canvas/${canvasId}.jpg`, backgroundCover: false, ops: [] });
    drawCenterTitle(tpchars);
  };

  // ---------- 封面 ----------
  const coverBytes = await assets.readBytes(`books/${bookId}/cover.jpg`);
  if (coverBytes !== null) {
    pages.push({ background: `books/${bookId}/cover.jpg`, backgroundCover: true, ops: [] });
  } else {
    pages.push({ background: null, backgroundCover: false, ops: [] });
    let plx = W / 2;
    if (W < H) plx = W;
    // 封面底色
    emit({ t: 'rectFill', x: 0, y: 0, w: plx, h: H, c: '#f2ead9' });
    // 中间细竖线
    emit({ t: 'line', x1: plx - 50, y1: H, x2: plx - 50, y2: 0, w: 2, c: '#f2f2f2' });
    emit({ t: 'line', x1: plx + 50, y1: H, x2: plx + 50, y2: 0, w: 2, c: '#f2f2f2' });
    for (let lid = 0; lid <= H / 200; lid++) {
      emit({ t: 'line', x1: plx - 50, y1: H - 200 * lid, x2: plx + 50, y2: H - 200 * lid, w: 2, c: '#f2f2f2' });
    }
    // 中间粗竖线
    emit({ t: 'line', x1: plx, y1: H, x2: plx, y2: 0, w: 20, c: '#f2f2f2' });
    // 封面标题
    const tchars = [...title];
    for (let i = 0; i < tchars.length; i++) {
      let fs = coverTitleFontSize;
      const fn = fonts.pickFont(tchars[i], tfns);
      if (!fn) continue;
      if (ifFontMetricAdjust) fs *= fontScale[fn] ?? 1;
      const fx = fs * 1.5;
      const fy = H - coverTitleY - fs * i * 1.2;
      emitText(fx, fy, tchars[i], fn, fs, coverFontColor, 0);
    }
    // 封面作者
    const achars = [...author];
    for (let i = 0; i < achars.length; i++) {
      let fs = coverAuthorFontSize;
      const fn = fonts.pickFont(achars[i], tfns);
      if (!fn) continue;
      if (ifFontMetricAdjust) fs *= fontScale[fn] ?? 1;
      const fx = fs * 1.2;
      const fy = H - coverAuthorY - fs * i * 1.2;
      emitText(fx, fy, achars[i], fn, fs, coverFontColor, 0);
    }
    // 书房名
    if (logoText) {
      emitText(plx - 300, 60, logoText, fn1, 30, coverFontColor, 0);
    }
  }

  // ---------- 主排版循环 ----------
  let pid = 0;
  let pcnt = 0;
  const outlineSeen = new Set<string>();
  const firstPages: number[] = [];

  for (let tid = from; tid <= to; tid++) {
    if (maxPages !== undefined && pid === maxPages) break;

    let flagZtag = 0, flagBtag = 0, flagRtag = 0, flagCtag = 0;
    let flagOtag = 0, flagPtag = 0, flagLtag = 0;
    let rflagBtag = 0, rflagRtag = 0, rflagCtag = 0;
    let tbcnt = 0, rbcnt = 0, tcnt = 0, rtcnt = 0;

    const dat = dats[tid] ?? '';
    const chars: string[] = [...dat];
    let rchars: string[] = [];
    let last: [number, number] = [0, 0];
    let lastChar = '';

    // 版心标题（含卷次后缀）
    let tpchars: string[];
    if (titlePostfixDefined) {
      const cid = ifText000 ? tid - 1 : tid;
      let tpost = titlePostfix.replace('X', ZH_NUMS[String(cid)] ?? '');
      if (cid === 0) tpost = '序';
      if (ifText999 && tid === textKeys.length) tpost = '附';
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
      // RCHARS：满页或全部字符处理完 → 打印页码、新建页
      if (pcnt === pageCharsNum || (chars.length === 0 && rchars.length === 0)) {
        pid++;
        pcnt = 0;
        const pzh = ZH_NUMS[String(pid)] ?? '';
        const pcharsZh = [...pzh];
        for (let i = 0; i < pcharsZh.length; i++) {
          const px = W / 2 - pagerFontSize / 2;
          const py = pagerY - pagerFontSize * i * 1.1;
          emitText(px, py, pcharsZh[i], fn1, pagerFontSize, pagerFontColor, 0);
        }
        if (chars.length === 0 && rchars.length === 0) break outer;
        newContentPage(tpchars);
      }

      // 优先处理【】标注文本（页内跨列、跨页）
      if (rchars.length > 0) {
        const rctmp = rchars.filter((ch) => !commentNopSet.has(ch)).join('');
        const rlen = [...rctmp].length;
        const cnt = rlen % 2 === 0 ? rlen / 2 : trunc(rlen / 2) + 1;
        // Perl 原版条件为 $pcnt+1 % $row_num == 0（% 优先级高于 +，恒为 $pcnt+1==0 永假），
        // 因此 pcol 恒为 int(pcnt/row_num)+1
        const pcol = trunc(pcnt / rowNum) + 1;

        const start = trunc(pcnt) + 1;
        const rPos: [number, number][] = [];
        // 与 Perl 切片语义一致：批注双排先取右半列再取左半列
        if (pcnt + cnt <= pcol * rowNum) {
          const end = trunc(pcnt + cnt);
          for (let k = start; k <= end; k++) rPos.push(posR[k]);
          for (let k = start; k <= end; k++) rPos.push(posL[k]);
        } else {
          const end = pcol * rowNum;
          for (let k = start; k <= end; k++) rPos.push(posR[k]);
          for (let k = start; k <= end; k++) rPos.push(posL[k]);
        }

        let rpref: [number, number] | undefined;
        let rlast: [number, number] = [0, 0];
        rtcnt = 0;
        while (rchars.length > 0) {
          const rc = rchars.shift() as string;
          if (ifTagBl && rc === '《') { rflagBtag = 1; continue; }
          if (ifTagBl && rc === '》') { rflagBtag = 0; rbcnt = 0; continue; }
          if (ifTagRf && rc === '〔') { rflagRtag = 1; continue; }
          if (ifTagRf && rc === '〕') { rflagRtag = 0; rtcnt = 0; continue; }
          if (ifTagCf && rc === '〈') { rflagCtag = 1; continue; }
          if (ifTagCf && rc === '〉') { rflagCtag = 0; continue; }

          let drawChar = rc;
          let fn = fonts.pickFont(rc, cfns);
          if (!fn) { drawChar = '□'; fn = fonts.pickFont('□', cfns) ?? fn1; }
          const param = fontParam[fn] ?? { textSize: 0, commSize: 0, rotate: 0 };
          let fsize = param.commSize;
          let fcolor = commentFontColor;
          let fdgrees = param.rotate;
          if (ifFontMetricAdjust) fsize *= fontScale[fn] ?? 1;
          let fx: number;
          let fy: number;

          if (commentNopSet.has(rc)) {
            [fx, fy] = rlast;
            fsize *= commentCommaNopSize;
            fx += (cw / 2) * commentCommaNopX;
            fy -= rh * commentCommaNopY;
            if (fy - marginBottom < 10) fy = marginBottom + 2;
          } else {
            rpref = rPos.shift();
            if (!rpref) { rchars.unshift(rc); continue outer; }
            [fx, fy] = rpref;
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
          if (debugBlue && fn !== cfns[0]) fcolor = 'blue';

          if (rflagBtag === 1 && rc !== ' ') {
            rbcnt++;
            let ty = fy + rh * 0.8;
            let by = fy - rh * 0.2;
            if (ty >= H - marginTop) ty = H - marginTop - 5;
            if (rbcnt === 1) ty -= rh * 0.25;
            if (by <= marginBottom) by = marginBottom + 2;
            emitWavy(fx, by, fx, ty, blineW, blineC);
          }
          if (rflagRtag === 1 && rc !== ' ') {
            rtcnt++;
            const r = 5;
            const x = fx + r;
            let y = fy - fsize * commRty;
            let h = fsize * (1 + commRth);
            if (y <= marginBottom + 10) { y = fy - 6; h -= 6; }
            if (y + h >= H - marginTop - 5) h -= 8;
            if (rectType === 0) {
              emitRect0(x - 2, y - 2, fsize - 2 * r + 4, h + 4, r, rectBcolor);
              emitRect0(x - 1, y - 1, fsize - 2 * r + 2, h + 2, r, 'white');
              emitRect0(x + 1, y + 1, fsize - 2 * r - 2, h - 2, r, rectBcolor);
            }
            if (rectType === 1) {
              emitRect1(x, y, fsize - 2 * r, h, r, 'comm', rtcnt, lastChar, rlast[1], rectBcolor);
            }
            fcolor = rectFcolor;
          }
          if (rflagCtag === 1 && rc !== ' ') {
            const cx = fx + fsize / 2;
            const cy = fy + fsize / 2 + fsize * commCy;
            const cr = (fsize / 2) * commCr + 1;
            if (circleType === 0) {
              emit({ t: 'circleFill', x: cx, y: cy, r: cr + 3, c: circleBcolor });
              emit({ t: 'circleFill', x: cx, y: cy, r: cr + 1, c: 'white' });
              emit({ t: 'circleFill', x: cx, y: cy, r: cr, c: circleBcolor });
            }
            if (circleType === 1) {
              emit({ t: 'circleFill', x: cx, y: cy, r: cr, c: circleBcolor });
            }
            fcolor = circleFcolor;
            fx += (fsize * (1 - commCf)) / 2;
            fy += (fsize * (1 - commCf)) / 2;
            fsize *= commCf;
          }
          if (isLatinLike(rc)) {
            fx += fsize / 4;
            fy += fsize / 2;
            fdgrees = -90;
          }
          const bold = ifFallbackBold && fn !== tfns[0] ? fallbackBoldStrokeWidth : undefined;
          emitText(fx, fy, drawChar, fn, fsize, fcolor, fdgrees, bold);
          if (rpref) rlast = rpref;
          lastChar = rc;
        }
        if (rchars.length > 0) continue outer;
        pcnt = trunc(pcnt + 0.5);
        if (pcnt === pageCharsNum) continue outer;
      }

      // 正文文字
      if (chars.length === 0) continue outer;
      const char = chars.shift() as string;

      if (char === '$') {
        chars.splice(0, rowNum - 1);
        if (pcnt === 0 || pcnt === pageCharsNum / 2) continue outer;
        if (pcnt < pageCharsNum / 2) pcnt = pageCharsNum / 2;
        else pcnt = pageCharsNum;
        continue outer;
      }
      if (char === '%') {
        chars.splice(0, rowNum - 1);
        if (pcnt > 1) pcnt = pageCharsNum;
        else pcnt = 0;
        continue outer;
      }
      if (char === '&') {
        chars.splice(0, rowNum - 1);
        if (pcnt <= pageCharsNum - rowNum + 1) {
          pcnt = pageCharsNum - rowNum;
          continue outer;
        }
      }
      if (ifTagBl && char === '《') { flagBtag = 1; continue outer; }
      if (ifTagBl && char === '》') { flagBtag = 0; tbcnt = 0; continue outer; }
      if (ifTagRf && char === '〔') { flagRtag = 1; continue outer; }
      if (ifTagRf && char === '〕') { flagRtag = 0; tcnt = 0; continue outer; }
      if (ifTagTz && char === '（') { flagZtag = 1; continue outer; }
      if (ifTagTz && char === '）') { flagZtag = 0; continue outer; }
      if (ifTagCf && char === '〈') { flagCtag = 1; continue outer; }
      if (ifTagCf && char === '〉') { flagCtag = 0; continue outer; }
      if (ifTagCn && char === '｛') { flagOtag = 1; continue outer; }
      if (ifTagCn && char === '｝') { flagOtag = 0; continue outer; }
      if (ifTagPn && char === '＜') { flagPtag = 1; continue outer; }
      if (ifTagPn && char === '＞') { flagPtag = 0; continue outer; }
      if (ifTagLn && char === '［') { flagLtag = 1; continue outer; }
      if (ifTagLn && char === '］') { flagLtag = 0; continue outer; }

      if (char === '【') {
        let rdat = '';
        while (chars.length > 0) {
          const rchar = chars.shift() as string;
          if (rchar === '】') break;
          rdat += rchar;
        }
        if (rdat) rchars = [...rdat];
        continue outer;
      } else {
        if (pcnt < pageCharsNum) pcnt++;
        if (pcnt <= pageCharsNum) {
          let drawChar = char;
          let fn = fonts.pickFont(char, tfns);
          if (!fn) { drawChar = '□'; fn = fonts.pickFont('□', tfns) ?? fn1; }
          const param = fontParam[fn] ?? { textSize: 0, commSize: 0, rotate: 0 };
          let fsize = param.textSize;
          let fcolor = textFontColor;
          let fdgrees = param.rotate;
          if (ifFontMetricAdjust) fsize *= fontScale[fn] ?? 1;
          let [fx, fy] = posL[pcnt];

          if (char === 'T') {
            // 顶格：外粗线框、内细线框延伸（填充覆盖法）
            emit({ t: 'rectFill', x: fx - ohm - olw, y: fy + rh + ovm * 2, w: trunc(cw + ohm * 2 + olw * 2) + 1, h: rh + ovm * 2, c: 'black' });
            emit({ t: 'rectFill', x: trunc(fx - ohm + 1), y: fy + rh, w: trunc(cw + ohm * 2 + 0.5), h: rh + ovm * 2, c: 'white' });
            emit({ t: 'rectFill', x: fx, y: fy + rh + ovm - olw, w: trunc(cw) + 1, h: rh + ovm * 2, c: 'black' });
            emit({ t: 'rectFill', x: fx + ilw, y: fy + rh + ovm - olw - ilw, w: trunc(cw - ilw * 2) + 1, h: rh + ovm * 2, c: 'white' });
            const nchar = chars.shift();
            if (nchar !== undefined) {
              const nfn = fonts.pickFont(nchar, tfns) ?? fn1;
              const nparam = fontParam[nfn] ?? { textSize: 0, commSize: 0, rotate: 0 };
              let nfs = nparam.textSize;
              if (ifFontMetricAdjust) nfs *= fontScale[nfn] ?? 1;
              const nfx = fx + (cw - nfs) / 2;
              const nfy = fy + rh;
              emitText(nfx, nfy + ovm, nchar, nfn, nfs, textFontColor, nparam.rotate);
            }
            pcnt--;
            continue outer;
          }

          if (textNopSet.has(char)) {
            pcnt--;
            fsize *= textCommaNopSize;
            [fx, fy] = last;
            fx += cw * textCommaNopX;
            fy -= rh * textCommaNopY;
            if (fy - marginBottom < 10) {
              fy = marginBottom + 5;
              if (char === '…' || char === '—') fy += fsize / 2;
            }
            if (textComma90Set.has(char)) fdgrees = -90;
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
          if (debugBlue && fn !== tfns[0]) fcolor = 'blue';

          if (flagZtag === 1) {
            fx += (fsize * (1 - textZoom)) / 2;
            fsize *= textZoom;
          }
          if (flagOtag === 1 && char !== ' ') {
            const ox = fx + cw / 2 + fsize * textNoteOx;
            const oy = fy + fsize * textNoteOy;
            const orad = fsize * textNoteOr;
            emit({ t: 'circleStroke', x: ox, y: oy, r: orad, w: textNoteOw, c: textNoteOc });
          }
          if (flagPtag === 1 && char !== ' ') {
            const fchar = '、';
            const ffn = fonts.pickFont(fchar, tfns) ?? fn1;
            const px = fx + cw / 2 + fsize * textNotePx;
            const py = fy + fsize * textNotePy;
            const ps = fsize * textNotePs;
            emitText(px, py, fchar, ffn, ps, textNotePc, 0);
          }
          if (flagLtag === 1 && char !== ' ') {
            let ty = fy + rh * (1 + textNoteLy);
            let by = fy + rh * textNoteLy;
            const lx = fx + cw / 2 + fsize * textNoteLx;
            if (pcnt % rowNum === 1) ty = H - marginTop - 5;
            if (pcnt % rowNum === 0) by = marginBottom + 4;
            emit({ t: 'line', x1: lx, y1: by, x2: lx, y2: ty, w: textNoteLw, c: textNoteLc });
          }
          if (flagBtag === 1 && char !== ' ') {
            tbcnt++;
            let ty = fy + rh * 0.8;
            let by = fy - rh * 0.2;
            if (pcnt % rowNum === 1) ty = H - marginTop - 5;
            if (tbcnt === 1) ty -= 5;
            if (pcnt % rowNum === 0) by = marginBottom + 4;
            emitWavy(fx - 2, by, fx - 2, ty, blineW + 1, blineC);
          }
          if (flagRtag === 1 && char !== ' ') {
            tcnt++;
            const r = 10;
            const tfs = num(book, 'text_font1_size');
            const x = fx + r;
            let y = fy - rh * textRty;
            let h = tfs * (1 + textRth);
            if (pcnt % rowNum === 0) { y = fy + 2; h -= 4; }
            if (pcnt % rowNum === 1) h -= 4;
            if (rectType === 0) {
              emitRect0(x - 2, y - 2, fsize - 2 * r + 4, h + 4, r, rectBcolor);
              emitRect0(x - 1, y - 1, fsize - 2 * r + 2, h + 2, r, 'white');
              emitRect0(x + 1, y + 1, fsize - 2 * r - 2, h - 2, r, rectBcolor);
            }
            if (rectType === 1) {
              emitRect1(x, y, fsize - 2 * r, h, r, 'text', tcnt, lastChar, last[1], rectBcolor);
            }
            fcolor = rectFcolor;
          }
          if (flagCtag === 1 && char !== ' ') {
            const cx = fx + fsize / 2;
            const cy = fy + fsize / 2 + fsize * textCy;
            const cr = (fsize / 2) * textCr + 1;
            if (circleType === 0) {
              emit({ t: 'circleFill', x: cx, y: cy, r: cr + 4, c: circleBcolor });
              emit({ t: 'circleFill', x: cx, y: cy, r: cr + 2, c: 'white' });
              emit({ t: 'circleFill', x: cx, y: cy, r: cr, c: circleBcolor });
            }
            if (circleType === 1) {
              emit({ t: 'circleFill', x: cx, y: cy, r: cr, c: circleBcolor });
            }
            fcolor = circleFcolor;
            fx += (fsize * (1 - textCf)) / 2;
            fy += (fsize * (1 - textCf)) / 2;
            fsize *= textCf;
          }
          if (isLatinLike(char)) {
            fdgrees = -90;
            fx += fsize / 4;
            fy += fsize / 2;
          }
          const bold = ifFallbackBold && fn !== tfns[0] ? fallbackBoldStrokeWidth : undefined;
          emitText(fx, fy, drawChar, fn, fsize, fcolor, fdgrees, bold);

          // 页尾前瞻：非占位标点提前打印，避免孤字换页
          if (pcnt === pageCharsNum && chars.length > 0) {
            const nextChar = chars.shift() as string;
            if (ifTagBl && nextChar === '《') { chars.unshift(nextChar); continue outer; }
            if (ifTagBl && nextChar === '》') { flagBtag = 0; tbcnt = 0; continue outer; }
            if (ifTagRf && nextChar === '〔') { chars.unshift(nextChar); continue outer; }
            if (ifTagRf && nextChar === '〕') { flagRtag = 0; tcnt = 0; continue outer; }
            if (ifTagCf && nextChar === '（') { chars.unshift(nextChar); continue outer; }
            if (ifTagTz && nextChar === '）') { flagZtag = 0; continue outer; }
            if (ifTagCf && nextChar === '〈') { chars.unshift(nextChar); continue outer; }
            if (ifTagCf && nextChar === '〉') { flagCtag = 0; continue outer; }
            if (ifTagCn && nextChar === '｛') { chars.unshift(nextChar); continue outer; }
            if (ifTagCn && nextChar === '｝') { flagOtag = 0; continue outer; }
            if (ifTagPn && nextChar === '＜') { chars.unshift(nextChar); continue outer; }
            if (ifTagPn && nextChar === '＞') { flagPtag = 0; continue outer; }
            if (ifTagLn && nextChar === '［') { chars.unshift(nextChar); continue outer; }
            if (ifTagLn && nextChar === '］') { flagLtag = 0; continue outer; }
            if (textNopSet.has(nextChar)) {
              const [nfx0, nfy0] = posL[pcnt];
              const nfs = fsize * textCommaNopSize;
              let nfx = nfx0 + cw * textCommaNopX;
              let nfy = nfy0 - rh * textCommaNopY;
              if (nfy - marginBottom < 10) {
                nfy = marginBottom + 5;
                if (char === '…' || char === '—') nfy += nfs / 2;
              }
              emitText(nfx, nfy, nextChar, fn1, nfs, fcolor, fdgrees);
            } else {
              chars.unshift(nextChar);
            }
          }
        }
        lastChar = char;
      }
      if (maxPages !== undefined && pid === maxPages) break outer;
    }
  }

  if (!titleDirectory) outlines.length = 0;

  return { pages, outlines, title, author, firstPages };
}
