// Optional live smoke test; not run by repository CI.
// This source reads the site through the public r.jina.ai reader, so the check
// exercises that route end to end: listing, search, detail, playable url.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const context = vm.createContext({ sendMessage() {}, Date });
vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../sources/hanime1jina.js', import.meta.url), 'utf8')
  .replace('export default class', 'globalThis.Source = class'), context);
const source = vm.runInContext('new Source()', context);
source.webSite = 'http://hanime1.me';
source.getSetting = async () => '';
source.setSetting = async () => {};
source.sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 900)));

let requests = 0;
source.request = async (url, options = {}) => {
  requests++;
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, ...(options.headers || {}) },
    signal: AbortSignal.timeout(90000),
  });
  return response.text();
};

const channels = await source.channels();
const home = await source.latest(1, '0');
assert.ok(home.length > 0, 'the home feed must return items');

const anime = await source.latest(1, '1');
assert.ok(anime.length > 0, 'the genre feed must return items');

const keyword = '鬼';
const found = await source.search(keyword, 1);
assert.ok(found.length > 0, 'search must return items');

const detail = await source.detail(found[0].url);
assert.ok(detail.title, 'detail must carry a title');
assert.ok(detail.cover.startsWith('https://'), 'cover must be a url');

const stream = await source.watch(detail.episodes[0].urls[0].url);
assert.ok(['mp4', 'hls'].includes(stream.type), 'watch must return a stream');

const media = await fetch(stream.url, {
  headers: { 'User-Agent': UA, Range: 'bytes=0-2047' },
  signal: AbortSignal.timeout(60000),
});
const head = Buffer.from(await media.arrayBuffer());
const isMp4 = head.slice(4, 8).toString('latin1') === 'ftyp';

console.log(JSON.stringify({
  ok: media.status < 400 && (isMp4 || stream.type === 'hls'),
  source: 'hanime1jina',
  channels: channels.length,
  homeFeed: home.length,
  genreFeed: anime.length,
  keyword,
  searchMatches: found.length,
  detail: { title: detail.title.slice(0, 50), cover: detail.cover.slice(0, 60) },
  stream: { type: stream.type, host: stream.url.split('/')[2], status: media.status, isMp4, headBytes: head.length },
  requests,
}, null, 2));
