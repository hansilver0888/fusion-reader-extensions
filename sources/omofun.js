// ==MiruExtension==
// @name         Omofun 动漫
// @version      v1.1.1
// @minAppVersion 1.4.2
// @author       FusionReader
// @lang         zh
// @license      MIT
// @package      omofun
// @type         bangumi
// @icon         https://www.omofuna.com/template/the4/statics/img/favicon.ico
// @webSite      https://www.omofuna.com
// @nsfw         false
// @comments     work
// ==/MiruExtension==

export default class extends Extension {

  // Public read-only gRPC API used by the official desktop client 2.0.1.
  // Public content, danmaku and comment reads need no login or signing secret.
  _apiHosts = ['trans.gavhscnmj.cc', 'backed.233dm.com'];
  _apiHost = '';
  _cursors = new Map();
  _appIds = new Map();
  _commentCursors = new Map();
  _certificate = "-----BEGIN CERTIFICATE-----\nMIIDSzCCAjMCFHIXUZ02Sox1yN7Tn3s2u56y2NdOMA0GCSqGSIb3DQEBCwUAMGEx\nCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJVUzELMAkGA1UEBwwCVVMxCzAJBgNVBAoM\nAlVTMQswCQYDVQQLDAJVUzELMAkGA1UEAwwCVVMxETAPBgkqhkiG9w0BCQEWAlVT\nMCAXDTI0MTIwNDE0MzczOVoYDzMwMjQwNDA2MTQzNzM5WjBhMQswCQYDVQQGEwJV\nUzELMAkGA1UECAwCVVMxCzAJBgNVBAcMAlVTMQswCQYDVQQKDAJVUzELMAkGA1UE\nCwwCVVMxCzAJBgNVBAMMAlVTMREwDwYJKoZIhvcNAQkBFgJVUzCCASIwDQYJKoZI\nhvcNAQEBBQADggEPADCCAQoCggEBAK3bPHV2iVxeM2HOLLLF4Ee2CLO9P0xIHfyi\n7Ij//5u2nzQe64twOdMi53VUt9sGpotV2+Ccwc87G0XCQ4T/KiTczqY02cWw7Nou\nskn2q+oKUb2GjBFr+i/APUsqgraWWftlukpHkD027ce/6BY+CNWtthRQ5C5MJgeR\niYAbvQHz8g3QwcCPxhVSZgZyvabbJZz3FQk+0DoVC6ZL4863lncyISfQNLwiYuhF\n2VzjG4KtKMMD/XNXEgj9LMTwEMEoccBt6F0smdVbyB+afbxdyjEx8jse38gIlYoq\n1UPfqeEPk094dbOgEbMnMcwxQnCSmTt9/MQiFig4ZT7SENQc4AkCAwEAATANBgkq\nhkiG9w0BAQsFAAOCAQEAL0P/le9n8caiScetUmv27E3ecFt4rXe1W4E45EkawNAP\nTyOW7i+pbs5ymQXBVkqh7OGbIU/c9LauuQjtxg8ngrQwYgteLBaRbOLeqjsz0eGg\nCEGCO9OPawkMkAbf7G/AVYNaOkSPNM+K2m/+XwscxXUqhJ8rRo/uMnnGQu25IHYG\ndWQjXBapKoxnuSmVRCvSv6F1WsSXzY+hIDRqfSInIguyK91tIA2cGYeE/Zm7xdC+\nDoUj6pqaI6/qzRNF5KJmdHAJwcgxQu9tHpXak+OsaVWpMXoFJSQrl7+K60Enr429\nsmasHvi9tYg1MIB5cxOgtjsHWMYbE1O6UW4CY4UHug==\n-----END CERTIFICATE-----\n";

  protobuf(fields) {
    const out = [];
    const varint = value => {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('无效接口参数。');
      do { const byte = value % 128; value = Math.floor(value / 128); out.push(byte | (value ? 128 : 0)); } while (value);
    };
    for (const [key, value] of fields) {
      if (value === undefined || value === null || value === '') continue;
      if (typeof value === 'number') { varint(key * 8); varint(value); }
      else {
        const bytes = typeof value === 'string'
          ? Array.from(unescape(encodeURIComponent(value)), char => char.charCodeAt(0)) : value;
        varint(key * 8 + 2); varint(bytes.length); out.push(...bytes);
      }
    }
    return out;
  }

