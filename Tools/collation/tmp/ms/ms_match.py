# -*- coding: utf-8 -*-
"""印本字形×字体候选 模板匹配器
输入: idx( spots序号) + 候选码位范围 → 输出 top10 对照图
用法: python ms_match.py <idx> <cp_lo> <cp_hi> [<cp_lo2> <cp_hi2> ...]"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ms_locate as M
from PIL import Image, ImageDraw, ImageFont
import numpy as np

fa = ImageFont.truetype(r'E:\cinagroup\cinaclassics\Tools\fonts\HanaMinA.ttf', 60)
fb = ImageFont.truetype(r'E:\cinagroup\cinaclassics\Tools\fonts\HanaMinB.ttf', 60)

def glyph_img(cp, size=64):
    im = Image.new('L', (80, 80), 255)
    d = ImageDraw.Draw(im)
    try:
        d.text((8, 4), chr(cp), font=(fb if cp > 0x20000 else fa), fill=0)
    except Exception:
        return None
    a = np.asarray(im)
    if (a < 128).sum() < 20:
        return None  # 无字形
    # 归一化：裁剪到内容并缩放
    ys, xs = np.where(a < 128)
    box = a[ys.min():ys.max()+1, xs.min():xs.max()+1]
    gi = Image.fromarray(box).resize((size, size), Image.LANCZOS)
    return np.asarray(gi, dtype=np.float32)

def print_glyph(idx, spots, locs, pad=0.52):
    L = dict(locs[str(idx)])
    fn = L.get('file') or M.file_for(spots[idx]['vol'])
    joined, meta = M.ocr_page(fn, L['page'], 150)
    g = max(1, min(locs[str(idx)]['g'], len(meta)-1))
    _, cx, yt, yb = meta[g]
    a_prev = meta[g-1][3] if g > 0 else yt - 30
    ch_h = 30
    hs = [b-a for (c, x, a, b) in meta[max(0, g-12):g+12] if b > a]
    if hs: ch_h = sorted(hs)[len(hs)//2]
    yc = (a_prev + yt)/2 if a_prev < yt else (yt+yb)/2 - ch_h/2
    k = 300/150
    im = Image.open(M.page_png(fn, L['page'], 300)).convert('L')
    W, H = im.size
    r = int(ch_h*k*pad)
    box = (max(0, int(cx*k)-r), max(0, int(yc*k)-r), min(W, int(cx*k)+r), min(H, int(yc*k)+r))
    crop = im.crop(box)
    a = np.asarray(crop)
    thr = (a.max()//2 if a.max() < 200 else 128)
    mask = a < 140
    if mask.sum() < 30:
        return None, crop
    ys, xs = np.where(mask)
    sub = a[ys.min():ys.max()+1, xs.min():xs.max()+1]
    gi = Image.fromarray(sub).resize((64, 64), Image.LANCZOS)
    return np.asarray(gi, dtype=np.float32), crop

def corr(a, b):
    a = a - a.mean(); b = b - b.mean()
    d = np.sqrt((a*a).sum() * (b*b).sum())
    return float((a*b).sum()/d) if d > 0 else 0.0

def main(idx, ranges):
    spots = json.load(open(os.path.join(M.TMP, '..', 'ms_spots.json'), encoding='utf-8'))
    locs = json.load(open(os.path.join(M.TMP, 'ms_locs.json'), encoding='utf-8'))
    pg, crop = print_glyph(idx, spots, locs)
    if pg is None:
        print('印本字形提取失败'); return
    cands = []
    for i in range(0, len(ranges)-1, 2):
        cands += list(range(int(ranges[i], 16), int(ranges[i+1], 16)))
    scored = []
    for cp in cands:
        gi = glyph_img(cp)
        if gi is None:
            continue
        scored.append((corr(pg, gi), cp))
    scored.sort(reverse=True)
    # 对照图
    lab = ImageFont.truetype(r'C:\Windows\Fonts\msyh.ttc', 16)
    cell = 130; cols = 6
    n = min(12, len(scored))
    rows = (n+1+cols-1)//cols
    sheet = Image.new('RGB', (cols*cell, rows*(cell+22)), 'white')
    d = ImageDraw.Draw(sheet)
    big = Image.fromarray(pg.astype(np.uint8)).resize((110, 110))
    sheet.paste(big.convert('RGB'), (6, 26))
    d.text((6, 4), 'PRINT', font=lab, fill='red')
    for k2, (sc, cp) in enumerate(scored[:n]):
        r, c = divmod(k2+1, cols)
        x, y = c*cell, r*(cell+22)
        gi = glyph_img(cp, 110)
        sheet.paste(Image.fromarray(gi.astype(np.uint8)).convert('RGB'), (x+6, y+26))
        d.text((x+6, y+4), f'{cp:05X} {sc:.2f}', font=lab, fill='blue')
    out = os.path.join(M.TMP, 'zoom', f'match_{idx}.png')
    sheet.save(out)
    print(out)
    for sc, cp in scored[:8]:
        print(f'  {cp:05X} {sc:.3f}')

if __name__ == '__main__':
    main(int(sys.argv[1]), sys.argv[2:])
