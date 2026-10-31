// ==MiruExtension==
// @name         Javtiful
// @version      v1.0.2
// @author       FusionReader
// @lang         zh-tw
// @license      MIT
// @package      javtiful
// @type         bangumi
// @icon         https://javtiful.com/favicon.ico
// @webSite      https://javtiful.com
// @nsfw         true
// @network      auto
// ==/MiruExtension==
//
// Verified against the title code SNOS-378 (2026-10-31):
//
//   search   : /search?q=SNOS-378            → /ja/video/114372/snos-378
//   listings : /ja/videos, ?sort=popular_week|most_viewed|most_liked,
//              /ja/uncensored, /ja/reducing-mosaic, ?page=N
//   work page: carries "videoTitle", "videoPoster" and
//              "playback":{"endpoint":"/ja/video/<id>/playback","ticket":"…"}
//   play     : POST that endpoint with ticket=<ticket>
//              → {"sources":[{"src":"/media/video/<id>/720p?expires=…&signature=…",
//                             "type":"video/mp4","size":720}]}
// The source is a signed progressive mp4, which matters: the HLS variants of
// some embed hosts name their segments *.css/*.svg and libavformat refuses them
// (only the first segment plays), while a plain mp4 has no such problem.

const DEFAULT_ENTRY = 'https://javtiful.com';
const SECTIONS = [
  { title: '最新', path: '/ja/videos' },
  { title: '本週熱門', path: '/ja/videos?sort=popular_week' },
  { title: '最多觀看', path: '/ja/videos?sort=most_viewed' },
  { title: '無碼', path: '/ja/uncensored' },
  { title: '減少馬賽克', path: '/ja/reducing-mosaic' },
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
    // the site needs no account or cookie to play
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

  jsonField(html, key) {
    const match = String(html).match(new RegExp(`"${key}"\\s*:\\s*"([^"]{0,400})"`));
    return match ? this.decodeEntities(match[1].replace(/\\\//g, '/')).trim() : '';
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
    return SECTIONS.map((section, index) => ({ title: section.title, key: String(index) }));
  }

  async latest(page, channel) {
    const number = this.pageNumber(page);
    const key = (channel === undefined || channel === null ? '' : String(channel)).trim();
    const index = /^\d+$/.test(key) ? parseInt(key, 10) : 0;
    const section = SECTIONS[index] || SECTIONS[0];
    const separator = section.path.indexOf('?') >= 0 ? '&' : '?';
    const path = `${section.path}${number > 1 ? `${separator}page=${number}` : ''}`;
    return this.cards(await this.page(path));
  }

  async search(kw, page) {
    const keyword = (kw === undefined || kw === null ? '' : String(kw)).trim();
    if (!keyword) return [];
    const number = this.pageNumber(page);
    const path = `/search?q=${encodeURIComponent(keyword)}${number > 1 ? `&page=${number}` : ''}`;
    return this.cards(await this.page(path));
  }

  // Work links are /<lang>/video/<id>/<slug>; the nearest image is the cover.
  cards(html) {
    const source = String(html);
    const items = [];
    const seen = new Set();
    const pattern = /<a\b[^>]*href="((?:\/[a-z]{2})?\/video\/(\d+)\/([^"?#]+))"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const path = `/ja/video/${match[2]}/${match[3]}`;
      if (seen.has(path)) continue;
      const inner = match[4];
      const image = inner.match(/<img\b[^>]*>/i);
      const cover = image ? this.imageUrl(image[0]) : '';
      const title = this.textOf((image ? this.attrValue(image[0], 'alt') : '') || inner)
        .replace(/^Thumbnail for\s+/i, '')
        || this.slugTitle(match[3]);
      if (!title && !cover) continue;
      seen.add(path);
      items.push({ title, url: path, cover, update: '' });
    }
    return items;
  }

  // The site lazily swaps a placeholder for the real thumbnail: the interesting
  // attribute is data-front-lazy-src, and placeholder paths must never leak into
  // a cover or the list shows a broken image.
  imageUrl(tag) {
    const raw = String(tag || '');
    const direct = [
      this.attrValue(raw, 'data-front-lazy-src'),
      this.attrValue(raw, 'data-src'),
      this.attrValue(raw, 'data-lazy-src'),
      this.attrValue(raw, 'data-original'),
    ].find((value) => value && !value.includes('video-thumb-placeholder'));
    if (direct) return this.absolute(direct);
    const srcset = this.attrValue(raw, 'srcset') || this.attrValue(raw, 'data-srcset');
    if (srcset) {
      const first = srcset.split(',').map((part) => part.trim().split(/\s+/)[0]).find((value) => value && !value.includes('video-thumb-placeholder'));
      if (first) return this.absolute(first);
    }
    const src = this.attrValue(raw, 'src');
    return src && !src.includes('video-thumb-placeholder') ? this.absolute(src) : '';
  }

  slugTitle(slug) {
    const text = String(slug || '').replace(/-/g, ' ').trim();
    if (!text) return '';
    if (text.length <= 4) return text.toUpperCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // ---------- detail ----------

  async detail(url) {
    const target = this.target(url);
    const html = await this.page(target.path);
    const title = this.jsonField(html, 'videoTitle')
      || this.textOf((html.match(/<title>([\s\S]{0,200}?)<\/title>/i) || [])[1] || '')
        .replace(/\s*\|\s*Javtiful\s*$/i, '').trim()
      || target.slug;
    const poster = this.jsonField(html, 'videoPoster');
    // The work page's "actress" picture is the site's generic avatar, not a
    // portrait, so the real still is the only usable cover.
    const cover = this.absolute(poster)
      || this.absolute(this.meta(html, 'og:image'))
      || this.absolute((html.match(/data-front-lazy-src="([^"]+)"/) || [])[1]);
    const desc = this.textOf(this.meta(html, 'description'));
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
    if (/^https?:\/\//i.test(text) && !/^https?:\/\/(?:[a-z0-9-]+\.)*javtiful\.com\//i.test(text)) {
      throw new Error('無效的影片地址：' + text);
    }
    const path = text.replace(/#.*$/, '').replace(/^https?:\/\/[^/]+/i, '').replace(/[?].*$/, '');
    const match = path.match(/^(?:\/[a-z]{2})?\/video\/(\d+)\/([^/]+)\/?$/);
    if (!match) throw new Error('無法解析影片地址：' + text);
    return { path: `/ja/video/${match[1]}/${match[2]}`, id: match[1], slug: match[2] };
  }

  // ---------- playback ----------

  async watch(url) {
    const target = this.target(url);
    const html = await this.page(target.path);
    const match = String(html).match(/"playback"\s*:\s*\{\s*"endpoint"\s*:\s*"([^"]+)"\s*,\s*"ticket"\s*:\s*"([^"]+)"/);
    if (!match) {
      throw new Error('這個頁面沒有播放授權（可能需要登入或已下架）。');
    }
    const endpoint = this.absolute(match[1]);
    const ticket = this.decodeEntities(match[2]);

    // the endpoint takes a form encoded ticket and answers with signed sources
    const body = await this.page(endpoint, {
      method: 'POST',
      data: `ticket=${encodeURIComponent(ticket)}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: DEFAULT_ENTRY + target.path,
      },
    });
    let payload = null;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      throw new Error('播放介面回傳的不是 JSON，站點可能改版了。');
    }
    const sources = (payload && payload.sources) || [];
    let best = '';
    let bestSize = -1;
    for (const source of sources) {
      const src = this.absolute(source && source.src);
      const size = parseInt(source && source.size, 10);
      if (!/^https?:\/\//i.test(src)) continue;
      if (Number.isFinite(size) && size > bestSize) {
        bestSize = size;
        best = src;
      } else if (!best) {
        best = src;
      }
    }
    if (!best) {
      throw new Error('播放介面沒有給出可用的地址，可能已失效。');
    }
    return { type: 'mp4', url: best, headers: { Referer: `${DEFAULT_ENTRY}/` } };
  }

  // ---------- network ----------

  async page(path, options) {
    this.state();
    const cacheKey = options ? '' : path;
    if (!options) {
      const cached = this._pages.get(path);
      if (cached && Date.now() - cached.time < PAGE_CACHE_MS) return cached.body;
      const running = this._inflight.get(path);
      if (running) return running;
    }

    const task = this.fetchPage(path, options).then(
      (body) => {
        if (!options) {
          this._pages.set(path, { time: Date.now(), body });
          this._inflight.delete(path);
        }
        return body;
      },
      (error) => {
        if (!options) this._inflight.delete(path);
        throw error;
      }
    );
    if (!options) this._inflight.set(path, task);
    return task;
  }

  async get(url, options) {
    this.state();
    const pace = () => {
      const wait = this._lastRequest + PAGE_GAP_MS - Date.now();
      return wait > 0 ? this.sleep(wait) : Promise.resolve();
    };
    this._queue = this._queue.then(pace, pace).then(() => {
      this._lastRequest = Date.now();
    });
    await this._queue;

    const request = {
      headers: {
        'Accept-Language': 'ja,en;q=0.9',
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        ...((options && options.headers) || {}),
      },
    };
    if (options && options.method) request.method = options.method;
    if (options && options.data !== undefined) request.data = options.data;

    const text = await this.request(url, request);
    const body = typeof text === 'string' ? text : JSON.stringify(text);
    if (/Just a moment|Attention Required|cf-error-code/i.test(body) && !/\/video\/\d+/i.test(body)) {
      throw new Error('Javtiful 被 Cloudflare 攔截了，請稍後重試或切換連線方式。');
    }
    return body;
  }

  async fetchPage(path, options) {
    return this.get(/^https?:\/\//i.test(path) ? path : DEFAULT_ENTRY + path, options);
  }
}
