import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// The frames repeat the shape the site ships (checked 2026-10-31): video links
// are `/videos/<slug>-xh<id>`, the page prints an HLS master playlist on xhcdn
// and the detail page carries og: metadata. No real page or media url is stored.
function extension(clock) {
  const context = vm.createContext({
    sendMessage() {},
    Date: clock ? class extends Date { static now() { return clock.now; } } : Date,
  });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/xhamster.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'https://xhamster.com';
  source.sleep = async () => {};
  source.getSetting = async () => '';
  source.setSetting = async () => {};
  return source;
}

const card = ({ slug = 'sample-video-xhFmQfJ', title = 'Sample Title', thumb = 'https://thumb-v0.xhcdn.com/a/abc/526x298.jpg' }) => `
<div class="thumb-list__item">
  <a class="video-thumb__image-container" href="/videos/${slug}">
    <img class="video-thumb__image" src="${thumb}" alt="${title}">
  </a>
  <a class="video-thumb-info__name" href="/videos/${slug}">${title}</a>
</div>`;

const listing = (cards) => `<!doctype html><html><body><div class="thumb-list">${cards.join('\n')}</div></body></html>`;

const master = 'https://video-nss.xhcdn.com/_lym56V6OMs6Af_xKuhhXg==,1793458800/media=hls4/multi=256x144:144p:,426x240:240p:,1280x720:720p:/031/171/614/_TPL_.av1.mp4.m3u8';

const videoPage = ({ title = 'Sample Title', thumb = 'https://thumb-v0.xhcdn.com/a/abc/526x298.jpg', playlist = master, escaped = false } = {}) => `<!doctype html><html><head>
<meta property="og:title" content="${title} - xHamster">
<meta property="og:image" content="${thumb}">
<meta name="description" content="Sample description.">
</head><body><h1>${title}</h1>
${playlist ? `<link rel="preload" href="${escaped ? playlist.replace(/\//g, '\\/') : playlist}" as="fetch" crossorigin="true"/>` : ''}
</body></html>`;

function routes(source, map, seen) {
  const requests = seen || [];
  source.request = async (url, options) => {
    requests.push({ url, options: options || {} });
    const key = String(url).replace(/^https:\/\/xhamster\.com/, '');
    const route = map[key];
    assert.ok(route !== undefined, `Unexpected request: ${url}`);
    return typeof route === 'function' ? route() : route;
  };
  return requests;
}

test('channels are the three content feeds', async () => {
  const source = extension();
  const channels = await source.channels();
  assert.deepEqual(Array.from(channels, (channel) => channel.key), ['categories/japanese', 'categories/uncensored', 'categories/jav']);
});

test('listings and search build the site paths and page them', async () => {
  const source = extension();
  const requests = routes(source, {
    '/categories/japanese': listing([card({ slug: 'one-xhAAAA', title: 'First' })]),
    '/categories/japanese/2': listing([card({ slug: 'two-xhBBBB', title: 'Second' })]),
    '/categories/jav': listing([card({ slug: 'three-xhCCCC', title: 'Third' })]),
    '/search/uncensored%20japanese': listing([card({ slug: 'four-xhDDDD', title: 'Fourth' })]),
    '/search/uncensored%20japanese?page=2': listing([card({ slug: 'five-xhEEEE', title: 'Fifth' })]),
  });
  assert.equal((await source.latest(1, 'categories/japanese'))[0].title, 'First');
  assert.equal((await source.latest(2, '')).length, 1);
  assert.equal((await source.latest(1, 'categories/jav'))[0].title, 'Third');
  assert.equal((await source.search('uncensored japanese', 1))[0].title, 'Fourth');
  assert.equal((await source.search('uncensored japanese', 2))[0].title, 'Fifth');
  assert.deepEqual(Array.from(await source.search('  ', 1)), []);
  await assert.rejects(source.latest(0, ''), /頁碼/);
  assert.deepEqual(requests.map((entry) => entry.url.replace('https://xhamster.com', '')), [
    '/categories/japanese',
    '/categories/japanese/2',
    '/categories/jav',
    '/search/uncensored%20japanese',
    '/search/uncensored%20japanese?page=2',
  ]);
});

test('cards keep one entry per video with the alt as title', () => {
  const source = extension();
  const items = source.cards(listing([
    card({ slug: 'sample-video-xhFmQfJ', title: 'Sample &amp; Title' }),
    card({ slug: 'second-video-xh6gHXo', title: 'Second Title', thumb: 'https://thumb-v0.xhcdn.com/a/def/526x298.jpg' }),
  ]));
  assert.equal(items.length, 2);
  assert.deepEqual(Array.from(items, (item) => item.url), ['/videos/sample-video-xhFmQfJ', '/videos/second-video-xh6gHXo']);
  assert.equal(items[0].title, 'Sample & Title');
  assert.equal(items[0].cover, 'https://thumb-v0.xhcdn.com/a/abc/526x298.jpg');
});

test('detail reads the page metadata', async () => {
  const source = extension();
  routes(source, { '/videos/sample-video-xhFmQfJ': videoPage({ title: 'Sample Title' }) });
  const detail = await source.detail('/videos/sample-video-xhFmQfJ');
  assert.equal(detail.title, 'Sample Title');
  assert.equal(detail.cover, 'https://thumb-v0.xhcdn.com/a/abc/526x298.jpg');
  assert.equal(detail.desc, 'Sample description.');
  assert.deepEqual(Array.from(detail.episodes[0].urls, (entry) => entry.url), ['/videos/sample-video-xhFmQfJ']);
});

test('watch returns the xhcdn master playlist, escaped or not', async () => {
  const source = extension();
  routes(source, { '/videos/sample-video-xhFmQfJ': videoPage({}) });
  const stream = await source.watch('/videos/sample-video-xhFmQfJ');
  assert.equal(stream.type, 'hls');
  assert.equal(stream.url, master);
  assert.equal(stream.headers.Referer, 'https://xhamster.com/');

  const escaped = extension();
  routes(escaped, { '/videos/sample-video-xhFmQfJ': videoPage({ escaped: true }) });
  assert.equal((await escaped.watch('/videos/sample-video-xhFmQfJ')).url, master);

  const empty = extension();
  routes(empty, { '/videos/sample-video-xhFmQfJ': videoPage({ playlist: '' }) });
  await assert.rejects(empty.watch('/videos/sample-video-xhFmQfJ'), /沒有可播放的 m3u8/);
});

test('video urls are validated before any request', () => {
  const source = extension();
  source.request = async () => { throw new Error('should not be called'); };
  for (const url of ['', '/categories/japanese', 'https://other.example/videos/abc', '/videos/', '/videos']) {
    assert.throws(() => source.target(url), /無效的影片地址|無法解析影片地址/);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(source.target('https://xhamster.com/videos/sample-video-xhFmQfJ#comments'))), {
    path: '/videos/sample-video-xhFmQfJ',
    slug: 'sample-video-xhFmQfJ',
  });
});
