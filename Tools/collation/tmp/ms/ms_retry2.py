# -*- coding: utf-8 -*-
"""并行重试定位失败处"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ms_locate as M
from multiprocessing import Pool

def retry_one(idx, spots):
    s = spots[idx]
    fn = M.file_for(s['vol'])
    if fn is None: return None
    la = M.norm(M.hant(s['left']))[-8:]
    ra = M.norm(M.hant(s['right']))[:8]
    if len(la) < 3: return None
    p0 = M.est_page(s['vol'], M.spot_frac(s))
    pc = M.get_doc(fn).page_count
    cands = []
    for ring in range(0, 15):
        for pg in ([p0] if ring==0 else [p0-ring, p0+ring]):
            if 0 <= pg < pc: cands.append(pg)
    return fn, la, ra, cands

def main():
    spots = json.load(open(os.path.join(M.TMP, '..', 'ms_spots.json'), encoding='utf-8'))
    locs = json.load(open(os.path.join(M.TMP, 'ms_locs.json'), encoding='utf-8'))
    fails = [int(k) for k, v in locs.items() if not v]
    print('失败数:', len(fails), flush=True)
    # 收集所有需要的页
    plan = {}
    tasks = []
    for idx in fails:
        s = spots[idx]
        fn = M.file_for(s['vol'])
        if fn is None: continue
        p0 = M.est_page(s['vol'], M.spot_frac(s))
        pc = M.get_doc(fn).page_count
        pgs = []
        for ring in range(0, 13):
            for pg in ([p0] if ring==0 else [p0-ring, p0+ring]):
                if 0 <= pg < pc: pgs.append(pg)
        plan[idx] = (fn, pgs)
        tasks += [(fn, pg, 150) for pg in pgs]
    tasks = sorted(set(tasks))
    print('需OCR:', len(tasks), flush=True)
    with Pool(10) as pool:
        done_n = 0
        for fn, pidx, dpi, items in pool.imap_unordered(M._ocr_one, tasks, chunksize=4):
            M._pack(f'{fn}|{pidx}|{dpi}', items)
            done_n += 1
            if done_n % 100 == 0:
                M.save_cache()
                print(f'OCR {done_n}/{len(tasks)}', flush=True)
    M.save_cache()
    # 定位
    ok = 0
    for idx in fails:
        s = spots[idx]
        fn, pgs = plan.get(idx, (None, []))
        if fn is None: continue
        la = M.norm(M.hant(s['left']))[-8:]
        ra = M.norm(M.hant(s['right']))[:8]
        if len(la) < 3: continue
        found = None
        for pg in pgs:
            joined, meta = M.ocr_page(fn, pg)
            lp, ls = M.find_window(la, joined)
            if ls > 0.72:
                ctx = joined[lp+len(la): lp+len(la)+14]
                rs = M.lcs_score(ra, ctx) if ra else 1.0
                if rs < 0.3 and pg != pgs[0]: continue
                g = lp + len(la)
                crop = M.crop_spot({'file': fn, 'page': pg, 'meta': meta, 'g': g})
                locs[str(idx)] = {'page': pg, 'g': g, 'lscore': round(ls,2), 'rscore': round(rs,2),
                                  'crop': os.path.basename(crop), 'ctx': joined[max(0,g-10):g+10], 'retry': True}
                found = True
                ok += 1
                break
        if not found:
            print(f'idx{idx} 仍失败', flush=True)
    json.dump(locs, open(os.path.join(M.TMP, 'ms_locs.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    M.save_cache()
    print('重试定位成功:', ok, flush=True)

if __name__ == '__main__':
    main()
