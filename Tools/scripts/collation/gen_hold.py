# -*- coding: utf-8 -*-
"""导出当前文件剩余 □ 挂账明细（位置+上下文，供后续图版/点校本核补）。"""
import re
from pathlib import Path

base = Path(r"E:\cinagroup\cinaclassics")
t = (base / "史藏/正史/北齐书.md").read_text(encoding="utf-8")

out = []
n = 0
for m in re.finditer("□", t):
    n += 1
    i = m.start()
    ctx = t[max(0, i - 16): i + 17].replace("\n", " ")
    out.append(f"{n}\t{i}\t{ctx}")

p = base / "Tools/collation/tmp/北齐书_挂账265条.tsv"
p.write_text("\n".join(out) + "\n", encoding="utf-8")
print(f"挂账明细 {n} 条 → {p}")
