import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// The source runs on the operator's mirror domains (twmanga.com, webmota.com …),
// which serve the same catalogue as baozimh.com without its proof of work gate.
// Frames below repeat the markup the mirrors ship (checked 2026-11-01).
function extension(clock) {
  const context = vm.createContext({
    sendMessage() {},
    Date: clock ? class extends Date { static now() { return clock.now; } } : Date,
  });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/baozimh.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'https://www.twmanga.com';
  source.sleep = async () => {};
  source.getSetting = async () => '';
  source.setSetting = async () => {};
  return source;
}

const card = ({ slug = 'silingfashiwojishitianzai', title = '死靈法師！我即是天災', cover }) => `
<div class="comics-card pure-u-1-3">
  <a href="/comic/${slug}" title="${title}" aria-label="${title}" class="comics-card__poster text-decoration-none">
    <amp-img alt="${title}" noloading layout="responsive" width="150" height="200" src="${cover || `https://static-tw.baozimh.com/cover/${slug}.jpg?w=285&amp;h=375&amp;q=100`}"></amp-img>
    <div class="tabs cls"></div>
  </a>
  <div class="comics-card__info"><a class="comics-card__title text-truncate" href="/comic/${slug}">${title}</a></div>
</div>`;

const listing = (cards) => `<!doctype html><html><body><div class="index-recommend-items"><div class="pure-g">${cards.join('\n')}</div></div></body></html>`;

const detailPage = ({ title = '死靈法師！我即是天災', chapters = [
  { slot: 0, name: '001話：開端' },
  { slot: 1, name: '002話：大考開始！！' },
] } = {}) => `<!doctype html><html><head>
<meta property="og:title" content="${title}漫畫 - 包子漫畫">
<meta property="og:image" content="https://static-tw.baozimh.com/cover/silingfashiwojishitianzai.jpg?w=285&amp;h=375&amp;q=100">
<meta name="description" content="死靈法師！我即是天災漫畫簡介">
</head><body><h1>${title}</h1>
<div class="comics-chapters">
${chapters.map((chapter) => `<div class="pure-u-1-1 comics-chapters"><a href="/user/page_direct?comic_id=silingfashiwojishitianzai&amp;section_slot=0&amp;chapter_slot=${chapter.slot}" rel="noopener" class="comics-chapters__item"><div style="flex: 1;"><span>${chapter.name}</span></div></a></div>`).join('\n')}
</div></body></html>`;

const readerPage = ({ title = '001話：開端 - 死靈法師！我即是天災 - 包子漫畫', pages = 3 } = {}) => `<!doctype html><html><head><title>${title}</title></head><body>
<div class="comic-contain">
${Array.from({ length: pages }, (_, index) => `<amp-img src="https://s1.bzcdn.net/scomic/silingfashiwojishitianzai/0/286-4qdm/${index + 1}.jpg" width="800" height="1200"></amp-img>`).join('\n')}
</div></body></html>`;

const challengeJson = '{"challenge_url":"/__gatekeeper_challenge/start?return=%2F","error":"challenge_required"}';

// The entry probe reads /list/new on every mirror until one answers, so a stub
// has to serve that url; everything else is up to the case.
function routes(source, handler) {
  const log = [];
  source.request = async (url, options) => {
    log.push({ url, options: options || {} });
    const answer = handler(url, options || {});
    return answer === undefined ? listing([card({})]) : answer;
  };
  log.challenges = () => log.filter((entry) => entry.url.includes('__gatekeeper_challenge'));
  log.hosts = () => log.map((entry) => entry.url.split('/')[2]);
  return log;
}

test('the first mirror that answers becomes the entry, with no challenge', async () => {
  const source = extension();
  const log = routes(source, () => undefined);
  const items = await source.latest(1, '0');
  assert.ok(items.length >= 1);
  assert.equal(source.currentSite(), 'https://www.twmanga.com');
  // nothing ever touches the gatekeeper endpoints
  assert.equal(log.challenges().length, 0);
  assert.match(log[0].url, /^https:\/\/www\.twmanga\.com\/list\/new$/);
});

test('a challenged or broken mirror is skipped', async () => {
  const source = extension();
  source.request = async (url) => {
    if (url.startsWith('https://www.twmanga.com')) return challengeJson;
    if (url.startsWith('https://cn.twmanga.com')) throw new Error('connect timeout');
    if (url.startsWith('https://www.webmota.com')) return '<html><body>maintenance</body></html>';
    return listing([card({})]);
  };
  const items = await source.latest(1, '0');
  assert.ok(items.length >= 1);
  assert.equal(source.currentSite(), 'https://cn.webmota.com');
});

test('when every mirror fails the error lists them', async () => {
  const source = extension();
  source.request = async () => challengeJson;
  await assert.rejects(source.latest(1, '0'), /沒有可用的鏡像站點/);
});

test('listings and search build the site paths and page them', async () => {
  const source = extension();
  const log = routes(source, (url) => {
    if (url.includes('/classify')) return listing([card({ slug: 'abc-001', title: '分類結果' })]);
    if (url.includes('/search?')) return listing([card({ slug: 'abc-002', title: '搜索命中' })]);
    return undefined;
  });
  const catalogue = await source.latest(1, '1');
  assert.equal(catalogue[0].title, '分類結果');
  const second = await source.latest(3, '1');
  assert.equal(second[0].title, '分類結果');
  const found = await source.search('死靈法師', 1);
  assert.equal(found[0].title, '搜索命中');
  assert.deepEqual(Array.from(await source.search('   ', 1)), []);
  await assert.rejects(source.latest(0, '0'), /頁碼/);

  const catalogueUrls = log.filter((entry) => entry.url.includes('/classify')).map((entry) => entry.url.replace('https://www.twmanga.com', ''));
  assert.deepEqual(catalogueUrls, [
    '/classify?type=all&region=all&state=all&filter=%2a',
    '/classify?type=all&region=all&state=all&filter=%2a&page=3',
  ]);
  const searchUrls = log.filter((entry) => entry.url.includes('/search?')).map((entry) => entry.url.replace('https://www.twmanga.com', ''));
  assert.deepEqual(searchUrls, ['/search?q=%E6%AD%BB%E9%9D%88%E6%B3%95%E5%B8%AB']);
});

test('the update feed ignores the page number', async () => {
  const source = extension();
  const log = routes(source, () => undefined);
  await source.latest(1, '0');
  await source.latest(2, '0');
  const listUrls = log.filter((entry) => entry.url.includes('/list/new'));
  assert.deepEqual(Array.from(new Set(listUrls.map((entry) => entry.url.replace('https://www.twmanga.com', '')))), ['/list/new']);
});

test('channels are keyed so the app selects one chip at a time', async () => {
  const source = extension();
  const channels = await source.channels();
  assert.equal(channels.length, 6);
  assert.equal(channels[0].title, '最近更新');
  const keys = Array.from(channels, (channel) => channel.key);
  assert.equal(new Set(keys).size, keys.length, 'channel keys must be unique');
  assert.ok(keys.every((key) => typeof key === 'string' && key.length > 0), 'channel keys must not be empty');
});

test('cards read the anchor title and the cover image', () => {
  const source = extension();
  const items = source.cards(listing([
    card({ slug: 'abc-001', title: '第一部作品' }),
    card({ slug: 'abc-002', title: '第二部作品', cover: 'https://static-tw.baozimh.com/cover/abc-002.jpg?w=285&amp;h=375&amp;q=100' }),
    card({ slug: 'abc-001', title: '重複' }),
  ]));
  assert.equal(items.length, 2);
  assert.deepEqual(Array.from(items, (item) => item.url), ['/comic/abc-001', '/comic/abc-002']);
  assert.equal(items[0].title, '第一部作品');
  assert.equal(items[0].cover, 'https://static-tw.baozimh.com/cover/abc-001.jpg?w=285&h=375&q=100');
});

test('detail reads the metadata and every chapter as {name, url}', async () => {
  const source = extension();
  routes(source, (url) => (url.includes('/comic/') ? detailPage({}) : undefined));
  const detail = await source.detail('/comic/silingfashiwojishitianzai');
  assert.equal(detail.title, '死靈法師！我即是天災');
  assert.ok(detail.cover.startsWith('https://static-tw.baozimh.com/cover/silingfashiwojishitianzai.jpg'));
  assert.equal(detail.desc, '死靈法師！我即是天災漫畫簡介');
  assert.equal(detail.episodes[0].urls.length, 2);
  // the app renders ep.name; a title key would show a blank row
  assert.equal(detail.episodes[0].urls[0].name, '001話：開端');
  assert.equal(detail.episodes[0].urls[0].title, undefined);
  assert.match(detail.episodes[0].urls[0].url, /chapter_slot=0/);
});

test('chapters are de-duplicated and ordered by slot', async () => {
  const source = extension();
  const rows = [
    { slot: 2, name: '003話：第三' },
    { slot: 2, name: '003話：第三' },
    { slot: 1, name: '002話：第二' },
    { slot: 0, name: '001話：第一' },
  ].map((chapter) => `<a href="/user/page_direct?comic_id=slug_a&amp;section_slot=0&amp;chapter_slot=${chapter.slot}" class="comics-chapters__item"><div><span>${chapter.name}</span></div></a>`);
  const latest = [
    { slot: 0, name: '001話：第一' },
    { slot: 1, name: '002話：第二' },
  ].map((chapter) => `<a href="/user/page_direct?comic_id=slug_a_xxxxxx&amp;section_slot=0&amp;chapter_slot=${chapter.slot}" class="comics-chapters__item">${chapter.name}</a>`);
  const html = `<!doctype html><html><head><meta property="og:title" content="作品A漫畫 - 包子漫畫"></head><body>${rows.join('\n')}${latest.join('\n')}</body></html>`;

  routes(source, (url) => (url.includes('/comic/') ? html : undefined));
  const chapters = (await source.detail('/comic/slug_a')).episodes[0].urls;
  assert.equal(chapters.length, 3);
  assert.deepEqual(Array.from(chapters, (chapter) => chapter.name), ['001話：第一', '002話：第二', '003話：第三']);
  assert.deepEqual(
    Array.from(chapters, (chapter) => (chapter.url.match(/chapter_slot=(\d+)/) || [])[1]),
    ['0', '1', '2'],
  );
});

test('chapters keep a plain text title and fall back when there is none', async () => {
  const source = extension();
  const html = `<!doctype html><html><head><meta property="og:title" content="作品B漫畫 - 包子漫畫"></head><body>
