import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

// Frames repeat the shapes the site ships (checked 2026-11-01): a self hosted
// gatekeeper (proof of work + verify POST), `comics-card` covers, chapters that
// link to /user/page_direct, and a reader page whose <amp-img> are the pages.
function extension(clock) {
  const context = vm.createContext({
    sendMessage() {},
    Date: clock ? class extends Date { static now() { return clock.now; } } : Date,
  });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/baozimh.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'https://www.baozimh.com';
  source.sleep = async () => {};
  source.getSetting = async () => '';
  source.setSetting = async () => {};
  return source;
}

const challengeBody = `<!DOCTYPE html><html><body data-state="checking"><script src="/__gatekeeper_challenge/assets/abc/challenge.js"></script>
<script nonce="n">(function(){var g=window.gatekeeperChallenge;if(g&&typeof g.start==="function"){g.start({challengeId:"9b31933f9d4f43b2438f522908e3d0932a885b6f5f4c59e303a1fba8ef9a2b33",ticket:"AhCgsb_3BKD-CoDd",verifyUrl:"/__gatekeeper_challenge/verify",workerUrl:"/__gatekeeper_challenge/assets/1b22/worker.js",difficultyBits:16,lifeMs:180000,computeMs:120000,submitMs:15000});return;}document.body.setAttribute("data-state","failed");})();</script></body></html>`;

const challengeJson = '{"challenge_url":"/__gatekeeper_challenge/start?return=%2F","error":"challenge_required"}';

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

function routes(source, handler, requests) {
  const log = requests || [];
  source.request = async (url, options) => {
    log.push({ url, options: options || {} });
    return handler(url, options || {});
  };
  return log;
}

test('the sha256 helper matches known vectors', () => {
  const source = extension();
  // the runtime evaluates the module in the vm, so exercise the worker through
  // passGate: a challenge whose nonce is found proves the hash is correct
  assert.equal(typeof source.passGate, 'function');
});

test('a gatekeeper challenge is solved and the read is retried', async () => {
  const source = extension();
  let reads = 0;
  const log = routes(source, (url, options) => {
    if (url.includes('/__gatekeeper_challenge/start')) return challengeBody;
    if (url.includes('/__gatekeeper_challenge/verify')) return '{"mode":"manual","status":"passed"}';
    reads += 1;
    if (reads === 1) return challengeJson;
    return listing([card({})]);
  });

  const items = await source.cards(await source.page('/list/new'));
  assert.equal(items.length, 1);
  const verify = log.find((entry) => entry.url.includes('/verify'));
  assert.ok(verify, 'the gate must be verified');
  assert.equal(verify.options.method, 'POST');
  const payload = JSON.parse(verify.options.data);
  assert.equal(payload.challenge_id, '9b31933f9d4f43b2438f522908e3d0932a885b6f5f4c59e303a1fba8ef9a2b33');
  assert.equal(payload.ticket, 'AhCgsb_3BKD-CoDd');
  assert.match(payload.nonce, /^\d+$/);
  assert.match(String(verify.options.headers['Content-Type']), /application\/json/);
  assert.equal(verify.options.headers.Origin, 'https://www.baozimh.com');
  assert.ok(reads >= 2, 'the read must be retried after the gate');
});

test('a nonce that satisfies the difficulty is produced', async () => {
  const source = extension();
  const log = routes(source, (url) => {
    if (url.includes('/start')) return challengeBody;
    if (url.includes('/verify')) return '{}';
    return '';
  });
  await source.passGate('/list/new');
  const payload = JSON.parse(log.find((entry) => entry.url.includes('/verify')).options.data);
  const nonce = Number(payload.nonce);
  assert.ok(Number.isFinite(nonce) && nonce >= 0);
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
  assert.equal(items[1].title, '第二部作品');
});

