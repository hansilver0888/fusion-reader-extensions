// ==MiruExtension==
// @name         ESJ Zone
// @version      v1.1.1
// @author       FusionReader
// @lang         zh-tw
// @license      MIT
// @package      esjzone
// @type         fikushon
// @icon         https://img.kookapp.cn/assets/2023-01/rhv1ugUjQw0dd0ef.png
// @webSite      https://www.esjzone.cc
// @nsfw         false
// @network      auto
// ==/MiruExtension==

export default class extends Extension {
  _loginPending = null;

  headers(referer) {
    return { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      Referer: referer || this.webSite + '/' };
  }

  hasMember(html) {
    return typeof html === 'string' && /class=["'][^"']*\buser-name\b[^"']*["'][^>]*>\s*[^<\s]/i.test(html);
  }

  async load() {
    await this.registerSetting({
      title: 'ESJ 帳號 (Email)',
      key: 'email',
      type: 'input',
      description: '翻譯小說需登入才能顯示和閱讀；留空則以訪客身分瀏覽原創作品',
      defaultValue: '',
    });
    await this.registerSetting({
      title: 'ESJ 密碼',
      key: 'password',
      type: 'password',
      description: '僅保存在本機，用於換取站點的登入 Cookie',
      defaultValue: '',
    });
    this.loggedIn = false;
  }

  /// Sign in if credentials are configured. Returns false when the user has
  /// not supplied any, so callers can fall back to guest browsing.
  async ensureLogin(force) {
    if (this.loggedIn && !force) return true;
    if (this._loginPending) return this._loginPending;
    const email = await this.getSetting('email');
    const password = await this.getSetting('password');
    if (!email && !password) { this.loggedIn = false; return false; }
    if (!email || !password) throw new Error('請同時填寫 ESJ 帳號和密碼。');
    if (this.loggedIn && !force) return true;
    // Settings cross an async bridge; another caller may have started meanwhile.
    if (this._loginPending) return this._loginPending;
    this.loggedIn = false;
    const task = (async () => {
      const loginPath = '/my/login', referer = this.webSite + loginPath;
      const headers = { ...this.headers(referer), 'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' };
      await this.request(loginPath, { headers: this.headers(referer), retry: false });
      // Mirror the site's JinJing callback without executing downloaded scripts.
      const auth = await this.request(loginPath, { method: 'post', headers,
        data: 'plxf=getAuthToken', retry: false });
      const tokens = typeof auth === 'string' ? Array.from(auth.matchAll(/<JinJing>([^<>\r\n]+)<\/JinJing>/g)) : [];
      const token = tokens.length ? tokens[tokens.length - 1][1].trim() : '';
      if (!/^[A-Za-z0-9+/=_.-]{8,2048}$/.test(token)) throw new Error('ESJ 登入驗證資料未返回，請稍後重試。');
      const res = await this.request('/inc/mem_login.php', { method: 'post',
        headers: { ...headers, authorization: token },
        data: `email=${encodeURIComponent(email)}&pwd=${encodeURIComponent(password)}&remember_me=on`,
        allowErrorStatus: true, retry: false });
      let body;
      try { body = typeof res === 'string' ? JSON.parse(res) : res; }
      catch (_) { throw new Error('ESJ 登入未返回有效資料，請稍後重試。'); }
      // 301 is a failed/expired authorization response, not a successful login.
      if (Number(body?.status) !== 200) {
        const message = String(body?.msg || '請檢查帳號、密碼或站點狀態').replaceAll(email, '[帳號]').replaceAll(password, '***');
        throw new Error('ESJ 登入失敗：' + message.slice(0, 180));
      }
      const profile = await this.request('/my/profile.html', { headers: this.headers(referer), retry: false });
      if (!this.hasMember(profile)) throw new Error('ESJ 登入已回應成功，但登入 Cookie 未生效，請重試。');
      this.loggedIn = true;
      return true;
    })();
    this._loginPending = task;
    try { return await task; }
    finally { this._loginPending = null; }
  }

  async page(url) {
    await this.ensureLogin(false);
    let html = await this.request(url, { headers: this.headers() });
    if (this.loggedIn && !this.hasMember(html)) {
      await this.ensureLogin(true);
      html = await this.request(url, { headers: this.headers() });
      if (!this.hasMember(html)) throw new Error('ESJ 登入狀態未保留，請稍後重試。');
    }
    if (typeof html !== 'string' || /<title>\s*(?:Just a moment|Attention Required)/i.test(html)) {
      throw new Error('ESJ 網頁未正常載入，請檢查網路後重試。');
    }
    return html;
  }

  imageUrl(value) {
    if (!value || /^\s*(?:data|javascript):/i.test(value)) return '';
    const url = this.absoluteUrl(this.webSite + '/', this.decodeEntities(String(value).trim()));
    return /^https?:\/\/[^\s/@?#]+(?:[/?#][^\s]*)?$/i.test(url) ? url : '';
  }

  async cover(html, detail = false) {
    const selectors = detail ? ['.product-gallery img', '.product-gallery [data-src]'] : ['.main-img [data-src]', '.main-img img', '.card-img-tiles img'];
    for (const selector of selectors) {
      for (const attribute of ['data-src', 'data-original', 'src']) {
        const url = this.imageUrl(await this.getAttributeText(html, selector, attribute));
        if (url && !/\/(?:loading|nophoto|noimage)\.(?:gif|png)(?:[?#]|$)/i.test(url)) return url;
      }
    }
    return '';
  }

  // Cards on list and tag pages share the same markup.
  async parseCards(html) {
    const cards = await this.querySelectorAll(html, 'div.card');
    const out = [];
    const seen = new Set();
    for (const card of cards) {
      const content = await card.content;
      const href = await this.getAttributeText(content, 'h5.card-title a', 'href');
      if (!href || !/\/detail\/\d+\.html/.test(href) || seen.has(href)) continue;
      const titleEl = await this.querySelector(content, 'h5.card-title a');
      const title = titleEl ? (await titleEl.text).trim() : '';
      if (!title) continue;
      seen.add(href);
      const update = await this.querySelector(content, '.card-ep a');
      out.push({ title, url: href, cover: await this.cover(content), update: (await update.text).trim() });
    }
    return out;
  }

  pagePath(base, page) {
    return page <= 1 ? `${base}/` : `${base}/${page}.html`;
  }

  async channels() {
    return [
      { title: '最新更新', key: '' },
      { title: '翻譯・日輕', key: 'japanese' },
      { title: '翻譯・韓輕', key: 'korean' },
      { title: '原創', key: 'original' },
      // Doubles as a login probe: it works only with a live session cookie.
      { title: '我的收藏', key: 'favorites' },
    ];
  }

  async latest(page, channel) {
    if (channel === 'favorites') return this.favorites(page);
    const categories = { japanese: '/list-11', korean: '/list-31', original: '/list-21' };
    if ((channel === 'japanese' || channel === 'korean') && !await this.ensureLogin(false)) {
      throw new Error('翻譯小說需要登入。請在 ESJ 設定中填寫帳號和密碼。');
    }
    const html = await this.page(this.pagePath(categories[channel] || '/list-1', page));
    return this.parseCards(html);
  }

  async favorites(page) {
    const email = await this.getSetting('email');
    if (!email) {
      throw new Error('「我的收藏」需要登入。請在「扩展」頁點本源的設定按鈕填入 ESJ 帳號密碼。');
    }
    await this.ensureLogin(page <= 1); // page 1 re-authenticates; later pages reuse the session
    const html = await this.page(this.pagePath('/my/favorite', page));
    // The member area bounces guests via a script redirect, not a 302. If we
    // still land there after ensureLogin() reported success, the login cookie
    // was not kept — which is exactly what this channel exists to expose.
    if (/window\.location\.href='\/my\/login'/.test(html)) {
      throw new Error('登入請求已通過，但站點未保留登入狀態（Cookie 未生效）。');
    }
    const cards = await this.parseCards(html);
    if (cards.length) return cards;
    // Member pages have gone through several layouts; fall back to scanning
    // every novel link on the page rather than assuming the card markup.
    const links = await this.querySelectorAll(html, 'a');
    const out = [];
    const seen = new Set();
    for (const link of links) {
      const href = await link.getAttributeText('href');
      if (!href || !/\/detail\/\d+\.html/.test(href) || seen.has(href)) continue;
      const title = (await link.text).trim();
      if (!title) continue;
      seen.add(href);
      out.push({ title, url: href, cover: '' });
    }
    return out;
  }

  async search(kw, page) {
    // The site has no plain search endpoint; its tag browser doubles as one.
    const html = await this.page(
      this.pagePath(`/tags/${encodeURIComponent(kw)}`, page)
    );
    return this.parseCards(html);
  }

  async detail(url) {
    const html = await this.page(url);
    const links = await this.querySelectorAll(html, '#chapterList a');

    const titleEl = await this.querySelector(html, 'h2.p-t-10');
    const title = titleEl ? (await titleEl.text).trim() : '';
    if (!title) throw new Error(this.loggedIn ? 'ESJ 未返回作品详情，請確認作品是否仍存在。' : '此作品可能需要登入，請在 ESJ 設定中填寫帳號和密碼。');

    let desc = '';
    const descEl = await this.querySelector(html, 'div.description');
    if (descEl) desc = (await descEl.text).trim();

    const chapters = [];
    for (const link of links) {
      const href = await link.getAttributeText('href');
      if (!href) continue;
      let name = await link.getAttributeText('data-title');
      if (!name) name = (await link.text).trim();
      if (name) chapters.push({ name, url: href });
    }

    return {
      title,
      cover: await this.cover(html, true),
      desc,
      authors: await this.authorsFromMetadata(html),
      episodes: [{ title: '章節', urls: chapters }],
    };
  }

  async readChapter(url) {
    const html = await this.page(url);
    // Text and illustrations in one pass, keeping document order.
    let content = [];
    const container = await this.querySelector(html, 'div.forum-content');
    if (container) {
      content = this.htmlToBlocks(await container.content, `${this.webSite}/`);
    }
    if (!content.length && container) {
      // Some chapters put their body in bare text nodes rather than tags.
      for (const line of (await container.text).split('\n')) {
        const t = line.trim();
        if (t) content.push(t);
      }
    }
    const titleEl = await this.querySelector(html, 'h2');
    return {
      content,
      subtitle: titleEl ? (await titleEl.text).trim() : '',
      // Illustrations are hotlink-protected on the site's image hosts.
      headers: { Referer: `${this.webSite}/` },
    };
  }

  async watch(url) {
    let result = await this.readChapter(url);

    if (!result.content.length) {
      // Empty body usually means the chapter is behind the login wall.
      let signedIn = false;
      try {
        signedIn = await this.ensureLogin(true);
      } catch (e) {
        throw new Error(`本章需要登入，但登入失敗：${e.message}`);
      }
      if (!signedIn) {
        throw new Error(
          '本章沒有可讀內容，可能需要登入。請在「扩展」頁點本源的設定按鈕填入 ESJ 帳號密碼。'
        );
      }
      result = await this.readChapter(url);
      if (!result.content.length) {
        throw new Error('已登入，但本章仍沒有可讀內容（可能是圖片章節或已下架）。');
      }
    }
    return result;
  }
}
