// Optional live smoke test; not run by repository CI.
//
// missav answers every page and api path with a Cloudflare challenge unless the
// request carries a session that already passed it, so this script needs the
// browser's cookie (and the matching user agent):
//
//   MISSAV_COOKIE="cf_clearance=…; …" MISSAV_USER_AGENT="Mozilla/5.0 …" \
//     node tools/check_missav.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const UA = process.env.MISSAV_USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const COOKIE = process.env.MISSAV_COOKIE || '';

const context = vm.createContext({ sendMessage() {}, Date });
vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../sources/missav.js', import.meta.url), 'utf8')
  .replace('export default class', 'globalThis.Source = class'), context);
const source = vm.runInContext('new Source()', context);
source.webSite = 'https://missav.ai';
source.getSetting = async (key) => ({ cookie: COOKIE, user_agent: UA, host: '' }[key] || '');
source.setSetting = async () => {};
source.sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 1000)));

let requests = 0;
source.request = async (url, options = {}) => {
  requests++;
  const response = await fetch(url, { headers: options.headers || {}, signal: AbortSignal.timeout(40000) });
  assert.ok(response.status < 400, `${url} answered ${response.status}`);
  return response.text();
};

let entry;
try {
  entry = await source.entry();
} catch (error) {
  console.error(String(error.message));
  console.error('\n提示：把瀏覽器打開 missav 後（已通過驗證）的整段 Cookie 放進 MISSAV_COOKIE，'
    + '並用同一個瀏覽器的 UA 放進 MISSAV_USER_AGENT。');
  process.exit(2);
}

const channels = await source.channels();
assert.ok(channels.length > 0, 'channels must not be empty');

const first = await source.latest(1, '');
assert.ok(first.length > 0, 'the newest feed must return items');
const second = await source.latest(2, '');
assert.ok(second.length > 0, 'page 2 must return items');
assert.notEqual(first[0].url, second[0].url, 'page 2 must differ from page 1');

const release = await source.latest(1, 'release');
assert.ok(release.length > 0, 'the release feed must return items');

const keyword = first[0].title.split(/\s+/)[0];
const search = await source.search(keyword, 1);
assert.ok(search.length > 0, `search for ${keyword} must return items`);

const detail = await source.detail(first[0].url);
assert.ok(detail.title, 'detail must carry a title');
assert.ok(detail.cover.startsWith('https://'), 'cover must be a url');

const stream = await source.watch(first[0].url);
assert.ok(['hls', 'mp4'].includes(stream.type), 'watch must return a stream');
// The media host has its own Cloudflare policy, so a rejected sample is
// reported instead of failing the whole check.
const media = await fetch(stream.url, {
  headers: { 'User-Agent': UA, Referer: stream.headers?.Referer || entry + '/' },
  signal: AbortSignal.timeout(30000),
}).catch(() => null);
const playlist = media ? await media.text() : '';
const playable = Boolean(media && media.status === 200 && playlist.includes('#EXTM3U'));

console.log(JSON.stringify({
  ok: playable,
  entry,
  language: await source.language(),
  channels: channels.length,
  firstPage: first.length,
  secondPage: second.length,
  releasePage: release.length,
  keyword,
  searchMatches: search.length,
  detail: { title: detail.title, cover: detail.cover.slice(0, 60) },
  stream: {
    type: stream.type,
    url: stream.url,
    status: media ? media.status : 0,
    playlist: playable ? (playlist.match(/\.ts|\.m4s/g) || []).length : 0,
    note: playable ? '' : '播放域名拒絕了此客戶端；頁面與目錄已可用',
  },
  requests,
}, null, 2));

