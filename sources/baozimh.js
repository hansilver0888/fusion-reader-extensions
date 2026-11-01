// ==MiruExtension==
// @name         包子漫畫
// @version      v1.1.0
// @author       FusionReader
// @lang         zh-tw
// @license      MIT
// @package      baozimh
// @type         manga
// @icon         https://static-tw.baozimh.com/favicon.ico
// @webSite      https://www.twmanga.com
// @nsfw         false
// @network      auto
// ==/MiruExtension==
//
// The canonical domain (baozimh.com) guards itself with a proof of work gate:
// every page answers 403 {"challenge_url":"/__gatekeeper_challenge/start?..."}
// until the client solves sha256("gatekeeper-pow-v1:<id>:<nonce>") for a few
// leading zero bits and trades it for a __Host-gk_clearance_* cookie. Running
// that loop inside the plugin froze the app while it computed, so this source
// uses the operator's mirror domains instead: same site, same catalogue, no gate.
//
//   mirrors  : www.twmanga.com, cn.twmanga.com, www.webmota.com,
//              www.dinnerku.com, www.kukuc.co  — checked 2026-11-01, all answer
//              200 with the whole page in 0.2-1.2s and none is challenged, while
//              baozimh.com / cn.baozimh.com still hand out the challenge
//   listings : /list/new (single page), /classify?...&page=N (paged)
//   card     : div.comics-card > a.comics-card__poster[href][title] > amp-img[src]
//   detail   : /comic/<slug>, chapters link to
//              /user/page_direct?comic_id=<slug>&section_slot=<s>&chapter_slot=<n>
//   reader   : that link redirects to a reader page whose <amp-img src> elements
//              are the comic pages (https://s1.bzcdn.net/scomic/<slug>/<s>/<n>-<h>/<p>.jpg)
// The first mirror that answers becomes the entry for the session, and a mirror
// that starts failing is swapped out automatically.

const ENTRY_CANDIDATES = [
  'https://www.twmanga.com',
  'https://cn.twmanga.com',
  'https://www.webmota.com',
  'https://cn.webmota.com',
  'https://www.dinnerku.com',
  'https://www.kukuc.co',
];
const MIRROR_HOSTS = /^(?:[a-z0-9-]+\.)*(?:twmanga\.com|webmota\.com|dinnerku\.com|kukuc\.co)$/i;
// /list/new and /search ignore a page parameter (they are single pages), while
// /classify accepts &page=N on top of its filters — checked 2026-11-01.
const SECTIONS = [
  { title: '最近更新', path: '/list/new', paged: false },
  { title: '分類（全部）', path: '/classify?type=all&region=all&state=all&filter=%2a', paged: true },
  { title: '國漫', path: '/classify?type=all&region=cn&state=all&filter=%2a', paged: true },
  { title: '日漫', path: '/classify?type=all&region=jp&state=all&filter=%2a', paged: true },
  { title: '韓漫', path: '/classify?type=all&region=kr&state=all&filter=%2a', paged: true },
  { title: '連載中', path: '/classify?type=all&region=all&state=serial&filter=%2a', paged: true },
];
const PAGE_GAP_MS = 250;
const PAGE_CACHE_MS = 60000;

export default class extends Extension {
  state() {
    if (!this._pages) {
      this._pages = new Map();
      this._inflight = new Map();
      this._lastRequest = 0;
      this._queue = Promise.resolve();
      this._entry = '';
      this._entryPending = null;
    }
    return this;
  }

  async load() {
    this.state();
  }

  // ---------- helpers ----------

