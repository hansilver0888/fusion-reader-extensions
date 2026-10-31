import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// Frames repeat the shape the site ships (checked 2026-10-31): `div.card` cards,
// work urls `/en/v/<slug>`, an episode list packed into JSON.parse('…') and an
// embed that answers /stream?id=<hash> with the playlist. No real page or media
// url is stored here; the code SNOS-378 is the title code this source is
// verified against.
function extension() {
  const context = vm.createContext({ sendMessage() {}, Date });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/av123.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'https://123av.com';
  source.sleep = async () => {};
  source.getSetting = async () => '';
  source.setSetting = async () => {};
  return source;
}

const card = ({ slug = 'snos-378', title = 'SNOS-378 — Sample title', duration = '1:35:14', cover = `https://icdn.123av.me/img2/s360/b9/${slug}/cover.jpg?6ae578e6` }) => `
<div class="card" x-data="save({ type: 'title', id: 1167214, saved: false })">
  <div class="card__poster" x-data="preview" data-preview="https://icdn.123av.me/preview/b9/${slug}/preview.png">
    <a class="card__cover" href="/en/v/${slug}">
      <img class="card__img" src="${cover}" alt="" loading="lazy">
      <div class="card__shade"></div>
      <span class="card__dur">${duration}</span>
    </a>
  </div>
  <h3><a href="/en/v/${slug}">${title}</a></h3>
  <div class="card__meta"><span>4h 46m ago</span></div>
</div>`;

const listing = (cards) => `<!doctype html><html><body><div class="grid">${cards.join('\n')}</div></body></html>`;

