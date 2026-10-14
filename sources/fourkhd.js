// ==MiruExtension==
// @name         4KHD 圖集
// @version      v1.0.0
// @author       FusionReader
// @lang         all
// @license      MIT
// @package      fourkhd
// @type         manga
// @icon         https://usti.uuss.uk/wp-content/uploads/2023/02/4khd-1-150x150.png
// @webSite      https://usti.uuss.uk
// @nsfw         true
// @network      auto
// ==/MiruExtension==
//
// The site is a WordPress installation (the canonical host prints itself as
// www.4khd.com, the mirror above serves the same paths). Two read-only
// surfaces are used:
//   * the site's own query-loop pages (/pages/album, /pages/popular,
//     /pages/cosplay) for the curated listings, 12 items per page with
//     `?query-3-page=N`, and /search/<keyword>/page/N for search;
//   * the public REST api for category listings and for a work's content,
//     which returns the gallery images and keeps `<!--nextpage-->` markers, so
//     a multi part work becomes a multi episode catalogue from one read.
//
// `/wp-json/...` is rate limited by nginx and rejects the `_fields` parameter
// with 403, so listings stay on the html pages and the api is only asked for
// single works. Links printed by the pages point at the canonical host; they
// are moved back to the entry point above so browsing works even when the
// canonical host is unreachable.
//
// Images are served by i0.wp.com (a Jetpack/Photon resizer in front of
// pic.4khd.com). They answer without a referer, and asking for a larger `w`
// than the site uses is rate limited with 429, so urls are used exactly as the
// content prints them.

const SITE = 'https://usti.uuss.uk';
const ORIGIN_HOSTS = /^(?:www\.|m\.)?4khd\.com$/i;

// Curated listing pages, in the order the app shows them.
const LISTING_PAGES = [
  { title: '最新', path: '/pages/album' },
  { title: '熱門', path: '/pages/popular' },
  { title: 'Cosplay 精選', path: '/pages/cosplay' },
];
const DEFAULT_PAGE = '/pages/album';

// Used when the category list cannot be read; ids come from the site's own
// /wp-json/wp/v2/categories.
const FALLBACK_CATEGORIES = [
  { id: 3, name: 'photo', count: 0 },
  { id: 4, name: 'cosplay', count: 0 },
  { id: 9, name: 'miscellaneous', count: 0 },
  { id: 26, name: 'bare', count: 0 },
  { id: 21, name: 'popular', count: 0 },
];

