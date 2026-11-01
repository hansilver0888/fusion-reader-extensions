// ==MiruExtension==
// @name         包子漫畫
// @version      v1.0.1
// @author       FusionReader
// @lang         zh-tw
// @license      MIT
// @package      baozimh
// @type         manga
// @icon         https://static-tw.baozimh.com/favicon.ico
// @webSite      https://www.baozimh.com
// @nsfw         false
// @network      auto
// ==/MiruExtension==
//
// The site sits behind a self hosted proof of work gate ("gatekeeper"):
// every page answers 403 {"challenge_url":"/__gatekeeper_challenge/start?..."}
// until the client (a) opens the challenge page, (b) finds a nonce whose
// sha256("gatekeeper-pow-v1:" + challengeId + ":" + nonce) has difficultyBits
// leading zero bits and (c) posts {challenge_id, ticket, nonce} to
// /__gatekeeper_challenge/verify with a same origin referer. That hands out the
// __Host-gk_clearance_* cookie the rest of the site (and the image cdn) accepts.
// Verified 2026-11-01: 16 bits, solved in ~100 ms, clearance lasts about an hour.
//
//   listings : /list/new, /classify, /list/<order>
//   card     : div.comics-card > a.comics-card__poster[href][title] > amp-img[src]
//   detail   : /comic/<slug>, chapters link to
//              /user/page_direct?comic_id=<slug>&section_slot=<s>&chapter_slot=<n>
//   reader   : that link redirects to a reader page whose <amp-img src> elements
//              are the comic pages (https://s1.bzcdn.net/scomic/<slug>/<s>/<n>-<h>/<p>.jpg)

const SITE = 'https://www.baozimh.com';
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
const GATE_PREFIX = 'gatekeeper-pow-v1:';
const PAGE_GAP_MS = 250;
const PAGE_CACHE_MS = 30000;

// ---------- sha256 (QuickJS has no crypto) ----------

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8Bytes(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
        bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}

function rotr(value, bits) {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function leadingZeroBits(words) {
  let count = 0;
  for (const word of words) {
    for (let bit = 31; bit >= 0; bit -= 1) {
      if (((word >>> bit) & 1) === 0) count += 1;
      else return count;
    }
  }
  return count;
}

// The gate hashes "<prefix><challengeId>:<nonce>". The prefix and the id are
// 82 bytes, so the message always spans exactly two 64 byte blocks: the first
// one never changes, the second holds the nonce plus the padding. The state
// after the first block is computed once, which leaves one block compression per
// candidate (16 bits is ~65k candidates, and QuickJS is slow).
// Searching runs in batches: a single synchronous sweep of a few hundred
// thousand candidates freezes the whole app (the loop never yields), so every
// batch hands control back through the runtime's sleep. 16 bits needs ~65k
// candidates on average; 300k covers 99.5% of draws and keeps the worst case
// around ten seconds instead of minutes.
async function powSearch(prefix, challengeId, difficultyBits, limit, sleep) {
  const fixed = utf8Bytes(`${prefix}${challengeId}:`);
  const baseLength = fixed.length;
  const maxNonceLength = String(limit).length;
  if (baseLength + maxNonceLength > 119) return ''; // three blocks: not our case

  // state after the constant first block(s)
  let state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  let consumed = 0;
  while (baseLength - consumed >= 64) {
    const chunk = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) chunk[i] = fixed[consumed + i];
    state = compressBlock(chunk, state);
    consumed += 64;
  }

  const tailOffset = consumed;
  const tailBase = baseLength - tailOffset;
  const block = new Uint8Array(64);
  const tail = new Uint8Array(64);
  for (let i = 0; i < tailBase; i += 1) tail[i] = fixed[tailOffset + i];

  const batch = 2000;
  for (let start = 0; start < limit; start += batch) {
    const end = Math.min(start + batch, limit);
    for (let nonce = start; nonce < end; nonce += 1) {
      const digits = String(nonce);
      for (let i = 0; i < 64; i += 1) block[i] = tail[i];
      for (let i = 0; i < digits.length; i += 1) block[tailBase + i] = digits.charCodeAt(i);
      const length = baseLength + digits.length;
      block[tailBase + digits.length] = 0x80;
      // the 64 bit big endian message length lives in the last 8 bytes of the block
      const bits = length * 8;
      block[56] = 0;
      block[57] = 0;
      block[58] = 0;
      block[59] = 0;
      block[60] = (bits >>> 24) & 0xff;
      block[61] = (bits >>> 16) & 0xff;
      block[62] = (bits >>> 8) & 0xff;
      block[63] = bits & 0xff;

      const words = compressBlock(block, state);
      if (leadingZeroBits(words) >= difficultyBits) return digits;
    }
    // let the host breathe between batches
    if (sleep) await sleep(1);
  }
  return '';
}

