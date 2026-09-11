# -*- coding: utf-8 -*-
"""验证乱码区重建可行性：对每个未匹配 run，取 ws 对应段（前后匹配块夹逼）打印对照。"""
import difflib
import re
import sys
from pathlib import Path
import opencc

cc = opencc.OpenCC("t2s")
SKIP = set("，。、；：！？（）《》【】「」『』“”‘’…—·<>\n\r\t 　\"'·◇◆°±〔〕〖〗")

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

def clean_ws(p):
    out = []
    for ln in Path(p).read_text(encoding="utf-8").splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith(("跳转到内容", "主菜单", "搜索", "外观", "资助", "创建账号", "登录",
                          "[关闭]", "恭喜", "开关目录", "添加语言", "作品", "讨论", "不转换",
                          "阅读", "编辑", "查看历史", "工具", "下载", "姊妹计划")) or \
           re.match(r"^\d+%$", s) or re.match(r"^\d{4}年", s):
            continue
        out.append(s)
    return "\n".join(out)

def norm_map(t):
    norm, mp = [], []
    for k, ch in enumerate(t):
        if ch in SKIP or ch.isspace():
            continue
        norm.append(ch)
        mp.append(k)
    return "".join(norm), mp

def main():
    local_p, wsdir, juan_pat, head_anchor = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    local = Path(local_p).read_text(encoding="utf-8")
    ws_files = {int(f.stem[1:]): f for f in Path(wsdir).glob("卷*.txt")}
    ms = list(re.compile(juan_pat).finditer(local))
    segs = []
    if head_anchor:
        mh = re.search("^" + head_anchor + "$", local, re.M)
        hi = mh.start() if mh else -1
        if hi >= 0:
            segs.append(("一", hi, ms[0].start()))
    for k, m in enumerate(ms):
        segs.append((m.group(1), m.start(), ms[k + 1].start() if k + 1 < len(ms) else len(local)))

    shown = 0
    for num, s0, s1 in segs:
        if shown >= 12:
            break
        jno = cn_to_int(num)
        if jno is None or jno not in ws_files:
            continue
        jt = local[s0:s1]
        ws_t = cc.convert(clean_ws(ws_files[jno]))
        nl, ml = norm_map(jt)
        nw, mw = norm_map(ws_t)
        sm = difflib.SequenceMatcher(None, nl, nw, autojunk=False)
        blocks = [b for b in sm.get_matching_blocks() if b.size > 0]
        cov = set()
        for b in blocks:
            for i in range(b.a, b.a + b.size):
                cov.add(i)
        runs = []
        run = None
        for i in range(len(nl)):
            if i not in cov:
                if run is None:
                    run = [i, i]
                else:
                    run[1] = i
            else:
                if run is not None and run[1] - run[0] + 1 >= 6:
                    runs.append(tuple(run))
                run = None
        if run is not None and run[1] - run[0] + 1 >= 6:
            runs.append(tuple(run))
        for a0, a1 in runs:
            o0, o1 = ml[a0] + s0, ml[a1] + s0
            # ws 对应段：前后匹配块
            pre = [b for b in blocks if b.a + b.size <= a0]
            post = [b for b in blocks if b.a > a1]
            wstart = pre[-1].b + pre[-1].size if pre else 0
            wend = post[0].b if post else len(nw)
            ws_seg = ws_t[mw[wstart]: mw[wend - 1] + 1] if wend > wstart and wend - 1 < len(mw) else ""
            loc_seg = local[o0: min(o1 + 1, o0 + 36)].replace("\n", " ")
            print(f"卷{num} [{o0}-{o1}] {o1-o0+1}字")
            print(f"  库内: …{loc_seg}…")
            print(f"  ws  : …{ws_seg[:40]}…" if ws_seg else "  ws  : (无对应 — 库内独有/异文)")
            shown += 1
            if shown >= 12:
                break

if __name__ == "__main__":
    main()
