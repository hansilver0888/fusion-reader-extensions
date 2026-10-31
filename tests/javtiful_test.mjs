import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// Frames repeat the shape the site ships (checked 2026-10-31): work urls
// /ja/video/<id>/<slug>, a page config carrying videoTitle/videoPoster and a
// playback endpoint with a one-time ticket, and a POST that answers with signed
// mp4 sources. The code SNOS-378 is the benchmark this source is verified on.
function extension() {
  const context = vm.createContext({ sendMessage() {}, Date });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/javtiful.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'https://javtiful.com';
  source.sleep = async () => {};
  source.getSetting = async () => '';
  source.setSetting = async () => {};
  return source;
}

const card = ({ id = '114372', slug = 'snos-378', title = 'SNOS-378 sample title', thumb = '/uploads/uploads/videos/thumbs/2026/10/09/233d4c671d0cc2d93b40644e3dfc4439.jpg' }) => `
<article class="video-card">
  <a class="video-card__link" href="/ja/video/${id}/${slug}">
    <img class="video-card__img" src="/assets/front/media/video-thumb-placeholder.svg" data-front-lazy-src="${thumb}" alt="Thumbnail for ${title}" loading="lazy">
    <span class="video-card__duration">2:31:19</span>
  </a>
  <h3 class="video-card__title"><a href="/ja/video/${id}/${slug}">${title}</a></h3>
</article>`;

const listing = (cards) => `<!doctype html><html><body><div class="video-grid">${cards.join('\n')}</div></body></html>`;

const workPage = ({ title = 'SNOS-378 中年男性が純白のIカップの胸に興奮し', poster = '/uploads/uploads/videos/thumbs/2026/10/09/233d4c671d0cc2d93b40644e3dfc4439.jpg', actress = '/uploads/uploads/collections/actresses/2026/04/27/5544e2b6b4adee534a771fd4fb845542.jpg', ticket = 'p1.114372.0.1793448576.abc.def', endpoint = '/ja/video/114372/playback' } = {}) => `<!doctype html><html><head>
<title>${title} | Javtiful</title>
<meta name="description" content="Javtiful で 紫堂るい 出演の SNOS-378 を無料で視聴">
</head><body>
<video id="front-player" preload="none" poster="${poster}"></video>
${actress ? `<a class="actress" href="/ja/actress/1"><img src="${actress}" alt="紫堂るい" width="280" height="280"></a>` : ''}
<script>window.initFrontPlayback = function (config) {}</script>
<script>{"csrfFieldHtml":"","commentsEndpoint":"/ja/video/114372/comments","playback":{"endpoint":"${endpoint}","ticket":"${ticket}"},"videoTitle":"${title}","videoPoster":"${poster}"}</script>
</body></html>`;

const playbackJson = (sources) => JSON.stringify({ success: true, sources, defaultQuality: 720 });

function routes(source, map, seen) {
  const requests = seen || [];
  source.request = async (url, options) => {
    requests.push({ url, options: options || {} });
    const key = String(url).replace(/^https:\/\/javtiful\.com/, '');
    const route = map[key];
    assert.ok(route !== undefined, `Unexpected request: ${url}`);
    return typeof route === 'function' ? route() : route;
  };
  return requests;
}

test('channels are the five catalogue feeds', async () => {
  const source = extension();
  const channels = await source.channels();
  assert.deepEqual(Array.from(channels, (channel) => channel.key), ['0', '1', '2', '3', '4']);
  assert.deepEqual(Array.from(channels, (channel) => channel.title), ['最新', '本週熱門', '最多觀看', '無碼', '減少馬賽克']);
});

test('listings and search build the site paths and page them', async () => {
  const source = extension();
  const requests = routes(source, {
    '/ja/videos': listing([card({ id: '1', slug: 'first-001', title: 'First' })]),
    '/ja/videos?page=2': listing([card({ id: '2', slug: 'second-002', title: 'Second' })]),
    '/ja/videos?sort=popular_week': listing([card({ id: '3', slug: 'third-003', title: 'Third' })]),
    '/ja/uncensored': listing([card({ id: '4', slug: 'uncensored-004', title: 'Uncensored' })]),
    '/ja/reducing-mosaic': listing([card({ id: '5', slug: 'mosaic-005', title: 'Mosaic' })]),
    '/search?q=SNOS-378': listing([card({ id: '114372', slug: 'snos-378', title: 'SNOS-378 title' })]),
    '/search?q=SNOS-378&page=2': listing([card({ id: '114472', slug: 'snos-378-reducing-mosaic', title: 'Mosaic variant' })]),
  });
  assert.equal((await source.latest(1, '0'))[0].title, 'First');
  assert.equal((await source.latest(2, ''))[0].title, 'Second');
  assert.equal((await source.latest(1, '1'))[0].title, 'Third');
  assert.equal((await source.latest(1, '3'))[0].title, 'Uncensored');
  assert.equal((await source.latest(1, '4'))[0].title, 'Mosaic');
  assert.equal((await source.search('SNOS-378', 1))[0].url, '/ja/video/114372/snos-378');
  assert.equal((await source.search(' SNOS-378 ', 2))[0].title, 'Mosaic variant');
  assert.deepEqual(Array.from(await source.search('   ', 1)), []);
  await assert.rejects(source.latest(0, '0'), /頁碼/);
  assert.deepEqual(requests.map((entry) => entry.url.replace('https://javtiful.com', '')), [
    '/ja/videos',
    '/ja/videos?page=2',
    '/ja/videos?sort=popular_week',
    '/ja/uncensored',
    '/ja/reducing-mosaic',
    '/search?q=SNOS-378',
    '/search?q=SNOS-378&page=2',
  ]);
});

