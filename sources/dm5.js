// ==MiruExtension==
// @name         动漫屋
// @version      v1.0.0
// @author       Community adaptation
// @lang         zh
// @license      MIT
// @package      dm5
// @type         manga
// @webSite      https://www.dm5.com
// @network      auto
// @nsfw         false
// ==/MiruExtension==
// Protocol reference: Aidoku-Community/sources, zh.dm5
// Shared adaptation: tools/dm-family-runtime.js (data-only image decoding).
// Source and standalone bundles are distributed with the upstream MIT notice below.

const DM_SITE = {"kind":"dm5","name":"动漫屋","base":"https://www.dm5.com","hosts":["www.dm5.com","www.dm5.cn","m.dm5.com"],"ua":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"};

// Shared data-only adapter. See tools/update_dm_family.mjs for standalone bundles.
// Website response scripts are parsed as strings; they are never evaluated.
function readLiteral(input, start) {
  let i = start;
  while (/\s/.test(input[i] || '') && i < input.length) i += 1;
  const quote = input[i++];
  if (quote !== "'" && quote !== '"') throw new Error('無效的圖片字串');
  let value = '';
  while (i < input.length) {
    let c = input[i++];
    if (c === quote) return { value, end: i };
    if (c !== '\\') { value += c; continue; }
    c = input[i++];
    const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
    if (c === 'x' || c === 'u') {
      const size = c === 'x' ? 2 : 4;
      const hex = input.slice(i, i + size);
      if (!new RegExp('^[0-9a-fA-F]{' + size + '}$').test(hex)) throw new Error('無效的圖片轉義字元');
      value += String.fromCharCode(parseInt(hex, 16)); i += size;
    } else if (c === '\n') {
      // JavaScript string continuation.
    } else if (c === '\r') {
      if (input[i] === '\n') i += 1;
    } else {
      value += Object.prototype.hasOwnProperty.call(simple, c) ? simple[c] : c;
    }
  }
  throw new Error('圖片字串未結束');
}

function unpackImageScript(input) {
  let text = String(input || '');
  if (!text || text.length > 1024 * 1024) throw new Error('圖片回應為空或過大');
  for (let depth = 0; depth < 3 && /^\s*eval\s*\(/.test(text); depth += 1) {
    const call = /\}\s*\(\s*['"]/g;
    let match, decoded = null;
    while ((match = call.exec(text)) !== null) {
      try {
        const at = text.indexOf('(', match.index) + 1;
        const payload = readLiteral(text, at);
        const tail = text.slice(payload.end);
        const numbers = tail.match(/^\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*/);
        if (!numbers) continue;
        const radix = Number(numbers[1]), count = Number(numbers[2]);
        if (radix < 2 || radix > 62 || count > 50000) continue;
        const dict = readLiteral(text, payload.end + numbers[0].length);
        if (!/^\s*\.split\(\s*['"]\|['"]\s*\)/.test(text.slice(dict.end))) continue;
        const words = dict.value.split('|');
        const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        decoded = payload.value.replace(/\b[0-9A-Za-z]+\b/g, (word) => {
          let n = 0;
          for (const c of word) {
            const digit = alphabet.indexOf(c);
            if (digit < 0 || digit >= radix) return word;
            n = n * radix + digit;
            if (n >= count) return word;
          }
          return words[n] || word;
        });
        break;
      } catch (_) { /* Not a packer argument list. */ }
    }
    if (decoded === null) throw new Error('圖片壓縮資料無法解析');
    text = decoded;
  }
  if (/^\s*eval\s*\(/.test(text)) throw new Error('圖片資料巢狀層數過多');
  return text;
}

function imageUrlsFromScript(input) {
  const code = unpackImageScript(input);
  const values = {};
  const assignments = /\bvar\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let match;
  while ((match = assignments.exec(code)) !== null) {
    const start = assignments.lastIndex, c = code[start];
    try {
      if (c === "'" || c === '"') {
        values[match[1]] = readLiteral(code, start).value;
      } else if (c === '[') {
        const items = []; let i = start + 1;
        for (; i < code.length;) {
          while (i < code.length && /[\s,]/.test(code[i])) i += 1;
          if (code[i] === ']') break;
          const item = readLiteral(code, i); items.push(item.value); i = item.end;
          if (items.length > 2000) throw new Error('圖片數量過多');
        }
        if (code[i] === ']') values[match[1]] = items;
      }
    } catch (_) { /* Only literal strings/arrays are accepted. */ }
  }
  const list = values.pvalue || values.d;
  if (!Array.isArray(list) || !list.length) throw new Error('站點未返回圖片清單');
  let suffix = '';
  const suffixAt = code.match(/\bpix\s*\+\s*pvalue\s*\[[^\]]+\]\s*\+\s*/);
  if (suffixAt) suffix = readLiteral(code, suffixAt.index + suffixAt[0].length).value;
  return list.map((item) => {
    const url = /^(https?:)?\/\//i.test(item) ? item : String(values.pix || '') + item + suffix;
    const absolute = url.startsWith('//') ? 'https:' + url : url;
    if (!/^https?:\/\/[^\s"'<>]+$/i.test(absolute)) throw new Error('圖片網址無效');
    return absolute;
  });
}

export default class extends Extension {
  state() {
    if (!this._pages) {
      this._pages = new Map(); this._pending = new Map();
      this._queue = Promise.resolve(); this._finished = null; this._pauseUntil = 0;
    }
  }
  async load() { this.state(); }
  base() { return DM_SITE.base; }
  imageHeaders(referer) { return { 'User-Agent': DM_SITE.ua, Referer: referer || this.base() + '/' }; }
  headers(referer) {
    const headers = this.imageHeaders(referer);
    if (DM_SITE.kind === 'dm5') {
      headers['Accept-Language'] = 'zh-TW';
      headers.Accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    }
    return headers;
  }
  path(value, chapter) {
    const raw = String(value || '').trim();
    let path = raw;
    const absolute = raw.match(/^https?:\/\/([^/]+)(\/[^?#]*)/i);
    if (absolute) {
      if (!DM_SITE.hosts.includes(absolute[1].toLowerCase())) throw new Error('不是本來源的網址');
      path = absolute[2];
    } else path = raw.split(/[?#]/)[0];
    const valid = chapter ? /^\/m\d+\/?$/ : DM_SITE.kind === 'mangabz' ? /^\/\d+bz\/?$/ : /^\/manhua-[\w%-]+\/?$/;
    if (!valid.test(path)) throw new Error(chapter ? '無效的章節網址' : '無效的作品網址');
    return path.replace(/\/?$/, '/');
  }
  absolute(value) {
    if (!String(value || '').trim()) return '';
    const result = this.absoluteUrl(this.base() + '/', String(value).trim());
    return /^https?:\/\/[^\s"'<>]+$/i.test(result) ? result : '';
  }
  number(page) {
    if (!/^[1-9]\d*$/.test(String(page))) throw new Error('無效的頁碼');
    const n = Number(page);
    if (!Number.isSafeInteger(n) || n > 10000) throw new Error('頁碼過大');
    return n;
  }
  async get(path, { cacheMs = 60000, referer } = {}) {
    this.state();
    const key = path;
    const cached = this._pages.get(key);
    if (cached && Date.now() - cached.time < cacheMs) return cached.body;
    if (this._pending.has(key)) return this._pending.get(key);
    const task = this._queue.then(async () => {
      if (Date.now() < this._pauseUntil) throw new Error('站點暫時拒絕請求，請稍後再試');
      if (this._finished !== null) {
        const wait = this._finished + 700 - Date.now();
        if (wait > 0) await this.sleep(wait);
      }
      let response;
      try {
        response = await this.request(this.base() + path, {
          headers: this.headers(referer), timeoutMs: 20000,
          retry: false, responseMetadata: true, allowErrorStatus: true,
        });
      } finally { this._finished = Date.now(); }
      const meta = response && typeof response.status === 'number' && Object.prototype.hasOwnProperty.call(response, 'body');
      const status = meta ? response.status : 200;
      const text = meta ? response.body : response;
      if ([403, 429, 503].includes(status) || typeof text === 'string' && (/^\s*error\s*$/i.test(text) || /__cf_chl|challenge-error-title|<title[^>]*>Just a moment/i.test(text))) {
        const raw = meta && response.headers && response.headers['retry-after'];
        const seconds = Number(Array.isArray(raw) ? raw[0] : raw);
        this._pauseUntil = Date.now() + (seconds > 0 ? Math.min(3600000, Math.max(30000, seconds * 1000)) : 30000);
        throw new Error('站點限制訪問（HTTP ' + status + '），請稍後再試並確認瀏覽器能正常訪問');
      }
      if (status < 200 || status >= 400) throw new Error('站點請求失敗（HTTP ' + status + '）');
      if (typeof text !== 'string' || !text.trim()) throw new Error('站點未返回有效資料');
      this._pages.set(key, { body: text, time: Date.now() });
      while (this._pages.size > 128) this._pages.delete(this._pages.keys().next().value);
      return text;
    });
    this._queue = task.then(() => {}, () => {});
    this._pending.set(key, task);
    try { return await task; }
    finally { this._pending.delete(key); }
  }

  async channels() {
    return [
      { title: '最近更新', key: 'new' }, { title: '熱門', key: 'popular' },
      { title: '戀愛', key: 'romance' }, { title: '校園', key: 'school' },
      { title: '冒險', key: 'adventure' },
    ];
  }
  async latest(page, channel) {
    const n = this.number(page), key = String(channel || 'new');
    const genres = { romance: '26', school: '1', adventure: '2' };
    const genre = genres[key] || '0', sort = key === 'popular' ? '10' : '2';
    const path = DM_SITE.kind === 'mangabz'
      ? '/manga-list-' + genre + '-0-' + sort + '-p' + n + '/'
      : '/manhua-list-' + (genre === '0' ? '' : 'tag' + genre + '-') + 's' + sort + '-p' + n + '/';
    return this.cards(await this.get(path));
  }
  async search(keyword, page) { return this.find(keyword, page, false); }
  async searchAuthor(author, page) { return this.find(author && author.name, page, true); }
  async find(keyword, page, author) {
    const text = String(keyword || '').trim();
    if (!text) return [];
    const n = this.number(page);
    const path = '/search?title=' + encodeURIComponent(text) +
      (DM_SITE.kind === 'dm5' ? '&language=1' : '') + (author ? '&f=2' : '') + '&page=' + n;
    return this.cards(await this.get(path));
  }
  async cards(html) {
    const selector = DM_SITE.kind === 'mangabz' ? 'div.mh-item' : 'div.banner_detail_form, ul.mh-list > li > div.mh-item';
    const blocks = await this.querySelectorAll(html, selector), result = [], seen = new Set();
    for (const block of blocks) {
      const fields = await this.querySelectorAll(await block.content, 'h2.title > a, p.title > a, img, p.mh-cover, p.chapter');
      let url = '', title = '', cover = '', update = '';
      for (const field of fields) {
        const [markup, text, href, src, style, classes] = await Promise.all([
          field.content, field.text, field.getAttributeText('href'), field.getAttributeText('src'),
          field.getAttributeText('style'), field.getAttributeText('class'),
        ]);
        if (href) {
          try { url = this.path(href, false); title = String(text || '').trim(); } catch (_) {}
        } else if (/^<img\b/i.test(markup) && !cover) {
          const image = await field.getAttributeText('data-src') || src;
          if (image && !/^data:/i.test(image)) cover = this.absolute(image);
        } else if (String(classes || '').split(/\s+/).includes('mh-cover') && style) {
          const bg = String(style).match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
          if (bg) cover = this.absolute(bg[1]);
        } else if (String(classes || '').split(/\s+/).includes('chapter')) update = String(text || '').replace(/\s+/g, ' ').trim();
      }
      if (url && title && !seen.has(url)) { seen.add(url); result.push({ title, url, cover, update }); }
    }
    return result;
  }
  async text(html, selector) {
    const element = await this.querySelector(html, selector);
    return String(await element.text || '').replace(/\s+/g, ' ').trim();
  }
  async detail(value) {
    const path = this.path(value, false);
    const html = await this.get(path, { cacheMs: 300000 });
    try {
      const bz = DM_SITE.kind === 'mangabz';
      const [title, desc, coverNode, authorNodes, groups] = await Promise.all([
        this.text(html, bz ? 'p.detail-info-title' : 'div.banner_detail_form p.title'),
        this.text(html, bz ? 'p.detail-info-content' : 'div.banner_detail_form p.content'),
        this.querySelector(html, bz ? 'img.detail-info-cover' : 'div.banner_detail_form img'),
        this.querySelectorAll(html, bz ? 'p.detail-info-tip > span > a' : 'div.banner_detail_form p.subtitle > a'),
        this.catalog(html),
      ]);
      if (!title) throw new Error('站點未返回作品標題');
      const authors = [];
      for (const node of authorNodes) {
        const name = String(await node.text || '').trim();
        if (name) authors.push({ name, url: this.absolute(await node.getAttributeText('href') || '') });
      }
      return {
        title, desc, cover: this.absolute(await coverNode.getAttributeText('src') || ''),
        authors, episodes: groups,
      };
    } catch (error) { this._pages.delete(path); throw error; }
  }
  async catalog(html) {
    const root = await this.querySelector(html, '#chapterlistload');
    const body = await root.content;
    if (!body) throw new Error('站點未返回完整目錄，請確認瀏覽器可正常訪問');
    const bz = DM_SITE.kind === 'mangabz';
    const [containers, buttons, order] = await Promise.all([
      this.querySelectorAll(body, bz ? '.detail-list-form-con' : 'ul[id^="detail-list-select-"]'),
      this.querySelectorAll(html, '.detail-list-title a.block'),
      this.text(html, '.detail-list-title a.order'),
    ]);
    const blocks = containers.length ? containers : [root];
    const seen = new Set(), groups = [];
    for (let i = 0; i < blocks.length; i += 1) {
      const links = await this.querySelectorAll(await blocks[i].content, bz ? 'a.detail-list-form-item' : 'li > a');
      const urls = [];
      for (const link of links) {
        let path;
        try { path = this.path(await link.getAttributeText('href'), true); } catch (_) { continue; }
        if (seen.has(path)) continue;
        const [text, markup] = await Promise.all([link.text, link.content]);
        let name = String(text || '').replace(/[（(]\s*\d+\s*P\s*[）)]/gi, '').replace(/\s+/g, ' ').trim();
        if (!name) continue;
        if (/detail-lock|view-lock/.test(markup)) name += ' 🔒';
        seen.add(path); urls.push({ name, url: path });
      }
      if (order !== '正序') urls.reverse();
      const label = buttons[i] ? String(await buttons[i].text || '').replace(/[（(]\s*\d+\s*[）)]/, '').trim() : '';
      if (urls.length) groups.push({ title: label || '章節', urls });
    }
    if (!groups.length) throw new Error('目錄為空，請確認網站的訪問條件，稍後再試');
    return groups;
  }
  field(html, name) {
    const match = String(html).match(new RegExp('\\bvar\\s+' + name + '\\s*=\\s*'));
    if (!match) return '';
    const at = match.index + match[0].length;
    if (html[at] === "'" || html[at] === '"') return readLiteral(html, at).value;
    return (html.slice(at).match(/^[0-9]+/) || [''])[0];
  }
  decodeImages(code) { return imageUrlsFromScript(code); }
  async watch(value) {
    const path = this.path(value, true);
    const html = await this.get(path), chapterUrl = this.base() + path;
    try {
      const prefix = DM_SITE.kind === 'mangabz' ? 'MANGABZ_' : 'DM5_';
      const count = Number(this.field(html, prefix + 'IMAGE_COUNT'));
      const direct = await this.querySelectorAll(html, '#barChapter img.load-src');
      if (direct.length) {
        const urls = [];
        for (const image of direct) {
          const url = this.absolute(await image.getAttributeText('data-src') || await image.getAttributeText('src') || '');
          if (url) urls.push(url);
        }
        if (urls.length && (!count || urls.length === count)) return { urls, headers: this.imageHeaders(chapterUrl) };
      }
      if (!Number.isSafeInteger(count) || count < 1 || count > 2000) {
        const message = await this.text(html, '.view-pay-form p.subtitle');
        throw new Error(message || '本章未返回可讀圖片，可能需在網站登入或購買後查看');
      }
      const cid = this.field(html, prefix + 'CID');
      if (cid !== path.match(/\d+/)[0]) throw new Error('站點返回了其他章節的資料');
      let api;
      if (DM_SITE.kind === 'mangabz') {
        api = path + 'chapterimage.ashx?cid=' + cid + '&page=';
      } else {
        const mid = this.field(html, 'DM5_MID'), dt = this.field(html, 'DM5_VIEWSIGN_DT'), sign = this.field(html, 'DM5_VIEWSIGN');
        if (!mid || !dt || !sign) throw new Error('本章未提供公開閱讀資料，請在網站確認是否需要登入或購買');
        api = path + 'chapterfun.ashx?cid=' + cid + '&key=&language=1&gtk=6&_cid=' + cid +
          '&_mid=' + encodeURIComponent(mid) + '&_dt=' + encodeURIComponent(dt) + '&_sign=' + encodeURIComponent(sign) + '&page=';
      }
      const urls = [], seen = new Set();
      while (urls.length < count) {
        const code = await this.get(api + (urls.length + 1), { referer: chapterUrl });
        const batch = this.decodeImages(code);
        const before = urls.length;
        for (const url of batch) {
          if (seen.has(url)) continue;
          seen.add(url); urls.push(url);
          if (urls.length === count) break;
        }
        if (urls.length === before) throw new Error('圖片清單不完整，已停止重複請求，請稍後再試');
      }
      return { urls, headers: this.imageHeaders(DM_SITE.kind === 'dm5' ? chapterUrl : this.base() + '/') };
    } catch (error) {
      this._pages.delete(path);
      throw error;
    }
  }
}

/*
Copyright 2025 Aidoku community source contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
