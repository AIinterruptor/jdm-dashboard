/**
 * browser.js — Stealth Browser Engine
 * Manages Playwright browser instances with anti-detection features
 */

const { chromium } = require('playwright');
const UserAgent = require('user-agents');

const VIEWPORT_POOL = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1536, height: 864 },
];

const LOCALE_POOL = ['en-US', 'en-GB', 'en-CA', 'en-AU'];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDelay(min = 1500, max = 4000) {
  return Math.floor(Math.random() * (max - min) + min);
}

async function createBrowser(options = {}) {
  const {
    headless = true,
    proxy = null,
    viewport = null,
    userAgent = null,
  } = options;

  const ua = userAgent || new UserAgent({ deviceCategory: 'desktop' }).toString();
  const vp = viewport || randomItem(VIEWPORT_POOL);
  const locale = randomItem(LOCALE_POOL);

  const launchOptions = {
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      `--lang=${locale}`,
    ],
  };

  if (proxy?.host) {
    launchOptions.proxy = {
      server: `http://${proxy.host}:${proxy.port}`,
      username: proxy.user,
      password: proxy.pass,
    };
  }

  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext({
    userAgent: ua,
    viewport: vp,
    locale,
    timezoneId: 'America/New_York',
    permissions: ['geolocation'],
    extraHTTPHeaders: {
      'Accept-Language': `${locale},en;q=0.9`,
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'DNT': '1',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  // Inject stealth scripts
  await context.addInitScript(() => {
    // Override webdriver detection
    Object.defineProperty(navigator, 'webdriver', { get: () => false });

    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en'],
    });

    // Override permissions
    const originalQuery = window.navigator.permissions?.query;
    if (originalQuery) {
      window.navigator.permissions.query = (parameters) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : originalQuery(parameters);
    }

    // Chrome runtime mock
    window.chrome = {
      runtime: {},
      loadTimes: () => {},
      csi: () => {},
      app: {},
    };

    // Remove automation-related properties
    delete window.__playwright;
    delete window.__pw_manual;
  });

  const page = await context.newPage();

  // Simulate human-like mouse movement
  page.humanClick = async (selector) => {
    const el = await page.$(selector);
    if (!el) throw new Error(`Element not found: ${selector}`);
    const box = await el.boundingBox();
    // Random point within element
    const x = box.x + box.width * (0.3 + Math.random() * 0.4);
    const y = box.y + box.height * (0.3 + Math.random() * 0.4);
    await page.mouse.move(x - 50, y - 30, { steps: 10 });
    await page.waitForTimeout(randomDelay(50, 200));
    await page.mouse.move(x, y, { steps: 8 });
    await page.waitForTimeout(randomDelay(30, 100));
    await page.mouse.click(x, y);
  };

  // Human-like typing
  page.humanType = async (selector, text, options = {}) => {
    await page.click(selector);
    await page.waitForTimeout(randomDelay(200, 500));
    for (const char of text) {
      await page.keyboard.type(char, { delay: randomDelay(40, 150) });
    }
  };

  // Scroll like a human
  page.humanScroll = async (distance = 500) => {
    const steps = Math.floor(distance / 100);
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, 100 + Math.random() * 50);
      await page.waitForTimeout(randomDelay(80, 200));
    }
  };

  return { browser, context, page, ua, vp };
}

module.exports = { createBrowser, randomDelay, randomItem };
