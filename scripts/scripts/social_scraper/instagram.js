/**
 * scrapers/instagram.js — Instagram Public Scraper
 * Scrapes public profiles, posts, and hashtags via Instagram's public web
 * NOTE: Public data only — no private accounts, no DMs, no credential abuse
 */

const { createBrowser, randomDelay } = require('../browser');
const axios = require('axios');
const dayjs = require('dayjs');

class InstagramScraper {
  constructor(store, config = {}) {
    this.store = store;
    this.config = {
      headless: config.headless !== false,
      delay: config.delay || 3000,
      maxScrolls: config.maxScrolls || 8,
      proxy: config.proxy || null,
    };
    this.platform = 'instagram';
    this.baseUrl = 'https://www.instagram.com';
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
   * Scrape public Instagram profile
   * Uses Instagram's public JSON API endpoint (no login needed for public accounts)
   */
  async scrapeProfile(username) {
    this._log(`Scraping IG profile: @${username}`);

    // Try the lightweight API approach first
    try {
      const apiData = await this._fetchPublicAPI(username);
      if (apiData) {
        const record = this.store.insert('profiles', {
          platform: this.platform,
          username,
          ...apiData,
          scraped_at: dayjs().toISOString(),
        });
        this._log(`✓ Profile scraped via API: @${username} (${apiData.followers} followers)`);
        return record;
      }
    } catch (e) {
      this._log(`API approach failed, falling back to browser: ${e.message}`);
    }

    // Fallback to browser scraping
    return await this._scrapeProfileBrowser(username);
  }

  async _fetchPublicAPI(username) {
    // Instagram's public endpoint (no auth needed for public accounts)
    const url = `${this.baseUrl}/api/v1/users/web_profile_info/?username=${username}`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': `${this.baseUrl}/${username}/`,
      'X-IG-App-ID': '936619743392459', // Public Instagram web app ID
      'X-Requested-With': 'XMLHttpRequest',
    };

    const response = await axios.get(url, { headers, timeout: 10000 });
    const user = response.data?.data?.user;
    if (!user) return null;

    return {
      user_id: user.id,
      display_name: user.full_name,
      bio: user.biography,
      website: user.external_url,
      followers: user.edge_followed_by?.count,
      following: user.edge_follow?.count,
      posts_count: user.edge_owner_to_timeline_media?.count,
      is_verified: user.is_verified,
      is_private: user.is_private,
      avatar_url: user.profile_pic_url_hd || user.profile_pic_url,
      category: user.category_name,
      url: `${this.baseUrl}/${username}/`,
    };
  }

