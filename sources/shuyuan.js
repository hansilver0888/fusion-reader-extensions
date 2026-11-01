// ==MiruExtension==
// @name         书源引擎
// @version      v0.1.0
// @author       FusionReader
// @lang         zh
// @license      MIT
// @package      shuyuan
// @type         fikushon
// @icon         https://raw.githubusercontent.com/shidahuilang/shuyuan-bak/main/icons/shuyuan.png
// @webSite      https://github.com/shidahuilang/shuyuan-bak
// @network      auto
// @nsfw         false
// ==/MiruExtension==
// Legado（阅读3.0）书源引擎：运行时加载书源仓库（如 shidahuilang/shuyuan-bak
// 每 3 天自动校验更新的 good.json）分发的书源 JSON 数据，用声明式规则子集解析。
// 书源规则属于第三方数据，各书源版权归原作者；本脚本不包含第三方代码。
// 安全边界：不执行书源或网页中的任何 JS/Java 片段。含 <js>、@js:、java.* 等
// 依赖脚本的书源在加载时被整体过滤，不会被解释或运行。

const DEFAULT_SOURCE_URL = 'https://raw.githubusercontent.com/shidahuilang/shuyuan-bak/refs/heads/main/good.json';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
// 出现任一标记即认为书源依赖脚本执行，加载时整源过滤。
const JS_MARK = /<js[\s>]|@js:|\bjava\s*\.|jsLib|webView|startBrowser|cookie\s*\.|org\.jsoup|\{\{[^}]*[A-Za-z_$][\w$]*\s*\(/i;
const SOURCE_TTL = 30 * 60 * 1000;
const MAX_CHANNELS = 60;
const MAX_TOC_PAGES = 150;
const MAX_TOC_ITEMS = 8000;
const MAX_CONTENT_PAGES = 20;
const MAX_ITEMS = 100;
const ATTR_WORDS = new Set(['href', 'src', 'content', 'value', 'alt', 'title', 'action', 'id', 'class', 'style',
  'data-src', 'data-original', 'data-url', 'data-echo', 'poster', 'url']);
const TEXT_WORDS = new Set(['text', 'textNodes', 'html', 'own', 'all']);

export default class extends Extension {
  _listCache = null;     // { time, url, list }
  _selectedCache = null; // { url, name, src }
  _vars = new Map();     // @put/@get 变量，键含书源与作品地址

  async load() {
    await this.registerSetting({
      title: '书源 JSON 地址', key: 'sourceUrl', type: 'input',
      description: '阅读(Legado)格式书源合集链接，默认使用 shuyuan-bak 的验证书源 good.json（约 16MB，首次加载较慢，建议在网络良好时使用，或改填较小的书源合集链接）',
      defaultValue: DEFAULT_SOURCE_URL,
    });
    await this.registerSetting({
      title: '书源名称', key: 'sourceName', type: 'input',
      description: '要使用的书源名称或其片段（如「速读谷」），也可填书源域名片段；留空则使用列表中第一个可用书源',
      defaultValue: '',
    });
  }

  // ---------- 小工具 ----------

  text(value) {
    return this.decodeEntities(String(value ?? '')).replace(/\s+/g, ' ').trim();
  }

  host(url) {
    const m = String(url ?? '').match(/^https?:\/\/([^\/?#]+)/i);
    return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
  }

  abs(base, ref) {
    const value = String(ref ?? '').trim();
    if (!value || /^(?:data|javascript):/i.test(value)) return '';
    let url = this.absoluteUrl(String(base ?? ''), value);
    // 宿主的 absoluteUrl 不规范化 ./ 与 ../ 路径段，这里补上。
    const m = url.match(/^(https?:\/\/[^/?#]+)(\/[^?#]*)(.*)$/);
    if (m && (m[2].includes('/./') || m[2].includes('/../') || m[2].endsWith('/..') || m[2].endsWith('/.'))) {
      const out = [];
      for (const seg of m[2].split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') out.pop();
        else out.push(seg);
      }
      url = m[1] + '/' + out.join('/') + (m[2].endsWith('/') && out.length ? '/' : '') + m[3];
    }
    return /^https?:\/\//i.test(url) ? url : '';
  }

  plain(value) {
    if (Array.isArray(value)) return value.map((v) => (this.isEl(v) ? '' : String(v ?? ''))).filter(Boolean).join('\n');
    if (this.isEl(value)) return '';
    return String(value ?? '');
  }

  isEl(value) {
    return Boolean(value) && typeof value.getAttributeText === 'function';
  }

  stripTags(html) {
    return this.decodeEntities(String(html ?? '')
      .replace(/<\s*br\s*\/?\s*>/gi, '\n')
      .replace(/<\/\s*(?:p|div|h[1-6]|li|tr|section|article)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ''))
      .split('\n').map((s) => s.replace(/[ \t\u3000]+/g, ' ').trim()).filter(Boolean).join('\n');
  }

  rawUrl(url) {
    // GitHub 网页链接自动转 raw 直链，方便直接粘贴仓库文件页地址。
    const m = String(url ?? '').trim().match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
    return String(url ?? '').trim();
  }

  looseJson(text) {
    try { return JSON.parse(text); } catch (_) { /* 继续宽松解析 */ }
    let t = String(text).replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":').replace(/'/g, '"');
    try { return JSON.parse(t); } catch (_) { return null; }
  }

  // ---------- 书源加载与选择 ----------

  ruleObj(src, key) {
    const v = src ? src[key] : null;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  usable(src) {
    if (!src || typeof src !== 'object') return false;
    if (src.enabled === false) return false;
    if (Number(src.bookSourceType || 0) !== 0) return false;
    if (!this.host(src.bookSourceUrl)) return false;
    const search = this.ruleObj(src, 'ruleSearch'), explore = this.ruleObj(src, 'ruleExplore');
    const toc = this.ruleObj(src, 'ruleToc'), content = this.ruleObj(src, 'ruleContent');
    const fields = [src.searchUrl, src.exploreUrl, src.loginUrl, src.loginCheckJs, src.jsLib, src.header,
      ...[search, explore, this.ruleObj(src, 'ruleBookInfo'), toc, content].flatMap((r) => Object.values(r))];
    if (fields.some((f) => typeof f === 'string' && JS_MARK.test(f))) return false;
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const hasSearch = str(src.searchUrl) && str(search.bookList);
    const hasExplore = str(src.exploreUrl) && (str(explore.bookList) || str(search.bookList));
    if (!hasSearch && !hasExplore) return false;
    // 目录与正文规则齐备才收录，保证搜到的书都能打开阅读。
    return Boolean(str(toc.chapterList) && str(content.content));
  }

  async sourceList(force) {
    const url = this.rawUrl((await this.getSetting('sourceUrl')) || DEFAULT_SOURCE_URL);
    if (!/^https?:\/\//i.test(url)) throw new Error('书源地址无效，请在插件设置中填写 http(s) 链接。');
    const cache = this._listCache;
    if (!force && cache && cache.url === url && Date.now() - cache.time < SOURCE_TTL) return cache.list;
    let data;
    try {
      data = await this.request(url, { headers: { 'User-Agent': DEFAULT_UA } });
    } catch (e) {
      if (cache && cache.url === url) return cache.list; // 网络失败时沿用旧列表
      throw new Error('书源列表下载失败，请检查网络或书源地址。');
    }
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (_) { throw new Error('书源文件不是有效的 JSON。'); }
    }
    if (!Array.isArray(data)) {
      if (data && Array.isArray(data.data)) data = data.data;
      else if (data && data.bookSourceUrl) data = [data];
      else throw new Error('书源文件格式不正确：需要阅读(Legado)书源数组。');
    }
    const list = [];
    const seen = new Set();
    for (const src of data) {
      if (!this.usable(src)) continue;
      const key = String(src.bookSourceUrl);
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(src);
    }
    if (!list.length) throw new Error('书源列表中没有本插件可解析的书源（可能全部依赖 JS 规则）。');
    this._listCache = { time: Date.now(), url, list };
    this._selectedCache = null;
    return list;
  }

  async selectedSource() {
    const url = this.rawUrl((await this.getSetting('sourceUrl')) || DEFAULT_SOURCE_URL);
    const name = String((await this.getSetting('sourceName')) || '').trim();
    const cache = this._selectedCache;
    if (cache && cache.url === url && cache.name === name) return cache.src;
    const list = await this.sourceList(false);
    let src = null;
    if (name) {
      src = list.find((s) => s.bookSourceName === name)
        || list.find((s) => String(s.bookSourceName || '').includes(name))
        || list.find((s) => String(s.bookSourceUrl || '').includes(name));
      if (!src) throw new Error(`没有找到名称或地址包含「${name}」的可用书源，请检查设置。`);
    } else {
      src = list[0];
    }
    this._selectedCache = { url, name, src };
    return src;
  }

  sourceForUrl(url) {
    const h = this.host(url);
    const list = (this._listCache && this._listCache.list) || [];
    return h ? list.find((s) => this.host(s.bookSourceUrl) === h) || null : null;
  }

  // 详情/正文按作品地址的 host 匹配书源；列表未加载时先加载再匹配，
  // 保证从书架直接打开旧链接也能落到正确的书源上。
  async resolveSource(url) {
    let src = this.sourceForUrl(url);
    if (src) return src;
    try { await this.sourceList(false); } catch (_) { /* 网络失败时走选定书源兜底 */ }
    src = this.sourceForUrl(url);
    if (src) return src;
    return this.selectedSource();
  }

  headers(src, referer) {
    const h = { 'User-Agent': DEFAULT_UA };
    const block = typeof (src && src.header) === 'string' ? src.header.trim() : '';
    if (block.startsWith('{')) {
      const obj = this.looseJson(block);
      if (obj && typeof obj === 'object') {
        for (const entry of Object.entries(obj)) {
          if (typeof entry[1] === 'string' && entry[1]) h[entry[0]] = entry[1];
        }
      }
    } else if (block) {
      let matched = false;
      for (const line of block.split(/\r?\n/)) {
        const m = line.match(/^\s*"?([\w-]+)"?\s*[:：]\s*"?([^"\r\n]*?)"?,?\s*$/);
        if (m && /^[\w-]+$/.test(m[1]) && m[2]) { h[m[1]] = m[2]; matched = true; }
      }
      if (!matched && /mozilla/i.test(block)) h['User-Agent'] = block.split(/\r?\n/)[0].trim();
    }
    if (referer) h.Referer = referer;
    return h;
  }

  async fetch(src, url) {
    return this.request(url, { headers: this.headers(src, url) });
  }

  // ---------- 模板与地址 ----------

  // 受限四则运算（+ - * / % 与括号），替代 eval：模板表达式来自第三方书源数据。
  calc(expr) {
    const text = String(expr).replace(/\s+/g, '');
    if (!text) return null;
    const tokens = text.match(/\d+(?:\.\d+)?|[+\-*/%()]/g);
    if (!tokens || tokens.join('') !== text) return null;
    const values = [];
    const ops = [];
    const prec = (op) => ((op === '+' || op === '-') ? 1 : 2);
    const apply = () => {
      const op = ops.pop();
      const b = values.pop();
      const a = values.pop();
      if (a == null || b == null) throw new Error('表达式不完整');
      values.push(op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' ? a / b : a % b);
    };
    for (const t of tokens) {
      if (/[\d.]/.test(t)) values.push(parseFloat(t));
      else if (t === '(') ops.push(t);
      else if (t === ')') {
        while (ops.length && ops[ops.length - 1] !== '(') apply();
        if (!ops.length) return null;
        ops.pop();
      } else {
        while (ops.length && ops[ops.length - 1] !== '(' && prec(ops[ops.length - 1]) >= prec(t)) apply();
        ops.push(t);
      }
    }
    while (ops.length) apply();
    return values.length === 1 && Number.isFinite(values[0]) ? values[0] : null;
  }

  async templateValue(inner, ctx) {
    const t = String(inner).trim();
    if (t === 'baseUrl') return ctx.baseUrl || '';
    if (t === 'key') return ctx.encodedKey != null ? ctx.encodedKey : String(ctx.key ?? '');
    if (t.startsWith('@@')) return this.plain(await this.evalRule(t.slice(2), ctx));
    const substituted = t.replace(/\bpage\b/g, String(Number(ctx.page) || 1));
    const value = this.calc(substituted);
    if (value != null) return String(value);
    return this.plain(await this.evalRule(t, ctx));
  }

  async fillTemplate(str, ctx) {
    let s = String(str ?? '');
    // Legado 的 <a,b> 是“按页变体”段：逗号分隔，第 N 页取第 N 项，超出取最后
    // 一项（首项通常为空，实现第一页不带分页参数）；逗号本身不进入 URL。
    // 变体选择在 {{}} 替换之前完成，关键词中的逗号不会切错变体。
    s = s.replace(/<([^<>]*)>/g, (_, inner) => {
      const variants = inner.split(',');
      const p = Math.max(1, Number(ctx.page) || 1);
      return (p <= variants.length ? variants[p - 1] : variants[variants.length - 1]).trim();
    });
    let out = '';
    let last = 0;
    let m;
    const re = /\{\{([\s\S]*?)\}\}/g;
    while ((m = re.exec(s)) !== null) {
      out += s.slice(last, m.index);
      out += await this.templateValue(m[1], ctx);
      last = m.index + m[0].length;
    }
    return out + s.slice(last);
  }

  searchUrlOf(src) {
    let s = String((src && src.searchUrl) || '').trim();
    if (s.startsWith('[')) {
      const arr = this.looseJson(s);
      if (Array.isArray(arr) && arr.length && arr[0] && typeof arr[0] === 'object') s = String(arr[0].url || '').trim();
    }
    return s;
  }

  async buildUrl(template, ctx) {
    let s = String(template || '').trim();
    let opts = null;
    const m = s.match(/,\s*(\{[\s\S]*\})\s*$/);
    if (m) {
      opts = this.looseJson(m[1]);
      s = s.slice(0, m.index).trim();
    }
    if (/^<js[\s>]|^@js:/i.test(s)) throw new Error('该地址规则依赖 JS，本插件不支持。');
    const urlCtx = Object.assign({}, ctx, { encodedKey: ctx.key != null ? encodeURIComponent(String(ctx.key)) : undefined });
    const url = this.abs(ctx.baseUrl, await this.fillTemplate(s, urlCtx));
    if (!url) throw new Error('书源地址解析失败。');
    const headers = this.headers(ctx.source);
    if (opts && typeof opts.headers === 'object' && opts.headers) Object.assign(headers, opts.headers);
    if (opts && typeof opts.headers === 'string') {
      const extra = this.looseJson(opts.headers);
      if (extra && typeof extra === 'object') Object.assign(headers, extra);
    }
    const method = String((opts && opts.method) || 'get').toLowerCase();
    if (method !== 'post') return { url, method: 'get', headers };
    const contentType = String(headers['Content-Type'] || headers['content-type'] || '');
    // JSON 请求体中的关键词做 JSON 转义，表单请求体做 URL 编码。
    const encoded = /json/i.test(contentType)
      ? JSON.stringify(String(ctx.key ?? '')).slice(1, -1)
      : encodeURIComponent(String(ctx.key ?? ''));
    const bodyCtx = Object.assign({}, ctx, { encodedKey: encoded });
    const body = await this.fillTemplate(String((opts && opts.body) ?? ''), bodyCtx);
    if (!contentType) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return { url, method: 'post', headers, data: body };
  }

  exploreChannels(src) {
    const raw = String((src && src.exploreUrl) || '').trim();
    if (!raw) return [];
    if (raw.startsWith('[')) {
      const arr = this.looseJson(raw);
      if (!Array.isArray(arr)) return [];
      const out = [];
      for (const x of arr) {
        if (x && typeof x === 'object' && String(x.title || '').trim() && String(x.url || '').trim()) {
          out.push({ title: String(x.title).trim(), key: String(x.url).trim() });
        }
      }
      return out.slice(0, MAX_CHANNELS);
    }
    const out = [];
    for (const line of raw.split(/\r?\n|&&/)) {
      const t = line.trim();
      if (!t) continue;
      const m = t.match(/^([^:]+)::(.+)$/);
      if (m && m[1].trim() && m[2].trim()) out.push({ title: m[1].trim(), key: m[2].trim() });
    }
    return out.slice(0, MAX_CHANNELS);
  }

  // ---------- 规则引擎 ----------

  splitRegex(rule) {
    const s = String(rule ?? '');
    const i = s.indexOf('##');
    if (i < 0) return { body: s.trim() };
    const rest = s.slice(i + 2).split('##');
    // Legado 常见写法 “##正则##$1###” 的第三段可能残留 '#'，仅保留合法标志。
    return { body: s.slice(0, i).trim(), regex: rest[0] ?? '', repl: rest[1] ?? '',
      flags: String(rest[2] ?? '').replace(/[^gimsuy]/g, '') };
  }

  applyRegex(value, parts) {
    if (!parts || !parts.regex) return value;
    let re;
    try {
      re = new RegExp(parts.regex, (String(parts.flags || '').replace(/[^gimsuy]/g, '')) || 'g');
    } catch (_) {
      return value; // 无效正则按原文处理，避免整源失败
    }
    const one = (v) => {
      if (this.isEl(v) || (v && typeof v === 'object')) return v;
      try { return String(v ?? '').replace(re, String(parts.repl ?? '')); } catch (_) { return String(v ?? ''); }
    };
    return Array.isArray(value) ? value.map(one) : one(value);
  }

  varKey(ctx, name) {
    return `${(ctx.source && ctx.source.bookSourceUrl) || ''}|${ctx.bookUrl || ''}|${name}`;
  }

  unesc(s) {
    try { return JSON.parse('"' + s + '"'); } catch (_) { return String(s).replace(/\\"/g, '"'); }
  }

  async putVars(rule, ctx) {
    const m = String(rule).match(/@put:\s*\{([\s\S]*)\}/i);
    if (!m) return '';
    const pairs = m[1].matchAll(/"?([\w$-]+)"?\s*:\s*"((?:[^"\\]|\\.)*)"/g);
    for (const p of pairs) {
      this._vars.set(this.varKey(ctx, p[1]), await this.evalRule(this.unesc(p[2]), ctx));
    }
    return '';
  }

  getVar(rule, ctx) {
    const m = String(rule).match(/@get:\s*\{\s*"?([\w$-]+)"?\s*\}/i);
    if (!m) return '';
    const v = this._vars.get(this.varKey(ctx, m[1]));
    return v == null ? '' : v;
  }

  async evalRule(rule, ctx) {
    const s = String(rule ?? '').trim();
    if (!s) return '';
    if (/<js[\s>]|@js:/i.test(s)) return ''; // 防御：可用书源已过滤，此处兜底
    const parts = this.splitRegex(s);
    let value;
    if (!parts.body) {
      // 只有 ##正则 时，Legado 语义是对整个页面源文本做提取。
      value = typeof ctx.html === 'string' ? ctx.html : '';
    } else {
      value = await this.evalBody(parts.body, ctx);
    }
    if (parts.regex) value = this.applyRegex(value, parts);
    return this.plain(value);
  }

  async evalList(rule, ctx) {
    const s = String(rule ?? '').trim();
    if (!s || /<js[\s>]|@js:/i.test(s)) return [];
    const parts = this.splitRegex(s);
    let value = parts.body ? await this.evalBody(parts.body, ctx) : [];
    if (!Array.isArray(value)) value = value === '' || value == null ? [] : [value];
    if (parts.regex) value = this.applyRegex(value, parts);
    return value;
  }

  async evalBody(body, ctx) {
    const b = String(body ?? '').trim();
    if (!b) return '';
    if (b.includes('{{')) return this.fillTemplate(b, ctx);
    if (/^@put:/i.test(b)) return this.putVars(b, ctx);
    if (/^@get:/i.test(b)) return this.getVar(b, ctx);
    if (b.includes('&&')) {
      const parts = [];
      for (const p of b.split('&&')) {
        const v = this.plain(await this.evalBody(p, ctx));
        if (v) parts.push(v);
      }
      return parts.join('\n');
    }
    if (b.includes('||')) {
      for (const p of b.split('||')) {
        const v = await this.evalBody(p.trim(), ctx);
        if (Array.isArray(v) ? v.length : this.plain(v) !== '') return v;
      }
      return '';
    }
    return this.evalOne(b, ctx);
  }

  async evalOne(rule, ctx) {
    const r = String(rule).trim();
    if (/^@xpath:/i.test(r) || r.startsWith('//')) return this.evalXPath(r.replace(/^@xpath:/i, ''), ctx);
    if (/^@json:/i.test(r)) return this.evalJsonPath(r.replace(/^@json:/i, '').trim(), ctx);
    if (r.startsWith('$.') || r.startsWith('$[')) return this.evalJsonPath(r, ctx);
    return this.evalJsoup(r.replace(/^@css:/i, ''), ctx);
  }

  async nodesOf(ctx) {
    if (ctx.item != null) return [ctx.item];
    if (typeof ctx.html === 'string') return [{ __html: ctx.html }];
    return [];
  }

  parseIndex(spec) {
    if (spec == null || spec === '') return null;
    const m = String(spec).match(/^(-?\d+)(?::(-?\d+))?$/);
    if (!m) return null;
    return { from: Number(m[1]), to: m[2] != null ? Number(m[2]) : null };
  }

  pickIndex(list, idx) {
    if (!idx || !list.length) return list;
    const n = list.length;
    const norm = (i) => (i < 0 ? n + i : i);
    if (idx.to != null) return list.slice(Math.max(0, norm(idx.from)), Math.min(n, norm(idx.to) + 1));
    const i = norm(idx.from);
    return i >= 0 && i < n ? [list[i]] : [];
  }

  // 解析一个 Legado 默认（jsoup）规则段：class./tag./id. 前缀、裸标签、
  // text.内容 匹配、原生 CSS，以及 .N / .-1 / .N:M 索引与 :contains()/:eq()。
  parseSegment(seg) {
    let s = String(seg).trim();
    if (!s) return null;
    let contains = null;
    const cm = s.match(/:contains\((['"]?)([\s\S]*?)\1\)/);
    if (cm) { contains = cm[2]; s = s.replace(cm[0], ''); }
    let eq = null;
    const em = s.match(/:eq\((\d+)\)/);
    if (em) { eq = Number(em[1]); s = s.replace(em[0], ''); }
    const jm = s.match(/^(class|tag|id)\.([\s\S]+)$/i);
    if (jm) {
      let name = jm[2];
      let index = null;
      const im = name.match(/\.(-?\d+(?::-?\d+)?)$/);
      if (im) { name = name.slice(0, im.index); index = im[1]; }
      const names = name.trim().split(/\s+/).filter(Boolean);
      if (!names.length) return null;
      const kind = jm[1].toLowerCase();
      const css = kind === 'class' ? names.map((c) => '.' + c).join('')
        : kind === 'id' ? '#' + names[0]
          : names.join(' ');
      return { selector: css, contains, index: this.parseIndex(index), eq, name: names[0] };
    }
    const tm = s.match(/^text(?:Nodes)?\.(.+)$/);
    if (tm) return { selector: 'a', contains: tm[1].trim(), textMatch: true, index: null, eq: null, name: '' };
    const bm = s.match(/^([A-Za-z][\w-]*)((?:\.-?\d+(?::-?\d+)?)?)$/);
    if (bm && !ATTR_WORDS.has(bm[1]) && !TEXT_WORDS.has(bm[1])) {
      return { selector: bm[1], contains, index: this.parseIndex(bm[2] ? bm[2].slice(1) : null), eq, name: bm[1] };
    }
    return { selector: s, contains, index: null, eq, name: '' };
  }

  async querySafe(html, selector) {
    if (!html || !selector) return [];
    try {
      return await this.querySelectorAll(html, selector);
    } catch (_) {
      return []; // 宿主不支持的选择器按无结果处理
    }
  }

  async filterText(found, contains) {
    if (contains == null) return found;
    const kept = [];
    for (const el of found) {
      if ((await el.text).includes(contains)) kept.push(el);
    }
    return kept;
  }

  async evalJsoup(rule, ctx) {
    const segments = String(rule).split('@').map((s) => s.trim()).filter((s) => s !== '');
    if (!segments.length) return '';
    let extract = null;
    const last = segments[segments.length - 1];
    if (segments.length && (TEXT_WORDS.has(last) || ATTR_WORDS.has(last))) {
      extract = last;
      segments.pop();
    }
    let nodes = await this.nodesOf(ctx);
    for (const seg of segments) {
      if (!nodes.length) break;
      const step = this.parseSegment(seg);
      if (!step) continue;
      const next = [];
      for (const node of nodes) {
        if (this.isEl(node) || (node && node.__html != null)) {
          const html = node.__html != null ? node.__html : await node.content;
          let found = await this.querySafe(html, step.selector);
          if (step.textMatch && !found.length) {
            found = await this.querySafe(html, 'li,span,div,p,font,button');
          }
          found = await this.filterText(found, step.contains);
          if (step.eq != null) found = this.pickIndex(found, { from: step.eq });
          if (step.index) found = this.pickIndex(found, step.index);
          next.push(...found);
        } else if (node && typeof node === 'object' && step.name) {
          // JSON 条目上出现的 jsoup 段按属性名回退读取。
          const v = node[step.name];
          if (v != null) next.push(typeof v === 'object' ? v : String(v));
        }
      }
      nodes = next;
    }
    const vals = await this.extractNodes(nodes, extract);
    if (extract == null) return vals;
    if (vals.length === 1) return vals[0];
    return vals.map((v) => String(v ?? '')).filter(Boolean).join('\n');
  }

  async extractNodes(nodes, extract) {
    const out = [];
    for (const node of nodes) {
      if (this.isEl(node)) {
        if (extract == null) { out.push(node); continue; }
        if (TEXT_WORDS.has(extract)) {
          if (extract === 'html') out.push(await node.content);
          else out.push(this.decodeEntities(String(await node.text ?? '')).trim());
        } else {
          const v = await node.getAttributeText(extract);
          out.push(v == null ? '' : String(v).trim());
        }
        continue;
      }
      if (node && typeof node === 'object' && node.__html != null) {
        if (extract == null) out.push(node.__html);
        else if (extract === 'html') out.push(node.__html);
        else if (TEXT_WORDS.has(extract)) out.push(this.stripTags(node.__html));
        else {
          const m = String(node.__html).match(new RegExp('\\b' + extract.replace(/[-]/g, '\\-') + '\\s*=\\s*["\']([^"\']*)["\']', 'i'));
          out.push(m ? m[1] : '');
        }
        continue;
      }
      if (node && typeof node === 'object') {
        if (extract == null) out.push(node);
        else if (extract === 'html') out.push(JSON.stringify(node));
        else if (TEXT_WORDS.has(extract)) out.push(String(node.name ?? node.text ?? node.title ?? ''));
        else out.push(node[extract] != null ? String(node[extract]) : '');
        continue;
      }
      if (extract == null) out.push(node);
      else out.push(String(node ?? ''));
    }
    return out;
  }

  // XPath 子集：//tag[@attr='v'][contains(text(),'x')][last()-N]/@href 等常见写法，
  // 逐段翻译为 CSS 并步进查询；不支持的谓词按忽略处理。
  parseXPath(expr) {
    let s = String(expr).trim();
    const descendant = s.startsWith('//');
    s = s.replace(/^\/+/, '');
    const steps = [];
    let cur = '';
    let depth = 0;
    let quote = null;
    for (const ch of s) {
      if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === '[') depth++;
      else if (ch === ']') depth--;
      if (ch === '/' && depth === 0) { steps.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur) steps.push(cur);
    const parsed = [];
    let nextDesc = descendant;
    for (const st of steps) {
      if (st === '') { nextDesc = true; continue; }
      const p = this.parseXPathStep(st);
      if (!p) continue;
      p.descendant = nextDesc;
      nextDesc = false;
      parsed.push(p);
    }
    return parsed;
  }

  parseXPathStep(step) {
    const s = String(step).trim();
    if (s === 'text()' || s === 'normalize-space()') return { tag: null, extract: 'text' };
    const am = s.match(/^@([\w-]+)$/);
    if (am) return { tag: null, extract: am[1] };
    const out = { tag: '*', attrs: [], contains: null, last: null, position: null, extract: null };
    let rest = s;
    const tm = rest.match(/^([\w-]+|\*)/);
    if (tm) { out.tag = tm[1] === '*' ? '*' : tm[1]; rest = rest.slice(tm[0].length); }
    for (const p of (rest.match(/\[[^\]]*\]/g) || [])) {
      const inner = p.slice(1, -1).trim();
      let m;
      if ((m = inner.match(/^@([\w-]+)\s*=\s*(['"])([\s\S]*?)\2$/))) out.attrs.push({ name: m[1], value: m[3] });
      else if ((m = inner.match(/^contains\(\s*(?:normalize-space\(\s*)?(?:text\(\)|\.)\s*,\s*(['"])([\s\S]*?)\1\s*\)?\s*\)$/))) out.contains = m[2];
      else if ((m = inner.match(/^last\(\)\s*-\s*(\d+)$/))) out.last = Number(m[1]);
      else if ((m = inner.match(/^last\(\)$/))) out.last = 0;
      else if ((m = inner.match(/^(?:position\(\)\s*=\s*)?(\d+)$/))) out.position = Number(m[1]);
    }
    return out;
  }

  async evalXPath(expr, ctx) {
    const steps = this.parseXPath(expr);
    if (!steps.length) return '';
    let nodes = await this.nodesOf(ctx);
    let extract = null;
    for (const st of steps) {
      if (st.tag == null) { extract = st.extract; continue; }
      let sel = st.tag;
      for (const a of st.attrs) sel += `[${a.name}="${String(a.value).replace(/"/g, '')}"]`;
      const next = [];
      for (const node of nodes) {
        if (!this.isEl(node) && !(node && node.__html != null)) continue;
        const html = node.__html != null ? node.__html : await node.content;
        let found = await this.querySafe(html, sel);
        found = await this.filterText(found, st.contains);
        if (st.position != null) found = this.pickIndex(found, { from: st.position - 1 });
        if (st.last != null) found = this.pickIndex(found, { from: -(st.last + 1) });
        next.push(...found);
      }
      nodes = next;
      if (!nodes.length) break;
    }
    const vals = await this.extractNodes(nodes, extract);
    if (extract == null) return vals;
    if (vals.length === 1) return vals[0];
    return vals.map((v) => String(v ?? '')).filter(Boolean).join('\n');
  }

  jsonOf(ctx) {
    const item = ctx.item;
    if (item != null && !this.isEl(item) && !(item && item.__html != null)) return item;
    const h = ctx.html;
    if (h && typeof h === 'object') return h;
    if (typeof h === 'string') {
      const t = h.trim();
      if (t.startsWith('{') || t.startsWith('[')) {
        try { return JSON.parse(t); } catch (_) { return null; }
      }
    }
    return null;
  }

  // JSONPath 子集：$.a.b、$['a-b']、[0]、[*]（含 [*] 之后的映射）。
  evalJsonPath(expr, ctx) {
    const data = this.jsonOf(ctx);
    if (data == null) return '';
    const s = String(expr).trim();
    if (!s.startsWith('$')) return '';
    const body = s.slice(1);
    if (!body) return data;
    const tokens = body.match(/\.[\w$-]+|\[\d+\]|\[\*\]|\[['"][^'"]+['"]\]/g) || [];
    if (tokens.join('') !== body) return ''; // 含不支持语法（如 .. 递归）时明确失败
    let cur = data;
    let mapMode = false;
    for (const t of tokens) {
      if (cur == null) break;
      if (t === '[*]') {
        cur = Array.isArray(cur) ? cur : Object.values(cur);
        mapMode = true;
        continue;
      }
      const step = (v) => {
        if (v == null) return null;
        if (t.startsWith('.')) return v[t.slice(1)];
        if (t.startsWith("['")) return v[t.slice(2, -1)];
        const idx = Number(t.slice(1, -1));
        return Array.isArray(v) ? v[idx] ?? null : null;
      };
      cur = mapMode && Array.isArray(cur) ? cur.map(step) : step(cur);
    }
    if (cur == null) return '';
    if (Array.isArray(cur)) return cur;
    return typeof cur === 'object' ? JSON.stringify(cur) : String(cur);
  }

  // ---------- 解析流程 ----------

  async parseBooks(rule, ctx) {
    const nodes = await this.evalList(String(rule.bookList || ''), ctx);
    const items = [];
    const seen = new Set();
    for (const node of nodes) {
      if (items.length >= MAX_ITEMS) break;
      const sub = Object.assign({}, ctx, { item: node });
      const name = this.text(await this.evalRule(rule.name || '', sub));
      const url = this.abs(ctx.baseUrl, await this.evalRule(rule.bookUrl || '', sub));
      if (!name || !url || seen.has(url)) continue;
      seen.add(url);
      const author = this.text(await this.evalRule(rule.author || '', sub));
      const last = this.text(await this.evalRule(rule.lastChapter || '', sub));
      const coverRaw = String(await this.evalRule(rule.coverUrl || '', sub)).trim();
      items.push({ title: name, url, cover: coverRaw ? this.abs(ctx.baseUrl, coverRaw) || '' : '',
        update: [author, last].filter(Boolean).join(' · ') });
    }
    return items;
  }

  async channels() {
    try {
      const src = await this.selectedSource();
      return this.exploreChannels(src);
    } catch (_) {
      return []; // 书源列表未就绪时不阻塞发现页
    }
  }

  async latest(page, channel) {
    const p = Number(page) || 1;
    if (p < 1 || p > 500) throw new Error('页码不正确。');
    const src = await this.selectedSource();
    const list = this.exploreChannels(src);
    if (!list.length) throw new Error('当前书源没有发现页分类。');
    let key = channel;
    if (!key) key = list[0].key;
    if (!list.some((c) => c.key === key)) {
      const hit = list.find((c) => c.title === key);
      if (!hit) throw new Error('发现页分类不存在，请重新进入发现页。');
      key = hit.key;
    }
    const built = await this.buildUrl(key, { source: src, baseUrl: src.bookSourceUrl, page: p });
    let res;
    try {
      res = await this.request(built.url, { method: built.method, headers: built.headers, data: built.data });
    } catch (_) {
      throw new Error('发现页加载失败，该书源可能已失效。');
    }
    const explore = this.ruleObj(src, 'ruleExplore');
    const rule = String(explore.bookList || '').trim() ? explore : this.ruleObj(src, 'ruleSearch');
    return this.parseBooks(rule, { html: res, baseUrl: built.url, source: src, page: p });
  }

  async search(kw, page) {
    const p = Number(page) || 1;
    if (p < 1 || p > 200) throw new Error('页码不正确。');
    const keyword = String(kw ?? '').trim();
    if (!keyword) return [];
    // 粘贴详情页链接时直接定位到对应书源的作品。
    if (/^https?:\/\//i.test(keyword)) {
      const list = await this.sourceList(false);
      const src = list.find((s) => this.host(s.bookSourceUrl) === this.host(keyword));
      if (!src) throw new Error('该链接不属于书源列表中的任何书源。');
      if (p > 1) return [];
      let title = '';
      try {
        const res = await this.fetch(src, keyword);
        title = this.text(await this.evalRule(this.ruleObj(src, 'ruleBookInfo').name || '',
          { html: res, baseUrl: keyword, source: src, bookUrl: keyword }));
      } catch (_) { /* 名称失败不阻塞打开 */ }
      return [{ title: title || keyword.replace(/^https?:\/\//i, '').slice(0, 40), url: keyword, cover: '', update: String(src.bookSourceName || '') }];
    }
    const src = await this.selectedSource();
    const template = this.searchUrlOf(src);
    const rule = this.ruleObj(src, 'ruleSearch');
    if (!template || !String(rule.bookList || '').trim()) throw new Error('当前书源不支持搜索，请在设置中更换书源。');
    if (p > 1 && !/\{\{[^}]*page/.test(template)) return []; // 无分页参数的书源只有第一页
    const built = await this.buildUrl(template, { source: src, baseUrl: src.bookSourceUrl, key: keyword, page: p });
    let res;
    try {
      res = await this.request(built.url, { method: built.method, headers: built.headers, data: built.data });
    } catch (_) {
      throw new Error('搜索请求失败，该书源可能已失效或被限流。');
    }
    if (typeof res === 'string' && res.includes('<form id="challenge-form"')) {
      throw new Error('搜索被站点验证拦截，请稍后再试或更换书源。');
    }
    return this.parseBooks(rule, { html: res, baseUrl: built.url, source: src, key: keyword, page: p });
  }

  async detail(url) {
    const bookUrl = String(url || '').trim();
    if (!/^https?:\/\//i.test(bookUrl)) throw new Error('作品地址不正确。');
    const src = await this.resolveSource(bookUrl);
    const info = this.ruleObj(src, 'ruleBookInfo');
    const toc = this.ruleObj(src, 'ruleToc');
    let res;
    try {
      res = await this.fetch(src, bookUrl);
    } catch (_) {
      throw new Error('作品详情加载失败，该书源可能已失效。');
    }
    const ctx = { html: res, baseUrl: bookUrl, source: src, bookUrl };
    if (String(info.init || '').trim()) await this.evalRule(info.init, ctx); // @put 变量等副作用
    const title = this.text(await this.evalRule(info.name || '', ctx));
    if (!title) throw new Error('书源未返回作品详情，作品可能已下架。');
    const author = this.text(await this.evalRule(info.author || '', ctx));
    const desc = this.decodeEntities(String(await this.evalRule(info.intro || '', ctx) || '').trim());
    const coverRaw = String(await this.evalRule(info.coverUrl || '', ctx)).trim();
    // 目录页可能与详情页不同（tocUrl 支持 {{baseUrl}} 模板与 ##正则 改写）。
    let tocUrl = this.abs(bookUrl, await this.evalRule(info.tocUrl || '', ctx));
    let tocHtml = res;
    let tocBase = bookUrl;
    if (tocUrl && tocUrl !== bookUrl) {
      try {
        tocHtml = await this.fetch(src, tocUrl);
        tocBase = tocUrl;
      } catch (_) {
        tocHtml = res;
        tocBase = bookUrl;
      }
    }
    const chapters = [];
    const seen = new Set();
    const seenUrls = new Set([tocBase]);
    let current = tocBase;
    let pageHtml = tocHtml;
    for (let i = 0; i < MAX_TOC_PAGES; i++) {
      const pageCtx = { html: pageHtml, baseUrl: current, source: src, bookUrl };
      const nodes = await this.evalList(toc.chapterList || '', pageCtx);
      for (const node of nodes) {
        if (chapters.length >= MAX_TOC_ITEMS) break;
        const sub = Object.assign({}, pageCtx, { item: node });
        const name = this.text(await this.evalRule(toc.chapterName || 'text', sub));
        const href = this.abs(current, await this.evalRule(toc.chapterUrl || 'href', sub));
        if (!name || !href) continue;
        const key = name + '|' + href;
        if (seen.has(key)) continue;
        seen.add(key);
        chapters.push({ name, url: href });
      }
      if (chapters.length >= MAX_TOC_ITEMS) break;
      let next = this.abs(current, await this.evalRule(toc.nextTocUrl || '', pageCtx));
      if (!next || next === current) {
        // 有些书源的“下一页”写法是文本链接，规则未命中时按链接文本兜底。
        const label = await this.followTextLink(pageHtml, current, ['下一页', '下页', '下一頁']);
        next = label;
      }
      if (!next || seenUrls.has(next)) break;
      seenUrls.add(next);
      await this.sleep(120);
      try {
        pageHtml = await this.fetch(src, next);
      } catch (_) {
        break;
      }
      current = next;
    }
    if (!chapters.length) throw new Error('书源未返回可阅读章节。');
    return {
      title,
      cover: coverRaw ? this.abs(bookUrl, coverRaw) || '' : '',
      desc,
      authors: author ? [{ name: author }] : [],
      episodes: [{ title: '目录', urls: chapters }],
    };
  }

  // 目录“下一页”文本链接兜底：只在规则未给出结果时使用。
  async followTextLink(html, baseUrl, labels) {
    if (typeof html !== 'string') return '';
    const links = await this.querySafe(html, 'a');
    for (const a of links) {
      const text = this.text(await a.text);
      if (!labels.includes(text)) continue;
      const href = await a.getAttributeText('href');
      const url = this.abs(baseUrl, href);
      if (url) return url;
    }
    return '';
  }

  blocksFromContent(rule, result, baseUrl) {
    const value = String(result ?? '');
    const wantsHtml = /(^|@)html\s*$/.test(String(rule).split('##')[0].trim())
      || /<\/?(?:p|div|br|img|span|h[1-6]|li|td|font|section|article)\b/i.test(value);
    if (wantsHtml) return this.htmlToBlocks(value, baseUrl);
    return value.split(/\r?\n+/).map((s) => this.decodeEntities(s).replace(/[ \t\u3000]+/g, ' ').trim()).filter(Boolean);
  }

  async watch(url) {
    const chapterUrl = String(url || '').trim();
    if (!/^https?:\/\//i.test(chapterUrl)) throw new Error('章节地址不正确。');
    const src = await this.resolveSource(chapterUrl);
    const rule = this.ruleObj(src, 'ruleContent');
    if (!String(rule.content || '').trim()) throw new Error('当前书源没有正文规则。');
    let res;
    try {
      res = await this.fetch(src, chapterUrl);
    } catch (_) {
      throw new Error('正文加载失败，该书源可能已失效。');
    }
    const blocks = [];
    const seen = new Set([chapterUrl]);
    let current = chapterUrl;
    let html = res;
    for (let i = 0; i < MAX_CONTENT_PAGES; i++) {
      const ctx = { html, baseUrl: current, source: src, bookUrl: chapterUrl };
      const result = await this.evalRule(rule.content || '', ctx);
      for (const b of this.blocksFromContent(rule.content, result, current)) blocks.push(b);
      const next = this.abs(current, await this.evalRule(rule.nextContentUrl || '', ctx));
      if (!next || next === current || seen.has(next)) break;
      seen.add(next);
      await this.sleep(120);
      try {
        html = await this.fetch(src, next);
      } catch (_) {
        break;
      }
      current = next;
    }
    if (!blocks.length) throw new Error('本章没有可阅读内容，可能已失效或需要登录。');
    // replaceRegex 只作用于文本块，图片块保留。
    const parts = this.splitRegex(String(rule.replaceRegex || '').trim());
    let content = blocks;
    if (parts.regex) {
      content = blocks
        .map((b) => (typeof b === 'string' ? this.applyRegex(b, parts) : b))
        .filter((b) => typeof b !== 'string' || b.trim() !== '');
    }
    if (!content.length) throw new Error('正文全部被净化规则移除，请检查书源。');
    return { content, headers: { Referer: chapterUrl } };
  }
}
