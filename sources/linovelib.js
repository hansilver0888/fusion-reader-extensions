// ==MiruExtension==
// @name         哔哩轻小说
// @version      v1.3.1
// @author       FusionReader
// @lang         zh-cn
// @license      MIT
// @package      linovelib
// @type         fikushon
// @icon         https://www.linovelib.com/images/favicon.ico
// @webSite      https://www.bilinovel.net
// @nsfw         false
// @network      auto
// @comments     chapter
// ==/MiruExtension==
//
// Complete chapters require a mobile browser session and the site's scripts.
// A mobile UA alone receives a short preview. Render pages before parsing them,
// and follow numbered sub-pages without crossing into the next chapter.

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const INCOMPLETE_BODY = /內容加載失敗|内容加载失败|更換瀏覽器|更换浏览器/;

export default class extends Extension {
  _requestQueue = Promise.resolve();
  _inflight = new Map();
  _commentCache = new Map();
  _nextRequestAt = 0;

  // Reading, caching, catalog loading and comments share one polite queue.
  // This also works on older hosts, without changing their HTTP bridge.
  async request(url, options = {}) {
    const key = JSON.stringify([this.mobileUrl(url), options.method || 'get', options.data || '',
      !!options.browser, options.headers || {}]);
    const comments = /\/comment\/php\/api\.php\?action=get_list/.test(url);
    const cached = comments && this._commentCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (this._inflight.has(key)) return this._inflight.get(key);

    const pending = this._requestQueue.then(async () => {
      const delay = this._nextRequestAt - Date.now();
      if (delay > 0) await this.sleep(delay);
      try {
        let response;
        try {
          response = await super.request(url, options);
        } catch (error) {
          if (!/\b403\b/.test(String(error))) throw error;
          if (options.retry === false) throw error;
          await this.sleep(6000);
          response = await super.request(url, options);
        }
        if (comments) {
          this._commentCache.set(key, { value: response, expires: Date.now() + 15000 });
          if (this._commentCache.size > 40) this._commentCache.delete(this._commentCache.keys().next().value);
        }
        return response;
      } catch (error) {
        if (/\b(?:403|429)\b/.test(String(error))) {
          this._nextRequestAt = Date.now() + 30000;
          throw new Error('站点暂时限制访问，请等待约 30 秒再试；已缓存章节可正常阅读。' + String(error));
        }
        throw error;
      } finally {
        this._nextRequestAt = Math.max(this._nextRequestAt, Date.now() + 1500);
      }
    });
    this._requestQueue = pending.catch(() => {});
    this._inflight.set(key, pending);
    try {
      return await pending;
    } finally {
      this._inflight.delete(key);
    }
  }

  mobileUrl(path) {
    // Existing shelf/history entries may still refer to the desktop domain.
    return this.absoluteUrl(this.webSite + '/', path.replace(
      /^https?:\/\/(?:www\.|tw\.|m\.)?(?:linovelib\.com|bilinovel\.com|bilinovel\.net)(?=\/|$)/i,
      this.webSite
    ));
  }

