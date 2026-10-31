// ==MiruExtension==
// @name         MissAV
// @version      v1.1.5
// @author       FusionReader
// @lang         zh-tw
// @license      MIT
// @package      missav
// @type         bangumi
// @icon         https://missav.ai/favicon.ico
// @webSite      https://missav.ai
// @nsfw         true
// @network      proxy
// ==/MiruExtension==
//
// missav answers every page with a Cloudflare managed challenge unless the
// request carries a session that already passed it, so the plugin sends a
// browser cookie and user agent from the plugin settings. cf_clearance is bound
// to that pair (and to the client address), which is why both fields exist and
// why the cookie stops working after a while.
//
// Page shape (checked 2026-10-31):
//   * a listing is 12 cards of `div.thumbnail.group`; each card holds an anchor
//     to `/<lang>/<code>`, a lazy `img` whose data-src is the cover
//     (fourhoi.com/<code>/cover-t.jpg) and whose alt is the title, plus a
//     duration badge;
//   * work urls are `/<lang>/<code>` (some links carry a rotating `/dm<N>`
//     prefix, which is optional — `/cn/new` and `/dm539/cn/new` are the same);
//   * the play address is a surrit playlist. The page prints its uuid in the
//     thumbnail strip (surrit.com/<uuid>/seek/_0.jpg) and assembles the
//     playlist urls from a packed dictionary, giving
//     `https://surrit.com/<uuid>/{1080p|720p}/video.m3u8` plus the default
//     `source842.m3u8`.
// surrit.com runs its own Cloudflare policy, so it can reject a client the page
// itself allowed; an optional second cookie is sent with the stream for that
// case.

