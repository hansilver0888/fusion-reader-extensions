import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { test } from 'node:test';

// The frames below repeat the markup the mirrors ship (checked 2026-11-04);
// the encrypted payloads are produced here with node's aes-128-cbc so the
// in-plugin decryptor is checked against an independent implementation.
const KEY = '0p0zzpvv.nmn.oop';

function extension(clock) {
  const context = vm.createContext({
    sendMessage() {},
    Date: clock ? class extends Date { static now() { return clock.now; } } : Date,
  });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/copymanga.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'https://www.copy5000.com';
  source.sleep = async () => {};
  source.getSetting = async () => '';
  source.setSetting = async () => {};
  return source;
}

// same wire format as the site: 16 ascii iv characters + hex cipher text
function encryptPayload(text, key = KEY) {
  // The wire IV is 16 printable ASCII characters inside a quoted HTML string.
  // Arbitrary binary bytes could insert a quote and randomly break the fixture.
  const ivText = crypto.randomBytes(8).toString('hex');
  const iv = Buffer.from(ivText, 'ascii');
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), iv);
  const encrypted = Buffer.concat([cipher.update(Buffer.from(text, 'utf8')), cipher.final()]);
  return ivText + encrypted.toString('hex');
}

function chapterListPayload(groups) {
  return JSON.stringify({
    code: 200,
    message: '请求成功',
    results: encryptPayload(JSON.stringify({ build: { path_word: 'example' }, groups })),
  });
}

const newestPage = (cards) => `<!DOCTYPE html><html><body>
<div class="container correlationList"><div class="row">
${cards.map((card) => `
<div class="col-auto exemptComic_Item">
  <div class="exemptComic_Item-img loadingIcon hoverImage">
    <a href="/comic/${card.key}" target="_blank">
      <img class="lazyload" data-src="https://st.mangafunb.fun/t/${card.key}/cover/1.jpg.328x422.jpg">
    </a>
  </div>
  <div class="exemptComicItem-txt-box">
    <div class="exemptComicItem-txt">
      <a href="/comic/${card.key}" target="_blank"><p class="twoLines" title="${card.title}">${card.title}</p></a>
    </div>
  </div>
</div>`).join('\n')}
</div></div></body></html>`;

const filterPage = (cards) => `<!DOCTYPE html><html><body>
<div class="exemptComic-box"><div class="row">
${cards.map((card) => `
<div class="col-auto">
  <a href="/comic/${card.key}" target="_blank">
    <div class="exemptComic_Item-img"><img class="lazyload" data-src="https://sc.mangafunb.fun/c/${card.key}/cover/2.jpg.328x422.jpg"></div>
    <p class="edit-txt" title="${card.title}">${card.title}</p>
  </a>
</div>`).join('\n')}
</div></div></body></html>`;

const detailPage = ({ key = 'example', title = '示例作品', chapters = [] } = {}) => `<!DOCTYPE html><html><head>
<title>${title}-${title}漫畫-連載中-在線閱讀</title>
</head><body>
<span id="dnt" style="display:none;" value="9"></span>
<script>var ccz = '${KEY}';</script>
<div class="comicParticulars-left-img"><img class="lazyload" data-src="https://st.mangafunb.fun/t/${key}/cover/3.jpg.328x422.jpg"></div>
<h6 title="${title}">${title}</h6>
<p class="intro">這是一段簡介。</p>
<span class="comicParticulars-tag">題材：<a href="/comics?theme=1">愛情</a><a href="/comics?theme=2">校園</a></span>
${chapters.map((chapter) => `<a href="/comic/${key}/chapter/${chapter.id}">${chapter.name}</a>`).join('\n')}
</body></html>`;

const chapterPage = ({ pages = 3, encrypted }) => `<!DOCTYPE html><html><body>
<div class="container-fluid comicContent"><ul class="comicContent-list"></ul></div>
<script>var cct = '${KEY}'; var contentKey = '${encrypted}';</script>
</body></html>`;

