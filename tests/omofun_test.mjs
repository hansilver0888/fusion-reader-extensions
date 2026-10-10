import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const origin = 'https://www.omofuna.com';
const work = '/anime/abc123.html';
const episode = '/anime/abc123/play/3/1.html';

function extension() {
  const context = vm.createContext({ sendMessage() {} });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/omofun.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = origin;
  source.grpcRequest = undefined;
  return source;
}

function config(data) {
  return '<html><script>var player_aaaa=' + JSON.stringify(data) + '</script></html>';
}

const gate = `<html><title>系统安全验证 - Omofun</title>
  <script>const key=new Uint8Array([0x4e,0x3f,0xa9,0xc2]);
  MAC.Ajax(maccms.path+'/index.php/ajax/verify_check?type=search','post','json',{},()=>{});</script>
  <button class="verify_submit">继续访问</button></html>`;

test('lists parse lazy covers, entity-encoded titles and status without depending on random CSS classes', () => {
  const source = extension();
  const result = source.list(`<html>
    <a href="${work}" title="A &amp; B">banner</a>
    <a class="renamed-today" href="${work}" title="A &amp; B" data-original="//covers.example/a.jpg">
      <b>2026</b><b>第02集</b></a>
    <h4><a href="${work}" title="A &amp; B">A &amp; B</a></h4>
    <a href='/anime/def456.html' title='Second'><img data-src='/cover.jpg' src='/load.gif'></a>
    <a href="/manga/abc.html" title="Not anime" data-original="/ignored.jpg"></a>
    <a href="https://wrong.example${work}" title="Not this site" data-original="/ignored.jpg"></a>
    </html>`);
  assert.equal(result.length, 2);
  assert.equal(result[0].title, 'A & B');
  assert.equal(result[0].cover, 'https://covers.example/a.jpg');
  assert.equal(result[0].update, '第02集');
  assert.equal(result[0].url, work);
  assert.equal(result[1].cover, origin + '/cover.jpg');
});

test('category and keyword pagination use independent numbered URLs and encode special characters', async () => {
  const source = extension(), requests = [];
  source.page = async path => { requests.push(path); return '<html></html>'; };
  await source.latest(2, '24');
  await source.search('作品 / A & B', 3);
  assert.equal(requests[0], '/show/24--------2---.html');
  assert.equal(requests[1], '/search/' + encodeURIComponent('作品 / A & B') + '----------3---.html');
  assert.equal((await source.search('   ', 1)).length, 0);
  await assert.rejects(source.latest(0, '1'), /页码/);
  await assert.rejects(source.latest(1, '../'), /分类/);
});

test('Continue sends form bytes and reloads with the same session instead of treating the gate as an empty list', async () => {
  const source = extension(), calls = [];
  source.request = async (path, options) => {
    calls.push({ path, options });
    if (options.method === 'post') {
      const bytes = Buffer.from(new URLSearchParams(options.data).get('i'), 'base64');
      const key = [0x4e, 0x3f, 0xa9, 0xc2];
      const stamp = Array.from(bytes, (byte, index) => String.fromCharCode(byte ^ key[index % key.length])).join('');
      assert.match(stamp, /^\d{13}$/);
      assert.ok(Math.abs(Number(stamp) - Date.now()) < 5000);
      assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded; charset=UTF-8');
      return { code: 1 };
    }
    return calls.length === 1 ? gate : '<html><h1>Search results</h1></html>';
  };
  assert.match(await source.page('/search/test----------1---.html'), /Search results/);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].path, '/index.php/ajax/verify_check?type=search');
  assert.equal(calls[0].path, calls[2].path);
});

test('verification failures and changed protocols stop with a readable error and no retry loop', async () => {
  for (const reply of ['<html>unexpected</html>', { code: 0 }]) {
    const source = extension();
    let count = 0;
    source.request = async (_, options) => { count++; return options.method === 'post' ? reply : gate; };
    await assert.rejects(source.page('/show/1--------1---.html'), /验证未通过/);
    assert.equal(count, 2);
  }
  const source = extension();
  source.request = async (_, options) => options.method === 'post' ? { code: 1 } : gate;
  await assert.rejects(source.page('/show/1--------1---.html'), /限制访问/);
  await assert.rejects(source.continueAccess(gate.replace('0xa9', 'NaN')), /参数/);
  await assert.rejects(source.continueAccess(gate.replace('/index.php/ajax/verify_check?type=search', 'https://other.example/')), /方式已变化/);
});

