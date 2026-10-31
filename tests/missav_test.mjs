import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// The frames below repeat the shape the site ships (checked 2026-10-31):
// `div.thumbnail.group` cards, `/<lang>/<code>` work urls, the lazy cover on
// fourhoi and a surrit uuid printed in the thumbnail strip.
function extension(clock) {
  const context = vm.createContext({
    sendMessage() {},
    Date: clock ? class extends Date { static now() { return clock.now; } } : Date,
  });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/missav.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'https://missav.ai';
  source._site = 'https://missav.ai';
  source._lang = 'cn';
  source.sleep = async () => {};
  // The bridge never settles in the harness; settings are overridden per test.
  source.getSetting = async () => '';
  source.setSetting = async () => {};
  return source;
}

const challengePage = '<!DOCTYPE html><html><head><title>Just a moment...</title></head>'
  + '<body><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>';

const card = ({ slug = 'mina-019', title = '示例作品 月野友音', duration = '2:00:00', lang = 'cn', prefix = '' }) => `
<div >
  <div @mouseenter="setPreview('x')" @click="clickPreview('x')" class="thumbnail group" >
    <div class="relative aspect-w-16 aspect-h-9 rounded overflow-hidden shadow-lg">
      <a href="https://missav.ai/${lang}/${slug}" alt="${slug}" >
        <video class="preview hidden" loop muted data-src="https://fourhoi.com/${slug}/preview.mp4"></video>
        <img class="lozad w-full" data-src="https://fourhoi.com/${slug}/cover-t.jpg" src="data:image/png;base64,AA" alt="${title}" >
      </a>
      <a href="https://missav.ai/${lang}/${slug}" alt="${slug}" >
        <span class="absolute bottom-1 right-1 rounded-lg px-2 py-1 text-xs text-nord5 bg-gray-800">${duration}</span>
      </a>
    </div>
  </div>
</div>`;

const listing = (cards, extra = '') => `<!doctype html><html><body>
<nav><a href="/dm539/cn/new">最新</a><a href="/dm635/cn/release">發售</a><a href="/cn/genres">分類</a></nav>
${extra}
<div class="grid">${cards.join('\n')}</div>
</body></html>`;

const uuid = 'e0258f43-b477-46a3-8dd8-415ef7ef399b';
const workPage = ({ title = 'MINA-019 示例作品 - 月野ゆりね', cover = 'https://fourhoi.com/mina-019/cover-t.jpg', stream = true } = {}) => `<!doctype html><html><head>
<meta property="og:title" content="${title} - MissAV | 免费高清AV在线看">
<meta property="og:image" content="${cover}">
<meta property="og:description" content="示例描述文字">
</head><body><h1>${title}</h1>
${stream ? `<img src="https:\\/\\/surrit.com\\/${uuid}\\/seek\\/_0.jpg">` : ''}
</body></html>`;

function routes(source, map, seen) {
  const requests = seen || [];
  source.request = async (url, options) => {
    requests.push({ url, headers: (options && options.headers) || {} });
    const path = String(url).replace(/^https:\/\/[^/]+/, '');
    const route = map[path];
    assert.ok(route !== undefined, `Unexpected request: ${url}`);
    return typeof route === 'function' ? route() : route;
  };
  return requests;
}

test('cookies are normalised: bare tokens, full strings and cURL pastes', () => {
  const source = extension();
  assert.equal(source.normalizeCookie('abc-123'), 'cf_clearance=abc-123');
  assert.equal(source.normalizeCookie('cf_clearance=abc; __cf_bm=1'), 'cf_clearance=abc; __cf_bm=1');
  assert.equal(source.normalizeCookie('Cookie: cf_clearance=abc'), 'cf_clearance=abc');
  assert.equal(source.normalizeCookie(`curl 'https://x' -H 'cookie: cf_clearance=abc; x=1' -H 'user-agent: UA'`), 'cf_clearance=abc; x=1');
  assert.equal(source.normalizeCookie(''), '');
  assert.equal(source.normalizeAgent(`curl x -H 'user-agent: Mozilla/5.0 Test'`), 'Mozilla/5.0 Test');
  assert.equal(source.normalizeAgent('Mozilla/5.0 Test'), 'Mozilla/5.0 Test');
});