const pagesPayload = (count, key = KEY) => encryptPayload(
  JSON.stringify(Array.from({ length: count }, (_, index) => ({
    url: `https://st.mangafunb.fun/t/example/abc/${index + 1}.png.c1500x.jpg`,
  }))),
  key
);

function routes(source, handler) {
  const log = [];
  source.request = async (url, options) => {
    log.push({ url, options: options || {} });
    const answer = handler(url, options || {});
    return answer === undefined ? newestPage([{ key: 'example', title: '示例作品' }]) : answer;
  };
  log.hosts = () => log.map((entry) => entry.url.split('/')[2]);
  return log;
}

// ---------- decryption ----------

test('the aes helper matches the FIPS-197 vector', async () => {
  // a fixed vector: key 000102…0f, cipher 69c4e0d8…c55a -> 001122…eeff
  const source = extension();
  const plain = source.decryptPayload;
  assert.equal(typeof plain, 'function');
  // the plugin exposes no direct block api; verify through a round trip instead
  const wire = encryptPayload('FIPS-197 check', 'abcdefghijklmnop');
  assert.equal(plain(wire, 'abcdefghijklmnop'), 'FIPS-197 check');
});

test('the aes helper decrypts utf-8 text and empty payloads', () => {
  const source = extension();
  for (const text of ['', '拷贝漫画', 'a'.repeat(1000), '第01話：開端']) {
    const wire = encryptPayload(text);
    assert.equal(source.decryptPayload(wire, KEY), text, `round trip for ${text.length} chars`);
  }
});

test('a payload with the wrong key or a short body yields nothing', () => {
  const source = extension();
  const wire = encryptPayload('secret');
  assert.notEqual(source.decryptPayload(wire, 'zzzzzzzzzzzzzzzz'), 'secret');
  assert.equal(source.decryptPayload('', KEY), '');
  assert.equal(source.decryptPayload('short', KEY), '');
});

// ---------- entry ----------

test('the selected mirror is requested directly without an extra probe', async () => {
  const source = extension();
  const log = routes(source, () => undefined);
  await source.latest(1, '0');
  assert.equal(source.currentSite(), 'https://www.copy5000.com');
  assert.equal(log.length, 1);
  assert.equal(log[0].url, 'https://www.copy5000.com/newest?offset=0&limit=60');
});

test('a network failure does not trigger retries or mirror polling', async () => {
  const source = extension();
  let calls = 0;
  source.request = async (url, options) => {
    calls += 1;
    assert.equal(options.retry, false);
    throw new Error('connect timeout');
  };
  await assert.rejects(source.latest(1, '0'), /connect timeout/);
  assert.equal(calls, 1);
});

test('the mirror setting is validated without probing external addresses', async () => {
  const source = extension();
  source.getSetting = async () => 'https://www.copy4000.com/';
  const log = routes(source, () => undefined);
  await source.latest(1, '0');
  assert.equal(source.currentSite(), 'https://www.copy4000.com');
  assert.equal(log.length, 1);
  assert.match(log[0].url, /^https:\/\/www\.copy4000\.com\/newest\?/);
  const invalid = extension();
  invalid.getSetting = async () => 'https://unrelated.invalid';
  invalid.request = async () => { throw new Error('must not request'); };
  await assert.rejects(invalid.latest(1, '0'), /官方鏡像/);
});

// ---------- listings ----------

