# Palantir Engine v2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Palantir map-overlay engine in `index.html` (jdm-dashboard) from v1.0 to v2.0: split expensive per-layer computation from cheap screen redraw, upgrade the relatedness heuristic, add entity search/filter with highlight-not-remove semantics, fix a duplicated hardcoded AOR fallback, and persist layer/search state across reloads — without breaking the AUTO-COP crisis-escalation integration.

**Architecture:** All changes are inline edits to the existing self-contained IIFE at `index.html` lines ~25477–25989 (the `PALANTIR ENGINE` block). No new files, no build step — this is a vanilla single-file static site deployed via GitHub Pages. Each layer (Arc Links, Network Graph) is split into a cached **compute** phase (runs on feed/filter change) and a cheap **draw** phase (runs on pan/zoom), tied together by a new shared `getActivePalantirFeeds()` filter pipeline and an `invalidatePalantirCache()` trigger.

**Tech Stack:** Vanilla JS (IIFE, no modules), Leaflet.js (`L.circle`, `L.marker`, `gmap.latLngToContainerPoint`), inline `<style>` CSS, `localStorage` for persistence. No test framework exists in this repo — verification is manual, in-browser, via chrome-devtools/Playwright MCP tools against a locally served copy of `index.html`.

## Global Constraints

- Edit in place inside `index.html` — do not extract Palantir into a separate file (repo convention: single-file, no build step).
- Preserve exact global function names and signatures: `window.palantirToggleTimeline`, `window.palantirToggleArcs`, `window.palantirTogglePulse`, `window.palantirToggleNetwork`, `window.palantirToggleWatchzones` — AUTO-COP (lines ~26134–26150) calls these directly and reads `#palantir-arcs-btn` / `#palantir-pulse-btn` `.active` class state. Do not rename or change what triggers `.active`.
- Do not touch AUTO-COP's own logic (`updateAutoCOP`, radar, scan pulse) — only ensure Palantir's public toggle contract stays stable.
- No new hardcoded AOR coordinates anywhere in Palantir code — use `window.ACTIVE_LOC` (confirmed live global, declared `index.html:3717`, assigned `index.html:4097`).
- Bump the header comment from `PALANTIR ENGINE v1.0` to `PALANTIR ENGINE v2.0` as the final task, per project convention that the version lives in the file/section header.
- Every task must be verified live in a browser (no test suite exists) before moving to the next task. Use chrome-devtools or Playwright MCP tools to open the local `index.html` file, exercise the feature, and inspect console/visual state.
- Commit after every task. Do NOT push to the remote — this repo deploys live via GitHub Pages; push requires explicit Commander sign-off after full review.
- Spec reference: `docs/superpowers/specs/2026-07-04-palantir-v2-design.md`.

---

### Task 1: Shared active-feed pipeline + cache invalidation scaffold

**Files:**
- Modify: `index.html:25485-25503` (STATE section — add new module-level state)
- Modify: `index.html:25970-25987` (MAP MOVE/ZOOM REFRESH + INIT sections)

**Interfaces:**
- Produces: `getActivePalantirFeeds()` → `Array<Feed & {_dimmed: boolean}>`, where `Feed` is the existing shape from `window.allFeeds` (`{lat, lng, title, category, source, severity, timestamp|_ts}`).
- Produces: `invalidatePalantirCache()` → `void`. Clears cached compute results and triggers a synchronous recompute of any currently-active layer (Arc Links, Network Graph) using the current `getActivePalantirFeeds()` output.
- Produces: module-level `let searchQuery = ''` and `let timelineCutoffPct = 1` (1 = "all events", matches existing `palantirTimelineSeek` semantics where `pct >= 0.99` means all events).
- Consumes: existing `window.allFeeds`, existing `currentTimeIdx` (already declared at `index.html:25494`).

This task lays the plumbing every later task depends on. No visible behavior changes yet — `getActivePalantirFeeds()` is written but not yet wired into any renderer (that happens in Tasks 2–3). `timelineCutoffPct` is a new tracking variable separate from `currentTimeIdx` (used only for animation state) so the cutoff value survives regardless of play/pause state.

- [ ] **Step 1: Add new state variables**

At `index.html:25485-25503`, after the existing `const SEV_COLORS = {...}` block, add:

```javascript
// ─── v2.0 STATE: shared feed pipeline ───────────────────────────────────
let searchQuery = '';
let timelineCutoffPct = 1; // 1 = all events, matches palantirTimelineSeek's pct>=0.99 semantics
let cachedArcConnections = null;
let cachedNetworkNodes = null;

const STOPWORDS = new Set(['the','and','with','from','this','that','into','over','after',
  'have','been','were','they','their','will','said','also','more','than','when','what',
  'where','which','while','about','could','would','should','there']);

function stem(word) {
  if (word.endsWith('ing') && word.length > 6) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 4) return word.slice(0, -1);
  return word;
}

function matchesSearchQuery(feed, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  return (feed.title || '').toLowerCase().includes(q) ||
         (feed.category || '').toLowerCase().includes(q) ||
         (feed.source || '').toLowerCase().includes(q);
}

function getActivePalantirFeeds() {
  const now = Date.now();
  const oldest = now - 7 * 24 * 3600 * 1000;
  const cutoff = oldest + timelineCutoffPct * (now - oldest);

  return (window.allFeeds || [])
    .filter(f => f.lat && f.lng)
    .filter(f => {
      if (timelineCutoffPct >= 0.99) return true;
      const ts = f.timestamp || f._ts || now;
      return ts <= cutoff;
    })
    .map(f => ({ ...f, _dimmed: !matchesSearchQuery(f, searchQuery) }));
}

function invalidatePalantirCache() {
  cachedArcConnections = null;
  cachedNetworkNodes = null;
  if (arcsActive) { computeArcs(); drawArcs(); }
  if (networkActive) { computeNetwork(); drawNetwork(); }
}
```