const PER_PAGE = 20;
const PAGE_GAP_MS = 300;
const PAGE_CACHE_MS = 30000;
const COOLDOWN_MS = 20000;
const BLOCK_RETRY_MS = 2500;
// Work urls look like /content/05/<slug>.html[/<part>]; slugs are ascii or
// percent encoded (the site publishes Chinese titles that way).
const POST_PATTERN = /\/content\/\d+\/([^/?#]+?)(?:\.html)?(?:\/(\d+))?(?:[?#].*)?$/;

export default class extends Extension {
  state() {
    if (!this._pages) {
      this._pages = new Map();
      this._inflight = new Map();
      this._lastRequest = 0;
      this._cooldownUntil = 0;
      this._queue = Promise.resolve();
      this._categories = null;
    }
    return this;
  }

  async load() {
    this.state();
  }

  // ---------- url helpers ----------

  // Accept the site's own work urls, with or without the part suffix. The
  // canonical host is accepted too, since the site prints its own links.
  postTarget(url) {
    const text = (url === undefined || url === null ? '' : String(url)).trim();
    if (!text) throw new Error('無效的作品地址：' + text);
    if (/^https?:\/\//i.test(text)) {
      const host = (text.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || '';
      const entry = SITE.replace(/^https?:\/\//i, '');
      if (!ORIGIN_HOSTS.test(host) && host.toLowerCase() !== entry.toLowerCase()) {
        throw new Error('無效的作品地址：' + text);
      }
    }
    const path = text.replace(/^https?:\/\/[^/]+/i, '').replace(/[?#].*$/, '');
    const match = path.match(POST_PATTERN);
    if (!match) throw new Error('無法解析作品地址：' + text);
    const part = match[2] ? parseInt(match[2], 10) : 1;
    return { slug: match[1], path: path.replace(/\/\d+\/?$/, ''), part: part > 0 ? part : 1 };
  }

  absolute(url) {
    const value = (url || '').trim();
    if (!value) return '';
    const resolved = /^https?:\/\//i.test(value) ? value : this.absoluteUrl(SITE, value);
    return /^https?:\/\//i.test(resolved) ? resolved : '';
  }

  // Site pages print the canonical host; requests go to the entry point.
  siteUrl(url) {
    const resolved = this.absolute(url);
    if (!resolved) return '';
    return resolved.replace(/^(https?):\/\/(?:www\.|m\.)?4khd\.com/i, SITE);
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
        .replace(/<\/\s*(?:p|div|h[1-6]|li|tr|span|a|figure)\s*>/gi, '\n')
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

  // ---------- channels ----------

  async channels() {
    const channels = LISTING_PAGES.map((page) => ({ title: page.title, key: 'page=' + page.path }));
    for (const category of await this.categories()) {
      const suffix = category.count ? `（${category.count}）` : '';
      channels.push({ title: '分類：' + category.name + suffix, key: 'category=' + category.id });
    }
    return channels;
  }

  // The category list is small and rarely changes; a failed read falls back to
  // the ids this plugin shipped with instead of leaving the user without
  // categories.
  async categories() {
    this.state();
    if (this._categories) return this._categories;
    try {
      const payload = await this.api('/wp-json/wp/v2/categories?per_page=100&orderby=count&order=desc');
      const usable = [];
      for (const entry of Array.isArray(payload) ? payload : []) {
        if (!entry || !entry.id || !(entry.count > 0)) continue;
        usable.push({ id: entry.id, name: String(entry.name || entry.slug || entry.id), count: parseInt(entry.count, 10) || 0 });
      }
      if (usable.length) {
        this._categories = usable;
        return usable;
      }
    } catch (error) {
      // fall through to the shipped list
    }
    this._categories = FALLBACK_CATEGORIES.map((category) => ({
      id: category.id,
      name: category.name,
      count: category.count,
    }));
    return this._categories;
  }

  async listingPaths() {
    return LISTING_PAGES.map((page) => page.path);
  }

  async latest(page, channel) {
    const number = this.pageNumber(page);
    const key = (channel === undefined || channel === null ? '' : String(channel)).trim();
    if (!key) return this.listing(DEFAULT_PAGE, number);
    if (key.startsWith('category=')) {
      const id = key.slice('category='.length).trim();
      if (!/^\d+$/.test(id)) throw new Error('未知的分類：' + key);
      return this.categoryPosts(id, number);
    }
    if (key.startsWith('page=')) {
      const path = key.slice('page='.length).trim();
      if ((await this.listingPaths()).indexOf(path) < 0) throw new Error('未知的分類：' + key);
      return this.listing(path, number);
    }
    throw new Error('未知的分類：' + key);
  }

  async search(kw, page) {
    const keyword = (kw === undefined || kw === null ? '' : String(kw)).trim();
    if (!keyword) return [];
    const number = this.pageNumber(page);
    const path = `/search/${encodeURIComponent(keyword)}${number > 1 ? `/page/${number}` : ''}`;
    const html = await this.page(path);
    this.assertListing(html);
    return this.cards(html);
  }

  async searchAuthor(author, page) {
    const name = (author && (author.name || author)) || '';
    return this.search(name, page);
  }

  // ---------- listings ----------

  async listing(path, page) {
    this.state();
    const html = await this.page(`${path}${page > 1 ? `?query-3-page=${page}` : ''}`);
    this.assertListing(html);
    return this.cards(html);
  }

  async categoryPosts(id, page) {
    const path = `/wp-json/wp/v2/posts?per_page=${PER_PAGE}&page=${page}&categories=${encodeURIComponent(id)}`;
    try {
      return this.items(await this.api(path));
    } catch (error) {
      // The api answers 400 once the page number passes the last page.
      if (/rest_post_invalid_page_number|HTTP 400/.test(String(error && error.message))) return [];
      throw error;
    }
  }

  // The listing pages all share one query-loop template.
  assertListing(html) {
    if (!/wp-block-post-template|wp-block-post post-|wp-block-post-title/.test(String(html))) {
      throw new Error('網站回傳的頁面無法解析，可能已改版或需要驗證');
    }
  }

  cards(html) {
    const source = String(html);
    const marker = /<li[^>]*class="[^"]*\bwp-block-post\b[^"]*\bpost-(\d+)\b[^"]*"[^>]*>/gi;
    const starts = [];
    let match;
    while ((match = marker.exec(source)) !== null) starts.push({ index: match.index, id: match[1] });

    const items = [];
    const seen = new Set();
    for (let i = 0; i < starts.length; i++) {
      const end = i + 1 < starts.length ? starts[i + 1].index : Math.min(source.length, starts[i].index + 12000);
      const item = this.card(source.slice(starts[i].index, end));
      if (!item || seen.has(item.url)) continue;
      seen.add(item.url);
      items.push(item);
    }
    return items;
  }

  card(block) {
    const titleBlock = block.match(/<h2[^>]*wp-block-post-title[^>]*>([\s\S]*?)<\/h2>/i);
    const title = this.textOf(titleBlock ? titleBlock[1] : '');
    if (!title) return null;

    // Every anchor on a card points at the work (thumbnail, title); share and
    // ad links are skipped by requiring the site's work path.
    let href = '';
    for (const anchor of block.match(/<a\b[^>]*>/gi) || []) {
      const candidate = this.attrValue(anchor, 'href');
      if (candidate && POST_PATTERN.test(candidate.replace(/^https?:\/\/[^/]+/i, ''))) {
        href = candidate;
        break;
      }
    }
    if (!href) return null;
    const url = this.siteUrl(href);
    if (!url) return null;

    const image = block.match(/<img\b[^>]*>/i);
    const cover = image ? this.absolute(this.attrValue(image[0], 'src') || this.attrValue(image[0], 'data-src')) : '';
    const date = this.attrValue((block.match(/<time\b[^>]*>/i) || [''])[0], 'datetime');
    const views = this.textOf((block.match(/class="[^"]*eyeicon[^"]*"[^>]*>\s*<\/div>\s*([\d,]+)/i) || [])[1]);

    return { title, url: url.replace(/^https?:\/\/[^/]+/i, ''), cover, update: this.updateLabel(date, views) };
  }

  updateLabel(date, views) {
    const parts = [];
    const stamp = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (stamp) parts.push(`${stamp[2]}/${stamp[3]}`);
    const count = String(views || '').replace(/[^\d]/g, '');
    if (count) parts.push(`${count} 次`);
    return parts.join(' · ');
  }

  // ---------- rest ----------

  items(payload) {
    const list = Array.isArray(payload) ? payload : [];
    const items = [];
    const seen = new Set();
    for (const post of list) {
      if (!post || !post.link) continue;
      const url = this.siteUrl(post.link);
      if (!url) continue;
      const path = url.replace(/^https?:\/\/[^/]+/i, '');
      if (!POST_PATTERN.test(path) || seen.has(path)) continue;
      const content = post.content && post.content.rendered ? String(post.content.rendered) : '';
      const image = content.match(/<img\b[^>]*>/i);
      seen.add(path);
      items.push({
        title: this.textOf(post.title && post.title.rendered ? post.title.rendered : path),
        url: path,
        cover: this.absolute(post.jetpack_featured_media_url || (image ? this.attrValue(image[0], 'src') : '')),
        update: this.updateLabel(post.date, post.views),
      });
    }
    return items;
  }

  async api(path) {
    const text = await this.page(path);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error('網站回傳的內容不是有效的 JSON，可能已改版或需要驗證');
    }
  }

  async post(slug) {
    const payload = await this.api(`/wp-json/wp/v2/posts?slug=${encodeURIComponent(this.slugParam(slug))}`);
    const list = Array.isArray(payload) ? payload.filter((post) => post && post.id) : [];
    if (!list.length) throw new Error('找不到這部作品，可能已刪除：' + slug);
    return list[0];
  }

  // Slugs arrive percent encoded when the site published a non ascii title;
  // the api matches the decoded slug.
  slugParam(slug) {
    const text = String(slug || '');
    try {
      return decodeURIComponent(text);
    } catch (error) {
      return text;
    }
  }

  // A work may be split into pages by `<!--nextpage-->`; the api keeps those
  // markers and returns every part, so the catalogue comes from one read.
  splitParts(html) {
    const source = String(html || '');
    const parts = [];
    for (const segment of source.split(/<!--\s*nextpage\s*-->/i)) {
      const images = [];
      const seen = new Set();
      const tags = segment.match(/<img\b[^>]*>/gi) || [];
      for (const tag of tags) {
        const raw = this.attrValue(tag, 'data-src') || this.attrValue(tag, 'src');
        if (!raw || /^data:/i.test(raw)) continue;
        const url = this.absolute(raw);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        images.push(url);
      }
      if (images.length) parts.push(images);
    }
    return parts;
  }

  // ---------- detail and reading ----------

  async detail(url) {
    const target = this.postTarget(url);
    const post = await this.post(target.slug);
    const html = post.content && post.content.rendered ? String(post.content.rendered) : '';
    const parts = this.splitParts(html);
    const photos = parts.reduce((total, part) => total + part.length, 0);
    if (!photos) throw new Error('這部作品沒有可讀取的圖片，可能已下架');

    const lines = [];
    lines.push(`發佈：${this.updateLabel(post.date, post.views) || '未知'}`);
    lines.push(`圖片：共 ${photos} 張${parts.length > 1 ? `，分 ${parts.length} 部` : ''}`);
    const categoryNames = await this.categoryNames(post.categories);
    if (categoryNames.length) lines.push('分類：' + categoryNames.join(' / '));
    const excerpt = this.textOf(post.excerpt && post.excerpt.rendered ? post.excerpt.rendered : '');
    if (excerpt) lines.push(excerpt);

    const first = parts[0] || [];
    const cover = this.absolute(post.jetpack_featured_media_url || first[0] || '');
    const urls = parts.map((part, index) => ({
      name: parts.length > 1 ? `第 ${index + 1} 部（${part.length} 張）` : `全 ${part.length} 張`,
      url: index === 0 ? target.path : `${target.path}/${index + 1}`,
    }));

    return { title: this.textOf(post.title && post.title.rendered ? post.title.rendered : target.slug), cover, desc: lines.join('\n'), episodes: [{ title: '圖片', urls }] };
  }

  async watch(url) {
    const target = this.postTarget(url);
    const post = await this.post(target.slug);
    const parts = this.splitParts(post.content && post.content.rendered ? String(post.content.rendered) : '');
    if (!parts.length) throw new Error('這部作品沒有可讀取的圖片，可能已下架');
    const index = Math.min(target.part, parts.length) - 1;
    return { urls: parts[index] };
  }

  async categoryNames(ids) {
    const wanted = Array.isArray(ids) ? ids.map((id) => parseInt(id, 10)).filter((id) => id > 0) : [];
    if (!wanted.length) return [];
    const known = await this.categories();
    const names = [];
    for (const id of wanted) {
      const match = known.find((category) => Number(category.id) === id);
      names.push(match ? match.name : String(id));
    }
    return names;
  }

  // ---------- network ----------

  // Reads are serialised with a small gap, identical reads are merged and
  // pages are cached briefly. The site's nginx rate limits `/wp-json` bursts,
  // so a blocked read is retried once before the user is told to wait.
  async page(path, retried) {
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
        if (!this.blocked(error)) throw error;
        if (retried) {
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
    const detail = String(error && error.message ? error.message : error).replace(/\s+/g, ' ').slice(0, 120);
    return new Error(
      '網站暫時拒絕存取（HTTP 403 / 429）。\n'
      + '這是站點的頻率限制，稍等 20 秒再試即可；短時間內連續翻頁或重複點開作品容易觸發。\n'
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

    const text = await this.request(SITE + path, {
      headers: { 'Accept-Language': 'zh-TW,zh;q=0.9', Accept: '*/*' },
    });
    return typeof text === 'string' ? text : JSON.stringify(text);
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