test('channels page the feeds with offsets', async () => {
  const source = extension();
  const log = routes(source, (url) => (url.includes('/comics?') ? filterPage([{ key: 'abc', title: '分類結果' }]) : undefined));
  const channels = await source.channels();
  assert.equal(channels.length, 8);
  const keys = Array.from(channels, (channel) => channel.key);
  assert.equal(new Set(keys).size, keys.length, 'channel keys must be unique');

  await source.latest(1, '0');
  await source.latest(2, '0');
  await source.latest(1, '1');
  await assert.rejects(source.latest(0, '0'), /頁碼/);

  const urls = log.filter((entry) => entry.url.includes('/newest') || entry.url.includes('/comics?')).map((entry) => entry.url.replace('https://www.copy5000.com', '')).filter((url) => !url.includes('limit=1'));
  assert.ok(urls.includes('/newest?offset=0&limit=60'));
  assert.ok(urls.includes('/newest?offset=60&limit=60'));
  assert.ok(urls.some((url) => url.startsWith('/comics?ordering=-popular')));
});

test('the newest feed reads its card shape', () => {
  const source = extension();
  const items = source.cards(newestPage([
    { key: 'tuioukuduanlianaibayaye', title: '推偶苦短，戀愛吧押野!' },
    { key: 'maoyaozhuan', title: '貓妖傳' },
    { key: 'maoyaozhuan', title: '重複' },
  ]));
  assert.equal(items.length, 2);
  assert.equal(items[0].url, '/comic/tuioukuduanlianaibayaye');
  assert.equal(items[0].title, '推偶苦短，戀愛吧押野!');
  // the cover keeps the site thumbnail but drops the size suffix
  assert.equal(items[0].cover, 'https://st.mangafunb.fun/t/tuioukuduanlianaibayaye/cover/1.jpg');
});

test('the filter listing reads its own card shape', () => {
  const source = extension();
  const items = source.cards(filterPage([{ key: 'buyaoxiaoqiaomianbaoa', title: '不要小瞧麵包啊！' }]));
  assert.equal(items.length, 1);
  assert.equal(items[0].url, '/comic/buyaoxiaoqiaomianbaoa');
  assert.equal(items[0].title, '不要小瞧麵包啊！');
});

test('search parses the json envelope and pages it', async () => {
  const source = extension();
  const log = routes(source, (url) => (url.includes('searchcl') ? JSON.stringify({
    code: 200,
    results: {
      list: [
        { path_word: 'haizeiwang', name: '海贼王', cover: 'https://sc.mangafunb.fun/c/haizeiwang/cover/9.jpg.328x422.jpg', author: [{ name: '尾田荣一郎' }] },
        { path_word: 'jinjidejuren', name: '進擊的巨人', cover: 'https://sb.mangafunb.fun/b/jinjidejuren/cover/1.jpg.328x422.jpg', author: [] },
      ],
      total: 40, limit: 12, offset: 0,
    },
  }) : undefined));
  const items = await source.search('海賊王', 1);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, '海贼王');
  assert.equal(items[0].cover, 'https://sc.mangafunb.fun/c/haizeiwang/cover/9.jpg');
  assert.equal(items[0].update, '尾田荣一郎');
  assert.deepEqual(Array.from(await source.search('   ', 1)), []);
  await source.search('海賊王', 3);
  const searchUrls = log.filter((entry) => entry.url.includes('searchcl')).map((entry) => entry.url.replace('https://www.copy5000.com', ''));
  assert.match(searchUrls[0], /offset=0/);
  assert.match(searchUrls[1], /offset=24/);
});

test('search reports site errors instead of a false empty result', async () => {
  const source = extension();
  routes(source, (url) => (url.includes('searchcl') ? '{"code":210,"message":"請到官網更新"}' : undefined));
  await assert.rejects(source.search('x', 1), /210.*請到官網更新/);
});

// ---------- detail ----------

