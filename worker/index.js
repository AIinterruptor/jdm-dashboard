/**
 * JDM Command Center — Cloudflare Worker Proxy
 * Version: 3.0.0 (2026-09-04)
 *
 * Merges the live v1.0.0 worker (domain allowlist, legacy /proxy-* routes) with the
 * repo v2.1.0 worker (keyed /api/* routes) — the dashboard needs BOTH families.
 *
 * Endpoints:
 *   GET  /health                          — liveness + route list
 *   GET  /proxy?url=ENCODED_URL           — generic GET proxy (allowlisted domains)
 *   POST /proxy                           — generic POST proxy (JSON body: {url, headers, body})
 *   GET  /proxy-rss?feed=URL              — RSS/Atom proxy (XML content-type)
 *   GET  /proxy-reddit?sub=NAME           — Reddit JSON with a Reddit-tolerated User-Agent
 *   GET  /proxy-gdelt?q=QUERY             — GDELT v2 DOC query
 *   GET  /proxy-news-aggregate?q=Q        — Google News RSS aggregate
 *   GET  /proxy-search?q=Q&max=N          — Wikipedia search
 *   GET  /proxy-wiki?q=Q&max=N            — Wikipedia search
 *   GET  /api/firms?area=W,S,E,N&days=N   — NASA FIRMS VIIRS CSV (secret FIRMS_KEY)
 *   GET  /api/tavily?q=Q&max=N            — Tavily search (secret TAVILY_KEY)
 *   GET  /api/frankfurter?from=USD&to=..  — FX rates
 *
 * Reliability:
 *   - Every GET upstream is cached in the Cloudflare Cache API for FRESH_TTL seconds.
 *   - If upstream fails (429/5xx/timeout) a stale copy up to STALE_TTL old is served with
 *     `X-JDM-Cache: stale` so GDELT rate-limits / Google News 503s degrade instead of blanking.
 *   - Per-IP rate limit is soft (in-memory per isolate) and sized for one dashboard refresh
 *     (~130 requests / 2 min).
 *
 * Secrets (wrangler secret put): FIRMS_KEY, TAVILY_KEY
 * Vars (wrangler.toml): ALLOWED_ORIGINS, RATE_LIMIT, MAX_RESPONSE_SIZE
 */

const VERSION = '3.0.0';
const UPSTREAM_TIMEOUT_MS = 15000;
let MAX_BYTES_DEFAULT = 5242880;   // overridden per request from env.MAX_RESPONSE_SIZE
const FRESH_TTL = 300;          // seconds a cached upstream body is considered fresh
const STALE_TTL = 6 * 3600;     // seconds we will still serve a stale body when upstream fails

// Strict allowlist of upstream hosts the generic proxy will fetch from.
const ALLOWED_DOMAINS = new Set([
  // PH news RSS
  'news.google.com', 'newsinfo.inquirer.net', 'data.gmanetwork.com', 'www.gmanetwork.com',
  'www.rappler.com', 'www.philstar.com', 'ptvnews.ph', 'mb.com.ph', 'news.abs-cbn.com',
  'www.sunstar.com.ph', 'www.pna.gov.ph', 'www.manilatimes.net', 'www.bworldonline.com',
  // International
  'feeds.bbci.co.uk', 'www.youtube.com',
  // Weather / disaster / gov
  'api.open-meteo.com', 'earthquake.usgs.gov', 'api.rainviewer.com',
  'bagong.pagasa.dost.gov.ph', 'www.pagasa.dost.gov.ph',
  'www.phivolcs.dost.gov.ph', 'phivolcs.dost.gov.ph',
  'ndrrmc.gov.ph', 'www.ndrrmc.gov.ph', 'coastguard.gov.ph', 'doh.gov.ph', 'www.bsp.gov.ph',
  'www.gdacs.org', 'reliefweb.int', 'api.reliefweb.int',
  'firms.modaps.eosdis.nasa.gov', 'eonet.gsfc.nasa.gov', 'gibs.earthdata.nasa.gov',
  // Data APIs
  'api.gdeltproject.org', 'api.worldbank.org', 'api.coingecko.com', 'api.frankfurter.app',
  'acleddata.com', 'api.acleddata.com', 'api.mediastack.com', 'api.currentsapi.services.com',
  'en.wikipedia.org',   // NOTE: never allowlist another proxy (e.g. allorigins) — that turns this into an open relay
  // Social
  'www.reddit.com', 'old.reddit.com',
]);

