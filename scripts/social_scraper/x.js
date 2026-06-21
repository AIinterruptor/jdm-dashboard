/**
 * scrapers/x.js — X (Twitter) Scraper
 * Scrapes public profiles, tweets, hashtags, and search results
 * NOTE: Only public data. Respects robots.txt and ToS boundaries.
 */

const { createBrowser, randomDelay } = require('../browser');
const dayjs = require('dayjs');

class XScraper {
  constructor(store, config = {}) {
    this.store = store;
    this.config = {
      headless: config.headless !== false,
      delay: config.delay || 2500,
      maxScrolls: config.maxScrolls || 10,
      proxy: config.proxy || null,
    };
    this.platform = 'x';
    this.baseUrl = 'https://x.com';
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
   * Scrape a public profile (no login required)
   */
  async scrapeProfile(username) {
    this._log(`Scraping X profile: @${username}`);
    const { browser, page } = await this._setupBrowser();

    try {
      await page.goto(`${this.baseUrl}/${username}`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForTimeout(randomDelay(1500, 3000));

      // Check if profile exists
      const notFound = await page.$('[data-testid="empty_state_body_text"]');
      if (notFound) {
        throw new Error(`Profile @${username} not found or suspended`);
      }

      const profile = await page.evaluate(() => {
        const getText = (selector) =>
          document.querySelector(selector)?.textContent?.trim() || null;
        const getAttr = (selector, attr) =>
          document.querySelector(selector)?.getAttribute(attr) || null;

        const nameEl = document.querySelector('[data-testid="UserName"]');
        const bioEl = document.querySelector('[data-testid="UserDescription"]');
        const locationEl = document.querySelector('[data-testid="UserLocation"]');
        const websiteEl = document.querySelector('[data-testid="UserUrl"]');
        const avatarEl = document.querySelector('[data-testid="UserAvatar"] img');

        // Stats
        const statEls = document.querySelectorAll('[href*="/following"], [href*="/followers"], [href*="/verified_followers"]');
        const stats = {};
        statEls.forEach(el => {
          const href = el.getAttribute('href') || '';
          const count = el.querySelector('span[data-testid="count"]')?.textContent?.trim()
            || el.querySelector('span')?.textContent?.trim();
          if (href.includes('/following')) stats.following = count;
          if (href.includes('/followers')) stats.followers = count;
        });

        // Joined date
        const joinedEl = document.querySelector('[data-testid="UserJoinDate"]');

        return {
          display_name: nameEl?.querySelector('span')?.textContent?.trim() || null,
          handle: document.querySelector('[data-testid="UserName"] div:nth-child(2) span')?.textContent?.trim() || null,
          bio: bioEl?.textContent?.trim() || null,
          location: locationEl?.textContent?.trim() || null,
          website: websiteEl?.href || null,
          avatar_url: avatarEl?.src || null,
          followers: stats.followers || null,
          following: stats.following || null,
          joined: joinedEl?.textContent?.replace('Joined', '').trim() || null,
          verified: !!document.querySelector('[data-testid="icon-verified"]'),
          url: window.location.href,
        };
      });

      const record = this.store.insert('profiles', {
        platform: this.platform,
        username,
        ...profile,
        scraped_at: dayjs().toISOString(),
      });

      this._log(`✓ Profile scraped: @${username} (${profile.followers} followers)`);
      return record;

    } catch (err) {
      this.store.insert('errors', { platform: this.platform, action: 'scrapeProfile', target: username, error: err.message });
      this._log(`✗ Error scraping @${username}: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }

  /**
   * Scrape public tweets from a profile timeline
   */
  async scrapeTweets(username, maxTweets = 50) {
    this._log(`Scraping tweets from @${username} (max: ${maxTweets})`);
    const { browser, page } = await this._setupBrowser();
    const tweets = [];

    try {
      await page.goto(`${this.baseUrl}/${username}`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForTimeout(randomDelay(2000, 4000));

      let scrollCount = 0;
      let lastCount = 0;
      let stalledRounds = 0;

      while (tweets.length < maxTweets && scrollCount < this.config.maxScrolls) {
        // Extract visible tweets
        const newTweets = await page.evaluate((existingIds) => {
          const articles = document.querySelectorAll('article[data-testid="tweet"]');
          const results = [];

          articles.forEach(article => {
            try {
              const linkEl = article.querySelector('a[href*="/status/"]');
              const tweetId = linkEl?.href?.match(/status\/(\d+)/)?.[1];
              if (!tweetId || existingIds.includes(tweetId)) return;

              const textEl = article.querySelector('[data-testid="tweetText"]');
              const timeEl = article.querySelector('time');
              const likeEl = article.querySelector('[data-testid="like"] span');
              const retweetEl = article.querySelector('[data-testid="retweet"] span');
              const replyEl = article.querySelector('[data-testid="reply"] span');
              const viewEl = article.querySelector('[data-testid="app-text-transition-container"] span');
              const mediaEls = article.querySelectorAll('img[src*="pbs.twimg.com/media"]');
              const hashtagEls = article.querySelectorAll('a[href*="/hashtag/"]');
              const mentionEls = article.querySelectorAll('a[href^="/"]');

              results.push({
                tweet_id: tweetId,
                url: linkEl?.href || null,
                text: textEl?.innerText?.trim() || null,
                timestamp: timeEl?.getAttribute('datetime') || null,
                likes: likeEl?.textContent?.trim() || '0',
                retweets: retweetEl?.textContent?.trim() || '0',
                replies: replyEl?.textContent?.trim() || '0',
                views: viewEl?.textContent?.trim() || null,
                has_media: mediaEls.length > 0,
                media_count: mediaEls.length,
                media_urls: Array.from(mediaEls).map(img => img.src),
                hashtags: Array.from(hashtagEls)
                  .map(a => a.textContent?.trim())
                  .filter(Boolean),
                is_retweet: !!article.querySelector('[data-testid="socialContext"]'),
                is_reply: article.querySelector('[data-testid="tweetText"]')?.closest('article')
                  ?.querySelector('[data-testid="User-Name"]') !== null,
              });
            } catch (e) { /* skip malformed */ }
          });

          return results;
        }, tweets.map(t => t.tweet_id));

        for (const tweet of newTweets) {
          if (tweets.length >= maxTweets) break;
          const record = this.store.insert('posts', {
            platform: this.platform,
            author: username,
            ...tweet,
          });
          tweets.push(record);
        }

        this._log(`  → ${tweets.length}/${maxTweets} tweets collected`);

        if (tweets.length === lastCount) {
          stalledRounds++;
          if (stalledRounds >= 3) break;
        } else {
          stalledRounds = 0;
          lastCount = tweets.length;
        }

        // Human-like scroll
        await page.humanScroll(600 + Math.random() * 400);
        await page.waitForTimeout(randomDelay(this.config.delay - 500, this.config.delay + 1000));
        scrollCount++;
      }

      this._log(`✓ Scraped ${tweets.length} tweets from @${username}`);
      return tweets;

    } catch (err) {
      this.store.insert('errors', { platform: this.platform, action: 'scrapeTweets', target: username, error: err.message });
      this._log(`✗ Error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }

  /**
   * Scrape public search results / hashtag
   */
  async scrapeSearch(query, maxResults = 30) {
    this._log(`Scraping X search: "${query}" (max: ${maxResults})`);
    const { browser, page } = await this._setupBrowser();
    const results = [];

    try {
      const encoded = encodeURIComponent(query);
      await page.goto(`${this.baseUrl}/search?q=${encoded}&src=typed_query&f=top`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForTimeout(randomDelay(2000, 3500));

      let scrollCount = 0;

      while (results.length < maxResults && scrollCount < this.config.maxScrolls) {
        const newItems = await page.evaluate((existingIds) => {
          const articles = document.querySelectorAll('article[data-testid="tweet"]');
          const out = [];

          articles.forEach(article => {
            try {
              const linkEl = article.querySelector('a[href*="/status/"]');
              const tweetId = linkEl?.href?.match(/status\/(\d+)/)?.[1];
              if (!tweetId || existingIds.includes(tweetId)) return;

              const textEl = article.querySelector('[data-testid="tweetText"]');
              const timeEl = article.querySelector('time');
              const userEl = article.querySelector('[data-testid="User-Name"]');
              const likeEl = article.querySelector('[data-testid="like"] span');
              const retweetEl = article.querySelector('[data-testid="retweet"] span');
              const avatarEl = article.querySelector('[data-testid="Tweet-User-Avatar"] img');

              out.push({
                tweet_id: tweetId,
                url: linkEl?.href || null,
                author: userEl?.querySelector('a')?.href?.split('/').pop() || null,
                author_display: userEl?.querySelector('span')?.textContent?.trim() || null,
                author_avatar: avatarEl?.src || null,
                text: textEl?.innerText?.trim() || null,
                timestamp: timeEl?.getAttribute('datetime') || null,
                likes: likeEl?.textContent?.trim() || '0',
                retweets: retweetEl?.textContent?.trim() || '0',
              });
            } catch (e) {}
          });

          return out;
        }, results.map(r => r.tweet_id));

        for (const item of newItems) {
          if (results.length >= maxResults) break;
          const record = this.store.insert('posts', {
            platform: this.platform,
            search_query: query,
            ...item,
          });
          results.push(record);
        }

        this._log(`  → ${results.length}/${maxResults} results`);

        await page.humanScroll(500);
        await page.waitForTimeout(randomDelay(this.config.delay, this.config.delay + 1500));
        scrollCount++;
      }

      this._log(`✓ Scraped ${results.length} results for "${query}"`);
      return results;

    } catch (err) {
      this.store.insert('errors', { platform: this.platform, action: 'scrapeSearch', target: query, error: err.message });
      this._log(`✗ Error: ${err.message}`);
      throw err;
    } finally {
      await browser.close();
    }
  }
}

module.exports = XScraper;
