/**
 * storage.js — Data Storage & Export Engine
 * In-memory store with JSON/CSV/JSONL export
 */

const fs = require('fs');
const path = require('path');
const dayjs = require('dayjs');

class DataStore {
  constructor(exportDir = './exports') {
    this.exportDir = exportDir;
    this.collections = {
      posts: [],
      profiles: [],
      comments: [],
      hashtags: [],
      errors: [],
    };
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
    }
    ['x', 'facebook', 'instagram'].forEach(p =>
      fs.mkdirSync(path.join(this.exportDir, p), { recursive: true })
    );
  }

  insert(collection, record) {
    if (!this.collections[collection]) this.collections[collection] = [];
    const entry = {
      _id: `${collection}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      _scraped_at: dayjs().toISOString(),
      ...record,
    };
    this.collections[collection].push(entry);
    return entry;
  }

  getAll(collection) {
    return this.collections[collection] || [];
  }

  getByPlatform(collection, platform) {
    return (this.collections[collection] || []).filter(r => r.platform === platform);
  }

  stats() {
    return {
      posts: this.collections.posts.length,
      profiles: this.collections.profiles.length,
      comments: this.collections.comments.length,
      hashtags: this.collections.hashtags.length,
      errors: this.collections.errors.length,
    };
  }

  exportJSON(collection, platform = null) {
    const data = platform
      ? this.getByPlatform(collection, platform)
      : this.getAll(collection);

    const ts = dayjs().format('YYYY-MM-DD_HH-mm-ss');
    const filename = platform
      ? path.join(this.exportDir, platform, `${collection}_${ts}.json`)
      : path.join(this.exportDir, `${collection}_${ts}.json`);

    fs.writeFileSync(filename, JSON.stringify(data, null, 2), 'utf8');
    return { filename, count: data.length };
  }

  exportCSV(collection, platform = null) {
    const data = platform
      ? this.getByPlatform(collection, platform)
      : this.getAll(collection);

    if (!data.length) return { filename: null, count: 0 };

    const headers = [...new Set(data.flatMap(r => Object.keys(r)))];
    const rows = data.map(r =>
      headers.map(h => {
        const val = r[h] ?? '';
        const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
        return `"${str.replace(/"/g, '""')}"`;
      }).join(',')
    );

    const csv = [headers.join(','), ...rows].join('\n');
    const ts = dayjs().format('YYYY-MM-DD_HH-mm-ss');
    const filename = platform
      ? path.join(this.exportDir, platform, `${collection}_${ts}.csv`)
      : path.join(this.exportDir, `${collection}_${ts}.csv`);

    fs.writeFileSync(filename, csv, 'utf8');
    return { filename, count: data.length };
  }

  exportJSONL(collection, platform = null) {
    const data = platform
      ? this.getByPlatform(collection, platform)
      : this.getAll(collection);

    const ts = dayjs().format('YYYY-MM-DD_HH-mm-ss');
    const filename = platform
      ? path.join(this.exportDir, platform, `${collection}_${ts}.jsonl`)
      : path.join(this.exportDir, `${collection}_${ts}.jsonl`);

    const lines = data.map(r => JSON.stringify(r)).join('\n');
    fs.writeFileSync(filename, lines, 'utf8');
    return { filename, count: data.length };
  }

  exportAll() {
    const results = [];
    for (const [collection, records] of Object.entries(this.collections)) {
      if (records.length === 0) continue;
      const platforms = [...new Set(records.map(r => r.platform).filter(Boolean))];
      for (const platform of platforms) {
        results.push({ collection, platform, ...this.exportJSON(collection, platform) });
        results.push({ collection, platform, ...this.exportCSV(collection, platform) });
      }
    }
    return results;
  }

  clear(collection) {
    if (collection) {
      this.collections[collection] = [];
    } else {
      Object.keys(this.collections).forEach(k => (this.collections[k] = []));
    }
  }
}

module.exports = DataStore;
