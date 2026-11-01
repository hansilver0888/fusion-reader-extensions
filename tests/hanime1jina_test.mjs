import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// Frames repeat the markup the site serves (checked 2026-11-01) and the two card
// shapes it uses: the rich container on home/search and the genre grid. The
// reader request is stubbed, so nothing here touches the network.
function extension(clock) {
  const context = vm.createContext({
    sendMessage() {},
    Date: clock ? class extends Date { static now() { return clock.now; } } : Date,
  });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/hanime1jina.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'http://hanime1.me';
  source.sleep = async () => {};
  source.getSetting = async () => '';
  source.setSetting = async () => {};
  return source;
}

const richCard = ({ id = '408948', title = '示例作品', cover = `https://vdownload.hembed.com/image/thumbnail/${id}l.jpg?secure=x` }) => `
<div title="${title}" class="video-item-container">
  <div class="horizontal-card">
    <a href="https://hanime1.me/watch?v=${id}" class="video-link">
      <div class="thumb-container">
        <img class="main-thumb" src="${cover}" loading="lazy">
        <div class="duration"> 03:57 </div>
      </div>
    </a>
  </div>
</div>`;

const gridCard = ({ id = '408323', title = '示例作品 6', cover = `https://vdownload.hembed.com/image/cover/${id}.jpg?secure=y` }) => `
<a style="text-decoration: none;" href="https://hanime1.me/watch?v=${id}">
  <div class="home-rows-videos-div search-videos hover-lighter">
    <div class="video-card-inner" style="position: relative;">
      <img loading="lazy" src="${cover}">
      <div class="home-rows-videos-title"> ${title} </div>
    </div>
  </div>
</a>`;

const listing = (cards) => `<!doctype html><html><body>${cards.join('\n')}</body></html>`;

const videoPage = ({ id = '408948', title = '示例作品', sources = [
  { size: 720, url: `https://vdownload.hembed.com/${id}-720p.mp4?secure=a` },
  { size: 1080, url: `https://vdownload.hembed.com/${id}-1080p.mp4?secure=b` },
  { size: 480, url: `https://vdownload.hembed.com/${id}-480p.mp4?secure=c` },
] } = {}) => `<!doctype html><html><head>
<meta property="og:title" content="${title} - H動漫/裏番/線上看 - Hanime1.me">
<meta property="og:image" content="https://vdownload.hembed.com/image/thumbnail/${id}h.jpg?secure=z">
<meta name="description" content="示例簡介">
<title>${title} - H動漫/裏番/線上看 - Hanime1.me</title>
</head><body><video id="player" controls>
${sources.map((source) => `<source src="${source.url}" type="video/mp4" size="${source.size}">`).join('\n')}
</video></body></html>`;

function routes(source, handler, log) {
  const requests = log || [];
  source.request = async (url, options) => {
    requests.push({ url, options: options || {} });
    return handler(url, options || {});
  };
  return requests;
}

test('requests go through the reader with the html return format', async () => {
  const source = extension();
  const requests = routes(source, () => listing([richCard({})]));
  await source.latest(1, '0');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://r.jina.ai/https://hanime1.me/');
  assert.equal(requests[0].options.headers['x-return-format'], 'html');
  // the listing is trimmed to its cards to save reader tokens
  assert.equal(requests[0].options.headers['x-target-selector'], 'div.video-item-container');
  assert.equal(requests[0].options.headers['x-no-cache'], 'false');
});

test('the api key setting becomes a bearer header when it is filled in', async () => {
  const source = extension();
  const requests = routes(source, () => listing([richCard({})]));
  source.getSetting = async (key) => (key === 'api_key' ? 'Bearer jina_abc123' : '');
  await source.latest(1, '0');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer jina_abc123');

  const anonymous = extension();
  const anonymousRequests = routes(anonymous, () => listing([richCard({})]));
  await anonymous.latest(1, '0');
  assert.equal(anonymousRequests[0].options.headers.Authorization, undefined);

  const bare = extension();
  const bareRequests = routes(bare, () => listing([richCard({})]));
  bare.getSetting = async (key) => (key === 'api_key' ? '  jina_xyz  ' : '');
  await bare.latest(1, '0');
  assert.equal(bareRequests[0].options.headers.Authorization, 'Bearer jina_xyz');
});

test('the video page is trimmed to the player and its metadata', async () => {
  const source = extension();
  const requests = routes(source, () => videoPage({}));
  await source.watch('/watch?v=408948');
  assert.equal(requests[0].options.headers['x-target-selector'], 'video#player, meta[property^="og:"], title');
});

test('a genre page is read whole and without the reader cache', async () => {
  const source = extension();
  const requests = routes(source, () => listing([gridCard({})]));
  const items = await source.latest(1, '1');
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://hanime1.me/watch?v=408323');
  // trimming a genre page drops the wrapping anchor, so no selector is sent
  assert.equal(requests[0].options.headers['x-target-selector'], undefined);
  assert.equal(requests[0].options.headers['x-no-cache'], 'true');
});

