# -*- coding: utf-8 -*-
"""藏外试点：执行确认的勘误修改"""
import os

ROOT = r"E:\cinagroup\cinaclassics\佛藏\藏外"
OUT = r"E:\cinagroup\cinaclassics\佛藏\.workbuddy\kanwu"

FIXES = [
    # (文件, 旧, 新, 预期次数)
    ("六组坛经.md", "菩提自性，本水清净，但用此心", "菩提自性，本自清净，但用此心", 1),
    ("敦煌变文集新书.md", "具足云□舍利佛怛罗，此云身子", "具足云□舍利弗怛罗，此云身子", 1),
    ("神会禅话录.md", "天女语舍利佛云：凡夫於佛法有返覆", "天女语舍利弗云：凡夫於佛法有返覆", 1),
]

RENAME = ("六组坛经.md", "六祖坛经.md")

log = []
for fname, old, new, expect in FIXES:
    p = os.path.join(ROOT, fname)
    text = open(p, encoding="utf-8").read()
    n = text.count(old)
    if n != expect:
        log.append(f"[跳过] {fname}: 匹配 {n} 次(预期 {expect})，未修改")
        continue
    open(p, "w", encoding="utf-8").write(text.replace(old, new))
    log.append(f"[已改] {fname}: 「{old}」->「{new}」")

# 文件名更正
src, dst = (os.path.join(ROOT, f) for f in RENAME)
if os.path.exists(src) and not os.path.exists(dst):
    os.rename(src, dst)
    log.append(f"[已改名] {RENAME[0]} -> {RENAME[1]}")
else:
    log.append(f"[跳过改名] 源不存在或目标已存在: {RENAME}")

print("\n".join(log))