test('a field holding "cookie: … ua: …" is split into both values', () => {
  const source = extension();
  const combined = source.parseCredentials('cookie:abc-token ua:Mozilla/5.0 (Linux; Android 16) Chrome/156 Mobile Safari/537.36');
  assert.equal(combined.cookie, 'cf_clearance=abc-token');
  assert.equal(combined.agent, 'Mozilla/5.0 (Linux; Android 16) Chrome/156 Mobile Safari/537.36');

  const reversed = source.parseCredentials('ua:Mozilla/5.0 (X11) Test cookie:cf_clearance=xyz; a=1');
  assert.equal(reversed.cookie, 'cf_clearance=xyz; a=1');
  assert.equal(reversed.agent, 'Mozilla/5.0 (X11) Test');

  const plain = source.parseCredentials('cf_clearance=abc');
  assert.equal(plain.cookie, 'cf_clearance=abc');
  assert.equal(plain.agent, '');
  assert.deepEqual(JSON.parse(JSON.stringify(source.parseCredentials(''))), { cookie: '', agent: '' });
});

test('the agent pasted with the cookie is used when the ua field is empty', async () => {
  const source = extension();
  source.getSetting = async (key) => (key === 'cookie'
    ? 'cookie:cf_clearance=abc ua:Mozilla/5.0 (Linux; Android 16) Chrome/156 Mobile'
    : '');
  const seen = [];
  routes(source, { '/cn/new': listing([card({})]) }, seen);
  await source.latest(1, 'new');
  assert.equal(seen[0].headers['User-Agent'], 'Mozilla/5.0 (Linux; Android 16) Chrome/156 Mobile');
  assert.equal(seen[0].headers.cookie, 'cf_clearance=abc');
});

test('entries are limited to the missav families and the probe uses the language root', async () => {
  const source = extension();
  assert.equal(source.normalizeEntry('missav.ai'), 'https://missav.ai');
  assert.equal(source.normalizeEntry('https://missav.ws/'), 'https://missav.ws');
  assert.equal(source.normalizeEntry('https://missav.com'), '');
  assert.equal(source.normalizeEntry('https://missav.ai/cn'), '');

  const probe = extension();
  probe._site = '';
  probe.getSetting = async (key) => (key === 'language' ? 'cn' : '');
  const requests = routes(probe, {
    '/cn': listing([card({})]),
  });
  assert.equal(await probe.entry(), 'https://missav.ai');
  assert.equal(probe._lang, 'cn');
  assert.deepEqual(requests.map((entry) => entry.url), ['https://missav.ai/cn']);
});

test('a challenged host falls through to the next mirror and explains when all fail', async () => {
  const source = extension();
  source._site = '';
  source.getSetting = async () => '';
  source.request = async (url) => {
    if (url.startsWith('https://missav.live/')) return listing([card({})]);
    return challengePage;
  };
  assert.equal(await source.resolveEntry(), 'https://missav.live');

  const dead = extension();
  dead._site = '';
  dead.getSetting = async () => '';
  dead.request = async () => challengePage;
  await assert.rejects(dead.resolveEntry(), /沒有可用的 missav 入口|Cloudflare/);
});

