# -*- coding: utf-8 -*-
"""大字zoom拼图：每张12处，字形大便于精读
用法: python ms_zoomsheet.py <begin> <end> [tag]"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ms_locate as M
from ms_sheets2 import tight_crop
from PIL import Image, ImageDraw, ImageFont

FONT = r'C:\Windows\Fonts\msyh.ttc'

def main(lo, hi, tag='a'):
    spots = json.load(open(os.path.join(M.TMP, '..', 'ms_spots.json'), encoding='utf-8'))
    locs = json.load(open(os.path.join(M.TMP, 'ms_locs.json'), encoding='utf-8'))
    reads = json.load(open(os.path.join(M.TMP, 'ms_reads.json'), encoding='utf-8'))
    done = set(int(k) for k in reads)
    outdir = os.path.join(M.TMP, 'zoomsheets')
    os.makedirs(outdir, exist_ok=True)
    f_lab = ImageFont.truetype(FONT, 22)
    f_ctx = ImageFont.truetype(FONT, 18)
    idxs = [i for i in range(lo, min(hi, len(spots)))
            if locs.get(str(i)) and i not in done]
    n = 0
    per, cols = 12, 4
    for k in range(0, len(idxs), per):
        group = idxs[k:k+per]
        rows = (len(group)+cols-1)//cols
        CW, CH = 300, 590
        sheet = Image.new('RGB', (cols*CW, rows*CH), 'white')
        d = ImageDraw.Draw(sheet)
        for m, i in enumerate(group):
            r, c = divmod(m, cols)
            x0, y0 = c*CW, r*CH
            L = dict(locs[str(i)])
            L.setdefault('file', M.file_for(spots[i]['vol']))
            try:
                im = tight_crop(L, before=2.2, after=2.2, half_cols=0.62)
            except Exception as e:
                print(f'#{i} crop fail {e}')
                continue
            th = 400
            tw = min(CW-10, max(90, int(im.width*th/im.height)))
            im2 = im.resize((tw, th), Image.LANCZOS)
            sheet.paste(im2, (x0+5, y0+46))
            d.rectangle([x0, y0+2, x0+110, y0+28], fill='red')
            d.text((x0+6, y0+4), f'#{i}', font=f_lab, fill='white')
            ctx = spots[i]['ctx'].replace('\u3000','').replace('□','※')
            d.text((x0+4, y0+452), ctx[:16], font=f_ctx, fill='blue')
            d.text((x0+4, y0+476), ctx[16:32], font=f_ctx, fill='blue')
            Lx = locs[str(i)]
            d.text((x0+4, y0+504), f"p{Lx['page']} 左{Lx['lscore']} 右{Lx['rscore']}", font=f_ctx, fill='gray')
        out = os.path.join(outdir, f'zs_{tag}_{n:02d}.png')
        sheet.save(out)
        print(out, 'idx:', group)
        n += 1

if __name__ == '__main__':
    main(int(sys.argv[1]), int(sys.argv[2]), sys.argv[3] if len(sys.argv) > 3 else 'a')
