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
  vm.runInContext(fs.readFileSync(new URL('../sources/hanime1.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'https://hanime1.me';
  source.getSetting = async () => 'auto';
  source.sleep = async (ms) => { if (clock) clock.now += ms; };
  return source;
}

const card = ({ id, title, duration = '08:39', rating = '100%', views = '1.3萬次', cover }) => `
<div title="${title}" class="video-item-container">
    <div class="horizontal-card">
        <a href="https://hanime1.me/watch?v=${id}" class="video-link">
            <div class="thumb-container">
                <img class="main-thumb" src="${cover || `https://vdownload.hembed.com/image/thumbnail/${id}l.jpg?secure=a==,1`}" loading="lazy">
                <div class="duration">${duration}</div>
                <div class="stats-container">
                    <div class="stat-item"><i class="material-icons">thumb_up</i> ${rating}</div>
                    <div class="stat-item">${views}</div>
                </div>
            </div>
            <div class="title">${title}</div>
        </a>
        <div class="subtitle"><a href="https://hanime1.me/search?query=uploader">uploader</a></div>
    </div>
</div>`;

// The site's own ad cards reuse the container class but link off-site.
const adCard = `
<div title="贊助廣告" class="video-item-container">
    <div class="horizontal-card">
        <a href="https://ads.example/promo" class="video-link">
            <div class="thumb-container"><img class="main-thumb" src="https://ads.example/banner.jpg"><div class="duration">00:15</div></div>
            <div class="title">贊助廣告</div>
        </a>
    </div>
</div>`;

const listing = (cards) => `<!doctype html><html><head><title>搜尋</title></head>
<body><form id="hentai-form" action="https://hanime1.me/search" method="GET"></form>
<div class="search-pagination"></div>${cards.join('\n')}</body></html>`;

const playlistRow = ({ id, title, list = '555' }) => `
<div class="user-tab-item-wrapper" id="playlist-item-${id}">
    <div class="playlist-item-row clickable-row" data-href="https://hanime1.me/watch?v=${id}&amp;list=${list}">
        <div class="item-card-wrapper">
            <div class="playlist-video-card video-item-container no-select">
                <div class="video-thumb-container horizontal-card">
                    <div class="thumb-container">
                        <a href="https://hanime1.me/watch?v=${id}&amp;list=${list}&amp;sort=latest">
                            <img class="main-thumb" src="https://vdownload.hembed.com/image/thumbnail/${id}l.jpg?secure=b==,1">
                            <div class="duration">08:00</div>
                        </a>
                    </div>
                </div>
                <div class="video-info-container">
                    <h4 class="video-title"><a href="https://hanime1.me/watch?v=${id}&amp;list=${list}">${title}</a></h4>
                    <div class="video-meta-data"><div class="meta-author"><a href="/search?query=uploader">uploader</a></div></div>
                </div>
            </div>
        </div>
    </div>
</div>`;

const playlistPage = ({ count, rows }) => `<!doctype html><html><head><title>示例合集</title></head><body>
<div class="playlist-stats">播放清單 • <span id="sidebar-video-count">${count}</span> 部影片</div>
<div class="playlist-video-list">${rows.join('\n')}</div></body></html>`;

// Genre pages print a grid whose card is one anchor wrapping cover and title.
const gridCard = ({ id, title, cover }) => `
<a style="text-decoration: none;" href="https://hanime1.me/watch?v=${id}" >
    <div class="home-rows-videos-div search-videos hover-lighter">
        <div class="video-card-inner" style="position: relative;">
            <img loading="lazy" src="${cover || `https://vdownload.hembed.com/image/cover/${id}.jpg?secure=g==,1`}">
            <div class="home-rows-videos-title">${title}</div>
        </div>
    </div>
</a>`;

const gridListing = (cards) => `<!doctype html><html><head><title>類型</title></head><body>
<div class="home-rows-videos-wrapper" style="white-space: normal">
${cards.join('\n')}
</div></body></html>`;

const watchPage = ({ id = '100001', title = '示例作品 A', artist = '示例作者', genre = '裏番',
  duration = 519, sources = ['720p', '480p', '1080p'], playlist = { id: '555', title: '示例合集' },
  tags = ['JK', '中文字幕'], caption = 'Title / タイトル: 示例作品 A\nBrand / ブランド: 示例作者',
  stats = '觀看次數：1.2萬次&nbsp;&nbsp;2026-01-02' } = {}) => `<!doctype html><html><head>
<meta property="og:title" content="${title} - Hanime1.me">
<meta property="og:image" content="https://vdownload.hembed.com/image/thumbnail/${id}h.jpg?secure=c==,1">
<meta property="og:video:duration" content="${duration}">
</head><body>
<div class="nav-item nav-desktop-MMD-item"><a href="https://hanime1.me/search?genre=MMD">MMD</a></div>
<video style="width: 100%" id="player" controls crossorigin playsinline preload="auto">
    ${sources.map((size) => `<source src="https://vdownload.hembed.com/${id}-${size}.mp4?secure=s==,1" type="video/mp4" size="${size.replace('p', '')}">`).join('\n    ')}
</video>
<h3 id="shareBtn-title" class="video-details-wrapper" style="font-weight: bold">${title}</h3>
<div class="video-details-wrapper hidden-sm hidden-md hidden-lg hidden-xl">${stats}</div>
<a href="https://hanime1.me/user/777" style="position: relative; text-decoration: none;">
    <img id="video-user-avatar" src="https://vdownload.hembed.com/image/avatar/777.jpeg?secure=d==,1" alt="${artist}"></a>
<a id="video-artist-name" style="color: white" href="https://hanime1.me/search?query=${encodeURIComponent(artist)}">${artist}</a>
<a style="color: #aaa" href="https://hanime1.me/search?genre=${encodeURIComponent(genre)}">${genre}</a>
<div class="video-details-wrapper">
    <div class="video-description-panel video-description-panel-hover no-select">
        <div class="video-caption-text caption-ellipsis">${caption}</div>
    </div>
</div>
<div class="video-details-wrapper video-tags-wrapper">
    ${tags.map((tag, index) => `<div class="single-video-tag"><a href="/search?tags%5B%5D=${encodeURIComponent(tag)}">${tag}&nbsp;<span>(${index + 1})</span></a></div>`).join('\n    ')}
</div>
${playlist ? `<div class="video-playlist-wrapper"><a href="https://hanime1.me/playlist?list=${playlist.id}&amp;sort=latest" style="color: white">${playlist.title}</a></div>` : ''}
</body></html>`;

// Every read has to start at the site's http entry point: its Cloudflare edge
// refuses direct https requests from the app's tls stack, while the site's own
// http -> https redirect is served normally.
function U(path) {
  return 'http://hanime1.me' + path;
}

function pages(source, routes) {
  const requested = [];
  source.request = async (url) => {
    requested.push(url);
    assert.ok(String(url).startsWith('http://hanime1.me/'), `not the http entry point: ${url}`);
    const route = routes[url] !== undefined ? routes[url] : routes[String(url).replace('http://hanime1.me', '')];
    assert.ok(route !== undefined, `Unexpected request: ${url}`);
    return typeof route === 'function' ? route() : route;
  };
  return requested;
}

test('channels map onto the website search parameters and stay usable as keys', async () => {
  const source = extension();
  const channels = await source.channels();
  assert.ok(channels.length >= 40);
  const titles = channels.map((channel) => channel.title);
  assert.ok(titles.includes('裏番') && titles.includes('最新上市'));
  assert.ok(titles.includes('標籤：中文字幕') && titles.includes('日期：過去 1 週'));
  for (const channel of channels) {
    assert.equal(source.channelQuery(channel.key), channel.key
      .split('&')
      .map((pair) => pair.split('=').map((part, index) => (index === 0 ? encodeURIComponent(part) : encodeURIComponent(part))).join('='))
      .join('&'));
  }
  assert.equal(source.channelQuery(''), 'sort=%E6%9C%80%E6%96%B0%E4%B8%8A%E5%B8%82');
  assert.equal(source.channelQuery('tags[]=中文字幕&sort=本週排行'),
    'tags%5B%5D=%E4%B8%AD%E6%96%87%E5%AD%97%E5%B9%95&sort=%E6%9C%AC%E9%80%B1%E6%8E%92%E8%A1%8C');
});

test('unknown, empty and injected channel parameters are rejected instead of reaching the site', () => {
  const source = extension();
  for (const key of ['sort=', 'query=1', 'page=2', '../genre=裏番', 'sort=1&query=2', 'genre']) {
    assert.throws(() => source.channelQuery(key), /未知的分類/);
  }
});

test('listing and search build the site urls, encode keywords and reject bad page numbers', async () => {
  const source = extension();
  const requested = pages(source, {
    '/search?genre=%E8%A3%8F%E7%95%AA&page=2': listing([card({ id: '100001', title: '示例作品 A' })]),
    '/search?query=%E7%A4%BA%E4%BE%8B%20%2F%20A%26B&page=3': listing([]),
  });
  const items = await source.latest(2, 'genre=裏番');
  assert.equal(items.length, 1);
  assert.equal(items[0].url, '/watch?v=100001');
  assert.deepEqual(Array.from(await source.search('  示例 / A&B  ', 3)), []);
  assert.deepEqual(requested, [U('/search?genre=%E8%A3%8F%E7%95%AA&page=2'), U('/search?query=%E7%A4%BA%E4%BE%8B%20%2F%20A%26B&page=3')]);
  assert.deepEqual(Array.from(await source.search('   ', 1)), []);
  assert.equal(requested.length, 2);

  for (const page of [0, -1, 'x', '', 1.5, null]) {
    await assert.rejects(source.latest(page, ''), /頁碼/);
    await assert.rejects(source.search('a', page), /頁碼/);
  }
  await assert.rejects(source.latest(1, 'sort='), /未知的分類/);
});

test('cards parse titles, covers, duration and play counts, and drop ads and repeats', () => {
  const source = extension();
  const html = listing([
    adCard,
    card({ id: '100001', title: '示例作品 A &amp; B' }),
    card({ id: '100002', title: '示例作品 C', duration: '21:55', views: '7.3萬次' }),
    adCard,
    card({ id: '100001', title: '示例作品 A &amp; B' }),
    card({ id: '100003', title: '' }),
  ]);
  const items = source.cards(html);
  assert.equal(items.length, 2);
  assert.deepEqual(Array.from(items, (item) => item.title), ['示例作品 A & B', '示例作品 C']);
  assert.equal(items[1].update, '21:55 · 7.3萬次');
  assert.equal(items[0].cover, 'https://vdownload.hembed.com/image/thumbnail/100001l.jpg?secure=a==,1');
});

test('genre pages use a grid layout, read in document order with the row layout', () => {
  const source = extension();
  const ads = '<a href="https://l.erodalabs.com/s/promo" target="_blank"><div class="home-rows-videos-div search-videos hover-lighter">'
    + '<div class="video-card-inner"><img src="https://ads.example/banner.jpg"></div></div></a>';
  const grid = gridListing([
    ads,
    gridCard({ id: '200001', title: '網格作品 A' }),
    gridCard({ id: '200002', title: '網格作品 B &amp; C' }),
    gridCard({ id: '200001', title: '網格作品 A' }),
  ]);
  const items = source.cards(grid);
  assert.equal(items.length, 2);
  assert.deepEqual(Array.from(items, (item) => [item.title, item.url, item.update]), [
    ['網格作品 A', '/watch?v=200001', ''],
    ['網格作品 B & C', '/watch?v=200002', ''],
  ]);
  assert.equal(items[0].cover, 'https://vdownload.hembed.com/image/cover/200001.jpg?secure=g==,1');

  const mixed = source.cards(
    gridListing([gridCard({ id: '200001', title: '網格 A' })]) + listing([card({ id: '100001', title: '列卡 B' })])
  );
  assert.deepEqual(Array.from(mixed, (item) => item.url), ['/watch?v=200001', '/watch?v=100001']);
});

test('uploader links are moved back to the http entry point, avatar names as a fallback', () => {
  const source = extension();
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const expected = U('/search?query=' + encodeURIComponent('示例作者'));
  const anchor = '<a id="video-artist-name" style="color: white" href="https://hanime1.me/search?query='
    + encodeURIComponent('示例作者') + '">示例作者</a>';
  assert.deepEqual(plain(source.artistInfo(anchor)), { name: '示例作者', url: expected });
  assert.deepEqual(plain(source.artistInfo('<img id="video-user-avatar" src="x" alt="示例作者">')), { name: '示例作者', url: expected });
  assert.deepEqual(plain(source.artistInfo('<html></html>')), { name: '', url: '' });
});

test('detail reads the video page, its uploader, genre, tags and playlist catalogue', async () => {
  const source = extension();
  const playlist = playlistPage({ count: 3, rows: [
    playlistRow({ id: '100001', title: '示例作品 A' }),
    playlistRow({ id: '100002', title: '示例作品 B' }),
    playlistRow({ id: '100003', title: '示例作品 C' }),
  ] });
  const requested = pages(source, {
    '/watch?v=100001': watchPage({}),
    '/playlist?list=555&sort=latest': playlist,
  });
  const detail = await source.detail('/watch?v=100001');
  assert.equal(detail.title, '示例作品 A');
  assert.equal(detail.cover, 'https://vdownload.hembed.com/image/thumbnail/100001h.jpg?secure=c==,1');
  assert.match(detail.desc, /^作者：示例作者/);
  assert.match(detail.desc, /類型：裏番/);
  assert.match(detail.desc, /片長：08:39/);
  assert.match(detail.desc, /觀看次數：1.2萬次/);
  assert.match(detail.desc, /Brand \/ ブランド: 示例作者/);
  assert.match(detail.desc, /標籤：JK \/ 中文字幕/);
  assert.deepEqual(Array.from(detail.authors, (author) => author.name), ['示例作者']);
  assert.equal(detail.authors[0].url, U('/search?query=' + encodeURIComponent('示例作者')));
  assert.equal(detail.episodes.length, 1);
  assert.equal(detail.episodes[0].title, '示例合集');
  assert.deepEqual(Array.from(detail.episodes[0].urls, (entry) => entry.url),
    ['/watch?v=100001&list=555', '/watch?v=100002&list=555', '/watch?v=100003&list=555']);
  assert.deepEqual(Array.from(detail.episodes[0].urls, (entry) => entry.name), ['示例作品 A', '示例作品 B', '示例作品 C']);
  assert.deepEqual(requested, [U('/watch?v=100001'), U('/playlist?list=555&sort=latest')]);
});

test('detail falls back to a single episode without a playlist and reports a partly read catalogue', async () => {
  const source = extension();
  pages(source, { '/watch?v=100004': watchPage({ id: '100004', title: '單片作品', playlist: null }) });
  const single = await source.detail('/watch?v=100004');
  assert.equal(single.episodes.length, 1);
  assert.equal(single.episodes[0].title, '影片');
  assert.deepEqual(Array.from(single.episodes[0].urls, (entry) => [entry.name, entry.url]), [['單片作品', '/watch?v=100004']]);
  assert.doesNotMatch(single.desc, /播放清單/);

  const truncated = extension();
  pages(truncated, {
    '/watch?v=100001': watchPage({}),
    '/playlist?list=555&sort=latest': playlistPage({ count: 4, rows: [playlistRow({ id: '100001', title: '示例作品 A' })] }),
    '/playlist?list=555&sort=latest&page=2': playlistPage({ count: 4, rows: [] }),
  });
  const fallback = await truncated.detail('/watch?v=100001');
  assert.equal(fallback.episodes[0].title, '影片');
  assert.match(fallback.desc, /播放清單暫時無法讀取/);
});

test('playlist reading follows the declared size and completes the catalogue across pages', async () => {
  const source = extension();
  const requested = pages(source, {
    '/playlist?list=555&sort=latest': playlistPage({ count: 3, rows: [
      playlistRow({ id: '100001', title: '示例作品 A' }),
      playlistRow({ id: '100002', title: '示例作品 B' }),
    ] }),
    '/playlist?list=555&sort=latest&page=2': playlistPage({ count: 3, rows: [
      playlistRow({ id: '100002', title: '示例作品 B' }),
      playlistRow({ id: '100003', title: '示例作品 C' }),
    ] }),
  });
  const items = await source.playlistItems('555');
  assert.deepEqual(Array.from(items, (item) => item.id), ['100001', '100002', '100003']);
  assert.deepEqual(requested, [U('/playlist?list=555&sort=latest'), U('/playlist?list=555&sort=latest&page=2')]);

  const empty = extension();
  pages(empty, { '/playlist?list=555&sort=latest': playlistPage({ count: 0, rows: [] }) });
  await assert.rejects(empty.playlistItems('555'), /沒有可讀取/);

  const short = extension();
  pages(short, {
    '/playlist?list=555&sort=latest': playlistPage({ count: 9, rows: [playlistRow({ id: '100001', title: '示例作品 A' })] }),
    '/playlist?list=555&sort=latest&page=2': playlistPage({ count: 9, rows: [] }),
  });
  await assert.rejects(short.playlistItems('555'), /只讀取到 1\/9/);
});

test('detail and watch reject foreign hosts and ids the site cannot serve', async () => {
  const source = extension();
  source.request = async () => { throw new Error('should not be called'); };
  for (const url of ['https://other.example/watch?v=1', '', 'abc', '/playlist?list=1']) {
    await assert.rejects(source.detail(url), /無效的影片地址|無法解析影片編號/);
    await assert.rejects(source.watch(url), /無效的影片地址|無法解析影片編號/);
  }
  assert.equal(source.videoId('https://hanime1.me/watch?v=408674&list=693294'), '408674');
  assert.equal(source.videoId('408674'), '408674');
  assert.equal(source.videoId('?v=408674'), '408674');
});

test('watch resolves the signed media url at the preferred quality and falls back when it is absent', async () => {
  const source = extension();
  pages(source, { '/watch?v=100001': watchPage({}) });
  const auto = await source.watch('/watch?v=100001&list=555');
  assert.equal(auto.type, 'mp4');
  assert.equal(auto.url, 'https://vdownload.hembed.com/100001-1080p.mp4?secure=s==,1');

  source.getSetting = async () => '720P';
  assert.equal(source.preferredQuality ? await source.preferredQuality() : '720p', '720p');
  assert.match((await source.watch('/watch?v=100001')).url, /-720p\.mp4/);

  source.getSetting = async () => '2160p';
  assert.equal(await source.preferredQuality(), 'auto');
  assert.match((await source.watch('/watch?v=100001')).url, /-1080p\.mp4/);

  const only480 = extension();
  pages(only480, { '/watch?v=100001': watchPage({ sources: ['480p'] }) });
  only480.getSetting = async () => '720p';
  assert.match((await only480.watch('/watch?v=100001')).url, /-480p\.mp4/);
});

test('watch keeps HLS playlists, ignores media on other hosts and reports empty pages', async () => {
  const source = extension();
  pages(source, { '/watch?v=100002': watchPage({ id: '100002' })
    .replace(/<source[^>]*>/g, '')
    .replace('<video', '<video src="https://vdownload.hembed.com/100002/master.m3u8?secure=e==,1"') });
  const hls = await source.watch('/watch?v=100002');
  assert.equal(hls.type, 'hls');
  assert.match(hls.url, /master\.m3u8/);

  const foreign = extension();
  pages(foreign, { '/watch?v=100003': watchPage({ id: '100003' })
    .replace(/https:\/\/vdownload\.hembed\.com/g, 'https://cdn.example.net') });
  await assert.rejects(foreign.watch('/watch?v=100003'), /沒有可播放的影片來源/);

  const empty = extension();
  pages(empty, { '/watch?v=100004': '<html><body><h3 id="shareBtn-title">已下架</h3></body></html>' });
  await assert.rejects(empty.watch('/watch?v=100004'), /沒有可播放的影片來源/);

  const members = extension();
  pages(members, { '/watch?v=100005': '<html><body>此影片需要登入後才能播放</body></html>' });
  await assert.rejects(members.watch('/watch?v=100005'), /需要網站帳號/);
});

test('a Cloudflare challenge is reported instead of being parsed as an empty catalogue', async () => {
  const source = extension();
  source.request = async () => '<html><head><title>Just a moment...</title></head><body>Cloudflare</body></html>';
  await assert.rejects(source.latest(1, ''), /人機驗證/);
  const broken = extension();
  broken.request = async () => '<html><body>maintenance</body></html>';
  await assert.rejects(broken.latest(1, ''), /無法解析/);
});

test('identical reads are merged, pages are cached briefly and blocked reads back off', async () => {
  const clock = { now: 500000 };
  const source = extension(clock);
  let calls = 0;
  source.request = async () => { calls++; return listing([card({ id: '100001', title: '示例作品 A' })]); };

  const first = source.latest(1, '');
  const second = source.latest(1, '');
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  await source.latest(1, '');
  assert.equal(calls, 1);

  clock.now += 30001;
  await source.latest(1, '');
  assert.equal(calls, 2);

  // A blocked read is retried once, then reported with the routing hint; the
  // next request waits out the cooldown instead of hammering the edge.
  const blocked = extension({ now: 1000 });
  let attempts = 0;
  blocked.request = async () => {
    attempts++;
    if (attempts <= 2) throw new Error('HTTP 403: <!DOCTYPE html> Attention Required! | Cloudflare');
    return listing([]);
  };
  await assert.rejects(blocked.latest(1, ''), /Cloudflare 攔截頁|HTTPS_PROXY/);
  assert.equal(attempts, 2);
  assert.ok(blocked._cooldownUntil > 1000, 'the cooldown is armed after a block');
  await blocked.latest(2, '');
  assert.equal(attempts, 3);
  assert.ok(blocked._lastRequest >= blocked._cooldownUntil, 'the retry waited out the cooldown');

  const rateLimited = extension({ now: 2000 });
  let limited = 0;
  rateLimited.request = async () => { limited++; throw new Error('HTTP 429: slow down'); };
  await assert.rejects(rateLimited.latest(1, ''), /Cloudflare 攔截頁|HTTPS_PROXY/);
  assert.equal(limited, 2);
  assert.ok(rateLimited._cooldownUntil > 2000);

  const offline = extension();
  offline.request = async () => { throw new Error('offline'); };
  await assert.rejects(offline.latest(1, ''), /offline/);
  assert.equal(offline._cooldownUntil, 0, 'plain failures do not arm the cooldown');
});

test('author search reuses the site keyword search and the same card parser', async () => {
  const source = extension();
  const keyword = encodeURIComponent('示例作者');
  const searchPath = U('/search?query=' + keyword + '&page=1');
  const requested = pages(source, {
    [searchPath]: listing([card({ id: '100001', title: '示例作品 A' })]),
  });
  const author = { name: '示例作者', url: U('/search?query=' + keyword) };
  const items = await source.searchAuthor(author, 1);
  assert.equal(items.length, 1);
  assert.deepEqual(Array.from(await source.searchAuthor({ name: '   ' }, 1)), []);
  assert.deepEqual(requested, [searchPath]);
});


test('load registers the quality setting once and text helpers clean site markup', async () => {
  const source = extension();
  const settings = [];
  source.registerSetting = async (setting) => { settings.push(setting); };
  await source.load();
  assert.deepEqual(Array.from(settings, (setting) => [setting.key, setting.defaultValue]), [['quality', 'auto']]);

  const image = `<img class="main-thumb" data-src="//vdownload.hembed.com/image/thumbnail/1l.jpg?secure=a==,1" src="data:image/gif;base64,R0lGOD">`;
  assert.equal(source.thumbUrl(image), 'https://vdownload.hembed.com/image/thumbnail/1l.jpg?secure=a==,1');
  assert.equal(source.textOf('<div>第一行<br>第二行 &amp; &#39;補充&#39;</div>'), "第一行\n第二行 & '補充'");
  assert.equal(source.clock(519), '08:39');
  assert.equal(source.attrValue('<a href="https://hanime1.me/watch?v=1" id="video-artist-name">', 'href'), 'https://hanime1.me/watch?v=1');
});