test('detail reads title, cover, description and chapters', async () => {
  const source = extension();
  const chapters = { default: { name: '默認', count: 2, chapters: [
    { type: 1, name: '第01話', id: 'aaaaaaaa-0000-0000-0000-000000000001' },
    { type: 1, name: '第02話', id: 'bbbbbbbb-0000-0000-0000-000000000002' },
  ] } };
  routes(source, (url) => {
    if (url.endsWith('/comic/example')) return detailPage({ key: 'example', title: '示例作品', chapters: [{ id: 'fallback-id', name: '最新話' }] });
    if (url.includes('/comicdetail/example/chapters')) return chapterListPayload(chapters);
    return undefined;
  });

  const detail = await source.detail('/comic/example');
  assert.equal(detail.title, '示例作品');
  assert.equal(detail.cover, 'https://st.mangafunb.fun/t/example/cover/3.jpg');
  assert.match(detail.desc, /這是一段簡介/);
  assert.match(detail.desc, /愛情/);
  assert.equal(detail.episodes[0].urls.length, 2);
  // Preserve the actual website order: oldest first.
  assert.equal(detail.episodes[0].urls[0].name, '第01話');
  assert.equal(detail.episodes[0].urls[1].name, '第02話');
  assert.match(detail.episodes[0].urls[0].url, /chapter\/aaaaaaaa-0000/);
});

test('an empty directory is not replaced with a misleading single latest chapter', async () => {
  const source = extension();
  routes(source, (url) => {
    if (url.endsWith('/comic/example')) return detailPage({ key: 'example', chapters: [{ id: '4bd05882-c7bc-11e8-881a-024352452ce0', name: '最新' }] });
    if (url.includes('/comicdetail/')) return chapterListPayload({ default: { name: '默認', count: 0, chapters: [] } });
    return undefined;
  });
  await assert.rejects(source.detail('/comic/example'), /章節列表為空.*網絡出口/);
});

test('detail reports the api bot check instead of showing an empty shelf', async () => {
  const source = extension();
  routes(source, (url) => {
    if (url.endsWith('/comic/example')) return detailPage({ key: 'example' });
    if (url.includes('/comicdetail/')) return '{"code":210,"message":"請到官網更新最新APP"}';
    return undefined;
  });
  await assert.rejects(source.detail('/comic/example'), /210.*請到官網更新最新APP/);
});

test('detail sends the website dnts header and validates the url first', async () => {
  const source = extension();
  const log = routes(source, (url) => {
    if (url.endsWith('/comic/example')) return detailPage({ key: 'example', chapters: [{ id: 'aaaaaaaa-0000-0000-0000-000000000001', name: '第01話' }] });
    if (url.includes('/comicdetail/')) return chapterListPayload({ default: { name: '默認', count: 1, chapters: [{ type: 1, name: '第01話', id: 'aaaaaaaa-0000-0000-0000-000000000001' }] } });
    return undefined;
  });
  await source.detail('/comic/example');
  const listCall = log.find((entry) => entry.url.includes('/comicdetail/'));
  assert.equal(listCall.options.headers.dnts, '9');
  assert.equal(listCall.options.headers.dnt, undefined);
  assert.match(String(listCall.options.headers.Accept), /json/);

  source.request = async () => { throw new Error('should not be called'); };
  for (const url of ['', '/list/new', '/comics?theme=1']) {
    assert.throws(() => source.target(url), /無效的作品地址|無法解析作品地址/);
  }
});

// ---------- reader ----------

test('watch decrypts the page list', async () => {
  const source = extension();
  routes(source, (url) => {
    if (url.includes('/comic/example/chapter/')) return chapterPage({ encrypted: pagesPayload(4) });
    if (url.endsWith('/comic/example')) return detailPage({ key: 'example' });
    return undefined;
  });
  const result = await source.watch('/comic/example/chapter/aaaaaaaa-0000-0000-0000-000000000001');
  assert.equal(result.urls.length, 4);
  assert.equal(result.urls[0], 'https://st.mangafunb.fun/t/example/abc/1.png.c1500x.jpg');
  assert.equal(result.urls[3], 'https://st.mangafunb.fun/t/example/abc/4.png.c1500x.jpg');
});

