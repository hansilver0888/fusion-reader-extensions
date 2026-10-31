// ==MiruExtension==
// @name         xHamster
// @version      v1.0.0
// @author       FusionReader
// @lang         zh-tw
// @license      MIT
// @package      xhamster
// @type         bangumi
// @icon         https://xhamster.com/favicon.ico
// @webSite      https://xhamster.com
// @nsfw         true
// @network      auto
// ==/MiruExtension==
//
// Picked as the open stand-in for the sites that sit behind Cloudflare: every
// page answers a normal client (checked 2026-10-31) and the video page prints a
// playable HLS master playlist on xhcdn, so neither a signed hash nor a session
// is needed. The Japanese / uncensored / JAV categories carry the uncensored
// material the challenged sites were wanted for.
//
//   listing : /categories/<name>/<page>  and  /search/<keyword>?page=<n>
//   cards   : <a href="/videos/<slug>-xh<id>">…<img src=… alt=…>…</a>
//   video   : <link rel="preload" href="https://video-nss.xhcdn.com/….av1.mp4.m3u8">
// The playlist url is read with a tolerant scan because it moves between the
// preload tag and the player blob depending on the page variant.

const DEFAULT_ENTRY = 'https://xhamster.com';
const SECTIONS = [
  { title: '日系', key: 'categories/japanese' },
  { title: '無碼', key: 'categories/uncensored' },
  { title: 'JAV', key: 'categories/jav' },
];
const PAGE_GAP_MS = 300;
const PAGE_CACHE_MS = 30000;

export default class extends Extension {
  state() {
    if (!this._pages) {
      this._pages = new Map();
      this._inflight = new Map();
      this._lastRequest = 0;
      this._queue = Promise.resolve();
    }
    return this;
  }

  async load() {
    this.state();
  }

  // ---------- helpers ----------

