# Palantir Engine v2.0 — Design Spec

Date: 2026-07-04
Status: Approved by Commander JD

## Context

Palantir is a Gotham-styled geospatial intelligence overlay layered on the Leaflet map in `index.html` (jdm-dashboard). It ships five toggleable layers — Temporal Timeline, Arc Links, Threat Pulse, Network Graph, Watchzones — all reading from the shared `window.allFeeds` array. Current implementation is `PALANTIR ENGINE v1.0` (index.html lines ~25355–25989), untouched since its introduction (`402278f`) and its AUTO-COP integration (`e08b67c`).

Name is a styling/UX inspiration (dense analyst/ops aesthetic), not an integration with palantir.com's actual products.

## Problems Being Solved

1. **Correlation heuristic is naive.** `findRelatedEvents` scores relatedness via raw keyword overlap (no stopwords/stemming), flat category/severity matching, and a crude geo-distance term. No time-proximity weighting at all.
2. **Perf: recompute-on-pan.** `onMapUpdate` re-runs the full O(n²) relatedness scoring (`renderArcs`) and location-clustering (`renderNetwork`) on every single `moveend`/`zoomend`, even though feed data hasn't changed — only screen projection has.
3. **No entity search/filter.** Palantir is purely a passive visual overlay; there's no way to interrogate feeds by keyword.
4. **Timeline inconsistency.** Scrubbing the Temporal Timeline filters map markers via `addEventMarkers`, but Arc Links and Network Graph ignore the cutoff entirely and always render from the full unfiltered `allFeeds`.
5. **Hardcoded AOR fallback, duplicated.** `renderWatchzones` falls back to `{lat:10.72, lng:122.56}` (line 25856); a second, slightly different hardcoded coordinate `{lat:10.7202, lng:122.5621}` exists in the unrelated AUTO-COP scan-pulse code (line 26066). Both are redundant — `window.ACTIVE_LOC` is a real, live global (declared line 3717, assigned on location change line 4097) and should be the single source of truth.
6. **No persistence.** All five layer toggles reset to off on every page reload.
7. **Version header stale.** Still reads `v1.0` despite the AUTO-COP feature extension.

## Non-Goals

- No backend/API changes. Palantir has no data source of its own; it only reads `window.allFeeds`.
- No real NLP/entity-resolution model. The correlation upgrade stays a client-side heuristic (stopwords, light stemming, time-decay) — not a genuine NLP pipeline.
- No new file/module split. Stays inline in `index.html` per existing project convention (no build step).
- No changes to AUTO-COP's crisis-escalation logic itself — only preserving its existing contract with Palantir's toggle functions.

## Design

### 1. Compute/Draw split (core architectural fix)

Each of Arc Links and Network Graph splits into:
- **Compute** (`computeArcs(feeds)`, `computeNetwork(feeds)`) — runs the relatedness scoring / location clustering. Runs only when: the layer is toggled on, `allFeeds` changes, the timeline cutoff changes, or the search query changes. Result cached in module-level state (`cachedArcConnections`, `cachedNetworkNodes`).
- **Draw** (`drawArcs()`, `drawNetwork()`) — pure reprojection of the cached compute result to current screen coordinates via `gmap.latLngToContainerPoint`. Runs on every `moveend`/`zoomend`.

`onMapUpdate` calls only the draw functions. A new `invalidatePalantirCache()` is called wherever feeds refresh, the timeline is scrubbed, or search query changes — it clears the cache and triggers recompute for any currently-active layer.

### 2. Shared active-feed pipeline

New function `getActivePalantirFeeds()`:
```
getActivePalantirFeeds() = window.allFeeds
  .filter(f => f.lat && f.lng)
  .filter(within timeline cutoff, if timeline active)
  .map(f => ({ ...f, _dimmed: searchQuery && !matchesQuery(f, searchQuery) }))
```
All five layers (Timeline bars, Arc Links, Threat Pulse, Network Graph, Watchzones use ACTIVE_LOC not feeds) and `addEventMarkers` read from this instead of filtering `window.allFeeds` independently. This fixes the timeline/arc-link inconsistency (problem 4) as a side effect and is the mechanism search highlighting rides on.

### 3. Improved correlation heuristic

`findRelatedEvents` (renamed `scoreRelatedness`) changes:
- Strip a small stopword list (the, and, with, from, this, that, into, over, after, etc.) before keyword overlap comparison.
- Light stemming: strip trailing `s`, `ed`, `ing` before comparing keywords, so "bombing"/"bombed"/"bombs" match.
- New time-proximity term: `strength += 0.25 * max(0, 1 - hoursApart/48)` — events within 48h score higher, linearly decaying to 0.
- Geo-decay curve tightened: replace the two flat bands (`<0.05` / `<0.2`) with a smooth exponential falloff `0.3 * exp(-dist/0.1)`.
- Output shape (`{from, to, strength}`) unchanged, so `drawArcs`/rendering logic doesn't need to change, only the scoring inputs.

