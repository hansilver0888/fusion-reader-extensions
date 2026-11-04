// ==MiruExtension==
// @name         拷貝漫畫
// @version      v1.1.0
// @author       FusionReader
// @lang         zh-tw
// @license      MIT
// @package      copymanga
// @type         manga
// @icon         https://s3.mangafunb.fun/static/free.ico
// @webSite      https://www.copy5000.com
// @nsfw         false
// @network      auto
// ==/MiruExtension==
//
// 拷貝漫畫 (copymanga / mangacopy). The site has no api documentation worth
// using and its json api answers a bot check (`code 210`, "you or someone near
// you installed a cracked client") once it dislikes the traffic, so everything
// here runs on the public html site and decrypts what that site encrypts:
//
//   listing   : /newest?offset=&limit=      (60 per page, paged by offset)
//   filters   : /comics?ordering=-datetime_updated&offset=&limit=&region=&status=&theme=
//   search    : /api/kb/web/searchcl/comics?offset&platform=2&limit&q&q_type  (json)
//   detail    : /comic/<path_word>          (title, cover, tags, <span id="dnt">)
//   chapters  : /comicdetail/<path_word>/chapters  (json, `results` is encrypted)
//   reader    : /comic/<path_word>/chapter/<uuid>  (`var contentKey = '…'`, encrypted)
//
// The encryption is AES-128-CBC with PKCS7 padding where the first 16 characters
// of the payload are the iv and the rest is hex cipher text. The key ships in the
// page itself as `var ccz = '…'` (detail) and `var cct = '…'` (reader) — the same
// constant on every mirror checked. QuickJS has no crypto module, so the cipher
// below is implemented in plain javascript; it is checked against FIPS-197 and
// against node's aes-128-cbc in tests/copymanga_test.mjs.
//
// Two mirrors are enough to keep the site reachable when one is blocked; the
// first that answers becomes the entry for the session.
//
// The chapter list and the reader need the `dnt` value of the detail page as a
// request header; without it the site answers with an empty chapter list and an
// empty contentKey, which is what the plugin reports as an empty shelf.

const ENTRY_CANDIDATES = [
  'https://www.copy5000.com',
  'https://www.copy4000.com',
  'https://www.copy3000.com',
  'https://www.2026copy.com',
  'https://www.mangacopy.com',
];
const FALLBACK_KEY = '0p0zzpvv.nmn.oop';
const PAGE_LIMIT = 60;
const SEARCH_LIMIT = 12;
const FILTER_LIMIT = 50;
const PAGE_GAP_MS = 300;
const PAGE_CACHE_MS = 60000;
const REQUEST_TIMEOUT_MS = 25000;

// Browsing channels. `theme` is the site's own genre id, kept empty for the
// plain feeds; region/status are the values its filter form posts.
const SECTIONS = [
  { title: '最近更新', path: '/newest', query: '', offset: true, limit: PAGE_LIMIT },
  { title: '熱門', path: '/comics', query: 'ordering=-popular', offset: true, limit: FILTER_LIMIT },
  { title: '最新上架', path: '/comics', query: 'ordering=-datetime_created', offset: true, limit: FILTER_LIMIT },
  { title: '日漫', path: '/comics', query: 'ordering=-datetime_updated&region=1', offset: true, limit: FILTER_LIMIT },
  { title: '韓漫', path: '/comics', query: 'ordering=-datetime_updated&region=2', offset: true, limit: FILTER_LIMIT },
  { title: '歐美', path: '/comics', query: 'ordering=-datetime_updated&region=3', offset: true, limit: FILTER_LIMIT },
  { title: '連載中', path: '/comics', query: 'ordering=-datetime_updated&status=0', offset: true, limit: FILTER_LIMIT },
  { title: '已完結', path: '/comics', query: 'ordering=-datetime_updated&status=1', offset: true, limit: FILTER_LIMIT },
];

