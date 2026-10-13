import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

function extension() {
  const context = vm.createContext({ sendMessage() {} });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/guazi.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'https://gz360.tv';
  return source;
}

function encrypt(data) {
  const cipher = crypto.createCipheriv('aes-128-cbc', '181cc88340ae5b2b', '4423d1e2773476ce');
  return Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]).toString('hex');
}

function decrypt(hex) {
  const cipher = crypto.createDecipheriv('aes-128-cbc', '181cc88340ae5b2b', '4423d1e2773476ce');
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(hex, 'hex')), cipher.final()]).toString('utf8'));
}

test('standalone codec matches Node AES-CBC for Chinese, emoji, empty objects and aligned blocks', () => {
  const source = extension();
  for (const data of [{}, { keywords: '示例 🎬 / A&B', page: 2 }, { text: 'x'.repeat(53) }, ['作品', '😀', '\u0000']]) {
    const encoded = source.encrypt(JSON.stringify(data));
    assert.equal(encoded, encrypt(data));
    assert.deepEqual(JSON.parse(JSON.stringify(source.decrypt(encoded))), data);
  }
});

test('invalid hex, truncated blocks and invalid zero padding fail clearly', () => {
  const source = extension();
  for (const value of ['', 'zz', '00', '0'.repeat(31), '<html></html>']) {
    assert.throws(() => source.decrypt(value), /格式/);
  }
  const cipher = crypto.createCipheriv('aes-128-cbc', '181cc88340ae5b2b', '4423d1e2773476ce');
  cipher.setAutoPadding(false);
  const invalid = Buffer.concat([cipher.update(Buffer.alloc(16)), cipher.final()]).toString('hex');
  assert.throws(() => source.decrypt(invalid), /解码/);
});

test('API sends encrypted JSON to the observed production host and coalesces identical in-flight reads', async () => {
  const source = extension();
  let count = 0;
  source.request = async (url, options) => {
    count++;
    assert.equal(url, 'https://haiwaiapi.1fc8ab0.com/Pc/Search/GetConditionList');
    assert.equal(options.method, 'post');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.headers.Origin, 'https://gz360.tv');
    assert.equal(options.headers.Referer, 'https://gz360.tv/');
    assert.deepEqual(decrypt(JSON.parse(options.data).params), { keywords: '示例 & 🎬', page: 1 });
    await Promise.resolve();
    return JSON.stringify({ code: 200, data: encrypt({ total: 0, list: [] }) });
  };
  const parameters = { keywords: '示例 & 🎬', page: 1 };
  const results = await Promise.all([source.api('/Search/GetConditionList', parameters), source.api('/Search/GetConditionList', parameters)]);
  assert.equal(count, 1);
  assert.equal(results[0].total, 0);
  await source.api('/Search/GetConditionList', parameters);
  assert.equal(count, 2);
});

test('API errors, verification pages and missing payloads are not mistaken for an empty catalogue', async () => {
  const source = extension();
  for (const reply of [{ code: 403, msg: '访问受限' }, '<html>verify</html>', { code: 200 }, { code: 200, data: 'new protocol' }]) {
    source.request = async () => reply;
    await assert.rejects(source.api('/Search/GetCondition'), /受限|未返回|不完整|格式/);
    assert.equal(source._pending.size, 0);
  }
  source.request = async () => { throw new Error('offline'); };
  await assert.rejects(source.api('/Search/GetCondition'), /offline/);
  assert.equal(source._pending.size, 0);
});

test('channels use the actual main columns, deduplicate them and ignore ad sections and invalid IDs', async () => {
  const source = extension();
  source.api = async () => ({ column: [{ name: '全部', value: 0 }, { name: '电影', value: 1 },
    { name: '动漫', value: '4' }, { name: '重复', value: 4 }, { name: '错误', value: '../' }], banner: [{ name: '广告' }] });
  assert.deepEqual(Array.from(await source.channels(), c => [c.title, c.key]), [['最新', ''], ['电影', '1'], ['动漫', '4']]);
});

