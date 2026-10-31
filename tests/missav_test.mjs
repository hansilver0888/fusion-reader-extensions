import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// The frames below repeat the shape the site ships: work anchors, a lazy
// thumbnail, og meta on the video page and an embedded playlist. No real page
// or media url is stored in this repository.
function extension() {
  const context = vm.createContext({ sendMessage() {}, Date });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/missav.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'https://missav.ai';
  source._site = 'https://missav.ai';
  source.sleep = async () => {};
  return source;
}

const challengePage = '<!DOCTYPE html><html><head><title>Just a moment...</title></head>'
  + '<body><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script></body></html>';

const card = ({ slug, title, cover = `https://fourhoi.com/${slug}/cover-n.jpg`, dm = 'dm38' }) => `
<div class="thumbnail group">
  <a href="/${dm}/zh/${slug}" class="cover">
    <img data-src="${cover}" src="data:image/gif;base64,R0lGOD" alt="${title}">
  </a>
  <div class="title"><a href="/${dm}/zh/${slug}">${title}</a></div>
</div>`;

const listing = (cards) => `<!doctype html><html><body><div class="grid">${cards.join('\n')}</div></body></html>`;

const videoPage = ({ title = 'ABP-123 示例標題', cover = 'https://fourhoi.com/abp-123/cover-n.jpg', stream = 'https://surrit.com/1c2e-uuid/1080p/video.m3u8' } = {}) => `<!doctype html><html><head>
<meta property="og:title" content="${title} - MissAV">
<meta property="og:image" content="${cover}">
<meta name="description" content="示例描述文字">
</head><body><h1>${title}</h1>
<video id="player" class="player" data-src="${stream}" poster="${cover}"></video>
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

test('entries are limited to the missav families and normalised', () => {
  const source = extension();
  assert.equal(source.normalizeEntry('missav.ai'), 'https://missav.ai');
  assert.equal(source.normalizeEntry('https://missav.ws/'), 'https://missav.ws');
  assert.equal(source.normalizeEntry('http://missav.live'), 'https://missav.live');
  assert.equal(source.normalizeEntry('https://missav.com'), '');
  assert.equal(source.normalizeEntry('https://missav.ai/dm38/zh'), '');
  assert.equal(source.normalizeEntry(''), '');
});

test('a challenged host is reported with the cookie instructions', async () => {
  const source = extension();
  source._site = '';
  source.getSetting = async () => '';
  routes(source, {
    '/': () => { throw new Error('HTTP 403'); },
  });
  await assert.rejects(source.entry(), /沒有可用的 missav 入口|Cloudflare/);
});

test('the first host that answers without a challenge wins', async () => {
  const source = extension();
  source._site = '';
  source.getSetting = async () => '';
  const requests = routes(source, {
    '/': challengePage,
  });
  // missav.ai and missav.ws are challenged, missav.live answers
  requests.length = 0;
  source.request = async (url) => {
    requests.push({ url });
    if (url.startsWith('https://missav.ai/') || url.startsWith('https://missav.ws/')) return challengePage;
    return '<html><body><a href="/dm38/zh/abp-123">work</a></body></html>';
  };
  assert.equal(await source.resolveEntry(), 'https://missav.live');
});

test('the cookie and user agent from the settings are sent with every read', async () => {
  const source = extension();
  const values = { cookie: 'cf_clearance=abc; session=1', user_agent: 'Mozilla/5.0 (X11) TestBrowser/1.0' };
  source.getSetting = async (key) => values[key] || '';
  const seen = [];
  routes(source, { '/dm38/zh/new': listing([card({ slug: 'abp-123', title: '示例作品' })]) }, seen);
  await source.latest(1, 'new');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].headers.Cookie, 'cf_clearance=abc; session=1');
  assert.equal(seen[0].headers['User-Agent'], 'Mozilla/5.0 (X11) TestBrowser/1.0');
  assert.ok(seen[0].headers['Accept-Language']);
});

test('listing channels page the site feeds and parse work cards tolerantly', async () => {
  const source = extension();
  source.getSetting = async () => '';
  const requests = routes(source, {
    '/dm38/zh/release?page=2': listing([
      card({ slug: 'abp-123', title: '示例作品 &amp; 副標題' }),
      card({ slug: 'ssis-456', title: '第二部作品', dm: 'dm51' }),
      card({ slug: 'abp-123', title: '重複的作品' }),
      '<div class="thumbnail"><a href="/dm38/zh/genres">分類</a></div>',
    ]),
    '/dm38/zh/new': listing([card({ slug: 'abp-123', title: '示例作品 &amp; 副標題' })]),
  });
  const items = await source.latest(2, 'release');
  assert.equal(items.length, 2);
  assert.equal(items[0].url, '/dm38/zh/abp-123');
  assert.equal(items[0].title, '示例作品 & 副標題');
  assert.equal(items[0].cover, 'https://fourhoi.com/abp-123/cover-n.jpg');
  assert.equal(items[1].url, '/dm51/zh/ssis-456');
  assert.deepEqual(requests.map((entry) => entry.url), ['https://missav.ai/dm38/zh/release?page=2']);
  // an unknown channel falls back to the newest feed
  assert.equal((await source.latest(1, '')).length, 1);
  assert.deepEqual(requests.map((entry) => entry.url), [
    'https://missav.ai/dm38/zh/release?page=2',
    'https://missav.ai/dm38/zh/new',
  ]);
});

test('search encodes the keyword and rejects empty input', async () => {
  const source = extension();
  source.getSetting = async () => '';
  const requests = routes(source, {
    '/dm38/zh/search/%E7%A4%BA%E4%BE%8B%20ABP': listing([card({ slug: 'abp-123', title: '示例作品' })]),
  });
  assert.equal((await source.search('  示例 ABP  ', 1)).length, 1);
  assert.deepEqual(Array.from(await source.search('   ', 1)), []);
  await assert.rejects(source.search('示例', 0), /頁碼/);
  assert.deepEqual(requests.map((entry) => entry.url), ['https://missav.ai/dm38/zh/search/%E7%A4%BA%E4%BE%8B%20ABP']);
});

test('detail reads the video page metadata', async () => {
  const source = extension();
  source.getSetting = async () => '';
  routes(source, { '/dm38/zh/abp-123': videoPage({ title: 'ABP-123 示例標題' }) });
  const detail = await source.detail('/dm38/zh/abp-123');
  assert.equal(detail.title, 'ABP-123 示例標題');
  assert.equal(detail.cover, 'https://fourhoi.com/abp-123/cover-n.jpg');
  assert.equal(detail.desc, '示例描述文字');
  assert.equal(detail.episodes[0].urls[0].url, '/dm38/zh/abp-123');
});

test('watch returns the embedded playlist with a referer, preferring the master one', async () => {
  const source = extension();
  source.getSetting = async () => '';
  const page = videoPage({ stream: 'https://surrit.com/1c2e-uuid/1080p/video.m3u8' })
    .replace('</body>', '<script>var sample = "https://surrit.com/1c2e-uuid/720p/video.m3u8";</script></body>');
  routes(source, { '/dm38/zh/abp-123': page });
  const stream = await source.watch('/dm38/zh/abp-123');
  assert.equal(stream.type, 'hls');
  assert.equal(stream.url, 'https://surrit.com/1c2e-uuid/1080p/video.m3u8');
  assert.equal(stream.headers.Referer, 'https://missav.ai/');

  const noStream = extension();
  noStream.getSetting = async () => '';
  routes(noStream, { '/dm38/zh/abp-123': '<html><body><h1>沒有播放器</h1></body></html>' });
  await assert.rejects(noStream.watch('/dm38/zh/abp-123'), /Cookie 過期|沒有內嵌播放地址/);
});

test('work urls are validated before any request is made', async () => {
  const source = extension();
  source.request = async () => { throw new Error('should not be called'); };
  for (const url of ['https://example.com/dm38/zh/abp-123', '/pages/new', '', '/dm38/zh']) {
    assert.throws(() => source.target(url), /無效的影片地址|無法解析影片地址/);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(source.target('/dm51/zh/ssis-456'))), { path: '/dm51/zh/ssis-456', slug: 'ssis-456' });
});

test('a challenge page during a read explains how to refresh the cookie', async () => {
  const source = extension();
  source.getSetting = async () => '';
  routes(source, { '/dm38/zh/new': challengePage });
  await assert.rejects(source.latest(1, 'new'), /Cloudflare 驗證頁|Cookie/);
});

test('the entry resolution also picks the host line prefix', async () => {
  const source = extension();
  source._site = '';
  source.getSetting = async () => '';
  source.request = async (url) => {
    if (url === 'https://missav.ai/') {
      return '<html><body><a href="/dm51/ja/abp-123">work</a><a href="/dm51/ja/new">new</a></body></html>';
    }
    if (url === 'https://missav.ai/dm51/ja/new') return listing([card({ slug: 'abp-123', title: '示例作品', dm: 'dm51' })]);
    throw new Error('Unexpected request: ' + url);
  };
  assert.equal(await source.entry(), 'https://missav.ai');
  assert.equal(source.line(), 'dm51/ja');
  const items = await source.latest(1, '');
  assert.equal(items.length, 1);
  // the feed url used the resolved line (dm51/ja), the card keeps its own link
  assert.equal(items[0].url, '/dm51/zh/abp-123');
});

test('load registers the three settings even without a settings ui', async () => {
  const source = extension();
  const registered = [];
  source.registerSetting = async (setting) => { registered.push(setting.key); };
  source.getSetting = async () => '';
  source.request = async () => '<html><body><a href="/dm38/zh/abp-123">work</a></body></html>';
  await source.load();
  assert.deepEqual(registered, ['cookie', 'user_agent', 'host']);
});
