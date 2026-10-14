import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// The frames below are original placeholder markup that repeats the class
// names the website ships today; no real page, catalogue or media url is
// stored in this repository.
function extension(clock) {
  const context = vm.createContext({
    sendMessage() {},
    Date: clock ? class extends Date { static now() { return clock.now; } } : Date,
  });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/fourkhd.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'https://usti.uuss.uk';
  source.sleep = async (ms) => { if (clock) clock.now += ms; };
  return source;
}

const ENTRY = 'https://usti.uuss.uk';

function U(path) {
  return ENTRY + path;
}

const card = ({ id, title, slug, folder = '05', date = '2026-10-13T18:59:00+08:00', views = '1561', cover, extraAnchor = '' }) => `
<li class="wp-block-post post-${id} post type-post status-publish format-standard has-post-thumbnail hentry category-photo">
<div class="wp-block-template-part"><div class="is-layout-flow wp-block-group is-style-no-margin">
<figure class="wp-block-post-featured-image"><a href="https://www.4khd.com/content/${folder}/${slug}.html" target="_self"><img decoding="async" loading="lazy" src="${cover || `https://i0.wp.com/pic.4khd.com/example/w850/${id}.webp?resize=850%2C1158`}" width="850" height="1158" class="external-img wp-post-image" /></a></figure>
<style scoped>.is-style-no-margin {margin:0 !important;}</style>
<div class="is-nowrap is-layout-flex wp-container-10 wp-block-group is-style-no-margin has-tiny-font-size" style="padding-left:10px"><div style="font-size:15px;" class="wp-block-post-date"><time datetime="${date}">10/13</time></div>
<div class="is-nowrap is-layout-flex wp-block-group is-style-no-margin has-tiny-font-size" style="padding-left:10px"><div class="eyeicon"></div>${views}</div></div>
${extraAnchor}
<h2 style="font-size:15px;" class="is-style-text-clamp-two wp-block-post-title"><a href="https://www.4khd.com/content/${folder}/${slug}.html" target="_self">${title}</a></h2>
</div></div></li>`;

const listing = (cards) => `<!doctype html><html><head><title>album - 4KHD</title></head><body>
<nav><ul class="menu"><li class="menu-item"><a href="/pages/popular">熱門</a></li></ul></nav>
<div class="wp-block-query"><ul class="is-layout-flow is-flex-container columns-3 site-loop wp-block-post-template">
${cards.join('\n')}
</ul></div></body></html>`;

const post = ({ slug = 'sample-work', folder = '05', title = '示例作品 A[47MB-22photos]', views = 8380,
  date = '2026-10-05T18:19:00', categories = [3, 21], parts = 1, cover = 'https://i0.wp.com/pic.4khd.com/example/cover.webp' } = {}) => {
  const segments = [];
  for (let part = 0; part < parts; part++) {
    const images = [1, 2].map((index) => `<img decoding="async" loading="lazy" src="https://i0.wp.com/pic.4khd.com/example/w1300/part${part + 1}-${index}.webp?w=1300" width="1300" height="1800" />`);
    segments.push(`<figure class="wp-block-gallery">${images.join('')}</figure>`);
  }
  return {
    id: 73400,
    slug,
    link: `https://www.4khd.com/content/${folder}/${slug}.html`,
    date,
    views,
    categories,
    tags: [],
    jetpack_featured_media_url: cover,
    excerpt: { rendered: '<p>Extracting passwords: 4KHD Full HD without watermark download:TeraBox</p>' },
    title: { rendered: title },
    content: { rendered: segments.join('\n<!--nextpage-->\n') },
  };
};

const categoriesPayload = [
  { id: 3, name: 'photo', slug: 'photo', count: 18786 },
  { id: 4, name: 'cosplay', slug: 'cosplay', count: 18857 },
  { id: 26, name: 'bare', slug: 'bare', count: 5754 },
  { id: 21, name: 'popular', slug: 'popular', count: 4905 },
];

