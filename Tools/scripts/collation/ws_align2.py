# -*- coding: utf-8 -*-
"""维基文库点校本对齐 v2：逐卷 difflib 匹配块夹逼。

- 库内按「第N卷」切分 50 卷，ws 按卷NN.txt
- 两侧各自去标点/空白归一化（保留 □ 占位），记录 norm→原文 位置映射
- SequenceMatcher 求匹配块；□ 的 norm 位置用「前块映射 + 后块间距校验」
  取同位字；置信分 0-2。

输出: idx\t库内pos\t候选\t置信\t证据\t上下文
用法: python ws_align2.py <库内.md> <ws目录> <输出.tsv>
"""
import difflib
import re
import sys
from pathlib import Path

import opencc

cc = opencc.OpenCC("t2s")
SKIP = set("，。、；：！？（）《》【】「」『』“”‘’…—·<>\n\r\t 　\"'·◇◆°±〔〕〖〗")

JUAN_RE = re.compile(r"^第?([一二三四五六七八九十百]+)卷", re.M)
V_PRE = re.compile(r"^(?:南史)?卷([一二三四五六七八九十百]+)(?= )", re.M)

def clean_ws(p):
    t = Path(p).read_text(encoding="utf-8")
    out = []
    for ln in t.splitlines():
        s = ln.strip()
        if not s:
            continue
        if (s.startswith(("跳转到内容", "主菜单", "搜索", "外观", "资助", "创建账号", "登录",
                          "[关闭]", "恭喜", "开关目录", "添加语言", "作品", "讨论", "不转换",
                          "阅读", "编辑", "查看历史", "工具", "下载", "姊妹计划",
                          "全文以中華書局", "全文以中华书局")) or
                re.match(r"^\d+%$", s) or re.match(r"^\d{4}年", s) or
                re.match(r"^第[0-9一二三四五六七八九十]+卷", s) or
                s in ("卷", "目录", "取自")):
            continue
        out.append(s)
    return "\n".join(out)

def normalize(t):
    """去标点空白；保留汉字/□。返回 (norm, pos_map: norm_idx→orig_idx)。"""
    norm, mp = [], []
    for k, ch in enumerate(t):
        if ch in SKIP or ch.isspace():
            continue
        norm.append(ch)
        mp.append(k)
    return "".join(norm), mp

def juan_split(local):
    """按 第N卷/卷N/南史卷N 切分库内；同卷号保留最长段（目录段短于正文段）。

    返回 [(卷号, 文本)]。"""
    local = V_PRE.sub(lambda m: f"第{m.group(1)}卷", local)
    ms = list(JUAN_RE.finditer(local))
    best = {}
    for k, m in enumerate(ms):
        start = m.start()
        end = ms[k + 1].start() if k + 1 < len(ms) else len(local)
        num = m.group(1)
        seg = local[start:end]
        if num not in best or len(seg) > len(best[num]):
            best[num] = seg
    return [(num, seg) for num, seg in best.items()]

CN = "一二三四五六七八九十"

def cn_to_int(s):
    if s in "一二三四五六七八九":
        return CN.index(s) + 1
    if s == "十":
        return 10
    if "十" in s:
        a, b = s.split("十")
        return (CN.index(a) + 1) * 10 + (CN.index(b) + 1 if b else 0)
    return None

def main():
    local_p, wsdir, out = sys.argv[1], sys.argv[2], sys.argv[3]
    juan_pat = sys.argv[4] if len(sys.argv) > 4 else None
    head_anchor = sys.argv[5] if len(sys.argv) > 5 else None
    local = Path(local_p).read_text(encoding="utf-8")
    ws_files = {int(f.stem[1:]): f for f in Path(wsdir).glob("卷*.txt")}

    if juan_pat:
        # 自定义卷标题正则：匹配「南史卷N」类标题，可用 head_anchor 指定卷1 起点（目录尾锚）
        ms = list(re.compile(juan_pat).finditer(local))
        segs = []
        if head_anchor:
            mh = re.search("^" + head_anchor + "$", local, re.M)
            hi = mh.start() if mh else -1
            if hi >= 0:
                segs.append(("一", local[hi: ms[0].start()]))
        for k, m in enumerate(ms):
            start = m.start()
            end = ms[k + 1].start() if k + 1 < len(ms) else len(local)
            segs.append((m.group(1), local[start:end]))
    else:
        segs = juan_split(local)

    lines = []
    tot = cand2 = cand1 = cand0 = 0
    for num, jt in segs:
        jno = cn_to_int(num)
        if jno is None or jno not in ws_files:
            continue
        ws_t = cc.convert(clean_ws(ws_files[jno]))
        nl, ml = normalize(jt)
        nw, mw = normalize(ws_t)
        sm = difflib.SequenceMatcher(None, nl, nw, autojunk=False)
        blocks = [b for b in sm.get_matching_blocks() if b.size > 0]
        boxpos = [k for k, c in enumerate(nl) if c == "□"]
        if not boxpos:
            continue
        # 每个 □ 的候选
        for p in boxpos:
            # 前块: 终点 <= p 的最近块
            pre = [b for b in blocks if b.a + b.size <= p]
            # 后块: 起点 > p 的最近块
            post = [b for b in blocks if b.a > p]
            ctx = jt[max(0, ml[p] - 14): ml[p] + 14].replace("\n", " ")
            if not pre:
                lines.append(f"{num}:{ml[p]}\t?\t0\t无前块\t{ctx}")
                cand0 += 1
                continue
            b = pre[-1]
            off = p - (b.a + b.size)
            wpos = b.b + b.size + off
            if wpos >= len(nw):
                lines.append(f"{num}:{ml[p]}\t?\t0\t越界\t{ctx}")
                cand0 += 1
                continue
            cand = nw[wpos]
            if cand == "□":
                lines.append(f"{num}:{ml[p]}\t?\t0\t同位为□\t{ctx}")
                cand0 += 1
                continue
            conf = 1
            # 后块校验: ws 间距一致性
            if post:
                b2 = post[0]
                gap_local = b2.a - p
                gap_ws = b2.b - wpos
                if abs(gap_local - gap_ws) <= 2:
                    conf = 2
            if conf == 2:
                cand2 += 1
            else:
                cand1 += 1
            lines.append(f"{num}:{ml[p]}\t{cand}\t{conf}\t块«{nl[max(0,b.a):p]}»\t{ctx}")
    Path(out).write_text("\n".join(lines), encoding="utf-8")
    print(f"总□候选: 置信2={cand2} 置信1={cand1} 无块={cand0}; 输出 {out}")

if __name__ == "__main__":
    main()
