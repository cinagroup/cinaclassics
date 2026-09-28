// 排版素材仓库（fonts/canvas/books/books_mr/db）定位，供各脚本共用：
//   1. 环境变量 CINACLASSICS_ASSETS（历史名 VRAIN_REPO 仍兼容）指向素材仓库根目录；
//   2. 否则从本包位置逐级向上探测：每一层级先试其下名为 vRain 的子目录，再试该层级本身
//      （兼容素材仓库直接包含本包的旧布局）。
//   探测依据：素材仓库根存在 db/num2zh_jid.txt。
import { existsSync } from 'node:fs';
import path from 'node:path';

const MARKER = 'db/num2zh_jid.txt';

export function resolveRepoRoot(): string {
  const env = process.env.CINACLASSICS_ASSETS ?? process.env.VRAIN_REPO;
  if (env) return path.resolve(env);

  let dir = path.resolve(import.meta.dirname);
  for (;;) {
    for (const cand of [path.join(dir, 'vRain'), dir]) {
      if (existsSync(path.join(cand, MARKER))) return cand;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    '未找到排版素材仓库（fonts/canvas/books/books_mr/db），请设置 CINACLASSICS_ASSETS 指向素材仓库根目录',
  );
}
