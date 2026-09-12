# -*- coding: utf-8 -*-
"""维基文库点校本对齐 v3（锚定模式）：ws 卷文件 → 库内首句锚点 → 逐段 difflib 匹配块夹逼。

适用：库内无「卷N」编号标题（如前汉书 120 卷四库本 vs ws 100 卷），
用 ws 每卷正文首句在库内全文定位（顺序递增），再逐段对齐。

用法: python ws_align3.py <库内.md> <ws目录> <输出.tsv> [锚句长=18]
输出: idx\t库内pos\t候选\t置信\t证据\t上下文
"""
import difflib
import re
import sys
from pathlib import Path

import opencc

cc = opencc.OpenCC("t2s")
SKIP = set("，。、；：！？（）《》【】「」『』“”‘’…—·<>\n\r\t 　\"'·◇◆°±〔〕〖〗〈〉")

UI_STARTS = ("跳转到内容", "主菜单", "搜索", "外观", "资助", "创建账号", "登录",
             "[关闭]", "恭喜", "开关目录", "添加语言", "作品", "讨论", "不转换",
             "阅读", "编辑", "查看历史", "工具", "下载", "姊妹计划",
             "全文以中華書局", "全文以中华书局", "前", "本页面最后编辑")


def clean_ws(p):
    t = Path(p).read_text(encoding="utf-8")
    out = []
    for ln in t.splitlines():
        s = ln.strip()
        if not s:
            continue
        if (s.startswith(UI_STARTS) or s.startswith("漢五年") or
                re.match(r"^\d+%$", s) or re.match(r"^\d{4}年", s) or
                re.match(r"^第[0-9一二三四五六七八九十百]+卷", s) or
                s in ("卷", "目录", "取自")):
            continue
        out.append(s)
    return "\n".join(out)


def normalize(t):
    norm, mp = [], []
    for k, ch in enumerate(t):
        if ch in SKIP or ch.isspace():
            continue
        norm.append(ch)
        mp.append(k)
    return "".join(norm), mp


def first_anchor(ws_txt, length=18):
    """取 ws 卷正文首句（去 UI 后首个汉字起 length 个原始字符，含标点）。"""
    s = cc.convert(ws_txt)
    s = re.sub(r"\s+", "", s)
    m = re.search(r"[\u4e00-\u9fff]", s)
    if not m:
        return None
    return s[m.start(): m.start() + length]