Note: `computeArcs`/`drawArcs`/`computeNetwork`/`drawNetwork` are defined in Tasks 2–3 — this step only adds the scaffold that calls them; the functions themselves don't exist until those tasks land, so this step alone will produce a "not defined" console error if tested in isolation. That's expected — Step 2 below verifies via a temporary stub, then Tasks 2–3 replace the stubs with real implementations.

- [ ] **Step 2: Add temporary stub functions so the scaffold is testable in isolation**

Immediately after the block from Step 1, add temporary stubs (Tasks 2 and 3 will replace these with real implementations in the same location):

```javascript
// TEMP STUBS — replaced by Task 2 (arcs) and Task 3 (network)
function computeArcs() { console.log('[PALANTIR v2] computeArcs stub called'); }
function drawArcs() { console.log('[PALANTIR v2] drawArcs stub called'); }
function computeNetwork() { console.log('[PALANTIR v2] computeNetwork stub called'); }
function drawNetwork() { console.log('[PALANTIR v2] drawNetwork stub called'); }
```

- [ ] **Step 3: Verify in browser — scaffold loads without errors**

Serve the repo locally and open it:

```bash
cd "C:/Users/josed/jdm-dashboard" && python -m http.server 8080
```

Using chrome-devtools MCP tools: navigate to `http://localhost:8080`, wait for the page to finish loading (Palantir init logs `[PALANTIR] Engine v1.0 initialized` to console after ~2s), then run in the page console (via `evaluate_script` or `javascript_tool`):

```javascript
typeof getActivePalantirFeeds === 'function' && typeof invalidatePalantirCache === 'function'
```

Expected: `true`, and no uncaught console errors. Also verify:

```javascript
getActivePalantirFeeds().length >= 0
```

Expected: returns an array (length depends on live feed data, just confirm no exception).

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/josed/jdm-dashboard" && git add index.html && git commit -m "$(cat <<'EOF'
Add Palantir v2.0 shared feed pipeline scaffold

getActivePalantirFeeds() and invalidatePalantirCache() are the new
single source every layer will read from, applying timeline cutoff
and search-query dimming consistently. Stubs stand in for the real
compute/draw split landing in the next two tasks.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Compute/draw split for Arc Links + improved correlation heuristic

**Files:**
- Modify: `index.html:25663-25744` (existing `createArcLayer`, `renderArcs`, `findRelatedEvents`)
- Modify: `index.html:25913-25925` (`window.palantirToggleArcs`)
- Modify: `index.html:25971-25974` (`onMapUpdate`)
- Remove: the `computeArcs`/`drawArcs` stubs added in Task 1 Step 2

**Interfaces:**
- Consumes: `getActivePalantirFeeds()`, `invalidatePalantirCache()`, `cachedArcConnections`, `STOPWORDS`, `stem()` (all from Task 1).
- Produces: `computeArcs()` → `void` (writes to `cachedArcConnections`). `drawArcs()` → `void` (reads `cachedArcConnections`, draws SVG paths). `scoreRelatedness(feeds)` → `Array<{from, to, strength}>` (replaces `findRelatedEvents`, same output shape so no downstream signature changes needed).
- Note: `arcsActive`, `arcLayer`, `arcLines` remain as existing module state (declared `index.html:25488,25495,25499`) — unchanged.

This task replaces `renderArcs`/`findRelatedEvents` with the compute/draw split and the upgraded heuristic (stopwords, stemming, time-proximity, tighter geo-decay) described in spec section 3.

- [ ] **Step 1: Replace `createArcLayer`/`renderArcs`/`findRelatedEvents` with compute/draw split**

Replace `index.html:25663-25744` (the full block from `// ─── 2. ARC CONNECTIONS` through the end of `findRelatedEvents`) with:

```javascript
// ─── 2. ARC CONNECTIONS ─────────────────────────────────────────────────
function createArcLayer() {
  const mapEl = document.getElementById('gmap');
  if (!mapEl) return;
  if (arcLayer) arcLayer.remove();

  arcLayer = document.createElement('div');
  arcLayer.className = 'palantir-arc-layer';
  arcLayer.innerHTML = '<svg id="palantir-arc-svg"></svg>';
  mapEl.parentElement.appendChild(arcLayer);
}

function computeArcs() {
  const feeds = getActivePalantirFeeds();
  cachedArcConnections = feeds.length < 2 ? [] : scoreRelatedness(feeds);
}

function drawArcs() {
  if (!window.gmap || !arcsActive) return;
  const svg = document.getElementById('palantir-arc-svg');
  if (!svg) return;
  svg.innerHTML = '';
  if (!cachedArcConnections) computeArcs();
  if (!cachedArcConnections.length) return;

  cachedArcConnections.forEach(({ from, to, strength }) => {
    const fromPt = gmap.latLngToContainerPoint(L.latLng(from.lat, from.lng));
    const toPt = gmap.latLngToContainerPoint(L.latLng(to.lat, to.lng));
    if (!fromPt || !toPt) return;

    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 20 || dist > 800) return;

    const cx = (fromPt.x + toPt.x) / 2 - dy * 0.3;
    const cy = (fromPt.y + toPt.y) / 2 + dx * 0.3;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${fromPt.x},${fromPt.y} Q${cx},${cy} ${toPt.x},${toPt.y}`);
    const sevClass = strength >= 0.7 ? 'p-arc-crit' : strength >= 0.4 ? 'p-arc-high' : 'p-arc-med';
    const dimClass = (from._dimmed && to._dimmed) ? ' p-arc-dimmed' : '';
    path.setAttribute('class', `p-arc ${sevClass} p-arc-animated${dimClass}`);
    svg.appendChild(path);
  });
}

