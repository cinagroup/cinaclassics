# -*- coding: utf-8 -*-
"""明史武英殿本定位管线 v2：左锚定位 + □槽裁剪供目视定谳
OCR 仅用于定位；定谳一律以 300dpi 裁剪目视为准。"""
import fitz, os, sys, re, json, pickle, time
import numpy as np

BASE = r'E:\classics\PDF\史料纪传\明史.三百三十二卷.目录四卷'
MD = r'E:\cinagroup\cinaclassics\史藏\正史\明史.md'
TMP = r'E:\cinagroup\cinaclassics\Tools\collation\tmp\ms'
CACHE = os.path.join(TMP, 'ocr_cache.pkl')
PNG = os.path.join(TMP, 'pages300')
os.makedirs(PNG, exist_ok=True)

FILES = {
    (1, 24):   '明史.卷001至024.本纪.总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (25, 39):  '明史.卷025至039.志（天文.五行.历）总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (40, 60):  '明史.卷040至060.志（地理.礼）总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (61, 76):  '明史.卷061至076.志（乐.舆服.选举.职官）总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (77, 99):  '明史.卷077至099.志（食货.河渠.兵.刑法.艺文）总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (100, 112):'明史.卷100至112.表.总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (113, 129):'明史.卷113至129.列传.总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (130, 158):'明史.卷130至158.列传.总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (159, 180):'明史.卷159至180.列传.总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (181, 198):'明史.卷181至198.列传.总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (199, 217):'明史.卷199至217.列传.总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (218, 243):'明史.卷218至243.列传.总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (244, 264):'明史.卷244至264.列传.总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (265, 285):'明史.卷265至285.列传.总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (286, 305):'明史.卷286至305.列传.总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (306, 316):'明史.卷306至316.列传.总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
    (317, 332):'明史.卷317至332.列传.总三百三十二卷.清.张廷玉等奉敕纂.清乾隆时期武英殿刊本.pdf',
}

def file_for(vol):
    for (a, b), fn in FILES.items():
        if a <= vol <= b:
            return fn
    return None

_cat = '本纪|志|表|列传'
_numc = '[一二三四五六七八九十百零]'
_zyh = '天文|五行|历|地理|礼|乐|舆服|选举|职官|食货|河渠|兵|刑法|艺文|四川'
# 志标题以数字开头（五行），须用标题白名单截断卷号
_vol_pat = re.compile(rf'^({_cat})第({_numc}+?)(?=(?:{_zyh})|$|（|[^0-9{_numc[1:-1]}])')
def cn2int(s):
    total=0; num=0; unit={'十':10,'百':100}; d={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9}
    for ch in s:
        if ch in d: num=d[ch]
        elif ch in unit: total+=(num or 1)*unit[ch]; num=0
    return total+num

def sec2cont(cat, v):
    """分节卷号→明史连续卷号"""
    if cat == '本纪': return v          # 1-24
    if cat == '志':   return 24 + v     # 25-99
    if cat == '表':   return 99 + v     # 100-112
    return 112 + v                      # 列传 113-332

def load_vols():
    lines = open(MD, encoding='utf-8').read().split('\n')
    heads = []
    for i, l in enumerate(lines):
        m = _vol_pat.match(l.strip())
        if m and len(l.strip()) < 40:
            v = cn2int(m.group(2))
            heads.append((sec2cont(m.group(1), v), i))
    vols = []
    for k, (v, i) in enumerate(heads):
        j = heads[k+1][1] if k+1 < len(heads) else len(lines)
        txt = ''.join(lines[i:j])
        vols.append({'vol': v, 's': i+1, 'e': j, 'n': len(txt)})
    # 单调性修复：重复/回退卷头处理（库本卷尾重出88/89、西域三误标217等）
    fixed = []
    for k, x in enumerate(vols):
        v = x['vol']
        if fixed:
            prevv = fixed[-1]['vol']
            nxt = vols[k+1]['vol'] if k + 1 < len(vols) else None
            if v <= prevv:
                cand = prevv + 1
                if nxt is not None and cand < nxt:
                    v = cand      # 库本卷号误标，顺延修正（217→219）
                else:
                    v = prevv     # 卷尾重出/重复头 → 并入前段
            x = dict(x, vol=v)
        fixed.append(x)
    # 合并相邻同卷段（重复卷头拆段后统一）
    merged = []
    for x in fixed:
        if merged and merged[-1]['vol'] == x['vol']:
            merged[-1]['e'] = x['e']
            merged[-1]['n'] += x['n']
        else:
            merged.append(x)
    vols = merged
    return vols, lines

VOLS, MDLINES = load_vols()
_volmap_raw = json.load(open(os.path.join(TMP, '..', 'ms_volmap.json'), encoding='utf-8'))
VOLMAP = {int(k): v for k, v in _volmap_raw.items()}
VOLSEG = {x['vol']: x for x in VOLS}

