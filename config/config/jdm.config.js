/**
 * JDM Command Center Configuration
 * Edit this file to customize feeds and settings
 */

const JDM_CONFIG = {
  // ─── DASHBOARD ───────────────────────────────────────────────
  dashboard: {
    title: "JDM Command Center",
    defaultZoom: 6,
    defaultCenter: [12.8797, 121.7740], // Philippines center
    refreshInterval: 120000, // 2 minutes
  },

  // ─── WORKING RSS FEEDS ─────────────────────────────────────────
  feeds: {
    philippine: [
      { url: 'https://newsinfo.inquirer.net/feed', src: 'Inquirer', cat: 'news' },
      { url: 'https://www.philstar.com/rss/headlines', src: 'PhilStar', cat: 'news' },
      { url: 'https://www.gmanetwork.com/news/rss/news/', src: 'GMA News', cat: 'news' },
    ],
    international: [
      { url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml', src: 'BBC Asia', cat: 'news' },
    ],
    disaster: [
      { url: 'https://reliefweb.int/crisis/country/ph/rss.xml', src: 'ReliefWeb PH', cat: 'disaster' },
    ],
  },

  // ─── SATELLITE LAYERS ──────────────────────────────────────────
  nasa: {
    gibsWMS: 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi',
    eonetAPI: 'https://eonet.gsfc.nasa.gov/api/v3/events',
    firmsRSS: 'https://firms.modaps.eosdis.nasa.gov/rss/kml_fire_alerts.php?source=VIIRS&country=PHL',
  },

  // ─── WEATHER ───────────────────────────────────────────────────
  weather: {
    rainviewerAPI: 'https://api.rainviewer.com/public/weather-maps.json',
    refreshInterval: 600000, // 10 minutes
  },

  // ─── RADIO STATIONS ────────────────────────────────────────────
  radio: {
    working: [
      { id: 'bbcws', name: 'BBC World Service', stream: 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service' },
      { id: 'voa', name: 'Voice of America', stream: 'https://vgtrk-priem.hostingradio.ru/voa_aac_64.mp3' },
      { id: 'nhk', name: 'NHK World Japan', stream: 'https://nhkworld.webcdn.stream.ne.jp/www11/nhkworld-tv/domestic/263942/live.m3u8' },
      { id: 'rfi', name: 'RFI International', stream: 'https://stream.rfi.fr/rfi_en.mp3' },
      { id: 'dw', name: 'DW News', stream: 'https://dwstream1-lh.akamaihd.net/i/dwstream1_live@130440/master.m3u8' },
    ],
    youtube: [
      { id: 'dzrh', name: 'DZRH 666', youtube: 'https://www.youtube.com/@dzrh666am/live' },
      { id: 'dzbb', name: 'DZBB Super Radyo', youtube: 'https://www.youtube.com/@dzbb594am/live' },
      { id: 'dwiz', name: 'DWIZ 882', youtube: 'https://www.youtube.com/@dwiz882am/live' },
    ],
  },

  // ─── SOCIAL SCRAPER ────────────────────────────────────────────
  social: {
    enabled: true,
    bridgePort: 8765,
    keywords: [
      'Philippines typhoon', 'Philippines earthquake', 'Philippines flood',
      'AFP encounter', 'NPA', 'Abu Sayyaf', 'PAGASA', 'PHIVOLCS',
    ],
  },

  // ─── ML ENGINE ──────────────────────────────────────────────────
  ml: {
    enabled: true,
    minSamples: 10,
    autoTrain: true,
    trainInterval: 3600000, // 1 hour
  },
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JDM_CONFIG;
}