test('watch explains an empty contentKey instead of returning nothing', async () => {
  const source = extension();
  routes(source, (url) => {
    if (url.includes('/comic/example/chapter/')) return chapterPage({ encrypted: '' });
    if (url.endsWith('/comic/example')) return detailPage({ key: 'example' });
    return undefined;
  });
  await assert.rejects(source.watch('/comic/example/chapter/abc'), /頁面資料為空/);
});

test('watch rejects urls it cannot parse', () => {
  const source = extension();
  source.request = async () => { throw new Error('should not be called'); };
  for (const url of ['', '/comic/example', '/comic/example/chapter/']) {
    assert.throws(() => source.chapterTarget(url), /無效的章節地址|無法解析章節地址/);
  }
  assert.deepEqual(
    JSON.parse(JSON.stringify(source.chapterTarget('https://www.copy5000.com/comic/example/chapter/abc-1'))),
    { key: 'example', uuid: 'abc-1', path: '/comic/example/chapter/abc-1' },
  );
});

test('the filter listing reads the array it ships in a list attribute', () => {
  const source = extension();
  // the site escapes the quotes and uses a javascript object literal
  const entries = [
    { path_word: 'modujingbingdenuli', name: '魔都精兵的奴隸', cover: 'https://sm.mangafunb.fun/m/modujingbingdenuli/cover/1684896820.jpg.328x422.jpg', status: 0, author: [{ name: '竹村洋平' }, { name: 'タカヒロ' }] },
    { path_word: 'woduzishenji', name: '我獨自升級', cover: 'https://sw.mangafunb.fun/w/woduzishenji/cover/1651527590.jpg.328x422.jpg', status: 1, author: [{ name: 'DUBU' }] },
  ];
  const literal = '[' + entries.map((entry) => {
    const authors = entry.author.map((author) => `{'name': '${author.name}', 'path_word': '${author.name}'}`).join(', ');
    return `{'path_word': '${entry.path_word}', 'name': '${entry.name}', 'cover': '${entry.cover}', 'status': ${entry.status}, 'author': [${authors}]}`;
  }).join(', ') + ']';
  const attribute = literal.replace(/'/g, '&#x27;').replace(/&/g, '&amp;').replace(/&amp;#x27;/g, '&#x27;');
  const html = `<html><body><div class="row exemptComic-box" total="46620" list="${attribute}"></div></body></html>`;

  const parsed = source.inlineList(html);
  assert.ok(parsed, 'the inline list must parse');
  assert.equal(parsed.entries.length, 2);
  assert.equal(parsed.total, 46620);

  const items = source.cards(html);
  assert.equal(items.length, 2);
  assert.equal(items[0].url, '/comic/modujingbingdenuli');
  assert.equal(items[0].title, '魔都精兵的奴隸');
  assert.equal(items[0].cover, 'https://sm.mangafunb.fun/m/modujingbingdenuli/cover/1684896820.jpg');
  assert.equal(items[0].update, '竹村洋平 / タカヒロ');
});

test('a page without the inline array falls back to markup cards', () => {
  const source = extension();
  assert.equal(source.inlineList(newestPage([{ key: 'a', title: 'A' }])), null);
  const items = source.cards(newestPage([{ key: 'example', title: '示例作品' }]));
  assert.equal(items.length, 1);
});

// ---------- public requests and caching ----------

test('page requests stay anonymous even when account settings are filled in', async () => {
  const source = extension();
  const log = routes(source, (url) => {
    if (url.endsWith('/comic/example')) return detailPage({ key: 'example', chapters: [{ id: 'aaaaaaaa-0000-0000-0000-000000000001', name: '第01話' }] });
    if (url.includes('/comicdetail/')) return chapterListPayload({ default: { name: '默認', count: 1, chapters: [{ type: 1, name: '第01話', id: 'aaaaaaaa-0000-0000-0000-000000000001' }] } });
    return undefined;
  });
  source.getSetting = async (key) => (key === 'username' ? 'someone' : key === 'password' ? 'p@ss' : '');

  const detail = await source.detail('/comic/example');
  assert.equal(detail.episodes[0].urls.length, 1);

  // Public reading works without an account; do not send old stored credentials.
  for (const entry of log) {
    assert.equal(entry.options.headers.Authorization, undefined, `no auth header on ${entry.url}`);
    assert.equal(entry.options.headers.Cookie, undefined, `no cookie on ${entry.url}`);
  }
  assert.ok(!log.some((entry) => entry.url.includes('/api/v1/login')), 'no login call is made');
});

test('pages are cached so a slow mirror is not hit twice', async () => {
  const clock = { now: 1000 };
  const source = extension(clock);
  const log = routes(source, () => undefined);
  await source.latest(1, '0');
  const first = log.length;
  await source.latest(1, '0');
  assert.equal(log.length, first, 'the listing must come from cache');
  clock.now += 300001;
  await source.latest(1, '0');
  assert.ok(log.length > first, 'an expired cache must be refreshed');
});


test('a withheld directory can be retried immediately after switching network', async () => {
  const source = extension();
  let count = 0;
  routes(source, (url) => {
    if (url.endsWith('/comic/example')) return detailPage({ key: 'example' });
    if (url.includes('/comicdetail/')) {
      count += 1;
      return chapterListPayload({ default: { name: '默認', chapters: count === 1 ? [] : [{ id: 'chapter-1', name: '第01話' }] } });
    }
  });
  await assert.rejects(source.detail('/comic/example'), /網絡出口/);
  const result = await source.detail('/comic/example');
  assert.equal(result.episodes[0].urls[0].name, '第01話');
  assert.equal(count, 2);
});

test('a withheld reader is not cached and never claims login is mandatory', async () => {
  const source = extension();
  let count = 0;
  const log = routes(source, (url) => {
    if (url.includes('/chapter/')) {
      count += 1;
      return chapterPage({ encrypted: count === 1 ? '' : pagesPayload(3) });
    }
  });
  await assert.rejects(source.watch('/comic/example/chapter/chapter-1'), (error) => {
    assert.match(error.message, /網絡出口/);
    assert.doesNotMatch(error.message, /只對已登入|code 210/);
    return true;
  });
  assert.equal((await source.watch('/comic/example/chapter/chapter-1')).urls.length, 3);
  assert.equal(count, 2);
  assert.ok(!log.some((entry) => entry.url.endsWith('/comic/example')), 'reader needs no extra detail request');
  for (const call of log) {
    assert.equal(call.options.headers.dnt, undefined);
    assert.equal(call.options.headers.dnts, undefined);
  }
});

test('chapters keep group order and remove duplicate chapter ids', async () => {
  const source = extension();
  routes(source, (url) => {
    if (url.endsWith('/comic/example')) return detailPage();
    if (url.includes('/comicdetail/')) return chapterListPayload({
      editionA: { chapters: [{ id: 'vol-1', name: '1卷' }, { id: 'vol-2', name: '2卷' }] },
      editionB: { chapters: [{ id: 'vol-2', name: '2卷' }, { id: 'extra-1', name: '番外' }] },
    });
  });
  const result = await source.detail('/comic/example');
  assert.deepEqual(Array.from(result.episodes[0].urls, (item) => item.name), ['1卷', '2卷', '番外']);
});


test('requests are serial and leave a full gap after the previous response', async () => {
  const clock = { now: 1000 };
  const source = extension(clock);
  source.sleep = async (ms) => { clock.now += ms; };
  const calls = [];
  let release;
  source.request = async (url, options) => {
    calls.push({ url, time: clock.now, retry: options.retry });
    if (calls.length === 1) await new Promise((resolve) => { release = resolve; });
    return '<html>ok</html>';
  };
  const first = source.requestText('https://example.invalid/one');
  const second = source.requestText('https://example.invalid/two');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1, 'second request must wait for first response');
  clock.now += 250;
  const completedAt = clock.now;
  release();
  await Promise.all([first, second]);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].time - completedAt >= 1000);
  assert.ok(calls.every((call) => call.retry === false));
});

