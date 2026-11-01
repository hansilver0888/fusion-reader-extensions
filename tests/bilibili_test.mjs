import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const script = fs.readFileSync(new URL('../sources/bilibili.js', import.meta.url), 'utf8');
const runtime = fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8');
const bvid = 'BV1aa411c7mD';
const cookie = 'SESSDATA=fixture%2Csession; DedeUserID=12345';
const identity = { isLogin: true, mid: 12345, uname: '测试用户' };
const view = { bvid, aid: 1001, title: '分P示例', desc: '原创测试描述', pic: '//images.example/cover.jpg', owner: { name: '测试作者' },
  pages: [{ page: 1, cid: 2001, part: '上集' }, { page: 2, cid: 2002, part: '下集' }] };
const clone = value => JSON.parse(JSON.stringify(value));
const ok = data => ({ code: 0, data });

function source() {
  const context = vm.createContext({ sendMessage() {} });
  vm.runInContext(runtime, context);
  vm.runInContext(script.replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.package = 'bilibili'; source.webSite = 'https://www.bilibili.com';
  let credential = null;
  source.getCredential = async () => credential;
  source.setCredential = async value => { credential = value; };
  source.request = async () => { throw new Error('Unexpected request'); };
  source.secret = () => credential;
  return source;
}

async function loggedIn() {
  const result = source();
  const raw = JSON.stringify({ version: 1, cookie });
  await result.setCredential(raw);
  await result.credential();
  result._identity = identity; result._identityAt = Date.now();
  return result;
}

async function qr(source, state = 86101, extra = {}) {
  source.request = async (url, options) => {
    const uri = new URL(url);
    assert.equal(uri.origin, 'https://passport.bilibili.com');
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.responseMetadata, true);
    assert.equal(options.retry, false);
    if (uri.pathname.endsWith('/generate')) return ok({ url: 'https://account.bilibili.com/h5/account-h5/auth/scan-web?key=fixture', qrcode_key: 'fixture-key' });
    assert.equal(uri.searchParams.get('qrcode_key'), 'fixture-key');
    return ok({ code: state, ...extra });
  };
  return source.beginLogin();
}

