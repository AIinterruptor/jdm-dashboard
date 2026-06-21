#!/usr/bin/env node
/**
 * cli.js — Social Media Scraper CLI
 * OrbitMart AI — OpenClaw compatible
 */

require('dotenv').config();
const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const Table = require('cli-table3');
const dayjs = require('dayjs');
const path = require('path');
const fs = require('fs');

const DataStore = require('./storage');
const XScraper = require('./scrapers/x');
const FacebookScraper = require('./scrapers/facebook');
const InstagramScraper = require('./scrapers/instagram');

// ─── Global Store ───────────────────────────────────────────
const store = new DataStore(process.env.EXPORT_DIR || './exports');

// ─── Shared Config ──────────────────────────────────────────
function getConfig() {
  return {
    headless: process.env.HEADLESS !== 'false',
    delay: parseInt(process.env.REQUEST_DELAY_MS || '2500'),
    proxy: process.env.PROXY_HOST ? {
      host: process.env.PROXY_HOST,
      port: process.env.PROXY_PORT,
      user: process.env.PROXY_USER,
      pass: process.env.PROXY_PASS,
    } : null,
  };
}

// ─── Live Logging ────────────────────────────────────────────
const logLines = [];
process.on('scraper:log', ({ platform, msg }) => {
  const icons = { x: '𝕏', facebook: '', instagram: '' };
  const colors = { x: chalk.cyan, facebook: chalk.blue, instagram: chalk.magenta };
  const colorFn = colors[platform] || chalk.white;
  const icon = icons[platform] || '•';
  const line = `${chalk.gray(dayjs().format('HH:mm:ss'))} ${colorFn(icon)} ${msg}`;
  console.log(line);
  logLines.push({ platform, msg, ts: new Date().toISOString() });
});

