// ==MiruExtension==
// @name         Hanime1 動畫（中轉）
// @version      v1.1.0
// @author       FusionReader
// @lang         zh-tw
// @license      MIT
// @package      hanime1jina
// @type         bangumi
// @icon         https://vdownload.hembed.com/image/icon/tab_logo.png
// @webSite      http://hanime1.me
// @nsfw         true
// @network      direct
// ==/MiruExtension==
//
// A sibling of the `hanime1` source for devices where the site is unreachable
// without configuring a proxy. hanime1.me answers plain clients with Cloudflare's
// hard block ("Attention Required!", not a solvable challenge), so no bit of
// javascript inside the plugin can read it — the pages are fetched through the
// public https://r.jina.ai reader instead, which renders them in a real browser
// and hands back the HTML. The player urls live on vdownload.hembed.com, which
// is not behind that edge, so playback stays direct (verified: 206 + ftyp).
//
//   reader request : https://r.jina.ai/<target url>
//                    `x-return-format: html` — without it the reader rewrites the
//                    page into markdown and drops the player;
//                    `x-target-selector` — only that subtree is returned, which is
//                    what keeps the free tier usable (see the numbers below);
//                    `Authorization: Bearer …` — optional key, raises the limit to
//                    the key's quota instead of the per-ip one.
//   listing card   : div.video-item-container[title] > a.video-link[href]
//                    > img.main-thumb  (thumbnails are vdownload urls)
//   video page     : <video id="player"> with <source src=… size=720|480|1080>
//
// Token cost per request measured 2026-11-01 (the reader bills output tokens):
//   home page, whole document          63,309
//   home page, div.video-item-container 19,404   (-69%)
//   video page, whole document        104,059
//   video page, video + og: meta          727   (-99.3%)
// The free tier is 20 requests/minute per ip (500 with a free key), so the
// selectors buy headroom as much as they buy speed.

const SITE = 'https://hanime1.me';
const READER = 'https://r.jina.ai/';
const MEDIA_HOSTS = /^(?:[a-z0-9-]+\.)*(?:hembed\.com|hanime\.tv|hembed\.tv)$/i;
// what each kind of page needs. The genre grid is the exception: trimming to
// `div.home-rows-videos-div` drops the wrapping <a>, so that page is read whole
// (with a fresh render, see `reader`), and only home/search are trimmed.
const SELECTORS = {
  list: 'div.video-item-container',
  watch: 'video#player, meta[property^="og:"], title',
};
// pages whose reader cache came back without anchors and need x-no-cache
const FRESH_RENDER_PATTERN = /\/search\?genre=/i;
const SECTIONS = [
  { title: '首頁', path: '/' },
  { title: '裏番', path: '/search?genre=%E8%A3%8F%E7%95%AA' },
  { title: '泡麵番', path: '/search?genre=%E6%B3%A1%E9%BA%B5%E7%95%AA' },
  { title: 'Motion Anime', path: '/search?genre=Motion%20Anime' },
  { title: '3DCG', path: '/search?genre=3DCG' },
];
const PAGE_GAP_MS = 400;
const PAGE_CACHE_MS = 120000;

export default class extends Extension {
  state() {
    if (!this._pages) {
      this._pages = new Map();
      this._inflight = new Map();
      this._lastRequest = 0;
      this._queue = Promise.resolve();
      this._apiKey = null;
    }
    return this;
  }

  async load() {
    this.state();
    try {
      await this.registerSetting({
        key: 'api_key',
        title: 'Jina API Key',
        type: 'password',
        description: '可選。留空走免費額度（每 IP 每分鐘 20 次）；填入後限制改按 Key 計算（免費 Key 500 次/分鐘），多設備共用同一 IP 時建議填。在 jina.ai/api-dashboard 免費取得。',
        defaultValue: '',
      });
    } catch (error) {
      // older runtimes without a settings ui still work with the free tier
    }
  }

  async apiKey() {
    this.state();
    if (this._apiKey === null) {
      let value = '';
      try {
        const raw = await this.getSetting('api_key');
        value = raw === undefined || raw === null ? '' : String(raw).trim();
      } catch (error) {
        value = '';
      }
      // accept a full "Bearer …" paste as well as the bare key
      this._apiKey = value.replace(/^Bearer\s+/i, '');
    }
    return this._apiKey;
  }

  // ---------- helpers ----------