const DEFAULT_ENTRY = 'https://missav.ai';
const KNOWN_ENTRIES = ['https://missav.ai', 'https://missav.ws', 'https://missav.live'];
const HOSTS = /^(?:[a-z0-9-]+\.)*missav\.(?:ai|ws|live)$/i;
const LANGUAGES = ['cn', 'en', 'ja', 'ko', 'ms', 'th', 'de', 'fr', 'vi', 'id', 'zh'];
const SECTIONS = [
  { title: '最新', key: 'new' },
  { title: '發售', key: 'release' },
  { title: '今日熱門', key: 'today-hot' },
  { title: '本週熱門', key: 'weekly-hot' },
  { title: '本月熱門', key: 'monthly-hot' },
  { title: '中文字幕', key: 'chinese-subtitle' },
  { title: '英文字幕', key: 'english-subtitle' },
  { title: '無碼流出', key: 'uncensored-leak' },
];
const RESERVED_SLUGS = [
  'new', 'release', 'search', 'genres', 'actresses', 'makers', 'labels', 'series',
  'articles', 'login', 'register', 'history', 'favorites', 'popular', 'trending',
  'tags', 'vip', 'today-hot', 'weekly-hot', 'monthly-hot',
  'chinese-subtitle', 'english-subtitle', 'uncensored-leak',
];
// A stale language list only costs a probe; the entry resolution keeps
// whichever host answers.
const PAGE_GAP_MS = 300;
const PAGE_CACHE_MS = 30000;
// A saved cookie has to apply without restarting the app: settings are re-read
// once the snapshot is a few seconds old.
const SESSION_TTL_MS = 5000;
// cf_clearance is bound to the user agent that solved the challenge. When the
// settings only carry a cookie, these are tried in order and the first that is
// accepted is stored back into the settings.
const FALLBACK_AGENTS = [
  'Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];

export default class extends Extension {
  state() {
    if (!this._pages) {
      this._pages = new Map();
      this._inflight = new Map();
      this._lastRequest = 0;
      this._queue = Promise.resolve();
      this._site = this._site || '';
      this._lang = this._lang || '';
      this._entryPending = null;
      this._session = null;
    }
    return this;
  }

  async load() {
    this.state();
    const settings = [
      {
        key: 'cookie',
        title: '瀏覽器 Cookie',
        type: 'password',
        description: '在瀏覽器打開 missav（已通過驗證）後，複製 Cookie；可貼整段，也可只貼 cf_clearance 的值，插件會自動補上名稱。',
        defaultValue: '',
      },
      {
        key: 'user_agent',
        title: '瀏覽器 UA',
        type: 'input',
        description: '與上面 Cookie 同一瀏覽器的 User-Agent（必須一致，否則 cf_clearance 無效）。',
        defaultValue: '',
      },
      {
        key: 'stream_cookie',
        title: '播放域名 Cookie',
        type: 'password',
        description: '可選。播放域名 surrit.com 若單獨要求驗證，把該域名的 Cookie 貼在這裡；留空則只帶 Referer。',
        defaultValue: '',
      },
      {
        key: 'language',
        title: '語言',
        type: 'input',
        description: '介面語言代碼，預設 cn（cn / en / ja / ko …）。',
        defaultValue: 'cn',
      },
      {
        key: 'host',
        title: '站點入口',
        type: 'input',
        description: '留空自動在 missav.ai / missav.ws / missav.live 之間選擇；也可手動填寫。',
        defaultValue: '',
      },
    ];
    for (const setting of settings) {
      try {
        await this.registerSetting(setting);
      } catch (error) {
        // older runtimes without a settings ui still work with the defaults
      }
    }
    try {
      await this.entry();
    } catch (error) {
      // the first real read retries and reports with context
    }
  }

  // ---------- session ----------

  async setting(key) {
    try {
      const value = await this.getSetting(key);
      return value === undefined || value === null ? '' : String(value).trim();
    } catch (error) {
      return '';
    }
  }

  // One field is often enough: "cookie: … ua: …", a "Copy as cURL" line and a
  // bare cf_clearance value are all accepted, and the user agent is pulled out
  // when it was pasted together with the cookie.
  parseCredentials(raw) {
    let text = (raw === undefined || raw === null ? '' : String(raw)).trim();
    if (!text) return { cookie: '', agent: '' };
    let agent = '';
    const uaMarker = text.search(/(?:^|[\s;])(?:ua|user-agent)\s*[:=]/i);
    if (uaMarker >= 0) {
      const after = text.slice(uaMarker).replace(/^[\s;]*(?:ua|user-agent)\s*[:=]\s*/i, '');
      const cookieMarker = after.search(/(?:^|[\s;])(?:cookie)\s*[:=]/i);
      agent = (cookieMarker >= 0 ? after.slice(0, cookieMarker) : after).trim().replace(/^['"]|['"]$/g, '');
      text = (cookieMarker >= 0 ? after.slice(cookieMarker) : text.slice(0, uaMarker)).trim();
    }
    return { cookie: this.normalizeCookie(text), agent: this.normalizeAgent(agent) };
  }

  // A bare cf_clearance value is a common paste mistake: the cookie header
  // needs the name. "Copy as cURL" pastes are accepted as well.
  normalizeCookie(value) {
    const raw = (value === undefined || value === null ? '' : String(value)).trim();
    if (!raw) return '';
    const curl = raw.match(/-H\s+['"]cookie:\s*([^'"]+)['"]/i);
    const text = (curl ? curl[1] : raw.replace(/^cookie:\s*/i, '')).trim();
    if (/^(?:[A-Za-z0-9_.-]+=[^;]*;?\s*)+$/.test(text)) return text;
    return `cf_clearance=${text}`;
  }

  normalizeAgent(value) {
    const raw = (value === undefined || value === null ? '' : String(value)).trim();
    if (!raw) return '';
    const curl = raw.match(/-H\s+['"]user-agent:\s*([^'"]+)['"]/i);
    return (curl ? curl[1] : raw.replace(/^user-agent:\s*/i, '')).trim();
  }

  async session() {
    this.state();
    // Settings can be edited while the plugin instance stays loaded, so the
    // snapshot is short lived: a saved cookie has to take effect without an app
    // restart. A challenge error drops it explicitly.
    const fresh = this._session && Date.now() - this._session.time < SESSION_TTL_MS;
    if (!fresh) {
      const pasted = this.parseCredentials(await this.setting('cookie'));
      const configuredAgent = this.normalizeAgent(await this.setting('user_agent'));
      this._session = {
        time: Date.now(),
        cookie: pasted.cookie,
        // the user agent may have been pasted together with the cookie
        agent: configuredAgent || pasted.agent,
        streamCookie: this.normalizeCookie(await this.setting('stream_cookie')),
        language: (await this.setting('language')).toLowerCase() || 'cn',
      };
    }
    return this._session;
  }

  async headers(agentOverride) {
    const session = await this.session();
    const headers = {
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    const agent = agentOverride || session.agent;
    // The app's dio CookieManager merges the request cookie with its jar using
    // the lowercase `cookie` key only, and replaces the header when the jar has
    // cookies for the host — so the clearance has to be present under that key,
    // otherwise the first CF response (which sets __cf_bm) hides it and every
    // later read is challenged. The capitalised copy is kept for clients that
    // read it directly.
    if (agent) headers['User-Agent'] = agent;
    if (session.cookie) {
      headers.cookie = session.cookie;
      headers.Cookie = session.cookie;
    }
    return headers;
  }

  // ---------- entry ----------

  async entry() {
    this.state();
    if (this._site) return this._site;
    if (this._entryPending) return this._entryPending;
    this._entryPending = this.resolveEntry().then(
      (site) => {
        this._site = site;
        this._entryPending = null;
        return site;
      },
      (error) => {
        this._entryPending = null;
        throw error;
      }
    );
    return this._entryPending;
  }

  async resolveEntry() {
    const queue = [];
    const seen = new Set();
    const push = (value) => {
      const site = this.normalizeEntry(value);
      if (!site || seen.has(site)) return;
      seen.add(site);
      queue.push(site);
    };
    push(await this.setting('host'));
    for (const known of KNOWN_ENTRIES) push(known);

    const failures = [];
    let challenged = 0;
    while (queue.length) {
      const site = queue.shift();
      const result = await this.probeEntry(site);
      if (result.ok) return site;
      if (result.reason === 'challenge') challenged++;
      const label = result.reason === 'challenge'
        ? '403 驗證'
        : result.reason === 'block'
          ? '403 攔截'
          : result.reason === 'page'
            ? '非預期頁面'
            : result.reason;
      failures.push(`${site.replace(/^https?:\/\//, '')} ${label}`);
    }
    // The app truncates long messages, so the diagnosis comes first and the
    // per-host detail afterwards.
    const head = failures.length && challenged === failures.length
      ? 'MissAV：Cloudflare 拒絕（驗證頁 403）'
      : 'MissAV：沒有可用入口';
    throw new Error(`${head}\n${await this.diagnosis()}\n各站：${failures.join(' · ')}`);
  }

  // Short, truncation resistant summary of what the app actually sent. The
  // user agent is reported with its length and both ends so it can be compared
  // with the string the browser sends, character for character.
  async diagnosis() {
    const session = await this.session();
    const cookie = session.cookie
      ? `Cookie ${session.cookie.length} 字元${session.cookie.indexOf('cf_clearance=') >= 0 ? '·含 cf_clearance' : '·缺少 cf_clearance 名稱'}`
      : 'Cookie 未設定';
    const agent = session.agent
      ? `UA ${session.agent.length} 字元（${session.agent.slice(0, 24)}…${session.agent.slice(-14)}）`
      : 'UA 未設定（本體預設）';
    const parts = [cookie, agent];
    const age = this.clearanceAge(session.cookie);
    if (age > 2 * 86400000) parts.push(`簽發於 ${Math.round(age / 86400000)} 天前`);
    const ip = await this.egressIp();
    if (ip) parts.push(`出口 ${ip}`);
    return parts.join('；');
  }

  // The public address the app itself leaves from, for comparison with the
  // browser that solved the challenge. Best effort only.
  async egressIp() {
    if (this._egress !== undefined) return this._egress;
    this._egress = '';
    try {
      const text = await this.request('https://www.cloudflare.com/cdn-cgi/trace', { timeoutMs: 8000 });
      const match = String(text).match(/^ip=([0-9a-f.:]+)$/im);
      if (match) this._egress = match[1];
    } catch (error) {
      this._egress = '';
    }
    return this._egress;
  }

  async probeEntry(site) {
    const session = await this.session();
    const lang = LANGUAGES.indexOf(session.language) >= 0 ? session.language : 'cn';
    const agents = [];
    if (session.agent) agents.push(session.agent);
    for (const candidate of FALLBACK_AGENTS) {
      if (agents.indexOf(candidate) < 0) agents.push(candidate);
    }
    if (!agents.length) agents.push('');

    let last = 'challenge';
    for (let index = 0; index < agents.length; index++) {
      const agent = agents[index];
      // Without a cookie a challenge is expected, so only the configured agent
      // is worth trying.
      if (index > 0 && !session.cookie) break;
      let body = '';
      try {
        body = await this.get(site, `/${lang}`, agent, false);
      } catch (error) {
        last = String(error && error.message ? error.message : error).replace(/\s+/g, ' ').slice(0, 40);
        continue;
      }
      const kind = this.challengeKind(body);
      if (kind) {
        last = kind;
        continue;
      }
      if (!/thumbnail group|dm\d+\//i.test(body)) {
        last = 'page';
        continue;
      }
      if (agent && agent !== session.agent) {
        // cf_clearance is bound to its user agent: remember the pair that
        // worked so the next start needs a single request.
        session.agent = agent;
        try {
          await this.setSetting('user_agent', agent);
        } catch (error) {
          // read-only settings must not break browsing
        }
      }
      this._lang = lang;
      return { ok: true, reason: '' };
    }
    return { ok: false, reason: last };
  }

  normalizeEntry(value) {
    const text = (value === undefined || value === null ? '' : String(value)).trim();
    if (!text) return '';
    const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const match = withScheme.match(/^https?:\/\/([^/?#:]+)(?::\d+)?\/?$/i);
    if (!match) return '';
    const host = match[1].toLowerCase();
    if (!HOSTS.test(host)) return '';
    return `https://${host}`;
  }

  currentSite() {
    return this._site || DEFAULT_ENTRY;
  }

  async language() {
    if (this._lang) return this._lang;
    const session = await this.session();
    return LANGUAGES.indexOf(session.language) >= 0 ? session.language : 'cn';
  }

  // ---------- helpers ----------

  absolute(url) {
    const value = (url || '').trim();
    if (!value) return '';
    if (/^\/\//.test(value)) return `https:${value}`;
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

  // Two different Cloudflare answers are worth telling apart: the managed
  // challenge (needs a session) and a hard block (needs another route).
  challengeKind(body) {
    const text = String(body || '');
    if (/Just a moment|cf-challenge|challenges\.cloudflare\.com/i.test(text)) return 'challenge';
    if (/Attention Required|cf-error-code|cf-error-details/i.test(text)) return 'block';
    return '';
  }

  challenged(body) {
    return this.challengeKind(body) !== '';
  }

  // Work urls are `/<lang>/<code>` and may carry a rotating `/dm<N>` prefix.
  parseWork(path) {
    const text = String(path || '');
    const match = text.match(/^\/(?:dm\d+\/)?([a-z]{2})\/([^/?#]+)\/?$/i);
    if (!match) return '';
    const lang = match[1].toLowerCase();
    if (LANGUAGES.indexOf(lang) < 0) return '';
    const slug = match[2];
    const lower = slug.toLowerCase();
    if (RESERVED_SLUGS.indexOf(lower) >= 0) return '';
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) return '';
    // title codes carry digits: mina-019, dvmm-458, fc2-ppv-4997591, 123456_001
    if (!/-\d/.test(slug) && !/^\d{6}[_-]/.test(slug)) return '';
    return `/${lang}/${slug}`;
  }

  // ---------- channels ----------

  async channels() {
    return SECTIONS.map((section) => ({ title: section.title, key: section.key }));
  }

  async latest(page, channel) {
    const number = this.pageNumber(page);
    const key = (channel === undefined || channel === null ? '' : String(channel)).trim();
    const section = SECTIONS.find((item) => item.key === key) || SECTIONS[0];
    const lang = await this.language();
    const path = `/${lang}/${section.key}${number > 1 ? `?page=${number}` : ''}`;
    return this.cards(await this.page(path));
  }

  async search(kw, page) {
    const keyword = (kw === undefined || kw === null ? '' : String(kw)).trim();
    if (!keyword) return [];
    const number = this.pageNumber(page);
    const lang = await this.language();
    const path = `/${lang}/search/${encodeURIComponent(keyword)}${number > 1 ? `?page=${number}` : ''}`;
    return this.cards(await this.page(path));
  }

  // Cards are `div.thumbnail.group` blocks; the anchor, the lazy image and the
  // duration badge live inside, so the section links around them are ignored.
  cards(html) {
    const source = String(html);
    const blocks = source.split(/class="thumbnail group"/).slice(1);
    const items = [];
    const seen = new Set();
    for (const block of blocks) {
      const anchor = (block.match(/<a\b[^>]*href="([^"]+)"[^>]*>/i) || [])[1] || '';
      const path = this.parseWork(anchor.replace(/^https?:\/\/[^/]+/i, ''));
      if (!path || seen.has(path)) continue;
      const image = block.match(/<img\b[^>]*>/i);
      const cover = image ? this.absolute(this.attrValue(image[0], 'data-src') || this.attrValue(image[0], 'src')) : '';
      const title = this.textOf(image ? this.attrValue(image[0], 'alt') : '')
        || this.textOf((block.match(/class="my-2 text-sm[^"]*"[^>]*>([\s\S]{0,200}?)</i) || [])[1] || '');
      const duration = this.textOf((block.match(/bottom-1 right-1[^"]*"[^>]*>([^<]{0,20})</i) || [])[1]);
      seen.add(path);
      items.push({ title: title || path.split('/').pop(), url: path, cover, update: duration });
    }
    return items;
  }

  // ---------- detail ----------

  async detail(url) {
    const target = this.target(url);
    const html = await this.page(target.path);
    const title = this.textOf(this.meta(html, 'og:title')).replace(/\s*[-|]\s*MissAV.*$/i, '')
      || this.textOf((html.match(/<h1[^>]*>([\s\S]{0,200}?)<\/h1>/i) || [])[1] || '')
      || target.slug;
    const cover = this.absolute(this.meta(html, 'og:image')) || this.coverFor(target.slug);
    const desc = this.textOf(this.meta(html, 'og:description'));
    return {
      title,
      cover,
      desc,
      episodes: [{
        title: '畫質',
        urls: [
          { name: '1080p', url: `${target.path}#1080p` },
          { name: '720p', url: `${target.path}#720p` },
          { name: '預設', url: target.path },
        ],
      }],
    };
  }

  coverFor(slug) {
    return slug ? `https://fourhoi.com/${encodeURIComponent(slug)}/cover-t.jpg` : '';
  }

  target(url) {
    const text = (url === undefined || url === null ? '' : String(url)).trim();
    if (!text) throw new Error('無效的影片地址：' + text);
    if (/^https?:\/\//i.test(text)) {
      const host = (text.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || '';
      if (!HOSTS.test(host)) throw new Error('無效的影片地址：' + text);
    }
    const quality = (text.match(/#(\d{3,4}p)\s*$/i) || [])[1] || '';
    const raw = text.replace(/#.*$/, '').replace(/^https?:\/\/[^/]+/i, '').replace(/[?].*$/, '');
    const path = this.parseWork(raw);
    if (!path) throw new Error('無法解析影片地址：' + text);
    return { path, slug: path.split('/').pop(), quality };
  }

  // ---------- playback ----------

  async watch(url) {
    const target = this.target(url);
    const html = await this.page(target.path);
    const stream = await this.streamFor(html, target.quality);
    if (!stream) {
      throw new Error(
        '這個頁面找不到播放地址。\n'
        + '若列表能打開而這裡失敗，通常是 Cookie 過期（cf_clearance 只有效數小時到數天），'
        + '重新從瀏覽器複製一次即可。'
      );
    }
    return stream;
  }

  async streamFor(html, quality) {
    // The page escapes every slash inside its scripts, so the lookups run on a
    // cooked copy.
    const source = String(html || '').replace(/\\\//g, '/');
    const session = await this.session();
    // The uuid is printed in the thumbnail strip even though the play urls are
    // assembled by the page's own script.
    const uuid = (source.match(/surrit\.com\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i) || [])[1];
    const headers = { Referer: 'https://missav.ai/' };
    if (session.streamCookie) headers.Cookie = session.streamCookie;
    if (!uuid) {
      const direct = (source.match(/["'](https?:\/\/[^"'\s]+?\.m3u8[^"'\s]*)["']/i) || [])[1];
      if (!direct) return null;
      return { type: 'hls', url: this.absolute(direct), headers };
    }
    const base = `https://surrit.com/${uuid}`;
    const wanted = (quality || '').toLowerCase();
    const order = wanted === '720p'
      ? [`${base}/720p/video.m3u8`, `${base}/1080p/video.m3u8`, `${base}/source842.m3u8`]
      : wanted === '1080p'
        ? [`${base}/1080p/video.m3u8`, `${base}/720p/video.m3u8`, `${base}/source842.m3u8`]
        : [`${base}/source842.m3u8`, `${base}/1080p/video.m3u8`, `${base}/720p/video.m3u8`];
    // Quality variants are all served by the same host; the player takes the
    // first and reports a fetch error if that variant is not published.
    return { type: 'hls', url: order[0], headers };
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

  // cf_clearance embeds its issue time: <hash>-<epoch>-1.2.1.1-<payload>.
  // Returns the age in milliseconds, or 0 when the value does not carry one.
  clearanceAge(value) {
    const match = String(value || '').match(/(?:cf_clearance=)?[A-Za-z0-9_.]+-(\d{10})(?:-|$)/);
    if (!match) return 0;
    const age = Date.now() - parseInt(match[1], 10) * 1000;
    return age > 0 ? age : 0;
  }

  async get(site, path, agentOverride, diagnose) {
    this.state();
    const pace = () => {
      const wait = this._lastRequest + PAGE_GAP_MS - Date.now();
      return wait > 0 ? this.sleep(wait) : Promise.resolve();
    };
    this._queue = this._queue.then(pace, pace).then(() => {
      this._lastRequest = Date.now();
    });
    await this._queue;

    // The app throws on 4xx unless the source opts in, and the challenge page
    // *is* a 403: ask for the body so the failure can be explained instead of
    // bubbling up as a bare status code.
    const text = await this.request(site + path, {
      headers: await this.headers(agentOverride),
      allowErrorStatus: true,
    });
    const body = typeof text === 'string' ? text : JSON.stringify(text);
    if (this.challenged(body)) {
      const kind = this.challengeKind(body) === 'block' ? '攔截頁' : '驗證頁';
      // The next attempt must re-read the settings: the user may have just
      // pasted a fresh clearance.
      const summary = diagnose === false ? 'Cloudflare 驗證' : await this.diagnosis();
      this._session = null;
      // Kept short on purpose: the app truncates long error messages.
      throw new Error(`MissAV：Cloudflare ${kind} 403\n${summary}`);
    }
    return body;
  }

  async fetchPage(path) {
    const site = await this.entry();
    return this.get(site, path);
  }
}
