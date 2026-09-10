# -*- coding: utf-8 -*-
"""藏外试点：高置信度勘误候选扫描
输出: candidates.jsonl (供人工复核) + summary.txt
"""
import json
import os
import re
import sys

ROOT = r"E:\cinagroup\cinaclassics\佛藏\藏外"
OUT_DIR = r"E:\cinagroup\cinaclassics\佛藏\.workbuddy\kanwu"
os.makedirs(OUT_DIR, exist_ok=True)

# ---------------------------------------------------------------
# 词典：坏词 -> 正词。全部为佛典专名/固定短语中的高置信度录入错误。
# 注意：异体字（悕/卽/竝/唵 等）一律不收，保留文本原貌。
# ---------------------------------------------------------------
DICT = {
    # 佛典专名
    "频骡": "频螺",          # 优楼频螺迦叶
    "耆阁崛": "耆阇崛",      # 耆阇崛山
    "耆阇掘": "耆阇崛",
    "舍利佛": "舍利弗",      # 舍利弗（仅当后不接"子"）-> 用规则排除"舍利佛子"? 实际"舍利佛"三字组中"弗"误
    "目健连": "目犍连",
    "菩堤": "菩提",
    "薜荔多": None,          # 合法词，占位不用
    "忉利天": None,
    "刃利天": "忉利天",
    "阎浮堤": "阎浮提",
    "菩提萨缍": "菩提萨埵",
    "阿耨菩堤": "阿耨菩提",
    # 坛经等著名文献中的已知错字
    "本水清净": "本自清净",
    "五蕴皆空": None,
    "照见五蕴皆空": None,
    "一-hook": None,
}
DICT = {k: v for k, v in DICT.items() if v}  # 去掉 None 占位

# 需要上下文规则排除的合法组合: 坏词 -> 允许保留的正则(命中即不算错)
EXCEPTIONS = {
    "舍利佛": r"舍利佛(?!子)",  # 反例预留; 实际判断见下
}

# 例外白名单：这些正确的词包含"坏词"子串，需排除
WHITELIST_PATTERNS = [
    r"频螺",  # 已正确的直接跳过(不会命中坏词, 防御性)
]

# ---------------------------------------------------------------
# 乱码 / 编码残留检测
# ---------------------------------------------------------------
LATIN_RANGE = re.compile(r"[\u0080-\u00ff]+")   # Latin-1 Supplement / C1
REPLACEMENT = "\ufffd"
PUA = re.compile(r"[\ue000-\uf8ff]")

def scan_text(path, fname, text):
    hits = []
    # 1) 词典命中
    for bad, good in DICT.items():
        for m in re.finditer(re.escape(bad), text):
            s, e = m.start(), m.end()
            ctx = text[max(0, s - 15):e + 15].replace("\n", "⏎")
            hits.append({
                "type": "dict",
                "file": fname,
                "pos": s,
                "bad": bad,
                "good": good,
                "context": ctx,
            })
    # 2) 乱码
    for m in LATIN_RANGE.finditer(text):
        s = m.start()
        ctx = text[max(0, s - 12):m.end() + 12].replace("\n", "⏎")
        hits.append({"type": "mojibake", "file": fname, "pos": s,
                     "bad": m.group(0), "good": None, "context": ctx})
    idx = text.find(REPLACEMENT)
    while idx != -1:
        ctx = text[max(0, idx - 12):idx + 13].replace("\n", "⏎")
        hits.append({"type": "replacement-char", "file": fname, "pos": idx,
                     "bad": REPLACEMENT, "good": None, "context": ctx})
        idx = text.find(REPLACEMENT, idx + 1)
    for m in PUA.finditer(text):
        s = m.start()
        ctx = text[max(0, s - 12):m.end() + 12].replace("\n", "⏎")
        hits.append({"type": "pua-char", "file": fname, "pos": s,
                     "bad": m.group(0), "good": None, "context": ctx})
    return hits

def main():
    all_hits = []
    files = sorted(f for f in os.listdir(ROOT) if f.endswith(".md"))
    for fname in files:
        p = os.path.join(ROOT, fname)
        try:
            text = open(p, encoding="utf-8").read()
        except UnicodeDecodeError:
            text = open(p, encoding="utf-8", errors="replace").read()
        all_hits.extend(scan_text(p, fname, text))

    with open(os.path.join(OUT_DIR, "candidates.jsonl"), "w", encoding="utf-8") as f:
        for h in all_hits:
            f.write(json.dumps(h, ensure_ascii=False) + "\n")

    # 摘要
    by_type, by_file = {}, {}
    for h in all_hits:
        by_type[h["type"]] = by_type.get(h["type"], 0) + 1
        by_file.setdefault(h["file"], []).append(h)
    lines = [f"扫描文件数: {len(files)}", f"候选总数: {len(all_hits)}", "", "按类型:"]
    for t, c in sorted(by_type.items(), key=lambda x: -x[1]):
        lines.append(f"  {t}: {c}")
    lines.append("")
    lines.append("按文件(命中数降序, 前40):")
    for fn, hs in sorted(by_file.items(), key=lambda x: -len(x[1]))[:40]:
        lines.append(f"  {len(hs):4d}  {fn}")
    summary = "\n".join(lines)
    open(os.path.join(OUT_DIR, "summary.txt"), "w", encoding="utf-8").write(summary)
    print(summary)

if __name__ == "__main__":
    main()