<a href="/user/page_direct?comic_id=slug_b&amp;section_slot=0&amp;chapter_slot=1">285 大軍撤退</a>
<a href="/user/page_direct?comic_id=slug_b&amp;section_slot=0&amp;chapter_slot=0"><div><span></span></div></a>
</body></html>`;
  routes(source, (url) => (url.includes('/comic/') ? html : undefined));
  const chapters = (await source.detail('/comic/slug_b')).episodes[0].urls;
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].name, '第 1 話');
  assert.equal(chapters[1].name, '285 大軍撤退');
});

test('detail refuses a work without chapters', async () => {
  const source = extension();
  routes(source, (url) => (url.includes('/comic/') ? detailPage({ chapters: [] }) : undefined));
  await assert.rejects(source.detail('/comic/empty-001'), /沒有可閱讀的章節/);
});

test('watch collects the reader pages in order', async () => {
  const source = extension();
  routes(source, (url) => (url.includes('/page_direct') ? readerPage({ pages: 4 }) : undefined));
  const result = await source.watch('/user/page_direct?comic_id=silingfashiwojishitianzai&section_slot=0&chapter_slot=0');
  assert.equal(result.urls.length, 4);
  assert.equal(result.urls[0], 'https://s1.bzcdn.net/scomic/silingfashiwojishitianzai/0/286-4qdm/1.jpg');
  assert.equal(result.urls[3], 'https://s1.bzcdn.net/scomic/silingfashiwojishitianzai/0/286-4qdm/4.jpg');
  assert.match(result.title, /包子漫畫/);
});

test('watch follows the live mirror even when given an absolute chapter url', async () => {
  const source = extension();
  const log = routes(source, (url) => (url.includes('/page_direct') ? readerPage({ pages: 2 }) : undefined));
  const result = await source.watch('https://old-mirror.example/user/page_direct?comic_id=x&section_slot=0&chapter_slot=0');
  assert.equal(result.urls.length, 2);
  const readerCall = log.find((entry) => entry.url.includes('/page_direct'));
  assert.ok(readerCall.url.startsWith('https://www.twmanga.com/'), readerCall.url);
});

test('watch reports a chapter without pages', async () => {
  const source = extension();
  routes(source, (url) => (url.includes('/page_direct') ? '<!doctype html><html><body><p>已下架</p></body></html>' : undefined));
  await assert.rejects(source.watch('/user/page_direct?comic_id=x&section_slot=0&chapter_slot=0'), /沒有取到頁面圖片/);
});

test('work urls are validated before any request', () => {
  const source = extension();
  source.request = async () => { throw new Error('should not be called'); };
  for (const url of ['', '/list/new', 'https://other.example/comic/abc', '/comic/', '/search?q=x']) {
    assert.throws(() => source.target(url), /無效的作品地址|無法解析作品地址/);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(source.target('https://www.twmanga.com/comic/abc-001?from=list'))), {
    path: '/comic/abc-001',
    slug: 'abc-001',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(source.target('https://www.baozimh.com/comic/abc-001'))), {
    path: '/comic/abc-001',
    slug: 'abc-001',
  });
});

test('pages are cached so a slow mirror is not hit twice', async () => {
  const clock = { now: 1000 };
  const source = extension(clock);
  const log = routes(source, () => undefined);
  await source.latest(1, '0');
  const first = log.length;
  await source.latest(1, '0');
  assert.equal(log.length, first, 'the listing must come from cache');
  clock.now += 61000;
  await source.latest(1, '0');
  assert.ok(log.length > first, 'an expired cache must be refreshed');
});
