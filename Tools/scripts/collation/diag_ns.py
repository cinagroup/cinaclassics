# -*- coding: utf-8 -*-
"""南史每卷 库内 vs ws 相似度诊断。"""
import difflib, re, random
from pathlib import Path
import opencc

cc = opencc.OpenCC("t2s")
ROOT = Path(r"E:\cinagroup\cinaclassics")
local = (ROOT / "史藏/正史/南史.md").read_text(encoding="utf-8")
pat = re.compile(r"南史卷([一二三四五六七八九十百]+)(?= )")
ms = list(pat.finditer(local))
segs = {}
hi = local.rfind("卷八十 列传第七十")
segs["一"] = local[hi: ms[0].start()]
for k, m in enumerate(ms):
    seg = local[m.start(): (ms[k + 1].start() if k + 1 < len(ms) else len(local))]
    segs[m.group(1)] = seg

wsd = ROOT / "Tools/collation/tmp/ws_南史"
SKIP = set("，。、；：！？（）《》【】「」『』“”‘’…—·<>\n\r\t 　\"'·◇◆°±〔〕〖〗")

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

def norm(t):
    return "".join(c for c in t if c not in SKIP and not c.isspace())

CN = "一二三四五六七八九十"
def c2i(s):
    if s in "一二三四五六七八九":
        return CN.index(s) + 1
    if s == "十":
        return 10
    if "十" in s:
        a, b = s.split("十")
        return (CN.index(a) + 1) * 10 + (CN.index(b) + 1 if b else 0)
    return None

random.seed(1)
vols = sorted(c2i(k) for k in segs if c2i(k))
print("卷段数:", len(vols))
for j in random.sample(vols, 12):
    wf = wsd / f"卷{j:02d}.txt"
    if not wf.exists():
        continue
    key = [k for k in segs if c2i(k) == j][0]
    nloc = norm(segs[key])
    nws = norm(cc.convert(clean_ws(wf)))
    r = difflib.SequenceMatcher(None, nloc, nws, autojunk=False).ratio()
    print(f"卷{j}: ratio={r:.3f} loc={len(nloc)} ws={len(nws)}")
    print(f"    loc头: {segs[key][:36]!r}")
