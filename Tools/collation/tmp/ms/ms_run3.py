# -*- coding: utf-8 -*-
"""明史□定位驱动 v3：按卷分簇+校准插值，最小化OCR页数
流程：每卷先定位首点(±9 walk)，其后各点按校准点插值±2预取+±3 walk"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ms_locate as M
from multiprocessing import Pool

OUT = os.path.join(M.TMP, 'ms_locs.json')

def flush(tasks, pool):
    """并行OCR缺失页"""
    c = M.ocr_cache()
    todo = sorted({t for t in tasks if f'{t[0]}|{t[1]}|{t[2]}' not in c})
    if not todo:
        return
    for fn, pidx, dpi, items in pool.imap_unordered(M._ocr_one, todo):
        M._pack(f'{fn}|{pidx}|{dpi}', items)
    M.save_cache()

def walk_locate(vol, frac, left, right, p0, max_ring, pool):
    """从p0向外环形walk，缺页先并行补"""
    fn = M.file_for(vol)
    if fn is None:
        return None
    la = M.norm(M.hant(left))[-8:]
    ra = M.norm(M.hant(right))[:8]
    if len(la) < 5:
        la = M.norm(M.hant(left))[-6:]
    if len(la) < 4:
        return None
    pc = M.get_doc(fn).page_count
    for ring in range(0, max_ring+1):
        pgs = {p0} if ring == 0 else {p0-ring, p0+ring}
        todo = [(fn, pg, 150) for pg in sorted(pgs) if 0 <= pg < pc]
        flush(todo, pool)
        for pg in sorted(pgs):
            if pg < 0 or pg >= pc:
                continue
            joined, meta = M.ocr_page(fn, pg)
            lp, ls = M.find_window(la, joined)
            if ls < 0.62:
                continue
            ctx = joined[lp+len(la): lp+len(la)+18]
            rs = M.lcs_score(ra, ctx) if ra else 1.0
            g = lp + len(la)
            if rs >= 0.45 and ra:
                w0, _ = M.find_window(ra[:4], ctx)
                if 0 <= w0 <= 6:
                    g = lp + len(la) + w0 - 1
            return {'file': fn, 'page': pg, 'joined': joined, 'meta': meta,
                    'g': g, 'lscore': round(ls, 2), 'rscore': round(rs, 2), 'ring': ring}
    return None

def main():
    spots = json.load(open(os.path.join(M.TMP, '..', 'ms_spots.json'), encoding='utf-8'))
    locs = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    # 按卷分组
    from collections import defaultdict
    byvol = defaultdict(list)
    for i, s in enumerate(spots):
        byvol[s['vol']].append(i)
    t0 = time.time()
    with Pool(10) as pool:
        for vol in sorted(byvol):
            idxs = byvol[vol]
            todo = [i for i in idxs if str(i) not in locs or locs[str(i)] is None]
            if not todo:
                continue
            print(f'卷{vol}: {len(todo)}处', flush=True)
            calib = []  # [(md_charpos, page)]
            cpp = None
            for i in todo:
                s = spots[i]
                if s['vol'] != vol:
                    continue
                cp = M.spot_frac(s) * M.vol_info(vol)['n'] if vol in M.VOLSEG else 0
                if calib:
                    # 分段线性插值页估计
                    calib.sort()
                    best = calib[0]
                    for c in calib:
                        if abs(c[0]-cp) < abs(best[0]-cp):
                            best = c
                    if cpp is None:
                        p_est = best[1]
                    else:
                        p_est = best[1] + round((cp-best[0])/cpp)
                else:
                    p_est = M.est_page(vol, M.spot_frac(s))
                r = walk_locate(vol, M.spot_frac(s), s['left'], s['right'], p_est,
                                9 if not calib else 4, pool)
                if r:
                    crop = M.crop_spot(r)
                    locs[str(i)] = {'page': r['page'], 'g': r['g'], 'lscore': r['lscore'],
                                    'rscore': r['rscore'], 'crop': os.path.basename(crop),
                                    'ctx': r['joined'][max(0, r['g']-12):r['g']+12]}
                    if calib:
                        x0, pg0 = calib[0]
                        if r['page'] != pg0:
                            cpp = max(60.0, (cp-x0)/(r['page']-pg0)) if cp != x0 else cpp
                    calib.append((cp, r['page']))
                else:
                    locs[str(i)] = None
                    print(f'  idx{i} L{s["line"]} 未定位', flush=True)
            json.dump(locs, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(locs, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    M.save_cache()
    ok = sum(1 for v in locs.values() if v)
    print(f'完成: {ok}/{len(locs)} 耗时{time.time()-t0:.0f}s')

if __name__ == '__main__':
    main()