def vol_info(vol):
    return VOLSEG.get(vol)

# ---------- OCR ----------
_engine = None
def ocr_engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _engine = RapidOCR()
    return _engine

_docs = {}
def get_doc(fn):
    if fn not in _docs:
        _docs[fn] = fitz.open(os.path.join(BASE, fn))
    return _docs[fn]

_oc = None
def ocr_cache():
    global _oc
    if _oc is None:
        _oc = pickle.load(open(CACHE, 'rb')) if os.path.exists(CACHE) else {}
    return _oc

def save_cache():
    if _oc is not None:
        pickle.dump(_oc, open(CACHE, 'wb'))

def norm(s):
    return re.sub(r'[，。：；！？、‘’“”「」『』（）()·\s,.:;!?{}\-—…《》<>〔〕＇\'"]+', '', s)

_tr = None
def hant(s):
    global _tr
    if _tr is None:
        import zhconv
        _tr = zhconv.convert
    return _tr(s, 'zh-hant')

def page_png(fn, pidx, dpi=300):
    """300dpi整页PNG（裁剪用，缓存）"""
    p = os.path.join(PNG, f'{fn[:8]}_{pidx}_{dpi}.png')
    if not os.path.exists(p):
        doc = get_doc(fn)
        doc[pidx].get_pixmap(dpi=dpi).save(p)
    return p

_WOCR = None
def _ocr_one(args):
    fn, pidx, dpi = args
    global _WOCR
    if _WOCR is None:
        from rapidocr_onnxruntime import RapidOCR
        _WOCR = RapidOCR()
    import fitz as _f
    import numpy as _np
    doc = _f.open(os.path.join(BASE, fn))
    pix = doc[pidx].get_pixmap(dpi=dpi)
    img = _np.frombuffer(pix.samples, dtype=_np.uint8).reshape(pix.height, pix.width, pix.n)
    if img.shape[2] == 4:
        img = img[:, :, :3]
    doc.close()
    result, _ = _WOCR(img)
    items = []
    if result:
        for box, text, conf in result:
            xs = [p[0] for p in box]; ys = [p[1] for p in box]
            items.append([sum(xs)/4, min(ys), max(ys), text, float(conf)])
    return fn, pidx, dpi, items

def ocr_page(fn, pidx, dpi=150):
    """返回 (joined, meta)：joined=列右→左拼接文本；meta=[(char,x,ytop,ybot)]"""
    key = f'{fn}|{pidx}|{dpi}'
    c = ocr_cache()
    if key in c:
        return c[key]
    _, _, _, items = _ocr_one((fn, pidx, dpi))
    return _pack(key, items)

def _pack(key, items):
    items.sort(key=lambda t: -t[0])
    cols = []
    for it in items:
        if cols and cols[-1]['x'] - it[0] < 42:
            cols[-1]['parts'].append(it)
        else:
            cols.append({'x': it[0], 'parts': [it]})
    joined = ''
    meta = []
    for col in cols:
        col['parts'].sort(key=lambda t: t[1])
        for p in col['parts']:
            t = p[3]; n = max(1, len(t))
            for k, ch in enumerate(t):
                joined += ch
                ytop = p[1] + (p[2]-p[1]) * k / n
                ybot = p[1] + (p[2]-p[1]) * (k+1) / n
                meta.append((ch, col['x'], ytop, ybot))
    ocr_cache()[key] = (joined, meta)
    return ocr_cache()[key]

def prefetch(tasks, workers=4):
    """并行OCR填充缓存。tasks=[(fn,pidx,dpi)]"""
    c = ocr_cache()
    todo = [t for t in tasks if f'{t[0]}|{t[1]}|{t[2]}' not in c]
    if not todo:
        return 0
    from multiprocessing import Pool
    t0 = time.time()
    with Pool(workers) as pool:
        for fn, pidx, dpi, items in pool.imap_unordered(_ocr_one, todo):
            _pack(f'{fn}|{pidx}|{dpi}', items)
    print(f'  预取{len(todo)}页 耗时{time.time()-t0:.0f}s', file=sys.stderr)
    save_cache()
    return len(todo)

# ---------- 模糊匹配 ----------
def lcs(a, b):
    n, h = len(a), len(b)
    if not n or not h: return 0
    prev = [0]*(h+1)
    for i in range(1, n+1):
        cur = [0]*(h+1); ai = a[i-1]
        for j in range(1, h+1):
            cur[j] = prev[j-1]+1 if ai == b[j-1] else (cur[j-1] if cur[j-1] >= prev[j] else prev[j])
        prev = cur
    return prev[h]