test('directory preserves source order, joins long episode lists, excludes other works and sorts episode numbers numerically', () => {
  const source = extension();
  const result = source.parseDetail(`<html><h1>A &amp; B</h1>
    <img data-original="//covers.example/a.jpg" src="/load.gif">
    <span class="detail-content">完整介绍<br>第二段</span>
    <a href="#playlist3">天堂<span>152</span></a><a href="#playlist1">精品<span>152</span></a>
    <a href="/anime/abc123/play/1/1.html">第1集</a>
    <a href="/anime/abc123/play/3/51.html" title="第51集">51</a>
    <a href="${episode}" title="第01集">01</a><a href="${episode}">重复播放按钮</a>
    <a href="/anime/abc123/play/3/2.html">第02集</a>
    <a href="/anime/other/play/3/1.html">推荐作品</a></html>`, work);
  assert.equal(result.title, 'A & B');
  assert.equal(result.desc, '完整介绍\n第二段');
  assert.deepEqual(Array.from(result.episodes, group => group.title), ['天堂', '精品']);
  assert.deepEqual(Array.from(result.episodes[0].urls, item => item.url), [episode,
    '/anime/abc123/play/3/2.html', '/anime/abc123/play/3/51.html']);
  assert.equal(result.episodes[0].urls[0].name, '第01集');
  assert.throws(() => source.parseDetail('<html><h1>Empty work</h1></html>', work), /目录加载失败/);
});

test('watch retains the original HLS master URL for native parsing and preserves required headers', async () => {
  const source = extension();
  const url = 'https://media.example/master.m3u8?token=a&b=2';
  source.page = async () => config({ encrypt: 1, from: 'dyttm3u8', url: encodeURIComponent(url) });
  source.request = async (requested, options) => {
    assert.equal(requested, url);
    assert.equal(options.headers.Referer, origin + '/');
    assert.equal(options.headers.Origin, origin);
    assert.equal(options.netMode, 'direct');
    return '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nsmall/index.m3u8\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=200\n/large/index.m3u8\n';
  };
  const result = await source.watch(episode);
  assert.equal(result.type, 'hls');
  assert.equal(result.url, 'lavf://' + url);
  assert.equal(result.headers.Referer, origin + '/');
  assert.equal(result.netMode, 'direct');
  assert.match(result.headers['User-Agent'], /Chrome/);
});

test('plain and Base64-wrapped MP4 addresses do not require browser APIs', async () => {
  const source = extension();
  const url = 'https://media.example/a.mp4?token=a%2Fb';
  for (const encrypt of [0, 2]) {
    source.page = async () => config({ encrypt, from: 'mp4',
      url: encrypt ? Buffer.from(encodeURIComponent(url)).toString('base64') : url });
    assert.equal((await source.watch(episode)).url, url);
  }
});

test('expired, intermediary and invalid player URLs have clear errors without evaluating site scripts', async () => {
  const source = extension();
  source.page = async () => '<html><script>var player_aaaa={"url":(globalThis.executed=true)}</script></html>';
  await assert.rejects(source.watch(episode), /未找到播放地址/);
  source.page = async () => config({ encrypt: 1, url: 'intermediary-id_2', from: 'mp4' });
  await assert.rejects(source.watch(episode), /中转播放器/);
  source.page = async () => config({ encrypt: 1, url: '%ZZ', from: 'mp4' });
  await assert.rejects(source.watch(episode), /编码不正确/);
  source.page = async () => config({ encrypt: 0, url: 'https://media.example/bad.m3u8', from: 'm3u8' });
  source.request = async () => '<html>Not Found</html>';
  await assert.rejects(source.watch(episode), /未返回有效视频/);
  source.request = async () => { throw new Error('HTTP 404'); };
  await assert.rejects(source.watch(episode), /已失效/);
  await assert.rejects(source.watch('/anime/other.html'), /集数地址/);
  await assert.rejects(source.detail('https://wrong.example' + work), /作品地址/);
});


function appSource(handler) {
  const source = extension();
  source.getSetting = async () => null;
  source.setSetting = async () => {};
  source.grpcRequest = async options => {
    assert.match(options.endpoint, /^https:\/\/[^/]+:9091$/);
    assert.match(options.certificate, /BEGIN CERTIFICATE/);
    assert.equal(options.metadata.authorization, undefined);
    assert.equal(options.metadata['x-sign'], undefined);
    const request = source.protoRead(source.bytesBase64(options.data));
    return source.binaryBase64(await handler(options.method.split('/').pop(), request, source));
  };
  return source;
}