test('list and keyword searches paginate independently using the website parameter names', async () => {
  const source = extension(), calls = [];
  source.api = async (path, data) => { calls.push([path, data]); return { list: [] }; };
  await source.latest(2, '4');
  await source.search('  示例 / A&B 🎬  ', 3);
  assert.equal(calls[0][0], '/Search/GetConditionList');
  assert.equal(calls[0][1].tid, 4);
  assert.equal(calls[0][1].page, 2);
  assert.equal(calls[0][1].sort, 'd_addtime');
  assert.equal(calls[1][1].keywords, '示例 / A&B 🎬');
  assert.equal(calls[1][1].page, 3);
  assert.equal((await source.search(' ', 1)).length, 0);
  await assert.rejects(source.latest(0, '1'), /页码/);
  await assert.rejects(source.latest(1, '../'), /分类/);
  assert.equal(calls.length, 2);
});

test('list parsing keeps stable work IDs, rejects invalid rows and accepts both cover field layouts', () => {
  const source = extension();
  const result = source.items({ list: [{ vod_id: '7', vod_name: '<b>A &amp; B</b>', vod_pic: '//images.example/a.jpg', new_continue: '第2集' },
    { vod_id: 7, vod_name: '重复' }, { vod_id: 8, c_name: '另一作品', c_pic: 'https://images.example/b.jpg' },
    { vod_id: '../9', vod_name: '错误' }, { vod_id: 9, vod_name: '' }] });
  assert.equal(result.length, 2);
  assert.equal(result[0].title, 'A & B');
  assert.equal(result[0].cover, 'https://images.example/a.jpg');
  assert.equal(result[0].url, '/videoDetail/7');
  assert.equal(result[0].update, '第2集');
  assert.throws(() => source.items({}), /列表/);
  assert.throws(() => source.items({ list: [{ ad: 'not a work' }] }), /格式/);
});

test('directory sorts episode numbers numerically, keeps identifiers and excludes recommendations and preview videos', async () => {
  const source = extension();
  source.api = async (path, data) => path.endsWith('GetVodInfo')
    ? { vodInfo: { vod_id: data.vod_id, vod_name: '示例', pic: 'https://images.example/a.jpg',
      vod_use_content: '<p>第一段</p>第二段<script>ignored()</script>', pre_video: 'https://ads.example/ad.mp4' }, recommendVod: [{ vod_id: 999 }] }
    : { total_vod_vurl: 3, urls: [{ name: '10', vurl_id: 110, sort: 10, url: 'https://media.example/10.m3u8' },
      { name: '2', vurl_id: 102, sort: 2 }, { name: '1', vurl_id: 101, sort: 1 }] };
  const result = await source.detail('/videoDetail/7');
  assert.equal(result.desc, '第一段\n第二段');
  assert.deepEqual(Array.from(result.episodes[0].urls, e => e.url), ['/videoDetail/7?vurl=101', '/videoDetail/7?vurl=102', '/videoDetail/7?vurl=110']);
  await assert.rejects(source.detail('https://other.example/videoDetail/7'), /无效/);
});

test('server-capped episode lists load the complete remaining catalogue instead of returning just the first page', async () => {
  const source = extension(), calls = [];
  source.api = async (_, data) => {
    calls.push(data);
    const count = data.pageSize === 0 ? 2 : 205;
    const start = data.pageSize === 0 ? 0 : (data.page - 1) * data.pageSize;
    return { total_vod_vurl: 205, urls: Array.from({ length: Math.min(count, 205 - start, data.pageSize || 2) }, (_, i) => ({ vurl_id: start + i + 1, sort: start + i + 1 })) };
  };
  assert.equal((await source.episodes('7')).length, 205);
  assert.deepEqual(Array.from(calls, x => [x.page, x.pageSize]), [[1, 0], [1, 100], [2, 100], [3, 100]]);
  assert.equal((await source.episodes('7')).length, 205);
  assert.equal(calls.length, 4);
});

