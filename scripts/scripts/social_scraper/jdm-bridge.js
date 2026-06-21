/**
 * JDM Command Center Integration Bridge
 * Connects Social Scraper to JDM Intel Feeds
 * 
 * Usage: node jdm-bridge.js
 * 
 * Provides WebSocket connection to JDM dashboard and REST API for manual scraping
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// ─── STATE ─────────────────────────────────────────────────────────────────────
const state = {
  connected: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 10,
  queue: [],
  results: [],
  stats: { posts: 0, profiles: 0, hashtags: 0, jobs: 0, errors: 0 },
};

// ─── WEBSOCKET CONNECTION ──────────────────────────────────────────────────────
let ws = null;
const WS_URL = config.jdm.webhookPort ? `ws://localhost:${config.jdm.webhookPort}` : null;

function connectWebSocket() {
  // Skip WebSocket if not configured
  if (!WS_URL) {
    log('system', '⏹ WebSocket disabled - using HTTP API only on port 8765');
    return;
  }
  
  ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    state.connected = true;
    state.reconnectAttempts = 0;
    log('system', `✓ Connected to JDM Command Center at ${WS_URL}`);
    
    // Send initial handshake
    ws.send(JSON.stringify({
      type: 'SOCIAL_SCRAPER_READY',
      platforms: Object.keys(config.platforms),
      timestamp: new Date().toISOString(),
    }));
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleIncomingMessage(msg);
    } catch (e) {
      log('system', `⚠ Parse error: ${e.message}`);
    }
  });

  ws.on('close', () => {
    state.connected = false;
    log('system', '⏹ Disconnected from JDM Command Center');
    scheduleReconnect();
  });

  ws.on('error', (err) => {
    log('system', `✗ WebSocket error: ${err.message}`);
  });
}

function scheduleReconnect() {
  if (state.reconnectAttempts < state.maxReconnectAttempts) {
    state.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
    log('system', `⟳ Reconnecting in ${delay/1000}s (attempt ${state.reconnectAttempts})...`);
    setTimeout(connectWebSocket, delay);
  }
}

// ─── MESSAGE HANDLING ──────────────────────────────────────────────────────────
function handleIncomingMessage(msg) {
  switch (msg.type) {
    case 'SCRAPER_COMMAND':
      handleScraperCommand(msg.payload);
      break;
    case 'SCRAPER_BULK':
      handleBulkCommand(msg.payload);
      break;
    case 'SCRAPER_STATUS':
      sendStatus();
      break;
    case 'SCRAPER_EXPORT':
      handleExport(msg.format || 'json');
      break;
  }
}

function handleScraperCommand(payload) {
  const { platform, action, target, max } = payload;
  log(platform, `Executing: ${action} on ${target}`);
  
  // Queue the job
  const job = {
    id: Date.now().toString(36),
    platform,
    action,
    target,
    max: max || 30,
    status: 'pending',
    timestamp: new Date().toISOString(),
  };
  
  state.queue.push(job);
  processQueue();
}

async function processQueue() {
  if (state.queue.length === 0) return;
  
  const job = state.queue.find(j => j.status === 'pending');
  if (!job) return;
  
  job.status = 'running';
  broadcast({ type: 'SCRAPER_JOB_STARTED', job });

  try {
    // In demo mode, simulate scraping
    // In production, this would call the actual scraper modules
    const results = await simulateScrape(job.platform, job.action, job.target, job.max);
    
    job.status = 'done';
    state.results.push(...results);
    state.stats.jobs++;
    
    if (job.action === 'profile') state.stats.profiles++;
    else if (job.action === 'hashtag') state.stats.hashtags += results.length;
    else state.stats.posts += results.length;
    
    broadcast({
      type: 'SCRAPER_JOB_COMPLETE',
      job,
      results: results.slice(0, 5), // Send first 5 as preview
      total: results.length,
    });
    
    // Broadcast to JDM feed
    results.forEach(item => {
      broadcast({
        type: 'SOCIAL_FEED_ITEM',
        item: {
          id: item._id,
          source: `SOCIAL_${job.platform.toUpperCase()}`,
          tag: job.platform,
          title: item.text?.substring(0, 100) || `Profile: ${item.username || item.author}`,
          body: item.text?.substring(0, 300) || item.bio || '',
          severity: 'low',
          location: 'Social Media',
          time: new Date().toLocaleTimeString('en-US', { hour12: false }),
          timestamp: item._scraped_at || new Date().toISOString(),
          url: item.url,
          metrics: {
            likes: item.likes,
            followers: item.followers,
            shares: item.shares,
          },
        },
      });
    });
    
    log(job.platform, `✓ Complete: ${results.length} records from ${job.target}`);
  } catch (err) {
    job.status = 'error';
    state.stats.errors++;
    broadcast({ type: 'SCRAPER_JOB_ERROR', job, error: err.message });
    log(job.platform, `✗ Error: ${err.message}`);
  }
  
  // Process next in queue
  setTimeout(processQueue, config.stealth.requestDelayMs);
}

// ─── SIMULATION (Demo Mode) ────────────────────────────────────────────────────
async function simulateScrape(platform, action, target, max) {
  // Simulate network delay
  await new Promise(r => setTimeout(r, 500 + Math.random() * 1500));
  
  const results = [];
  const count = action === 'profile' ? 1 : Math.min(max, Math.floor(10 + Math.random() * max * 0.8));
  
  for (let i = 0; i < count; i++) {
    const baseTime = Date.now() + i * 100;
    results.push({
      _id: `${platform}_${action}_${baseTime.toString(36)}`,
      _scraped_at: new Date().toISOString(),
      platform,
      type: action,
      ...(action === 'profile' 
        ? {
            username: target.replace('@', '').replace('#', ''),
            display_name: target.replace('@', '').replace(/_/g, ' '),
            bio: `Public ${platform} profile scraped for intelligence analysis.`,
            followers: `${(Math.random() * 500 + 10).toFixed(1)}K`,
            following: Math.floor(Math.random() * 2000),
            verified: Math.random() > 0.7,
            url: `https://${platform === 'x' ? 'x.com' : platform + '.com'}/${target}`,
          }
        : {
            author: target,
            text: generateMockText(platform, action),
            likes: Math.floor(Math.random() * 50000).toLocaleString(),
            comments: Math.floor(Math.random() * 5000).toLocaleString(),
            shares: Math.floor(Math.random() * 10000).toLocaleString(),
            timestamp: new Date(Date.now() - Math.random() * 86400000 * 30).toISOString(),
            url: `https://example.com/p/${Math.random().toString(36).slice(2, 10)}`,
            hashtags: ['#trending', '#viral', '#news'].slice(0, Math.floor(Math.random() * 3)),
          }
      ),
    });
  }
  
  return results;
}

function generateMockText(platform, action) {
  const texts = {
    x: [
      'Breaking developments continue to unfold. Multiple sources confirming ongoing situation.',
      'Thread: Key insights and analysis from recent events. Thread 🧵',
      'JUST IN: Major announcement expected within hours. Stay tuned for updates.',
      'Critical infrastructure alert: Monitoring situation closely for impact assessment.',
    ],
    facebook: [
      'Official update from our page. Thank you for your continued support.',
      'Behind the scenes look at our operations. More details coming soon.',
      'Community announcement: Important information for all members.',
    ],
    instagram: [
      'New content drop 🔥 Link in bio for full details',
      'Morning update ✨ #lifestyle #photography',
      'Breaking news on our channel — swipe up for details',
    ],
  };
  return texts[platform]?.[Math.floor(Math.random() * texts[platform].length)] || 'Social media content';
}

// ─── BROADCAST & LOGGING ───────────────────────────────────────────────────────
function broadcast(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendStatus() {
  broadcast({
    type: 'SCRAPER_STATUS',
    state: {
      connected: state.connected,
      queue: state.queue.length,
      stats: state.stats,
      lastUpdate: new Date().toISOString(),
    },
  });
}

function handleExport(format) {
  const exportDir = config.export.dir;
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `social_export_${timestamp}.${format}`;
  const filepath = path.join(exportDir, filename);
  
  let content = '';
  
  if (format === 'json') {
    content = JSON.stringify(state.results, null, 2);
  } else if (format === 'csv') {
    const headers = [...new Set(state.results.flatMap(r => Object.keys(r)))];
    const rows = state.results.map(r => 
      headers.map(h => `"${(r[h] ?? '').toString().replace(/"/g, '""')}"`).join(',')
    );
    content = [headers.join(','), ...rows].join('\n');
  } else {
    content = state.results.map(r => JSON.stringify(r)).join('\n');
  }
  
  fs.writeFileSync(filepath, content);
  broadcast({ type: 'SCRAPER_EXPORT', file: filepath, count: state.results.length });
  log('system', `↓ Exported ${state.results.length} records to ${filepath}`);
}

function log(platform, msg) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  const icons = { x: '𝕏', facebook: 'FB', instagram: 'IG', system: 'SYS' };
  console.log(`[${ts}] [${icons[platform] || 'SYS'}] ${msg}`);
}

// ─── HTTP SERVER (REST API) ─────────────────────────────────────────────────────
const HTTP_PORT = 8765;

const httpServer = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
  
  // GET /status
  if (url.pathname === '/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: state.connected,
      queue: state.queue.length,
      stats: state.stats,
      queueItems: state.queue,
    }, null, 2));
    return;
  }
  
  // GET /results
  if (url.pathname === '/results' && req.method === 'GET') {
    const platform = url.searchParams.get('platform') || 'all';
    const limit = parseInt(url.searchParams.get('limit') || '100');
    
    let results = state.results;
    if (platform !== 'all') {
      results = results.filter(r => r.platform === platform);
    }
    results = results.slice(0, limit);
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(results, null, 2));
    return;
  }
  
  // POST /scrape
  if (url.pathname === '/scrape' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        handleScraperCommand(payload);
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'queued', jobId: state.queue[state.queue.length - 1].id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // POST /bulk
  if (url.pathname === '/bulk' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const jobs = JSON.parse(body);
        if (!Array.isArray(jobs)) throw new Error('Must be an array');
        jobs.forEach(job => handleScraperCommand(job));
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'queued', count: jobs.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  
  // Not found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ─── STARTUP ───────────────────────────────────────────────────────────────────
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  🤖 ROBOT.SCRAPE — Social Media Intelligence Bridge        ║');
console.log('║  JDM Command Center Integration                            ║');
console.log('╠════════════════════════════════════════════════════════════╣');

// Connect WebSocket
connectWebSocket();

// Start HTTP server
httpServer.listen(HTTP_PORT, () => {
  console.log(`║  HTTP API: http://localhost:${HTTP_PORT}                       ║`);
  console.log(`║  WebSocket: ${WS_URL}                                ║`);
  console.log('║  Platforms: 𝕏  •  Facebook  •  Instagram                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Ready for JDM Command Center integration.');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n⏹ Shutting down...');
  if (ws) ws.close();
  httpServer.close();
  process.exit(0);
});