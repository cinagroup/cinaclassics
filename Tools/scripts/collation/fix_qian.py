# -*- coding: utf-8 -*-
"""乾→干 盲转系统订正（E 类）—— 前缀排除/三路规则版。

入库简繁转换将单字「乾」（乾卦）误转为「干」，仅保留「乾坤」固定词。
本脚本：
  1) 无歧义八卦术语整词替换（干为天/干宫/干卦/干坎/干为马/干为首 等）；
  2) 干阳 → 乾阳：排除合法「干」前缀（邪风热寒侵犯伤生口燥液火金水湿痰
     相上舌阴多或以其鼻咽渐未不陈触沴积来干阳花 等）后其余全部替换；
  3) 干金 三路：→千金（书/钱锚）、→乾金（卦象前后缀锚）、保留（干支/
     干燥/枝干/金银物名/人名地名官名 前后缀锚），未决记 REVIEW 保留；
  4) 全部决策写入审阅日志，git 可回退。

用法:
  python fix_qian.py dry    # 干跑
  python fix_qian.py apply  # 应用
"""
import re
import sys
from pathlib import Path

ROOT = Path(r"E:\cinagroup\cinaclassics")

# ---- 1. 无歧义八卦术语 ----
UNCOND = [
    ("干为天", "乾为天"),
    ("干三连", "乾三连"),
    ("干者健", "乾者健"),
    ("干为马", "乾为马"),
    ("干为首", "乾为首"),
    ("干为老父", "乾为老父"),
    ("干卦", "乾卦"),
    ("干坎", "乾坎"),
    ("单单单曰干", "单单单曰乾"),
]

# 干宫：乾宫（八卦/方位），除外 事/语/言+干宫（涉及宫禁宫闱）
QIANGONG_KEEP_PRE = "事语言"

# 干阳：合法「干」前缀（干犯/干燥/干支/人名等）
GANYANG_KEEP_PRE = "邪风热寒侵犯伤生口燥液火金水湿痰相上舌阴多或其鼻咽渐未不陈触沴积来干阳花支十隂陰盛草中余"
GANYANG_KEEP_SUF = "气色分"
# 以+干阳 特定干犯短语（保留），其余「以干阳」视为乾阳
GANYANG_KEEP_SPECIAL = ["足以干阳", "以干阳位", "可以干阳", "有以干阳也"]

# 干金 → 千金（书/钱）
QIANJIN_PRE = "《至掷一二三四五六七八九十两几多诸致累施购下数女满玩位重饭手骨入赀贻无出各"
QIANJIN_SUF = "云难内附苍乞买价方、外小薄聘相妆财进下筑躯弃骨骏来竟谁"
# 干金 → 乾金（卦象）
QIANJIN2_PRE = "肺象得隶一属先为点乎【指乘于在从因是引本丹"
QIANJIN2_SUF = "之为主不白宫得本旋在也短生枢藏"
# 干金 保留（干支/干燥/枝干/金银物名/地名/官名）
QIANJIN_KEEP_PRE = "若干如琼桧栋江阑总管天木干"
QIANJIN_KEEP_SUF = "山州陵银液乃铄燥樽猊塘井屈画铃运枝早防兵谷沙源城色"

# 特定短语（道藏金丹等）
SPECIFIC_QIANJIN = [
    "太阳干金", "干金出矿", "干金布坤", "干金初发", "干金是五金",
    "干金实是坎", "干金大劫", "本出干金", "干金防木",
]


