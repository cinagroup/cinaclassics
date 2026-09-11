# -*- coding: utf-8 -*-
"""库内平行本 □ 辅助补全：锚句定位。

对目标书每个 □：
  1) 取 □ 前最长连续 8 字（不含 □/标点断裂）作锚句
  2) 在平行本全文中 find，收集命中位置
  3) 若命中唯一，取平行本同位字符作候选补字
  4) 若命中多个，取同位字符众数（>50% 且一致）作候选
输出候选表（可人工审后转 fill_boxes 规则）。

用法:
  python align_parallel.py <目标书.md> <平行本.md> <输出.tsv>
"""
import re
import sys
from collections import Counter
from pathlib import Path

def load(p):
    return Path(p).read_text(encoding="utf-8")

def anchor(t, i, n=8):
    """取 □ 前最近 n 个连续汉字（跳过 □、标点、空白、校勘记号）。"""
    j = i - 1
    buf = []
    while j >= 0 and len(buf) < n:
        c = t[j]
        if c == "□" or c.isspace() or c in "，。、；：！？（）《》【】「」『』“”‘’…—·<>\"'":
            buf = []
        else:
            buf.append(c)
        j -= 1
    return "".join(reversed(buf[-n:]))

def main():
    target, parallel, outfile = sys.argv[1], sys.argv[2], sys.argv[3]
    t = load(target)
    p = load(parallel)
    pos = [m.start() for m in re.finditer("□", t)]
    lines = []
    n_ok = n_multi = n_miss = 0
    for i in pos:
        a = anchor(t, i)
        if len(a) < 6:
            lines.append(f"{i}\t?\t锚不足:«{a}»\t{t[max(0,i-14):i+12]}")
            n_miss += 1
            continue
        hits = [m.start() for m in re.finditer(re.escape(a), p)]
        if not hits:
            lines.append(f"{i}\t?\t锚未命中:«{a}»\t{t[max(0,i-14):i+12]}")
            n_miss += 1
            continue
        cands = []
        for h in hits:
            off = i - (len(a))  # □ 相对锚起点偏移（锚紧贴 □ 左侧）
            k = h + (i - anchor_start_offset(t, i, a))
            if k < len(p) and p[k] not in "□ \n":
                cands.append(p[k])
        if not cands:
            lines.append(f"{i}\t?\t命中但同位非字:«{a}»\t{t[max(0,i-14):i+12]}")
            n_miss += 1
            continue
        cc = Counter(cands)
        top, cnt = cc.most_common(1)[0]
        if len(hits) == 1 or (cnt >= len(hits) * 0.6):
            lines.append(f"{i}\t{top}\t«{a}»同位{top}×{cnt}/{len(hits)}\t{t[max(0,i-14):i+12]}")
            n_ok += 1
        else:
            lines.append(f"{i}\t?[{top}]\t«{a}»同位分散{cc.most_common(3)}\t{t[max(0,i-14):i+12]}")
            n_multi += 1
    Path(outfile).write_text("\n".join(lines), encoding="utf-8")
    print(f"□ 共 {len(pos)}；候选 {n_ok} / 分散 {n_multi} / 未命中 {n_miss}；输出 {outfile}")

def anchor_start_offset(t, i, a):
    """□ 左侧紧邻锚串起点与 □ 的偏移。"""
    j = i - 1
    buf = []
    while j >= 0 and len(buf) < len(a):
        c = t[j]
        if c == "□" or c.isspace() or c in "，。、；：！？（）《》【】「」『』“”‘’…—·<>\"'":
            buf = []
        else:
            buf.append(c)
        j -= 1
    return i - (j + 1)

if __name__ == "__main__":
    main()
