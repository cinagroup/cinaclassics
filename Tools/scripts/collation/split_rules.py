# -*- coding: utf-8 -*-
"""从 fill_北齐书_ws.tsv 拆分干净应用集/置信1/乱码/双□。"""
import re
from pathlib import Path

base = Path(r"E:\cinagroup\cinaclassics")
t = (base / "史藏/正史/北齐书.md").read_text(encoding="utf-8")
garble_zones = [(181500, 182900), (251900, 252300), (258000, 258500), (281200, 281600)]
rules = (base / "Tools/collation/tmp/fill_北齐书_ws.tsv").read_text(encoding="utf-8").splitlines()

box_pos = {}
n = 0
for m in re.finditer("□", t):
    n += 1
    box_pos[n] = m.start()

clean, conf1, garble, dbl = [], [], [], []
for line in rules:
    parts = line.split("\t")
    if len(parts) < 3:
        continue
    seq = int(parts[0][2:])
    cand = parts[1]
    why = parts[2]
    pos = box_pos.get(seq)
    if pos is None:
        continue
    in_garble = any(s <= pos <= e for s, e in garble_zones)
    pre = t[pos - 1] if pos > 0 else ""
    suf = t[pos + 1] if pos + 1 < len(t) else ""
    is_dbl = (pre == "□" or suf == "□")
    if "置信2" not in why:
        conf1.append(line)
    elif in_garble:
        garble.append(line)
    elif is_dbl:
        dbl.append(line)
    else:
        clean.append(line)

tmp = base / "Tools/collation/tmp"
(tmp / "fill_北齐书_clean.tsv").write_text("\n".join(clean) + "\n", encoding="utf-8")
(tmp / "fill_北齐书_conf1.tsv").write_text("\n".join(conf1) + "\n", encoding="utf-8")
(tmp / "fill_北齐书_garble.tsv").write_text("\n".join(garble) + "\n", encoding="utf-8")
(tmp / "fill_北齐书_dbl.tsv").write_text("\n".join(dbl) + "\n", encoding="utf-8")
print(f"干净集(置信2非双□非乱码): {len(clean)}")
print(f"置信1待人工: {len(conf1)}")
print(f"乱码区剔除: {len(garble)}")
print(f"双□待人工: {len(dbl)}")
