// ==MiruExtension==
// @name         Hanime1 動畫
// @version      v1.0.1
// @author       FusionReader
// @lang         zh-tw
// @license      MIT
// @package      hanime1
// @type         bangumi
// @icon         https://vdownload.hembed.com/image/icon/tab_logo.png?secure=EJYLwnrDlidVi_wFp3DaGw==,4867726124
// @webSite      http://hanime1.me
// @nsfw         true
// @network      proxy
// ==/MiruExtension==
//
// Transport note (checked 2026-10-14): the site's Cloudflare edge answers
// direct https requests from non-browser tls stacks — the app's dart:io
// client, node and curl's OpenSSL build — with "Attention Required!" (403),
// while its own http -> https redirect works: an http request is answered with
// 301 and the followed https request returns the page. Pages are therefore
// requested over http and the app's client follows the redirect, which was
// verified on the app's own dio + cookie stack for search, genre, video,
// playlist and comment pages. Media urls are absolute and served by
// vdownload.hembed.com (CDN77, not behind that edge), so playback is
// unaffected; libmpv reaches them over https directly.
//
// Routing note: hanime1.me is not reachable from mainland China without a
// proxy, while the media host does not reject proxy exits — pages and streams
// share one route and the plugin declares `proxy` for both.
//
// The proxy itself comes from the app: `resolvedProxy()` only reads the
// process environment (HTTPS_PROXY / HTTP_PROXY). A proxy tool running in
// "system proxy" mode is invisible to the app, and a request leaving without
// one is answered with the same Cloudflare page as a blocked https attempt —
// measured both ways on the app's own dio stack. The plugin therefore reports
// that case with an explicit hint instead of a bare status code.
//
// The media urls carry a `secure` signature with an expiry, so watch() always
// re-reads the video page instead of storing a stream address in the
// catalogue: episode entries only hold the site's own /watch?v=<id> links.
//
// The site has no JSON catalogue api; listings, search and the video page are
// plain server-rendered html. Parsing is done in-script against the classes
// the website ships today, which keeps the whole source testable offline.

const SITE = 'http://hanime1.me';

// Video pages embed signed media urls; only same-family hosts are trusted.
const MEDIA_HOSTS = /^(?:[a-z0-9-]+\.)*(?:hembed\.com|hanime1\.me)$/i;

// Browse channels. Keys are the website's own search parameters, so the app's
// channel list maps one to one onto /search?<key>&page=N.
const GENRES = ['裏番', '泡麵番', '新番預告', '2D動畫', '3DCG', '2.5D', 'MMD', 'Motion Anime', 'Cosplay', 'AI生成'];
const SORTS = ['最新上市', '最新上傳', '本日排行', '本週排行', '本月排行', '觀看次數', '讚好比例', '時長最長', '他們在看'];
const ATTRIBUTE_TAGS = ['中文字幕', '無碼', 'AI解碼', '中文配音', '同人作品', '1080p', '60FPS', 'ASMR', '斷面圖'];
const CONTENT_TAGS = ['巨乳', '貧乳', 'JK', '人妻', '御姐', '熟女', '癡女', '純愛', 'NTR', '後宮', '校園', '絲襪', '泳裝', '女僕'];
const DATES = ['過去 24 小時', '過去 2 天', '過去 1 週', '過去 1 個月', '過去 3 個月', '過去 1 年'];

const CHANNEL_PARAMS = { sort: true, genre: true, date: true, 'tags[]': true };
const DEFAULT_SORT = '最新上市';

const PAGE_GAP_MS = 350;
const PAGE_CACHE_MS = 30000;
const COOLDOWN_MS = 30000;
const BLOCK_RETRY_MS = 3000;
const PLAYLIST_PAGE_LIMIT = 20;
const TAG_LIMIT = 20;

export default class extends Extension {
  state() {
    if (!this._pages) {
      this._pages = new Map();
      this._inflight = new Map();
      this._lastRequest = 0;
      this._cooldownUntil = 0;
      this._queue = Promise.resolve();
    }
    return this;
  }

