// Cloudflare Worker 入口
// GET  /                      → 排版服务页面（选书/选卷/生成/预览）
// GET  /books                 → 列出书籍（books 主版 + books_mr 多栏）
// GET  /meta?shelf=&book=     → 书目元数据（meta.json：书名/作者/文本清单/印章）
// GET  /generate?book=&from=&to=&shelf=&pages=&stamps= → 生成 PDF（application/pdf）
//
// 素材（fonts/ canvas/ books/ books_mr/）从 R2 桶 cinaclassics-assets 读取（见 wrangler.toml 绑定）

import { R2AssetSource } from './engine/assets.js';
import { generate, Shelf } from './engine/pipeline.js';

interface Env {
  ASSETS: R2Bucket;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function jsonError(status: number, message: string): Response {
  return json({ error: message }, status);
}

const PAGE_HTML = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>海内典籍 · 排版服务</title>
<style>
  :root { --paper:#f2ead9; --paper2:#fdfcf8; --ink:#1a1a1a; --ink2:#555; --seal:#8d493a; --line:#d8cfbc; }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px 16px 64px; background:var(--paper); color:var(--ink);
         font-family:"Songti SC","STSong","SimSun","Noto Serif CJK SC",serif; line-height:1.7; }
  .wrap { max-width:760px; margin:0 auto; }
  .slip { background:var(--paper2); border:2px solid var(--ink); padding:6px 4px; display:inline-block; }
  .slip h1 { margin:0; font-size:30px; letter-spacing:6px; writing-mode:vertical-rl; }
  header { display:flex; gap:18px; align-items:flex-start; margin-bottom:26px; }
  header .hd { padding-top:6px; }
  header .hd .sub { color:var(--ink2); font-size:14px; margin-top:2px; }
  fieldset { border:1px solid var(--line); background:var(--paper2); margin:0 0 18px; padding:14px 16px 16px; }
  legend { padding:0 8px; color:var(--ink2); font-size:13px; letter-spacing:2px; }
  label { display:block; font-size:13px; color:var(--ink2); margin:10px 0 4px; }
  select, input[type=number], input[type=text] { width:100%; padding:8px 10px; font:inherit; font-size:15px;
    border:1px solid var(--ink); background:#fff; color:var(--ink); }
  .row { display:flex; gap:12px; } .row > div { flex:1; }
  .chk { display:flex; align-items:center; gap:8px; margin-top:12px; font-size:14px; }
  .chk input { width:16px; height:16px; }
  button { font:inherit; font-size:16px; letter-spacing:4px; padding:10px 26px; cursor:pointer;
           background:var(--ink); color:var(--paper); border:1px solid var(--ink); }
  button:disabled { opacity:.45; cursor:wait; }
  .status { min-height:1.6em; margin:12px 0 4px; font-size:14px; color:var(--seal); }
  .meta { font-size:14px; color:var(--ink2); margin-top:6px; }
  iframe { width:100%; height:720px; border:1px solid var(--ink); background:#fff; margin-top:10px; display:none; }
  a.dl { display:none; margin-top:10px; font-size:14px; }
  footer { margin-top:40px; font-size:12px; color:var(--ink2); }
  a { color:inherit; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="slip"><h1>海内典籍</h1></div>
    <div class="hd">
      <div style="font-size:20px;letter-spacing:3px">排版服务 · Cinaclassics</div>
      <div class="sub">中文古籍刻本风格直排 PDF 生成 · 文字可选取 · 自带书签目录</div>
    </div>
  </header>

  <fieldset>
    <legend>书目</legend>
    <label for="shelf">书架</label>
    <select id="shelf"><option value="books">主版式（books）</option><option value="books_mr">多栏版式（books_mr）</option></select>
    <label for="book">书目</label>
    <select id="book"></select>
    <div class="meta" id="meta"></div>
  </fieldset>

  <fieldset>
    <legend>范围与选项</legend>
    <div class="row">
      <div><label for="from">起始文本</label><select id="from"></select></div>
      <div><label for="to">结束文本</label><select id="to"></select></div>
    </div>
    <div class="row">
      <div><label for="pages">测试页数（可选，限制输出页数）</label><input id="pages" type="number" min="1" placeholder="留空 = 全部"></div>
      <div><label>印章</label><label class="chk" style="margin-top:8px"><input id="stamps" type="checkbox" checked> 按 stamps.cfg 钤印</label></div>
    </div>
  </fieldset>

  <button id="go">生成 PDF</button>
  <div class="status" id="status"></div>
  <a class="dl" id="dl" download>下载 PDF</a>
  <iframe id="preview"></iframe>

  <footer>数据源：殆知阁古代文献（整理为 Markdown） · 排版引擎与素材见仓库 <a href="https://github.com/cinagroup/cinaclassics" style="color:inherit">Tools/</a> 目录</footer>
</div>
<script>
const $ = (id) => document.getElementById(id);
let META = null, blobUrl = null;

async function loadBooks() {
  const r = await fetch('/books'); const j = await r.json();
  const sel = $('book'); sel.innerHTML = '';
  for (const id of j.books) {
    const o = document.createElement('option');
    o.value = 'books|' + id; o.textContent = '主版 ' + id;
    sel.appendChild(o);
  }
  if (j.mr && j.mr.length) {
    const g = document.createElement('optgroup'); g.label = '多栏版式';
    for (const id of j.mr) {
      const o = document.createElement('option');
      o.value = 'books_mr|' + id; o.textContent = '多栏 ' + id;
      g.appendChild(o);
    }
    sel.appendChild(g);
  }
  onBookChange();
}
async function loadMeta() {
  const [shelf, book] = $('book').value.split('|');
  META = null;
  $('meta').textContent = '载入书目信息…';
  $('from').innerHTML = ''; $('to').innerHTML = '';
  try {
    const r = await fetch('/meta?shelf=' + shelf + '&book=' + book);
    if (!r.ok) throw new Error('meta 不可用');
    META = await r.json();
  } catch (e) { $('meta').textContent = '书目信息载入失败'; return; }
  $('meta').innerHTML = META.title + (META.author ? ' · ' + META.author : '') + ' · 文本 ' + META.texts.length;
  const fill = (sel) => {
    sel.innerHTML = '';
    for (const t of META.texts) {
      const o = document.createElement('option');
      o.value = t.tid; o.textContent = t.tid + ' ' + t.label;
      sel.appendChild(o);
    }
  };
  fill($('from')); fill($('to'));
  $('from').value = META.texts[0].tid;
  $('to').value = META.texts[META.texts.length - 1].tid;
  $('stamps').checked = !!META.stamps;
  $('stamps').disabled = !META.stamps;
}
async function generate() {
  const [shelf, book] = $('book').value.split('|');
  const from = $('from').value, to = $('to').value;
  const pages = $('pages').value.trim();
  const useStamps = $('stamps').checked && !$('stamps').disabled;
  let url = '/generate?book=' + encodeURIComponent(book) + '&shelf=' + shelf +
            '&from=' + from + '&to=' + to + (useStamps ? '' : '&stamps=0') +
            (pages ? '&pages=' + encodeURIComponent(pages) : '');
  $('go').disabled = true;
  const t0 = Date.now();
  $('status').textContent = '排版中…（长书可能需要数十秒）';
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(blob);
    $('dl').href = blobUrl;
    $('dl').textContent = '下载 PDF（' + (blob.size / 1048576).toFixed(1) + ' MB）';
    $('dl').style.display = 'inline';
    $('preview').src = blobUrl;
    $('preview').style.display = 'block';
    $('status').textContent = '完成：' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒';
  } catch (e) {
    $('status').textContent = '生成失败：' + e.message;
  } finally {
    $('go').disabled = false;
  }
}
$('shelf').addEventListener('change', loadBooks);
$('book').addEventListener('change', loadMeta);
$('go').addEventListener('click', generate);
loadBooks();
</script>
</body>
</html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const assets = new R2AssetSource(env.ASSETS);

    try {
      if (url.pathname === '/' || url.pathname === '') {
        return new Response(PAGE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }

      if (url.pathname === '/books') {
        const main = await collectBookIds(assets, 'books/');
        const mr = await collectBookIds(assets, 'books_mr/');
        return json({ books: main, mr });
      }

      if (url.pathname === '/meta') {
        const shelf = (url.searchParams.get('shelf') === 'books_mr' ? 'books_mr' : 'books') as Shelf;
        const book = url.searchParams.get('book') ?? '';
        if (!book) return jsonError(400, "缺少参数 'book'");
        const meta = await assets.readText(`${shelf}/${book}/meta.json`);
        if (meta === null) return jsonError(404, `未发现书目元数据 ${shelf}/${book}/meta.json`);
        return new Response(meta, {
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' },
        });
      }

      if (url.pathname === '/generate') {
        const book = url.searchParams.get('book');
        if (!book) return jsonError(400, "缺少参数 'book'");
        const shelf = (url.searchParams.get('shelf') === 'books_mr' ? 'books_mr' : 'books') as Shelf;
        const from = intParam(url.searchParams.get('from'), 1);
        const to = intParam(url.searchParams.get('to'), 1);
        const pages = url.searchParams.get('pages');
        const maxPages = pages !== null ? intParam(pages, undefined) : undefined;
        const stamps = url.searchParams.get('stamps') !== '0';

        const t0 = Date.now();
        const result = await generate(assets, {
          bookId: book, shelf, from, to, maxPages, stamps,
        });
        console.log(`[cinaclassics] book=${book} shelf=${shelf} ${from}-${to} pages=${result.layout.pages.length} stamps=${result.stamped} ${Date.now() - t0}ms`);

        const filename = `《${result.layout.title}》文本${from}至${to}${maxPages !== undefined ? '_test' : ''}.pdf`;
        return new Response(result.pdfBytes as unknown as BodyInit, {
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          },
        });
      }

      return jsonError(404, 'Not Found');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonError(500, `生成失败：${msg}`);
    }
  },
} satisfies ExportedHandler<Env>;

async function collectBookIds(assets: R2AssetSource, prefix: string): Promise<string[]> {
  const keys = await assets.list(prefix);
  const ids = new Set<string>();
  for (const k of keys) {
    const m = k.match(new RegExp(`^${prefix}([^/]+)/book\\.cfg$`));
    if (m) ids.add(m[1]);
  }
  return [...ids].sort();
}

function intParam(v: string | null, dflt: number | undefined): number {
  if (v === null || v === '') return dflt ?? 0;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? (dflt ?? 0) : n;
}
