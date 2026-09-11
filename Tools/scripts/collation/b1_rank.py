# -*- coding: utf-8 -*-
"""批1 正史22部体检密度排序。"""
import json

rows = [json.loads(l) for l in open(r"E:\cinagroup\cinaclassics\Tools\collation\体检总表.jsonl", encoding="utf-8") if l.strip()]
hist = [d for d in rows if "史藏\\正史\\" in d["path"]]
hist = sorted(hist, key=lambda d: d["score"], reverse=True)
for d in hist:
    name = d["path"].replace("E:\\cinagroup\\cinaclassics\\史藏\\正史\\", "").replace(".md", "")
    print(f"{name}\tbox={d['box']}\tscore={d['score']}")
