// Optional live smoke test; not run by repository CI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const context = vm.createContext({ sendMessage() {}, Date });
vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../sources/xhamster.js', import.meta.url), 'utf8')
  .replace('export default class', 'globalThis.Source = class'), context);
const source = vm.runInContext('new Source()', context);
source.webSite = 'https://xhamster.com';
source.getSetting = async () => '';
source.setSetting = async () => {};
source.sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 1000)));

let requests = 0;
source.request = async (url, options = {}) => {
  requests++;
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, ...(options.headers || {}) },
    signal: AbortSignal.timeout(40000),
  });
  assert.ok(response.status < 400, `${url} answered ${response.status}`);
  return response.text();
};

const grab = async (url, extra) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://xhamster.com/', ...(extra || {}) },
    signal: AbortSignal.timeout(40000),
  });
  const text = await response.text();
  return { status: response.status, text };
};

const channels = await source.channels();
const first = await source.latest(1, 'categories/japanese');
assert.ok(first.length > 0, 'the japanese feed must return items');
const second = await source.latest(2, '');
assert.ok(second.length > 0, 'page two must return items');
assert.notEqual(first[0].url, second[0].url, 'page two must differ');

const uncensored = await source.latest(1, 'categories/uncensored');
assert.ok(uncensored.length > 0, 'the uncensored feed must return items');

const keyword = 'uncensored japanese';
const search = await source.search(keyword, 1);
assert.ok(search.length > 0, 'search must return items');

const detail = await source.detail(search[0].url);
assert.ok(detail.title, 'detail must carry a title');

const stream = await source.watch(search[0].url);
const playlist = await grab(stream.url);
assert.equal(playlist.status, 200, 'playlist status');
assert.ok(playlist.text.includes('#EXTM3U'), 'the play url must serve an HLS playlist');

const variant = playlist.text.split('\n').map((line) => line.trim()).find((line) => /\.m3u8$/.test(line));
let segment = { status: 0, bytes: 0 };
if (variant) {
  const variantUrl = new URL(variant, stream.url).href;
  const variantPlaylist = await grab(variantUrl);
  const segmentUrl = variantPlaylist.text.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#'));
  if (segmentUrl) {
    const response = await fetch(new URL(segmentUrl, variantUrl).href, {
      headers: { 'User-Agent': UA, Referer: 'https://xhamster.com/' },
      signal: AbortSignal.timeout(40000),
    });
    segment = { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  }
}

console.log(JSON.stringify({
  ok: segment.status === 200 && segment.bytes > 0,
  site: 'xhamster',
  channels: channels.length,
  japanese: first.length,
  pageTwo: second.length,
  uncensored: uncensored.length,
  keyword,
  searchMatches: search.length,
  detail: { title: detail.title, cover: detail.cover.slice(0, 60) },
  stream: { type: stream.type, host: stream.url.split('/')[2], playlistStatus: playlist.status, variants: playlist.text.split('\n').filter((line) => /\.m3u8/.test(line)).length },
  segment,
  requests,
}, null, 2));
