# -*- coding: utf-8 -*-
"""□ 补全工作台：模式统计 + 补字表应用。

用法:
  1) python fill_boxes.py <书.md> stats
     输出 □ 的高频上下文模式（前后各 2 字）与孤立样本清单
  2) python fill_boxes.py <书.md> apply <规则文件.tsv>
     规则文件每行: 序号或模式<TAB>补字<TAB>依据
     模式格式： `前2字|后2字`（□ 前后各 2 字精确匹配）；或 `^P:前2字|后2字`（前 1 字=P）
     或 `N:12` 按序号（顺序=文件内 □ 出现序）
  3) python fill_boxes.py <书.md> apply --regex <规则文件>
     规则文件每行: 正则<TAB>替换<TAB>依据（对全文 regex.sub）
"""
import re
import sys
from pathlib import Path
from collections import Counter

def load(path):
    return Path(path).read_text(encoding="utf-8")

def box_positions(t):
    return [m.start() for m in re.finditer("□", t)]

def stats(path):
    t = load(path)
    pos = box_positions(t)
    print(f"□ 总数: {len(pos)}")
    # 前2后2 模式
    pat = Counter()
    pat_ex = {}
    for i in pos:
        pre = t[max(0, i - 2):i]
        suf = t[i + 1:i + 3]
        key = f"{pre}|{suf}"
        pat[key] += 1
        if key not in pat_ex:
            pat_ex[key] = t[max(0, i - 10):i + 12].replace("\n", "⏎")
    print(f"\n高频模式（前2|后2）:")
    for k, c in pat.most_common(60):
        print(f"  {c:4d}  {k}  ← {pat_ex[k]}")
    # 单侧模式
    print("\n前1字分布:")
    pre1 = Counter(t[i - 1] if i > 0 else "∅" for i in pos)
    for k, c in pre1.most_common(30):
        print(f"  {c:4d}  {k!r}")
    print("\n后1字分布:")
    suf1 = Counter(t[i + 1] if i + 1 < len(t) else "∅" for i in pos)
    for k, c in suf1.most_common(30):
        print(f"  {c:4d}  {k!r}")

def apply_rules(path, rules_file, by_index=False):
    t = load(path)
    pos = box_positions(t)
    rules = []
    for line in Path(rules_file).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        rules.append((parts[0], parts[1], parts[2] if len(parts) > 2 else ""))
    # 序号模式（N:nn）
    idx_rules = {int(r[0][2:]): (r[1], r[2]) for r in rules if r[0].startswith("N:")}
    # 双字模式（pre|suf）
    pat_rules = {}
    for key, val, why in rules:
        if "|" in key and not key.startswith("N:"):
            pat_rules[key] = (val, why)
    # 单前字模式（^P:）
    pre1_rules = {}
    for key, val, why in rules:
        if key.startswith("^") and ":" in key:
            pre1_rules[key[1:key.index(":")]] = (val, why)

    applied = []
    matched_idx = {}
    for n, i in enumerate(pos, 1):
        if n in idx_rules:
            new, why = idx_rules[n]
            matched_idx[i] = (new, why, f"N:{n}")
    for i in pos:
        if i in matched_idx:
            continue
        pre = t[max(0, i - 2):i]
        suf = t[i + 1:i + 3]
        key = f"{pre}|{suf}"
        if key in pat_rules:
            matched_idx[i] = (pat_rules[key][0], pat_rules[key][1], key)
            continue
        p1 = t[i - 1] if i > 0 else "∅"
        if p1 in pre1_rules:
            matched_idx[i] = (pre1_rules[p1][0], pre1_rules[p1][1], f"^{p1}:")

    n_applied = 0
    log = []
    for i, (new, why, key) in sorted(matched_idx.items(), key=lambda x: -x[0]):
        if t[i] != "□":
            continue
        c = t[max(0, i - 12):i + 12].replace("\n", "⏎")
        t = t[:i] + new + t[i + 1:]
        n_applied += 1
        log.append(f"FIX | {key} | {new} | {why} | …{c}…")
    Path(path).write_text(t, encoding="utf-8")
    logpath = Path(path).parent.parent.parent / "Tools" / "collation" / "tmp" / f"fill_{Path(path).stem}.log"
    logpath.write_text("\n".join(log), encoding="utf-8")
    print(f"已应用 {n_applied} 处 / 总 {len(pos)}；日志 {logpath}")
    print(f"未匹配（需人工）: {len(pos) - n_applied}")

def apply_regex(path, rules_file):
    t = load(path)
    n = 0
    log = []
    for line in Path(rules_file).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        pat, rep, why = (line.split("\t") + ["", ""])[:3]
        for mt in re.finditer(pat, t):
            c = t[max(0, mt.start() - 10):mt.end() + 10].replace("\n", "⏎")
            log.append(f"FIX | {pat} | {rep} | {why} | …{c}…")
        t, cnt = re.subn(pat, rep, t)
        n += cnt
    Path(path).write_text(t, encoding="utf-8")
    logpath = Path(path).parent.parent.parent / "Tools" / "collation" / "tmp" / f"fill_{Path(path).stem}.log"
    logpath.write_text("\n".join(log), encoding="utf-8")
    print(f"正则替换 {n} 处；日志 {logpath}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    path = sys.argv[1]
    mode = sys.argv[2]
    if mode == "stats":
        stats(path)
    elif mode == "apply":
        rules = sys.argv[3]
        apply_rules(path, rules)
    elif mode == "apply-regex":
        rules = sys.argv[3]
        apply_regex(path, rules)
