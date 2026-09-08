// Cloudflare Worker 入口
// GET  /                      → 使用说明页
// GET  /books                 → 列出 R2 中的书籍（含 books_mr 书架）
// GET  /generate?book=01&from=1&to=2&shelf=mr&pages=5 → 生成 PDF（application/pdf）
//
// 素材（fonts/ canvas/ books/ books_mr/）从 R2 桶 cinaclassics-assets 读取（见 wrangler.toml 绑定）

import { R2AssetSource } from './engine/assets.js';
import { generate, Shelf } from './engine/pipeline.js';

interface Env {
  ASSETS: R2Bucket;
}

const HELP_HTML = `<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>Cinaclassics · 古籍刻本直排电子书排版引擎</title>
<style>body{font-family:system-ui,sans-serif;max-width:680px;margin:48px auto;padding:0 16px;line-height:1.7;color:#333}code{background:#f4f4f4;padding:2px 6px;border-radius:4px}</style>
</head>
<body>
<h1>Cinaclassics · 古籍刻本直排电子书排版引擎</h1>
<p>中文古籍刻本风格直排 PDF 生成服务：文字可选取、自带书签目录，支持普通版式与族谱/字典多栏版式、印章贴放、多字体回退与按书字体子集。</p>
<h3>接口</h3>
<ul>
<li><code>GET /books</code> — 列出可用书籍（<code>books</code> 主版、<code>mr</code> 多栏版）</li>
<li><code>GET /generate?book=01&amp;from=1&amp;to=2</code> — 生成 PDF
<ul>
<li><code>book</code>：书籍 ID；<code>shelf=mr</code>：多栏版书架（books_mr/）</li>
<li><code>from</code>/<code>to</code>：文本序号范围（默认 1 至 1）</li>
<li><code>pages</code>：测试模式，仅输出指定页数（对应命令行 -z）</li>
<li><code>stamps=0</code>：跳过印章（默认存在 stamps.cfg 时自动应用）</li>
</ul></li>
</ul>
<h3>部署</h3>
<pre><code>npx tsx scripts/font-subset.ts --book 01 [--mr]   # 按书字体子集（必须）
npm run r2:push                                   # 素材上传 R2
npm run deploy</code></pre>
<p style="margin-top:32px;color:#888">Cinaclassics · <a href="https://github.com/cinagroup/cinaclassics" style="color:inherit">中华古籍全文库</a>排版服务</p>
</body>
</html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const assets = new R2AssetSource(env.ASSETS);

    try {
      if (url.pathname === '/' || url.pathname === '') {
        return new Response(HELP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }

      if (url.pathname === '/books') {
        const main = await collectBookIds(assets, 'books/');
        const mr = await collectBookIds(assets, 'books_mr/');
        return Response.json({ books: main, mr });
      }

      if (url.pathname === '/generate') {
        const book = url.searchParams.get('book');
        if (!book) return jsonError(400, "缺少参数 'book'（书籍 ID）");
        const shelf: Shelf = url.searchParams.get('shelf') === 'mr' ? 'books_mr' : 'books';
        const from = intParam(url.searchParams.get('from'), 1);
        const to = intParam(url.searchParams.get('to'), 1);
        const pages = url.searchParams.get('pages');
        const maxPages = pages !== null ? intParam(pages, undefined) : undefined;
        const stamps = url.searchParams.get('stamps') !== '0';

        const t0 = Date.now();
        const result = await generate(assets, {
          bookId: book, shelf, from, to, maxPages, stamps,
        });
        const t1 = Date.now();
        console.log(`[cinaclassics] book=${book} shelf=${shelf} ${from}-${to} pages=${result.layout.pages.length} stamps=${result.stamped} ${t1 - t0}ms`);

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

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