  async _scrapeProfileBrowser(username) {
    const { browser, page } = await this._setupBrowser();
    try {
      await page.goto(`${this.baseUrl}/${username}/`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForTimeout(randomDelay(2000, 3500));

      // Dismiss login prompt if shown
      try {
        const closeBtn = await page.$('svg[aria-label="Close"]');
        if (closeBtn) await closeBtn.click();
        await page.waitForTimeout(500);
      } catch (_) {}

      const profile = await page.evaluate(() => {
        const metaTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
        const metaDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content');
        const metaImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content');

        // Parse description like "1.2M Followers, 500 Following, 1,234 Posts"
        const statsMatch = metaDesc?.match(/([\d,.KMB]+)\s*Followers?,\s*([\d,.KMB]+)\s*Following,\s*([\d,.KMB]+)\s*Posts?/i);

        // Try structured data
        const jsonLd = document.querySelector('script[type="application/ld+json"]');
        let structured = null;
        try { structured = JSON.parse(jsonLd?.textContent || 'null'); } catch (_) {}

        return {
          display_name: structured?.name || metaTitle?.split('(')[0]?.trim() || null,
          bio: structured?.description || metaDesc?.split('. See Instagram')[0] || null,
          website: structured?.url || null,
          avatar_url: metaImg || null,
          followers: statsMatch?.[1] || null,
          following: statsMatch?.[2] || null,
          posts_count: statsMatch?.[3] || null,
          url: window.location.href,
          source: 'browser',
        };
      });

      const record = this.store.insert('profiles', {
        platform: this.platform,
        username,
        ...profile,
        scraped_at: dayjs().toISOString(),
      });

      this._log(`✓ Profile scraped (browser): @${username}`);
      return record;

    } finally {
      await browser.close();
    }
  }

  /**
   * Scrape public posts from a profile grid
   */
  async scrapePosts(username, maxPosts = 24) {
    this._log(`Scraping IG posts from @${username} (max: ${maxPosts})`);
    const posts = [];

    // Try API approach first
    try {
      const apiPosts = await this._fetchPostsAPI(username, maxPosts);
      if (apiPosts?.length) {
        for (const post of apiPosts) {
          posts.push(this.store.insert('posts', {
            platform: this.platform,
            author: username,
            ...post,
          }));
        }
        this._log(`✓ Scraped ${posts.length} posts via API for @${username}`);
        return posts;
      }
    } catch (e) {
      this._log(`API post fetch failed: ${e.message}`);
    }

    // Fallback to browser
    return await this._scrapePostsBrowser(username, maxPosts);
  }

  async _fetchPostsAPI(username, maxPosts) {
    // Get user ID first
    const profileData = await this._fetchPublicAPI(username);
    if (!profileData?.user_id || profileData.is_private) return null;

    const posts = [];
    let cursor = null;
    const batchSize = Math.min(12, maxPosts);

    while (posts.length < maxPosts) {
      const params = new URLSearchParams({
        query_hash: 'e769aa130647d2354c40ea6a439bfc08',
        variables: JSON.stringify({
          id: profileData.user_id,
          first: batchSize,
          after: cursor,
        }),
      });

      const response = await axios.get(
        `${this.baseUrl}/graphql/query/?${params}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': '*/*',
            'Referer': `${this.baseUrl}/${username}/`,
            'X-IG-App-ID': '936619743392459',
          },
          timeout: 15000,
        }
      );

      const media = response.data?.data?.user?.edge_owner_to_timeline_media;
      if (!media?.edges) break;

      for (const { node } of media.edges) {
        if (posts.length >= maxPosts) break;
        posts.push({
          post_id: node.id,
          shortcode: node.shortcode,
          url: `${this.baseUrl}/p/${node.shortcode}/`,
          type: node.__typename,
          caption: node.edge_media_to_caption?.edges?.[0]?.node?.text?.slice(0, 500) || null,
          timestamp: node.taken_at_timestamp
            ? dayjs.unix(node.taken_at_timestamp).toISOString()
            : null,
          likes: node.edge_liked_by?.count || node.edge_media_preview_like?.count || null,
          comments: node.edge_media_to_comment?.count || null,
          thumbnail_url: node.thumbnail_url || node.display_url || null,
          is_video: node.is_video,
          video_views: node.video_view_count || null,
          dimensions: node.dimensions,
          hashtags: (node.edge_media_to_caption?.edges?.[0]?.node?.text?.match(/#\w+/g) || []),
          location: node.location?.name || null,
          accessibility_caption: node.accessibility_caption || null,
        });
      }

      const pageInfo = media.page_info;
      if (!pageInfo?.has_next_page) break;
      cursor = pageInfo.end_cursor;
      await new Promise(r => setTimeout(r, randomDelay(2000, 4000)));
    }

    return posts;
  }

  async _scrapePostsBrowser(username, maxPosts) {
    const { browser, page } = await this._setupBrowser();
    const posts = [];

    try {
      await page.goto(`${this.baseUrl}/${username}/`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForTimeout(randomDelay(2000, 3000));

      // Close login prompt
      try {
        const closeBtn = await page.$('svg[aria-label="Close"]');
        if (closeBtn) await closeBtn.click();
      } catch (_) {}

      let scrollCount = 0;

      while (posts.length < maxPosts && scrollCount < this.config.maxScrolls) {
        const newPosts = await page.evaluate((existingIds) => {
          const articles = document.querySelectorAll('article a[href*="/p/"], main a[href*="/p/"]');
          const out = [];
          const seen = new Set();

          articles.forEach(a => {
            const shortcode = a.href?.match(/\/p\/([^/]+)/)?.[1];
            if (!shortcode || seen.has(shortcode) || existingIds.includes(shortcode)) return;
            seen.add(shortcode);

            const img = a.querySelector('img');
            out.push({
              shortcode,
              url: `https://www.instagram.com/p/${shortcode}/`,
              thumbnail_url: img?.src || null,
              alt_text: img?.alt || null,
              is_video: !!a.querySelector('video, svg[aria-label*="Reel"], svg[aria-label*="Video"]'),
            });
          });