def main():
    local_p, wsdir, out = sys.argv[1], sys.argv[2], sys.argv[3]
    anchor_len = int(sys.argv[4]) if len(sys.argv) > 4 else 14
    local = Path(local_p).read_text(encoding="utf-8")
    n_local, mp_local = normalize(local)  # 去标点/注文括号的全库 normalize，mp_local: 归一idx→原文pos
    import bisect

    def nidx_of(pos):
        return bisect.bisect_left(mp_local, pos)

    def vol_key(f):
        m = re.match(r"卷(\d+)([上下中]?)", f.stem)
        return (int(m.group(1)), m.group(2)) if m else (10 ** 9, f.stem)

    ws_files = sorted(Path(wsdir).glob("卷*.txt"), key=vol_key)
    ws_by_name = {f.name: f for f in ws_files}

    def find_anchor(w, lo):
        """从 ws 卷文本找库内锚：开头汉字串（标点断）+ 逐级缩短 + 距离约束（在 normalize 库内查找，映射回原文）。"""
        s = cc.convert(w)
        s = re.sub(r"\s+", "", s)
        s = re.sub(r"[〈〉《》「」『』]", "", s)  # 去注文括号使锚串跨注连续
        parts = re.findall(r"[\u4e00-\u9fff]{8,}", s[:300])
        lo_n = nidx_of(lo)
        for p in parts[:8]:
            for L in (anchor_len, 12, 10, 8):
                if len(p) >= L:
                    a = p[:L]
                    i = n_local.find(a, lo_n)
                    if 0 <= i < lo_n + 200000:
                        return a, mp_local[i]
        return None, -1

    # 1) 锚点定位（按库内编排分组：纪1-10 / 志91-120 / 列传11-90，组内单调）
    def group_of(fname):
        m = re.match(r"卷(\d+)", fname)
        n = int(m.group(1))
        if n <= 10:
            return 0
        if n <= 90:
            return 1
        return 2

    GROUP_LO = {0: 10000, 1: 340000, 2: 130000}  # 纪 / 列传 / 志（库内编排：纪→志→列传）
    anchors = []  # (文件名, 库内起点)
    for g in (0, 2, 1):
        lo = GROUP_LO[g]
        for f in [x for x in ws_files if group_of(x.name) == g]:
            w = clean_ws(f)
            if len(w) < 400:
                print(f"跳过(过短): {f.name} {len(w)}")
                continue
            a, i = find_anchor(w, lo)
            if i < 0:
                print(f"锚失败: {f.name}")
                continue
            anchors.append((f.name, i))
            lo = i + 1
    print(f"锚定 {len(anchors)}/{len(ws_files)} 卷")
    if len(sys.argv) > 5:
        Path(sys.argv[5]).write_text(
            "\n".join(f"{fn}\t{i}" for fn, i in anchors) + "\n", encoding="utf-8")
        print(f"锚点表: {sys.argv[5]}")

    # 2) 逐段对齐
    lines = []
    for k, (fname, start) in enumerate(anchors):
        end = anchors[k + 1][1] if k + 1 < len(anchors) else len(local)
        seg = local[start:end]
        w = cc.convert(clean_ws(ws_by_name[fname]))
        n_local, mp_l = normalize(seg)
        n_ws, _ = normalize(w)
        sm = difflib.SequenceMatcher(None, n_local, n_ws, autojunk=False)
        boxes = [i for i, ch in enumerate(n_local) if ch == "□"]
        # 匹配块（>=3 同块）
        blocks = [b for b in sm.get_matching_blocks() if b.size >= 3]
        block_idx = 0
        for p in boxes:
            while block_idx < len(blocks) and blocks[block_idx][2] + blocks[block_idx][0] <= p:
                block_idx += 1
            cand, conf = "?", 0
            if block_idx < len(blocks):
                b = blocks[block_idx]
                rel = p - b[0]
                if 0 <= rel < b.size:
                    cand = n_ws[b[1] + rel]
                    conf = 2
                    # 后块校验
                    if block_idx + 1 < len(blocks):
                        nb = blocks[block_idx + 1]
                        gap_local = nb[0] - (b[0] + b.size)
                        gap_ws = nb[1] - (b[1] + b.size)
                        if abs(gap_local - gap_ws) > 2:
                            conf = 1
                else:
                    # □ 在两块之间：前块尾部同位
                    if p < b[0]:
                        # 前一块
                        if block_idx > 0:
                            pb = blocks[block_idx - 1]
                            prel = p - (pb[0] + pb.size)
                            if 0 <= prel < 40:
                                cand = n_ws[pb[1] + pb.size + prel] if pb[1] + pb.size + prel < len(n_ws) else "?"
                                conf = 1
            if cand and cand != "□":
                off = mp_l[p]
                ctx = seg[max(0, off - 8): off + 9].replace("\n", " ")
                ev = ""
                if block_idx < len(blocks):
                    b = blocks[block_idx]
                    ev = n_ws[max(0, b[1] - 10): b[1] + b.size + 10]
                lines.append(f"{fname}:{off}\t{cand}\t{conf}\t块«{ev}»\t{ctx}")
    Path(out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    c2 = sum(1 for l in lines if l.split("\t")[2] == "2")
    c1 = sum(1 for l in lines if l.split("\t")[2] == "1")
    print(f"总□候选: 置信2={c2} 置信1={c1} 无块={len(boxes) - len(lines)}; 输出 {out}")


if __name__ == "__main__":
    main()