  bytesBase64(encoded) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const text = String(encoded).replace(/\s/g, '');
    const out = []; let value = 0, bits = 0;
    for (const char of text) {
      if (char === '=') break;
      const digit = alphabet.indexOf(char);
      if (digit < 0) throw new Error('接口数据编码不正确。');
      value = (value << 6) | digit; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 255); }
    }
    return out;
  }

  protoRead(bytes) {
    let offset = 0; const result = {};
    const varint = () => {
      let value = 0, shift = 0;
      while (offset < bytes.length && shift < 70) {
        const byte = bytes[offset++]; value += (byte & 127) * Math.pow(2, shift);
        if (!(byte & 128)) return value; shift += 7;
      }
      throw new Error('接口数据不完整。');
    };
    while (offset < bytes.length) {
      const tag = varint(), key = Math.floor(tag / 8), wire = tag % 8;
      if (!key) throw new Error('接口字段不正确。');
      let value;
      if (wire === 0) value = varint();
      else if (wire === 2 || wire === 1 || wire === 5) {
        const size = wire === 2 ? varint() : wire === 1 ? 8 : 4;
        if (size < 0 || offset + size > bytes.length) throw new Error('接口数据不完整。');
        value = bytes.slice(offset, offset + size); offset += size;
      } else throw new Error('暂不支持此接口数据。');
      (result[key] || (result[key] = [])).push(value);
    }
    return result;
  }

  protoText(data, key) {
    const bytes = data[key]?.[0];
    return Array.isArray(bytes) ? decodeURIComponent(bytes.map(b => '%' + b.toString(16).padStart(2, '0')).join('')) : '';
  }

  async appCall(service, method, fields = []) {
    const hosts = [this._apiHost, ...this._apiHosts].filter((host, i, all) => host && all.indexOf(host) === i);
    let failure;
    for (const host of hosts) {
      try {
        const result = await this.grpcRequest({ endpoint: 'https://' + host + ':9091',
          method: '/' + service + '/' + method, data: this.binaryBase64(this.protobuf(fields)),
          certificate: this._certificate,
          metadata: { 'x-client-name': 'omofun', 'x-client-version': '2.0.1', 'x-platform': 'web', 'x-arch': 'x64' } });
        const decoded = this.protoRead(this.bytesBase64(result));
        this._apiHost = host; return decoded;
      } catch (error) {
        failure = error;
        if (!/connect|socket|handshake|unavailable|deadline|\(14\)|\(4\)/i.test(String(error))) break;
      }
    }
    throw new Error('Omofun App 接口读取失败：' + String(failure?.message || failure));
  }

  appItems(response) {
    return (response[2] || []).map(bytes => {
      const item = this.protoRead(bytes), id = item[1]?.[0];
      return { title: this.protoText(item, 2), url: '/app/vod/' + id,
        cover: this.protoText(item, 3), update: this.protoText(item, 4) };
    }).filter(item => item.title && /^\/app\/vod\/[1-9]\d*$/.test(item.url));
  }

  async appList(method, key, fields, page) {
    const cacheKey = method + ':' + key;
    if (page === 1) this._cursors.set(cacheKey, new Map([[1, '']]));
    const cursors = this._cursors.get(cacheKey) || new Map([[1, '']]);
    if (!cursors.has(page)) throw new Error('请从第一页开始加载目录。');
    const cursor = cursors.get(page);
    if (cursor === null) return [];
    const response = await this.appCall('content.v1.ContentService', method,
      [...fields, [method === 'SearchVods' ? 4 : 8, cursor]]);
    const next = this.protoText(response, 3);
    cursors.set(page + 1, response[4]?.[0] && next ? next : null);
    this._cursors.set(cacheKey, cursors);
    if (this._cursors.size > 30) this._cursors.delete(this._cursors.keys().next().value);
    return this.appItems(response);
  }

  async appId(url, context) {
    const direct = String(url).match(/^\/app\/vod\/([1-9]\d*)(?:\/|$)/);
    if (direct) return Number(direct[1]);
    const work = String(url).replace(/\/play\/\d+\/\d+\.html$/, '.html');
    if (this._appIds.has(work)) return this._appIds.get(work);
    const saved = await this.getSetting('app-id:' + work);
    if (Number.isSafeInteger(Number(saved)) && Number(saved) > 0) return Number(saved);
    const title = String(context?.title || '').trim();
    if (!title) throw new Error('旧目录需要重新打开作品详情后播放。');
    const response = await this.appCall('content.v1.ContentService', 'SearchVods', [[1, title], [3, 40]]);
    const matches = this.appItems(response).filter(item => item.title.trim() === title);
    if (matches.length !== 1) throw new Error('旧目录无法唯一对应 App 作品，请重新搜索该作品。');
    const id = Number(matches[0].url.split('/').pop());
    this._appIds.set(work, id); await this.setSetting('app-id:' + work, id); return id;
  }

  async appDetail(id) {
    const response = await this.appCall('content.v1.ContentService', 'GetVodDetail', [[1, id]]);
    if (!response[1]?.[0]) throw new Error('未找到此作品。');
    const data = this.protoRead(response[1][0]);
    const groups = (data[16] || []).map(bytes => {
      const entry = this.protoRead(bytes), title = this.protoText(entry, 1);
      const play = this.protoRead(entry[2]?.[0] || []);
      const urls = (play[3] || []).map(bytes => {
        const ep = this.protoRead(bytes), index = ep[3]?.[0];
        return { name: this.protoText(ep, 1) || '第' + index + '集', number: index,
          url: '/app/vod/' + id + '/play/' + encodeURIComponent(title) + '/' + index + '.html' };
      }).filter(ep => Number.isSafeInteger(ep.number) && ep.number > 0).sort((a, b) => a.number - b.number);
      return { title, sort: play[1]?.[0] || 0, urls: urls.map(({ name, url }) => ({ name, url })) };
    }).filter(group => group.urls.length).sort((a, b) => a.sort - b.sort);
    if (!groups.length) throw new Error('此作品暂无可播放集数。');
    return { title: this.protoText(data, 2), cover: this.protoText(data, 4),
      desc: this.text(this.protoText(data, 10)), episodes: groups.map(({ title, urls }) => ({ title, urls })) };
  }

  async appWatch(path, context) {
    const match = path.match(/^\/app\/vod\/([1-9]\d*)\/play\/([^/]+)\/([1-9]\d*)\.html$/);
    const legacy = path.match(/^\/anime\/[a-z0-9]+\/play\/(\d+)\/([1-9]\d*)\.html$/);
    if (!match && !legacy) throw new Error('无效集数地址。');
    const id = await this.appId(path, context);
    const player = match ? decodeURIComponent(match[2]) : ({ 1: '精品', 2: '暴风', 3: '天堂', 4: '量子' })[legacy[1]];
    if (!player) throw new Error('旧播放线路无法对应，请重新打开作品目录。');
    const episode = Number(match ? match[3] : legacy[2]);
    const response = await this.appCall('content.v1.ContentService', 'GetVodPlayUrl', [[1, id], [2, player], [3, episode]]);
    let media = this.protoText(response, 1), headers = { ...this.headers(), Origin: this.webSite };
    if (!/^https?:\/\//.test(media) || !/\.(?:m3u8|mp4)(?:[?#]|$)/i.test(media)) {
      const parsed = await this.appCall('content.v1.ContentService', 'ParseResource', [[1, media]]);
      const resource = this.protoRead(parsed[5]?.[0] || []);
      media = this.protoText(resource, 1);
      if (resource[3]?.[0]) throw new Error('此线路需要官方 App 的专用加速组件，请切换天堂线路。');
      for (const bytes of resource[2] || []) { const pair = this.protoRead(bytes); headers[this.protoText(pair, 1)] = this.protoText(pair, 2); }
    }
    if (!/^https?:\/\/[^\s]+$/i.test(media)) throw new Error('此线路未返回可用视频，请切换其他线路。');
    const hls = /\.m3u8(?:[?#]|$)/i.test(media);
    return { type: hls ? 'hls' : 'mp4', url: hls ? 'lavf://' + media : media, headers, netMode: 'direct',
      danmaku: { format: 'extension', url: id + ':' + episode, windowSeconds: 180 } };
  }

  async danmaku(url, from, to) {
    const match = String(url).match(/^([1-9]\d*):([1-9]\d*)$/);
    if (!match || !Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to - from > 600) {
      throw new Error('无效弹幕参数。');
    }
    const response = await this.appCall('danmaku.v1.DanmakuService', 'ListBullets',
      [[1, Number(match[1])], [2, match[2]], [3, Math.floor(from * 1000)], [4, Math.floor(to * 1000)], [5, 1000]]);
    return (response[1] || []).map(bytes => {
      const row = this.protoRead(bytes), style = this.protoRead(row[5]?.[0] || []);
      const code = this.protoText(style, 1), hex = code.match(/^color_hex_([a-f0-9]{6})$/i);
      const basic = { white: 0xffffff, red: 0xff0000, green: 0x00ff00, blue: 0x0000ff, yellow: 0xffff00, black: 0 };
      const color = hex ? parseInt(hex[1], 16) : basic[code.replace(/^color_basic_/, '')] ?? 0xffffff;
      const effect = this.protoText(style, 2).toLowerCase();
      return [(row[3]?.[0] || 0) / 1000, effect === 'top' ? 1 : effect === 'bottom' ? 2 : 0,
        color, '', this.protoText(row, 4)];
    });
  }


  commentData(bytes) {
    const data = this.protoRead(bytes), author = this.protoRead(data[3]?.[0] || []);
    const rendered = this.protoRead(data[8]?.[0] || []);
    const html = this.protoText(rendered, 1);
    const timestamp = this.protoRead(data[16]?.[0] || []);
    const seconds = timestamp[1]?.[0] || 0;
    const hidden = data[14]?.[0] !== 2;
    const images = [];
    if (!hidden) {
      for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
        const url = this.attr(match[1], 'src');
        if (/^https?:\/\//i.test(url) && !images.includes(url)) images.push(url);
      }
    }
    return { id: String(data[1]?.[0] || ''), username: this.protoText(author, 2) || '匿名用户',
      text: hidden ? '' : this.text(html || this.protoText(data, 7)),
      time: seconds > 0 && seconds < 8640000000000 ? new Date(seconds * 1000).toISOString() : '',
      likes: data[11]?.[0] || 0, replyCount: data[13]?.[0] || 0, hidden,
      images: images.slice(0, 20) };
  }

  async comments(workUrl, chapterUrl, page, parentId) {
    this.pageNumber(page);
    const path = this.path(workUrl);
    if (!/^\/(?:app\/vod\/[1-9]\d*|anime\/[a-z0-9]+\.html)$/.test(path)) throw new Error('无效作品地址。');
    const id = await this.appId(path);
    const parent = parentId ? Number(parentId) : 0;
    if (parentId && (!Number.isSafeInteger(parent) || parent <= 0)) throw new Error('无效评论编号。');
    const key = id + ':' + parent;
    // The API uses ID cursors, not page offsets. Root threads and each reply
    // list retain independent cursors, and page 1 always starts a fresh read.
    if (page === 1) this._commentCursors.set(key, new Map([[1, 0]]));
    const cursors = this._commentCursors.get(key);
    if (!cursors?.has(page)) throw new Error('请从第一页开始加载评论。');
    const cursor = cursors.get(page);
    if (cursor === null) return { comments: [], hasMore: false };
    const response = await this.appCall('comment.v1.CommentService', parent ? 'ListReplies' : 'ListComments',
      parent ? [[1, parent], [2, cursor], [3, 20]] : [[1, 'vod'], [2, id], [4, cursor], [5, 20]]);
    const rows = [];
    const seen = new Set();
    for (const bytes of response[1] || []) {
      const root = parent ? bytes : this.protoRead(bytes)[1]?.[0];
      if (!root) continue;
      const comment = this.commentData(root);
      if (comment.id && comment.id !== '0' && !seen.has(comment.id)) { seen.add(comment.id); rows.push(comment); }
    }
    const next = response[2]?.[0] || 0;
    const hasMore = Number.isSafeInteger(next) && next > 0 && next !== cursor;
    cursors.set(page + 1, hasMore ? next : null);
    if (this._commentCursors.size > 50) this._commentCursors.delete(this._commentCursors.keys().next().value);
    return { comments: rows, hasMore };
  }

  _checks = new Map();
  _agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  headers(referer) {
    return { 'User-Agent': this._agent, Referer: referer || this.webSite + '/' };
  }

  // Work/episode URLs stay relative so bookmarks have a stable identity.
  path(url) {
    let value = this.decodeEntities(String(url || '')).trim();
    if (value.startsWith(this.webSite + '/')) value = value.slice(this.webSite.length);
    return /^\/(?:anime|show|search|app\/vod)\//.test(value) ? value : '';
  }

  text(html) {
    return this.decodeEntities(String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, ' '))
      .replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').trim();
  }

  attr(attributes, name) {
    const match = String(attributes || '').match(new RegExp(
      '(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'=<>`]+))', 'i'));
    return match ? this.decodeEntities(match[1] ?? match[2] ?? match[3] ?? '') : '';
  }

  anchors(html) {
    const links = [];
    const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = pattern.exec(html)) !== null) links.push({ attrs: match[1], body: match[2] });
    return links;
  }

  image(attributes, body) {
    const img = String(body || '').match(/<img\b([^>]*)>/i);
    let url = this.attr(attributes, 'data-original') || this.attr(attributes, 'data-src');
    if (!url && img) url = this.attr(img[1], 'data-original') ||
      this.attr(img[1], 'data-src') || this.attr(img[1], 'src');
    if (!url || /(?:load\.gif|^data:)/i.test(url)) return '';
    url = this.absoluteUrl(this.webSite + '/', url);
    return /^https?:\/\//.test(url) ? url : '';
  }

  binaryBase64(bytes) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1] || 0, c = bytes[i + 2] || 0;
      out += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)] +
        (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
        (i + 2 < bytes.length ? alphabet[c & 63] : '=');
    }
    return out;
  }

  decodeBase64(value) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const input = String(value).replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input) || input.length % 4 === 1) {
      throw new Error('播放地址编码不正确，请切换线路。');
    }
    let result = '', buffer = 0, bits = 0;
    for (const char of input.replace(/=+$/, '')) {
      buffer = (buffer << 6) | alphabet.indexOf(char);
      bits += 6;
      if (bits >= 8) { bits -= 8; result += String.fromCharCode((buffer >> bits) & 255); }
    }
    return result;
  }

  async continueAccess(html) {
    // Match the site's own Continue button protocol; never evaluate remote JS.
    const endpoint = html.match(/MAC\.Ajax\(maccms\.path\+'(\/index\.php\/ajax\/verify_check\?type=(?:search|show))'/);
    const array = html.match(/new Uint8Array\(\[([^\]]+)\]\)/);
    if (!endpoint || !array) throw new Error('站点验证方式已变化，请更新 Omofun 插件。');
    const key = array[1].split(',').map(value => Number(value.trim()));
    if (!key.length || key.length > 64 || key.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error('站点验证参数不正确，请更新 Omofun 插件。');
    }
    if (this._checks.has(endpoint[1])) return this._checks.get(endpoint[1]);
    const pending = (async () => {
      const stamp = String(Date.now());
      const token = this.binaryBase64(Array.from(stamp, (char, index) => char.charCodeAt(0) ^ key[index % key.length]));
      const response = await this.request(endpoint[1], {
        method: 'post', data: 'i=' + encodeURIComponent(token), timeoutMs: 15000, retry: false,
        headers: { ...this.headers(), 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest', Origin: this.webSite },
      });
      let result;
      try { result = typeof response === 'string' ? JSON.parse(response) : response; } catch (_) {}
      if (!result || Number(result.code) !== 1) {
        throw new Error('Omofun 访问验证未通过，请稍后重试，并确认设备时间正确。');
      }
    })();
    this._checks.set(endpoint[1], pending);
    try { await pending; } finally { this._checks.delete(endpoint[1]); }
  }

  async page(url) {
    let html = String(await this.request(url, { headers: this.headers(), timeoutMs: 20000 }));
    if (/<title>\s*系统安全验证/.test(html) && /verify_submit/.test(html)) {
      await this.continueAccess(html);
      html = String(await this.request(url, { headers: this.headers(), timeoutMs: 20000, retry: false }));
    }
    if (/<title>\s*系统安全验证/.test(html) || /cf-chl-|challenge-platform|<title>Just a moment/i.test(html)) {
      throw new Error('Omofun 暂时限制访问，请稍后重试。');
    }
    if (!/<(?:html|div|ul)\b/i.test(html)) throw new Error('Omofun 页面加载失败，请稍后重试。');
    return html;
  }

  list(html) {
    const result = new Map();
    // The site periodically renames its CSS classes; href/data attributes persist.
    for (const link of this.anchors(html)) {
      const url = this.path(this.attr(link.attrs, 'href'));
      if (!/^\/anime\/[a-z0-9]+\.html$/.test(url)) continue;
      const cover = this.image(link.attrs, link.body);
      const title = this.attr(link.attrs, 'title') || (!cover ? this.text(link.body) : '');
      const badges = [...link.body.matchAll(/<b\b[^>]*>([\s\S]*?)<\/b>/gi)].map(match => this.text(match[1]));
      const update = badges.length ? badges[badges.length - 1] : '';
      const previous = result.get(url);
      if (previous) {
        if (cover) previous.cover = cover;
        if (title) previous.title = title;
        if (update) previous.update = update;
      } else if (title) result.set(url, { title, url, cover, update });
    }
    return [...result.values()].filter(item => item.cover);
  }

  async channels() {
    if (typeof this.grpcRequest === 'function') {
      const response = await this.appCall('content.v1.ContentService', 'ListCategories');
      return (response[1] || []).map(bytes => { const c = this.protoRead(bytes); return { title: this.protoText(c, 2), key: String(c[1]?.[0]) }; }).filter(c => c.title && /^\d+$/.test(c.key));
    }
    return [{ title: '日漫', key: '1' }, { title: '国漫', key: '2' },
      { title: '动态漫画', key: '5' }, { title: '剧场', key: '24' },
      { title: '特摄', key: '4' }, { title: '美漫', key: '3' }];
  }

  pageNumber(page) {
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw new Error('无效页码。');
    return page;
  }

  async latest(page, channel) {
    this.pageNumber(page);
    const id = String(channel || '1');
    if (!['1', '2', '5', '24', '4', '3'].includes(id)) throw new Error('无效分类。');
    if (typeof this.grpcRequest === 'function') return this.appList('ListVods', id, [[1, Number(id)], [5, 'time'], [7, 24]], page);
    return this.list(await this.page('/show/' + id + '--------' + page + '---.html'));
  }

  async search(keyword, page) {
    this.pageNumber(page);
    const word = String(keyword || '').trim();
    if (!word) return [];
    if (typeof this.grpcRequest === 'function') return this.appList('SearchVods', word, [[1, word], [3, 24]], page);
    return this.list(await this.page('/search/' + encodeURIComponent(word) + '----------' + page + '---.html'));
  }

  workPath(url) {
    const path = this.path(url);
    if (!/^\/anime\/[a-z0-9]+\.html$/.test(path)) throw new Error('无效作品地址。');
    return path;
  }

  parseDetail(html, path) {
    const title = this.text((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
    const cover = this.image('', (html.match(/<img\b[^>]*data-original[^>]*>/i) || [])[0]);
    const description = html.match(/<span\b[^>]*class=["'][^"']*\bdetail-content\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    let desc = this.text(description ? description[1] : '');
    if (!desc) {
      const meta = html.match(/<meta\b[^>]*name=["']description["'][^>]*>/i);
      desc = meta ? this.attr(meta[0], 'content') : '';
    }
    const names = new Map(), groups = new Map();
    const prefix = path.slice(0, -5) + '/play/';
    for (const link of this.anchors(html)) {
      const href = this.attr(link.attrs, 'href');
      const tab = href.match(/^#playlist(\d+)$/);
      if (tab) names.set(tab[1], this.text(link.body.replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, '')));
      const url = this.path(href);
      if (!url.startsWith(prefix)) continue;
      const episode = url.slice(prefix.length).match(/^(\d+)\/(\d+)\.html$/);
      if (!episode) continue;
      if (!groups.has(episode[1])) groups.set(episode[1], new Map());
      const explicit = this.attr(link.attrs, 'title'), text = this.text(link.body);
      const quality = explicit ? 2 : /(?:集|话|EP|OVA)/i.test(text) ? 1 : 0;
      const previous = groups.get(episode[1]).get(url);
      if (!previous || quality > previous.quality) {
        groups.get(episode[1]).set(url, { name: explicit || text || '第' + episode[2] + '集',
          url, number: Number(episode[2]), quality });
      }
    }
    const ids = [...names.keys(), ...groups.keys()].filter((id, index, all) => all.indexOf(id) === index);
    const episodes = ids.filter(id => groups.has(id)).map(id => ({ title: names.get(id) || '线路 ' + id,
      urls: [...groups.get(id).values()].sort((a, b) => a.number - b.number).map(({ name, url }) => ({ name, url })) }));
    if (!title || !episodes.length) throw new Error('作品目录加载失败，请稍后重试。');
    return { title, cover, desc, episodes };
  }

  async detail(url, context) {
    if (typeof this.grpcRequest === 'function') {
      const path = this.path(url);
      if (!/^\/(?:app\/vod\/[1-9]\d*|anime\/[a-z0-9]+\.html)$/.test(path)) throw new Error('无效作品地址。');
      return this.appDetail(await this.appId(path, context));
    }
    const path = this.workPath(url);
    return this.parseDetail(await this.page(path), path);
  }

  playerData(html) {
    // Decode data only. Running the site's player JS would require a browser.
    const match = html.match(/var\s+player_[a-z0-9_]+\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i);
    try { if (match) return JSON.parse(match[1]); } catch (_) {}
    throw new Error('未找到播放地址，请更新插件或切换线路。');
  }

  async watch(url, context) {
    const path = this.path(url);
    if (typeof this.grpcRequest === 'function') return this.appWatch(path, context);
    if (!/^\/anime\/[a-z0-9]+\/play\/\d+\/\d+\.html$/.test(path)) throw new Error('无效集数地址。');
    const config = this.playerData(await this.page(path));
    let media = String(config.url || '');
    try {
      const encoding = Number(config.encrypt || 0);
      if (encoding === 2) media = this.decodeBase64(media);
      if (encoding === 1 || encoding === 2) media = decodeURIComponent(media);
      if (![0, 1, 2].includes(encoding)) throw new Error('Unknown encoding');
    } catch (_) { throw new Error('播放地址编码不正确，请更新插件或切换线路。'); }
    if (media.startsWith('//')) media = 'https:' + media;
    if (!/^https?:\/\/[^\s]+$/i.test(media)) {
      throw new Error('此线路使用中转播放器，暂不支持。请返回目录切换其他线路。');
    }
    const headers = { ...this.headers(), Origin: this.webSite };
    if (/\.m3u8(?:[?#]|$)/i.test(media) || /m3u8/i.test(config.from || '')) {
      let playlist;
      try {
        playlist = await this.request(media, { headers, netMode: 'direct', timeoutMs: 15000, retry: false });
      } catch (_) { throw new Error('此播放线路已失效或当前网络无法访问，请返回目录切换其他线路。'); }
      if (typeof playlist !== 'string' || !playlist.trimStart().startsWith('#EXTM3U')) {
        throw new Error('此线路未返回有效视频，请返回目录切换其他线路。');
      }
      // mpv's documented lavf protocol lets FFmpeg read the remote HLS itself.
      // The current host stages HTTP playlists locally, which misidentifies
      // this source's segments as separate videos. Keep the master playlist:
      // its child playlist's server MIME type can also misidentify the format.
      // The CDN is directly reachable. Avoid FFmpeg's nested proxy protocol,
      // which the host's current protocol allowlist does not support.
      return { type: 'hls', url: 'lavf://' + media, headers, netMode: 'direct' };
    }
    if (!/\.mp4(?:[?#]|$)/i.test(media)) throw new Error('此线路的视频格式暂不支持，请切换其他线路。');
    return { type: 'mp4', url: media, headers };
  }
}
