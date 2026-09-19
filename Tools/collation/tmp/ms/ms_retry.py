# -*- coding: utf-8 -*-
"""定位失败处重试：短锚+宽跨距；仍失败则给出估页±2的整带裁剪供人工翻检
用法: python ms_retry.py"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ms_locate as M

def retry_one(idx, spots):
    s = spots[idx]
    fn = M.file_for(s['vol'])
    if fn is None:
        return None
    la = M.norm(M.hant(s['left']))[-5:]
    ra = M.norm(M.hant(s['right']))[:5]
    if len(la) < 3:
        return None
    p0 = M.est_page(s['vol'], M.spot_frac(s))
    pc = M.get_doc(fn).page_count
    best = None
    for delta in list(range(0, 13)) + list(range(-1, -14, -1)):
        pg = p0 + delta
        if pg < 0 or pg >= pc:
            continue
        joined, meta = M.ocr_page(fn, pg)
        # 短锚滑找：左5字LCS
        lp, ls = M.find_window(la, joined)
        if ls < 0.75:
            continue
        ctx = joined[lp+len(la): lp+len(la)+14]
        rs = M.lcs_score(ra, ctx) if ra else 1.0
        cand = {'file': fn, 'page': pg, 'joined': joined, 'meta': meta,
                'g': lp+len(la), 'lscore': round(ls, 2), 'rscore': round(rs, 2)}
        if rs >= 0.5:
            return cand
        if best is None or ls > best['lscore']:
            best = cand
    return best

def main():
    spots = json.load(open(os.path.join(M.TMP, '..', 'ms_spots.json'), encoding='utf-8'))
    locs = json.load(open(os.path.join(M.TMP, 'ms_locs.json'), encoding='utf-8'))
    fails = [int(k) for k, v in locs.items() if not v]
    print('失败数:', len(fails))
    for idx in fails:
        r = retry_one(idx, spots)
        if r:
            crop = M.crop_spot(r)
            locs[str(idx)] = {'page': r['page'], 'g': r['g'], 'lscore': r['lscore'],
                              'rscore': r['rscore'], 'crop': os.path.basename(crop),
                              'ctx': r['joined'][max(0, r['g']-12):r['g']+12], 'retry': True}
            print(f'idx{idx} 重试定位 p{r["page"]} 左{r["lscore"]} 右{r["rscore"]}')
        else:
            print(f'idx{idx} 仍失败 卷{spots[idx]["vol"]} L{spots[idx]["line"]}')
    json.dump(locs, open(os.path.join(M.TMP, 'ms_locs.json'), 'w', encoding='utf-8'), ensure_ascii=False)

if __name__ == '__main__':
    main()