function routes(source, map, requests) {
  const seen = requests || [];
  source.request = async (url) => {
    seen.push(url);
    assert.ok(String(url).startsWith(ENTRY + '/'), `not the declared entry point: ${url}`);
    const path = String(url).slice(ENTRY.length);
    const route = map[path];
    assert.ok(route !== undefined, `Unexpected request: ${url}`);
    return typeof route === 'function' ? route() : route;
  };
  return seen;
}

test('channels offer the curated pages first and then the real categories', async () => {
  const source = extension();
  routes(source, { '/wp-json/wp/v2/categories?per_page=100&orderby=count&order=desc': JSON.stringify(categoriesPayload) });
  const channels = await source.channels();
  assert.deepEqual(Array.from(channels, (channel) => [channel.title, channel.key]), [
    ['最新', 'page=/pages/album'],
    ['熱門', 'page=/pages/popular'],
    ['Cosplay 精選', 'page=/pages/cosplay'],
    ['分類：photo（18786）', 'category=3'],
    ['分類：cosplay（18857）', 'category=4'],
    ['分類：bare（5754）', 'category=26'],
    ['分類：popular（4905）', 'category=21'],
  ]);
  // the category list is read once per session
  const again = await source.channels();
  assert.equal(again.length, 7);
});

test('a failing category read falls back to the shipped list without breaking browsing', async () => {
  const source = extension();
  source.request = async () => { throw new Error('offline'); };
  const channels = await source.channels();
  assert.equal(channels.length, 8);
  assert.ok(channels.some((channel) => channel.key === 'category=26' && channel.title === '分類：bare'));
});

test('listing channels page through the site query loop and reject unknown keys', async () => {
  const source = extension();
  const requests = routes(source, {
    '/pages/album?query-3-page=2': listing([card({ id: '73597', slug: 'sample-a', title: '示例作品 A' })]),
  });
  const items = await source.latest(2, 'page=/pages/album');
  assert.equal(items.length, 1);
  assert.equal(items[0].url, '/content/05/sample-a.html');
  assert.deepEqual(requests, [U('/pages/album?query-3-page=2')]);

  await assert.rejects(source.latest(1, 'page=/pages/unknown'), /未知的分類/);
  await assert.rejects(source.latest(1, 'category=../3'), /未知的分類/);
  for (const page of [0, -1, 'x', '']) {
    await assert.rejects(source.latest(page, ''), /頁碼/);
  }
});

test('cards keep entity decoded titles, covers, dates and view counts, and drop decoys', () => {
  const source = extension();
  const html = listing([
    card({ id: '73597', slug: 'sample-a', title: '示例作品 A &amp; B' }),
    card({ id: '73424', slug: '%e6%82%a0%e5%ae%9d', title: '示例作品 C', views: '677190' }),
    card({ id: '73598', slug: 'sample-a', title: '示例作品 A &amp; B' }),
    card({ id: '73599', slug: 'sample-b', title: '' }),
    card({ id: '73600', slug: 'sample-d', title: '示例作品 D', extraAnchor: '<a href="https://l.sponsor.example/promo">廣告</a>' }),
  ]);
  const items = source.cards(html);
  assert.deepEqual(Array.from(items, (item) => item.title), ['示例作品 A & B', '示例作品 C', '示例作品 D']);
  assert.equal(items[0].cover, 'https://i0.wp.com/pic.4khd.com/example/w850/73597.webp?resize=850%2C1158');
  assert.equal(items[0].update, '10/13 · 1561 次');
  assert.equal(items[1].update, '10/13 · 677190 次');
  assert.equal(items[1].url, '/content/05/%e6%82%a0%e5%ae%9d.html');
});

