// 上传素材到 R2（本地模拟桶或远端桶）
// 用法：npm run r2:push:local | npm run r2:push
// 通过 wrangler CLI 逐文件 put，保持与仓库一致的 key 布局：
//   fonts/*  canvas/<id>.jpg  canvas/<id>.cfg  books/<id>/**  db/*

import { execSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { resolveRepoRoot } from './repo.js';

const REPO_ROOT = resolveRepoRoot();
const BUCKET = 'cinaclassics-assets';
const REMOTE = process.argv.includes('--remote');

// .r2build 为 font-subset.ts 的产物目录（本包内，随目录移动不变）
const BUILD_ROOT = path.resolve(import.meta.dirname, '../.r2build');

// 只上传当前需要的素材子集，避免推几十 MB 的示例 PDF
const INCLUDE: Array<{ dir: string; test: (rel: string) => boolean }> = [
  { dir: 'fonts', test: (f) => /\.(ttf|otf)$/i.test(f) },
  { dir: 'canvas', test: (f) => /\.(jpg|cfg)$/i.test(f) },
  { dir: 'books', test: (f) => /\.(cfg|txt|md|jpg|png)$/i.test(f) },
  { dir: 'books_mr', test: (f) => /\.(cfg|txt|jpg|png)$/i.test(f) },
  { dir: 'db', test: (f) => /\.txt$/i.test(f) },
];

function walk(dir: string, base: string, test: (rel: string) => boolean, out: string[]) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.posix.join(base, name);
    if (statSync(full).isDirectory()) walk(full, rel, test, out);
    else if (test(rel)) out.push(rel);
  }
}

// Windows 下 execFileSync('npx', args, {shell:true}) 会丢失数组参数（如 --remote），
// 因此手工拼接命令字符串执行；仓库路径不含空格，无需引号处理
function push(key: string, file: string) {
  const cmd = `npx wrangler r2 object put ${BUCKET}/${key} --file ${file}${REMOTE ? ' --remote' : ' --local'}`;
  execSync(cmd, { stdio: 'inherit' });
}

let count = 0;
for (const inc of INCLUDE) {
  const files: string[] = [];
  walk(path.join(REPO_ROOT, inc.dir), inc.dir, inc.test, files);
  walk(path.join(BUILD_ROOT, inc.dir), inc.dir, inc.test, files);
  // 同 key 时 .r2build 版本优先（后遍历覆盖）
  const byKey = new Map<string, string>();
  for (const rel of files) {
    const underBuild = rel.startsWith('fonts/sub-');
    const file = path.join(
      (underBuild || existsSync(path.join(BUILD_ROOT, rel))) ? BUILD_ROOT : REPO_ROOT,
      rel,
    );
    byKey.set(rel, file);
  }
  for (const [rel, file] of byKey) {
    console.log(`[${++count}] ${rel}`);
    push(rel, file);
  }
}
console.log(`完成：共上传 ${count} 个文件到 ${REMOTE ? '远端' : '本地'} R2 桶 ${BUCKET}`);
