/**
 * JDM SOCIAL SCRAPER MODULE
 * Inject this into JDM Command Center to add social media scraping capabilities
 * 
 * Add to JDM index.html:
 * 1. Add "SOCIAL" to feed tabs
 * 2. Add SCRAPER_SOURCES for social platforms
 * 3. Add social health indicators
 * 4. Add social feed handlers
 */

// ─── SCRAPER SOURCES ─────────────────────────────────────────────────────────────
const SCRAPER_SOURCES = [
  { key: 'SOCIAL_X',      src: 'X (Twitter)',    tag: 'x',      icon: '𝕏', color: '#e7e9ea' },
  { key: 'SOCIAL_FB',     src: 'Facebook',       tag: 'fb',     icon: 'f', color: '#1877f2' },
  { key: 'SOCIAL_IG',     src: 'Instagram',      tag: 'ig',     icon: '◉', color: '#e1306c' },
  { key: 'SOCIAL_TIKTOK', src: 'TikTok',         tag: 'tiktok', icon: '♪', color: '#00f2ea' },
];

// ─── SOCIAL SCRAPER CLASS ─────────────────────────────────────────────────────────
class SocialScraperBridge {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.results = [];
    this.stats = { posts: 0, profiles: 0, hashtags: 0, jobs: 0, errors: 0 };
    this.httpPort = 8765;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`ws://localhost:18789`);

        this.ws.onopen = () => {
          this.connected = true;
          this.reconnectAttempts = 0;
          console.log('✓ Social Scraper connected to Gateway');
          this.sendHandshake();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = () => {
          this.connected = false;
          console.log('⏹ Social Scraper disconnected');
          this.scheduleReconnect();
        };

        this.ws.onerror = (err) => {
          console.error('✗ WebSocket error:', err);
          reject(err);
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  scheduleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      setTimeout(() => this.connect(), delay);
    }
  }

  sendHandshake() {
    this.send({
      type: 'SOCIAL_SCRAPER_READY',
      platforms: ['x', 'facebook', 'instagram'],
      timestamp: new Date().toISOString(),
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  handleMessage(data) {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case 'SOCIAL_FEED_ITEM':
          this.handleFeedItem(msg.item);
          break;
        case 'SCRAPER_JOB_COMPLETE':
          this.handleJobComplete(msg);
          break;
        case 'SCRAPER_STATUS':
          this.updateStats(msg.state);
          break;
      }
    } catch (e) {
      console.error('Parse error:', e);
    }
  }

  handleFeedItem(item) {
    // Add to JDM feed system
    if (typeof addFeedItem === 'function') {
      addFeedItem({
        id: item.id,
        source: item.source,
        tag: item.tag,
        title: item.title,
        body: item.body,
        severity: item.severity || 'low',
        location: item.location || 'Social Media',
        time: item.time,
        timestamp: item.timestamp,
        url: item.url,
      });
    }

    // Update stats
    this.stats.posts++;
    updateSourceStatus(item.source, 'ok');
  }

  handleJobComplete(msg) {
    console.log(`✓ Job complete: ${msg.total} results from ${msg.job.target}`);
    this.stats.jobs++;
    renderSocialStats();
  }

  updateStats(state) {
    this.stats = { ...this.stats, ...state.stats };
    renderSocialStats();
  }

  // ── HTTP API FALLBACK ─────────────────────────────────────────────────────────
  async fetchViaHttp(endpoint) {
    try {
      const res = await fetch(`http://localhost:${this.httpPort}${endpoint}`);
      return await res.json();
    } catch (e) {
      console.error('HTTP fetch error:', e);
      return null;
    }
  }

  async getStatus() {
    return await this.fetchViaHttp('/status');
  }

  async getResults(platform = 'all', limit = 100) {
    return await this.fetchViaHttp(`/results?platform=${platform}&limit=${limit}`);
  }

  async submitJob(platform, action, target, max = 30) {
    try {
      const res = await fetch(`http://localhost:${this.httpPort}/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, action, target, max }),
      });
      return await res.json();
    } catch (e) {
      console.error('Submit job error:', e);
      return null;
    }
  }

  async submitBulk(jobs) {
    try {
      const res = await fetch(`http://localhost:${this.httpPort}/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobs),
      });
      return await res.json();
    } catch (e) {
      console.error('Bulk job error:', e);
      return null;
    }
  }
}