test('App protobuf handles Unicode, unknown fields and rejects truncated responses', () => {
  const source = extension();
  const decoded = source.protoRead(source.protobuf([[1, 2772], [2, '中文 🌸'], [100, 'new field']]));
  assert.equal(decoded[1][0], 2772);
  assert.equal(source.protoText(decoded, 2), '中文 🌸');
  assert.equal(source.protoText(decoded, 100), 'new field');
  assert.throws(() => source.protoRead([18, 10, 65]), /不完整/);
  assert.throws(() => source.protobuf([[1, -1]]), /无效/);
});

test('App pagination follows opaque cursors and stops at the final page', async () => {
  const requests = [];
  const source = appSource(async (method, data, p) => {
    assert.equal(method, 'ListVods');
    const cursor = p.protoText(data, 8); requests.push(cursor);
    const row = p.protobuf([[1, 2772], [2, '新宝可梦'], [3, 'https://cover.example/a.jpg']]);
    return p.protobuf([[2, row], [3, cursor ? '' : 'opaque:next'], [4, cursor ? 0 : 1]]);
  });
  assert.equal((await source.latest(1, '1'))[0].url, '/app/vod/2772');
  assert.equal((await source.latest(2, '1')).length, 1);
  assert.equal((await source.latest(3, '1')).length, 0);
  assert.deepEqual(requests, ['', 'opaque:next']);
  await assert.rejects(source.latest(10, '1'), /第一页/);
});

test('App detail preserves player names and binds every episode to its numeric ID', async () => {
  const source = appSource(async (method, data, p) => {
    assert.equal(method, 'GetVodDetail'); assert.equal(data[1][0], 2772);
    const episode = p.protobuf([[1, '第01集'], [2, 'unused'], [3, 1]]);
    const play = p.protobuf([[1, 3], [3, episode]]);
    const entry = p.protobuf([[1, '天堂'], [2, play]]);
    return p.protobuf([[1, p.protobuf([[1, 2772], [2, '新宝可梦'], [16, entry]])]]);
  });
  const detail = await source.detail('/app/vod/2772');
  assert.equal(detail.title, '新宝可梦');
  assert.equal(detail.episodes[0].title, '天堂');
  assert.equal(detail.episodes[0].urls[0].url, '/app/vod/2772/play/' + encodeURIComponent('天堂') + '/1.html');
  assert.equal(detail.episodes[0].urls[0].name, '第01集');
});

test('App play and danmaku use the same work and episode, converting milliseconds and styles', async () => {
  const source = appSource(async (method, data, p) => {
    assert.equal(data[1][0], 2772);
    if (method === 'GetVodPlayUrl') {
      assert.equal(p.protoText(data, 2), '天堂'); assert.equal(data[3][0], 1);
      return p.protobuf([[1, 'https://video.example/master.m3u8']]);
    }
    assert.equal(method, 'ListBullets'); assert.equal(p.protoText(data, 2), '1');
    assert.equal(data[3][0], 15000); assert.equal(data[4][0], 195000);
    const style = p.protobuf([[1, 'color_hex_fe0302'], [2, 'top']]);
    return p.protobuf([[1, p.protobuf([[3, 1550], [4, '弹幕 🌸'], [5, style]])]]);
  });
  const watch = await source.watch('/app/vod/2772/play/' + encodeURIComponent('天堂') + '/1.html');
  assert.equal(watch.url, 'lavf://https://video.example/master.m3u8');
  assert.equal(watch.danmaku.url, '2772:1');
  const rows = await source.danmaku(watch.danmaku.url, 15, 195);
  assert.deepEqual(Array.from(rows[0]), [1.55, 1, 0xfe0302, '', '弹幕 🌸']);
  await assert.rejects(source.danmaku('2772:1', 0, 1000), /无效/);
});

test('legacy bookmarks resolve by exact title; ambiguous matches are refused', async () => {
  let duplicates = false, searches = 0;
  const source = appSource(async (method, data, p) => {
    assert.equal(method, 'SearchVods'); searches++;
    const exact = p.protobuf([[1, 2772], [2, '新宝可梦']]);
    return p.protobuf([[2, exact], [2, duplicates ? exact : p.protobuf([[1, 3000], [2, '新宝可梦特别篇']])]]);
  });
  assert.equal(await source.appId(work, { title: '新宝可梦' }), 2772);
  assert.equal(await source.appId(episode, { title: '新宝可梦' }), 2772);
  assert.equal(searches, 1);
  duplicates = true;
  await assert.rejects(source.appId('/anime/another.html', { title: '新宝可梦' }), /唯一/);
});