const REDDIT_UA = 'JDM-CommandCenter/1.0 (situational-awareness dashboard; contact via GitHub AIinterruptor)';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ─── Rate limiter (soft, per isolate) ─────────────────────────────────
const rateLimiter = new Map();
function checkRateLimit(ip, limit) {
  const now = Date.now();
  let entry = rateLimiter.get(ip);
  if (!entry || now > entry.resetAt) { entry = { count: 0, resetAt: now + 60000 }; rateLimiter.set(ip, entry); }
  entry.count++;
  if (rateLimiter.size > 1000) for (const [k, v] of rateLimiter) if (now > v.resetAt) rateLimiter.delete(k);
  return entry.count <= limit;
}

// ─── Helpers ──────────────────────────────────────────────────────────
function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || 'https://aiinterruptor.github.io')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}
function corsHeaders(request, env) {
  const origin = (request.headers.get('Origin') || '').toLowerCase();
  const list = allowedOrigins(env);
  // Exact origin match; localhost / 127.0.0.1 entries match any port. (Prefix match would accept evil.com lookalikes.)
  const ok = list.some(o => o === '*' || origin === o ||
    ((o === 'http://localhost' || o === 'http://127.0.0.1') && new RegExp('^' + o.replace('.', '\\.') + '(:\\d+)?$').test(origin)));
  return {
    'Access-Control-Allow-Origin': ok ? origin : list[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'X-JDM-Cache, X-JDM-Age, X-JDM-Upstream-Status, X-JDM-Version',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
function isAllowed(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && ALLOWED_DOMAINS.has(u.hostname); }
  catch { return false; }
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function hostOf(url) { try { return new URL(url).hostname; } catch { return '?'; } }

/**
 * Fetch an upstream GET with Cache API fresh/stale semantics.
 * Returns a Response (body already materialised) with X-JDM-Cache: hit|miss|stale.
 */
async function cachedFetch(url, opts = {}, ctx) {
  const cache = caches.default;
  const cacheKey = new Request('https://jdm-cache.invalid/' + encodeURIComponent(url) + (opts.cacheSuffix || ''));
  const cached = opts.noCache ? null : await cache.match(cacheKey);
  const fetchedAt = cached ? parseInt(cached.headers.get('X-JDM-Fetched-At') || '0', 10) : 0;
  const ageSec = cached ? (Date.now() - fetchedAt) / 1000 : Infinity;

  // Responses handed to the browser must NOT carry the long max-age used for the stored copy — fetch() honours the
  // HTTP cache, and a 6 h max-age would freeze the dashboard on its first result. Client copies are no-store.
  const clientHeaders = (h, extra) => { const o = new Headers(h); o.set('Cache-Control', 'no-store'); for (const [k, v] of Object.entries(extra)) o.set(k, v); return o; };

  if (cached && ageSec < FRESH_TTL) {
    return new Response(cached.body, { status: 200, headers: clientHeaders(cached.headers, { 'X-JDM-Cache': 'hit', 'X-JDM-Age': String(Math.round(ageSec)) }) });
  }

  let upstream = null, err = null;
  const doFetch = () => fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': opts.userAgent || BROWSER_UA,
      'Accept': opts.accept || 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(opts.headers || {}),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(opts.timeoutMs || UPSTREAM_TIMEOUT_MS),
  });
  try {
    upstream = await doFetch();
    // GDELT enforces "one request every 5 seconds" per source IP; one spaced retry clears most 429s.
    if (upstream.status === 429 && opts.retry429Ms) {
      await new Promise(r => setTimeout(r, opts.retry429Ms));
      upstream = await doFetch();
    }
  } catch (e) { err = e; }

  if (upstream && upstream.ok) {
    const body = await upstream.arrayBuffer();
    if (body.byteLength > (opts.maxBytes || MAX_BYTES_DEFAULT)) {
      return json({ error: `Response too large (${body.byteLength} bytes)` }, 502);
    }
    const ct = upstream.headers.get('Content-Type') || opts.defaultContentType || 'text/plain';
    const stored = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': ct,
        'X-JDM-Fetched-At': String(Date.now()),
        'Cache-Control': `public, max-age=${STALE_TTL}`,
      },
    });
    if (!opts.noCache) {
      const put = cache.put(cacheKey, stored.clone());
      if (ctx) ctx.waitUntil(put); else await put;
    }
    return new Response(body, { status: 200, headers: clientHeaders(stored.headers, { 'X-JDM-Cache': 'miss' }) });
  }

  // Upstream failed — serve stale if we have it
  if (cached && ageSec < STALE_TTL) {
    return new Response(cached.body, { status: 200, headers: clientHeaders(cached.headers, {
      'X-JDM-Cache': 'stale', 'X-JDM-Age': String(Math.round(ageSec)),
      'X-JDM-Upstream-Status': String(upstream ? upstream.status : 'error'),
    }) });
  }
  if (upstream) {
    // Never relay upstream error bodies for keyed routes (the upstream URL embeds the secret).
    const text = opts.hideErrorBody ? '' : await upstream.text().catch(() => '');
    return json({ error: `Upstream HTTP ${upstream.status}`, host: hostOf(url), body: text.slice(0, 300) }, upstream.status);
  }
  return json({ error: (err && err.message) || 'Fetch failed', host: hostOf(url) }, 502);
}

