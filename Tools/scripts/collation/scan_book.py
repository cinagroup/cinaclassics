# -*- coding: utf-8 -*-
"""单书体检器：只读扫描一部文献的九类缺陷指标。

用法：
  python scan_book.py <文件.md>              # 打印报告
  python scan_book.py <文件.md> --json       # 输出 JSON
指标与缺陷类型学对应（见 repo 根 校勘计划.md 第二节）：
  A 替代字形（substitutes.json 命中）  B 私用区 PUA  C 编码残码/加号残片
  D 缺位符 □                           E 现代字混入   F 双重/异形标点、引号平衡
  G 结构（卷头计数，供人工比对）       I 体例（CRLF/UTF-8）
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
SUBS = json.loads((HERE / "substitutes.json").read_text(encoding="utf-8"))
SUB_CHARS = [g["from"] for g in SUBS["groups"]] + [g["from"] for g in SUBS["residual"]]
SUB_RULES = [r["pattern"] for r in SUBS["context_rules"]]

PUNCT = "，。、；：！？；：‘’“”"
HEX_RE = re.compile(r"(?<![A-Za-z0-9])[B-EC-F][0-9A-F]{3}(?![0-9A-Fa-f])")
PLUS_RE = re.compile(r"\+[一-龥]{1,3}")
DUP_RE = re.compile(r"[。，；：、！？]{2,}")
MODERN_RE = re.compile(r"这|们|怎|什么|吗|呢|您")
JUAN_RE = re.compile(r"^卷[一二三四五六七八九十百]+[上中下（）()]*", re.M)


def scan_file(path: str) -> dict:
    raw = Path(path).read_bytes()
    m = {
        "path": str(path),
        "bytes": len(raw),
        "crlf": raw.count(b"\r\n"),
        "lf": raw.count(b"\n"),
    }
    try:
        t = raw.decode("utf-8")
        m["utf8_ok"] = True
    except UnicodeDecodeError:
        t = raw.decode("utf-8", "replace")
        m["utf8_ok"] = False

    pua = [c for c in t if 0xE000 <= ord(c) <= 0xF8FF]
    m["pua"] = len(pua)
    m["pua_samples"] = sorted({f"U+{ord(c):04X}" for c in pua})[:12]

    m["compat"] = sum(1 for c in t if 0xF900 <= ord(c) <= 0xFAFF)
    m["box"] = t.count("□")

    m["sub_hits"] = sum(t.count(c) for c in SUB_CHARS)
    m["sub_detail"] = {c: t.count(c) for c in SUB_CHARS if t.count(c)}
    m["ctx_rules"] = sum(t.count(p) for p in SUB_RULES)

    m["hex_residue"] = len(HEX_RE.findall(t))
    m["plus_frag"] = len(PLUS_RE.findall(t))
    m["v_punct"] = t.count("﹑") + t.count("﹐")
    m["dup_punct"] = len(DUP_RE.findall(t))
    m["modern"] = len(MODERN_RE.findall(t))
    m["quote_diff"] = t.count("“") - t.count("”")
    m["book_diff"] = t.count("《") - t.count("》")
    m["lf_only"] = m["lf"] - m["crlf"]
    m["juan_marks"] = len(JUAN_RE.findall(t))

    # 缺陷密度分（每千字），用于总表排序
    n = max(1, len(t))
    m["score"] = round(
        (m["pua"] * 3 + m["box"] * 2 + m["sub_hits"] + m["hex_residue"] * 3
         + m["plus_frag"] * 3 + m["v_punct"] + m["dup_punct"] * 2
         + m["modern"] + abs(m["quote_diff"]) // 10 + m["compat"] * 2) / n * 1000,
        2,
    )
    return m


def report(m: dict) -> str:
    lines = [
        f"书：{m['path']}",
        f"体量：{m['bytes']//1024} KB；UTF-8 {'OK' if m['utf8_ok'] else '异常'}；CRLF {m['crlf']} / LF-only {m['lf_only']}",
        f"A 替代字：{m['sub_hits']}（词典命中 {m['sub_detail'] or '无'}）；语境规则串 {m['ctx_rules']}",
        f"B 私用区：{m['pua']} {m['pua_samples'] or ''}；兼容区 {m['compat']}",
        f"C 编码残码：十六进制 {m['hex_residue']}、加号残片 {m['plus_frag']}",
        f"D 缺位符 □：{m['box']}",
        f"E 现代字混入：{m['modern']}",
        f"F 双标点 {m['dup_punct']}；异形标点 {m['v_punct']}；引号差 {m['quote_diff']}；书名号差 {m['book_diff']}",
        f"G 卷头标记：{m['juan_marks']}（供目录比对）",
        f"缺陷密度分：{m['score']} /千字",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    m = scan_file(sys.argv[1])
    if "--json" in sys.argv:
        print(json.dumps(m, ensure_ascii=False, indent=2))
    else:
        print(report(m))
