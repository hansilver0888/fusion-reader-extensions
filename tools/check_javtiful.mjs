// Optional live smoke test; not run by repository CI.
// Benchmark: the title code SNOS-378 must be found, opened and played.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const CODE = 'SNOS-378';

const context = vm.createContext({ sendMessage() {}, Date });
vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../sources/javtiful.js', import.meta.url), 'utf8')
  .replace('export default class', 'globalThis.Source = class'), context);
const source = vm.runInContext('new Source()', context);
source.webSite = 'https://javtiful.com';
source.getSetting = async () => '';
source.setSetting = async () => {};
source.sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 1000)));

let requests = 0;
source.request = async (url, options = {}) => {
  requests++;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: { 'User-Agent': UA, ...(options.headers || {}) },
    body: options.data,
    signal: AbortSignal.timeout(40000),
  });
  assert.ok(response.status < 400, `${url} answered ${response.status}`);
  return response.text();
};

const channels = await source.channels();
const first = await source.latest(1, '0');
assert.ok(first.length > 0, 'the newest feed must return items');
const second = await source.latest(2, '');
assert.ok(second.length > 0, 'page two must return items');
assert.notEqual(first[0].url, second[0].url, 'page two must differ');
const uncensored = await source.latest(1, '3');
assert.ok(uncensored.length > 0, 'the uncensored feed must return items');

const found = await source.search(CODE, 1);
const hit = found.find((item) => new RegExp(CODE, 'i').test(item.title) || new RegExp(CODE.toLowerCase(), 'i').test(item.url));
assert.ok(hit, `search must find ${CODE}`);

const detail = await source.detail(hit.url);
assert.ok(new RegExp(CODE, 'i').test(detail.title), 'detail title must carry the code');
assert.ok(detail.cover.startsWith('https://'), 'cover must be a url');

const stream = await source.watch(detail.episodes[0].urls[0].url);
assert.equal(stream.type, 'mp4');
const media = await fetch(stream.url, {
  headers: { 'User-Agent': UA, Referer: stream.headers?.Referer || 'https://javtiful.com/', Range: 'bytes=0-2047' },
  signal: AbortSignal.timeout(40000),
});
const head = Buffer.from(await media.arrayBuffer());
const isMp4 = head.slice(4, 8).toString('latin1') === 'ftyp';

console.log(JSON.stringify({
  ok: media.status < 400 && isMp4,
  site: 'javtiful',
  channels: channels.length,
  newest: first.length,
  pageTwo: second.length,
  uncensored: uncensored.length,
  search: { code: CODE, matches: found.length, hit: hit && hit.title.slice(0, 70) },
  detail: { title: detail.title.slice(0, 80), cover: detail.cover.slice(0, 70) },
  stream: { type: stream.type, host: stream.url.split('/')[2], status: media.status, contentType: media.headers.get('content-type'), isMp4, headBytes: head.length },
  requests,
}, null, 2));