def classify_gan(text):
    fixes, keeps, reviews = [], [], []

    def add_fix(s, e, new, reason):
        fixes.append((s, e, text[s:e], new, reason))

    def add_keep(s, e, reason, bucket="keep"):
        (keeps if bucket == "keep" else reviews).append((s, e, text[s:e], reason))

    # 1) 无歧义整词
    for pat, new in UNCOND:
        for m in re.finditer(re.escape(pat), text):
            add_fix(m.start(), m.end(), new, pat)

    # 兑干 → 兑乾（除外 兑干+病/药）
    for m in re.finditer(re.escape("兑干"), text):
        if m.end() < len(text) and text[m.end()] in "疥癣疮痫姜枣艾灰粉":
            add_keep(m.start(), m.end(), "兑干+病/药")
        else:
            add_fix(m.start(), m.end(), "兑乾", "兑干→兑乾")
    # 干宫 → 乾宫（除外 事/语/言+干宫 涉及宫禁）
    for m in re.finditer(re.escape("干宫"), text):
        pre = text[m.start() - 1] if m.start() > 0 else ""
        if pre and pre in QIANGONG_KEEP_PRE:
            add_keep(m.start(), m.end(), f"干宫(前{pre})")
        else:
            add_fix(m.start(), m.end(), "乾宫", "干宫→乾宫")
    # 巽干 → 巽乾
    for m in re.finditer(re.escape("巽干"), text):
        add_fix(m.start(), m.end(), "巽乾", "巽干→巽乾")
    # 干象 → 乾象（除外 干象粪）
    for m in re.finditer(re.escape("干象"), text):
        if m.end() < len(text) and text[m.end()] == "粪":
            add_keep(m.start(), m.end(), "干象粪")
        else:
            add_fix(m.start(), m.end(), "乾象", "干象→乾象")
    # 干纳甲 → 乾纳甲
    for m in re.finditer(re.escape("干纳"), text):
        if m.end() < len(text) and text[m.end()] == "甲":
            add_fix(m.start(), m.end(), "乾纳", "干纳甲→乾纳甲")
        else:
            add_keep(m.start(), m.end(), "干纳非甲")
    # 干一，兑 → 乾一，兑
    for m in re.finditer(re.escape("干一，"), text):
        if m.end() < len(text) and text[m.end()] == "兑":
            add_fix(m.start(), m.end(), "乾一，", "干一，兑→乾一，兑")
        else:
            add_keep(m.start(), m.end(), "干一非八卦")

    # 2) 干阳 → 乾阳（前缀排除）
    for m in re.finditer(re.escape("干阳"), text):
        s, e = m.start(), m.end()
        pre = text[s - 1] if s > 0 else ""
        suf2 = text[e:e + 2]
        sp_keep = False
        for sp in GANYANG_KEEP_SPECIAL:
            start = max(0, s - 4)
            seg = text[start:e + 4]
            idx = seg.find(sp)
            if idx >= 0 and start + idx <= s < start + idx + len(sp):
                sp_keep = True
                break
        if suf2 == "起石":
            add_keep(s, e, "干阳起石")
        elif sp_keep:
            add_keep(s, e, "干阳(以+干犯短语)")
        elif (pre and pre in GANYANG_KEEP_PRE) or (e < len(text) and text[e] in GANYANG_KEEP_SUF):
            add_keep(s, e, f"干阳(前{pre or '∅'}/后{text[e] if e < len(text) else '∅'})")
        else:
            add_fix(s, e, "乾阳", "干阳→乾阳")

    # 3) 干金 三路
    for m in re.finditer(re.escape("干金"), text):
        s, e = m.start(), m.end()
        pre = text[s - 1] if s > 0 else ""
        pre2 = text[max(0, s - 2):s]
        suf = text[e] if e < len(text) else ""
        sp_matched = False
        for sp in SPECIFIC_QIANJIN:
            start = max(0, s - 4)
            seg = text[start:e + 4]
            idx = seg.find(sp)
            if idx >= 0 and start + idx <= s < start + idx + len(sp):
                add_fix(s, e, "乾金", f"特定{sp}→乾金")
                sp_matched = True
                break
        if sp_matched:
            continue
        if (pre and pre in QIANJIN_PRE) or (suf and suf in QIANJIN_SUF) or pre2 == "一掷":
            add_fix(s, e, "千金", "干金→千金(书/钱)")
        elif (pre and pre in QIANJIN2_PRE) or (suf and suf in QIANJIN2_SUF):
            add_fix(s, e, "乾金", "干金→乾金(卦象)")
        elif (pre and pre in QIANJIN_KEEP_PRE) or (suf and suf in QIANJIN_KEEP_SUF):
            add_keep(s, e, f"干金(前{pre or '∅'}/后{suf or '∅'})")
        else:
            reviews.append((s, e, text[s:e], "干金未决"))

    return fixes, keeps, reviews


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "dry"
    fixlog, keeplog, revlog = [], [], []
    files = [p for p in ROOT.rglob("*.md")
             if "Tools" not in p.parts and p.name not in ("README.md", "使用须知.md", "校勘计划.md")]
    n_files = 0
    for f in files:
        t = f.read_text(encoding="utf-8")
        fixes, keeps, reviews = classify_gan(t)
        if not (fixes or keeps or reviews):
            continue
        n_files += 1
        key = f"{f.relative_to(ROOT)}"
        for s, e, old, new, reason in fixes:
            ctx = t[max(0, s - 12):e + 12].replace("\n", "⏎")
            fixlog.append(f"FIX | {key} | {reason} | {old}→{new} | …{ctx}…")
        for s, e, old, reason in keeps:
            ctx = t[max(0, s - 12):e + 12].replace("\n", "⏎")
            keeplog.append(f"KEEP | {key} | {reason} | …{ctx}…")
        for s, e, old, reason in reviews:
            ctx = t[max(0, s - 12):e + 12].replace("\n", "⏎")
            revlog.append(f"REVIEW | {key} | {reason} | …{ctx}…")

    from collections import Counter
    rc = Counter()
    for line in fixlog:
        rc[line.split(" | ")[2]] += 1
    print(f"波及文件: {n_files}")
    print(f"FIX: {len(fixlog)}  KEEP: {len(keeplog)}  REVIEW(保留待审): {len(revlog)}")
    print("按规则:")
    for r, c in rc.most_common():
        print(f"  {c:5d}  {r}")
    Path(r"Tools\collation\tmp\qian_fix3.txt").write_text("\n".join(fixlog), encoding="utf-8")
    Path(r"Tools\collation\tmp\qian_keep3.txt").write_text("\n".join(keeplog), encoding="utf-8")
    Path(r"Tools\collation\tmp\qian_review3.txt").write_text("\n".join(revlog), encoding="utf-8")
    if mode == "apply":
        n = 0
        for f in files:
            t = f.read_text(encoding="utf-8")
            fixes, _, _ = classify_gan(t)
            if not fixes:
                continue
            for s, e, old, new, reason in sorted(fixes, key=lambda x: -x[0]):
                t = t[:s] + new + t[e:]
            f.write_text(t, encoding="utf-8")
            n += len(fixes)
        print(f"APPLIED: {n} 处 / {n_files} 文件")
    else:
        print("DRY RUN：未写文件。审阅 Tools\\collation\\tmp\\qian_fix3.txt / qian_keep3.txt / qian_review3.txt")


if __name__ == "__main__":
    main()
