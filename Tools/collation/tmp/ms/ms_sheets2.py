# -*- coding: utf-8 -*-
"""contact sheet v2：紧凑重裁+红标□槽+简体上下文标注
用法: python ms_sheets2.py <begin> <end> [per=30]"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ms_locate as M
from PIL import Image, ImageDraw, ImageFont

FONT = r'C:\Windows\Fonts\msyh.ttc'

def tight_crop(loc, before=2.5, after=4.5, half_cols=0.62):
    """从缓存OCR重建紧凑裁剪，红标□槽"""
    joined, meta = M.ocr_page(loc['file'], loc['page'], 150)
    g = max(0, min(loc['g'], len(meta)-2))
    _, cx, yt, yb = meta[g]
    hs = [b-a for (c, x, a, b) in meta[max(0, g-12):g+12] if b > a]
    ch_h = sorted(hs)[len(hs)//2] if hs else 30
    xs = sorted(x for (c, x, a, b) in meta)
    gaps = [b2-a2 for a2, b2 in zip(xs, xs[1:]) if 30 < b2-a2 < 300]
    pitch = sorted(gaps)[len(gaps)//2] if gaps else 170
    k = 300/150
    im = Image.open(M.page_png(loc['file'], loc['page'], 300))
    W, H = im.size
    # 槽中心y：meta[g-1]底与meta[g]顶的中点（容忍OCR丢字）
    a_prev = meta[g-1][3] if g > 0 else yt - ch_h
    yc = (a_prev + yt)/2 if a_prev < yt else (yt+yb)/2 - ch_h/2
    x0 = max(0, int(cx*k - half_cols*pitch*k))
    x1 = min(W, int(cx*k + half_cols*pitch*k))
    y0 = max(0, int(yc*k - before*ch_h*k*1.15))
    y1 = min(H, int(yc*k + after*ch_h*k*1.15))
    crop = im.crop((x0, y0, x1, y1))
    # 红标：槽y位置（左边缘）
    d = ImageDraw.Draw(crop)
    ymark = int(yc*k - y0)
    d.line([(0, ymark), (14, ymark)], fill='red', width=6)
    d.line([(crop.width-14, ymark), (crop.width, ymark)], fill='red', width=6)
    return crop

def main(lo, hi, per=30, cols=5):
    spots = json.load(open(os.path.join(M.TMP, '..', 'ms_spots.json'), encoding='utf-8'))
    locs = json.load(open(os.path.join(M.TMP, 'ms_locs.json'), encoding='utf-8'))
    outdir = os.path.join(M.TMP, 'sheets2')
    os.makedirs(outdir, exist_ok=True)
    f_label = ImageFont.truetype(FONT, 26)
    f_ctx = ImageFont.truetype(FONT, 21)
    idxs = [i for i in range(lo, min(hi, len(spots))) if locs.get(str(i))]
    n_sheet = 0
    for k in range(0, len(idxs), per):
        group = idxs[k:k+per]
        rows = (len(group)+cols-1)//cols
        CW, CH = 335, 570
        sheet = Image.new('RGB', (cols*CW, rows*CH), 'white')
        d = ImageDraw.Draw(sheet)
        for n, i in enumerate(group):
            r, c = divmod(n, cols)
            x0, y0 = c*CW, r*CH
            try:
                L = dict(locs[str(i)])
                L.setdefault('file', M.file_for(spots[i]['vol']))
                im = tight_crop(L)
            except Exception as e:
                print(f'#{i} 裁剪失败 {e}')
                continue
            th = 400
            tw = min(CW-14, int(im.width*th/im.height))
            im2 = im.resize((tw, th), Image.LANCZOS)
            sheet.paste(im2, (x0+5, y0+50))
            d.rectangle([x0, y0+2, x0+120, y0+30], fill='red')
            d.text((x0+6, y0+4), f'#{i}', font=f_label, fill='white')
            ctx = s_ctx = spots[i]['ctx'].replace('\u3000', '')
            d.text((x0+4, y0+456), ctx[:16], font=f_ctx, fill='blue')
            d.text((x0+4, y0+482), ctx[16:32], font=f_ctx, fill='blue')
            L = locs[str(i)]
            d.text((x0+4, y0+510), f"p{L['page']} 左{L['lscore']} 右{L['rscore']}", font=f_ctx, fill='gray')
        out = os.path.join(outdir, f's2_{lo:03d}_{n_sheet:02d}.png')
        sheet.save(out)
        print(out, 'spots:', group[0], '-', group[-1], f'({len(group)})')
        n_sheet += 1

if __name__ == '__main__':
    main(int(sys.argv[1]), int(sys.argv[2]),
         int(sys.argv[3]) if len(sys.argv) > 3 else 30,
         int(sys.argv[4]) if len(sys.argv) > 4 else 5)