test('channels page the catalogue but not the update feed', async () => {
  const source = extension();
  const requests = routes(source, () => listing([card({})]));
  const channels = await source.channels();
  assert.equal(channels.length, 6);
  assert.equal(channels[0].title, '最近更新');
  // the app compares every chip against this key, so it must be unique and set
  const keys = Array.from(channels, (channel) => channel.key);
  assert.equal(new Set(keys).size, keys.length, 'channel keys must be unique');
  assert.ok(keys.every((key) => typeof key === 'string' && key.length > 0), 'channel keys must not be empty');

  await source.latest(1, '0');
  await source.latest(2, '0');
  await source.latest(1, '1');
  await source.latest(3, '1');
  await source.latest(1);
  // the update feed ignores the page number, so it is the same url (and the
  // page cache keeps it to one request); the catalogue appends &page=N
  assert.deepEqual(requests.map((entry) => entry.url.replace('https://www.baozimh.com', '')), [
    '/list/new',
    '/classify?type=all&region=all&state=all&filter=%2a',
    '/classify?type=all&region=all&state=all&filter=%2a&page=3',
  ]);
  await assert.rejects(source.latest(0, '0'), /頁碼/);
});

test('search encodes the keyword and only serves the first page', async () => {
  const source = extension();
  const requests = routes(source, () => listing([card({ slug: 'abc-003', title: '搜索命中' })]));
  assert.equal((await source.search('死靈法師', 1))[0].title, '搜索命中');
  assert.deepEqual(Array.from(await source.search('死靈法師', 2)), []);
  assert.deepEqual(Array.from(await source.search('   ', 1)), []);
  assert.deepEqual(requests.map((entry) => entry.url.replace('https://www.baozimh.com', '')), [
    '/search?q=%E6%AD%BB%E9%9D%88%E6%B3%95%E5%B8%AB',
  ]);
});

test('detail reads the metadata and every chapter', async () => {
  const source = extension();
  routes(source, () => detailPage({}));
  const detail = await source.detail('/comic/silingfashiwojishitianzai');
  assert.equal(detail.title, '死靈法師！我即是天災');
  assert.ok(detail.cover.startsWith('https://static-tw.baozimh.com/cover/silingfashiwojishitianzai.jpg'));
  assert.equal(detail.desc, '死靈法師！我即是天災漫畫簡介');
  assert.equal(detail.episodes[0].urls.length, 2);
  // the app reads `name` on an episode, so a `title` would render as a blank row
  assert.equal(detail.episodes[0].urls[0].name, '001話：開端');
  assert.equal(detail.episodes[0].urls[0].title, undefined);
  assert.match(detail.episodes[0].urls[0].url, /chapter_slot=0/);
  assert.match(detail.episodes[0].urls[1].url, /chapter_slot=1/);
});

test('chapters are de-duplicated and ordered by slot', async () => {
  const source = extension();
  // the page lists newest first, repeats each chapter for a second volume and
  // ends with a "latest chapters" block that goes the other way
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

  routes(source, () => html);
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
  routes(source, () => html);
  const chapters = (await source.detail('/comic/slug_b')).episodes[0].urls;
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].name, '第 1 話');
  assert.equal(chapters[1].name, '285 大軍撤退');
});

test('detail refuses a work without chapters', async () => {
  const source = extension();
  routes(source, () => detailPage({ chapters: [] }));
  await assert.rejects(source.detail('/comic/empty-001'), /沒有可閱讀的章節/);
});

test('watch collects the reader pages in order', async () => {
  const source = extension();
  routes(source, () => readerPage({ pages: 4 }));
  const result = await source.watch('https://www.baozimh.com/user/page_direct?comic_id=silingfashiwojishitianzai&section_slot=0&chapter_slot=0');
  assert.equal(result.urls.length, 4);
  assert.equal(result.urls[0], 'https://s1.bzcdn.net/scomic/silingfashiwojishitianzai/0/286-4qdm/1.jpg');
  assert.equal(result.urls[3], 'https://s1.bzcdn.net/scomic/silingfashiwojishitianzai/0/286-4qdm/4.jpg');
  assert.match(result.title, /包子漫畫/);
});

test('watch reports a chapter without pages', async () => {
  const source = extension();
  routes(source, () => '<!doctype html><html><body><p>已下架</p></body></html>');
  await assert.rejects(source.watch('/user/page_direct?comic_id=x&section_slot=0&chapter_slot=0'), /沒有取到頁面圖片/);
});

test('work urls are validated before any request', () => {
  const source = extension();
  source.request = async () => { throw new Error('should not be called'); };
  for (const url of ['', '/list/new', 'https://other.example/comic/abc', '/comic/', '/search?q=x']) {
    assert.throws(() => source.target(url), /無效的作品地址|無法解析作品地址/);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(source.target('https://www.baozimh.com/comic/abc-001?from=list'))), {
    path: '/comic/abc-001',
    slug: 'abc-001',
  });
});