  async get(path, referer, browser = false) {
    return this.request(this.mobileUrl(path), {
      browser,
      browserSelector: '#acontent',
      browserRejectPattern: INCOMPLETE_BODY.source,
      headers: {
        'User-Agent': MOBILE_UA,
        Referer: referer ? this.mobileUrl(referer) : `${this.webSite}/`,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
  }

  async parseNovelLinks(html) {
    const links = await this.querySelectorAll(html, 'a[href*="/novel/"]');
    const out = [];
    const seen = new Set();
    for (const link of links) {
      const href = await link.getAttributeText('href');
      const m = href && href.match(/\/novel\/(\d+)\.html$/);
      if (!m || seen.has(m[1])) continue;
      const content = await link.content;
      let title = await this.getAttributeText(content, 'img', 'alt');
      if (!title) title = (await link.text).trim();
      if (!title) continue;
      let cover = await this.getAttributeText(content, 'img', 'data-src');
      if (!cover) cover = await this.getAttributeText(content, 'img', 'src');
      seen.add(m[1]);
      out.push({
        title,
        url: `/novel/${m[1]}.html`,
        cover: cover && cover.startsWith('http') ? cover : '',
      });
    }
    return out;
  }

  async latest(page) {
    const html = await this.get(`/top/lastupdate/${page}.html`);
    const items = await this.parseNovelLinks(html);
    if (items.length) return items;
    // Fall back to the home page when the ranking path moves.
    return this.parseNovelLinks(await this.get('/'));
  }

  // The site's own search endpoint is behind a script-computed guard cookie:
  // requests without it are 301'd to https://127.0.0.1/ or answered with 403.
  // Try it anyway in case the guard is satisfied, then fall back to matching
  // titles across the ranking pages. The fallback only sees ranked titles, so
  // it finds popular works rather than the whole catalogue.
  async search(kw, page) {
    try {
      const html = await this.request('/S6/', {
        method: 'post',
        headers: {
          'User-Agent': MOBILE_UA,
          Referer: `${this.webSite}/`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        data: `searchkey=${encodeURIComponent(kw)}&page=${page}`,
        allowErrorStatus: true,
      });
      const direct = await this.parseNovelLinks(html);
      if (direct.length) return direct;
    } catch (e) {
      // Guard rejected us; fall through to the local scan.
    }

    if (page > 1) return [];
    const pool = [];
    const seen = new Set();
    const sources = ['/', '/top/lastupdate/1.html', '/top/monthvisit/1.html', '/top/weekvisit/1.html'];
    for (const path of sources) {
      let items = [];
      try {
        items = await this.parseNovelLinks(await this.get(path));
      } catch (e) {
        continue;
      }
      for (const item of items) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        pool.push(item);
      }
    }
    const needle = kw.trim().toLowerCase();
    return pool.filter((item) => item.title.toLowerCase().includes(needle));
  }

  novelId(url) {
    const m = url.match(/\/novel\/(\d+)/);
    return m ? m[1] : '';
  }

  async searchAuthor(author, page) {
    // The author catalogue is separate from guarded/title-only keyword search.
    if (page > 1) return [];
    const path = author.url || `/authorarticle/${encodeURIComponent(author.name)}.html`;
    const html = await this.get(path);
    const container = await this.querySelector(html, '.book-ol');
    // Limit parsing to the author list; the site's search popup lists unrelated books.
    const content = await container.content;
    if (!content) throw new Error('作者作品列表加载失败，请稍后重试');
    return this.parseNovelLinks(content);
  }

  async detail(url) {
    const id = this.novelId(url);
    const html = await this.get(`/novel/${id}.html`);

    const title =
      (await this.getAttributeText(html, 'meta[property="og:title"]', 'content')) || '';
    const cover =
      (await this.getAttributeText(html, 'meta[property="og:image"]', 'content')) || '';
    const desc =
      (await this.getAttributeText(html, 'meta[property="og:description"]', 'content')) || '';
    const author =
      (await this.getAttributeText(html, 'meta[property="og:novel:author"]', 'content')) || '';
    const authorUrl =
      (await this.getAttributeText(html, 'meta[property="og:novel:author_link"]', 'content')) || '';

    const catalog = await this.get(`/novel/${id}/catalog`, `${this.webSite}/novel/${id}.html`);
    const links = await this.querySelectorAll(catalog, 'li.chapter-li a.chapter-li-a');
    const chapters = [];
    const seen = new Set();
    for (const link of links) {
      const href = await link.getAttributeText('href');
      // vol_*.html entries are volume anchors, not readable chapters.
      if (!href || /vol_\d+\.html/.test(href) || seen.has(href)) continue;
      const name = (await link.text).trim();
      if (!name) continue;
      seen.add(href);
      chapters.push({ name, url: href });
    }

    return {
      title,
      cover,
      desc,
      authors: author ? [{ name: author, url: authorUrl }] : [],
      episodes: [{ title: '章節', urls: chapters }],
    };
  }

  async comments(workUrl, chapterUrl, page) {
    // Every numbered sub-page belongs to the same chapter comment thread.
    const chapter = chapterUrl.match(/\/novel\/(\d+)\/(\d+)(?:_\d+)?\.html(?:[?#].*)?$/);
    if (!chapter || chapter[1] !== this.novelId(workUrl)) throw new Error('无效的章节地址');
    const referer = this.mobileUrl(`/novel/${chapter[1]}/${chapter[2]}.html`);
    const response = await this.request('/comment/php/api.php?action=get_list', {
      method: 'post',
      headers: {
        'User-Agent': MOBILE_UA,
        Referer: referer,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      data: `catid=${chapter[1]}&cmtid=${chapter[2]}&pageIndex=${page}&pageSize=20&query=all`,
    });
    const body = typeof response === 'string' ? JSON.parse(response) : response;
    if (body.err_msg !== 'success' || !Array.isArray(body.data) ||
        String(body.cmtid) !== chapter[2] || String(body.catid) !== chapter[1]) {
      throw new Error('站点未返回本章评论，请稍后重试');
    }
    return {
      comments: body.data.map((comment) => {
        const blocks = this.htmlToBlocks(comment.saytext || '', referer);
        return {
          id: String(comment.plid),
          username: comment.plusername || '匿名读者',
          text: blocks.filter((block) => typeof block === 'string').join('\n'),
          images: blocks.filter((block) => block.type === 'image').map((block) => block.url),
          time: comment.formattime || '',
          likes: Number(comment.zcnum) || 0,
          spoiler: Number(comment.ispoiler) === 1,
        };
      }),
      hasMore: Number(body.hasmore) === 1 || page < Number(body.pageTotal),
      total: Number(body.total) || 0,
      headers: { Referer: referer, 'User-Agent': MOBILE_UA },
    };
  }

  // Pull text and illustrations out of the chapter body in document order.
  // The container id has changed across site revisions, so try the known ones
  // and prefer whichever yields the most content.
  async extractBlocks(html, into, pageUrl) {
    const selectors = ['#acontent', '#TextContent', '.read-content', '#content', '.acontent'];
    let best = [];
    for (const selector of selectors) {
      const container = await this.querySelector(html, selector);
      if (!container) continue;
      const blocks = this.htmlToBlocks(await container.content, pageUrl);
      if (blocks.length > best.length) best = blocks;
    }
    if (best.length) {
      into.push(...best);
      return;
    }
    // Nothing matched: fall back to bare paragraphs so text at least renders.
    const paras = await this.querySelectorAll(html, 'p');
    for (const p of paras) {
      const text = (await p.text).trim();
      if (text) into.push(text);
    }
  }

  async watch(url) {
    const id = this.novelId(url);
    const catalogUrl = `${this.webSite}/novel/${id}/catalog`;
    const content = [];

    let current = this.mobileUrl(url);
    let referer = catalogUrl;
    let subtitle = '';
    // Chapters continue onto "<chapter>_<n>.html" pages; follow them until the
    // next link leaves this chapter.
    const visited = new Set();
    const chapterOf = (u) => {
      const m = u.match(/\/novel\/(\d+)\/(\d+)(?:_\d+)?\.html(?:[?#].*)?$/);
      return m ? `${m[1]}/${m[2]}` : '';
    };
    const chapter = chapterOf(current);
    if (!chapter) throw new Error('无效的章节地址');
    for (let i = 0; i < 30; i++) {
      if (visited.has(current)) throw new Error('站点分页出现循环，未能加载完整章节');
      visited.add(current);
      // The site rate-limits bursts (HTTP 429), and one chapter can span many
      // sub-pages, so pace the walk instead of firing them back to back.
      if (i > 0) await this.sleep(700);

      const html = await this.get(current, referer, true);
      if (!subtitle) {
        const titleEl = await this.querySelector(html, '#atitle');
        if (titleEl) subtitle = (await titleEl.text).trim();
      }
      const pageBlocks = [];
      await this.extractBlocks(html, pageBlocks, current);
      if (!pageBlocks.length || pageBlocks.some(
        (block) => typeof block === 'string' && INCOMPLETE_BODY.test(block)
      )) {
        // Never cache a preview as if it were a complete, offline-ready chapter.
        throw new Error('站点仍未加载完整正文，请稍后重试');
      }
      content.push(...pageBlocks);

      const match = html.match(/\burl_next\s*:\s*['"]([^'"]+)['"]/);
      if (!match) break;
      const next = this.mobileUrl(match[1]);
      if (chapterOf(next) !== chapter) break;
      if (i === 29) throw new Error('本章分页过多，未能加载完整章节');
      referer = current;
      current = next;
    }

    return {
      content,
      subtitle,
      // Illustrations, when a chapter does carry them, are hotlink-protected.
      headers: { Referer: this.mobileUrl(url), 'User-Agent': MOBILE_UA },
    };
  }
}