def lcs_score(a, b):
    n, h = len(a), len(b)
    return lcs(a, b)/max(1, min(n, h))

def find_window(needle, hay):
    """最优对齐窗口起点与分数"""
    n = len(needle)
    if n == 0 or not hay:
        return -1, 0.0
    best = (-1, 0.0)
    for w in range(max(2, n-4), n+4):
        for s0 in range(0, max(1, len(hay)-w+1)):
            sc = lcs(needle, hay[s0:s0+w])/n
            if sc > best[1]:
                best = (s0, sc)
    return best

# ---------- 估页 ----------
def est_page(vol, frac):
    fn = file_for(vol)
    doc = get_doc(fn)
    pc = doc.page_count
    if vol in VOLMAP:
        start = VOLMAP[vol][1]
        nxt = [x[1] for v, x in VOLMAP.items() if x[0] == fn and v > vol]
        span = (min(nxt) if nxt else pc) - start
        return start + int(frac * span)
    a, b = next((a, b) for (a, b), f in FILES.items() if f == fn)
    vols = [x for x in VOLS if a <= x['vol'] <= b]
    total = sum(x['n'] for x in vols)
    before = sum(x['n'] for x in vols if x['vol'] < vol)
    vn = next(x['n'] for x in vols if x['vol'] == vol)
    start_c = before + int(frac * vn)
    return 1 + round(start_c / total * (pc - 2))

def spot_frac(s):
    x = VOLSEG[s['vol']]
    n = sum(len(MDLINES[i]) for i in range(x['s']-1, s['line']-1))
    n += s.get('col', 0)
    return min(0.98, n / max(1, x['n']))

# ---------- 定位 ----------
def locate(vol, frac, left, right, max_span=9):
    """左锚8字定位；右锚在之后16字内LCS≥0.45确证。返回dict或None"""
    fn = file_for(vol)
    if fn is None: return None
    la = norm(hant(left))[-8:]
    ra = norm(hant(right))[:8]
    if len(la) < 5: return None
    p0 = est_page(vol, frac)
    pc = get_doc(fn).page_count
    for delta in [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6, -7, 7, -8, 8, -9, 9]:
        pg = p0 + delta
        if abs(delta) > max_span or pg < 0 or pg >= pc:
            continue
        joined, meta = ocr_page(fn, pg)
        lp, ls = find_window(la, joined)
        if ls < 0.62:
            continue
        ctx = joined[lp+len(la): lp+len(la)+18]
        rs = lcs_score(ra, ctx) if ra else 1.0
        g = lp + len(la)  # □槽在joined的估计位置
        if rs >= 0.45 and ra:
            # 用右锚微调：右锚首字在ctx中的近似位置
            w0, _ = find_window(ra[:4], ctx)
            if 0 <= w0 <= 6:
                g = lp + len(la) + w0 - 1  # 右锚前1字≈□
        return {'file': fn, 'page': pg, 'joined': joined, 'meta': meta,
                'g': g, 'lscore': round(ls, 2), 'rscore': round(rs, 2)}
    return None

# ---------- 裁剪 ----------
def crop_spot(loc, span_before=5, span_after=9, half_cols=1.15):
    """按meta定位□槽，从300dpi页图裁出（含左右邻列）。返回(crop_path, meta_idx)"""
    fn, pg, meta, g = loc['file'], loc['page'], loc['meta'], loc['g']
    g = max(0, min(g, len(meta)-2))
    _, cx, yt, yb = meta[g]
    # 字高与列距估计
    hs = [b-a for (c, x, a, b) in meta[max(0, g-12):g+12] if b > a]
    ch_h = sorted(hs)[len(hs)//2] if hs else (yb-yt or 30)
    xs = sorted(x for (c, x, a, b) in meta)
    gaps = [b2-a2 for a2, b2 in zip(xs, xs[1:]) if 30 < b2-a2 < 300]
    pitch = sorted(gaps)[len(gaps)//2] if gaps else 170
    img = page_png(fn, pg, 300)
    k = 300/150
    from PIL import Image
    im = Image.open(img)
    W, H = im.size
    # y中心：槽位前后meta中点
    ys = [ (a+b)/2 for (c, x, a, b) in meta[max(0,g-span_before):g+span_after] ]
    yc = sorted(ys)[len(ys)//2] if ys else (yt+yb)/2
    x0 = max(0, int(cx*k - half_cols*pitch*k))
    x1 = min(W, int(cx*k + half_cols*pitch*k))
    y0 = max(0, int(yc*k - span_before*ch_h*k*1.3))
    y1 = min(H, int(yc*k + span_after*ch_h*k*1.3))
    out = os.path.join(TMP, 'crops', f"{fn[:8]}_p{pg}_g{g}.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    im.crop((x0, y0, x1, y1)).save(out)
    return out