test('a cookie without a user agent retries the candidate agents and stores the one that works', async () => {
  const source = extension();
  source._site = '';
  source.getSetting = async (key) => ({
    cookie: 'cf_clearance=abc',
    user_agent: '',
    language: 'cn',
  }[key] || '');
  const saved = [];
  source.setSetting = async (key, value) => { saved.push([key, value]); };
  const seen = [];
  source.request = async (url, options) => {
    seen.push({ url, agent: (options.headers || {})['User-Agent'] || '' });
    if (url !== 'https://missav.ai/cn') return challengePage;
    // only the second candidate is accepted by the edge
    const agent = (options.headers || {})['User-Agent'] || '';
    return agent.includes('Android 14') ? listing([card({})]) : challengePage;
  };
  assert.equal(await source.entry(), 'https://missav.ai');
  assert.equal(seen.length, 2);
  assert.ok(seen[0].agent.includes('Android 16'));
  assert.ok(seen[1].agent.includes('Android 14'));
  assert.deepEqual(saved, [['user_agent', seen[1].agent]]);
});

test('the cookie and user agent from the settings go out with every read', async () => {
  const source = extension();
  source.getSetting = async (key) => ({
    cookie: 'cf_clearance=abc; __cf_bm=1',
    user_agent: 'Mozilla/5.0 (Linux; Android) Chrome/156 Mobile',
  }[key] || '');
  const seen = [];
  routes(source, { '/cn/new': listing([card({})]) }, seen);
  await source.latest(1, 'new');
  assert.equal(seen.length, 1);
  // the lowercase key is what the app's cookie manager merges with its jar
  assert.equal(seen[0].headers.cookie, 'cf_clearance=abc; __cf_bm=1');
  assert.equal(seen[0].headers.Cookie, 'cf_clearance=abc; __cf_bm=1');
  // the exact case keeps the app from appending its own user agent
  assert.equal(seen[0].headers['User-Agent'], 'Mozilla/5.0 (Linux; Android) Chrome/156 Mobile');
});

test('listing sections and search build the site paths and page them', async () => {
  const source = extension();
  source.getSetting = async () => '';
  const requests = routes(source, {
    '/cn/new': listing([card({ slug: 'mina-019', title: '示例作品' })]),
    '/cn/release?page=2': listing([card({ slug: 'dvmm-458', title: '第二部' })]),
    '/cn/search/%E4%BA%BA%E5%A6%BB': listing([card({ slug: 'ps-134', title: '搜索命中' })]),
  });
  assert.equal((await source.latest(1, 'new')).length, 1);
  assert.equal((await source.latest(2, 'release')).length, 1);
  assert.equal((await source.search('人妻', 1)).length, 1);
  assert.deepEqual(Array.from(await source.search('  ', 1)), []);
  await assert.rejects(source.latest(0, 'new'), /頁碼/);
  assert.deepEqual(requests.map((entry) => entry.url), [
    'https://missav.ai/cn/new',
    'https://missav.ai/cn/release?page=2',
    'https://missav.ai/cn/search/%E4%BA%BA%E5%A6%BB',
  ]);
  assert.deepEqual(Array.from(await source.channels(), (channel) => channel.key).slice(0, 3), ['new', 'release', 'today-hot']);
});

test('cards come from the thumbnail blocks, so section links are not works', () => {
  const source = extension();
  const items = source.cards(listing([
    card({ slug: 'mina-019', title: '示例作品 &amp; 副標題', duration: '1:58:00' }),
    card({ slug: 'fc2-ppv-4997591', title: 'FC2 作品', lang: 'cn' }),
    card({ slug: 'mina-019', title: '重複' }),
  ]));
  assert.equal(items.length, 2);
  assert.deepEqual(Array.from(items, (item) => item.url), ['/cn/mina-019', '/cn/fc2-ppv-4997591']);
  assert.equal(items[0].title, '示例作品 & 副標題');
  assert.equal(items[0].cover, 'https://fourhoi.com/mina-019/cover-t.jpg');
  assert.equal(items[0].update, '1:58:00');
});