test('declares independent minimum version, QR login and video-wide comments', () => {
  assert.match(script, /@minAppVersion\s+1\.4\.5/);
  assert.match(script, /@login\s+qr/);
  assert.match(script, /@comments\s+work/);
  assert.doesNotMatch(script, /console\.(?:log|warn|error)\(/);
});

test('official QR challenge returns display data while its polling key stays internal', async () => {
  const src = source(), result = await qr(src);
  assert.equal(result.pollInterval, 3); assert.equal(result.expiresIn, 180);
  assert.equal(result.qrcode_key, undefined);
  assert.equal((await src.pollLogin()).status, 'waiting');
  await qr(src, 86090); assert.equal((await src.pollLogin()).status, 'scanned');
  await qr(src, 86038); assert.equal((await src.pollLogin()).status, 'expired');
  assert.equal(src.secret(), null);
});

test('closing a QR page prevents a late scan result from saving credentials', async () => {
  const src = source(); await qr(src);
  let release; const gate = new Promise(resolve => { release = resolve; });
  src.request = async () => { await gate; return ok({ code: 0, url: 'https://www.bilibili.com/?SESSDATA=fixture' }); };
  const result = src.pollLogin(); await src.cancelLogin(); release();
  assert.equal((await result).status, 'cancelled'); assert.equal(src.secret(), null);
});

test('successful login verifies the account before protected storage and returns no cookies to UI', async () => {
  const src = source(); await qr(src);
  src.request = async (url, options) => {
    if (url.includes('/qrcode/poll')) return { body: ok({ code: 0, url: 'https://www.bilibili.com/?SESSDATA=url-cookie&DedeUserID=12345' }),
      headers: { 'set-cookie': ['SESSDATA=fixture%2Csession; Path=/; HttpOnly', 'bili_jct=fixture-csrf; Path=/'] } };
    assert.equal(new URL(url).pathname, '/x/web-interface/nav');
    assert.match(options.headers.Cookie, /SESSDATA=fixture%2Csession/);
    assert.equal(src.secret(), null);
    return ok(identity);
  };
  const result = await src.pollLogin();
  assert.deepEqual(clone(result), { status: 'success' });
  assert.match(JSON.parse(src.secret()).cookie, /bili_jct=fixture-csrf/);
  assert.deepEqual(clone(await src.loginStatus()), { loggedIn: true, username: identity.uname });
  await src.logout(); assert.equal(src.secret(), null);
  assert.equal((await src.loginStatus()).loggedIn, false);
});

test('cancellation during credential storage rolls back its own session', async () => {
  const src = source(); await qr(src);
  src.request = async url => url.includes('/qrcode/poll') ? ok({ code: 0, url: 'https://www.bilibili.com/?SESSDATA=fixture' }) : ok(identity);
  let stored = null, enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  src.getCredential = async () => stored;
  src.setCredential = async value => { stored = value; if (value) { enter(); await gate; } };
  const poll = src.pollLogin(); await entered; await src.cancelLogin(); release();
  assert.equal((await poll).status, 'cancelled'); assert.equal(stored, null);
});

test('callback domains and header contents are checked without following redirects', () => {
  const src = source();
  assert.throws(() => src.loginCookie('https://evil.example/?SESSDATA=fixture', {}), /未获取/);
  assert.throws(() => src.loginCookie('https://www.bilibili.com/?SESSDATA=x', { 'set-cookie': ['SESSDATA=x\r\nInjected: value'] }), /未获取/);
  assert.equal(src.loginCookie('https://www.bilibili.com/?SESSDATA=fixture%2Csession&DedeUserID=12345&evil=ignored', {}), cookie);
});

test('network faults keep a saved session; a definite logged-out response clears it', async () => {
  const src = await loggedIn(); src._identityAt = 0;
  src.request = async () => { throw new Error('private-cookie-echo'); };
  await assert.rejects(src.loginStatus(), error => !error.message.includes('private-cookie-echo'));
  assert.ok(src.secret());
  src.request = async () => ({ code: -101 });
  assert.equal((await src.loginStatus()).loggedIn, false); assert.equal(src.secret(), null);
});

test('folder and discovery requests coalesce folder reads and use only the logged-in UID', async () => {
  const src = await loggedIn(), calls = [];
  src.request = async (url, options) => {
    const uri = new URL(url); calls.push(uri); assert.equal(options.headers.Cookie, cookie);
    if (uri.pathname.includes('list-all')) { assert.equal(uri.searchParams.get('up_mid'), '12345'); return ok({ list: [{ id: 10, title: '默认收藏夹' }, { id: 20, title: '课程' }] }); }
    assert.equal(uri.searchParams.get('media_id'), '10');
    return ok({ medias: [{ type: 2, bvid, title: '示例视频', cover: '//images.example/a.jpg', page: 2, upper: { name: '作者' } }], has_more: false });
  };
  const [channels, items] = await Promise.all([src.channels(), src.latest(1)]);
  assert.equal(channels.length, 2); assert.equal(items[0].url, '/video/' + bvid);
  assert.equal(items[0].cover, 'https://images.example/a.jpg');
  assert.equal(calls.filter(call => call.pathname.includes('list-all')).length, 1);
  assert.equal((await src.latest(2)).length, 0); assert.equal(calls.length, 2);
  await assert.rejects(src.latest(1, '999'), /不存在/);
});

test('search stays inside personal favorites, and unsupported media pages do not hide later videos', async () => {
  const src = await loggedIn(), pages = [];
  src.request = async url => {
    const uri = new URL(url);
    if (uri.pathname.includes('list-all')) return ok({ list: [{ id: 10, title: '示例' }] });
    const pn = Number(uri.searchParams.get('pn')); pages.push(pn);
    if (uri.searchParams.get('keyword')) { assert.equal(uri.searchParams.get('type'), '1'); return ok({ medias: [], has_more: false }); }
    if (pn === 1) return ok({ medias: [{ type: 12, title: '非视频' }], has_more: true });
    return ok({ medias: [{ type: 2, bvid, title: '视频' }], has_more: pn === 2 });
  };
  assert.equal((await src.latest(1)).length, 1); assert.equal((await src.latest(2)).length, 1);
  assert.deepEqual(pages, [1, 2, 3]);
  await src.search('收藏关键词', 1);
  await assert.rejects(src.latest(0), /页码/);
});

test('detail groups each actual P with a stable CID and refuses unrelated domains', async () => {
  const src = await loggedIn(); src.request = async () => ok(view);
  const result = await src.detail('/video/' + bvid);
  assert.deepEqual(Array.from(result.episodes[0].urls, part => part.name), ['P1 上集', 'P2 下集']);
  assert.match(result.episodes[0].urls[1].url, /cid=2002&p=2/);
  assert.equal(result.cover, 'https://images.example/cover.jpg');
  await assert.rejects(src.detail('https://evil.example/video/' + bvid), /地址/);
});

test('DASH chooses an allowed AVC stream, preserves separate audio and never sends API cookies to CDNs', async () => {
  const src = await loggedIn();
  src.request = async (url, options) => {
    const uri = new URL(url); assert.equal(options.headers.Cookie, cookie);
    if (uri.pathname.endsWith('/view')) return ok(view);
    assert.equal(uri.pathname, '/x/player/playurl'); assert.equal(uri.searchParams.get('cid'), '2002');
    return ok({ quality: 64, accept_quality: [80, 64, 32], accept_description: ['1080P', '720P', '480P'], dash: {
      video: [{ id: 80, baseUrl: 'https://video.example/not-granted.m4s', height: 1080, codecid: 7 },
        { id: 64, baseUrl: 'https://video.example/hevc.m4s', height: 720, codecid: 12 },
        { id: 64, baseUrl: 'https://video.example/avc.m4s', height: 720, codecid: 7 },
        { id: 32, baseUrl: 'https://video.example/low.m4s', height: 480, codecid: 7 }],
      audio: [{ baseUrl: 'https://video.example/audio.m4s', codecs: 'mp4a.40.2', bandwidth: 128000 }],
    } });
  };
  const result = await src.watch('/video/' + bvid + '?cid=2002&p=2');
  assert.equal(result.url, 'https://video.example/avc.m4s');
  assert.equal(result.audioUrl, 'https://video.example/audio.m4s');
  assert.deepEqual(Array.from(result.qualities, quality => quality.label), ['720P', '480P']);
  assert.equal(result.headers.Cookie, undefined);
  assert.equal(result.danmaku.format, 'bilibili'); assert.match(result.danmaku.url, /2002\.xml$/);
  await assert.rejects(src.watch('/video/' + bvid + '?cid=9999'), /分 P/);
});

test('single progressive videos work, and missing DASH audio fails clearly', async () => {
  const src = await loggedIn(); let playback = { durl: [{ url: 'https://video.example/clip.mp4' }] };
  src.request = async url => ok(url.includes('/view?') ? view : playback);
  assert.equal((await src.watch('/video/' + bvid)).url, 'https://video.example/clip.mp4');
  playback = { dash: { video: [{ id: 64, baseUrl: 'https://video.example/mute.m4s' }], audio: [] } };
  await assert.rejects(src.watch('/video/' + bvid), /音轨/);
});

function reply(id, extra = {}) { return { rpid_str: id, ctime: 1700000000, like: 3, rcount: 2,
  member: { uname: '测试用户' }, content: { message: '原创测试评论\n第二行', pictures: [{ img_src: '//images.example/comment.png' }] }, ...extra }; }

test('work comments retain large string IDs, pinned deduplication, images and real reply pagination', async () => {
  const src = await loggedIn(), large = '9007199254740993123', calls = [];
  src.request = async url => {
    const uri = new URL(url); calls.push(uri);
    if (uri.pathname.endsWith('/view')) return ok(view);
    if (uri.pathname.endsWith('/reply/reply')) { assert.equal(uri.searchParams.get('root'), large); assert.equal(uri.searchParams.get('pn'), '2'); return ok({ replies: [reply('99')], page: { count: 21 } }); }
    return ok({ top: { upper: reply(large) }, replies: [reply(large), ...Array.from({ length: 19 }, (_, i) => reply(String(i + 1)))], page: { count: 41 } });
  };
  const page = await src.comments('/video/' + bvid, '', 1);
  assert.equal(page.comments.length, 20); assert.equal(page.comments[0].id, large);
  assert.equal(page.comments[0].pinned, true); assert.equal(page.hasMore, true);
  assert.equal(page.comments[0].images[0], 'https://images.example/comment.png');
  assert.match(page.comments[0].text, /第二行/);
  const children = await src.comments('/video/' + bvid, '', 2, large);
  assert.equal(children.comments.length, 1); assert.equal(children.hasMore, false);
});

test('empty favorites/comments and denied/malformed responses are distinct', async () => {
  const src = await loggedIn(); src.request = async () => ok({ list: [] });
  assert.equal((await src.latest(1)).length, 0);
  src.request = async url => url.includes('/view?') ? ok(view) : ok({ replies: null, page: { count: 0 } });
  assert.equal((await src.comments('/video/' + bvid, '', 1)).comments.length, 0);
  src.request = async () => ({ code: -403, message: 'private-response' });
  await assert.rejects(src.api('/fixture'), error => !error.message.includes('private-response'));
  assert.ok(src.secret());
  src.request = async () => '<html>blocked</html>';
  await assert.rejects(src.api('/fixture'), /有效数据/);
});


test('combined cookie headers preserve multiple session fields without treating Expires as a cookie', () => {
  const src = source();
  const result = src.loginCookie('', { 'set-cookie': 'SESSDATA=fixture%2Csession; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Path=/, DedeUserID=12345; Path=/, bili_jct=csrf; Path=/' });
  assert.equal(result, cookie + '; bili_jct=csrf');
});

test('cancelled old login cannot erase a separately saved newer session', async () => {
  const src = source(); await qr(src);
  src.request = async url => url.includes('/qrcode/poll') ? ok({ code: 0, url: 'https://www.bilibili.com/?SESSDATA=fixture' }) : ok(identity);
  let stored = null, enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  src.getCredential = async () => stored;
  src.setCredential = async value => { stored = value; enter(); await gate; };
  const poll = src.pollLogin(); await entered; await src.cancelLogin();
  stored = 'newer-session'; release();
  assert.equal((await poll).status, 'cancelled'); assert.equal(stored, 'newer-session');
});