  async load() {
    this.state();
    await this.registerSetting({
      key: 'quality',
      title: '畫質偏好',
      type: 'input',
      description: '自動 / 1080p / 720p / 480p，預設自動；指定的畫質不存在時取最高可用畫質。',
      defaultValue: 'auto',
    });
  }

  // ---------- URL and text helpers ----------

  // Accept `?v=1`, `/watch?v=1`, a full url, or a bare id.
  videoId(url) {
    const text = (url === undefined || url === null ? '' : String(url)).trim();
    if (/^https?:\/\//i.test(text) && !/^https?:\/\/hanime1\.me\//i.test(text)) {
      throw new Error('無效的影片地址：' + text);
    }
    const match =
      text.match(/[?&]v=(\d+)/) ||
      text.match(/\/watch\?v=(\d+)/) ||
      text.match(/^(\d+)$/);
    if (!match) throw new Error('無法解析影片編號：' + text);
    return match[1];
  }

  pageNumber(page) {
    const raw = page === undefined || page === null ? '' : String(page).trim();
    if (!/^\d+$/.test(raw)) throw new Error('無效的頁碼：' + page);
    const value = parseInt(raw, 10);
    if (value < 1) throw new Error('無效的頁碼：' + page);
    return value;
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

  metaContent(html, key) {
    const metas = String(html).match(/<meta\b[^>]*>/gi) || [];
    for (const tag of metas) {
      const property = this.attrValue(tag, 'property') || this.attrValue(tag, 'name');
      if (property.toLowerCase() !== key.toLowerCase()) continue;
      const content = this.attrValue(tag, 'content');
      if (content) return content;
    }
    return '';
  }

  absolute(url) {
    const value = (url || '').trim();
    if (!value) return '';
    const resolved = /^https?:\/\//i.test(value) ? value : this.absoluteUrl(SITE, value);
    return /^https?:\/\//i.test(resolved) ? resolved : '';
  }

  // Links printed by the site keep pointing at its https host; anything that
  // will be requested again is moved back to the entry point above.
  siteUrl(url) {
    const resolved = this.absolute(url);
    if (!resolved) return '';
    return /^https?:\/\/hanime1\.me\//i.test(resolved) ? resolved.replace(/^https?:\/\/hanime1\.me/i, SITE) : resolved;
  }

  // ---------- listing html ----------

  // Listings use two layouts: search, tag and playlist pages print wide rows
  // (`video-item-container`), while genre pages print a grid whose card is a
  // single anchor (`home-rows-videos-div`). Both are read here and merged in
  // document order. Cards for the site's own ads reuse the same classes but
  // link away from /watch, so entries without a video id are dropped.
  cards(html) {
    const source = String(html);
    const rows = [];
    const marker = /<div[^>]*class="[^"]*video-item-container[^"]*"[^>]*>/gi;
    let match;
    while ((match = marker.exec(source)) !== null) rows.push(match.index);
    const ranges = rows.map((start, index) => ({
      start,
      end: index + 1 < rows.length ? rows[index + 1] : Math.min(source.length, start + 12000),
    }));

    const collected = [];
    for (const range of ranges) {
      const item = this.itemFromCard(source.slice(range.start, range.end));
      if (item) collected.push({ index: range.start, item });
    }

    const grid = /<a\b[^>]*href="[^"]*\/watch\?v=\d+[^"]*"[^>]*>[\s\S]*?<\/a>/gi;
    while ((match = grid.exec(source)) !== null) {
      const inside = ranges.some((range) => match.index >= range.start && match.index < range.end);
      if (inside) continue;
      const item = this.itemFromCard(match[0]);
      if (item) collected.push({ index: match.index, item });
    }

    collected.sort((a, b) => a.index - b.index);
    const items = [];
    const seen = new Set();
    for (const entry of collected) {
      if (seen.has(entry.item.url)) continue;
      seen.add(entry.item.url);
      items.push(entry.item);
    }
    return items;
  }

  itemFromCard(block) {
    const link = block.match(/\/watch\?v=(\d+)/);
    if (!link) return null;
    const title =
      this.textOf((block.match(/<h4[^>]*class="[^"]*video-title[^"]*"[^>]*>([\s\S]*?)<\/h4>/i) || [])[1]) ||
      this.textOf((block.match(/<div[^>]*class="[^"]*home-rows-videos-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1]) ||
      this.textOf((block.match(/<div[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1]);
    if (!title) return null;

    const cover = this.thumbUrl(block);
    const duration = this.textOf((block.match(/<div[^>]*class="[^"]*\bduration\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1]);
    const update = [duration, this.cardViews(block)].filter(Boolean).join(' · ');

    return { title, url: `/watch?v=${link[1]}`, cover, update };
  }

  // The card shows the rating first (it carries the thumb icon) and the play
  // count second, so the entry without an icon is the count.
  cardViews(block) {
    const items = String(block).match(/<div[^>]*class="[^"]*stat-item[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
    for (const item of items) {
      if (/<i\b/i.test(item)) continue;
      const text = this.textOf(item);
      if (/\d/.test(text)) return text;
    }
    return '';
  }

  thumbUrl(block) {
    const images = String(block).match(/<img\b[^>]*>/gi) || [];
    const ranked = images.slice().sort((a, b) => (/main-thumb/i.test(b) ? 1 : 0) - (/main-thumb/i.test(a) ? 1 : 0));
    for (const tag of ranked) {
      for (const name of ['data-src', 'data-original', 'data-lazy-src', 'src']) {
        const value = this.attrValue(tag, name);
        if (value && !/^data:/i.test(value)) {
          const url = this.absolute(value);
          if (url) return url;
        }
      }
    }
    return '';
  }

  // ---------- channels ----------

  async channels() {
    const channels = [];
    for (const genre of GENRES) channels.push({ title: genre, key: `genre=${genre}` });
    for (const sort of SORTS) channels.push({ title: sort, key: `sort=${sort}` });
    for (const tag of ATTRIBUTE_TAGS.concat(CONTENT_TAGS)) channels.push({ title: `標籤：${tag}`, key: `tags[]=${tag}` });
    for (const date of DATES) channels.push({ title: `日期：${date}`, key: `date=${date}` });
    return channels;
  }

  // Turn a channel key into the website's own query string. Unknown or empty
  // parameters are rejected instead of being passed through to the site.
  channelQuery(channel) {
    const raw = (channel === undefined || channel === null ? '' : String(channel)).trim();
    if (!raw) return `sort=${encodeURIComponent(DEFAULT_SORT)}`;
    const parts = [];
    for (const pair of raw.split('&')) {
      const at = pair.indexOf('=');
      if (at <= 0) throw new Error('未知的分類：' + raw);
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (!CHANNEL_PARAMS[name] || !value) throw new Error('未知的分類：' + raw);
      parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(value));
    }
    return parts.join('&');
  }

  async latest(page, channel) {
    const query = this.channelQuery(channel);
    return this.searchPage(`${query}&page=${this.pageNumber(page)}`);
  }

  async search(kw, page) {
    const keyword = (kw === undefined || kw === null ? '' : String(kw)).trim();
    if (!keyword) return [];
    return this.searchPage(`query=${encodeURIComponent(keyword)}&page=${this.pageNumber(page)}`);
  }

  // The site's own "search by artist" opens the uploader's video list, which is
  // a keyword search on the name — the same url its artist cards point at.
  async searchAuthor(author, page) {
    const name = (author && (author.name || author)) || '';
    const keyword = String(name).trim();
    if (!keyword) return [];
    return this.searchPage(`query=${encodeURIComponent(keyword)}&page=${this.pageNumber(page)}`);
  }

  async searchPage(query) {
    const html = await this.page(`/search?${query}`);
    // Listings always carry the search form; the card classes differ per layout.
    if (!/id="hentai-form"/.test(html) && !/video-item-container|home-rows-videos-div/.test(html)) {
      throw new Error('網站回傳的頁面無法解析，可能已改版或需要驗證');
    }
    return this.cards(html);
  }

  // ---------- detail ----------

  async detail(url) {
    const id = this.videoId(url);
    const html = await this.page(`/watch?v=${id}`);
    const title = this.videoTitle(html, id);
    const artist = this.artistInfo(html);
    const tags = this.tagNames(html);

    const lines = [];
    if (artist.name) lines.push('作者：' + artist.name);
    const genre = this.genreName(html);
    if (genre) lines.push('類型：' + genre);
    const duration = parseInt(this.metaContent(html, 'og:video:duration'), 10);
    if (duration > 0) lines.push('片長：' + this.clock(duration));
    const stats = this.statsText(html);
    if (stats) lines.push(stats);
    const caption = this.captionText(html);
    if (caption) lines.push(caption);
    if (tags.length) lines.push('標籤：' + tags.join(' / '));

    const episodes = await this.episodes(html, id, title, lines);
    const authors = artist.name ? [{ name: artist.name, url: artist.url }] : [];
    return { title, cover: this.metaContent(html, 'og:image'), desc: lines.join('\n').trim(), authors, episodes };
  }

  videoTitle(html, id) {
    const heading = this.textOf((html.match(/<h3[^>]*id="shareBtn-title"[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]);
    if (heading) return heading;
    const meta = this.textOf(this.metaContent(html, 'og:title')).replace(/\s*-\s*Hanime1\.me\s*$/i, '');
    if (meta) return meta;
    const card = (html.match(new RegExp('<div[^>]*title="([^"]*)"[^>]*>[\\s\\S]{0,2000}?/watch\\?v=' + id)) || [])[1];
    if (card) return this.decodeEntities(card).trim();
    throw new Error('無法讀取影片標題，頁面可能已下架');
  }

  artistInfo(html) {
    const anchor = (html.match(/<a\b[^>]*id="video-artist-name"[^>]*>[\s\S]*?<\/a>/i) || [])[0];
    if (anchor) {
      const name = this.textOf(anchor);
      const href = this.attrValue(anchor, 'href');
      if (name) return { name, url: this.siteUrl(href) };
    }
    const avatar = (html.match(/<img\b[^>]*id="video-user-avatar"[^>]*>/i) || [])[0] || '';
    const name = this.attrValue(avatar, 'alt');
    return { name, url: name ? `${SITE}/search?query=${encodeURIComponent(name)}` : '' };
  }

  // The page prints the video's genre next to its uploader; the navigation bar
  // links to genres too, so the search starts from the uploader's anchor.
  genreName(html) {
    const source = String(html);
    const artist = source.search(/id="video-artist-name"/);
    if (artist < 0) return '';
    const window = source.slice(artist, artist + 1500);
    const match = window.match(/\/search\?genre=([^"&]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    return match ? this.textOf(match[2]) : '';
  }

  statsText(html) {
    const match = String(html).match(/觀看次數[：:]\s*([^<\n]{0,60})/);
    return match ? this.decodeEntities(match[0]).replace(/\s+/g, ' ').trim() : '';
  }

  captionText(html) {
    const match = html.match(/<div[^>]*class="[^"]*video-caption-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    return match ? this.textOf(match[1]) : '';
  }

  tagNames(html) {
    const names = [];
    const seen = new Set();
    const blocks = String(html).match(/<div[^>]*class="[^"]*single-video-tag[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];
    for (const block of blocks) {
      const name = this.textOf(block).replace(/^#\s*/, '').replace(/\s*\(\d+\)\s*$/, '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      names.push(name);
      if (names.length >= TAG_LIMIT) break;
    }
    return names;
  }

  clock(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }

  playlistOf(html) {
    const match = String(html).match(/\/playlist\?list=(\d+)/);
    if (!match) return null;
    const id = match[1];
    const anchor = String(html).match(new RegExp(`href="[^"]*\\/playlist\\?list=${id}[^"]*"[^>]*>([\\s\\S]{0,200}?)<\\/a>`, 'i'));
    return { id, title: this.textOf(anchor ? anchor[1] : '') };
  }

  playlistRows(html) {
    const source = String(html);
    let marker = /data-href="[^"]*\/watch\?v=(\d+)[^"]*"/gi;
    let found = [];
    let match;
    while ((match = marker.exec(source)) !== null) found.push({ index: match.index, id: match[1] });
    if (!found.length) {
      // Older layouts print the anchors without the row's data-href.
      marker = /href="[^"]*\/watch\?v=(\d+)[^"]*"[^>]*class="[^"]*"/gi;
      while ((match = marker.exec(source)) !== null) found.push({ index: match.index, id: match[1] });
    }

    const rows = [];
    const seen = new Set();
    for (let i = 0; i < found.length; i++) {
      const end = i + 1 < found.length ? found[i + 1].index : Math.min(source.length, found[i].index + 8000);
      const block = source.slice(found[i].index, end);
      const title =
        this.textOf((block.match(/<h4[^>]*class="[^"]*video-title[^"]*"[^>]*>([\s\S]*?)<\/h4>/i) || [])[1]) ||
        this.textOf((block.match(/<div[^>]*class="[^"]*video-title[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1]);
      const id = found[i].id;
      if (seen.has(id)) continue;
      seen.add(id);
      rows.push({ id, title: title || `影片 ${id}` });
    }
    return rows;
  }

  // A work is a playlist when the site groups the video with others. The page
  // states the expected size, so a partly read catalogue is reported rather
  // than silently truncated.
  async playlistItems(listId) {
    const items = [];
    const seen = new Set();
    let total = 0;
    for (let page = 1; page <= PLAYLIST_PAGE_LIMIT; page++) {
      const html = await this.page(`/playlist?list=${listId}&sort=latest${page > 1 ? `&page=${page}` : ''}`);
      if (page === 1) {
        const declared = html.match(/id="sidebar-video-count"[^>]*>\s*(\d+)/);
        total = declared ? parseInt(declared[1], 10) : 0;
      }
      const rows = this.playlistRows(html);
      if (!rows.length) break;
      for (const row of rows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        items.push(row);
      }
      if (total && items.length >= total) break;
    }
    if (!items.length) throw new Error('播放清單沒有可讀取的影片');
    if (total && items.length < total) {
      throw new Error(`播放清單只讀取到 ${items.length}/${total} 部影片，請稍後重試`);
    }
    return items;
  }

  async episodes(html, id, title, lines) {
    const playlist = this.playlistOf(html);
    if (playlist) {
      try {
        const items = await this.playlistItems(playlist.id);
        if (items.some((item) => item.id === id)) {
          return [
            {
              title: playlist.title || '播放清單',
              urls: items.map((item) => ({ name: item.title, url: `/watch?v=${item.id}&list=${playlist.id}` })),
            },
          ];
        }
      } catch (error) {
        lines.push('播放清單暫時無法讀取，先顯示本片：' + (error && error.message ? error.message : error));
      }
    }
    return [{ title: '影片', urls: [{ name: title, url: `/watch?v=${id}` }] }];
  }

  // ---------- playback ----------

  async watch(url) {
    const id = this.videoId(url);
    const html = await this.page(`/watch?v=${id}`);
    const sources = this.videoSources(html);
    if (!sources.length) {
      if (/需要\s*(?:登入|註冊)|僅限\s*(?:會員|Premium)|登入後/.test(html)) {
        throw new Error('此影片需要網站帳號才能播放');
      }
      throw new Error('這個頁面沒有可播放的影片來源，可能已下架或改為外嵌播放器');
    }
    const chosen = this.chooseQuality(sources, await this.preferredQuality());
    return { type: chosen.type, url: chosen.url };
  }

  // The player ships its qualities as <source size="720"> entries inside the
  // <video> block; the newest one is picked when the preference is missing.
  videoSources(html) {
    const source = String(html);
    const players = source.match(/<video\b[\s\S]*?<\/video>/gi) || [];
    const pool = players.length ? players : [source];

    const sources = [];
    const seen = new Set();
    const push = (url, type, size) => {
      const resolved = this.absolute(url);
      if (!resolved || seen.has(resolved)) return;
      const host = (resolved.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || '';
      if (!MEDIA_HOSTS.test(host.replace(/:\d+$/, ''))) return;
      seen.add(resolved);
      const hls = /\.m3u8(\?|$)/i.test(resolved) || /mpegurl/i.test(type || '');
      sources.push({ url: resolved, type: hls ? 'hls' : 'mp4', size: parseInt(size, 10) || 0 });
    };

    for (const block of pool) {
      for (const tag of block.match(/<source\b[^>]*>/gi) || []) {
        push(this.attrValue(tag, 'src'), this.attrValue(tag, 'type'), this.attrValue(tag, 'size'));
      }
      for (const tag of block.match(/<video\b[^>]*>/gi) || []) {
        push(this.attrValue(tag, 'src'), this.attrValue(tag, 'type'), '');
      }
    }
    return sources;
  }

  async preferredQuality() {
    try {
      const value = await this.getSetting('quality');
      const text = (value === undefined || value === null ? '' : String(value)).trim().toLowerCase();
      const match = text.match(/^(1080|720|480)\s*p?$/);
      return match ? `${match[1]}p` : 'auto';
    } catch (error) {
      return 'auto';
    }
  }

  chooseQuality(sources, preferred) {
    if (preferred && preferred !== 'auto') {
      const wanted = parseInt(preferred, 10);
      const exact = sources.find((source) => source.size === wanted);
      if (exact) return exact;
    }
    // auto: highest quality the page offers, mp4 ahead of hls on a tie.
    return sources
      .slice()
      .sort((a, b) => b.size - a.size || (a.type === 'mp4' ? 0 : 1) - (b.type === 'mp4' ? 0 : 1))[0];
  }

  // ---------- network ----------

  // Requests are serialised with a small gap and identical reads are merged,
  // which keeps a browse session to one request per page and stays polite to a
  // Cloudflare-fronted site. A blocked read (403/429) is retried once, then the
  // queue pauses and the user gets the routing hint below — the common cause is
  // the app running without its environment proxy, which the site answers with
  // the same Cloudflare page.
  async page(path, retried) {
    this.state();
    const cached = this._pages.get(path);
    if (cached && Date.now() - cached.time < PAGE_CACHE_MS) return cached.html;
    const running = this._inflight.get(path);
    if (running) return running;

    const task = this.fetchPage(path).then(
      (html) => {
        this._pages.set(path, { time: Date.now(), html });
        this._inflight.delete(path);
        return html;
      },
      (error) => {
        this._inflight.delete(path);
        if (!this.blocked(error)) throw error;
        if (retried) {
          // Still blocked: hold the queue back before the next read.
          this._cooldownUntil = Date.now() + COOLDOWN_MS;
          throw this.blockedError(error);
        }
        return this.wait(BLOCK_RETRY_MS).then(() => this.page(path, true));
      }
    );
    this._inflight.set(path, task);
    return task;
  }

  blocked(error) {
    return /HTTP (?:403|429)/.test(String(error && error.message));
  }

  blockedError(error) {
    const detail = String(error && error.message ? error.message : error).replace(/\s+/g, ' ').slice(0, 160);
    return new Error(
      '網站拒絕存取（HTTP 403，Cloudflare 攔截頁）。\n'
      + '聚閱只會從環境變數讀取代理：請設定 HTTPS_PROXY（例如 http://127.0.0.1:7890）後重新啟動本體；'
      + '代理工具的「系統代理」模式不會被本體讀取，Android / iOS 需要用 VPN 或透明代理接管全部流量。\n'
      + '已設定代理仍被攔時，請稍後重試或更換節點。\n'
      + '原始回應：' + detail
    );
  }

  async fetchPage(path) {
    const pace = () => {
      const now = Date.now();
      const wait = Math.max(
        this._lastRequest + PAGE_GAP_MS - now,
        this._cooldownUntil > now ? this._cooldownUntil - now : 0
      );
      return wait > 0 ? this.wait(wait) : Promise.resolve();
    };
    this._queue = this._queue.then(pace, pace).then(() => {
      this._lastRequest = Date.now();
    });
    await this._queue;

    const text = await this.request(SITE + path, { headers: { 'Accept-Language': 'zh-TW,zh;q=0.9' } });
    const html = typeof text === 'string' ? text : JSON.stringify(text);
    if (/Just a moment|cf-browser-verification|Cloudflare Ray ID/i.test(html) && html.length < 20000) {
      throw new Error('網站要求人機驗證，請稍後重試或更換網路');
    }
    return html;
  }

  // The runtime clamps a single sleep call, so longer pauses are split up.
  async wait(ms) {
    let remaining = ms;
    while (remaining > 0) {
      const slice = Math.min(remaining, 5000);
      await this.sleep(slice);
      remaining -= slice;
    }
  }
}