  absolute(url) {
    const value = (url || '').trim();
    if (!value) return '';
    if (value.startsWith('//')) return `https:${value}`;
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

  slug(path) {
    return (String(path).match(/\/comic\/([^/?#]+)/) || [])[1] || '';
  }

  coverFor(slug) {
    return slug ? `https://static-tw.baozimh.com/cover/${slug}.jpg?w=285&h=375&q=100` : '';
  }

  // ---------- entry ----------

  // The gate is on the canonical domain only, so the source runs on a mirror.
  // The first candidate that answers a listing becomes the entry for the
  // session; a mirror that starts failing is dropped from the try order.
  async entry() {
    this.state();
    if (this._entry) return this._entry;
    if (this._entryPending) return this._entryPending;

    this._entryPending = (async () => {
      const failures = [];
      for (const site of ENTRY_CANDIDATES) {
        try {
          const body = await this.requestText(site + '/list/new', {
            headers: { 'User-Agent': this.userAgent(), Accept: 'text/html,*/*' },
            allowErrorStatus: true,
          });
          // a challenged or blocked host answers with json or a short error page
          if (/challenge_required|__gatekeeper_challenge|Just a moment|Attention Required/i.test(body)) {
            failures.push(`${site} 需要驗證`);
            continue;
          }
          if (!/comics-card__poster|comics-card/i.test(body)) {
            failures.push(`${site} 不是預期的頁面`);
            continue;
          }
          this._entry = site;
          return site;
        } catch (error) {
          failures.push(`${site} ${String(error && error.message ? error.message : error).slice(0, 40)}`);
        }
      }
      throw new Error(`沒有可用的鏡像站點。\n${failures.join('\n')}`);
    })();

    try {
      return await this._entryPending;
    } finally {
      this._entryPending = null;
    }
  }

  currentSite() {
    return this._entry || ENTRY_CANDIDATES[0];
  }

  userAgent() {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
  }

  // A page request that swaps the mirror once if the current one fails. An
  // absolute url is reduced to its path so it always follows the live mirror.
  async pageBody(path) {
    const target = String(path || '').replace(/^https?:\/\/[^/]+/i, '') || '/';
    const site = await this.entry();
    const headers = { 'User-Agent': this.userAgent(), Accept: 'text/html,*/*', 'Accept-Language': 'zh-CN,zh;q=0.9' };
    try {
      return await this.requestText(site + target, { headers, allowErrorStatus: true });
    } catch (error) {
      this._entry = '';
      const retrySite = await this.entry();
      return this.requestText(retrySite + target, { headers, allowErrorStatus: true });
    }
  }

  // ---------- network ----------

  async page(path) {
    this.state();
    const cached = this._pages.get(path);
    if (cached && Date.now() - cached.time < PAGE_CACHE_MS) return cached.body;
    const running = this._inflight.get(path);
    if (running) return running;

    const task = this.pageBody(path).then(
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

  async requestText(url, options) {
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

  // ---------- channels / listings ----------

  // The key is the position in SECTIONS: the app matches it against every chip,
  // so it has to be a unique non-empty string (an undefined key makes all chips
  // look selected and every click fall back to the first feed).
  async channels() {
    return SECTIONS.map((section, index) => ({ title: section.title, key: String(index) }));
  }

  async latest(page, channel) {
    const number = this.pageNumber(page);
    const key = (channel === undefined || channel === null ? '' : String(channel)).trim();
    const index = /^\d+$/.test(key) ? parseInt(key, 10) : 0;
    const section = SECTIONS[index] || SECTIONS[0];
    // /list/new ignores ?page, the classify filters accept &page
    const query = section.paged && number > 1 ? `&page=${number}` : '';
    return this.cards(await this.page(`${section.path}${query}`));
  }

  async search(kw, page) {
    const keyword = (kw === undefined || kw === null ? '' : String(kw)).trim();
    if (!keyword) return [];
    // the search endpoint is a single page: a later page simply has nothing
    const number = this.pageNumber(page);
    if (number > 1) return [];
    return this.cards(await this.page(`/search?q=${encodeURIComponent(keyword)}`));
  }

  // <a href="/comic/<slug>" title="…" class="comics-card__poster …">
  //   <amp-img … src="https://static-tw.baozimh.com/cover/<slug>.jpg?…">
  // </a>
  // The attribute order is not stable, so the anchor is found by its class and
  // then read back to the opening tag.
  cards(html) {
    const source = String(html);
    const items = [];
    const seen = new Set();
    let cursor = 0;
    while (true) {
      const marker = source.indexOf('comics-card__poster', cursor);
      if (marker < 0) break;
      cursor = marker + 20;
      const open = source.lastIndexOf('<a', marker);
      if (open < 0) continue;
      const tagEnd = source.indexOf('>', marker);
      if (tagEnd < 0) continue;
      const tag = source.slice(open, tagEnd + 1);
      const href = this.attrValue(tag, 'href');
      const path = href.replace(/^https?:\/\/[^/]+/i, '');
      if (!/^\/comic\/[^/?#]+$/.test(path) || seen.has(path)) continue;
      const inner = source.slice(tagEnd + 1, source.indexOf('</a>', tagEnd) + 4);
      const image = inner.match(/<amp-img\b[^>]*>/i) || inner.match(/<img\b[^>]*>/i);
      const cover = image
        ? this.absolute(this.attrValue(image[0], 'src') || this.attrValue(image[0], 'data-src'))
        : this.coverFor(this.slug(path));
      const title = this.textOf(this.attrValue(tag, 'title') || this.attrValue(tag, 'aria-label'))
        || this.textOf((image ? this.attrValue(image[0], 'alt') : '') || '')
        || this.slug(path);
      if (!title && !cover) continue;
      seen.add(path);
      items.push({ title, url: path, cover, update: '' });
    }
    return items;
  }

  // ---------- detail ----------

  async detail(url) {
    const target = this.target(url);
    const html = await this.page(target.path);
    const title = this.textOf(this.meta(html, 'og:title')).replace(/\s*(?:漫畫)?\s*[-|]\s*包子漫(?:畫|画)\s*$/i, '').trim()
      || this.textOf((html.match(/<h1[^>]*>([\s\S]{0,160}?)<\/h1>/i) || [])[1] || '')
      || target.slug;
    const cover = this.absolute(this.meta(html, 'og:image'))
      || this.absolute((html.match(/https:\/\/static-tw\.baozimh\.com\/cover\/[^"?]+\?[^"']*/) || [])[0])
      || this.coverFor(target.slug);
    const desc = this.textOf(this.meta(html, 'description'));

    // Chapters link to /user/page_direct?comic_id=<slug>&section_slot=<s>&chapter_slot=<n>.
    // The page lists them newest first and the same chapter appears twice (once
    // per volume, comic_id ending in _xxxxxx), so collect by section/slot and
    // sort ascending: the app shows the list in the order it is handed over.
    const bySlot = new Map();
    const pattern = /<a\b[^>]*href="([^"]*\/user\/page_direct\?[^"]*)"[^>]*>([\s\S]{0,600}?)<\/a>/gi;
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const href = this.decodeEntities(match[1].replace(/&amp;/g, '&'));
      const slotMatch = href.match(/chapter_slot=(\d+)/);
      if (!slotMatch) continue;
      const section = (href.match(/section_slot=(\d+)/) || [])[1] || '0';
      const slot = parseInt(slotMatch[1], 10);
      const key = `${section}:${slot}`;
      const name = this.textOf(match[2]) || this.attrValue(match[0].slice(0, match[0].indexOf('>') + 1), 'title');
      const existing = bySlot.get(key);
      // prefer the entry that carries a readable title
      if (existing && existing.title && !name) continue;
      bySlot.set(key, {
        title: name || (existing ? existing.title : ''),
        url: href.startsWith('http') ? href : this.absolute(href),
        section: parseInt(section, 10),
        slot,
      });
    }

    const ordered = Array.from(bySlot.values()).sort((left, right) => (
      left.section - right.section || left.slot - right.slot
    ));
    if (!ordered.length) {
      throw new Error('這個作品沒有可閱讀的章節。');
    }
    // a chapter is { name, url }: the app reads `name`, a `title` key is ignored
    const chapters = ordered.map((chapter, index) => ({
      name: chapter.title || `第 ${index + 1} 話`,
      url: chapter.url,
    }));
    return {
      title,
      cover,
      desc,
      episodes: [{ title: '章節', urls: chapters }],
    };
  }

  target(url) {
    const text = (url === undefined || url === null ? '' : String(url)).trim();
    if (!text) throw new Error('無效的作品地址：' + text);
    if (/^https?:\/\//i.test(text)) {
      const host = (text.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || '';
      if (!MIRROR_HOSTS.test(host) && !/^(?:[a-z0-9-]+\.)*baozimh\.com$/i.test(host)) {
        throw new Error('無效的作品地址：' + text);
      }
    }
    const path = text.replace(/#.*$/, '').replace(/^https?:\/\/[^/]+/i, '').replace(/[?].*$/, '');
    const slug = this.slug(path);
    if (!slug) throw new Error('無法解析作品地址：' + text);
    return { path: `/comic/${slug}`, slug };
  }

  // A chapter link is either absolute (from the detail page) or a bare path; the
  // request layer takes paths, so keep only the path part here.
  chapterPath(url) {
    const text = (url === undefined || url === null ? '' : String(url)).trim();
    if (!text) throw new Error('無效的章節地址：' + text);
    const path = text.replace(/#.*$/, '').replace(/^https?:\/\/[^/]+/i, '');
    if (!path || path.indexOf('/') !== 0) throw new Error('無法解析章節地址：' + text);
    return path;
  }

  // ---------- watch ----------

  async watch(url) {
    const path = this.chapterPath(url);
    const html = await this.page(path);

    const images = [];
    const seen = new Set();
    const push = (value) => {
      const image = this.absolute(value);
      if (!image || seen.has(image)) return;
      if (!/\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(image)) return;
      seen.add(image);
      images.push(image);
    };

    // the reader page lists every comic page as an <amp-img src>
    for (const tag of html.match(/<amp-img\b[^>]*>/gi) || []) {
      const src = this.attrValue(tag, 'src');
      if (src && /\/scomic\//i.test(src)) push(src);
    }
    if (!images.length) {
      for (const match of html.matchAll(/https?:\/\/[^"'\s<>]*\/scomic\/[^"'\s<>]*\.(?:jpe?g|png|webp)/gi)) {
        push(match[0]);
      }
    }
    if (!images.length) {
      throw new Error('這一話沒有取到頁面圖片，站點可能改版或章節已下架。');
    }
    return {
      title: this.textOf((html.match(/<title>([\s\S]{0,120}?)<\/title>/i) || [])[1] || ''),
      urls: images,
    };
  }
}