function compressBlock(block, initialState) {
  const w = new Array(64);
  for (let i = 0; i < 16; i += 1) {
    const j = i * 4;
    w[i] = ((block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3]) >>> 0;
  }
  for (let i = 16; i < 64; i += 1) {
    const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
    const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }
  const seed = initialState || [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const h0 = seed[0];
  const h1 = seed[1];
  const h2 = seed[2];
  const h3 = seed[3];
  const h4 = seed[4];
  const h5 = seed[5];
  const h6 = seed[6];
  const h7 = seed[7];
  let a = h0;
  let b = h1;
  let c = h2;
  let d = h3;
  let e = h4;
  let f = h5;
  let g = h6;
  let h = h7;
  for (let i = 0; i < 64; i += 1) {
    const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
    const ch = ((e & f) ^ (~e & g)) >>> 0;
    const temp1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
    const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
    const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
    const temp2 = (s0 + maj) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }
  return [(h0 + a) >>> 0, (h1 + b) >>> 0, (h2 + c) >>> 0, (h3 + d) >>> 0, (h4 + e) >>> 0, (h5 + f) >>> 0, (h6 + g) >>> 0, (h7 + h) >>> 0];
}

export default class extends Extension {
  state() {
    if (!this._pages) {
      this._pages = new Map();
      this._inflight = new Map();
      this._lastRequest = 0;
      this._queue = Promise.resolve();
      this._clearedAt = 0;
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

  // ---------- gatekeeper ----------

  isChallenge(body) {
    return /challenge_required|__gatekeeper_challenge/.test(String(body || ''));
  }

  // Solve the proof of work against the return path and hand the clearance out
  // through the app's own cookie jar (the site sets it on the verify response).
  async passGate(target) {
    const url = this.absolute(target || '/');
    const path = url.replace(/^https?:\/\/[^/]+/i, '');
    const challengeUrl = `${SITE}/__gatekeeper_challenge/start?return=${encodeURIComponent(path)}`;
    const page = await this.request(challengeUrl, {
      headers: { Accept: 'text/html,*/*' },
    });
    const body = typeof page === 'string' ? page : JSON.stringify(page);
    const field = (name) => (body.match(new RegExp(`${name}:\\s*"([^"]+)"`)) || [])[1] || '';
    const challengeId = field('challengeId');
    const ticket = field('ticket');
    const verifyUrl = field('verifyUrl') || '/__gatekeeper_challenge/verify';
    const difficultyBits = parseInt((body.match(/difficultyBits:\s*(\d+)/) || [])[1] || '16', 10);
    if (!challengeId || !ticket) {
      throw new Error('無法取得瀏覽器驗證（站點改版？）。');
    }

    // ~65k candidates are expected at 16 bits; 300k keeps a bad draw bounded
    const solution = await powSearch(GATE_PREFIX, challengeId, difficultyBits, 300000, (ms) => this.sleep(ms));
    if (!solution) throw new Error('瀏覽器驗證計算失敗。');

    await this.request(this.absolute(verifyUrl), {
      method: 'POST',
      data: JSON.stringify({ challenge_id: challengeId, ticket, nonce: solution }),
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: SITE,
        Referer: challengeUrl,
      },
    });
    this._clearedAt = Date.now();
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

  async fetchPage(path) {
    const url = /^https?:\/\//i.test(path) ? path : SITE + path;
    let body = await this.requestText(url, {
      headers: { 'Accept-Language': 'zh-CN,zh;q=0.9', Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      allowErrorStatus: true,
    });
    if (!this.isChallenge(body)) return body;

    // the clearance expires, so a challenged read simply re-solves the gate
    await this.passGate(url);
    body = await this.requestText(url, {
      headers: { 'Accept-Language': 'zh-CN;q=0.9', Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      allowErrorStatus: true,
    });
    if (this.isChallenge(body)) {
      throw new Error('包子漫畫的瀏覽器驗證未通過，請稍後重試或切換連線方式。');
    }
    return body;
  }

  // ---------- channels / listings ----------

  async channels() {
    return SECTIONS.map((section) => ({ title: section.title, key: section.key }));
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

    // chapters: /user/page_direct?comic_id=<slug>&section_slot=<s>&chapter_slot=<n>
    const chapters = [];
    const seen = new Set();
    const pattern = /<a\b[^>]*href="([^"]*\/user\/page_direct\?[^"]*)"[^>]*>([\s\S]{0,400}?)<\/a>/gi;
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const href = this.decodeEntities(match[1].replace(/&amp;/g, '&'));
      if (!/chapter_slot=\d+/.test(href) || seen.has(href)) continue;
      const name = this.textOf(match[2]) || `第 ${chapters.length + 1} 話`;
      seen.add(href);
      chapters.push({ title: name, url: href.startsWith('http') ? href : this.absolute(href) });
    }
    if (!chapters.length) {
      throw new Error('這個作品沒有可閱讀的章節。');
    }
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
    if (/^https?:\/\//i.test(text) && !/^https?:\/\/(?:[a-z0-9-]+\.)*(?:baozimh\.com|twmanga\.com)\//i.test(text)) {
      throw new Error('無效的作品地址：' + text);
    }
    const path = text.replace(/#.*$/, '').replace(/^https?:\/\/[^/]+/i, '').replace(/[?].*$/, '');
    const slug = this.slug(path);
    if (!slug) throw new Error('無法解析作品地址：' + text);
    return { path: `/comic/${slug}`, slug };
  }

  // ---------- watch ----------

  async watch(url) {
    const text = (url === undefined || url === null ? '' : String(url)).trim();
    if (!text) throw new Error('無效的章節地址：' + text);
    const target = /^https?:\/\//i.test(text) ? text : this.absolute(text);
    const html = await this.page(target);

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
