# -*- coding: utf-8 -*-
"""维基文库点校本对齐：库内北齐书 □ 定位补字。

流程:
  1) 拼接维基文库 50 卷正文，opencc 繁转简
  2) 对库内每个 □：取前锚A(≤12连续汉字)与后锚B(≤12连续汉字)
  3) 双锚夹逼：A、B 均在 ws 文本中命中，且命中间隔==库内间隔(±2)
  4) 同位字 = ws[iA + 库内偏移]；多对命中取众数
输出候选表 tsv: 序号\t库内位置\t候选\t锚证据\t上下文

用法: python ws_align.py <库内.md> <ws目录> <输出.tsv>
"""
import re
import sys
from collections import Counter
from pathlib import Path

import opencc

cc = opencc.OpenCC("t2s")

SKIP = set("，。、；：！？（）《》【】「」『』“”‘’…—·<>\n\r\t 　\"'")

def clean_ws(p):
    """清洗维基文库单卷：去导航/标记行，保留正文。"""
    t = Path(p).read_text(encoding="utf-8")
    lines = []
    for ln in t.splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith(("跳转到内容", "主菜单", "搜索", "外观", "资助", "创建账号", "登录",
                          "[关闭]", "恭喜", "开关目录", "添加语言", "作品", "讨论", "不转换",
                          "阅读", "编辑", "查看历史", "工具", "下载", "<", "◄", "►",
                          "姊妹计划", "全文以中華書局", "全文以中华书局",
                          "维基文库", "Wikipedia", "隐藏", "显示", "取自")):
            continue
        if re.match(r"^\d+%$", s) or re.match(r"^\d{4}年", s) or re.match(r"^第[0-9一二三四五六七八九十]+卷", s):
            continue
        if s in ("卷", "添加语言", "目录"):
            continue
        lines.append(s)
    return "\n".join(lines)

def load_local(p):
    return Path(p).read_text(encoding="utf-8")

def anchors(t, i, n=12):
    """□ 左/右最近连续汉字锚。返回 (前锚, 后锚, 前锚起点相对□偏移, 后锚起点相对□偏移)。"""
    # 前锚
    j = i - 1
    buf = []
    while j >= 0 and len(buf) < n:
        c = t[j]
        if c == "□" or c in SKIP:
            buf = []
        else:
            buf.append(c)
        j -= 1
    A = "".join(reversed(buf[:n]))
    offA = (i - 1) - j - len(A)   # 前锚起点与 □ 的字符距离（库内）
    # 后锚
    j = i + 1
    buf = []
    while j < len(t) and len(buf) < n:
        c = t[j]
        if c == "□" or c in SKIP:
            buf = []
        else:
            buf.append(c)
        j += 1
    B = "".join(buf[:n])
    offB = j - i - len(B)         # □ 到后锚起点后第一个字符的距离（库内，后锚起点即 i+1+... ）
    # 后锚起点在库内的位置 = i + 1 + 偏移；ws 中后锚命中起点 ipB；则同位 = ipB + (i+1 - 后锚起点库内位置)
    return A, B, offA, offB

def main():
    local, wsdir, out = sys.argv[1], sys.argv[2], sys.argv[3]
    t = load_local(local)
    # 拼接维基文库
    parts = []
    for f in sorted(Path(wsdir).glob("卷*.txt")):
        parts.append(clean_ws(f))
    ws_raw = "\n".join(parts)
    ws = cc.convert(ws_raw)
    print(f"库内 {len(t)} 字 | ws简体 {len(ws)} 字")

    pos = [m.start() for m in re.finditer("□", t)]
    lines = []
    n_ok = n_multi = n_miss = n_short = 0
    for idx, i in enumerate(pos, 1):
        A, B, offA, offB = anchors(t, i)
        ctx = t[max(0, i - 14): i + 14].replace("\n", " ")
        if len(A) < 6 or len(B) < 6:
            lines.append(f"{idx}\t{i}\t?\t锚不足 A«{A}» B«{B}»\t{ctx}")
            n_short += 1
            continue
        hitsA = [m.start() for m in re.finditer(re.escape(A), ws)]
        hitsB = [m.start() for m in re.finditer(re.escape(B), ws)]
        if not hitsA or not hitsB:
            lines.append(f"{idx}\t{i}\t?\t未命中(A{len(hitsA)}/B{len(hitsB)}) «{A}»…«{B}»\t{ctx}")
            n_miss += 1
            continue
        gap_local = (i + offB + 1) - (i - offA - len(A))  # 库内 前锚起点→后锚起点距离
        cands = []
        for ia in hitsA:
            for ib in hitsB:
                if ib > ia and abs((ib - ia) - gap_local) <= 2:
                    k = ia + len(A) + offA  # ws 中 □ 同位位置
                    if 0 <= k < len(ws) and ws[k] not in SKIP and ws[k] != "□":
                        cands.append((ws[k], ia, ib))
        if not cands:
            lines.append(f"{idx}\t{i}\t?\t间距不符(A{len(hitsA)}/B{len(hitsB)}/gap{gap_local})\t{ctx}")
            n_miss += 1
            continue
        ccnt = Counter(c[0] for c in cands)
        top, cnt = ccnt.most_common(1)[0]
        pairs = len(cands)
        if cnt >= pairs * 0.6:
            lines.append(f"{idx}\t{i}\t{top}\t«{A}»…«{B}» 同位{top}×{cnt}/{pairs}\t{ctx}")
            n_ok += 1
        else:
            lines.append(f"{idx}\t{i}\t?[{top}]\t«{A}»…«{B}» 分散{ccnt.most_common(3)}\t{ctx}")
            n_multi += 1
    Path(out).write_text("\n".join(lines), encoding="utf-8")
    print(f"□ 共 {len(pos)}；候选 {n_ok} / 分散 {n_multi} / 未命中 {n_miss} / 锚不足 {n_short}；输出 {out}")

if __name__ == "__main__":
    main()