  absolute(url) {
    const value = (url || '').trim().replace(/\\\//g, '/');
    if (!value) return '';
    if (/^\/\//.test(value)) return `https:${value}`;
    const resolved = /^https?:\/\//i.test(value) ? value : this.absoluteUrl(DEFAULT_ENTRY, value);
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
    return match ? this.decodeEntities(match[1]).replace(/\\\//g, '/').trim() : '';
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

  // ---------- channels ----------

  async channels() {
    return SECTIONS.map((section) => ({ title: section.title, key: section.key }));
  }

  async latest(page, channel) {
    const number = this.pageNumber(page);
    const key = (channel === undefined || channel === null ? '' : String(channel)).trim();
    const section = SECTIONS.find((item) => item.key === key) || SECTIONS[0];
    const path = `/${section.key}${number > 1 ? `/${number}` : ''}`;
    return this.cards(await this.page(path));
  }

  async search(kw, page) {
    const keyword = (kw === undefined || kw === null ? '' : String(kw)).trim();
    if (!keyword) return [];
    const number = this.pageNumber(page);
    const path = `/search/${encodeURIComponent(keyword)}${number > 1 ? `?page=${number}` : ''}`;
    return this.cards(await this.page(path));
  }

  // Every work is linked as `/videos/<slug>`; the thumbnail and the title sit
  // around that link (sometimes in a sibling element), so each link is matched by
  // position and the nearest image is used, with the slug as the last resort.
  cards(html) {
    const source = String(html);
    const items = [];
    const seen = new Set();
    const pattern = /<a\b[^>]*href="([^"]*\/videos\/[^"?#]+)"[^>]*>/gi;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const url = this.absolute(match[1]);
      const path = url.replace(/^https?:\/\/[^/]+/i, '');
      // /creators/videos/… is not a work, only a top level /videos/<slug> is
      if (!/^\/videos\/[^/?#]+$/.test(path) || seen.has(path)) continue;

      const after = source.slice(match.index, match.index + 2500);
      let image = after.match(/<img\b[^>]*>/i);
      if (!image) {
        const before = source.slice(Math.max(0, match.index - 1500), match.index);
        const earlier = before.match(/<img\b[^>]*>/gi);
        if (earlier) image = [earlier[earlier.length - 1]];
      }
      const cover = image ? this.absolute(this.attrValue(image[0], 'data-src') || this.attrValue(image[0], 'src')) : '';
      const title = this.textOf((image ? this.attrValue(image[0], 'alt') : '') || '') || this.slugTitle(path);
      if (!title && !cover) continue;
      seen.add(path);
      items.push({ title, url: path, cover, update: '' });
    }
    return items;
  }

  slugTitle(path) {
    const slug = String(path).split('/').filter(Boolean).pop() || '';
    return slug
      .replace(/-xh[A-Za-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();
  }

  // ---------- detail ----------

  async detail(url) {
    const target = this.target(url);
    const html = await this.page(target.path);
    const title = this.textOf(this.meta(html, 'og:title')).replace(/\s*[-|]\s*xHamster.*$/i, '')
      || this.textOf((html.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i) || [])[1] || '')
      || target.slug;
    const cover = this.absolute(this.meta(html, 'og:image'));
    const desc = this.textOf(this.meta(html, 'description') || this.meta(html, 'og:description'));
    return {
      title,
      cover,
      desc,
      episodes: [{ title: '播放', urls: [{ name: title, url: target.path }] }],
    };
  }

  target(url) {
    const text = (url === undefined || url === null ? '' : String(url)).trim();
    if (!text) throw new Error('無效的影片地址：' + text);
    if (/^https?:\/\//i.test(text) && !/^https?:\/\/(?:[a-z0-9-]+\.)*xhamster\.com\//i.test(text)) {
      throw new Error('無效的影片地址：' + text);
    }
    const path = text.replace(/#.*$/, '').replace(/^https?:\/\/[^/]+/i, '').replace(/[?].*$/, '');
    const match = path.match(/^\/videos\/([^/]+)\/?$/);
    if (!match) throw new Error('無法解析影片地址：' + text);
    return { path: `/videos/${match[1]}`, slug: match[1] };
  }

  // ---------- playback ----------

  async watch(url) {
    const target = this.target(url);
    const html = await this.page(target.path);
    const cooked = String(html).replace(/\\\//g, '/');
    const candidates = [];
    for (const match of cooked.matchAll(/https?:\/\/[^"'\s<>]+\.m3u8[^"'\s<>]*/gi)) {
      if (candidates.indexOf(match[0]) < 0) candidates.push(match[0]);
    }
    if (!candidates.length) {
      throw new Error('這個頁面沒有可播放的 m3u8 地址，站點可能改版了。');
    }
    // the master playlist lists every resolution and is served by xhcdn
    const best = candidates.find((value) => /xhcdn\.com/i.test(value) && /multi=|av1\.mp4\.m3u8/i.test(value))
      || candidates.find((value) => /xhcdn\.com/i.test(value))
      || candidates[0];
    return { type: 'hls', url: best, headers: { Referer: `${DEFAULT_ENTRY}/` } };
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

  async get(url) {
    this.state();
    const pace = () => {
      const wait = this._lastRequest + PAGE_GAP_MS - Date.now();
      return wait > 0 ? this.sleep(wait) : Promise.resolve();
    };
    this._queue = this._queue.then(pace, pace).then(() => {
      this._lastRequest = Date.now();
    });
    await this._queue;

    const text = await this.request(url, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
    });
    const body = typeof text === 'string' ? text : JSON.stringify(text);
    if (/Just a moment|Attention Required|cf-error-code/i.test(body) && !/\/videos\//i.test(body)) {
      throw new Error('xHamster 被 Cloudflare 攔截了，請稍後重試或切換連線方式。');
    }
    return body;
  }

  async fetchPage(path) {
    return this.get(/^https?:\/\//i.test(path) ? path : DEFAULT_ENTRY + path);
  }
}
