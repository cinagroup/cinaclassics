# -*- coding: utf-8 -*-
"""哨兵单遍应用定谳结果 v2：统一 old→new 模型
ms_reads.json: {idx: {"old": "□"|"□普"|..., "new": "旃"|""|"𣚴"|..., "note": "..."}}
用法: python ms_apply.py [--dry]"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ms_locate as M

def main(dry=False):
    spots = json.load(open(os.path.join(M.TMP, '..', 'ms_spots.json'), encoding='utf-8'))
    reads = json.load(open(os.path.join(M.TMP, 'ms_reads.json'), encoding='utf-8'))
    byline = {}
    for k, v in sorted(reads.items(), key=lambda kv: int(kv[0])):
        byline.setdefault(spots[int(k)]['line'], []).append((spots[int(k)]['col'], int(k), v))
    lines = open(M.MD, encoding='utf-8').read().split('\n')
    applied = {}
    for li, fixes in sorted(byline.items()):
        fixes.sort(key=lambda t: t[0])
        line = lines[li-1]
        pos = 0
        ok = True
        for col, idx, v in fixes:
            old, new = v['old'], v['new']
            p = line.find(old, pos)
            if p < 0:
                print(f'L{li} idx{idx}: 未找到 [{old}] 自位{pos}')
                ok = False
                continue
            line = line[:p] + new + line[p+len(old):]
            pos = p + len(new)
            applied[idx] = new
        if ok:
            lines[li-1] = line
    print(f'应用 {len(applied)}/{len(reads)} 处')
    if dry:
        for idx in sorted(applied, key=int)[:40]:
            print(' ', idx, reads[str(idx)]['old'], '->', applied[idx] or '(删)')
        return
    if applied:
        open(M.MD, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
        json.dump(applied, open(os.path.join(M.TMP, 'ms_applied.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
        remain = open(M.MD, encoding='utf-8').read().count('□')
        print(f'明史.md 残余□: {remain}')

if __name__ == '__main__':
    main('--dry' in sys.argv)