test('category listings read the rest api, map the canonical host back and treat a past-the-end page as empty', async () => {
  const source = extension();
  const requests = routes(source, {
    '/wp-json/wp/v2/posts?per_page=20&page=1&categories=3': JSON.stringify([post({})]),
    '/wp-json/wp/v2/posts?per_page=20&page=9&categories=3': () => {
      throw new Error('HTTP 400: {"code":"rest_post_invalid_page_number","message":"The page number requested is larger than the number of pages available."}');
    },
  });
  const items = await source.latest(1, 'category=3');
  assert.equal(items.length, 1);
  assert.equal(items[0].url, '/content/05/sample-work.html');
  assert.equal(items[0].title, '示例作品 A[47MB-22photos]');
  assert.equal(items[0].update, '10/05 · 8380 次');
  assert.deepEqual(Array.from(await source.latest(9, 'category=3')), []);
  assert.deepEqual(requests, [
    U('/wp-json/wp/v2/posts?per_page=20&page=1&categories=3'),
    U('/wp-json/wp/v2/posts?per_page=20&page=9&categories=3'),
  ]);
});

test('search asks the site search pages and encodes the keyword', async () => {
  const source = extension();
  const requests = routes(source, {
    '/search/%E7%A4%BA%E4%BE%8B%20A%26B': listing([card({ id: '73597', slug: 'sample-a', title: '示例作品 A' })]),
    '/search/%E7%A4%BA%E4%BE%8B/page/3': listing([]),
  });
  const found = await source.search('  示例 A&B  ', 1);
  assert.equal(found.length, 1);
  assert.deepEqual(Array.from(await source.search('示例', 3)), []);
  assert.deepEqual(Array.from(await source.search('   ', 1)), []);
  assert.deepEqual(requests, [U('/search/%E7%A4%BA%E4%BE%8B%20A%26B'), U('/search/%E7%A4%BA%E4%BE%8B/page/3')]);
  await assert.rejects(source.search('示例', 0), /頁碼/);
});

test('work urls are parsed with their folder, slug and part, and foreign hosts are refused', () => {
  const source = extension();
  assert.deepEqual(JSON.parse(JSON.stringify(source.postTarget('/content/05/sample-work.html'))),
    { slug: 'sample-work', path: '/content/05/sample-work.html', part: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(source.postTarget('https://www.4khd.com/content/13/sample-work.html/2'))),
    { slug: 'sample-work', path: '/content/13/sample-work.html', part: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(source.postTarget(ENTRY + '/content/07/%e6%82%a0%e5%ae%9d.html'))),
    { slug: '%e6%82%a0%e5%ae%9d', path: '/content/07/%e6%82%a0%e5%ae%9d.html', part: 1 });
  assert.throws(() => source.postTarget('https://example.com/content/05/sample-work.html'), /無效的作品地址/);
  assert.throws(() => source.postTarget('/pages/album'), /無法解析作品地址/);
  assert.throws(() => source.postTarget(''), /無效的作品地址/);
});

test('detail splits a multi part work into an episode per part with its photo counts', async () => {
  const source = extension();
  routes(source, {
    '/wp-json/wp/v2/posts?slug=sample-work': JSON.stringify([post({ parts: 3 })]),
    '/wp-json/wp/v2/categories?per_page=100&orderby=count&order=desc': JSON.stringify(categoriesPayload),
  });
  const detail = await source.detail('/content/05/sample-work.html');
  assert.equal(detail.title, '示例作品 A[47MB-22photos]');
  assert.equal(detail.cover, 'https://i0.wp.com/pic.4khd.com/example/cover.webp');
  const lines = detail.desc.split('\n');
  assert.match(lines[0], /^發佈：10\/05 · 8380 次$/);
  assert.match(lines[1], /^圖片：共 6 張，分 3 部$/);
  assert.match(lines[2], /^分類：photo \/ popular$/);
  assert.match(lines[3], /Extracting passwords/);
  assert.equal(detail.episodes.length, 1);
  assert.deepEqual(Array.from(detail.episodes[0].urls, (entry) => [entry.name, entry.url]), [
    ['第 1 部（2 張）', '/content/05/sample-work.html'],
    ['第 2 部（2 張）', '/content/05/sample-work.html/2'],
    ['第 3 部（2 張）', '/content/05/sample-work.html/3'],
  ]);
});