// ─── Route handlers ───────────────────────────────────────────────────
function handleHealth() {
  return json({
    status: 'ok', service: 'jdm-proxy', version: VERSION,
    endpoints: ['/health', '/proxy', '/proxy-rss', '/proxy-reddit', '/proxy-gdelt', '/proxy-news-aggregate',
      '/proxy-search', '/proxy-wiki', '/api/firms', '/api/tavily', '/api/frankfurter'],
  });
}

async function handleProxy(url, request, ctx) {
  // GET only. The old POST relay (arbitrary headers + body to any allowlisted host) had no frontend caller and was removed.
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const target = url.searchParams.get('url') || url.searchParams.get('feed');
  if (!target) return json({ error: 'Missing url parameter' }, 400);
  if (!isAllowed(target)) return json({ error: `Domain not allowed: ${hostOf(target)}` }, 403);
  const host = hostOf(target);
  const isReddit = host.endsWith('reddit.com');
  const isGdelt = host === 'api.gdeltproject.org';
  // GDELT: short upstream timeout + one spaced retry keeps worst case ~22 s (client allows 30 s for GDELT calls)
  return cachedFetch(target, { userAgent: isReddit ? REDDIT_UA : BROWSER_UA, retry429Ms: isGdelt ? 5500 : 0, timeoutMs: isGdelt ? 8000 : 0 }, ctx);
}

async function handleProxyRss(url, ctx) {
  const feed = url.searchParams.get('feed') || url.searchParams.get('url');
  if (!feed) return json({ error: 'Missing feed parameter' }, 400);
  if (!isAllowed(feed)) return json({ error: `Domain not allowed: ${hostOf(feed)}` }, 403);
  const isReddit = hostOf(feed).endsWith('reddit.com');
  const r = await cachedFetch(feed, {
    accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
    userAgent: isReddit ? REDDIT_UA : BROWSER_UA,
    defaultContentType: 'application/xml; charset=utf-8',
  }, ctx);
  if (r.ok) {
    const ct = r.headers.get('Content-Type') || '';
    if (!/xml|rss|atom/i.test(ct)) {
      const h = new Headers(r.headers); h.set('Content-Type', 'application/xml; charset=utf-8');
      return new Response(r.body, { status: 200, headers: h });
    }
  }
  return r;
}

async function handleProxyReddit(url, ctx) {
  const sub = url.searchParams.get('sub');
  if (!sub) return json({ error: 'Missing sub parameter' }, 400);
  return cachedFetch(`https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?limit=10`, { userAgent: REDDIT_UA }, ctx);
}

async function handleProxyGdelt(url, ctx) {
  const q = url.searchParams.get('q');
  if (!q) return json({ error: 'Missing q parameter' }, 400);
  return cachedFetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=10&sourcelang=english`, { retry429Ms: 5500, timeoutMs: 8000 }, ctx);
}

async function handleProxyNewsAggregate(url, ctx) {
  const q = url.searchParams.get('q') || 'Philippines';
  return cachedFetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-PH&gl=PH&ceid=PH:en`, {
    accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
  }, ctx);
}