// ---------- AES-128-CBC (decrypt only, PKCS7) ----------
// Tables are derived at load time from the finite field instead of being pasted
// in as 512 literals; the derivation is the one in FIPS-197 §5.1.1.

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
function buildSBoxes() {
  const rotl8 = (x, shift) => ((x << shift) | (x >>> (8 - shift))) & 0xff;
  let p = 1;
  let q = 1;
  do {
    p = (p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
    q ^= (q << 1) & 0xff;
    q ^= (q << 2) & 0xff;
    q ^= (q << 4) & 0xff;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const value = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xff;
    SBOX[p] = value;
    INV_SBOX[value] = p;
  } while (p !== 1);
  SBOX[0] = 0x63;
  INV_SBOX[0x63] = 0;
}
buildSBoxes();

function xtime(value) {
  return ((value << 1) ^ (value & 0x80 ? 0x1b : 0)) & 0xff;
}

function gmul(a, b) {
  let result = 0;
  let x = a;
  let y = b;
  while (y) {
    if (y & 1) result ^= x;
    x = xtime(x);
    y >>= 1;
  }
  return result & 0xff;
}

function expandKey(key) {
  const schedule = new Uint8Array(176);
  schedule.set(key, 0);
  let rcon = 1;
  for (let round = 1; round <= 10; round += 1) {
    const prev = (round - 1) * 16;
    const base = round * 16;
    const t0 = SBOX[schedule[prev + 13]] ^ rcon;
    const t1 = SBOX[schedule[prev + 14]];
    const t2 = SBOX[schedule[prev + 15]];
    const t3 = SBOX[schedule[prev + 12]];
    rcon = xtime(rcon);
    schedule[base] = schedule[prev] ^ t0;
    schedule[base + 1] = schedule[prev + 1] ^ t1;
    schedule[base + 2] = schedule[prev + 2] ^ t2;
    schedule[base + 3] = schedule[prev + 3] ^ t3;
    for (let i = 4; i < 16; i += 1) {
      schedule[base + i] = schedule[prev + i] ^ schedule[base + i - 4];
    }
  }
  return schedule;
}

function addRoundKey(state, schedule, round) {
  for (let i = 0; i < 16; i += 1) state[i] ^= schedule[round * 16 + i];
}

function invShiftRows(state) {
  // row r is rotated right by r; the state is column-major (index r + 4c)
  const copy = state.slice();
  for (let row = 1; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      state[row + 4 * col] = copy[row + 4 * ((col - row + 4) % 4)];
    }
  }
}

function invSubBytes(state) {
  for (let i = 0; i < 16; i += 1) state[i] = INV_SBOX[state[i]];
}

