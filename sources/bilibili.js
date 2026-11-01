// ==MiruExtension==
// @name         哔哩哔哩收藏夹
// @version      v0.1.0
// @minAppVersion 1.4.5
// @author       FusionReader
// @lang         zh
// @license      MIT
// @package      bilibili
// @type         bangumi
// @icon         https://www.bilibili.com/favicon.ico
// @webSite      https://www.bilibili.com
// @nsfw         false
// @login        qr
// @comments     work
// ==/MiruExtension==

export default class extends Extension {
  _epoch = 0;
  _qr = null;
  _rawCredential = '';
  _cookie = '';
  _identity = null;
  _identityAt = 0;
  _folders = null;
  _foldersAt = 0;
  _foldersPending = null;
  _views = new Map();
  _ends = new Map();
  _cursors = new Map();

  headers(cookie) {
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', Referer: 'https://www.bilibili.com/' };
    if (cookie) headers.Cookie = cookie;
    return headers;
  }

  query(parameters) {
    return Object.keys(parameters).filter(key => parameters[key] !== undefined)
      .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(String(parameters[key]))).join('&');
  }

  async response(path, parameters = {}, cookie = '', passport = false) {
    const origin = passport ? 'https://passport.bilibili.com' : 'https://api.bilibili.com';
    let result;
    try {
      result = await this.request(origin + path + '?' + this.query(parameters), {
        headers: this.headers(cookie), timeoutMs: 12000, retry: false, responseMetadata: true,
      });
    } catch (_) { throw new Error('哔哩哔哩连接失败，请检查网络或稍后重试。'); }
    const envelope = result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'body');
    let body = envelope ? result.body : result;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { throw new Error('哔哩哔哩未返回有效数据，请稍后重试。'); }
    }
    if (!body || typeof body !== 'object' || typeof body.code !== 'number') throw new Error('哔哩哔哩接口返回不完整。');
    return { body, headers: envelope ? result.headers || {} : {} };
  }

  async api(path, parameters = {}, cookie = this._cookie) {
    const { body } = await this.response(path, parameters, cookie);
    if (body.code === -101) {
      await this.setCredential(null);
      this.resetAccount('');
      throw new Error('登录已失效，请重新扫码登录。');
    }
    if (body.code === -404 || body.code === 62002) throw new Error('该视频已失效或不可访问。');
    if (body.code === -352 || body.code === -412) throw new Error('请求被站点限制，请稍后重试。');
    if (body.code !== 0) throw new Error('哔哩哔哩接口请求失败（' + body.code + '）。');
    return body.data;
  }

  resetAccount(raw) {
    this._rawCredential = raw || '';
    this._cookie = '';
    this._identity = null; this._identityAt = 0;
    this._folders = null; this._foldersAt = 0; this._foldersPending = null;
    this._views.clear(); this._ends.clear(); this._cursors.clear();
  }

  async credential() {
    const raw = await this.getCredential();
    if (!raw) { this.resetAccount(''); return ''; }
    if (raw === this._rawCredential && this._cookie) return this._cookie;
    this.resetAccount(raw);
    try {
      const stored = JSON.parse(raw);
      if (stored.version !== 1 || typeof stored.cookie !== 'string' ||
          !/(?:^|;\s*)SESSDATA=[^;]+/.test(stored.cookie) || /[\r\n]/.test(stored.cookie)) return '';
      this._cookie = stored.cookie;
    } catch (_) { return ''; }
    return this._cookie;
  }

  async loginStatus() {
    const cookie = await this.credential();
    if (!cookie) return { loggedIn: false };
    if (this._identity && Date.now() - this._identityAt < 60000) return { loggedIn: true, username: this._identity.uname || '' };
    const { body } = await this.response('/x/web-interface/nav', {}, cookie);
    if (body.code === -101 || (body.code === 0 && body.data && body.data.isLogin === false)) {
      await this.setCredential(null); this.resetAccount(''); return { loggedIn: false };
    }
    if (body.code !== 0 || !body.data || body.data.isLogin !== true || !this.numeric(body.data.mid)) {
      throw new Error('无法确认哔哩哔哩登录状态，请稍后重试。');
    }
    this._identity = body.data; this._identityAt = Date.now();
    return { loggedIn: true, username: body.data.uname || '' };
  }

  async ensureLogin() {
    const status = await this.loginStatus();
    if (!status.loggedIn) throw new Error('请先点击“来源登录”，使用哔哩哔哩客户端扫码确认。');
    return this._identity;
  }

  async beginLogin() {
    const epoch = ++this._epoch;
    this._qr = null;
    const { body } = await this.response('/x/passport-login/web/qrcode/generate', {}, '', true);
    const data = body.data;
    if (epoch !== this._epoch) throw new Error('登录已取消。');
    if (body.code !== 0 || !data || typeof data.qrcode_key !== 'string' ||
        !/^https:\/\/(?:account|passport|www)\.bilibili\.com\//i.test(String(data.url || ''))) {
      throw new Error('哔哩哔哩未返回有效登录二维码。');
    }
    this._qr = { key: data.qrcode_key, epoch, expires: Date.now() + 180000 };
    return { qrText: data.url, expiresIn: 180, pollInterval: 3, message: '请用哔哩哔哩客户端扫一扫，并在客户端确认登录。' };
  }

  async cancelLogin() { this._epoch++; this._qr = null; }

  loginCookie(url, headers) {
    const allowed = ['SESSDATA', 'DedeUserID', 'DedeUserID__ckMd5', 'bili_jct'];
    const values = {};
    if (typeof url === 'string' && /^https:\/\/(?:www|passport|account)\.bilibili\.com(?:[/?#]|$)/i.test(url)) {
      const query = url.includes('?') ? url.split('?').slice(1).join('?').split('#')[0] : '';
      for (const pair of query.split('&')) {
        const index = pair.indexOf('='); if (index < 0) continue;
        const key = pair.slice(0, index); if (!allowed.includes(key)) continue;
        try {
          values[key] = decodeURIComponent(pair.slice(index + 1).replace(/\+/g, ' '))
            .replace(/[,;\s]/g, char => encodeURIComponent(char));
        } catch (_) { throw new Error('登录信息格式异常，请重新扫码。'); }
      }
    }
    // The browser API may supply session cookies in headers instead of the URL.
    for (const [name, raw] of Object.entries(headers || {})) {
      if (name.toLowerCase() !== 'set-cookie') continue;
      for (const line of Array.isArray(raw) ? raw : [raw]) {
        const parts = String(line).split(/,\s*(?=(?:SESSDATA|DedeUserID|DedeUserID__ckMd5|bili_jct)=)/);
        for (const part of parts) {
          const match = part.match(/^\s*([^=;]+)=([^;]*)/);
          if (match && allowed.includes(match[1])) values[match[1]] = match[2];
        }
      }
    }
    if (!values.SESSDATA || Object.values(values).some(value => /[\r\n]/.test(value))) {
      throw new Error('未获取到登录信息，请重新扫码。');
    }
    return allowed.filter(key => values[key]).map(key => key + '=' + values[key]).join('; ');
  }

  async pollLogin() {
    const qr = this._qr;
    if (!qr || qr.epoch !== this._epoch) return { status: 'cancelled' };
    if (Date.now() >= qr.expires) { this._qr = null; return { status: 'expired' }; }
    const { body, headers } = await this.response('/x/passport-login/web/qrcode/poll', { qrcode_key: qr.key }, '', true);
    if (qr.epoch !== this._epoch) return { status: 'cancelled' };
    if (body.code !== 0 || !body.data) throw new Error('扫码登录状态读取失败。');
    const code = body.data.code;
    if (code === 86101) return { status: 'waiting' };
    if (code === 86090) return { status: 'scanned' };
    if (code === 86038) { this._qr = null; return { status: 'expired' }; }
    if (code !== 0) throw new Error('扫码登录未完成，请刷新二维码。');
    const cookie = this.loginCookie(body.data.url, headers);
    const { body: checked } = await this.response('/x/web-interface/nav', {}, cookie);
    if (qr.epoch !== this._epoch) return { status: 'cancelled' };
    if (checked.code !== 0 || !checked.data || checked.data.isLogin !== true || !this.numeric(checked.data.mid)) {
      throw new Error('登录校验失败，请重新扫码。');
    }
    const previous = await this.getCredential();
    if (qr.epoch !== this._epoch) return { status: 'cancelled' };
    const raw = JSON.stringify({ version: 1, cookie });
    await this.setCredential(raw);
    if (qr.epoch !== this._epoch) {
      if (await this.getCredential() === raw) await this.setCredential(previous || null);
      return { status: 'cancelled' };
    }
    this.resetAccount(raw); this._cookie = cookie;
    this._identity = checked.data; this._identityAt = Date.now(); this._qr = null;
    return { status: 'success' };
  }

  async logout() { await this.cancelLogin(); await this.setCredential(null); this.resetAccount(''); }

  numeric(value) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return '';
    return /^[1-9]\d{0,18}$/.test(String(value || '')) ? String(value) : '';
  }

  image(value) {
    const url = String(value || '').replace(/^\/\//, 'https://').replace(/^http:/, 'https:');
    return /^https:\/\//i.test(url) ? url : '';
  }

  async folders() {
    await this.ensureLogin();
    if (this._folders && Date.now() - this._foldersAt < 15000) return this._folders;
    if (this._foldersPending) return this._foldersPending;
    const current = this._rawCredential;
    const pending = (async () => {
      const data = await this.api('/x/v3/fav/folder/created/list-all', { up_mid: this._identity.mid });
      if (current !== this._rawCredential) throw new Error('登录状态已变化，请刷新。');
      if (!data || (data.list != null && !Array.isArray(data.list))) throw new Error('收藏夹列表格式不正确。');
      this._folders = (data.list || []).filter(folder => this.numeric(folder.id) && folder.title)
        .map(folder => ({ id: String(folder.id), title: String(folder.title), count: Number(folder.media_count) || 0 }));
      this._foldersAt = Date.now(); return this._folders;
    })();
    this._foldersPending = pending;
    try { return await pending; } finally { if (this._foldersPending === pending) this._foldersPending = null; }
  }

  async channels() { return (await this.folders()).map(folder => ({ title: folder.title, key: folder.id })); }
  async latest(page, channel) { return this.resources(page, '', channel); }
  async search(keyword, page) { return String(keyword || '').trim() ? this.resources(page, String(keyword).trim(), null) : []; }

  async resources(page, keyword, channel) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error('页码不正确。');
    const folders = await this.folders(); if (!folders.length) return [];
    const folder = channel ? folders.find(item => item.id === String(channel)) : folders[0];
    if (!folder) throw new Error('该收藏夹不存在，请刷新后重试。');
    const scope = folder.id + '|' + keyword;
    if (page === 1) { this._ends.delete(scope); this._cursors.set(scope + '|1', 1); }
    if (this._ends.has(scope) && page >= this._ends.get(scope)) return [];
    let actualPage = this._cursors.get(scope + '|' + page) || page;
    for (let attempt = 0; attempt < 6; attempt++, actualPage++) {
      const data = await this.api('/x/v3/fav/resource/list', { media_id: folder.id, pn: actualPage, ps: 20,
        keyword, order: 'mtime', type: keyword ? 1 : 0, tid: 0, platform: 'web' });
      if (!data || (data.medias != null && !Array.isArray(data.medias))) throw new Error('收藏视频列表格式不正确。');
      const items = [], seen = new Set();
      for (const entry of data.medias || []) {
        if (entry.type != null && Number(entry.type) !== 2) continue;
        const id = /^BV[0-9A-Za-z]{10}$/.test(entry.bvid || '') ? entry.bvid : this.numeric(entry.id) ? 'av' + entry.id : '';
        if (!id || !entry.title || seen.has(id)) continue; seen.add(id);
        items.push({ title: String(entry.title), url: '/video/' + id, cover: this.image(entry.cover),
          update: (entry.upper && entry.upper.name ? String(entry.upper.name) : '') + (Number(entry.page) > 1 ? ' · ' + entry.page + 'P' : '') });
      }
      const more = data.has_more === true || data.has_more === 1;
      this._cursors.set(scope + '|' + (page + 1), actualPage + 1);
      if (!more) this._ends.set(scope, page + 1);
      if (items.length || !more) return items;
    }
    throw new Error('当前页非视频内容较多，请尝试其他收藏夹。');
  }

  parseVideo(url) {
    let value = String(url || '');
    if (/^https:\/\/www\.bilibili\.com\//i.test(value)) value = value.replace(/^https:\/\/www\.bilibili\.com/i, '');
    const match = value.match(/^\/video\/(BV[0-9A-Za-z]{10}|av[1-9]\d{0,18})\/?(?:\?([^#]*))?(?:#.*)?$/);
    if (!match) throw new Error('视频地址不正确。');
    const parameters = {};
    for (const pair of (match[2] || '').split('&')) {
      const index = pair.indexOf('=');
      if (index >= 0) parameters[pair.slice(0, index)] = pair.slice(index + 1);
    }
    return { id: match[1], cid: this.numeric(parameters.cid), page: this.numeric(parameters.p) || '1' };
  }

  async view(id) {
    await this.ensureLogin();
    const cached = this._views.get(id);
    if (cached && Date.now() - cached.at < 120000) return cached.data;
    const parameters = id.startsWith('BV') ? { bvid: id } : { aid: id.slice(2) };
    const data = await this.api('/x/web-interface/view', parameters);
    if (!data || !/^BV[0-9A-Za-z]{10}$/.test(data.bvid || '') || !this.numeric(data.aid) || !Array.isArray(data.pages) || !data.pages.length) {
      throw new Error('该视频没有可播放的分 P，或已不可访问。');
    }
    this._views.set(id, { data, at: Date.now() });
    while (this._views.size > 40) this._views.delete(this._views.keys().next().value);
    return data;
  }

  async detail(url) {
    const parsed = this.parseVideo(url), data = await this.view(parsed.id);
    const episodes = data.pages.map((page, index) => ({ page, number: this.numeric(page.page) || String(index + 1) }))
      .filter(({ page }) => this.numeric(page.cid)).map(({ page, number }) => ({
        name: 'P' + number + ' ' + String(page.part || '视频'),
        url: '/video/' + data.bvid + '?cid=' + page.cid + '&p=' + number,
      }));
    if (!episodes.length) throw new Error('该视频暂无可播放的分 P。');
    return { title: String(data.title || ''), cover: this.image(data.pic),
      desc: (data.owner && data.owner.name ? 'UP主：' + data.owner.name + '\n\n' : '') + String(data.desc || ''),
      episodes: [{ title: episodes.length > 1 ? '分 P' : '视频', urls: episodes }] };
  }

  mediaUrl(track) {
    const url = String(track && (track.baseUrl || track.base_url || track.url) || '');
    return /^https?:\/\/[^\s/@?#]+(?:[/?#]|$)/i.test(url) && !/[\r\n]/.test(url) ? url : '';
  }

  async watch(url) {
    const parsed = this.parseVideo(url), view = await this.view(parsed.id);
    const part = parsed.cid ? view.pages.find(page => String(page.cid) === parsed.cid) : view.pages[Number(parsed.page) - 1];
    if (!part || !this.numeric(part.cid)) throw new Error('该分 P 不存在，请重新打开目录。');
    const data = await this.api('/x/player/playurl', { bvid: view.bvid, cid: part.cid, qn: 80, fnval: 4048, fourk: 0 });
    if (!data) throw new Error('未获取到播放地址。');
    const headers = this.headers(); // Session cookies only go to the API, not media CDNs.
    const danmaku = { url: 'https://comment.bilibili.com/' + part.cid + '.xml', format: 'bilibili', headers };
    const videos = data.dash && Array.isArray(data.dash.video) ? data.dash.video : [];
    if (videos.length) {
      const audioTracks = Array.isArray(data.dash.audio) ? data.dash.audio.filter(track => this.mediaUrl(track)) : [];
      const aac = audioTracks.filter(track => /^mp4a/.test(track.codecs || ''));
      const audio = (aac.length ? aac : audioTracks).sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
      if (!audio) throw new Error('该视频未返回可用音轨，请在官方客户端确认播放权限。');
      const selected = new Map();
      for (const track of videos) {
        if (!this.mediaUrl(track) || !this.numeric(track.id) || (Number(data.quality) > 0 && track.id > data.quality)) continue;
        const previous = selected.get(Number(track.id));
        const avc = Number(track.codecid) === 7 || /^avc/.test(track.codecs || '');
        const previousAvc = previous && (Number(previous.codecid) === 7 || /^avc/.test(previous.codecs || ''));
        if (!previous || (avc && !previousAvc)) selected.set(Number(track.id), track);
      }
      const qualities = Array.from(selected.values()).sort((a, b) => b.id - a.id).map(track => {
        const format = (data.support_formats || []).find(format => Number(format.quality) === Number(track.id));
        const index = (data.accept_quality || []).indexOf(Number(track.id));
        const label = format && (format.new_description || format.display_desc) ||
          (data.accept_description || [])[index] || (track.height ? track.height + 'P' : '原画');
        return { label: String(label), type: 'mp4', url: this.mediaUrl(track), audioUrl: this.mediaUrl(audio) };
      });
      if (!qualities.length) throw new Error('该视频暂无可用的清晰度。');
      return { type: 'mp4', url: qualities[0].url, audioUrl: qualities[0].audioUrl, qualities, headers, danmaku };
    }
    const segments = Array.isArray(data.durl) ? data.durl.filter(segment => this.mediaUrl(segment)) : [];
    if (segments.length === 1) return { type: 'mp4', url: this.mediaUrl(segments[0]), headers, danmaku };
    throw new Error(segments.length > 1 ? '此旧版多段视频暂不可播放，请使用官方客户端。' : '未获取到可播放的地址，请在官方客户端确认视频权限。');
  }

  comment(entry, pinned = false) {
    const id = this.numeric(entry && (entry.rpid_str || entry.rpid));
    if (!id || !entry.content || typeof entry.content.message !== 'string') return null;
    const timestamp = Number(entry.ctime);
    return { id, username: String(entry.member && entry.member.uname || '用户'), text: entry.content.message,
      time: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toLocaleString() : '',
      likes: Math.max(0, Number(entry.like) || 0), replyCount: Math.max(0, Number(entry.rcount) || 0), pinned,
      images: (entry.content.pictures || []).map(picture => this.image(picture.img_src)).filter(Boolean) };
  }

  async comments(workUrl, chapterUrl, page, parentId) {
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error('评论页码不正确。');
    const parsed = this.parseVideo(workUrl), view = await this.view(parsed.id);
    if (parentId != null && !this.numeric(parentId)) throw new Error('评论编号不正确。');
    const path = parentId ? '/x/v2/reply/reply' : '/x/v2/reply';
    const data = await this.api(path, { type: 1, oid: view.aid, pn: page, ps: 20, sort: 2, root: parentId || undefined });
    if (!data || (data.replies != null && !Array.isArray(data.replies))) throw new Error('评论接口返回格式不正确。');
    const replies = data.replies || [], comments = [], seen = new Set();
    const add = (entry, pinned) => { const item = this.comment(entry, pinned); if (item && !seen.has(item.id)) { seen.add(item.id); comments.push(item); } };
    if (!parentId && page === 1) {
      for (const entry of Object.values(data.top || {})) add(entry, true);
      if (data.upper && data.upper.top) add(data.upper.top, true);
    }
    for (const entry of replies) add(entry, false);
    const count = data.page && Number(data.page.count);
    const hasMore = replies.length >= 20 && (!Number.isFinite(count) || page * 20 < count);
    return { comments, hasMore, ...(Number.isFinite(count) ? { total: count } : {}), headers: this.headers() };
  }
}
