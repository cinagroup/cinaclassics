# -*- coding: utf-8 -*-
"""批 2 全库体检：遍历语料库全部 .md，输出《全库体检总表》。

用法：python scan_corpus.py [库根目录]
输出：
  Tools/collation/体检总表.jsonl   每书一行 JSON（全量指标）
  Tools/collation/全库体检总表.md  分藏统计 + 缺陷密度排行
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from scan_book import scan_file  # noqa: E402

ROOT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[3]
OUT_DIR = Path(__file__).resolve().parents[2] / "collation"
OUT_DIR.mkdir(parents=True, exist_ok=True)

ZANG = ["史藏", "儒藏", "子藏", "集藏", "诗藏", "易藏", "医藏", "艺藏", "佛藏", "道藏"]


def zang_of(p: Path) -> str:
    for z in ZANG:
        if z in p.parts:
            return z
    return "其他"


def main():
    files = [f for f in ROOT.rglob("*.md")
             if "Tools" not in f.parts and f.name not in ("README.md", "使用须知.md", "校勘计划.md")]
    t0 = time.time()
    rows = []
    with open(OUT_DIR / "体检总表.jsonl", "w", encoding="utf-8", newline="\n") as jf:
        for i, f in enumerate(files, 1):
            try:
                m = scan_file(str(f))
            except Exception as e:  # 坏文件也登记
                m = {"path": str(f), "error": str(e), "score": -1}
            m["zang"] = zang_of(f)
            rows.append(m)
            jf.write(json.dumps(m, ensure_ascii=False) + "\n")
            if i % 1000 == 0:
                print(f"  …{i}/{len(files)}（{time.time()-t0:.0f}s）", flush=True)

    # 分藏统计
    stat = {}
    for m in rows:
        z = m.get("zang", "其他")
        s = stat.setdefault(z, {"books": 0, "bytes": 0, "defect_books": 0, "pua": 0, "box": 0,
                                "sub": 0, "residue": 0, "punct": 0})
        s["books"] += 1
        s["bytes"] += m.get("bytes", 0)
        s["pua"] += m.get("pua", 0)
        s["box"] += m.get("box", 0)
        s["sub"] += m.get("sub_hits", 0) + m.get("ctx_rules", 0)
        s["residue"] += m.get("hex_residue", 0) + m.get("plus_frag", 0)
        s["punct"] += m.get("dup_punct", 0) + m.get("v_punct", 0)
        if m.get("score", 0) > 0:
            s["defect_books"] += 1

    by_zang = sorted(rows, key=lambda m: -m.get("score", 0))
    with open(OUT_DIR / "全库体检总表.md", "w", encoding="utf-8", newline="\n") as f:
        f.write("# 全库体检总表（批 2）\n\n")
        f.write(f"- 体检书目：{len(rows)}；耗时 {time.time()-t0:.0f}s\n")
        f.write("- 指标定义见 `校勘计划.md` 第二节；密度分 = 加权缺陷数/千字\n\n")
        f.write("## 分藏统计\n\n")
        f.write("| 藏 | 书目 | MB | 有缺陷书 | PUA | □ | 替代字/规则 | 编码残码 | 标点缺陷 |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n")
        for z in ZANG:
            s = stat.get(z)
            if not s:
                continue
            f.write(f"| {z} | {s['books']} | {s['bytes']//1048576} | {s['defect_books']} | "
                    f"{s['pua']} | {s['box']} | {s['sub']} | {s['residue']} | {s['punct']} |\n")
        f.write("\n## 缺陷密度 Top 200（P3/P4 优先书单）\n\n")
        f.write("| 密度分 | 藏 | PUA | □ | 替代字 | 残码 | 标点 | 书 |\n|---:|---|---:|---:|---:|---:|---:|---|\n")
        for m in by_zang[:200]:
            if m.get("score", 0) <= 0:
                break
            rel = m["path"].replace(str(ROOT) + "\\", "").replace(str(ROOT) + "/", "")
            f.write(f"| {m['score']} | {m.get('zang','')} | {m.get('pua',0)} | {m.get('box',0)} | "
                    f"{m.get('sub_hits',0)+m.get('ctx_rules',0)} | {m.get('hex_residue',0)+m.get('plus_frag',0)} | "
                    f"{m.get('dup_punct',0)+m.get('v_punct',0)} | {rel} |\n")
        f.write("\n## 零缺陷书判定说明\n\n密度分为 0 的书仍需 P5 抽验（抽样表明存在词典外缺陷），不代表免检。\n")
    print(f"完成：{len(rows)} 部，用时 {time.time()-t0:.0f}s")
    print(f"输出：{OUT_DIR / '体检总表.jsonl'}")
    print(f"输出：{OUT_DIR / '全库体检总表.md'}")


if __name__ == "__main__":
    main()