test('cards keep one entry per work and drop the thumbnail prefix', () => {
  const source = extension();
  const items = source.cards(listing([
    card({ id: '114372', slug: 'snos-378', title: 'SNOS-378 &amp; sample' }),
    card({ id: '114372', slug: 'snos-378', title: 'duplicate' }),
    card({ id: '9', slug: 'other-009', title: 'Other' }),
  ]));
  assert.equal(items.length, 2);
  assert.deepEqual(Array.from(items, (item) => item.url), ['/ja/video/114372/snos-378', '/ja/video/9/other-009']);
  assert.equal(items[0].title, 'SNOS-378 & sample');
  assert.equal(items[0].cover, 'https://javtiful.com/uploads/uploads/videos/thumbs/2026/10/09/233d4c671d0cc2d93b40644e3dfc4439.jpg');
});

test('covers skip the lazy placeholder and use the real image', () => {
  const source = extension();
  assert.equal(
    source.imageUrl('<img src="/assets/front/media/video-thumb-placeholder.svg" data-front-lazy-src="/uploads/a/b.jpg">'),
    'https://javtiful.com/uploads/a/b.jpg',
  );
  assert.equal(
    source.imageUrl('<img src="/assets/front/media/video-thumb-placeholder.svg" data-src="/uploads/c/d.jpg">'),
    'https://javtiful.com/uploads/c/d.jpg',
  );
  assert.equal(
    source.imageUrl('<img srcset="/uploads/e/f.jpg 1x, /uploads/e/f2.jpg 2x">'),
    'https://javtiful.com/uploads/e/f.jpg',
  );
  // a placeholder on its own must not become a cover
  assert.equal(source.imageUrl('<img src="/assets/front/media/video-thumb-placeholder.svg">'), '');
});

test('detail uses the real still, never the generic avatar', async () => {
  const source = extension();
  routes(source, { '/ja/video/114372/snos-378': workPage({}) });
  const detail = await source.detail('/ja/video/114372/snos-378');
  assert.equal(detail.title, 'SNOS-378 中年男性が純白のIカップの胸に興奮し');
  // the page's "actress" picture is a generic avatar, so it must not be used
  assert.ok(detail.cover.endsWith('233d4c671d0cc2d93b40644e3dfc4439.jpg'), detail.cover);
  assert.ok(!detail.cover.includes('/collections/actresses/'), detail.cover);
  assert.ok(detail.desc.includes('SNOS-378'));
  assert.equal(detail.episodes[0].urls[0].url, '/ja/video/114372/snos-378');
});

test('watch trades the ticket for the largest signed mp4', async () => {
  const source = extension();
  const requests = routes(source, {
    '/ja/video/114372/snos-378': workPage({}),
    '/ja/video/114372/playback': playbackJson([
      { src: '/media/video/114372/1080p?expires=1&signature=a', type: 'video/mp4', size: 1080 },
      { src: '/media/video/114372/720p?expires=1&signature=b', type: 'video/mp4', size: 720 },
    ]),
  });
  const stream = await source.watch('/ja/video/114372/snos-378');
  assert.equal(stream.type, 'mp4');
  assert.equal(stream.url, 'https://javtiful.com/media/video/114372/1080p?expires=1&signature=a');
  assert.equal(stream.headers.Referer, 'https://javtiful.com/');
  const post = requests.find((entry) => entry.options.method === 'POST');
  assert.ok(post, 'watch must POST the ticket');
  assert.equal(post.url, 'https://javtiful.com/ja/video/114372/playback');
  assert.match(post.options.data, /^ticket=/);
  assert.match(String(post.options.headers['Content-Type']), /x-www-form-urlencoded/);

  const single = extension();
  routes(single, {
    '/ja/video/9/other-009': workPage({ endpoint: '/ja/video/9/playback', ticket: 'p1.9.0.1.x.y' }),
    '/ja/video/9/playback': playbackJson([{ src: '/media/video/9/720p?signature=c', type: 'video/mp4' }]),
  });
  assert.equal((await single.watch('/ja/video/9/other-009')).url, 'https://javtiful.com/media/video/9/720p?signature=c');
});

test('watch reports missing authorisation and broken payloads', async () => {
  const unauthorised = extension();
  routes(unauthorised, { '/ja/video/114372/snos-378': '<html><body><h1>No playback</h1></body></html>' });
  await assert.rejects(unauthorised.watch('/ja/video/114372/snos-378'), /沒有播放授權/);

  const broken = extension();
  routes(broken, {
    '/ja/video/114372/snos-378': workPage({}),
    '/ja/video/114372/playback': '<html>maintenance</html>',
  });
  await assert.rejects(broken.watch('/ja/video/114372/snos-378'), /不是 JSON/);

  const empty = extension();
  routes(empty, {
    '/ja/video/114372/snos-378': workPage({}),
    '/ja/video/114372/playback': JSON.stringify({ success: true, sources: [] }),
  });
  await assert.rejects(empty.watch('/ja/video/114372/snos-378'), /沒有給出可用的地址/);
});

test('work urls are validated before any request', () => {
  const source = extension();
  source.request = async () => { throw new Error('should not be called'); };
  for (const url of ['', '/ja/videos', 'https://other.example/ja/video/1/x', '/ja/video/1', '/ja/video/1/']) {
    assert.throws(() => source.target(url), /無效的影片地址|無法解析影片地址/);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(source.target('https://javtiful.com/en/video/114372/snos-378#comments'))), {
    path: '/ja/video/114372/snos-378',
    id: '114372',
    slug: 'snos-378',
  });
});