// the page packs the episode list this way: quotes become \u0022 and slashes \/
const episodeList = [{
  number: 1,
  name: '1',
  url: 'https://sadie-shop.site/e/8W2Y80?poster=https%3A%2F%2Ficdn.123av.me%2Fimg2%2Fs500%2Fb9%2Fsnos-378%2Fcover.jpg',
}];
const packEpisodes = (list) => JSON.stringify(list).replace(/"/g, '\\u0022').replace(/\//g, '\\/');
const episodeJson = packEpisodes(episodeList);

const workPage = ({ title = 'SNOS-378', cover = 'https://icdn.123av.me/img2/s500/b9/snos-378/cover.jpg?6ae578e6', episodes = episodeJson, desc = '' } = {}) => `<!doctype html><html><head>
<title>${title}</title>
<meta name="description" content="Stream JAV and Japanese AV online in HD on 123AV. Thousands of titles updated daily.">
</head><body>
<h1 class="watch__title">${title}</h1>
<img src="${cover}">
${desc ? `<div class="watch__desc">${desc}</div>` : ''}
<div class="watch__main" x-data="player(JSON.parse('${episodes}'), 1167214, 'snos-378', 'https:\/\/rec2.123av.com', 'e8bcc533-bc38-4a33-af0e-678d38237754')"></div>
</body></html>`;

const streamJson = JSON.stringify({
  status: 'ok',
  media: {
    stream: 'https://jzxz.deepfreespace.site/oo5/TOKEN/video.m3u8',
    vtt: 'https://jzxz.deepfreespace.site/oo5/TOKEN/preview.vtt',
  },
});

function routes(source, map, seen) {
  const requests = seen || [];
  source.request = async (url, options) => {
    requests.push({ url, options: options || {} });
    const key = String(url).replace(/^https:\/\/123av\.com/, '');
    const route = map[key];
    assert.ok(route !== undefined, `Unexpected request: ${url}`);
    return typeof route === 'function' ? route() : route;
  };
  return requests;
}

test('channels are the four catalogue feeds', async () => {
  const source = extension();
  const channels = await source.channels();
  assert.deepEqual(Array.from(channels, (channel) => channel.key), ['new', 'hot', 'uncensored', 'uncensored-leaked']);
});

test('listings and search build the site paths and page them', async () => {
  const source = extension();
  const requests = routes(source, {
    '/en/new': listing([card({ slug: 'fc2-ppv-5000463', title: 'FC2 first' })]),
    '/en/new?page=2': listing([card({ slug: 'second-001', title: 'Second page' })]),
    '/en/uncensored': listing([card({ slug: 'uncensored-001', title: 'Uncensored' })]),
    '/en/search?keyword=SNOS-378': listing([card({ slug: 'snos-378', title: 'SNOS-378 — On New Year' })]),
    '/en/search?keyword=SNOS-378&page=2': listing([card({ slug: 'snos-379', title: 'SNOS-379' })]),
  });
  assert.equal((await source.latest(1, 'new'))[0].title, 'FC2 first');
  assert.equal((await source.latest(2, ''))[0].title, 'Second page');
  assert.equal((await source.latest(1, 'uncensored'))[0].title, 'Uncensored');
  assert.equal((await source.search('SNOS-378', 1))[0].url, '/en/v/snos-378');
  assert.equal((await source.search('  SNOS-378 ', 2))[0].title, 'SNOS-379');
  assert.deepEqual(Array.from(await source.search('   ', 1)), []);
  await assert.rejects(source.latest(0, 'new'), /頁碼/);
  assert.deepEqual(requests.map((entry) => entry.url.replace('https://123av.com', '')), [
    '/en/new',
    '/en/new?page=2',
    '/en/uncensored',
    '/en/search?keyword=SNOS-378',
    '/en/search?keyword=SNOS-378&page=2',
  ]);
});

test('cards keep one entry per work with the heading as title', () => {
  const source = extension();
  const items = source.cards(listing([
    card({ slug: 'snos-378', title: 'SNOS-378 &amp; sample' }),
    card({ slug: 'snos-378', title: 'duplicate' }),
    card({ slug: 'fc2-ppv-5000463', title: 'FC2 second', duration: '2:00:00' }),
  ]));
  assert.equal(items.length, 2);
  assert.deepEqual(Array.from(items, (item) => item.url), ['/en/v/snos-378', '/en/v/fc2-ppv-5000463']);
  assert.equal(items[0].title, 'SNOS-378 & sample');
  assert.equal(items[0].cover, 'https://icdn.123av.me/img2/s360/b9/snos-378/cover.jpg?6ae578e6');
  assert.equal(items[0].update, '1:35:14');
  assert.equal(items[1].update, '2:00:00');
});

test('detail reads the title, the large cover and the episode list', async () => {
  const source = extension();
  routes(source, { '/en/v/snos-378': workPage({}) });
  const detail = await source.detail('/en/v/snos-378');
  assert.equal(detail.title, 'SNOS-378');
  assert.equal(detail.cover, 'https://icdn.123av.me/img2/s500/b9/snos-378/cover.jpg?6ae578e6');
  assert.equal(detail.episodes[0].urls.length, 1);
  assert.equal(detail.episodes[0].urls[0].url, '/en/v/snos-378#ep0');

  const withDesc = extension();
  routes(withDesc, { '/en/v/snos-378': workPage({ desc: 'A synopsis paragraph.' }) });
  assert.equal((await withDesc.detail('/en/v/snos-378')).desc, 'A synopsis paragraph.');

  const empty = extension();
  routes(empty, { '/en/v/snos-378': workPage({ episodes: '[]' }) });
  assert.equal((await empty.detail('/en/v/snos-378')).episodes[0].urls.length, 0);
});

test('watch turns the packed episode into an embed stream', async () => {
  const source = extension();
  const requests = routes(source, {
    '/en/v/snos-378': workPage({}),
    'https://sadie-shop.site/stream?id=8W2Y80': streamJson,
  });
  const stream = await source.watch('/en/v/snos-378');
  assert.equal(stream.type, 'hls');
  assert.equal(stream.url, 'https://jzxz.deepfreespace.site/oo5/TOKEN/video.m3u8');
  assert.equal(stream.headers.Referer, 'https://sadie-shop.site/');
  assert.deepEqual(requests.map((entry) => entry.url), [
    'https://123av.com/en/v/snos-378',
    'https://sadie-shop.site/stream?id=8W2Y80',
  ]);

  // the directory can also hand the episode url over directly
  const direct = extension();
  routes(direct, { 'https://sadie-shop.site/stream?id=8W2Y80': streamJson });
  const fromEpisode = await direct.watch('https://sadie-shop.site/e/8W2Y80?poster=x');
  assert.equal(fromEpisode.url, 'https://jzxz.deepfreespace.site/oo5/TOKEN/video.m3u8');
});

test('watch reports a page without lines and a broken stream api', async () => {
  const none = extension();
  routes(none, { '/en/v/snos-378': workPage({ episodes: '[]' }) });
  await assert.rejects(none.watch('/en/v/snos-378'), /沒有可用的線路/);

  const broken = extension();
  routes(broken, {
    '/en/v/snos-378': workPage({}),
    'https://sadie-shop.site/stream?id=8W2Y80': '<html>maintenance</html>',
  });
  await assert.rejects(broken.watch('/en/v/snos-378'), /不是 JSON/);

  const empty = extension();
  routes(empty, {
    '/en/v/snos-378': workPage({}),
    'https://sadie-shop.site/stream?id=8W2Y80': JSON.stringify({ status: 'ok', media: {} }),
  });
  await assert.rejects(empty.watch('/en/v/snos-378'), /沒有給出播放地址/);
});

test('work urls are validated before any request', () => {
  const source = extension();
  source.request = async () => { throw new Error('should not be called'); };
  for (const url of ['', '/en/new', 'https://other.example/en/v/snos-378', '/en/v/', '/en/v']) {
    assert.throws(() => source.target(url), /無效的影片地址|無法解析影片地址/);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(source.target('https://123av.com/en/v/snos-378#ep0'))), {
    path: '/en/v/snos-378',
    slug: 'snos-378',
  });
  assert.equal(source.slugTitle('/en/v/snos-378'), 'SNOS 378');
});