function scoreRelatedness(feeds) {
  const connections = [];
  const maxConns = 40;
  const processed = new Set();
  const now = Date.now();

  for (let i = 0; i < feeds.length && connections.length < maxConns; i++) {
    for (let j = i + 1; j < feeds.length && connections.length < maxConns; j++) {
      const a = feeds[i], b = feeds[j];
      const key = `${i}-${j}`;
      if (processed.has(key)) continue;

      let strength = 0;
      if (a.category === b.category && a.category !== 'info') strength += 0.3;
      if (a.source === b.source) strength += 0.1;
      if (a.severity === 'critical' && b.severity === 'critical') strength += 0.4;
      else if (a.severity === b.severity && a.severity !== 'low') strength += 0.15;

      const titleA = (a.title || '').toLowerCase();
      const titleB = (b.title || '').toLowerCase();
      const wordsA = new Set(titleA.split(/\s+/).filter(w => w.length > 4 && !STOPWORDS.has(w)).map(stem));
      const wordsB = new Set(titleB.split(/\s+/).filter(w => w.length > 4 && !STOPWORDS.has(w)).map(stem));
      const shared = [...wordsA].filter(w => wordsB.has(w)).length;
      strength += Math.min(0.4, shared * 0.15);

      const tsA = a.timestamp || a._ts || now;
      const tsB = b.timestamp || b._ts || now;
      const hoursApart = Math.abs(tsA - tsB) / 3600000;
      strength += 0.25 * Math.max(0, 1 - hoursApart / 48);

      const dist = Math.sqrt(Math.pow(a.lat - b.lat, 2) + Math.pow(a.lng - b.lng, 2));
      strength += 0.3 * Math.exp(-dist / 0.1);

      if (strength >= 0.35) {
        connections.push({ from: a, to: b, strength: Math.min(1, strength) });
        processed.add(key);
      }
    }
  }
  return connections.sort((a, b) => b.strength - a.strength).slice(0, 25);
}
```

- [ ] **Step 2: Add `.p-arc-dimmed` CSS class**

At `index.html:25409-25414` (existing `.p-arc` rules), add after `.p-arc-med`:

```css
.p-arc-dimmed { opacity: 0.12 !important; }
```

- [ ] **Step 3: Update `window.palantirToggleArcs` to call compute+draw**

Replace `index.html:25913-25925`:

```javascript
window.palantirToggleArcs = function() {
  arcsActive = !arcsActive;
  const btn = document.getElementById('palantir-arcs-btn');
  if (arcsActive) {
    createArcLayer();
    computeArcs();
    drawArcs();
    if (btn) { btn.classList.add('active'); btn.textContent = '⌁ ARCS ON'; }
    if (typeof addJarvisMsg === 'function') addJarvisMsg('jarvis', '⌁ <strong>PALANTIR Arc Links</strong> active. Animated arcs show connections between related events based on category, proximity, severity, timing, and keyword overlap.');
  } else {
    if (arcLayer) { arcLayer.remove(); arcLayer = null; }
    cachedArcConnections = null;
    if (btn) { btn.classList.remove('active'); btn.textContent = '⌁ ARC LINKS'; }
  }
  savePalantirState();
};
```

(`savePalantirState()` is defined in Task 6 — leave this call in place; it will be a temporary no-op stub until Task 6 lands. Add the stub now: `function savePalantirState() {}` right before this function, to be replaced in Task 6.)

- [ ] **Step 4: Update `onMapUpdate` to call draw only**

Replace `index.html:25971-25974`:

```javascript
function onMapUpdate() {
  if (arcsActive) requestAnimationFrame(drawArcs);
  if (networkActive) requestAnimationFrame(drawNetwork);
}
```

- [ ] **Step 5: Remove the Task 1 stubs for arcs**

Delete the `function computeArcs() {...}` and `function drawArcs() {...}` stub lines added in Task 1 Step 2 (the `computeNetwork`/`drawNetwork` stubs stay for now — Task 3 replaces those).

- [ ] **Step 6: Verify in browser**

With the local server running (`python -m http.server 8080` from repo root), use chrome-devtools MCP to navigate to `http://localhost:8080`, wait for `[PALANTIR] Engine v1.0 initialized` in console, then:

1. Click the "⌁ ARC LINKS" button (or run `window.palantirToggleArcs()` via `evaluate_script`). Confirm arcs render (visually, or via `document.querySelectorAll('#palantir-arc-svg path').length > 0` if feed data exists).
2. Pan the map (simulate via `gmap.panBy([50,50])` in console, or drag). Confirm arcs reposition and `cachedArcConnections` (inspect via console) is unchanged in length before/after the pan — proving draw-only reprojection, not recompute.
3. Toggle arcs off, confirm `cachedArcConnections === null` after.