// ─── GLOBAL INSTANCE ─────────────────────────────────────────────────────────────
let socialBridge = null;

// ─── INITIALIZATION ──────────────────────────────────────────────────────────────
function initSocialScraper() {
  socialBridge = new SocialScraperBridge();

  // Add social sources to health indicators
  SCRAPER_SOURCES.forEach(src => {
    sourceStatus[src.src] = 'loading';
  });
  renderSourceHealth();

  // Try WebSocket connection
  socialBridge.connect().catch(() => {
    console.log('⚠ WebSocket connection failed, using HTTP fallback');
  });

  // Start polling for results
  setInterval(pollSocialResults, 300000); // 5 minutes
}

// ─── POLLING FALLBACK ───────────────────────────────────────────────────────────
async function pollSocialResults() {
  if (!socialBridge || socialBridge.connected) return;

  try {
    const results = await socialBridge.getResults('all', 20);
    if (results && results.length > 0) {
      results.forEach(item => {
        socialBridge.handleFeedItem({
          id: item._id,
          source: `SOCIAL_${item.platform.toUpperCase()}`,
          tag: item.platform,
          title: item.text?.substring(0, 100) || `Profile: ${item.username}`,
          body: item.text?.substring(0, 300) || item.bio || '',
          severity: 'low',
          location: 'Social Media',
          time: new Date().toLocaleTimeString('en-US', { hour12: false }),
          timestamp: item._scraped_at,
          url: item.url,
        });
      });
    }
  } catch (e) {
    console.error('Poll error:', e);
  }
}

// ─── UI INTEGRATION ─────────────────────────────────────────────────────────────
function renderSocialStats() {
  const statsEl = document.getElementById('social-stats');
  if (!statsEl) return;

  statsEl.innerHTML = `
    <div class="stat-row"><span class="stat-label">Posts:</span> <span class="stat-value">${socialBridge.stats.posts}</span></div>
    <div class="stat-row"><span class="stat-label">Profiles:</span> <span class="stat-value">${socialBridge.stats.profiles}</span></div>
    <div class="stat-row"><span class="stat-label">Jobs:</span> <span class="stat-value">${socialBridge.stats.jobs}</span></div>
    <div class="stat-row"><span class="stat-label">Errors:</span> <span class="stat-value">${socialBridge.stats.errors}</span></div>
  `;
}

function addSocialPanel() {
  const rightPanel = document.querySelector('#panel-right');
  if (!rightPanel) return;

  const socialPanel = document.createElement('div');
  socialPanel.id = 'social-panel';
  socialPanel.className = 'panel';
  socialPanel.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">🤖 SOCIAL SCRAPER</span>
      <span class="panel-tag" id="social-status">DEMO</span>
    </div>
    <div class="panel-body">
      <div id="social-stats" class="social-stats-grid"></div>
      <div class="social-actions">
        <button class="act-btn" onclick="scrapeWithBridge('x', 'search', '#breaking')">𝕏 Search</button>
        <button class="act-btn" onclick="scrapeWithBridge('facebook', 'posts', 'NASA')">FB Posts</button>
        <button class="act-btn" onclick="scrapeWithBridge('instagram', 'hashtag', 'news')">IG Hashtag</button>
      </div>
      <div id="social-results" class="social-results-list"></div>
    </div>
  `;

  // Insert after OSINT panel
  const osintPanel = document.querySelector('#osint-trigger')?.closest('.panel');
  if (osintPanel) {
    osintPanel.after(socialPanel);
  } else {
    rightPanel.appendChild(socialPanel);
  }
}

function scrapeWithBridge(platform, action, target) {
  if (!socialBridge) {
    console.error('Social bridge not initialized');
    return;
  }

  socialBridge.submitJob(platform, action, target, 20);
  console.log(`Queued: ${platform}/${action}/${target}`);
}

// ─── EXPORT ──────────────────────────────────────────────────────────────────────
window.SocialScraperBridge = SocialScraperBridge;
window.initSocialScraper = initSocialScraper;
window.scrapeWithBridge = scrapeWithBridge;
window.SCRAPER_SOURCES = SCRAPER_SOURCES;