async function handleProxyWiki(url, ctx) {
  const q = url.searchParams.get('q');
  const max = Math.min(parseInt(url.searchParams.get('max') || '8', 10) || 8, 50);
  if (!q) return json({ error: 'Missing q parameter' }, 400);
  return cachedFetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${max}&format=json`, {}, ctx);
}

async function handleFirms(url, env, ctx) {
  const key = env.FIRMS_KEY;
  if (!key) return json({ error: 'FIRMS_KEY not configured' }, 503);
  // FIRMS area order is west,south,east,north. Default = Philippine archipelago bbox. Strict shape check so a
  // crafted value cannot alter the path (e.g. "..").
  const areaRaw = url.searchParams.get('area') || '116,4,127,21';
  const area = /^-?\d{1,3}(\.\d+)?(,-?\d{1,3}(\.\d+)?){3}$/.test(areaRaw) ? areaRaw : '116,4,127,21';
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '1', 10) || 1, 1), 5);
  const source = (url.searchParams.get('source') || 'VIIRS_SNPP_NRT').replace(/[^A-Z0-9_]/g, '') || 'VIIRS_SNPP_NRT';
  const apiUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${area}/${days}`;
  const r = await cachedFetch(apiUrl, { defaultContentType: 'text/csv', cacheSuffix: '#firms', hideErrorBody: true }, ctx);
  const h = new Headers(r.headers); if (r.ok) h.set('Content-Type', 'text/csv; charset=utf-8');
  return new Response(r.body, { status: r.status, headers: h });
}

async function handleTavily(url, env) {
  const key = env.TAVILY_KEY;
  if (!key) return json({ error: 'TAVILY_KEY not configured' }, 503);
  const q = url.searchParams.get('q') || 'Philippines news';
  const max = Math.min(parseInt(url.searchParams.get('max') || '10', 10) || 10, 20);
  try {
    const r = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: q, max_results: max, search_depth: 'basic', include_answer: false }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  } catch (e) { return json({ error: e.message }, 502); }
}

async function handleFrankfurter(url, ctx) {
  const from = (url.searchParams.get('from') || 'USD').replace(/[^A-Z]/g, '');
  const to = (url.searchParams.get('to') || 'PHP,SGD,EUR,JPY,SAR,AED,CNY,KRW,AUD,GBP,HKD,THB,MYR').replace(/[^A-Z,]/g, '');
  return cachedFetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`, {}, ctx);
}

// ─── Router ───────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    MAX_BYTES_DEFAULT = parseInt(env.MAX_RESPONSE_SIZE || '5242880', 10) || 5242880;
    const limit = parseInt(env.RATE_LIMIT || '300', 10) || 300;
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(ip, limit)) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded', retryAfter: 60 }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors } });
    }

    let resp;
    try {
      if (path === '/') resp = new Response(`JDM Command Center proxy v${VERSION} — see /health`, { headers: { 'Content-Type': 'text/plain' } });
      else if (path === '/health') resp = handleHealth();
      else if (path === '/proxy') resp = await handleProxy(url, request, ctx);
      else if (path === '/proxy-rss') resp = await handleProxyRss(url, ctx);
      else if (path === '/proxy-reddit') resp = await handleProxyReddit(url, ctx);
      else if (path === '/proxy-gdelt') resp = await handleProxyGdelt(url, ctx);
      else if (path === '/proxy-news-aggregate') resp = await handleProxyNewsAggregate(url, ctx);
      else if (path === '/proxy-search' || path === '/proxy-wiki') resp = await handleProxyWiki(url, ctx);
      else if (path === '/api/firms') resp = await handleFirms(url, env, ctx);
      else if (path === '/api/tavily') resp = await handleTavily(url, env);
      else if (path === '/api/frankfurter') resp = await handleFrankfurter(url, ctx);
      else resp = json({ error: 'Not found', see: '/health' }, 404);
    } catch (e) {
      resp = json({ error: e.message || 'Worker error' }, 502);
    }

    const headers = new Headers(resp.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('X-JDM-Version', VERSION);
    // Data routes are no-store for the browser (the worker's Cache API layer does the caching); /health may sit 60 s.
    headers.set('Cache-Control', path === '/health' ? 'public, max-age=60' : 'no-store');
    return new Response(resp.body, { status: resp.status, headers });
  },
};
