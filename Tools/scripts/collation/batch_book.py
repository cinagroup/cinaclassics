# -*- coding: utf-8 -*-
"""批 1 逐书对校工作台：对一部书输出完整对校工作清单。

输出（stdout + Tools/collation/tmp/batch_book_<书>.txt）：
  1) 体检全指标（复用 scan_book）
  2) A 替代字残留：sub_detail 每字上下文样本
  3) C 编码残码：十六进制/加号残片 上下文样本
  4) F 标点：双标点/异形标点/引号失衡 样本
  5) D □ 分布：按行段直方图 + 前 40 处上下文（评估可核补性）
  6) E 类候选：已知形误模式命中 + 罕见字频 top 80（供人工定谳）
  7) G 结构：卷头标记列表

用法:
  python batch_book.py <书.md> [--all-box]
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
from scan_book import scan_file, SUB_CHARS, SUB_RULES, HEX_RE, PLUS_RE, DUP_RE

# 已知 E 类形误模式（后汉书战役定谳 + 正史常见讹字）
KNOWN_E = [
    ("荧", "荥"), ("虒", "蚡"), ("这", "之"), ("凯", "岂"),
    ("涿", "涔"), ("晁", "昆"), ("劭", "邵"), ("汜", "泛"),
    ("陁", "陀"), ("唘", "启"), ("駮", "驳"), ("頟", "额"),
]

COMMON = set("的了一是在不有和与人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六共权收证改清己美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适属圆包火住调满县局照参红细引听该铁价严龙飞")


def ctx(t, i, n=16):
    return t[max(0, i - n):i + n].replace("\n", "⏎")


def main():
    path = sys.argv[1]
    all_box = "--all-box" in sys.argv
    m = scan_file(path)
    t = Path(path).read_text(encoding="utf-8")
    out = []
    out.append("=" * 70)
    out.append(f"批1 逐书对校工作清单：{path}")
    out.append("=" * 70)
    out.append(f"体量 {m['bytes']//1024}KB / {len(t)} 字 / UTF-8 {'OK' if m['utf8_ok'] else '异常'}")
    out.append(f"缺陷密度分 {m['score']} | PUA {m['pua']} | □ {m['box']} | 替 {m['sub_hits']} | 残 {m['hex_residue']+m['plus_frag']} | 标 {m['v_punct']+m['dup_punct']} | 引号差 {m['quote_diff']} | 书名号差 {m['book_diff']} | 现代字 {m['modern']}")

    # 1) 替代字残留
    out.append("\n## A 替代字残留")
    n_sub = 0
    for c in SUB_CHARS:
        for mt in re.finditer(re.escape(c), t):
            out.append(f"  {c} → {ctx(t, mt.start(), 18)}")
            n_sub += 1
    for pat in SUB_RULES:
        for mt in re.finditer(re.escape(pat), t):
            out.append(f"  [语境规则]{pat} → {ctx(t, mt.start(), 18)}")
            n_sub += 1
    if not n_sub:
        out.append("  （无）")

    # 2) 编码残码
    out.append("\n## C 编码残码")
    hexs = list(HEX_RE.finditer(t))
    pls = list(PLUS_RE.finditer(t))
    for mt in hexs[:30]:
        out.append(f"  HEX {mt.group()} → {ctx(t, mt.start(), 18)}")
    for mt in pls[:20]:
        out.append(f"  PLUS {mt.group()} → {ctx(t, mt.start(), 18)}")
    if not hexs and not pls:
        out.append("  （无）")

    # 3) 标点
    out.append("\n## F 标点")
    dups = list(DUP_RE.finditer(t))
    for mt in dups[:15]:
        out.append(f"  双标点 {mt.group()!r} → {ctx(t, mt.start(), 16)}")
    for ch in "﹑﹐":
        i = t.find(ch)
        if i >= 0:
            out.append(f"  异形 {ch} → {ctx(t, i, 16)}")
    qd = m["quote_diff"]
    if qd:
        out.append(f"  引号差 {qd}（“{t.count('“')} vs ”{t.count('”')}）——需人工定位")
    if not dups and m["v_punct"] == 0 and not qd:
        out.append("  （无）")

    # 4) □ 分布
    out.append("\n## D □ 分布")
    if m["box"]:
        lines = t.split("\n")
        seg = [0] * 20
        total = 0
        for i, ln in enumerate(lines):
            c = ln.count("□")
            if c:
                seg[min(19, i * 20 // max(1, len(lines)))] += c
                total += c
        out.append(f"  总计 {total}；按行段分布: " + " ".join(str(s) for s in seg))
        shown = 0
        all_hits = list(re.finditer("□", t))
        for mt in all_hits:
            out.append(f"  □{shown+1:03d} → {ctx(t, mt.start(), 22)}")
            shown += 1
            if not all_box and shown >= 40:
                break
        if not all_box and total > 40:
            out.append(f"  …（其余 {total-40} 处略，--all-box 全量）")
    else:
        out.append("  （无）")

    # 5) E 类候选
    out.append("\n## E 类候选")
    for src, dst in KNOWN_E:
        hits = list(re.finditer(re.escape(src), t))
        if hits:
            out.append(f"  [形误] {src}(→{dst}?) ×{len(hits)}")
            for mt in hits[:6]:
                out.append(f"    → {ctx(t, mt.start(), 18)}")
    rare = {}
    for c in set(t):
        if c in COMMON or ord(c) < 0x4E00 or c in "□《》【】（）()「」『』“‘”’：；，。、！？…—·　\r\n":
            continue
        cnt = t.count(c)
        if 3 <= cnt <= 120:
            rare[c] = cnt
    out.append(f"  罕见字频(3-120次) top 80：")
    for c, cnt in sorted(rare.items(), key=lambda x: -x[1])[:80]:
        i = t.find(c)
        out.append(f"    {c} ×{cnt} → {ctx(t, i, 16)}")

    # 6) 结构
    out.append("\n## G 结构（卷头）")
    juan = re.findall(r"^卷[一二三四五六七八九十百]+[上中下（）()]*[^\n]{0,8}", t, re.M)
    out.append(f"  卷头 {len(juan)} 个：" + " / ".join(juan[:40]) + (" …" if len(juan) > 40 else ""))

    text = "\n".join(out)
    print(text)
    outfile = ROOT / "Tools" / "collation" / "tmp" / f"batch_book_{Path(path).stem}.txt"
    outfile.write_text(text, encoding="utf-8")
    print(f"\n[已存] {outfile}")


if __name__ == "__main__":
    main()
