# -*- coding: utf-8 -*-
import os, re
from collections import Counter

root = r'E:\cinagroup\cinaclassics'
skip = {'.git', '.playwright-mcp', 'node_modules', 'tmp', 'books', 'Tools'}

lines = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in skip]
    for fn in filenames:
        if not (fn.endswith('.md') or fn.endswith('.txt')):
            continue
        p = os.path.join(dirpath, fn)
        try:
            with open(p, encoding='utf-8', errors='replace') as f:
                ls = f.readlines()
        except Exception:
            continue
        for i, line in enumerate(ls):
            if '目辟' in line:
                lines.append((p, i + 1, line.rstrip('\n')))

print('TOTAL 目辟 lines:', len(lines))

# 分类：取「目辟」之后至约22字的片段（覆盖 暒穴/暒甫/暒棅/映/衣檾 等）
def seg(line):
    i = line.find('目辟')
    return line[max(0, i - 6): i + 24]

c = Counter()
for p, n, line in lines:
    c[seg(line)] += 1
for k, v in c.most_common(60):
    print(v, repr(k))

# 暒穴 后缀动词统计 + 前缀统计
print('\n=== 暒穴 后缀 ===')
suf = Counter()
pre = Counter()
detail = []
for p, n, line in lines:
    if '暒穴' not in line:
        continue
    m = re.search(r'暒穴[^＜＞]{0,8}＜□[^＞]*＞[^＜＞]{0,8}＜□[^＞]*＞([^＜＞，。、；\s]{1,2})', line)
    if m:
        suf[m.group(1)] += 1
    m2 = re.search(r'([^＜＞，。、；\s]{0,4})＜□目辟＞', line)
    if m2:
        pre[m2.group(1)] += 1
    detail.append((p, n, line))

for k, v in suf.most_common(30):
    print(v, repr(k))
print('=== 暒穴 前缀 ===')
for k, v in pre.most_common(30):
    print(v, repr(k))

print('\n=== 暒穴 详情（全部 %d 行）===' % len(detail))
for p, n, line in detail:
    i = line.find('目辟')
    s = max(0, i - 60)
    e = min(len(line), i + 150)
    print('%s L%d :: %s' % (p.split('\\')[-1], n, line[s:e]))
