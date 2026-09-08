// cfg 配置文件解析 — 与 Perl 版 vrain.pl 的读取逻辑逐行等价：
//   跳过空行与 # 注释行；若行内不含 "=#"（避免误切颜色值 #RRGGBB）则去除行内注释；
//   去除全部空白；按第一个 = 切分键值

export type RawCfg = Record<string, string>;

export function parseCfg(text: string): RawCfg {
  const cfg: RawCfg = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') continue;
    if (line.startsWith('#')) continue;
    let s = line;
    if (!s.includes('=#')) {
      const hashIdx = s.indexOf('#');
      if (hashIdx >= 0) s = s.slice(0, hashIdx);
    }
    s = s.replace(/\s/g, '');
    if (s === '') continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq);
    const v = s.slice(eq + 1);
    if (k !== '') cfg[k] = v;
  }
  return cfg;
}

export function num(cfg: RawCfg, key: string, dflt = 0): number {
  const v = cfg[key];
  if (v === undefined || v === '') return dflt;
  const n = parseFloat(v);
  return Number.isNaN(n) ? dflt : n;
}

export function str(cfg: RawCfg, key: string, dflt = ''): string {
  const v = cfg[key];
  return v === undefined ? dflt : v;
}

export function flag(cfg: RawCfg, key: string): boolean {
  const v = cfg[key];
  return v !== undefined && v !== '' && v !== '0';
}

// "a|b|c" → 字符集合；支持 "\|"、"\/" 等反斜杠转义（对应 cfg 中用于正则的转义）
export function splitPipeList(s: string): string[] {
  if (!s) return [];
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) {
      cur += s[i + 1];
      i++;
    } else if (ch === '|') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.filter((x) => x !== '');
}

// 连续字符（无分隔符，空白已在解析时去除）→ 码点集合
export function charSet(s: string): Set<string> {
  const set = new Set<string>();
  for (const ch of s) set.add(ch);
  return set;
}