test('a listing that parses to nothing is retried from a fresh render', async () => {
  const source = extension();
  let calls = 0;
  const requests = routes(source, () => {
    calls += 1;
    // first answer: anchors stripped (the reader's broken cache)
    if (calls === 1) return '<html><body><div class="video-item-container"><div class="video-card-inner"><div class="duration">03:57</div></div></div></body></html>';
    return listing([richCard({})]);
  });
  const items = await source.latest(1, '0');
  assert.equal(items.length, 1);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].options.headers['x-no-cache'], 'true');
  assert.equal(requests[1].options.headers['x-target-selector'], undefined);
});

test('channels build genre and page paths', async () => {
  const source = extension();
  const requests = routes(source, () => listing([richCard({})]));
  const channels = await source.channels();
  assert.equal(channels.length, 5);
  assert.deepEqual(Array.from(channels, (channel) => channel.title), ['首頁', '裏番', '泡麵番', 'Motion Anime', '3DCG']);

  await source.latest(1, '1');
  await source.latest(3, '1');
  await source.latest(1, '0');
  assert.deepEqual(requests.map((entry) => entry.url.replace('https://r.jina.ai/', '')), [
    'https://hanime1.me/search?genre=%E8%A3%8F%E7%95%AA',
    'https://hanime1.me/search?genre=%E8%A3%8F%E7%95%AA&page=3',
    'https://hanime1.me/',
  ]);
  await assert.rejects(source.latest(0, '0'), /頁碼/);
});

test('search encodes the keyword and pages it', async () => {
  const source = extension();
  const requests = routes(source, () => listing([richCard({})]));
  await source.search('鬼', 1);
  await source.search(' 鬼 ', 2);
  assert.deepEqual(Array.from(await source.search('   ', 1)), []);
  assert.deepEqual(requests.map((entry) => entry.url.replace('https://r.jina.ai/', '')), [
    'https://hanime1.me/search?query=%E9%AC%BC',
    'https://hanime1.me/search?query=%E9%AC%BC&page=2',
  ]);
});

test('both card shapes are read', () => {
  const source = extension();
  const rich = source.cards(listing([
    richCard({ id: '408948', title: '第一部作品' }),
    richCard({ id: '408948', title: '重複' }),
    richCard({ id: '408949', title: '第二部作品' }),
  ]));
  assert.equal(rich.length, 2);
  assert.deepEqual(Array.from(rich, (item) => item.url), [
    'https://hanime1.me/watch?v=408948',
    'https://hanime1.me/watch?v=408949',
  ]);
  assert.equal(rich[0].title, '第一部作品');
  assert.equal(rich[0].update, '03:57');

  const grid = source.cards(listing([
    gridCard({ id: '408323', title: '分類作品' }),
    '<a href="https://l.erodalabs.com/s/7duYXu"><div class="home-rows-videos-div"><img src="https://x/ads.jpg"></div></a>',
  ]));
  assert.equal(grid.length, 1);
  assert.equal(grid[0].url, 'https://hanime1.me/watch?v=408323');
  assert.equal(grid[0].title, '分類作品');
  assert.ok(grid[0].cover.startsWith('https://vdownload.hembed.com/image/cover/408323.jpg'));
});

test('detail strips the site name from the title', async () => {
  const source = extension();
  routes(source, () => videoPage({ title: '示例作品' }));
  const detail = await source.detail('https://hanime1.me/watch?v=408948');
  assert.equal(detail.title, '示例作品');
  assert.ok(detail.cover.startsWith('https://vdownload.hembed.com/image/thumbnail/408948h.jpg'));
  assert.equal(detail.desc, '示例簡介');
  assert.equal(detail.episodes[0].urls[0].name, '示例作品');
  assert.equal(detail.episodes[0].urls[0].url, '/watch?v=408948');
});

test('watch picks the highest quality and keeps the media host direct', async () => {
  const source = extension();
  routes(source, () => videoPage({}));
  const stream = await source.watch('/watch?v=408948');
  assert.equal(stream.type, 'mp4');
  assert.equal(stream.url, 'https://vdownload.hembed.com/408948-1080p.mp4?secure=b');
  assert.equal(stream.headers, undefined, 'the media host needs no extra headers');
});

test('watch reports a page without sources', async () => {
  const source = extension();
  routes(source, () => videoPage({ sources: [] }));
  await assert.rejects(source.watch('/watch?v=408948'), /沒有可播放的影片來源/);

  const premium = extension();
  routes(premium, () => '<html><body>登入後即可觀看</body></html>');
  await assert.rejects(premium.watch('/watch?v=408948'), /沒有可播放的影片來源|帳號/);
});

test('video urls are validated before any request', () => {
  const source = extension();
  source.request = async () => { throw new Error('should not be called'); };
  for (const url of ['', '/search?query=x', 'https://other.example/watch?v=1']) {
    assert.throws(() => source.target(url), /無效的影片地址|無法解析影片地址/);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(source.target('https://hanime1.me/watch?v=408948'))), {
    id: '408948',
    path: '/watch?v=408948',
  });
});

test('a non page answer from the reader is reported', async () => {
  const source = extension();
  routes(source, () => '{"error":"rate limited"}');
  await assert.rejects(source.latest(1, '0'), /中轉服務沒有返回頁面|不是網頁/);
});
