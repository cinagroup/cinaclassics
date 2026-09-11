# -*- coding: utf-8 -*-
"""用维基文库点校本重建库内 GBK 乱码区（dry/apply 双模式）。

定位未匹配 run → 若 ws 前后匹配块夹逼出对应段（gap>0 且长度差≤2）→ 用 ws 段替换。
库内独有异文（ws 无对应 gap≤0）不动，登记日志。

用法: python rebuild_garble.py <库内.md> <ws目录> <卷pat> <head_anchor> [apply|dry]
输出: 重建后写入同名文件（apply）或打印统计（dry）；日志 rebuild_<书>.log
"""
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
    mode = sys.argv[5] if len(sys.argv) > 5 else "dry"
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

    # 收集替换：[(o0, o1, ws_seg, num)]
    repls = []
    holds = []
    for num, s0, s1 in segs:
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
                if run is not None and run[1] - run[0] + 1 >= 4:
                    runs.append(tuple(run))
                run = None
        if run is not None and run[1] - run[0] + 1 >= 4:
            runs.append(tuple(run))
        for a0, a1 in runs:
            o0, o1 = ml[a0] + s0, ml[a1] + s0
            pre = [b for b in blocks if b.a + b.size <= a0]
            post = [b for b in blocks if b.a > a1]
            if not pre:
                continue
            wstart = pre[-1].b + pre[-1].size
            wend = post[0].b if post else len(nw)
            gap = wend - wstart
            if gap <= 0:
                holds.append((num, o0, o1, "库内独有异文(ws无对应)"))
                continue
            # 标题行保护
            if "南史卷" in local[max(0, o0 - 2): o0 + 8] or re.match(r"^第?[一二三四五六七八九十百]+卷", local[max(0, o0 - 6): o0 + 4]):
                holds.append((num, o0, o1, "卷标题行"))
                continue
            # 乱码判定：仅重建 run 内含 □ 的段（乱码区必含 □；无 □ 的 run 可能是标题/异文/版本差异）
            run_txt = local[o0: o1 + 1]
            if "□" not in run_txt:
                holds.append((num, o0, o1, "无□(标题/异文/版本差异)"))
                continue
            ws_seg = ws_t[mw[wstart]: mw[wend - 1] + 1]
            repls.append((o0, o1, ws_seg, num))

    repls.sort(key=lambda r: r[0])
    total_loc = sum(r[1] - r[0] + 1 for r in repls)
    print(f"可重建乱码区 {len(repls)} 段 / {total_loc} 字 | 保留异文 {len(holds)} 段")
    if mode != "apply":
        for o0, o1, ws_seg, num in repls[:10]:
            print(f"  卷{num} [{o0}-{o1}] → {ws_seg[:20]}…")
        return
    # apply：从后往前
    t = local
    log = []
    for o0, o1, ws_seg, num in reversed(repls):
        t = t[:o0] + ws_seg + t[o1 + 1:]
        log.append(f"卷{num} [{o0}-{o1}] → {ws_seg[:24]}…")
    Path(local_p).write_text(t, encoding="utf-8")
    logname = Path(local_p).stem
    Path(r"E:\cinagroup\cinaclassics\Tools\collation\tmp", f"rebuild_{logname}.log").write_text(
        "\n".join(log), encoding="utf-8")
    print(f"已写入 {local_p}；替换 {len(repls)} 段，日志 rebuild_{logname}.log")

if __name__ == "__main__":
    main()