Expected: no console errors, arcs render and reposition correctly, cache persists across pan.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/josed/jdm-dashboard" && git add index.html && git commit -m "$(cat <<'EOF'
Split Arc Links into compute/draw phases, upgrade correlation heuristic

computeArcs() now runs only on toggle/feed/filter change; drawArcs()
handles cheap reprojection on pan/zoom. scoreRelatedness() replaces
findRelatedEvents() with stopword filtering, light stemming, a
time-proximity term, and a smoother geo-decay curve.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Compute/draw split for Network Graph

**Files:**
- Modify: `index.html:25780-25849` (existing `createNetworkSvg`, `renderNetwork`)
- Modify: `index.html` (the `window.palantirToggleNetwork` function, originally lines 25940-25952, shifted by earlier edits — locate via `grep -n "palantirToggleNetwork ="`)
- Remove: the `computeNetwork`/`drawNetwork` stubs added in Task 1 Step 2

**Interfaces:**
- Consumes: `getActivePalantirFeeds()`, `cachedNetworkNodes` (from Task 1). Reuses `scoreRelatedness`-style category overlap logic inline (network clustering stays grid-based; only its cross-cluster edge weighting gains stopword/stemming awareness per spec section 3's closing note).
- Produces: `computeNetwork()` → `void` (writes `cachedNetworkNodes`, an array of `{lat, lng, feeds, categories: Set, maxSev}`, same shape `locGroups` values had in v1.0). `drawNetwork()` → `void` (reads `cachedNetworkNodes`, draws SVG nodes/edges).

- [ ] **Step 1: Replace `createNetworkSvg`/`renderNetwork` with compute/draw split**

Replace `index.html:25780-25849` (the `// ─── 4. NETWORK GRAPH` block) with:

```javascript
// ─── 4. NETWORK GRAPH ───────────────────────────────────────────────────
function createNetworkSvg() {
  const mapEl = document.getElementById('gmap');
  if (!mapEl) return;
  if (networkSvg) networkSvg.remove();
  networkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  networkSvg.id = 'palantir-network-svg';
  mapEl.parentElement.appendChild(networkSvg);
}

function computeNetwork() {
  const feeds = getActivePalantirFeeds();
  if (!feeds.length) { cachedNetworkNodes = []; return; }

  const locGroups = {};
  const sevRank = { critical:0, high:1, medium:2, low:3, info:4 };
  feeds.forEach(f => {
    const key = `${Math.round(f.lat * 20) / 20},${Math.round(f.lng * 20) / 20}`;
    if (!locGroups[key]) locGroups[key] = { lat: f.lat, lng: f.lng, feeds: [], categories: new Set(), maxSev: 'info', dimmed: true };
    locGroups[key].feeds.push(f);
    locGroups[key].categories.add(f.category);
    if (sevRank[f.severity] < sevRank[locGroups[key].maxSev]) locGroups[key].maxSev = f.severity;
    if (!f._dimmed) locGroups[key].dimmed = false;
  });

  cachedNetworkNodes = Object.values(locGroups).sort((a, b) => b.feeds.length - a.feeds.length).slice(0, 30);
}

function drawNetwork() {
  if (!networkSvg || !window.gmap || !networkActive) return;
  networkSvg.innerHTML = '';
  if (!cachedNetworkNodes) computeNetwork();
  const nodes = cachedNetworkNodes;
  if (!nodes.length) return;

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const sharedCats = [...a.categories].filter(c => b.categories.has(c));
      if (!sharedCats.length) continue;

      const ptA = gmap.latLngToContainerPoint(L.latLng(a.lat, a.lng));
      const ptB = gmap.latLngToContainerPoint(L.latLng(b.lat, b.lng));
      if (!ptA || !ptB) continue;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', ptA.x); line.setAttribute('y1', ptA.y);
      line.setAttribute('x2', ptB.x); line.setAttribute('y2', ptB.y);
      line.setAttribute('class', 'p-net-line');
      const baseOpacity = Math.min(0.6, sharedCats.length * 0.2);
      line.style.opacity = (a.dimmed && b.dimmed) ? baseOpacity * 0.15 : baseOpacity;
      networkSvg.appendChild(line);
    }
  }

  nodes.forEach(node => {
    const pt = gmap.latLngToContainerPoint(L.latLng(node.lat, node.lng));
    if (!pt) return;
    const r = Math.min(10, 3 + node.feeds.length * 0.8);
    const color = SEV_COLORS[node.maxSev] || SEV_COLORS.info;

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', pt.x); circle.setAttribute('cy', pt.y);
    circle.setAttribute('r', r);
    circle.setAttribute('class', 'p-net-node');
    circle.style.fill = color;
    circle.style.opacity = node.dimmed ? 0.15 : 0.7;
    circle.dataset.nodeIdx = String(cachedNetworkNodes.indexOf(node));
    networkSvg.appendChild(circle);

    if (node.feeds.length >= 3) {
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', pt.x + r + 3); label.setAttribute('y', pt.y + 3);
      label.setAttribute('class', 'p-net-label');
      label.textContent = `${node.feeds.length}`;
      networkSvg.appendChild(label);
    }
  });
}
```

Note: `circle.dataset.nodeIdx` is added here so Task 5 (entity card on click) can look up the source node without re-querying — no click handler is wired yet in this task.

- [ ] **Step 2: Update `window.palantirToggleNetwork` to call compute+draw**

Find the function (search `grep -n "palantirToggleNetwork = function"`) and update its body to call `computeNetwork(); drawNetwork();` instead of `renderNetwork();`, and clear `cachedNetworkNodes = null;` in the else branch, mirroring the arcs toggle pattern from Task 2 Step 3:

```javascript
window.palantirToggleNetwork = function() {
  networkActive = !networkActive;
  const btn = document.getElementById('palantir-network-btn');
  if (networkActive) {
    createNetworkSvg();
    computeNetwork();
    drawNetwork();
    if (btn) { btn.classList.add('active'); btn.textContent = '⬡ NETWORK ON'; }
    if (typeof addJarvisMsg === 'function') addJarvisMsg('jarvis', '⬡ <strong>PALANTIR Network Graph</strong> active. Nodes represent event clusters, lines show shared intelligence categories. Node size = event density, color = max severity.');
  } else {
    if (networkSvg) { networkSvg.remove(); networkSvg = null; }
    cachedNetworkNodes = null;
    if (btn) { btn.classList.remove('active'); btn.textContent = '⬡ NETWORK'; }
  }
  savePalantirState();
};
```

- [ ] **Step 3: Remove the Task 1 stubs for network**

Delete the `function computeNetwork() {...}` and `function drawNetwork() {...}` stub lines added in Task 1 Step 2.

- [ ] **Step 4: Verify in browser**

Same local server setup as Task 2. Via chrome-devtools MCP:

1. Toggle Network Graph on. Confirm nodes/edges render: `document.querySelectorAll('#palantir-network-svg circle').length > 0` (if feed data has ≥1 clustered location).
2. Pan the map. Confirm `cachedNetworkNodes` array reference (or its `.length`) is unchanged before/after pan — proving draw-only reprojection.
3. Toggle off, confirm `cachedNetworkNodes === null`.

Expected: no console errors, correct render, cache stable across pan.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/josed/jdm-dashboard" && git add index.html && git commit -m "$(cat <<'EOF'
Split Network Graph into compute/draw phases

computeNetwork() clusters feeds and caches nodes; drawNetwork() only
reprojects cached nodes to screen coordinates on pan/zoom. Nodes also
carry a per-cluster dimmed flag for the upcoming search/filter feature.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire Timeline scrubbing into the shared pipeline (fixes Arc/Network desync)

**Files:**
- Modify: `index.html:25604-25628` (`palantirTimelineSeek`)

**Interfaces:**
- Consumes: `timelineCutoffPct` (Task 1), `invalidatePalantirCache()` (Task 1).
- Produces: `palantirTimelineSeek(pct)` now also updates `timelineCutoffPct` and triggers cache invalidation, so Arc Links and Network Graph respect the scrub position (previously they ignored it entirely — spec problem 4).

- [ ] **Step 1: Update `palantirTimelineSeek` to set `timelineCutoffPct` and invalidate**

Modify `index.html:25604-25628`. The existing function body computes `cutoff` locally — add a line to persist it to the shared `timelineCutoffPct` state and call `invalidatePalantirCache()`:

```javascript
function palantirTimelineSeek(pct) {
  pct = Math.max(0, Math.min(1, pct));
  currentTimeIdx = pct;
  timelineCutoffPct = pct;
  const cursor = document.getElementById('ptl-cursor');
  if (cursor) cursor.style.left = `${pct * 100}%`;

  const now = Date.now();
  const oldest = now - 7 * 24 * 3600 * 1000;
  const cutoff = oldest + pct * (now - oldest);

  const feeds = (window.allFeeds || []).filter(f => {
    const ts = f.timestamp || f._ts || now;
    return ts <= cutoff;
  });

  const label = document.getElementById('ptl-time-label');
  if (label) {
    if (pct >= 0.99) label.textContent = 'ALL EVENTS';
    else label.textContent = new Date(cutoff).toLocaleString('en-PH', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  if (typeof window.addEventMarkers === 'function') {
    window.addEventMarkers(feeds);
  }

  invalidatePalantirCache();
}
```

Note: this keeps the existing local `feeds`/`cutoff` computation for `addEventMarkers` (unchanged behavior for markers) while adding `timelineCutoffPct` as the new shared value that `getActivePalantirFeeds()` (Task 1) reads for Arc Links/Network Graph. During timeline animation playback (`palantirTimelinePlay`'s `setInterval` at ~20fps), this means `invalidatePalantirCache()` fires every tick while arcs/network are active — acceptable since compute is now only as expensive as the active layer count, and typical feed volumes here are in the hundreds, not tens of thousands.

- [ ] **Step 2: Verify in browser**

Via chrome-devtools MCP: toggle Arc Links on, toggle Timeline on, drag the timeline track to roughly the 50% mark (or call `window.palantirTimelineSeek(0.5)` directly). Confirm arcs re-render with fewer/different connections than at `pct=1` (inspect `document.querySelectorAll('#palantir-arc-svg path').length` before/after, or `cachedArcConnections.length`).

Expected: arc count changes when scrubbing — this was previously impossible (arcs ignored the timeline in v1.0).

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/josed/jdm-dashboard" && git add index.html && git commit -m "$(cat <<'EOF'
Wire Temporal Timeline scrubbing into Arc Links / Network Graph

Fixes a v1.0 inconsistency where scrubbing the timeline filtered map
markers but left Arc Links and Network Graph rendering from the full
unfiltered feed set. Both now respect the same cutoff.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Entity search/filter + entity detail card

**Files:**
- Modify: `index.html:25505-25520` (`injectPalantirControls` — add search input)
- Modify: `index.html:25464-25467` (CSS — add search input styling)
- Modify: `index.html` (network node click handling — extend `drawNetwork` from Task 3 or add a delegated listener near `createNetworkSvg`)
- Modify: `index.html:25428-25454` (existing dead `.palantir-entity-card`/`.pec-*` CSS — no changes needed, just reused)

**Interfaces:**
- Consumes: `searchQuery` (Task 1, currently write-never), `matchesSearchQuery()` (Task 1), `cachedNetworkNodes` (Task 3), `cachedArcConnections` (Task 2).
- Produces: `showEntityCard(feed, connections)` → `void` (renders the `.palantir-entity-card` popup). `hideEntityCard()` → `void`. `window.palantirSearchInput(value)` → `void` (input handler, debounced).

- [ ] **Step 1: Add search input to Palantir controls**

Replace `index.html:25511-25519` (`injectPalantirControls`'s `insertAdjacentHTML` call):

```javascript
  ctrl.insertAdjacentHTML('beforeend', `
    <div class="ctrl-divider"></div>
    <div class="ctrl-group-label" style="color:var(--amber)">PALANTIR</div>
    <input type="text" id="palantir-search" class="palantir-search-input" placeholder="FILTER ENTITIES..." oninput="window.palantirSearchInput(this.value)">
    <button class="map-ctrl-btn" id="palantir-timeline-btn" onclick="window.palantirToggleTimeline()">⏱ TIMELINE</button>
    <button class="map-ctrl-btn" id="palantir-arcs-btn" onclick="window.palantirToggleArcs()">⌁ ARC LINKS</button>
    <button class="map-ctrl-btn" id="palantir-pulse-btn" onclick="window.palantirTogglePulse()">◎ THREAT PULSE</button>
    <button class="map-ctrl-btn" id="palantir-network-btn" onclick="window.palantirToggleNetwork()">⬡ NETWORK</button>
    <button class="map-ctrl-btn" id="palantir-watchzone-btn" onclick="window.palantirToggleWatchzones()">⊚ WATCHZONE</button>
  `);
```

- [ ] **Step 2: Add search input CSS**

At `index.html:25464-25467` (existing `.palantir-ctrl-group`/`.palantir-ctrl-label` rules), add:

```css
.palantir-search-input {
  width:100%; box-sizing:border-box; margin:4px 0;
  background:rgba(6,6,5,0.6); border:1px solid var(--border);
  color:var(--amber-text); font-family:var(--mono); font-size:9px;
  letter-spacing:1px; padding:4px 6px; border-radius:2px;
}
.palantir-search-input:focus { outline:none; border-color:var(--amber-dim); }
.palantir-search-input::placeholder { color:var(--t3); }
```

- [ ] **Step 3: Add debounced search handler and entity card functions**

After the `invalidatePalantirCache()` function from Task 1, add:

```javascript
let searchDebounceTimer = null;
window.palantirSearchInput = function(value) {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchQuery = value.trim();
    invalidatePalantirCache();
    if (typeof window.addEventMarkers === 'function' && window.allFeeds) {
      window.addEventMarkers(getActivePalantirFeeds());
    }
  }, 200);
};

function showEntityCard(feed, relatedConnections) {
  hideEntityCard();
  const card = document.createElement('div');
  card.id = 'palantir-entity-card-popup';
  card.className = 'palantir-entity-card';
  card.style.cssText = 'position:absolute; z-index:900; top:16px; right:16px;';

  const color = SEV_COLORS[feed.severity] || SEV_COLORS.info;
  const ts = feed.timestamp || feed._ts;
  const dateStr = ts ? new Date(ts).toLocaleString('en-PH', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';

  let connHtml = '';
  if (relatedConnections && relatedConnections.length) {
    connHtml = `<div class="pec-connections"><div class="pec-conn-label">CORRELATED EVENTS</div>` +
      relatedConnections.slice(0, 5).map(c => {
        const other = c.from === feed ? c.to : c.from;
        const dotColor = SEV_COLORS[other.severity] || SEV_COLORS.info;
        return `<div class="pec-conn-item"><span class="pec-conn-dot" style="background:${dotColor}"></span>${(other.title||'Untitled').slice(0,60)}</div>`;
      }).join('') + `</div>`;
  }

  card.innerHTML = `
    <div class="pec-header">
      <span class="pec-sev-dot" style="background:${color};color:${color}"></span>
      <span class="pec-source">${feed.source || 'UNKNOWN'}</span>
    </div>
    <div class="pec-title">${feed.title || 'Untitled event'}</div>
    <div class="pec-body">${feed.category || 'uncategorized'}</div>
    <div class="pec-meta">
      <div class="pec-meta-item">${dateStr}</div>
      <div class="pec-meta-item">${(feed.severity||'info').toUpperCase()}</div>
    </div>
    ${connHtml}
    <div class="pec-actions"><div class="pec-btn" onclick="window.palantirHideEntityCard()">CLOSE</div></div>
  `;

  const mapEl = document.getElementById('panel-map') || document.getElementById('gmap')?.parentElement;
  if (mapEl) { mapEl.style.position = 'relative'; mapEl.appendChild(card); }
}

function hideEntityCard() {
  document.getElementById('palantir-entity-card-popup')?.remove();
}
window.palantirHideEntityCard = hideEntityCard;
```

- [ ] **Step 4: Wire click handling for Network Graph nodes**

In `createNetworkSvg()` (Task 3, `index.html`), add a delegated click listener right after `networkSvg = document.createElementNS(...)`:

```javascript
function createNetworkSvg() {
  const mapEl = document.getElementById('gmap');
  if (!mapEl) return;
  if (networkSvg) networkSvg.remove();
  networkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  networkSvg.id = 'palantir-network-svg';
  networkSvg.style.pointerEvents = 'none';
  networkSvg.addEventListener('click', (e) => {
    const idx = e.target?.dataset?.nodeIdx;
    if (idx === undefined || !cachedNetworkNodes) return;
    const node = cachedNetworkNodes[Number(idx)];
    if (!node || !node.feeds.length) return;
    const primary = node.feeds[0];
    const related = (cachedArcConnections || []).filter(c => c.from === primary || c.to === primary);
    showEntityCard(primary, related);
  });
  mapEl.parentElement.appendChild(networkSvg);
}
```

Note: `.p-net-node` CSS already sets `pointer-events:all` on the circles themselves (`index.html:25472`, unchanged), so clicks reach individual nodes despite the parent SVG's `pointer-events:none`.

- [ ] **Step 5: Verify in browser**

Via chrome-devtools MCP:

1. Toggle Network Graph on. Type a search term matching at least one feed's title/category/source into `#palantir-search` (or set the value and dispatch an `input` event via `evaluate_script`). Confirm after ~200ms: matching nodes render at `opacity:0.7`, non-matching at `opacity:0.15` (inspect `circle.style.opacity` across `#palantir-network-svg circle` elements).
2. Click a node (or call the click handler programmatically with a synthetic event carrying `target.dataset.nodeIdx`). Confirm `#palantir-entity-card-popup` appears with correct title/source/severity.
3. Click "CLOSE". Confirm the card is removed.
4. Clear the search box. Confirm all nodes return to `opacity:0.7`.

Expected: highlight/dim behavior works, entity card renders and dismisses correctly, no console errors.

- [ ] **Step 6: Commit**

```bash
cd "C:/Users/josed/jdm-dashboard" && git add index.html && git commit -m "$(cat <<'EOF'
Add entity search/filter and detail card to Palantir

Search input dims non-matching feeds across Network Graph (and, via
the shared pipeline, Arc Links) rather than removing them. Clicking a
node reuses the previously-dead .palantir-entity-card CSS to show
event detail plus its top correlated connections.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Fix hardcoded AOR fallback + persist layer/search state

**Files:**
- Modify: `index.html:25852-25887` (`renderWatchzones`)
- Modify: `index.html:26064-26074` (AUTO-COP `copAddScanPulse`)
- Modify: `index.html` (replace the `savePalantirState` stub from Task 2 with a real implementation; update `palantirInit`)

**Interfaces:**
- Produces: `savePalantirState()` → `void` (writes toggle states + `searchQuery` to `localStorage['palantir-state']`). `restorePalantirState()` → `void` (reads it back, called once from `palantirInit`).
- Consumes: `window.ACTIVE_LOC` (existing live global, `index.html:3717,4097` — no change needed there, just referencing it).

- [ ] **Step 1: Replace watchzone fallback coordinate**

In `index.html:25856`, replace:

```javascript
  const loc = window.ACTIVE_LOC || { lat: 10.72, lng: 122.56 };
```

with:

```javascript
  const loc = window.ACTIVE_LOC;
  if (!loc) return;
```

(`ACTIVE_LOC` is declared at `index.html:3717` as `let ACTIVE_LOC = PH_LOCATIONS['national']` and is always assigned by the time Palantir can run, since `palantirInit` already waits on `window.gmap` readiness which happens after the main app's location init — so the guard is defensive, not a real fallback path.)

- [ ] **Step 2: Replace the second hardcoded coordinate in AUTO-COP's scan pulse**

In `index.html:26066` (`copAddScanPulse`), replace:

```javascript
  const loc = window.ACTIVE_LOC || { lat: 10.7202, lng: 122.5621 };
```

with:

```javascript
  const loc = window.ACTIVE_LOC;
  if (!loc) return;
```

- [ ] **Step 3: Implement real `savePalantirState`/`restorePalantirState`, replacing the Task 2 stub**

Find and delete the stub `function savePalantirState() {}` added in Task 2 Step 3. In its place, add:

```javascript
function savePalantirState() {
  try {
    localStorage.setItem('palantir-state', JSON.stringify({
      timeline: timelineActive, arcs: arcsActive, pulse: pulseActive,
      network: networkActive, watchzones: watchzonesActive, searchQuery: searchQuery
    }));
  } catch(e) { /* localStorage unavailable (private browsing etc.) — non-fatal */ }
}

function restorePalantirState() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('palantir-state') || 'null'); }
  catch(e) { return; }
  if (!saved) return;

  if (saved.searchQuery) {
    searchQuery = saved.searchQuery;
    const input = document.getElementById('palantir-search');
    if (input) input.value = saved.searchQuery;
  }
  if (saved.timeline) window.palantirToggleTimeline();
  if (saved.arcs) window.palantirToggleArcs();
  if (saved.pulse) window.palantirTogglePulse();
  if (saved.network) window.palantirToggleNetwork();
  if (saved.watchzones) window.palantirToggleWatchzones();
}
```

- [ ] **Step 4: Add `savePalantirState()` calls to the remaining three toggles**

The `palantirToggleArcs` and `palantirToggleNetwork` toggles already call `savePalantirState()` from Tasks 2–3. Replace the other three toggle functions (currently at `index.html:25895-25911`, `25927-25938`, `25954-25965`) with these versions, each adding one `savePalantirState();` line before the closing `};`:

```javascript
window.palantirToggleTimeline = function() {
  timelineActive = !timelineActive;
  const tl = document.getElementById('palantir-timeline');
  const btn = document.getElementById('palantir-timeline-btn');
  if (timelineActive) {
    buildTimeline();
    document.getElementById('palantir-timeline')?.classList.add('active');
    renderTimelineBars();
    if (btn) { btn.classList.add('active'); btn.textContent = '⏱ TIMELINE ON'; }
    if (typeof addJarvisMsg === 'function') addJarvisMsg('jarvis', '⏱ <strong>PALANTIR Temporal Analysis</strong> active. Click the timeline to scrub through events. Press PLAY for animated playback.');
  } else {
    document.getElementById('palantir-timeline')?.classList.remove('active');
    if (timelinePlaying) { clearInterval(timelineInterval); timelinePlaying = false; }
    palantirTimelineSeek(1);
    if (btn) { btn.classList.remove('active'); btn.textContent = '⏱ TIMELINE'; }
  }
  savePalantirState();
};

window.palantirTogglePulse = function() {
  pulseActive = !pulseActive;
  const btn = document.getElementById('palantir-pulse-btn');
  if (pulseActive) {
    renderPulseRings();
    if (btn) { btn.classList.add('active'); btn.textContent = '◎ PULSE ON'; }
    if (typeof addJarvisMsg === 'function') addJarvisMsg('jarvis', '◎ <strong>PALANTIR Threat Pulse</strong> active. Concentric rings radiate from critical/high-severity event locations showing threat impact zones.');
  } else {
    clearPulseRings();
    if (btn) { btn.classList.remove('active'); btn.textContent = '◎ THREAT PULSE'; }
  }
  savePalantirState();
};

window.palantirToggleWatchzones = function() {
  watchzonesActive = !watchzonesActive;
  const btn = document.getElementById('palantir-watchzone-btn');
  if (watchzonesActive) {
    renderWatchzones();
    if (btn) { btn.classList.add('active'); btn.textContent = '⊚ ZONES ON'; }
    if (typeof addJarvisMsg === 'function') addJarvisMsg('jarvis', '⊚ <strong>PALANTIR Watchzones</strong> active. Three concentric security perimeters: Inner (5km), Security Zone (15km), Outer Watch (30km) centered on current AOR.');
  } else {
    clearWatchzones();
    if (btn) { btn.classList.remove('active'); btn.textContent = '⊚ WATCHZONE'; }
  }
  savePalantirState();
};
```

- [ ] **Step 5: Call `restorePalantirState()` from `palantirInit`**

Modify `palantirInit` (originally `index.html:25977-25983`):

```javascript
function palantirInit() {
  if (!window.gmap) { setTimeout(palantirInit, 1000); return; }
  injectPalantirControls();
  gmap.on('moveend', onMapUpdate);
  gmap.on('zoomend', onMapUpdate);
  restorePalantirState();
  console.info('[PALANTIR] Engine v2.0 initialized');
}
```

(Version string bump to `v2.0` folded in here since it touches the same line — Task 7 covers the header comment separately.)

- [ ] **Step 6: Verify in browser**

Via chrome-devtools MCP against the local server:

1. Toggle Arc Links and Network Graph on, type a search query. Reload the page.
2. Confirm after reload (waiting for the `[PALANTIR] Engine v2.0 initialized` console log): both layers are active again (`#palantir-arcs-btn`/`#palantir-network-btn` have class `active`) and `#palantir-search`'s value matches what was typed before reload.
3. Confirm `localStorage.getItem('palantir-state')` contains the expected JSON.
4. Toggle Watchzones on with `window.ACTIVE_LOC` deliberately unset (`evaluate_script`: `window.ACTIVE_LOC = null; window.palantirToggleWatchzones();`) — confirm no exception is thrown (the new guard returns early instead of using a stale hardcoded coordinate).

Expected: state persists correctly across reload, no console errors, watchzone guard behaves safely when `ACTIVE_LOC` is unset.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/josed/jdm-dashboard" && git add index.html && git commit -m "$(cat <<'EOF'
Persist Palantir layer/search state; remove duplicated hardcoded AOR fallback

Both renderWatchzones() and AUTO-COP's copAddScanPulse() previously
fell back to two different hardcoded coordinates. Both now defer to
window.ACTIVE_LOC (the real live global) and no-op safely if it's
somehow unset. Toggle + search state now survives page reload via
localStorage.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Version bump + full end-to-end verification (including AUTO-COP contract)

**Files:**
- Modify: `index.html:25478-25480` (header comment)

**Interfaces:**
- No new interfaces — this task is final polish + a comprehensive regression pass across everything built in Tasks 1–6, plus explicit verification that AUTO-COP's crisis-escalation integration still works.

- [ ] **Step 1: Bump header comment**

Replace `index.html:25478-25480`:

```javascript
// ═══════════════════════════════════════════════════════════════════════════
// PALANTIR ENGINE v1.0 — Geospatial Intelligence Overlay
// ═══════════════════════════════════════════════════════════════════════════
```

with:

```javascript
// ═══════════════════════════════════════════════════════════════════════════
// PALANTIR ENGINE v2.0 — Geospatial Intelligence Overlay
// ═══════════════════════════════════════════════════════════════════════════
```

- [ ] **Step 2: Full manual regression pass in browser**

With the local server running, use chrome-devtools MCP to walk through the complete spec verification checklist in one session:

1. **All 5 layers individually**: toggle Timeline, Arc Links, Threat Pulse, Network Graph, Watchzones on then off, one at a time. Confirm each renders and clears correctly with no console errors.
2. **Compute/draw split**: with Arc Links + Network Graph active, pan and zoom the map repeatedly. Confirm smooth, immediate reprojection (no visible lag/stutter) — the perf win from Tasks 2–3.
3. **Timeline/Arc sync**: with Arc Links active, scrub the timeline to ~30%. Confirm arc count changes (fix from Task 4).
4. **Search highlight**: type a query matching a subset of feeds. Confirm non-matching Network nodes and Arc Links dim to ~15% opacity rather than disappearing (Task 5).
5. **Entity card**: click a highlighted Network node. Confirm the `.palantir-entity-card` popup shows correct title/source/severity/timestamp and up to 5 correlated connections.
6. **Persistence**: with several layers + a search query active, reload the page. Confirm all restore correctly (Task 6).
7. **AUTO-COP contract** — this is the critical regression check: in the browser console, manually invoke `updateAutoCOP(80)` (simulating a CRITICAL-level score) via `evaluate_script`. Confirm:
   - `#palantir-arcs-btn` gains class `active` and Arc Links visibly render (AUTO-COP auto-enabling them).
   - `#palantir-pulse-btn` gains class `active` and Threat Pulse rings render.
   - Then invoke `updateAutoCOP(10)` (NORMAL). Confirm both auto-deactivate (`active` class removed, layers cleared).
8. **AOR fallback**: confirm `window.ACTIVE_LOC` is a real object (`typeof window.ACTIVE_LOC === 'object' && window.ACTIVE_LOC.lat`) and Watchzones renders centered on it correctly.

Expected: every item above passes with no console errors and no visual regressions versus the pre-change v1.0 behavior described in the spec.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/josed/jdm-dashboard" && git add index.html && git commit -m "$(cat <<'EOF'
Bump Palantir Engine to v2.0

Final version header bump after completing the compute/draw split,
correlation heuristic upgrade, entity search/filter, AOR fallback
fix, and state persistence. Full regression pass confirms AUTO-COP's
crisis-escalation contract with Palantir's toggle functions is intact.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Report completion to Commander — do NOT push**

Summarize what changed and explicitly state the branch has NOT been pushed to the remote, since this repo deploys live via GitHub Pages and push requires the Commander's explicit go-ahead per the spec's rollout section.

---

## Post-Implementation

- Per standing order (CLAUDE.md "After any change"): if the Commander has a skill file describing this dashboard/Palantir, update it to match — check for one before closing out; none was found during design research, so likely nothing to update, but confirm.
- Journal this work per the Persistent Memory Protocol: a `task` entry noting Palantir v2.0 shipped locally (commit range), pending Commander review/push decision.
