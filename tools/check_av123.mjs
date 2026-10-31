// Optional live smoke test; not run by repository CI.
// The benchmark is the title code SNOS-378: find it, open it, play it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const CODE = 'SNOS-378';

const context = vm.createContext({ sendMessage() {}, Date });
vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../sources/av123.js', import.meta.url), 'utf8')
  .replace('export default class', 'globalThis.Source = class'), context);
const source = vm.runInContext('new Source()', context);
source.webSite = 'https://123av.com';
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

const grab = async (url, referer) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) },
    signal: AbortSignal.timeout(40000),
  });
  return { status: response.status, text: await response.text() };
};

const channels = await source.channels();
const first = await source.latest(1, 'new');
assert.ok(first.length > 0, 'the newest feed must return items');
const second = await source.latest(2, '');
assert.ok(second.length > 0, 'page two must return items');
assert.notEqual(first[0].url, second[0].url, 'page two must differ');

const found = await source.search(CODE, 1);
const hit = found.find((item) => new RegExp(CODE, 'i').test(item.title) || new RegExp(CODE.toLowerCase(), 'i').test(item.url));
assert.ok(hit, `search must find ${CODE}`);

const detail = await source.detail(hit.url);
assert.ok(new RegExp(CODE, 'i').test(detail.title), 'detail title must carry the code');
assert.ok(detail.cover.startsWith('https://'), 'cover must be a url');
assert.ok(detail.episodes[0].urls.length > 0, 'detail must expose a playable line');

const stream = await source.watch(detail.episodes[0].urls[0].url);
const playlist = await grab(stream.url, stream.headers?.Referer);
assert.equal(playlist.status, 200, 'playlist status');
assert.ok(playlist.text.includes('#EXTM3U'), 'the line must serve an HLS playlist');

const variant = playlist.text.split('\n').map((line) => line.trim()).find((line) => /\.m3u8$/.test(line));
let segment = { status: 0, bytes: 0 };
if (variant) {
  const variantUrl = new URL(variant, stream.url).href;
  const variantPlaylist = await grab(variantUrl, stream.headers?.Referer);
  const segmentUrl = variantPlaylist.text.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#'));
  if (segmentUrl) {
    const response = await fetch(new URL(segmentUrl, variantUrl).href, {
      headers: { 'User-Agent': UA, Referer: stream.headers?.Referer || '' },
      signal: AbortSignal.timeout(40000),
    });
    segment = { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
  }
}

console.log(JSON.stringify({
  ok: segment.status === 200 && segment.bytes > 0,
  site: '123av',
  channels: channels.length,
  newest: first.length,
  pageTwo: second.length,
  search: { code: CODE, matches: found.length, hit: hit && hit.title.slice(0, 70) },
  detail: { title: detail.title.slice(0, 80), cover: detail.cover.slice(0, 70), lines: detail.episodes[0].urls.length },
  stream: { type: stream.type, host: stream.url.split('/')[2], playlistStatus: playlist.status },
  segment,
  requests,
}, null, 2));
