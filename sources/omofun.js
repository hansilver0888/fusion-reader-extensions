// ==MiruExtension==
// @name         Omofun 动漫
// @version      v1.0.0
// @author       FusionReader
// @lang         zh
// @license      MIT
// @package      omofun
// @type         bangumi
// @icon         https://www.omofuna.com/template/the4/statics/img/favicon.ico
// @webSite      https://www.omofuna.com
// @nsfw         false
// ==/MiruExtension==

export default class extends Extension {
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
    return /^\/(?:anime|show|search)\//.test(value) ? value : '';
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
    return this.list(await this.page('/show/' + id + '--------' + page + '---.html'));
  }

  async search(keyword, page) {
    this.pageNumber(page);
    const word = String(keyword || '').trim();
    if (!word) return [];
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

  async detail(url) {
    const path = this.workPath(url);
    return this.parseDetail(await this.page(path), path);
  }

  playerData(html) {
    // Decode data only. Running the site's player JS would require a browser.
    const match = html.match(/var\s+player_[a-z0-9_]+\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i);
    try { if (match) return JSON.parse(match[1]); } catch (_) {}
    throw new Error('未找到播放地址，请更新插件或切换线路。');
  }

  async watch(url) {
    const path = this.path(url);
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
