/**
 * Social Scraper Config for JDM Command Center
 * Integration with OrbitMart AI / OpenClaw
 */

module.exports = {
  // Stealth settings
  stealth: {
    requestDelayMs: 2500,
    delayMinMs: 1500,
    delayMaxMs: 5000,
    headless: true,
    userAgentRotation: true,
    humanMouseMovement: true,
    webdriverSpoof: true,
  },

  // Rate limits
  rateLimits: {
    x: { requestsPerHour: 100, maxResults: 200 },
    facebook: { requestsPerHour: 60, maxResults: 100 },
    instagram: { requestsPerHour: 80, maxResults: 100 },
  },

  // Export paths
  export: {
    dir: '/home/josed/.openclaw/workspace/social_exports',
    formats: ['json', 'csv', 'jsonl'],
  },

  // JDM Integration
  jdm: {
    enabled: true,
    feedTags: ['x', 'fb', 'ig'],
    updateIntervalMs: 300000, // 5 minutes
    // NOTE: HTTP API on port 8765 works fine. WebSocket to Gateway (18789) causes errors.
    // webhookPort: 18789, // DISABLED - invalid WebSocket frames to Gateway
  },

  // Platforms
  platforms: {
    x: {
      enabled: true,
      baseUrl: 'https://x.com',
      actions: ['profile', 'tweets', 'search'],
    },
    facebook: {
      enabled: true,
      baseUrl: 'https://www.facebook.com',
      mobileUrl: 'https://m.facebook.com',
      actions: ['page', 'posts', 'search'],
    },
    instagram: {
      enabled: true,
      baseUrl: 'https://www.instagram.com',
      actions: ['profile', 'posts', 'hashtag'],
    },
  },

  // Proxy (optional)
  proxy: {
    enabled: false,
    host: '',
    port: 0,
    user: '',
    pass: '',
  },
};