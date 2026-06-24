const CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function corsOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = [env.ALLOWED_ORIGIN || 'https://aiinterruptor.github.io', 'http://localhost', 'file://'];
  if (allowed.some(a => origin.startsWith(a))) return origin;
  return env.ALLOWED_ORIGIN || 'https://aiinterruptor.github.io';
}

function json(data, status, request, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin(request, env), ...CORS_HEADERS },
  });
}

function proxyResponse(body, contentType, request, env) {
  return new Response(body, {
    headers: { 'Content-Type': contentType, 'Access-Control-Allow-Origin': corsOrigin(request, env), ...CORS_HEADERS },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': corsOrigin(request, env), ...CORS_HEADERS } });
    }

    try {
      if (path === '/health') {
        return json({
          status: 'ok', service: 'jdm-proxy', version: '2.0.0',
          endpoints: ['/health', '/proxy', '/proxy-rss', '/api/firms', '/api/currents', '/api/tavily', '/api/frankfurter'],
        }, 200, request, env);
      }

      // ── Keyed API proxies (keys in env, never exposed to frontend) ──

      if (path === '/api/firms') {
        const key = env.FIRMS_KEY;
        if (!key) return json({ error: 'FIRMS_KEY not configured' }, 503, request, env);
        const area = url.searchParams.get('area') || '6,116,20,128';
        const days = url.searchParams.get('days') || '2';
        const apiUrl = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/VIIRS_SNPP_NRT/${area}/${days}`;
        const r = await fetch(apiUrl, { signal: AbortSignal.timeout(15000) });
        return proxyResponse(await r.text(), r.headers.get('Content-Type') || 'text/csv', request, env);
      }

      if (path === '/api/currents') {
        const key = env.CURRENTS_KEY;
        if (!key) return json({ error: 'CURRENTS_KEY not configured' }, 503, request, env);
        const q = url.searchParams.get('q') || 'Philippines';
        const apiUrl = `https://api.currentsapi.services/v1/search?keywords=${encodeURIComponent(q)}&language=en&apiKey=${key}`;
        const r = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
        return proxyResponse(await r.text(), 'application/json', request, env);
      }

      if (path === '/api/tavily') {
        const key = env.TAVILY_KEY;
        if (!key) return json({ error: 'TAVILY_KEY not configured' }, 503, request, env);
        const q = url.searchParams.get('q') || 'Philippines news';
        const max = parseInt(url.searchParams.get('max') || '10');
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: key, query: q, max_results: Math.min(max, 20), search_depth: 'basic', include_answer: false }),
          signal: AbortSignal.timeout(15000),
        });
        return proxyResponse(await r.text(), 'application/json', request, env);
      }

      if (path === '/api/frankfurter') {
        const from = url.searchParams.get('from') || 'USD';
        const to = url.searchParams.get('to') || 'PHP,SGD,EUR,JPY,SAR,AED,CNY,KRW,AUD,GBP,HKD,THB,MYR';
        const r = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`, { signal: AbortSignal.timeout(8000) });
        return proxyResponse(await r.text(), 'application/json', request, env);
      }

      // ── Generic proxy (existing functionality) ──

      if (path === '/proxy' || path === '/proxy-rss') {
        const target = url.searchParams.get('url') || url.searchParams.get('feed');
        if (!target) return json({ error: 'Missing url parameter' }, 400, request, env);
        try { new URL(target); } catch { return json({ error: 'Invalid URL' }, 400, request, env); }
        const r = await fetch(target, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JDM-Proxy/2.0)' },
          signal: AbortSignal.timeout(15000),
          redirect: 'follow',
        });
        const body = await r.arrayBuffer();
        return new Response(body, {
          status: r.status,
          headers: {
            'Content-Type': r.headers.get('Content-Type') || 'text/plain',
            'Access-Control-Allow-Origin': corsOrigin(request, env),
            ...CORS_HEADERS,
          },
        });
      }

      return json({ error: 'Not found' }, 404, request, env);
    } catch (e) {
      return json({ error: e.message }, 502, request, env);
    }
  },
};