Network Graph clustering keeps its existing 0.05°-grid bucketing (that's clustering, not correlation) but its cross-cluster edge weighting reuses the same stopword/stemming-aware category+keyword overlap for consistency.

### 4. Entity search/filter

- New search input injected into the Palantir control group (below the 5 toggle buttons): `<input id="palantir-search" placeholder="FILTER ENTITIES...">`.
- Typing (debounced ~200ms) sets a module-level `searchQuery` and calls `invalidatePalantirCache()`.
- Matching = case-insensitive substring match against `title`, `category`, `source`.
- **Highlight, not remove**: matching feeds render at full opacity/emphasis; non-matching feeds dim to ~15% opacity. Applies to: map markers (via `addEventMarkers`'s existing per-marker opacity if supported, else a CSS class toggle), Arc Link paths (dim arcs where neither endpoint matches), Network Graph nodes (dim non-matching cluster nodes).
- Clicking a highlighted Arc endpoint or Network node opens the existing (currently unused) `.palantir-entity-card` / `.pec-*` markup as a popup — reusing dead CSS instead of adding new styles. Populated with: title, source, severity dot, timestamp, category, and (for Arc/Network) a short list of its top correlated connections (`pec-connections` block already has markup for this).
- Clearing the search box (empty string) resets all layers to full opacity.

### 5. Robustness fixes

- Single shared default: replace both hardcoded coordinate literals (25856, 26066) with reads of `window.ACTIVE_LOC` (confirmed live global, no fallback literal needed in Palantir's own code — `ACTIVE_LOC` itself already initializes to `PH_LOCATIONS['national']` at declaration).
- `localStorage` persistence: on any toggle change, write `{timeline, arcs, pulse, network, watchzones, searchQuery}` to `localStorage['palantir-state']`. On `palantirInit()`, read it back and re-toggle layers whose flag was true (still gated behind `window.gmap` readiness, same as today's init gating).

### 6. AUTO-COP contract preservation

No changes to:
- Function names `window.palantirToggleArcs`, `window.palantirTogglePulse` (and the other three toggles) — signatures and global exposure stay identical.
- Button IDs `#palantir-arcs-btn`, `#palantir-pulse-btn` and their `.active` class toggling — AUTO-COP (lines 26134–26150) reads this class directly to decide whether to auto-trigger.

### 7. Versioning

Header comment bumped from `PALANTIR ENGINE v1.0` to `PALANTIR ENGINE v2.0 — Geospatial Intelligence Overlay` per project convention (version lives in file/section header, bumped on functional change).

## Data Flow Summary

```
allFeeds (global, refreshed elsewhere)
   │
   ▼
getActivePalantirFeeds()  ──── applies timeline cutoff + search dimming
   │
   ├──▶ computeArcs()  ──cache──▶ drawArcs()      (draw runs on pan/zoom)
   ├──▶ computeNetwork()──cache──▶ drawNetwork()   (draw runs on pan/zoom)
   ├──▶ renderTimelineBars()
   ├──▶ renderPulseRings()
   └──▶ addEventMarkers()  (existing, elsewhere in file)

renderWatchzones() ── reads window.ACTIVE_LOC directly (no feed dependency)
```

## Verification Plan

No test suite exists for this static-site project; GitHub Pages deploys directly from the repo. Verification is manual, in-browser, via chrome-devtools/Playwright MCP against a locally-served `index.html`:

1. Toggle each of the 5 Palantir layers on/off individually — confirm visual render matches v1.0 behavior (no regression).
2. Pan and zoom the map with Arc Links + Network Graph active — confirm smooth reprojection with no visible recompute lag (compute/draw split working).
3. Scrub the Temporal Timeline — confirm Arc Links and Network Graph now update to respect the cutoff (fixes problem 4).
4. Type a search query — confirm matching entities stay highlighted, non-matching dim, across markers/arcs/network. Click a highlighted node — confirm the entity card popup renders with correct data.
5. Reload the page after enabling several layers + a search query — confirm state restores from localStorage.
6. Manually drive AUTO-COP to HIGH/CRITICAL (or inspect via console) — confirm Arc Links + Threat Pulse still auto-activate/deactivate exactly as before.

## Rollout

- Commit locally per standard workflow.
- **Do not push** — this repo deploys live to the Commander's dashboard via GitHub Pages. Push requires explicit Commander go-ahead after review.