function invMixColumns(state) {
  for (let col = 0; col < 4; col += 1) {
    const i = 4 * col;
    const a0 = state[i];
    const a1 = state[i + 1];
    const a2 = state[i + 2];
    const a3 = state[i + 3];
    state[i] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
    state[i + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
    state[i + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
    state[i + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
  }
}

function decryptBlock(block, schedule) {
  const state = Uint8Array.from(block);
  addRoundKey(state, schedule, 10);
  for (let round = 9; round >= 1; round -= 1) {
    invShiftRows(state);
    invSubBytes(state);
    addRoundKey(state, schedule, round);
    invMixColumns(state);
  }
  invShiftRows(state);
  invSubBytes(state);
  addRoundKey(state, schedule, 0);
  return state;
}

function decryptCbc(cipher, key, iv) {
  const schedule = expandKey(key);
  let previous = Uint8Array.from(iv);
  const out = new Uint8Array(cipher.length);
  for (let offset = 0; offset < cipher.length; offset += 16) {
    const block = cipher.subarray(offset, offset + 16);
    const plain = decryptBlock(block, schedule);
    for (let i = 0; i < 16; i += 1) out[offset + i] = plain[i] ^ previous[i];
    previous = Uint8Array.from(block);
  }
  const pad = out[out.length - 1];
  if (pad >= 1 && pad <= 16) {
    let valid = true;
    for (let i = out.length - pad; i < out.length; i += 1) {
      if (out[i] !== pad) valid = false;
    }
    if (valid) return out.subarray(0, out.length - pad);
  }
  return out;
}

function bytesToText(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b >= 0xc0 && b < 0xe0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
      i += 3;
    } else if (b >= 0xf0 && i + 3 < bytes.length) {
      const code = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      out += code >= 0x10000 && code <= 0x10ffff ? String.fromCodePoint(code) : '\ufffd';
      i += 4;
    } else {
      out += '\ufffd';
      i += 1;
    }
  }
  return out;
}

function textToBytes(text) {
  const out = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return Uint8Array.from(out);
}

function hexToBytes(hex) {
  const clean = String(hex || '').replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// payload = 16 ascii iv + hex cipher text
function decryptPayload(payload, keyText) {
  const text = String(payload || '');
  if (text.length < 33) return '';
  const iv = Uint8Array.from(text.slice(0, 16).split('').map((character) => character.charCodeAt(0) & 0xff));
  const cipher = hexToBytes(text.slice(16));
  if (!cipher.length) return '';
  const key = textToBytes(String(keyText || FALLBACK_KEY)).subarray(0, 16);
  if (key.length !== 16) return '';
  return bytesToText(decryptCbc(cipher, key, iv));
}

// ---------- extension ----------

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
    // The chapter list and the reader are served to logged in clients only, so
    // an account is what makes this source readable. Both fields are optional:
    // without them the plugin still browses and searches.
    try {
      await this.registerSetting({
        key: 'username',
        title: '帳號（手機號／信箱）',
        type: 'input',
        description: '可選。填寫後章節與閱讀頁才能載入；只用於在官網取得登入 token，僅保存在本機。',
        defaultValue: '',
      });
      await this.registerSetting({
        key: 'password',
        title: '密碼',
        type: 'password',
        description: '僅保存在本機，用於換取登入 token。',
        defaultValue: '',
      });
    } catch (error) {
      // runtimes without a settings ui simply stay anonymous
    }
  }

  // the cipher lives at module scope; this mirrors it on the class so the
  // behaviour can be exercised directly (see tests/copymanga_test.mjs)
  decryptPayload(payload, keyText) {
    return decryptPayload(payload, keyText);
  }

  // ---------- helpers ----------

  userAgent() {
    return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Safari/605.1.15';
  }

  currentSite() {
    return this._entry || ENTRY_CANDIDATES[0];
  }

  absolute(url) {
    const value = String(url || '').trim().replace(/\\\//g, '/');
    if (!value) return '';
    if (value.startsWith('//')) return `https:${value}`;
    if (/^https?:\/\//i.test(value)) return value;
    return this.absoluteUrl(this.currentSite(), value);
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

  // ---------- login ----------

  // The site hands out a token to a logged in client and serves the chapter list
  // and the reader pages to it; anonymous clients get an empty list and an empty
  // contentKey. The form is the site's own: the password travels as
  // base64("<plain>-<salt>") with a six digit salt taken from the clock.
  async credentials() {
    this.state();
    if (this._credentials !== undefined) return this._credentials;
    let username = '';
    let password = '';
    try {
      username = String((await this.getSetting('username')) || '').trim();
      password = String((await this.getSetting('password')) || '');
    } catch (error) {
      username = '';
      password = '';
    }
    this._credentials = username && password ? { username, password } : null;
    return this._credentials;
  }

  async token() {
    this.state();
    if (this._token) return this._token;
    if (this._tokenPending) return this._tokenPending;
    const stored = await this.getSetting('token').catch(() => '');
    if (stored) {
      this._token = String(stored);
      return this._token;
    }
    const credentials = await this.credentials();
    if (!credentials) return '';

    this._tokenPending = (async () => {
      const salt = (Date.now() % 900000) + 100000;
      const encoded = this.base64(`${credentials.password}-${salt}`);
      const body = [
        `username=${encodeURIComponent(credentials.username)}`,
        `password=${encodeURIComponent(encoded)}`,
        `salt=${salt}`,
        'platform=2',
        'version=1.0.0',
        'source=copyweb',
      ].join('&');
      const site = await this.entry();
      const raw = await this.requestText(site + '/api/v1/login', {
        method: 'POST',
        data: body,
        headers: {
          ...this.pageHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json',
        },
        allowErrorStatus: true,
        timeoutMs: REQUEST_TIMEOUT_MS,
        retry: 1,
      });
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (error) {
        throw new Error('登入回應無法解析，請稍後再試。');
      }
      const issued = payload && payload.results && payload.results.token;
      if (!issued) {
        const message = String((payload && payload.message) || '').trim();
        throw new Error(`登入失敗：${message || '站點未返回 token'}。請在設定中檢查帳號密碼。`);
      }
      this._token = String(issued);
      await this.setSetting('token', this._token).catch(() => {});
      return this._token;
    })();

    try {
      return await this._tokenPending;
    } finally {
      this._tokenPending = null;
    }
  }

  async authHeaders() {
    const token = await this.token().catch(() => '');
    return token ? { Cookie: `token=${token}`, Authorization: `Token ${token}` } : {};
  }

  // base64 of a short utf-8 string (btoa is not guaranteed to exist in QuickJS)
  base64(text) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const bytes = textToBytes(String(text));
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += alphabet[b0 >> 2];
      out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
      out += i + 1 < bytes.length ? alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
      out += i + 2 < bytes.length ? alphabet[b2 & 0x3f] : '=';
    }
    return out;
  }

  pathWord(url) {
    const text = String(url || '').trim();
    const match = text.match(/\/comic\/([^/?#]+)/);
    return match ? match[1] : (/^[\w-]+$/.test(text) ? text : '');
  }

  // the cover thumbnails carry a size suffix that the site strips for the image
  bigCover(url) {
    return String(url || '').replace(/\.\d+x\d+\.jpg$/, '').replace(/\.328x422\.jpg$/, '');
  }

  // ---------- entry / transport ----------

  async entry() {
    this.state();
    if (this._entry) return this._entry;
    if (this._entryPending) return this._entryPending;

    this._entryPending = (async () => {
      const failures = [];
      for (const site of ENTRY_CANDIDATES) {
        try {
          // A full page rather than limit=1: the trimmed variant is only a few
          // kb and some hosts answer it with a shell that carries no links.
          // No allowErrorStatus here: a non-2xx answer should surface as an
          // error with its status code, not as a short body we then call
          // "too short". The caller turns that error into the failure note.
          const body = await this.requestText(site + '/newest', {
            headers: this.pageHeaders(),
            timeoutMs: REQUEST_TIMEOUT_MS,
            retry: 1,
          });
          const problem = this.describePage(body);
          if (problem) {
            failures.push(`${site} ${problem}`);
            continue;
          }
          this._entry = site;
          return site;
        } catch (error) {
          failures.push(`${site} ${String(error && error.message ? error.message : error).slice(0, 60)}`);
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

  // Headers the site expects from a browser. aidoku notes that hosts which merge
  // a default header suite answer a different page without them, so the full set
  // is spelled out instead of relying on the runtime's defaults.
  pageHeaders() {
    return {
      'User-Agent': this.userAgent(),
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Upgrade-Insecure-Requests': '1',
    };
  }

  // Why a probe response is unusable, or '' when it looks like a listing page.
  describePage(body) {
    const text = String(body || '');
    if (!text) return '空白回應';
    if (text.length < 400) {
      const raw = text.replace(/\s+/g, ' ').slice(0, 80);
      return `頁面過短（${text.length} 字元，內容：${raw}）`;
    }
    if (/Just a moment|Attention Required|cf-bluemix|__cf_chl/i.test(text)) return '被 Cloudflare 攔截';
    if (/請到官網更新|伺服器升級|服务器升级/.test(text)) return '站點要求更新 App';
    if (/\/comic\/[\w-]/.test(text)) return '';
    if (/exemptComic/.test(text)) return '';
    const title = (text.match(/<title[^>]*>([\s\S]{0,80}?)<\/title>/i) || [])[1] || '';
    return `不是預期的頁面${title ? `（${title.trim().slice(0, 30)}）` : ''}，長度 ${text.length}`;
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

  // A request against the live mirror; an absolute url keeps only its path so a
  // stale domain from a saved entry still resolves.
  async fetch(path, headers) {
    const target = /^https?:\/\//i.test(path) ? String(path).replace(/^https?:\/\/[^/]+/i, '') : path;
    const site = await this.entry();
    const merged = { ...this.pageHeaders(), ...(await this.authHeaders()), ...(headers || {}) };
    // an explicit timeout: the runtime default is short for a 70 kb page, and a
    // silent truncation arrives here looking like an empty body
    const options = { headers: merged, allowErrorStatus: true, timeoutMs: REQUEST_TIMEOUT_MS, retry: 1 };
    try {
      return await this.requestText(site + target, options);
    } catch (error) {
      this._entry = '';
      const retrySite = await this.entry();
      return this.requestText(retrySite + target, options);
    }
  }

  async page(path, headers) {
    this.state();
    const key = `${headers && headers.Accept ? headers.Accept : ''}|${path}`;
    const cached = this._pages.get(key);
    if (cached && Date.now() - cached.time < PAGE_CACHE_MS) return cached.body;
    const running = this._inflight.get(key);
    if (running) return running;
    const task = this.fetch(path, headers).then(
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

  // the detail page carries the `dnt` value the chapter endpoints want
  async dntKey(path) {
    const html = await this.page(path);
    const dnt = (html.match(/id="dnt"[^>]*value="([^"]*)"/) || [])[1] || '';
    const key = (html.match(/var ccz = '([^']*)'/) || [])[1] || FALLBACK_KEY;
    return { dnt, key, html };
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
    const offset = (number - 1) * section.limit;
    const query = [section.query, `offset=${offset}`, `limit=${section.limit}`]
      .filter((part) => part)
      .join('&');
    const html = await this.page(`${section.path}?${query}`);
    return this.cards(html);
  }

  async search(kw, page) {
    const keyword = (kw === undefined || kw === null ? '' : String(kw)).trim();
    if (!keyword) return [];
    const number = this.pageNumber(page);
    const offset = (number - 1) * SEARCH_LIMIT;
    const path = `/api/kb/web/searchcl/comics?offset=${offset}&platform=2&limit=${SEARCH_LIMIT}&q=${encodeURIComponent(keyword)}&q_type=`;
    const body = await this.page(path, { Accept: 'application/json' });
    return this.searchCards(body);
  }

  searchCards(body) {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (error) {
      return [];
    }
    const list = (payload && payload.results && payload.results.list) || [];
    const items = [];
    for (const entry of list) {
      const key = String(entry.path_word || '').trim();
      if (!key) continue;
      const authors = (entry.author || []).map((author) => String(author.name || '').trim()).filter((name) => name);
      items.push({
        title: String(entry.name || key).trim(),
        url: `/comic/${key}`,
        cover: this.bigCover(entry.cover),
        update: authors.length ? authors.join(' / ') : '',
      });
    }
    return items;
  }

  // The filter listing does not ship cards as markup: it ships the array in a
  // `list` attribute of div.exemptComic-box and renders it with eval(). That
  // array is a javascript object literal (single quoted keys), so it is read
  // here by hand: the tag is located, the html entities undone and the quoting
  // normalised before JSON.parse. `total` rides along for callers that want to
  // know whether another page exists.
  inlineList(html) {
    const source = String(html);
    const at = source.indexOf('exemptComic-box');
    if (at < 0) return null;
    // walk back to the opening '<' and forward past the closing '>', respecting quotes
    let start = source.lastIndexOf('<', at);
    if (start < 0) start = 0;
    let index = start;
    let quote = null;
    while (index < source.length) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
      index += 1;
    }
    const tag = source.slice(start, index + 1);
    const attribute = (name) => {
      const match = tag.match(new RegExp(name + '="([^"]*)"'));
      return match ? match[1] : '';
    };
    const raw = attribute('list');
    if (!raw) return null;
    const total = parseInt(attribute('total'), 10) || 0;
    const unescaped = raw
      .replace(/&#x27;/gi, "'")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
    const json = unescaped
      .replace(/:\s*'([^']*)'/g, ': "$1"')
      .replace(/'([^']*)'\s*:/g, '"$1":')
      .replace(/,\s*([}\]])/g, '$1');
    try {
      const entries = JSON.parse(json);
      return Array.isArray(entries) ? { entries, total } : null;
    } catch (error) {
      return null;
    }
  }

  // Cards come from three shapes: the newest feed uses div.exemptComic_Item, the
  // filter listing carries the array above, and a keyword result is json. All of
  // them come out in the same shape so the app shows them alike.
  cards(html) {
    const source = String(html);
    const items = [];
    const seen = new Set();

    const push = (href, title, cover, extra) => {
      const key = this.pathWord(href);
      if (!key || seen.has(key)) return;
      seen.add(key);
      items.push({
        title: this.textOf(title) || key,
        url: `/comic/${key}`,
        cover: this.bigCover(this.absolute(cover)),
        update: this.textOf(extra || ''),
      });
    };

    // shape 1: the inline array of the filter listing
    const inline = this.inlineList(source);
    if (inline) {
      for (const entry of inline.entries) {
        if (!entry || !entry.path_word) continue;
        const authors = (entry.author || []).map((author) => String(author && author.name ? author.name : '').trim()).filter((name) => name);
        push(entry.path_word, entry.name, entry.cover, authors.join(' / '));
      }
      if (items.length) return items;
    }

    // shape 2: div.exemptComic_Item with an img + p.twoLines[title]
    const blockPattern = /<div\b[^>]*class="[^"]*exemptComic_Item[^"]*"[\s\S]*?(?=<div\b[^>]*class="[^"]*exemptComic_Item|<div class="row"|$)/gi;
    let match;
    while ((match = blockPattern.exec(source)) !== null) {
      const block = match[0];
      const anchor = block.match(/<a\b[^>]*href="([^"]*\/comic\/[^"]*)"[^>]*>/i);
      if (!anchor) continue;
      const image = block.match(/<img\b[^>]*>/i);
      const titleTag = block.match(/<p\b[^>]*class="[^"]*(?:twoLines|edit-txt)[^"]*"[^>]*>/i);
      const authorTag = block.match(/class="[^"]*exemptComicItem-txt-span[^"]*"[^>]*>([\s\S]{0,60}?)</i);
      push(
        anchor[1],
        (titleTag ? this.attrValue(titleTag[0], 'title') : '') || (titleTag || [])[1] || (image ? this.attrValue(image[0], 'alt') : ''),
        image ? (this.attrValue(image[0], 'data-src') || this.attrValue(image[0], 'src')) : '',
        authorTag ? String(authorTag[1]).replace(/^[^：:]*[：:]/, '') : ''
      );
    }

    // shape 3: any <a href="/comic/key"> that wraps an image
    if (!items.length) {
      const anchorPattern = /<a\b[^>]*href="([^"]*\/comic\/[^"\/]+)"[^>]*>([\s\S]{0,700}?)<\/a>/gi;
      while ((match = anchorPattern.exec(source)) !== null) {
        const inner = match[2];
        const image = inner.match(/<img\b[^>]*>/i);
        if (!image) continue;
        const titleTag = inner.match(/<p\b[^>]*>/i);
        push(
          match[1],
          (titleTag ? this.attrValue(titleTag[0], 'title') : '') || this.textOf(inner),
          this.attrValue(image[0], 'data-src') || this.attrValue(image[0], 'src')
        );
      }
    }
    return items;
  }

  // ---------- detail ----------

  target(url) {
    const text = (url === undefined || url === null ? '' : String(url)).trim();
    if (!text) throw new Error('無效的作品地址：' + text);
    const key = this.pathWord(text);
    if (!key) throw new Error('無法解析作品地址：' + text);
    return { key, path: `/comic/${key}` };
  }

  async detail(url) {
    const target = this.target(url);
    const { dnt, key: cryptoKey, html } = await this.dntKey(target.path);

    const titleTag = html.match(/<h6\b[^>]*>/i);
    const title = this.textOf((titleTag ? this.attrValue(titleTag[0], 'title') : '') || '')
      || this.textOf((html.match(/<h6\b[^>]*>([\s\S]{0,120}?)<\/h6>/i) || [])[1] || '')
      || this.textOf((html.match(/<title>([\s\S]{0,160}?)<\/title>/i) || [])[1] || '').replace(/-[^-]*$/, '').trim()
      || target.key;

    const image = html.match(/<img\b[^>]*class="[^"]*(?:lazyload|comicParticulars-cover)[^"]*"[^>]*>/i)
      || html.match(/<div\b[^>]*class="[^"]*comicParticulars-left-img[^"]*"[\s\S]{0,400}?<img\b[^>]*>/i);
    const coverImage = image ? (image[0].match(/<img\b[^>]*>/i) || [])[0] || image[0] : '';
    const cover = this.bigCover(this.absolute(
      (coverImage ? this.attrValue(coverImage, 'data-src') || this.attrValue(coverImage, 'src') : '')
        || this.meta(html, 'og:image')
    ));

    const intro = (html.match(/<p\b[^>]*class="[^"]*intro[^"]*"[^>]*>([\s\S]{0,4000}?)<\/p>/i) || [])[1] || '';
    const tags = [...new Set([...html.matchAll(/comicParticulars-tag[^>]*>[\s\S]{0,80}?<a\b[^>]*>([^<]{0,24})</gi)].map((m) => m[1].trim()))].filter((tag) => tag);
    const desc = [this.textOf(intro), tags.length ? '標籤：' + tags.join('、') : ''].filter((part) => part).join('\n\n');

    const chapters = await this.chapters(target.key, dnt, cryptoKey, html);
    if (!chapters.length) {
      throw new Error('這個作品目前沒有可閱讀的章節。若瀏覽器能看而這裡為空，通常是站點對匿名請求做了限制，請稍後再試。');
    }

    return {
      title,
      cover,
      desc,
      episodes: [{ title: '章節', urls: chapters }],
    };
  }

  // The chapter list endpoint answers encrypted json. An empty answer means the
  // site withheld the list (see the note at the top), so the detail page links
  // are used as a fallback instead of failing outright.
  async chapters(key, dnt, cryptoKey, detailHtml) {
    const chapters = [];
    const seen = new Set();
    const add = (uuid, name) => {
      const id = String(uuid || '').trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      chapters.push({ name: String(name || '').trim() || `第 ${chapters.length + 1} 話`, url: `/comic/${key}/chapter/${id}` });
    };

    try {
      const body = await this.page(`/comicdetail/${key}/chapters`, { Accept: 'application/json', dnt });
      const payload = JSON.parse(body);
      if (payload && payload.code === 210) {
        throw new Error(String(payload.message || '').slice(0, 60));
      }
      const plain = decryptPayload(payload && payload.results, cryptoKey);
      const data = JSON.parse(plain);
      const groups = Object.values((data && data.groups) || {});
      // the site lists newest first; the app shows the list in array order
      const flat = [];
      for (const group of groups) {
        for (const chapter of (group && group.chapters) || []) {
          flat.push({ type: chapter.type, name: chapter.name, id: chapter.id });
        }
      }
      flat.reverse();
      for (const chapter of flat) add(chapter.id, chapter.name);
    } catch (error) {
      // fall through to the html links below
    }

    if (!chapters.length) {
      const pattern = new RegExp(`/comic/${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/chapter/([\\w-]+)`, 'g');
      const html = detailHtml || '';
      for (const match of html.matchAll(pattern)) add(match[1], '');
      if (chapters.length) chapters[chapters.length - 1].name = '最新話';
    }
    return chapters;
  }

  // ---------- watch ----------

  chapterTarget(url) {
    const text = (url === undefined || url === null ? '' : String(url)).trim();
    if (!text) throw new Error('無效的章節地址：' + text);
    const match = text.match(/\/comic\/([^/?#]+)\/chapter\/([\w-]+)/);
    if (!match) throw new Error('無法解析章節地址：' + text);
    return { key: match[1], uuid: match[2], path: `/comic/${match[1]}/chapter/${match[2]}` };
  }

  async watch(url) {
    const target = this.chapterTarget(url);
    const { dnt, key: cryptoKey } = await this.dntKey(`/comic/${target.key}`);
    const html = await this.page(target.path, { dnt });
    const contentKey = (html.match(/var contentKey = '([^']*)'/) || [])[1] || '';
    const pageKey = (html.match(/var cct = '([^']*)'/) || [])[1] || cryptoKey;
    if (!contentKey) {
      throw new Error('這一話沒有取到頁面內容，通常是站點對匿名請求做了限制，請稍後再試。');
    }
    let list;
    try {
      list = JSON.parse(decryptPayload(contentKey, pageKey));
    } catch (error) {
      throw new Error('頁面資料解析失敗，可能站點已改版。');
    }
    const urls = (Array.isArray(list) ? list : [])
      .map((item) => this.absolute(item && item.url))
      .filter((pageUrl) => /^https?:\/\//i.test(pageUrl));
    if (!urls.length) throw new Error('這一話沒有取到頁面圖片。');
    return { urls };
  }
}