  absolute(url) {
    const value = (url || '').trim().replace(/\\\//g, '/');
    if (!value) return '';
    if (value.startsWith('//')) return `https:${value}`;
    const resolved = /^https?:\/\//i.test(value) ? value : this.absoluteUrl(SITE, value);
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

  videoId(url) {
    const text = String(url || '');
    return (text.match(/[?&]v=([\w-]+)/) || text.match(/\/watch\/([\w-]+)/) || [])[1] || '';
  }

  // ---------- reader transport ----------

  async request1(url, options) {
    this.state();
    const pace = () => {
      const wait = this._lastRequest + PAGE_GAP_MS - Date.now();
      return wait > 0 ? this.sleep(wait) : Promise.resolve();
    };
    this._queue = this._queue.then(pace, pace).then(() => {
      this._lastRequest = Date.now();
    });
    await this._queue;
    const text = await this.request(url, options || {});
    return typeof text === 'string' ? text : JSON.stringify(text);
  }

  // Every page goes through the reader: it is the only route that passes the
  // site's edge without a browser of our own. `selector` trims the response to
  // the subtree the caller needs, which is what keeps token use down.
  //
  // `noCache` matters: the reader keeps its own copy of a url and that copy can
  // be broken (a cached genre page came back with every <a> stripped, so the
  // grid had titles but no links). Asking for a fresh render fixes it, which is
  // why a listing that parses to nothing is retried once with the cache bypassed.
  async reader(target, selector, noCache) {
    const absolute = /^https?:\/\//i.test(target) ? target : `${SITE}${target}`;
    const key = await this.apiKey();
    const headers = {
      Accept: '*/*',
      'x-return-format': 'html',
      'x-no-cache': noCache ? 'true' : 'false',
      'x-timeout': '45',
    };
    if (selector) headers['x-target-selector'] = selector;
    if (key) headers.Authorization = `Bearer ${key}`;

    const body = await this.request1(`${READER}${absolute}`, {
      headers,
      allowErrorStatus: true,
    });
    if (/^\s*(?:\[|#|\{\s*"?(?:error|message))/i.test(body) && body.length < 400) {
      throw new Error(`中轉服務沒有返回頁面：${body.slice(0, 160)}`);
    }
    // a trimmed single element is fine: it need not be a whole document
    if (!/<html|<body|<div|<video|<img|<a|og:/i.test(body)) {
      throw new Error('中轉服務返回的內容不是網頁，可能已達免費額度上限，請稍後重試。');
    }
    return body;
  }

  // The cache key includes the selector: the same url read for a listing and for
  // a player carries different subtrees.
  async page(path, selector, noCache) {
    this.state();
    const key = `${noCache ? '!' : ''}${selector || ''}|${path}`;
    const cached = this._pages.get(key);
    if (cached && Date.now() - cached.time < PAGE_CACHE_MS) return cached.body;
    const running = this._inflight.get(key);
    if (running) return running;

    const task = this.reader(path, selector, noCache).then(
      (body) => {
        this._pages.set(key, { time: Date.now(), body });
        this._inflight.delete(key);
        return body;
      },
      (error) => {
        this._inflight.delete(key);
        throw error;
      }
    );
    this._inflight.set(key, task);
    return task;
  }

  // A listing read with the reader's own cache can come back with its anchors
  // stripped; the genre pages do so reliably, so they are read fresh, and any
  // other listing that parses to nothing is retried once with the cache bypassed.
  async listingPage(path, selector) {
    const needsFresh = FRESH_RENDER_PATTERN.test(path);
    const useSelector = needsFresh ? '' : selector;
    let html = await this.page(path, useSelector, needsFresh);
    if (this.cards(html).length) return html;
    const fresh = await this.reader(path, '', true);
    this._pages.set(`|${path}`, { time: Date.now(), body: fresh });
    return fresh;
  }

  // ---------- channels / listings ----------

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
    return this.cards(await this.listingPage(path, SELECTORS.list));
  }

  async search(kw, page) {
    const keyword = (kw === undefined || kw === null ? '' : String(kw)).trim();
    if (!keyword) return [];
    const number = this.pageNumber(page);
    const path = `/search?query=${encodeURIComponent(keyword)}${number > 1 ? `&page=${number}` : ''}`;
    return this.cards(await this.listingPage(path, SELECTORS.list));
  }

  // Two card shapes ship on the site:
  //   home/search : div.video-item-container[title] > a.video-link[href] > img.main-thumb
  //   genre       : a[href] > div.home-rows-videos-div > img + div.home-rows-videos-title
  // Both are handled so a channel and a keyword result look the same to the app.
  cards(html) {
    const source = String(html);
    const items = [];
    const seen = new Set();
    const push = (url, title, cover, duration) => {
      if (!url || seen.has(url)) return;
      const resolved = this.absolute(url);
      if (!/hanime1\.me\/watch\?v=/i.test(resolved)) return;
      seen.add(resolved);
      items.push({
        title: this.textOf(title) || this.videoId(resolved),
        url: resolved,
        cover: this.absolute(cover),
        update: this.textOf(duration),
      });
    };

    // shape 1: the rich card used on the home page and in search results
    const pattern = /<div\b[^>]*class="[^"]*video-item-container[^"]*"[^>]*>/gi;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const tag = match[0];
      const start = match.index;
      const nextIndex = source.slice(start + tag.length).search(/<div\b[^>]*class="[^"]*video-item-container[^"]*"/i);
      const block = nextIndex >= 0
        ? source.slice(start, start + tag.length + nextIndex)
        : source.slice(start, start + 2000);
      const anchor = block.match(/<a\b[^>]*href="(https?:\/\/hanime1\.me\/watch\?v=[\w-]+)"[^>]*>/i);
      if (!anchor) continue;
      const image = block.match(/<img\b[^>]*>/i);
      push(
        anchor[1],
        this.attrValue(tag, 'title') || (image ? this.attrValue(image[0], 'alt') : ''),
        image ? (this.attrValue(image[0], 'src') || this.attrValue(image[0], 'data-src')) : '',
        (block.match(/class="[^"]*duration[^"]*"[^>]*>([^<]{0,20})</i) || [])[1] || '',
      );
    }
    if (items.length) return items;

    // shape 2: the genre grid, one <a> per work
    const grid = /<a\b[^>]*href="(https?:\/\/hanime1\.me\/watch\?v=[\w-]+)"[^>]*>([\s\S]{0,900}?)<\/a>/gi;
    while ((match = grid.exec(source)) !== null) {
      const inner = match[2];
      const image = inner.match(/<img\b[^>]*>/i);
      push(
        match[1],
        (inner.match(/class="[^"]*home-rows-videos-title[^"]*"[^>]*>([\s\S]{0,160}?)</i) || [])[1]
          || (image ? this.attrValue(image[0], 'alt') : ''),
        image ? (this.attrValue(image[0], 'src') || this.attrValue(image[0], 'data-src')) : '',
        (inner.match(/class="[^"]*duration[^"]*"[^>]*>([^<]{0,20})</i) || [])[1] || '',
      );
    }
    return items;
  }

  // ---------- detail ----------

  target(url) {
    const text = (url === undefined || url === null ? '' : String(url)).trim();
    if (!text) throw new Error('無效的影片地址：' + text);
    const id = this.videoId(text);
    if (!id) throw new Error('無法解析影片地址：' + text);
    if (/^https?:\/\//i.test(text) && !/hanime1\.me\//i.test(text)) {
      throw new Error('無效的影片地址：' + text);
    }
    return { id, path: `/watch?v=${id}` };
  }

  async detail(url) {
    const target = this.target(url);
    const html = await this.page(target.path, SELECTORS.watch);
    // "<title> - H動漫/裏番/線上看 - Hanime1.me" is the site's suffix, not the name
    const stripSiteName = (value) => this.textOf(value)
      .replace(/\s*[-|]\s*(?:H動漫|Hanime1(?:\.me)?).*$/i, '')
      .trim();
    const title = stripSiteName(this.meta(html, 'og:title'))
      || stripSiteName((html.match(/<title>([\s\S]{0,200}?)<\/title>/i) || [])[1] || '')
      || target.id;
    const cover = this.absolute(this.meta(html, 'og:image'));
    const desc = this.textOf(this.meta(html, 'description'));
    return {
      title,
      cover,
      desc,
      episodes: [{ title: '播放', urls: [{ name: title, url: `/watch?v=${target.id}` }] }],
    };
  }

  // ---------- watch ----------

  async watch(url) {
    const target = this.target(url);
    const html = await this.page(target.path, SELECTORS.watch);
    const sources = this.videoSources(html);
    if (!sources.length) {
      if (/需要\s*(?:登入|註冊)|僅限\s*(?:會員|Premium)|登入後/.test(html)) {
        throw new Error('此影片需要網站帳號才能播放。');
      }
      throw new Error('這個頁面沒有可播放的影片來源，可能已下架或改為外嵌播放器。');
    }
    // highest quality wins; the media host takes the request directly
    sources.sort((left, right) => right.size - left.size);
    const chosen = sources[0];
    return { type: chosen.type, url: chosen.url };
  }

  videoSources(html) {
    const source = String(html);
    const players = source.match(/<video\b[\s\S]*?<\/video>/gi) || [];
    const pool = players.length ? players : [source];
    const sources = [];
    const seen = new Set();
    for (const block of pool) {
      for (const tag of block.match(/<source\b[^>]*>/gi) || []) {
        const url = this.absolute(this.attrValue(tag, 'src'));
        if (!url || seen.has(url)) continue;
        const host = (url.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || '';
        if (!MEDIA_HOSTS.test(host.replace(/:\d+$/, ''))) continue;
        seen.add(url);
        const type = this.attrValue(tag, 'type');
        const hls = /\.m3u8(\?|$)/i.test(url) || /mpegurl/i.test(type);
        sources.push({ url, type: hls ? 'hls' : 'mp4', size: parseInt(this.attrValue(tag, 'size'), 10) || 0 });
      }
    }
    // some players only ship a bare <video src="…">
    for (const block of pool) {
      const video = (block.match(/<video\b[^>]*>/i) || [])[0];
      if (!video) continue;
      const url = this.absolute(this.attrValue(video, 'src') || this.attrValue(video, 'data-src'));
      if (!url || seen.has(url)) continue;
      const host = (url.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || '';
      if (!MEDIA_HOSTS.test(host.replace(/:\d+$/, ''))) continue;
      seen.add(url);
      sources.push({ url, type: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'mp4', size: 0 });
    }
    return sources;
  }
}