// ─── Banner ──────────────────────────────────────────────────
function showBanner() {
  console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════════╗
║     ██████╗  ██████╗ ██████╗  ██████╗ ████████╗          ║
║     ██╔══██╗██╔═══██╗██╔══██╗██╔═══██╗╚══██╔══╝          ║
║     ██████╔╝██║   ██║██████╔╝██║   ██║   ██║             ║
║     ██╔══██╗██║   ██║██╔══██╗██║   ██║   ██║             ║
║     ██║  ██║╚██████╔╝██████╔╝╚██████╔╝   ██║             ║
║     ╚═╝  ╚═╝ ╚═════╝ ╚═════╝  ╚═════╝   ╚═╝             ║
║                                                           ║
║         SOCIAL MEDIA SCRAPER v2.0 — OrbitMart AI         ║
║         𝕏  •  Facebook  •  Instagram                     ║
╚═══════════════════════════════════════════════════════════╝
`));
}

// ─── Stats Table ─────────────────────────────────────────────
function showStats(store) {
  const stats = store.stats();
  const table = new Table({
    head: [chalk.white('Collection'), chalk.white('Records')],
    style: { head: [], border: ['cyan'] },
  });
  Object.entries(stats).forEach(([k, v]) => {
    table.push([chalk.yellow(k), chalk.green(String(v))]);
  });
  console.log('\n' + chalk.cyan('─── Session Stats ───'));
  console.log(table.toString());
}

// ─── Commander Setup ─────────────────────────────────────────
const program = new Command();

program
  .name('scraper')
  .description('Advanced Social Media Scraper — X, Facebook, Instagram')
  .version('2.0.0');

// ══════════════════════════════════════════════════════════════
//  X (TWITTER) COMMANDS
// ══════════════════════════════════════════════════════════════

const xCmd = program.command('x').description('X (Twitter) scraping commands');

xCmd.command('profile <username>')
  .description('Scrape a public X profile')
  .action(async (username) => {
    showBanner();
    const spinner = ora(`Scraping X profile @${username}...`).start();
    try {
      const scraper = new XScraper(store, getConfig());
      const profile = await scraper.scrapeProfile(username);
      spinner.succeed(chalk.green(`Profile scraped: @${username}`));
      console.log(chalk.yellow('\nProfile Data:'));
      console.log(JSON.stringify(profile, null, 2));
    } catch (err) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
    showStats(store);
  });

xCmd.command('tweets <username>')
  .description('Scrape tweets from a public X profile')
  .option('-n, --max <number>', 'Max tweets to scrape', '50')
  .option('--export', 'Auto-export results')
  .action(async (username, opts) => {
    showBanner();
    const max = parseInt(opts.max);
    const spinner = ora(`Scraping up to ${max} tweets from @${username}...`).start();
    try {
      const scraper = new XScraper(store, getConfig());
      const tweets = await scraper.scrapeTweets(username, max);
      spinner.succeed(chalk.green(`Scraped ${tweets.length} tweets`));

      // Preview table
      const table = new Table({
        head: ['Tweet ID', 'Text Preview', 'Likes', 'RTs', 'Timestamp'],
        style: { border: ['cyan'] },
        colWidths: [20, 45, 10, 10, 25],
      });
      tweets.slice(0, 10).forEach(t => {
        table.push([
          t.tweet_id || '-',
          (t.text || '').slice(0, 40) + '…',
          t.likes || '0',
          t.retweets || '0',
          t.timestamp ? dayjs(t.timestamp).format('YYYY-MM-DD HH:mm') : '-',
        ]);
      });
      console.log('\n' + table.toString());
      if (tweets.length > 10) console.log(chalk.gray(`  + ${tweets.length - 10} more tweets`));

      if (opts.export) {
        const { filename } = store.exportJSON('posts', 'x');
        console.log(chalk.green(`\n✓ Exported: ${filename}`));
      }
    } catch (err) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
    showStats(store);
  });

xCmd.command('search <query>')
  .description('Search public X posts')
  .option('-n, --max <number>', 'Max results', '30')
  .option('--export', 'Auto-export results')
  .action(async (query, opts) => {
    showBanner();
    const spinner = ora(`Searching X: "${query}"...`).start();
    try {
      const scraper = new XScraper(store, getConfig());
      const results = await scraper.scrapeSearch(query, parseInt(opts.max));
      spinner.succeed(chalk.green(`Found ${results.length} results`));
      if (opts.export) {
        store.exportJSON('posts', 'x');
        store.exportCSV('posts', 'x');
      }
    } catch (err) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
    showStats(store);
  });

// ══════════════════════════════════════════════════════════════
//  FACEBOOK COMMANDS
// ══════════════════════════════════════════════════════════════

const fbCmd = program.command('fb').description('Facebook scraping commands');

fbCmd.command('page <identifier>')
  .description('Scrape a public Facebook page')
  .action(async (identifier) => {
    showBanner();
    const spinner = ora(`Scraping FB page: ${identifier}...`).start();
    try {
      const scraper = new FacebookScraper(store, getConfig());
      const page = await scraper.scrapePage(identifier);
      spinner.succeed(chalk.green(`Page scraped: ${page.name || identifier}`));
      console.log(JSON.stringify(page, null, 2));
    } catch (err) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
    showStats(store);
  });

fbCmd.command('posts <identifier>')
  .description('Scrape posts from a public Facebook page')
  .option('-n, --max <number>', 'Max posts', '20')
  .option('--export', 'Auto-export results')
  .action(async (identifier, opts) => {
    showBanner();
    const spinner = ora(`Scraping FB posts from: ${identifier}...`).start();
    try {
      const scraper = new FacebookScraper(store, getConfig());
      const posts = await scraper.scrapePosts(identifier, parseInt(opts.max));
      spinner.succeed(chalk.green(`Scraped ${posts.length} posts`));
      if (opts.export) {
        store.exportJSON('posts', 'facebook');
        store.exportCSV('posts', 'facebook');
      }
    } catch (err) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
    showStats(store);
  });

fbCmd.command('search <query>')
  .description('Search public Facebook content')
  .option('-t, --type <type>', 'Content type: posts|pages|groups|people', 'posts')
  .action(async (query, opts) => {
    showBanner();
    const spinner = ora(`Searching Facebook: "${query}" [${opts.type}]...`).start();
    try {
      const scraper = new FacebookScraper(store, getConfig());
      const results = await scraper.searchPublic(query, opts.type);
      spinner.succeed(chalk.green(`Found ${results.length} results`));
    } catch (err) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
    showStats(store);
  });

// ══════════════════════════════════════════════════════════════
//  INSTAGRAM COMMANDS
// ══════════════════════════════════════════════════════════════

const igCmd = program.command('ig').description('Instagram scraping commands');

igCmd.command('profile <username>')
  .description('Scrape a public Instagram profile')
  .action(async (username) => {
    showBanner();
    const spinner = ora(`Scraping IG profile @${username}...`).start();
    try {
      const scraper = new InstagramScraper(store, getConfig());
      const profile = await scraper.scrapeProfile(username);
      spinner.succeed(chalk.green(`Profile scraped: @${username}`));
      console.log(JSON.stringify(profile, null, 2));
    } catch (err) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
    showStats(store);
  });

igCmd.command('posts <username>')
  .description('Scrape posts from a public Instagram profile')
  .option('-n, --max <number>', 'Max posts', '24')
  .option('--export', 'Auto-export results')
  .action(async (username, opts) => {
    showBanner();
    const spinner = ora(`Scraping IG posts from @${username}...`).start();
    try {
      const scraper = new InstagramScraper(store, getConfig());
      const posts = await scraper.scrapePosts(username, parseInt(opts.max));
      spinner.succeed(chalk.green(`Scraped ${posts.length} posts`));
      if (opts.export) {
        store.exportJSON('posts', 'instagram');
        store.exportCSV('posts', 'instagram');
      }
    } catch (err) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
    showStats(store);
  });

igCmd.command('hashtag <tag>')
  .description('Scrape Instagram hashtag posts')
  .option('-n, --max <number>', 'Max posts', '30')
  .option('--export', 'Auto-export results')
  .action(async (tag, opts) => {
    showBanner();
    const spinner = ora(`Scraping IG hashtag #${tag}...`).start();
    try {
      const scraper = new InstagramScraper(store, getConfig());
      const posts = await scraper.scrapeHashtag(tag, parseInt(opts.max));
      spinner.succeed(chalk.green(`Scraped ${posts.length} hashtag posts`));
      if (opts.export) {
        store.exportJSON('posts', 'instagram');
      }
    } catch (err) {
      spinner.fail(chalk.red(`Failed: ${err.message}`));
    }
    showStats(store);
  });

