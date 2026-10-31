// ==MiruExtension==
// @name         MissAV
// @version      v1.0.0
// @author       FusionReader
// @lang         zh-tw
// @license      MIT
// @package      missav
// @type         bangumi
// @icon         https://missav.ai/favicon.ico
// @webSite      https://missav.ai
// @nsfw         true
// @network      proxy
// ==/MiruExtension==
//
// missav sits behind a Cloudflare managed challenge ("Just a moment..."): every
// page and api path answers it to non-JS clients — node, python, reader
// services and the app's own dart client — while only sitemap.xml is exempt.
// Listings, the video page and the play address (surrit.com/<uuid>/…/video.m3u8,
// the uuid lives in the page) therefore cannot be read without a session that
// already passed the challenge.
//
// Two things make this usable from inside the app:
//   * the plugin sends a browser cookie and user agent when the settings
//     provide them (cf_clearance is bound to that pair and to the client ip);
//   * the entry point is resolved among the known missav hosts, so a host that
//     answers without a challenge is picked automatically.
// Parsing stays tolerant on purpose: listing cards are recognised by their
// work url shape and their thumbnail, and the play address is taken from the
// first m3u8 the page prints, so a markup refresh does not break the source.

const DEFAULT_ENTRY = 'https://missav.ai';
const KNOWN_ENTRIES = ['https://missav.ai', 'https://missav.ws', 'https://missav.live'];
const HOSTS = /^(?:[a-z0-9-]+\.)*missav\.(?:ai|ws|live)$/i;
const WORK_PATH = /\/dm\d+\/[a-z]{2}\/[^"?'#]+/i;
// Listing pages link to their own sections with the same url shape as a work,
// which is why a work slug also has to carry a title code (abp-123, fc2-123456).
const RESERVED_SLUGS = [
  'new', 'release', 'genres', 'actresses', 'makers', 'labels', 'series', 'search',
  'articles', 'login', 'register', 'history', 'favorites', 'popular', 'trending',
  'tags', 'uncensored', 'chinese-subtitle', 'english-subtitle', 'dm38',
];
// The site's urls carry a per-host line prefix (/dm38/zh, /dm19/ja …); the
// resolved home page tells us which one the current host uses.
const DEFAULT_LINE = 'dm38/zh';
const PAGE_GAP_MS = 300;
const PAGE_CACHE_MS = 30000;

// The site's own feeds. `new` is newest first, `release` is the release list.
const LISTINGS = [
  { title: '最新', key: 'new' },
  { title: '發售', key: 'release' },
];

export default class extends Extension {
  state() {
    if (!this._pages) {
      this._pages = new Map();
      this._inflight = new Map();
      this._lastRequest = 0;
      this._queue = Promise.resolve();
      this._site = this._site || '';
      this._line = this._line || '';
      this._entryPending = null;
      this._cookie = null;
    }
    return this;
  }

  async load() {
    this.state();
    const settings = [
      {
        key: 'cookie',
        title: '瀏覽器 Cookie',
        type: 'password',
        description: '在瀏覽器打開 missav（已通過驗證）後，複製含 cf_clearance 的整段 Cookie。留空則只嘗試免驗證的主機。',
        defaultValue: '',
      },
      {
        key: 'user_agent',
        title: '瀏覽器 UA',
        type: 'input',
        description: '與上面 Cookie 同一瀏覽器的 User-Agent；cf_clearance 與 UA 綁定，留空使用本體預設。',
        defaultValue: '',
      },
      {
        key: 'host',
        title: '站點入口',
        type: 'input',
        description: '留空自動在 missav.ai / missav.ws / missav.live 之間選擇；也可手動填寫。',
        defaultValue: '',
      },
    ];
    for (const setting of settings) {
      try {
        await this.registerSetting(setting);
      } catch (error) {
        // older runtimes without a settings ui still work with the defaults
      }
    }
    try {
      await this.entry();
    } catch (error) {
      // the first real read retries and reports with context
    }
  }

  // ---------- session ----------

  async setting(key) {
    try {
      const value = await this.getSetting(key);
      return value === undefined || value === null ? '' : String(value).trim();
    } catch (error) {
      return '';
    }
  }

  async headers() {
    this.state();
    if (!this._cookie) {
      this._cookie = {
        cookie: await this.setting('cookie'),
        agent: await this.setting('user_agent'),
      };
    }
    const headers = {
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    if (this._cookie.agent) headers['User-Agent'] = this._cookie.agent;
    if (this._cookie.cookie) headers.Cookie = this._cookie.cookie;
    return headers;
  }

  // ---------- entry ----------

  async entry() {
    this.state();
    if (this._site) return this._site;
    if (this._entryPending) return this._entryPending;
    this._entryPending = this.resolveEntry().then(
      (site) => {
        this._site = site;
        this._entryPending = null;
        return site;
      },
      (error) => {
        this._entryPending = null;
        throw error;
      }
    );
    return this._entryPending;
  }

  async resolveEntry() {
    const queue = [];
    const seen = new Set();
    const push = (value) => {
      const site = this.normalizeEntry(value);
      if (!site || seen.has(site)) return;
      seen.add(site);
      queue.push(site);
    };
    push(await this.setting('host'));
    for (const known of KNOWN_ENTRIES) push(known);

    const failures = [];
    while (queue.length) {
      const site = queue.shift();
      const result = await this.probeEntry(site);
      if (result.ok) {
        this._line = result.line || DEFAULT_LINE;
        return site;
      }
      failures.push(`${site}（${result.reason}）`);
    }
    throw new Error(
      '沒有可用的 missav 入口。\n'
      + failures.join('\n')
      + '\n站點由 Cloudflare 挑戰保護：請在瀏覽器打開一次 missav 並通過驗證，'
      + '然後把整段 Cookie（含 cf_clearance）和瀏覽器 UA 填進插件設置。'
    );
  }

  async probeEntry(site) {
    let body = '';
    try {
      body = await this.get(site, '/');
    } catch (error) {
      return { ok: false, line: '', reason: String(error && error.message ? error.message : error).slice(0, 60) };
    }
    if (this.challenged(body)) return { ok: false, line: '', reason: 'Cloudflare 驗證' };
    if (!/missav|dm\d+\//i.test(body)) return { ok: false, line: '', reason: '不是預期的頁面' };
    const line = body.match(/\/(dm\d+)\/([a-z]{2})\//i);
    return { ok: true, line: line ? `${line[1]}/${line[2]}` : '', reason: '' };
  }

  normalizeEntry(value) {
    const text = (value === undefined || value === null ? '' : String(value)).trim();
    if (!text) return '';
    const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const match = withScheme.match(/^https?:\/\/([^/?#:]+)(?::\d+)?\/?$/i);
    if (!match) return '';
    const host = match[1].toLowerCase();
    if (!HOSTS.test(host)) return '';
    return `https://${host}`;
  }

  currentSite() {
    return this._site || DEFAULT_ENTRY;
  }

  line() {
    return this._line || DEFAULT_LINE;
  }

  // ---------- helpers ----------

  absolute(url) {
    const value = (url || '').trim();
    if (!value) return '';
    if (/^\/\//.test(value)) return `https:${value}`;
    const resolved = /^https?:\/\//i.test(value) ? value : this.absoluteUrl(this.currentSite(), value);
    return /^https?:\/\//i.test(resolved) ? resolved : '';
  }

  textOf(html) {
    if (html === undefined || html === null) return '';
    return this.decodeEntities(
      String(html)
        .replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/<\/\s*(?:p|div|h[1-6]|li|tr|span|a)\s*>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
    )
      .replace(/[ \t\u00a0]+/g, ' ')
      .replace(/\s*\n\s*/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  attrValue(tag, name) {
    const match =
      String(tag).match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"', 'i')) ||
      String(tag).match(new RegExp("\\b" + name + "\\s*=\\s*'([^']*)'", 'i'));
    return match ? this.decodeEntities(match[1]).trim() : '';
  }

  meta(html, key) {
    for (const tag of String(html).match(/<meta\b[^>]*>/gi) || []) {
      const name = (this.attrValue(tag, 'property') || this.attrValue(tag, 'name')).toLowerCase();
      if (name !== key.toLowerCase()) continue;
      const content = this.attrValue(tag, 'content');
      if (content) return content;
    }
    return '';
  }

  pageNumber(page) {
    const raw = page === undefined || page === null ? '' : String(page).trim();
    if (!/^\d+$/.test(raw)) throw new Error('無效的頁碼：' + page);
    const value = parseInt(raw, 10);
    if (value < 1) throw new Error('無效的頁碼：' + page);
    return value;
  }

  challenged(body) {
    const text = String(body || '');
    return /Just a moment|cf-challenge|challenges\.cloudflare\.com|cf-mitigated/i.test(text)
      && !/\/dm\d+\/[a-z]{2}\//i.test(text);
  }

  // Returns the work path for a link, or '' when the link is a section of the
  // site (genres, actresses, search …) rather than a work.
  parseWork(path) {
    const text = String(path || '');
    const match = text.match(/^\/dm\d+\/[a-z]{2}\/([^/?#]+)\/?$/i);
    if (!match) return '';
    const slug = match[1].toLowerCase();
    if (RESERVED_SLUGS.indexOf(slug) >= 0) return '';
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(slug)) return '';
    if (!/\d/.test(slug)) return '';
    return text.replace(/\/$/, '');
  }

  // ---------- channels ----------

  async channels() {
    return LISTINGS.map((listing) => ({ title: listing.title, key: listing.key }));
  }

  async latest(page, channel) {
    const number = this.pageNumber(page);
    const key = (channel === undefined || channel === null ? '' : String(channel)).trim();
    const listing = LISTINGS.find((item) => item.key === key) || LISTINGS[0];
    const path = `/${this.line()}/${listing.key}${number > 1 ? `?page=${number}` : ''}`;
    const html = await this.page(path);
    return this.cards(html);
  }

  async search(kw, page) {
    const keyword = (kw === undefined || kw === null ? '' : String(kw)).trim();
    if (!keyword) return [];
    const number = this.pageNumber(page);
    const path = `/${this.line()}/search/${encodeURIComponent(keyword)}${number > 1 ? `?page=${number}` : ''}`;
    return this.cards(await this.page(path));
  }

  // Listing cards are recognised by their work url and their thumbnail, which
  // survives the small class-name changes the site ships.
  cards(html) {
    const source = String(html);
    const items = [];
    const seen = new Set();
    const anchor = /<a\b[^>]*href="([^"]*\/dm\d+\/[a-z]{2}\/[^"]+)"[^>]*>([\s\S]{0,2000}?)<\/a>/gi;
    let match;
    while ((match = anchor.exec(source)) !== null) {
      const href = this.absolute(match[1]);
      if (!href) continue;
      const path = this.parseWork(href.replace(/^https?:\/\/[^/]+/i, ''));
      if (!path || seen.has(path)) continue;
      const inner = match[2];
      const image = inner.match(/<img\b[^>]*>/i);
      const cover = image ? this.absolute(this.attrValue(image[0], 'data-src') || this.attrValue(image[0], 'src')) : '';
      const title = this.textOf(
        (image ? this.attrValue(image[0], 'alt') : '') || inner
      );
      if (!title && !cover) continue;
      seen.add(path);
      items.push({ title: title || path, url: path, cover, update: '' });
    }
    return items;
  }

  // ---------- detail ----------

  async detail(url) {
    const target = this.target(url);
    const html = await this.page(target.path);
    const title = this.textOf(this.meta(html, 'og:title')).replace(/\s*[-|]\s*MissAV.*$/i, '') || target.slug;
    const cover = this.absolute(this.meta(html, 'og:image'));
    const desc = this.textOf(this.meta(html, 'description') || (html.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i) || [])[1]);
    return {
      title,
      cover,
      desc,
      episodes: [{ title: '影片', urls: [{ name: title, url: target.path }] }],
    };
  }

  target(url) {
    const text = (url === undefined || url === null ? '' : String(url)).trim();
    if (!text) throw new Error('無效的影片地址：' + text);
    if (/^https?:\/\//i.test(text)) {
      const host = (text.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || '';
      if (!HOSTS.test(host)) throw new Error('無效的影片地址：' + text);
    }
    const raw = text.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '');
    const path = this.parseWork(raw);
    if (!path) throw new Error('無法解析影片地址：' + text);
    return { path, slug: path.split('/').filter(Boolean).pop() };
  }

  // ---------- playback ----------

  async watch(url) {
    const target = this.target(url);
    const html = await this.page(target.path);
    const streams = this.streams(html);
    if (!streams.length) {
      throw new Error(
        '這個頁面沒有內嵌播放地址。\n'
        + '若列表能打開但這裡失敗，通常是 Cookie 過期（cf_clearance 只有效數小時到數天），'
        + '重新從瀏覽器複製一次即可。'
      );
    }
    return { type: streams[0].includes('.m3u8') ? 'hls' : 'mp4', url: streams[0], headers: { Referer: this.currentSite() + '/' } };
  }

  streams(html) {
    const source = String(html || '');
    const found = [];
    const seen = new Set();
    const push = (value) => {
      const url = this.absolute(String(value || '').replace(/\\\//g, '/'));
      if (!url || !/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(url) || seen.has(url)) return;
      seen.add(url);
      found.push(url);
    };
    for (const tag of source.match(/(?:data-)?src\s*=\s*["']([^"']+)["']/gi) || []) {
      push((tag.match(/["']([^"']+)["']/) || [])[1]);
    }
    for (const match of source.match(/https?:\/\/[^"'\s\\]+?\.(?:m3u8|mp4)[^"'\s\\]*/gi) || []) push(match);
    // Surrit serves the playlist per quality; the master one ends in video.m3u8.
    return found
      .filter((url) => /\.m3u8/i.test(url) || /\.mp4/i.test(url))
      .sort((a, b) => (/(?:video|playlist)\.m3u8$/i.test(b) ? 1 : 0) - (/(?:video|playlist)\.m3u8$/i.test(a) ? 1 : 0));
  }

  // ---------- network ----------

  async page(path) {
    this.state();
    const cached = this._pages.get(path);
    if (cached && Date.now() - cached.time < PAGE_CACHE_MS) return cached.body;
    const running = this._inflight.get(path);
    if (running) return running;

    const task = this.fetchPage(path).then(
      (body) => {
        this._pages.set(path, { time: Date.now(), body });
        this._inflight.delete(path);
        return body;
      },
      (error) => {
        this._inflight.delete(path);
        throw error;
      }
    );
    this._inflight.set(path, task);
    return task;
  }

  async get(site, path) {
    this.state();
    const pace = () => {
      const wait = this._lastRequest + PAGE_GAP_MS - Date.now();
      return wait > 0 ? this.sleep(wait) : Promise.resolve();
    };
    this._queue = this._queue.then(pace, pace).then(() => {
      this._lastRequest = Date.now();
    });
    await this._queue;

    const text = await this.request(site + path, { headers: await this.headers() });
    const body = typeof text === 'string' ? text : JSON.stringify(text);
    if (this.challenged(body)) {
      throw new Error(
        'MissAV 回傳 Cloudflare 驗證頁（Just a moment...）。\n'
        + '請在瀏覽器打開 missav 通過驗證，把整段 Cookie（含 cf_clearance）與瀏覽器 UA 填進插件設置；'
        + 'Cookie 過期後需要重新複製。'
      );
    }
    return body;
  }

  async fetchPage(path) {
    const site = await this.entry();
    return this.get(site, path);
  }
}