test('work urls accept the rotating dm prefix and refuse section slugs', () => {
  const source = extension();
  assert.equal(source.parseWork('/cn/mina-019'), '/cn/mina-019');
  assert.equal(source.parseWork('/dm539/cn/dvmm-458'), '/cn/dvmm-458');
  assert.equal(source.parseWork('/cn/fc2-ppv-4997591'), '/cn/fc2-ppv-4997591');
  assert.equal(source.parseWork('/cn/123456_001'), '/cn/123456_001');
  for (const path of ['/cn/new', '/cn/genres', '/cn/fc2', '/cn/1pondo', '/ja/siro', '/xx/mina-019', '/cn']) {
    assert.equal(source.parseWork(path), '', path);
  }
  assert.throws(() => source.target('https://example.com/cn/mina-019'), /無效的影片地址/);
});

test('detail reads the work metadata and offers the quality variants', async () => {
  const source = extension();
  source.getSetting = async () => '';
  routes(source, { '/cn/mina-019': workPage({ title: 'MINA-019 示例作品 - 月野ゆりね' }) });
  const detail = await source.detail('/cn/mina-019');
  assert.equal(detail.title, 'MINA-019 示例作品 - 月野ゆりね');
  assert.equal(detail.cover, 'https://fourhoi.com/mina-019/cover-t.jpg');
  assert.equal(detail.desc, '示例描述文字');
  assert.deepEqual(Array.from(detail.episodes[0].urls, (entry) => [entry.name, entry.url]), [
    ['1080p', '/cn/mina-019#1080p'],
    ['720p', '/cn/mina-019#720p'],
    ['預設', '/cn/mina-019'],
  ]);
});

test('streams are rebuilt from the uuid the page prints, honouring the requested quality', async () => {
  const source = extension();
  source.getSetting = async () => '';
  routes(source, { '/cn/mina-019': workPage({}) });

  const preset = await source.watch('/cn/mina-019');
  assert.equal(preset.type, 'hls');
  assert.equal(preset.url, `https://surrit.com/${uuid}/source842.m3u8`);
  assert.equal(preset.headers.Referer, 'https://missav.ai/');
  assert.equal(preset.headers.Cookie, undefined);

  const best = await source.watch('/cn/mina-019#1080p');
  assert.equal(best.url, `https://surrit.com/${uuid}/1080p/video.m3u8`);
  const smaller = await source.watch('/cn/mina-019#720p');
  assert.equal(smaller.url, `https://surrit.com/${uuid}/720p/video.m3u8`);

  const withCookie = extension();
  withCookie.getSetting = async (key) => (key === 'stream_cookie' ? 'cf_clearance=stream' : '');
  routes(withCookie, { '/cn/mina-019': workPage({}) });
  const guarded = await withCookie.watch('/cn/mina-019');
  assert.equal(guarded.headers.Cookie, 'cf_clearance=stream');
});

test('watch falls back to an explicit playlist and reports pages without one', async () => {
  const source = extension();
  source.getSetting = async () => '';
  routes(source, {
    '/cn/dvmm-458': `<!doctype html><html><body><video data-src="https:\\/\\/cdn.example.com\\/dvmm-458\\/index.m3u8"></video></body></html>`,
  });
  const direct = await source.watch('/cn/dvmm-458');
  assert.equal(direct.url, 'https://cdn.example.com/dvmm-458/index.m3u8');

  const empty = extension();
  empty.getSetting = async () => '';
  routes(empty, { '/cn/ps-134': workPage({ stream: false }) });
  await assert.rejects(empty.watch('/cn/ps-134'), /找不到播放地址|Cookie/);
});

test('a challenge page during a read explains how to refresh the session', async () => {
  const source = extension();
  source.getSetting = async () => '';
  routes(source, { '/cn/new': challengePage });
  await assert.rejects(source.latest(1, 'new'), /Cloudflare 驗證頁|Cookie/);
});