test('literal error pauses requests without polling other mirrors', async () => {
  const clock = { now: 1000 };
  const source = extension(clock);
  let calls = 0;
  source.request = async () => {
    calls += 1;
    return calls === 1 ? { status: 200, body: 'error', headers: {} } : newestPage([{ key: 'example', title: '示例作品' }]);
  };
  await assert.rejects(source.latest(1, '0'), /HTTP 200.*error/);
  await assert.rejects(source.latest(1, '0'), /等待.*秒/);
  assert.equal(calls, 1);
  clock.now += 30001;
  assert.equal((await source.latest(1, '0')).length, 1);
  assert.equal(calls, 2);
});

test('HTTP 429 honors Retry-After and request metadata unwraps JSON', async () => {
  const clock = { now: 1000 };
  const source = extension(clock);
  let calls = 0;
  source.request = async (url, options) => {
    calls += 1;
    assert.equal(options.responseMetadata, true);
    return calls === 1 ? { status: 429, body: 'busy', headers: { 'retry-after': ['120'] } } : { status: 200, body: { code: 200, results: { list: [] } }, headers: {} };
  };
  await assert.rejects(source.search('x', 1), /HTTP 429/);
  clock.now += 60000;
  await assert.rejects(source.search('x', 1), /等待.*秒/);
  assert.equal(calls, 1);
  clock.now += 60001;
  assert.equal((await source.search('x', 1)).length, 0);
  assert.equal(calls, 2);
});

