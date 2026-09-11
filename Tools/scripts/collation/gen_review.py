# -*- coding: utf-8 -*-
"""输出当前文件剩余 □ 的完整上下文清单（供人工定谳）。

剩余 □ 原序号 = 1..835 中不在已应用集 A 里的序号（按序）。
"""
import re
from pathlib import Path

base = Path(r"E:\cinagroup\cinaclassics")
t = (base / "史藏/正史/北齐书.md").read_text(encoding="utf-8")

orig_map = {}
for fname, tag in [("fill_北齐书_clean.tsv", "置信2✓"),
                   ("fill_北齐书_conf1.tsv", "置信1"),
                   ("fill_北齐书_dbl.tsv", "双□"),
                   ("fill_北齐书_garble.tsv", "乱码区")]:
    p = base / "Tools/collation/tmp" / fname
    if not p.exists():
        continue
    for line in p.read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            orig_map[int(parts[0][2:])] = (parts[1], tag)

A = {a for a, (c, tag) in orig_map.items() if tag == "置信2✓"}
remaining_orig = [j for j in range(1, 836) if j not in A]
assert len(remaining_orig) == len(re.findall("□", t)), \
    f"剩余序数 {len(remaining_orig)} != 实际 □ {len(re.findall('□', t))}"

out = []
for k, orig in enumerate(remaining_orig, 1):
    cand, tag = orig_map.get(orig, ("", "无候选"))
    # 定位：原序号 → 位置需按应用前文件；改用当前文件第 k 个 □ 位置
    pos = [m.start() for m in re.finditer("□", t)][k - 1]
    ctx = t[max(0, pos - 14): pos + 15].replace("\n", "⏎")
    out.append(f"{k}\t{orig}\t{cand}\t{tag}\t{ctx}")

p = base / "Tools/collation/tmp/fill_北齐书_剩余清单.tsv"
p.write_text("\n".join(out) + "\n", encoding="utf-8")
print(f"剩余 □ {len(out)} 条 → {p}")