test('a single part work becomes one episode and a missing work reports clearly', async () => {
  const source = extension();
  const single = extension();
  routes(single, {
    '/wp-json/wp/v2/posts?slug=sample-work': JSON.stringify([post({ parts: 1 })]),
    '/wp-json/wp/v2/categories?per_page=100&orderby=count&order=desc': JSON.stringify(categoriesPayload),
  });
  const detail = await single.detail('/content/05/sample-work.html');
  assert.deepEqual(Array.from(detail.episodes[0].urls, (entry) => [entry.name, entry.url]), [['全 2 張', '/content/05/sample-work.html']]);

  routes(source, { '/wp-json/wp/v2/posts?slug=gone': JSON.stringify([]) });
  await assert.rejects(source.detail('/content/05/gone.html'), /找不到這部作品/);

  const empty = extension();
  routes(empty, { '/wp-json/wp/v2/posts?slug=empty': JSON.stringify([post({ parts: 0 })]) });
  await assert.rejects(empty.detail('/content/05/empty.html'), /沒有可讀取的圖片/);
});

test('reading returns the images of the requested part, clamped to the last one', async () => {
  const source = extension();
  routes(source, { '/wp-json/wp/v2/posts?slug=sample-work': JSON.stringify([post({ parts: 2 })]) });
  const first = await source.watch('/content/05/sample-work.html');
  assert.deepEqual(Array.from(first.urls), [
    'https://i0.wp.com/pic.4khd.com/example/w1300/part1-1.webp?w=1300',
    'https://i0.wp.com/pic.4khd.com/example/w1300/part1-2.webp?w=1300',
  ]);
  const second = await source.watch('/content/05/sample-work.html/2');
  assert.deepEqual(Array.from(second.urls, (url) => url.split('/').pop()), ['part2-1.webp?w=1300', 'part2-2.webp?w=1300']);
  const beyond = await source.watch('/content/05/sample-work.html/9');
  assert.deepEqual(Array.from(beyond.urls, (url) => url.split('/').pop()), ['part2-1.webp?w=1300', 'part2-2.webp?w=1300']);

  const empty = extension();
  routes(empty, { '/wp-json/wp/v2/posts?slug=empty': JSON.stringify([post({ parts: 0 })]) });
  await assert.rejects(empty.watch('/content/05/empty.html'), /沒有可讀取的圖片/);
});

test('reads are merged and cached briefly, and a rate limited read retries once with a hint', async () => {
  const clock = { now: 900000 };
  const source = extension(clock);
  let calls = 0;
  source.request = async () => { calls++; return listing([card({ id: '73597', slug: 'sample-a', title: '示例作品 A' })]); };
  await Promise.all([source.latest(1, ''), source.latest(1, '')]);
  assert.equal(calls, 1);
  await source.latest(1, '');
  assert.equal(calls, 1);
  clock.now += 30001;
  await source.latest(1, '');
  assert.equal(calls, 2);

  const limited = extension({ now: 1000 });
  let attempts = 0;
  limited.request = async () => {
    attempts++;
    if (attempts <= 2) throw new Error('HTTP 403: <html><title>403 Forbidden</title></html>');
    return listing([]);
  };
  await assert.rejects(limited.latest(1, ''), /頻率限制|HTTP 403/);
  assert.equal(attempts, 2);
  assert.ok(limited._cooldownUntil > 1000, 'the cooldown is armed after a blocked retry');
  await limited.latest(2, '');
  assert.equal(attempts, 3);
  assert.ok(limited._lastRequest >= limited._cooldownUntil, 'the next read waited out the cooldown');
});

test('a changed listing page is reported instead of being read as an empty catalogue', async () => {
  const source = extension();
  routes(source, { '/pages/album': '<html><body>maintenance</body></html>' });
  await assert.rejects(source.latest(1, ''), /無法解析/);
  const brokenJson = extension();
  routes(brokenJson, { '/wp-json/wp/v2/posts?slug=sample-work': '<html>gateway</html>' });
  await assert.rejects(brokenJson.detail('/content/05/sample-work.html'), /不是有效的 JSON|找不到這部作品|無法解析/);
});