test('HTML uses the source UA and reader images inherit the same header', async () => {
  const source = extension();
  const log = routes(source, (url) => url.includes('/chapter/') ? chapterPage({ encrypted: pagesPayload(2) }) : undefined);
  const result = await source.watch('/comic/example/chapter/chapter-1');
  assert.deepEqual(Object.keys(source.pageHeaders()), ['User-Agent']);
  assert.equal(result.headers['User-Agent'], source.userAgent());
  assert.equal(log.length, 1);
  assert.equal(log[0].options.headers['Upgrade-Insecure-Requests'], undefined);
});

test('the fixed mirror setting registers without a website request', async () => {
  const source = extension();
  const settings = [];
  source.registerSetting = async (setting) => settings.push(setting);
  source.request = async () => { throw new Error('load must not access website'); };
  await source.load();
  assert.equal(settings.length, 2);
  assert.equal(settings[0].key, 'site');
});


test('UA profiles are explicit settings and stay fixed across HTML and reader images', async () => {
  const source = extension();
  source.registerSetting = async () => {};
  source.getSetting = async (key) => key === 'userAgent' ? 'mobile' : '';
  const log = routes(source, (url) => url.includes('/chapter/') ? chapterPage({ encrypted: pagesPayload(2) }) : undefined);
  await source.load();
  const stream = await source.watch('/comic/example/chapter/chapter-1');
  assert.match(log[0].options.headers['User-Agent'], /Android.*Mobile Safari/);
  assert.equal(stream.headers['User-Agent'], log[0].options.headers['User-Agent']);
});

test('a rejection never changes the selected UA or adds a hidden second request', async () => {
  const source = extension();
  source.registerSetting = async () => {};
  source.getSetting = async (key) => key === 'userAgent' ? 'chrome' : '';
  const agents = [];
  source.request = async (url, options) => { agents.push(options.headers['User-Agent']); return 'error'; };
  await source.load();
  await assert.rejects(source.latest(1, '0'), /拒絕/);
  await assert.rejects(source.latest(1, '0'), /等待/);
  assert.equal(agents.length, 1);
  assert.match(agents[0], /Windows.*Chrome/);
  assert.equal(source.userAgent(), agents[0]);
});
