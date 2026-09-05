# State of the Nation PH — Command Center

Philippines situational-awareness dashboard for government operations: live feeds, hazard outlook, and a twice-daily Intelligence Director's brief written by Claude Haiku 4.5.

**Live:** https://state-of-the-nationph.pages.dev (Cloudflare Pages, primary)
**Mirror:** https://aiinterruptor.github.io/jdm-dashboard (GitHub Pages)

## Features

- **Leaflet map** with tactical (OpenStreetMap, dark filter), satellite, terrain and street layers, NASA GIBS overlays, and a Windy.com weather overlay
- **Intel feeds** — Inquirer, GMA, Rappler, PhilStar, PTV, BBC Asia, ReliefWeb, GDACS, PHIVOLCS, NDRRMC, USGS, NASA FIRMS/EONET, CoinGecko, Frankfurter FX, World Bank, Reddit; per-source freshness badges (STALE when the worker served cache)
- **Command screen** — the Intelligence Director's brief (anchor lead, analysis, developments with source refs, director's orders, 24-h outlook, gaps), generated at 06:00 and 18:00 PHT, plus a video news tab
- **OUTLOOK** — predictive analytics: 72-h hazard table per region (Open-Meteo rain/gust, USGS, PHIVOLCS, FIRMS), rainfall chart, threat-index projection, items/hour nowcast, anomaly z-scores and emerging terms
- **Keyword watchlist** with alerts, **operator notes** in a persisted incident log
- **Disaster zones** on the map — the Intelligence Director names where floods, fires, conflict, storms, quakes, volcano alerts and outbreaks are happening; the worker geocodes each place through a gazetteer (nothing is placed by guess)
- **SENTINEL** early warning and Palantir correlation overlay
- **OSINT terminal** and JARVIS chat (bring your own model key)

## Architecture

Single-page static app (no build step). The Cloudflare Worker proxies feeds (domain allowlist, cache with stale-on-failure), collects the PH feeds into KV every 30 minutes, serves 7–30 days of hourly history, and runs the Haiku brief on a cron.

| Component | Stack |
|---|---|
| Frontend | `index.html` on Cloudflare Pages (`scripts/deploy-pages.sh`), mirrored on GitHub Pages |
| Proxy / collector / curator | Cloudflare Worker `jdm-proxy.josed-jdm.workers.dev` (`worker/`), KV `JDM_KV`, crons `*/30` (collect), `5 22` and `5 10` UTC (brief + zones) |
| Curator + zones model | Claude Haiku 4.5 via the Messages API (secret `ANTHROPIC_KEY`), two calls every 12 h |
| Weather | Open-Meteo (keyless) |

## Deploy

```
cd worker && npx wrangler deploy            # worker (secrets: FIRMS_KEY, TAVILY_KEY, ANTHROPIC_KEY, ADMIN_TOKEN)
scripts/deploy-pages.sh                      # Cloudflare Pages
git push origin main                         # GitHub Pages mirror
```