          return out;
        }, posts.map(p => p.shortcode));

        for (const post of newPosts) {
          if (posts.length >= maxPosts) break;
          posts.push(this.store.insert('posts', {
            platform: this.platform,
            author: username,
            ...post,
          }));
        }

        this._log(`  → ${posts.length}/${maxPosts} posts found`);
        await page.humanScroll(600);
        await page.waitForTimeout(randomDelay(this.config.delay, this.config.delay + 1500));
        scrollCount++;
      }

      return posts;
    } finally {
      await browser.close();
    }
  }

  /**
   * Scrape public hashtag feed
   */
  async scrapeHashtag(hashtag, maxPosts = 30) {
    this._log(`Scraping IG hashtag: #${hashtag} (max: ${maxPosts})`);
    const { browser, page } = await this._setupBrowser();
    const posts = [];

    try {
      const tag = hashtag.replace(/^#/, '');
      await page.goto(`${this.baseUrl}/explore/tags/${tag}/`, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      await page.waitForTimeout(randomDelay(2000, 3500));

      // Dismiss login prompt
      try {
        const closeBtn = await page.$('svg[aria-label="Close"]');
        if (closeBtn) await closeBtn.click();
        await page.waitForTimeout(500);
      } catch (_) {}

      let scrollCount = 0;

      while (posts.length < maxPosts && scrollCount < this.config.maxScrolls) {
        const newPosts = await page.evaluate((existingIds) => {
          const links = document.querySelectorAll('a[href*="/p/"]');
          const out = [];
          const seen = new Set();

          links.forEach(a => {
            const shortcode = a.href?.match(/\/p\/([^/]+)/)?.[1];
            if (!shortcode || seen.has(shortcode) || existingIds.includes(shortcode)) return;
            seen.add(shortcode);

            const img = a.querySelector('img');
            out.push({
              shortcode,
              url: `https://www.instagram.com/p/${shortcode}/`,
              thumbnail_url: img?.src || null,
              alt_text: img?.alt || null,
            });
          });

          return out;
        }, posts.map(p => p.shortcode));

        for (const post of newPosts) {
          if (posts.length >= maxPosts) break;
          posts.push(this.store.insert('posts', {
            platform: this.platform,
            hashtag: tag,
            type: 'hashtag_post',
            ...post,
          }));

          // Store hashtag record
          this.store.insert('hashtags', {
            platform: this.platform,
            tag,
            post_shortcode: post.shortcode,
          });
        }

        this._log(`  → ${posts.length}/${maxPosts} hashtag posts`);
        await page.humanScroll(600);
        await page.waitForTimeout(randomDelay(this.config.delay, this.config.delay + 2000));
        scrollCount++;
      }

      this._log(`✓ Scraped ${posts.length} posts for #${tag}`);
      return posts;

    } catch (err) {
      this.store.insert('errors', { platform: this.platform, action: 'scrapeHashtag', target: hashtag, error: err.message });
      throw err;
    } finally {
      await browser.close();
    }
  }
}

module.exports = InstagramScraper;
