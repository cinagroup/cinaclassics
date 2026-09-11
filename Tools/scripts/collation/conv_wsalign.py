# -*- coding: utf-8 -*-
"""ws_align2 候选 → fill_boxes 规则文件转换。

输入 bqs_ws_align2.tsv（Pos=卷号:卷内偏移, Cand, Conf, ...）
输出 fill_boxes 规则: N:<全局序号>\t<候选>\t<依据>

依据 = "ws点校本对齐(置信X)"；另输出可疑清单（双□邻居、罕见字）。
用法: python conv_wsalign.py <库内.md> <候选.tsv> <规则.tsv> <可疑.tsv>
"""
import re
import sys
from pathlib import Path
from collections import Counter

JUAN_RE = re.compile(r"第([一二三四五六七八九十百]+)卷")
CN = "一二三四五六七八九十"

def cn_to_int(s):
    if s in "一二三四五六七八九":
        return CN.index(s) + 1
    if s == "十":
        return 10
    if "十" in s:
        a, b = s.split("十")
        return (CN.index(a) + 1) * 10 + (CN.index(b) + 1 if b else 0)
    return None

def main():
    local_p, cand_p, rule_p, susp_p = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    t = Path(local_p).read_text(encoding="utf-8")
    ms = list(JUAN_RE.finditer(t))
    juan_ranges = {}
    for k, m in enumerate(ms):
        jno = cn_to_int(m.group(1))
        juan_ranges[jno] = (m.start(), ms[k + 1].start() if k + 1 < len(ms) else len(t))
    box_order = {}
    for n, m in enumerate(re.finditer("□", t), 1):
        box_order[m.start()] = n
    rows = []
    for line in Path(cand_p).read_text(encoding="utf-8").splitlines():
        c = line.split("\t")
        if len(c) < 3:
            continue
        pos_s, cand, conf = c[0], c[1], c[2]
        if cand == "?":
            continue
        jn_s, off = pos_s.split(":")
        jn = cn_to_int(jn_s)
        off = int(off)
        conf = int(conf)
        if jn is None or jn not in juan_ranges:
            continue
        start, end = juan_ranges[jn]
        off_g = start + off
        if not (start <= off_g < end) or off_g not in box_order:
            continue
        rows.append((box_order[off_g], off_g, cand, conf))
    rules = []
    susp = []
    for seq, off_g, cand, conf in rows:
        rules.append(f"N:{seq}\t{cand}\tws点校本对齐(置信{conf})")
        pre = t[off_g - 1] if off_g > 0 else ""
        suf = t[off_g + 1] if off_g + 1 < len(t) else ""
        ctx = t[max(0, off_g - 12): off_g + 12].replace("\n", " ")
        if pre == "□" or suf == "□":
            susp.append(f"{seq}\t{cand}\t双□邻居\t{ctx}")
    Path(rule_p).write_text("\n".join(rules) + "\n", encoding="utf-8")
    Path(susp_p).write_text("\n".join(susp) + "\n" if susp else "", encoding="utf-8")
    print(f"规则 {len(rules)} 条 → {rule_p}")
    print(f"可疑 {len(susp)} 条 → {susp_p}")

if __name__ == "__main__":
    main()