// ══════════════════════════════════════════════════════════════
//  BULK / MULTI-PLATFORM COMMANDS
// ══════════════════════════════════════════════════════════════

program.command('bulk <file>')
  .description('Run bulk scrape jobs from a JSON config file')
  .option('--export', 'Auto-export all results when done')
  .action(async (file, opts) => {
    showBanner();
    const configPath = path.resolve(file);
    if (!fs.existsSync(configPath)) {
      console.error(chalk.red(`Config file not found: ${configPath}`));
      process.exit(1);
    }

    const jobs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log(chalk.cyan(`\nLoaded ${jobs.length} bulk scrape jobs from ${file}`));
    console.log(chalk.gray('─'.repeat(60)));

    const cfg = getConfig();

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const spinner = ora(`[${i + 1}/${jobs.length}] ${job.platform}/${job.action}: ${job.target}`).start();

      try {
        let scraper;
        if (job.platform === 'x') scraper = new XScraper(store, { ...cfg, ...job.options });
        else if (job.platform === 'facebook') scraper = new FacebookScraper(store, { ...cfg, ...job.options });
        else if (job.platform === 'instagram') scraper = new InstagramScraper(store, { ...cfg, ...job.options });
        else { spinner.warn(`Unknown platform: ${job.platform}`); continue; }

        switch (job.action) {
          case 'profile': await scraper.scrapeProfile(job.target); break;
          case 'tweets': await scraper.scrapeTweets(job.target, job.max || 30); break;
          case 'posts': await scraper.scrapePosts(job.target, job.max || 20); break;
          case 'search': await scraper.scrapeSearch(job.target, job.max || 20); break;
          case 'hashtag': await scraper.scrapeHashtag(job.target, job.max || 20); break;
          default: spinner.warn(`Unknown action: ${job.action}`); continue;
        }

        spinner.succeed(chalk.green(`Done: ${job.platform}/${job.action}/${job.target}`));
      } catch (err) {
        spinner.fail(chalk.red(`Failed [${job.platform}/${job.action}]: ${err.message}`));
      }

      // Inter-job delay
      if (i < jobs.length - 1) {
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
      }
    }

    console.log(chalk.cyan('\n─── Bulk Job Complete ───'));
    showStats(store);

    if (opts.export) {
      const results = store.exportAll();
      console.log(chalk.cyan('\n─── Exports ───'));
      results.forEach(r => console.log(chalk.green(`  ✓ ${r.filename} (${r.count} records)`)));
    }
  });

program.command('export')
  .description('Export all collected data to JSON and CSV')
  .option('-p, --platform <platform>', 'Filter by platform: x|facebook|instagram')
  .option('-c, --collection <collection>', 'Filter by collection: posts|profiles|comments')
  .action((opts) => {
    const results = opts.platform
      ? ['posts', 'profiles', 'comments', 'hashtags'].map(c => ({
          collection: c,
          ...store.exportJSON(c, opts.platform),
        }))
      : store.exportAll();

    console.log(chalk.cyan('\n─── Export Results ───'));
    if (!results.length) {
      console.log(chalk.yellow('No data to export.'));
    } else {
      results.filter(r => r.filename).forEach(r => {
        console.log(chalk.green(`  ✓ ${r.collection}/${r.platform}: ${r.filename} (${r.count} records)`));
      });
    }
  });

program.parseAsync(process.argv);
