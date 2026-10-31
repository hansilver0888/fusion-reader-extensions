// ==MiruExtension==
// @name         123AV
// @version      v1.0.0
// @author       FusionReader
// @lang         zh-tw
// @license      MIT
// @package      av123
// @type         bangumi
// @icon         https://123av.com/favicon.ico
// @webSite      https://123av.com
// @nsfw         true
// @network      auto
// ==/MiruExtension==
//
// A JAV catalogue that can be looked up by title code (checked 2026-10-31):
//
//   search      : /en/search?keyword=<code>          → cards of /en/v/<slug>
//   works       : /en/v/<slug>                        (e.g. /en/v/snos-378)
//   listings    : /en/new, /en/hot, /en/uncensored, /en/uncensored-leaked
//                 with ?page=N
//   card        : <div class="card"> … <a class="card__cover" href="/en/v/…">
//                 <img class="card__img" src="…/s360/<slug>/cover.jpg">
//                 <span class="card__dur">1:35:14</span> … <h3>…</h3>
//   play        : the work page prints its episodes as
//                 player(JSON.parse('[{"name":"1","url":"https://<embed>/e/<hash>"}]'), …)
//                 and the embed answers `<embed origin>/stream?id=<hash>` with
//                 {"status":"ok","media":{"stream":"https://…/video.m3u8"}}
// The embed host changes between videos, so the origin is taken from the
// episode url instead of being hard coded.