test('a cookie saved after the plugin loaded is used without an app restart', async () => {
  const clock = { now: 1000 };
  const source = extension(clock);
  let cookie = '';
  source.getSetting = async (key) => (key === 'cookie' ? cookie : '');
  const seen = [];
  routes(source, {
    '/cn/new': listing([card({})]),
    '/cn/release': listing([card({ slug: 'dvmm-458', title: '第二部' })]),
  }, seen);

  await source.latest(1, 'new');
  assert.equal(seen[0].headers.cookie, undefined);

  // the user saves the settings while the app keeps running
  cookie = 'cf_clearance=fresh';
  clock.now += 6000;
  await source.latest(1, 'release');
  assert.equal(seen[1].headers.cookie, 'cf_clearance=fresh');
  assert.equal(seen[1].headers.Cookie, 'cf_clearance=fresh');
});

test('a challenged read drops the snapshot so the next attempt re-reads the settings', async () => {
  const source = extension();
  let cookie = 'cf_clearance=old';
  source.getSetting = async (key) => (key === 'cookie' ? cookie : '');
  let attempts = 0;
  source.request = async (url, options) => {
    attempts++;
    if (attempts === 1) return challengePage;
    assert.equal((options.headers || {}).cookie, 'cf_clearance=old');
    return listing([card({})]);
  };
  await assert.rejects(source.latest(1, 'new'), /Cloudflare 驗證頁/);
  assert.equal(source._session, null);
  assert.equal((await source.latest(1, 'new')).length, 1);
});

test('clearance age comes from the epoch embedded in the value', () => {
  const clock = { now: 1790000000000 };
  const source = extension(clock);
  assert.equal(source.clearanceAge('cf_clearance=abc-1790000000-1.2.1.1-payload'), 0);
  assert.equal(source.clearanceAge('cf_clearance=abc-1790348026-1.2.1.1-payload'), 0);
  clock.now = 1790348026000 + 5 * 86400000;
  assert.equal(source.clearanceAge('cf_clearance=abc-1790348026-1.2.1.1-payload'), 5 * 86400000);
  const old = extension({ now: 1790348026000 + 40 * 86400000 });
  assert.equal(old.clearanceAge('cf_clearance=abc-1790348026-1.2.1.1-payload'), 40 * 86400000);
  assert.equal(old.clearanceAge('cf_clearance=no-timestamp'), 0);
  assert.equal(old.clearanceAge(''), 0);
});

test('a challenge error reports what was sent, the page kind and a stale clearance', async () => {
  const clock = { now: 1790348026000 + 40 * 86400000 };
  const source = extension(clock);
  source.getSetting = async (key) => ({
    cookie: 'cf_clearance=abc-1790348026-1.2.1.1-payload',
    user_agent: 'Mozilla/5.0 (Linux; Android 16) Chrome/156 Mobile',
  }[key] || '');
  const seen = [];
  source.request = async (url, options) => {
    seen.push(options);
    return challengePage;
  };
  await assert.rejects(source.latest(1, 'new'), (error) => {
    assert.match(error.message, /Cloudflare 驗證頁/);
    assert.match(error.message, /本次送出：Cookie\s+（\d+ 字元，含 cf_clearance）/);
    assert.match(error.message, /UA\s+（Mozilla\/5\.0 \(Linux; Android 16\)/);
    assert.match(error.message, /40 天前簽發/);
    return true;
  });
  // the body has to reach the plugin, so the app must not throw on the 403
  assert.equal(seen[0].allowErrorStatus, true);

  const blocked = extension();
  blocked.getSetting = async () => '';
  blocked.request = async () => '<html><body><h1>Attention Required! | Cloudflare</h1><div id="cf-error-details"></div></body></html>';
  await assert.rejects(blocked.latest(1, 'new'), /攔截頁（Attention Required）/);
});

test('load registers the five settings even without a settings ui', async () => {
  const source = extension();
  const registered = [];
  source.registerSetting = async (setting) => { registered.push(setting.key); };
  source.getSetting = async () => '';
  source.request = async () => listing([card({})]);
  await source.load();
  assert.deepEqual(registered, ['cookie', 'user_agent', 'stream_cookie', 'language', 'host']);
});
