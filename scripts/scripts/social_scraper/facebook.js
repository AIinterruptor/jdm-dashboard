/**
 * scrapers/facebook.js — Facebook Public Page Scraper
 * Scrapes public Facebook pages, posts, and group content
 * NOTE: Public data only — no private content, no credential misuse
 */

const { createBrowser, randomDelay } = require('../browser');
const dayjs = require('dayjs');

class FacebookScraper {
  constructor(store, config = {}) {
    this.store = store;
    this.config = {
      headless: config.headless !== false,
      delay: config.delay || 3000,
      maxScrolls: config.maxScrolls || 8,
      proxy: config.proxy || null,
    };
    this.platform = 'facebook';
    this.baseUrl = 'https://www.facebook.com';
  }

  _log(msg) {
    process.emit('scraper:log', { platform: this.platform, msg, ts: new Date().toISOString() });
  }

  async _setupBrowser() {
    return createBrowser({
      headless: this.config.headless,
      proxy: this.config.proxy,
    });
  }

  /**
   * Scrape a public Facebook page (no login required for public pages)
   */
  async scrapePage(pageIdentifier) {
    this._log(`Scraping FB page: ${pageIdentifier}`);
    const { browser, page } = await this._setupBrowser();

    try {
      // Dismiss cookie consent first
      await page.goto(`${this.baseUrl}/${pageIdentifier}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Handle cookie dialog
      await page.waitForTimeout(randomDelay(1500, 2500));
      try {
        const cookieBtn = await page.$('[data-cookiebanner="accept_button"], [aria-label="Allow all cookies"], button[title*="Accept"]');
        if (cookieBtn) await cookieBtn.click();
        await page.waitForTimeout(1000);
      } catch (_) {}

      // Handle login wall — switch to mobile version which shows more public data
      const loginWall = await page.$('[data-testid="royal_login_form"]');
      if (loginWall) {
        this._log('Login wall detected, trying mobile view...');
        await browser.close();
        return await this._scrapeMobilePage(pageIdentifier);
      }

      await page.waitForTimeout(randomDelay(2000, 3000));

      const profile = await page.evaluate(() => {
        const nameEl = document.querySelector('h1');
        const categoryEl = document.querySelector('[data-key="tab_home"] ~ div span');
        const likesEl = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('likes'));
        const followersEl = Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('followers'));
        const aboutEl = document.querySelector('[data-key="tab_about"]');

        return {
          name: nameEl?.textContent?.trim() || null,
          url: window.location.href,
          page_id: window.location.pathname.replace('/', ''),
          likes: likesEl?.textContent?.trim() || null,
          followers: followersEl?.textContent?.trim() || null,
          verified: !!document.querySelector('[aria-label*="verified"]'),
        };
      });

      const record = this.store.insert('profiles', {
        platform: this.platform,
        identifier: pageIdentifier,
        ...profile,
        scraped_at: dayjs().toISOString(),
      });

      this._log(`✓ Page scraped: ${profile.name}`);
      return record;

    } catch (err) {
      this.store.insert('errors', { platform: this.platform, action: 'scrapePage', target: pageIdentifier, error: err.message });
      this._log(`✗ Error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }

  /**
   * Scrape via mobile Facebook (more accessible for public content)
   */
  async _scrapeMobilePage(pageIdentifier) {
    const { browser, page } = await createBrowser({
      headless: this.config.headless,
      userAgent: 'Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
      viewport: { width: 390, height: 844 },
    });

    try {
      await page.goto(`https://m.facebook.com/${pageIdentifier}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await page.waitForTimeout(randomDelay(2000, 3500));

      // Accept cookies on mobile
      try {
        const btn = await page.$('button[value="1"], [data-sigil="m_accept_cookies"]');
        if (btn) await btn.click();
        await page.waitForTimeout(800);
      } catch (_) {}

      const profile = await page.evaluate(() => {
        const titleEl = document.querySelector('#mobile_injected_video_feed_pagelet title, title');
        const metaDesc = document.querySelector('meta[name="description"]');
        const canonicalEl = document.querySelector('link[rel="canonical"]');

        const statsEls = document.querySelectorAll('._4bl9, ._2pin, .bq4 .bq5');
        const stats = {};
        statsEls.forEach(el => {
          const txt = el.textContent.toLowerCase();
          if (txt.includes('like')) stats.likes = el.textContent.trim();
          if (txt.includes('follower')) stats.followers = el.textContent.trim();
        });

        return {
          name: document.title?.split(' | ')[0] || null,
          description: metaDesc?.getAttribute('content') || null,
          url: canonicalEl?.href || window.location.href,
          ...stats,
          source: 'mobile',
        };
      });

      const record = this.store.insert('profiles', {
        platform: this.platform,
        identifier: pageIdentifier,
        ...profile,
        scraped_at: dayjs().toISOString(),
      });

      return record;
    } finally {
      await browser.close();
    }
  }

  /**
   * Scrape public posts from a Facebook page timeline
   */
  async scrapePosts(pageIdentifier, maxPosts = 20) {
    this._log(`Scraping FB posts from: ${pageIdentifier} (max: ${maxPosts})`);
    const { browser, page } = await this._setupBrowser();
    const posts = [];

    try {
      await page.goto(`https://m.facebook.com/${pageIdentifier}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await page.waitForTimeout(randomDelay(2000, 3500));

      // Accept cookies
      try {
        const btn = await page.$('[data-sigil="m_accept_cookies"]');
        if (btn) await btn.click();
        await page.waitForTimeout(800);
      } catch (_) {}

      let scrollCount = 0;
      let lastCount = 0;
      let stalledRounds = 0;

      while (posts.length < maxPosts && scrollCount < this.config.maxScrolls) {
        const newPosts = await page.evaluate((existingIds) => {
          const postEls = document.querySelectorAll('[data-ft], article, [role="article"]');
          const results = [];

          postEls.forEach(el => {
            try {
              const linkEl = el.querySelector('a[href*="/posts/"], a[href*="/story/"], a[href*="?story_fbid="]');
              const postId = linkEl?.href?.match(/[?&](?:story_fbid|fbid)=(\d+)/)?.[1]
                || linkEl?.href?.match(/\/posts\/(\d+)/)?.[1];

              if (!postId || existingIds.includes(postId)) return;

              const textEl = el.querySelector('[data-ad-preview="message"], p, [class*="story_body"]');
              const timeEl = el.querySelector('abbr[data-store], time, abbr');
              const likeEl = el.querySelector('[data-sigil="reactions-sentence-container"], [aria-label*="reaction"]');
              const commentEl = el.querySelector('[data-sigil*="comment"], a[href*="comment"]');
              const shareEl = el.querySelector('[data-sigil*="share"]');
              const imgEl = el.querySelector('img[src*="scontent"], img[src*="fbcdn"]');

              results.push({
                post_id: postId,
                url: linkEl?.href || null,
                text: textEl?.innerText?.trim()?.slice(0, 1000) || null,
                timestamp: timeEl?.getAttribute('data-store')
                  ? JSON.parse(timeEl.getAttribute('data-store'))?.time
                  : timeEl?.getAttribute('datetime') || null,
                reactions: likeEl?.textContent?.trim() || null,
                comments: commentEl?.textContent?.trim() || null,
                shares: shareEl?.textContent?.trim() || null,
                has_image: !!imgEl,
                image_url: imgEl?.src || null,
              });
            } catch (e) {}
          });

          return results;
        }, posts.map(p => p.post_id));

        for (const post of newPosts) {
          if (posts.length >= maxPosts) break;
          const record = this.store.insert('posts', {
            platform: this.platform,
            page: pageIdentifier,
            ...post,
          });
          posts.push(record);
        }

        this._log(`  → ${posts.length}/${maxPosts} posts collected`);

        if (posts.length === lastCount) {
          stalledRounds++;
          if (stalledRounds >= 3) break;
        } else {
          stalledRounds = 0;
          lastCount = posts.length;
        }

        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(randomDelay(this.config.delay, this.config.delay + 2000));

        // Click "See more" / "Load more" buttons
        try {
          const moreBtn = await page.$('[data-sigil="m-see-more-story-link"], a[data-sigil*="more"]');
          if (moreBtn) await moreBtn.click();
        } catch (_) {}

        scrollCount++;
      }

      this._log(`✓ Scraped ${posts.length} posts from ${pageIdentifier}`);
      return posts;

    } catch (err) {
      this.store.insert('errors', { platform: this.platform, action: 'scrapePosts', target: pageIdentifier, error: err.message });
      this._log(`✗ Error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }

  /**
   * Search Facebook public content
   */
  async searchPublic(query, type = 'posts') {
    this._log(`Searching FB: "${query}" [type: ${type}]`);
    const { browser, page } = await this._setupBrowser();
    const results = [];

    try {
      const encoded = encodeURIComponent(query);
      const filterMap = { posts: 'posts', pages: 'pages', groups: 'groups', people: 'people' };
      const filter = filterMap[type] || 'posts';

      await page.goto(`${this.baseUrl}/search/${filter}/?q=${encoded}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await page.waitForTimeout(randomDelay(2000, 3500));

      // Accept cookies
      try {
        const btn = await page.$('[data-cookiebanner="accept_button"]');
        if (btn) await btn.click();
        await page.waitForTimeout(1000);
      } catch (_) {}

      const loginWall = await page.$('[data-testid="royal_login_form"]');
      if (loginWall) {
        this._log('⚠ Login required for Facebook search. Use public page scraping instead.');
        return [];
      }

      const items = await page.evaluate(() => {
        const results = [];
        const cards = document.querySelectorAll('[role="article"], [data-pagelet*="SearchResult"]');
        cards.forEach(card => {
          results.push({
            title: card.querySelector('h2, h3, strong')?.textContent?.trim() || null,
            description: card.querySelector('div > span')?.textContent?.trim()?.slice(0, 300) || null,
            link: card.querySelector('a')?.href || null,
          });
        });
        return results;
      });

      for (const item of items) {
        results.push(this.store.insert('posts', {
          platform: this.platform,
          type: 'search_result',
          search_query: query,
          search_type: filter,
          ...item,
        }));
      }

      this._log(`✓ Found ${results.length} results for "${query}"`);
      return results;

    } catch (err) {
      this.store.insert('errors', { platform: this.platform, action: 'searchPublic', target: query, error: err.message });
      throw err;
    } finally {
      await browser.close();
    }
  }
}

module.exports = FacebookScraper;