const DEFAULT_ENTRY = 'https://123av.com';
const SECTIONS = [
  { title: '最新', key: 'new' },
  { title: '熱門', key: 'hot' },
  { title: '無碼', key: 'uncensored' },
  { title: '無碼流出', key: 'uncensored-leaked' },
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
    const path = `/en/${section.key}${number > 1 ? `?page=${number}` : ''}`;
    return this.cards(await this.page(path));
  }

  async search(kw, page) {
    const keyword = (kw === undefined || kw === null ? '' : String(kw)).trim();
    if (!keyword) return [];
    const number = this.pageNumber(page);
    const path = `/en/search?keyword=${encodeURIComponent(keyword)}${number > 1 ? `&page=${number}` : ''}`;
    return this.cards(await this.page(path));
  }

  // Cards are `div.card` blocks: the cover anchor is the work url and the title
  // sits in the block's heading.
  cards(html) {
    const source = String(html);
    const items = [];
    const seen = new Set();
    for (const block of source.split(/<div class="card\b/).slice(1)) {
      const anchor = (block.match(/<a\b[^>]*class="card__cover"[^>]*href="([^"]+)"/i) || [])[1]
        || (block.match(/<a\b[^>]*href="(\/en\/v\/[^"]+)"/i) || [])[1];
      const path = this.absolute(anchor).replace(/^https?:\/\/[^/]+/i, '');
      if (!/^\/en\/v\/[^/?#]+$/.test(path) || seen.has(path)) continue;
      const image = block.match(/<img\b[^>]*class="card__img"[^>]*>/i) || block.match(/<img\b[^>]*>/i);
      const cover = image ? this.absolute(this.attrValue(image[0], 'src') || this.attrValue(image[0], 'data-src')) : '';
      const title = this.textOf(
        (block.match(/<h3[^>]*>([\s\S]{0,400}?)<\/h3>/i) || [])[1]
        || (block.match(/class="card__title"[^>]*>([\s\S]{0,200}?)</i) || [])[1]
        || ''
      ) || this.slugTitle(path);
      const duration = this.textOf((block.match(/class="card__dur"[^>]*>([^<]{0,20})</i) || [])[1] || '');
      seen.add(path);
      items.push({ title: title || path, url: path, cover, update: duration });
    }
    return items;
  }

  slugTitle(path) {
    const slug = String(path).split('/').filter(Boolean).pop() || '';
    return slug.replace(/[-_]+/g, ' ').toUpperCase().trim();
  }

  // ---------- detail ----------

  async detail(url) {
    const target = this.target(url);
    const html = await this.page(target.path);
    const rawTitle = this.textOf((html.match(/<title>([\s\S]{0,200}?)<\/title>/i) || [])[1] || '');
    const title = rawTitle.replace(/\s*[-|—]\s*123AV.*$/i, '').trim() || target.slug.toUpperCase();
    const covers = [...new Set([...html.matchAll(/https?:\/\/icdn\.123av\.me\/img2\/[^"'\s]+/g)]
      .map((match) => match[0].replace(/\\\//g, '/')))];
    const cover = covers.find((value) => /\/s500\//.test(value)) || covers[0] || '';
    const episodes = this.episodes(html);
    return {
      title,
      cover,
      desc: this.description(html),
      episodes: [{
        title: '播放',
        urls: episodes.map((episode, index) => ({
          name: episode.name || `線路 ${index + 1}`,
          url: `${target.path}#ep${index}`,
        })),
      }],
    };
  }

  description(html) {
    const generic = 'Stream JAV and Japanese AV online';
    const candidates = [
      (html.match(/class="watch__desc"[^>]*>([\s\S]{0,1200}?)<\/(?:div|p)>/i) || [])[1],
      (html.match(/class="synopsis"[^>]*>([\s\S]{0,1200}?)<\/(?:div|p)>/i) || [])[1],
      this.meta(html, 'description'),
    ];
    for (const candidate of candidates) {
      const text = this.textOf(candidate || '');
      if (text && text.indexOf(generic) < 0) return text;
    }
    return '';
  }

  // The work page embeds its episode list as a JSON.parse('…') argument.
  episodes(html) {
    const match = String(html).match(/JSON\.parse\('([\s\S]{0,6000}?)'\)/);
    if (!match) return [];
    let raw = match[1]
      .replace(/\\u0022/g, '"')
      .replace(/\\\//g, '/')
      .replace(/\\'/g, "'");
    let list = [];
    try {
      list = JSON.parse(raw);
    } catch (error) {
      return [];
    }
    if (!Array.isArray(list)) return [];
    const episodes = [];
    for (const entry of list) {
      const url = this.absolute(entry && entry.url);
      if (!/^https?:\/\//i.test(url)) continue;
      episodes.push({ name: String(entry.name || entry.number || ''), url });
    }
    return episodes;
  }

  target(url) {
    const text = (url === undefined || url === null ? '' : String(url)).trim();
    if (!text) throw new Error('無效的影片地址：' + text);
    if (/^https?:\/\//i.test(text) && !/^https?:\/\/(?:[a-z0-9-]+\.)*123av\.com\//i.test(text)) {
      throw new Error('無效的影片地址：' + text);
    }
    const path = text.replace(/#.*$/, '').replace(/^https?:\/\/[^/]+/i, '').replace(/[?].*$/, '');
    const match = path.match(/^\/en\/v\/([^/]+)\/?$/);
    if (!match) throw new Error('無法解析影片地址：' + text);
    return { path: `/en/v/${match[1]}`, slug: match[1] };
  }

  // ---------- playback ----------

  async watch(url) {
    const text = (url === undefined || url === null ? '' : String(url)).trim();
    if (!text) throw new Error('無效的影片地址：' + text);

    // A work url resolves through its own episode list; the directory hands the
    // episode url over directly (the #epN fragment picks one).
    let episode = '';
    const indexMatch = text.match(/#ep(\d+)\s*$/i);
    if (/^https?:\/\//i.test(text) && !/123av\.com\/en\/v\//i.test(text)) {
      episode = text.replace(/#.*$/, '');
    } else {
      const target = this.target(text);
      const html = await this.page(target.path);
      const episodes = this.episodes(html);
      const index = indexMatch ? parseInt(indexMatch[1], 10) : 0;
      episode = (episodes[index] || episodes[0] || {}).url || '';
    }
    if (!episode) {
      throw new Error('這個頁面沒有可用的線路，站點可能改版了。');
    }

    // the runtime has no WHATWG URL, so the origin and the hash are read from
    // the string itself
    const origin = (episode.match(/^(https?:\/\/[^/]+)/i) || [])[1] || '';
    const hash = (episode.match(/\/e\/([a-z0-9_]+)/i) || [])[1] || '';
    if (!origin || !hash) {
      throw new Error('無法解析線路地址：' + episode);
    }
    const endpoint = `${origin}/stream?id=${encodeURIComponent(hash)}`;
    const body = await this.page(endpoint);
    let payload = null;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      throw new Error('線路介面回傳的不是 JSON，站點可能改版了。');
    }
    const stream = this.absolute((payload && payload.media && payload.media.stream) || '');
    if (!/^https?:\/\//i.test(stream)) {
      throw new Error('線路沒有給出播放地址，可能已失效。');
    }
    return { type: 'hls', url: stream, headers: { Referer: `${origin}/` } };
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
        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
    });
    const body = typeof text === 'string' ? text : JSON.stringify(text);
    if (/Just a moment|Attention Required|cf-error-code/i.test(body) && !/class="card\b|"media"/i.test(body)) {
      throw new Error('123AV 被 Cloudflare 攔截了，請稍後重試或切換連線方式。');
    }
    return body;
  }

  async fetchPage(path) {
    return this.get(/^https?:\/\//i.test(path) ? path : DEFAULT_ENTRY + path);
  }
}