test('incomplete or empty directories and wrong work metadata fail explicitly', async () => {
  const source = extension();
  source.api = async () => ({ total_vod_vurl: 4, urls: [{ vurl_id: 1 }] });
  await assert.rejects(source.episodes('7'), /未完整/);
  source.api = async () => ({ total_vod_vurl: 0, urls: [] });
  await assert.rejects(source.episodes('7'), /暂无/);
  source.api = async path => path.endsWith('GetVodInfo') ? { vodInfo: { vod_id: '8', vod_name: '另一作品' } }
    : { urls: [{ vurl_id: 1 }] };
  await assert.rejects(source.detail('/videoDetail/7'), /对应作品/);
});

test('watch refreshes expired cached URLs and retains HLS query parameters and the website media headers', async () => {
  const source = extension();
  source._playLists.set('7', { time: Date.now() - 20001, rows: [{ vurl_id: 1, url: 'https://media.example/expired.m3u8' }] });
  source.api = async () => ({ urls: [{ vurl_id: 1, isApp: false, url: 'https://media.example/MASTER.M3U8?token=a%2Fb&sign=c' }] });
  const result = await source.watch('/videoDetail/7?vurl=1');
  assert.equal(result.type, 'hls');
  assert.equal(result.url, 'https://media.example/MASTER.M3U8?token=a%2Fb&sign=c');
  assert.equal(result.headers.Origin, 'https://gz360.tv');
  assert.equal(result.headers.Referer, undefined); // The website declares no-referrer.
});

test('watch respects official-App-only episodes and rejects missing entries, unsafe URLs and invalid episode links', async () => {
  const source = extension();
  source.episodes = async () => [{ vurl_id: 1, isApp: true, url: 'https://media.example/a.mp4' },
    { vurl_id: 2, isApp: 'false', url: 'https://media.example/b.mp4' }, { vurl_id: 3, url: 'javascript:alert(1)' }];
  await assert.rejects(source.watch('/videoDetail/7?vurl=1'), /官方 App/);
  assert.equal((await source.watch('/videoDetail/7?vurl=2')).type, 'mp4');
  await assert.rejects(source.watch('/videoDetail/7?vurl=3'), /可用视频/);
  await assert.rejects(source.watch('/videoDetail/7?vurl=999'), /目录已变化/);
  await assert.rejects(source.watch('/videoDetail/7?episode=1'), /分集地址/);
  assert.equal(source.httpUrl('https://user:pass@example.com/video.mp4'), '');
});

test('work comments ignore the repeated ID-less notice, map public fields and deduplicate IDs', async () => {
  const source = extension();
  source.api = async (path, parameters) => {
    assert.equal(path, '/Resource/VodComment');
    assert.deepEqual(JSON.parse(JSON.stringify(parameters)), { vod_id: '7', pageSize: '10', page: '1', token: '' });
    return { total: 12, list: [{ id: '', content: '网站公告与外链' },
      { id: '11', vod_id: '7', app_user: { username: '读者 &amp; A' }, content: '<p>作品讨论</p><img src="//images.example/a.jpg">',
        like: '3', add_time: '1760000000', state: 'NONE', children: [] },
      { id: '11', vod_id: '7', content: '重复' }, { id: '12', vod_id: '99', content: '其他作品' }] };
  };
  const page = await source.comments('/videoDetail/7', '/videoDetail/7?vurl=1', 1);
  assert.equal(page.comments.length, 1);
  assert.equal(page.comments[0].username, '读者 & A');
  assert.equal(page.comments[0].text, '作品讨论');
  assert.equal(page.comments[0].likes, 3);
  assert.equal(page.comments[0].time, new Date(1760000000000).toISOString());
  assert.deepEqual(Array.from(page.comments[0].images), ['https://images.example/a.jpg']);
  assert.equal(page.hasMore, true);
  assert.equal(page.total, 12);
});

test('comment pagination ignores notices when determining the last page and an actually empty work', async () => {
  const source = extension();
  source.api = async (_, parameters) => parameters.vod_id === '8' ? { total: 0, list: [{ id: '', content: '公告' }] }
    : { total: 261, list: [{ id: '', content: '公告' }, { id: '99', vod_id: '7', content: '最后一条评论' }] };
  const last = await source.comments('/videoDetail/7', null, 27);
  assert.equal(last.comments.length, 1);
  assert.equal(last.hasMore, false);
  const empty = await source.comments('/videoDetail/8', null, 1);
  assert.equal(empty.comments.length, 0);
  assert.equal(empty.hasMore, false);
});

test('replies use the correct work and parent, with independent pagination and no write or reply API calls', async () => {
  const source = extension();
  let calls = 0;
  source.api = async path => {
    calls++;
    assert.equal(path, '/Resource/VodComment');
    return { total: 1, list: [{ id: 11, vod_id: '7', content: '主评论',
      children: [...Array.from({ length: 25 }, (_, i) => ({ id: i + 100, vod_id: '7', parent_id: 11, content: '回复 @读者：' + i })),
        { id: 100, vod_id: '7', parent_id: 11, content: '重复' }, { id: 200, vod_id: '7', parent_id: 99, content: '另一主题' }] }] };
  };
  const root = await source.comments('/videoDetail/7', null, 1);
  assert.equal(root.comments[0].replyCount, 25);
  const first = await source.comments('/videoDetail/7', null, 1, '11');
  const second = await source.comments('/videoDetail/7', null, 2, '11');
  assert.equal(first.comments.length, 20);
  assert.equal(first.hasMore, true);
  assert.equal(second.comments.length, 5);
  assert.equal(second.hasMore, false);
  assert.match(first.comments[0].text, /^回复 @读者：/);
  assert.equal(calls, 1);
  await assert.rejects(source.comments('/videoDetail/8', null, 1, '11'), /刷新/);
  await assert.rejects(source.comments('/videoDetail/7', '/videoDetail/8?vurl=1', 1), /组合/);
  await assert.rejects(source.comments('/videoDetail/7', null, 1, '../11'), /编号/);
});

test('rapid refreshes reuse successful comment pages; expired replies refresh their parent page', async () => {
  const source = extension();
  let calls = 0;
  source.api = async () => { calls++; return { total: 1, list: [{ id: '11', vod_id: '7', content: '主评论',
    children: [{ id: 100 + calls, parent_id: 11, content: '新回复' }] }] }; };
  await source.comments('/videoDetail/7', null, 1);
  await source.comments('/videoDetail/7', null, 1);
  assert.equal(calls, 1);
  source._commentPages.get('7:1').time -= 15000;
  source._commentThreads.get('7:11').time -= 15000;
  const replies = await source.comments('/videoDetail/7', null, 1, '11');
  assert.equal(calls, 2);
  assert.equal(replies.comments[0].id, '102');
});

test('malformed and repeating comment pages produce an error instead of empty success or endless loading', async () => {
  const source = extension();
  for (const data of [{}, { total: 1 }, { list: [], total: 'invalid' }, { list: [{ id: '', content: '公告' }], total: 2 }]) {
    source.api = async () => data;
    await assert.rejects(source.comments('/videoDetail/7', null, 1), /不完整|未返回/);
  }
  source.api = async () => ({ total: 100, list: [{ id: '11', vod_id: '7', content: '评论' }] });
  await source.comments('/videoDetail/7', null, 1);
  await assert.rejects(source.comments('/videoDetail/7', null, 2), /重复/);
});

test('an expired parent that disappeared does not return stale replies', async () => {
  const source = extension();
  source.api = async () => ({ total: 1, list: [{ id: '11', vod_id: '7', children: [{ id: '100', parent_id: '11', content: '旧回复' }] }] });
  await source.comments('/videoDetail/7', null, 1);
  source._commentPages.get('7:1').time -= 15000;
  source._commentThreads.get('7:11').time -= 15000;
  source.api = async () => ({ total: 0, list: [{ id: '', content: '公告' }] });
  await assert.rejects(source.comments('/videoDetail/7', null, 1, '11'), /已变化/);
});
