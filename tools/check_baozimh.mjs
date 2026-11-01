// Optional live smoke test; not run by repository CI.
// The site's gatekeeper needs a cookie jar, so the harness keeps one like the
// app's Dio client does.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

const context = vm.createContext({ sendMessage() {}, Date });
vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../sources/baozimh.js', import.meta.url), 'utf8')
  .replace('export default class', 'globalThis.Source = class'), context);
const source = vm.runInContext('new Source()', context);
source.webSite = 'https://www.baozimh.com';
source.getSetting = async () => '';
source.setSetting = async () => {};
source.sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 600)));

let requests = 0;
source.request = async (url, options = {}) => {
  requests++;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'User-Agent': UA,
      ...(jar.size ? { Cookie: cookieHeader() } : {}),
      ...(options.headers || {}),
    },
    body: options.data,
    redirect: 'follow',
    signal: AbortSignal.timeout(40000),
  });
  for (const entry of response.headers.getSetCookie ? response.headers.getSetCookie() : []) {
    const [pair] = entry.split(';');
    const at = pair.indexOf('=');
    if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
  }
  const text = await response.text();
  if (options.allowErrorStatus) return text;
  assert.ok(response.status < 400, `${url} answered ${response.status}`);
  return text;
};

const channels = await source.channels();
// channel 0 is the single-page update feed, channel 1 is the paged catalogue
const first = await source.latest(1, '1');
assert.ok(first.length > 0, 'the catalogue feed must return items');
const second = await source.latest(2, '1');
assert.ok(second.length > 0, 'page two must return items');
assert.notEqual(first[0].url, second[0].url, 'page two must differ');
const updates = await source.latest(1, '0');
assert.ok(updates.length > 0, 'the update feed must return items');

const keyword = first[0].title.slice(0, 4);
const search = await source.search(keyword, 1);
assert.ok(search.length > 0, 'search must return items');

const detail = await source.detail(first[0].url);
assert.ok(detail.title, 'detail must carry a title');
assert.ok(detail.cover.startsWith('https://'), 'cover must be a url');
assert.ok(detail.episodes[0].urls.length > 0, 'detail must list chapters');

const chapter = detail.episodes[0].urls[0];
const watch = await source.watch(chapter.url);
assert.ok(watch.urls.length > 0, 'a chapter must expose page images');

const sample = await fetch(watch.urls[0], {
  headers: { 'User-Agent': UA, Referer: 'https://www.baozimh.com/' },
  signal: AbortSignal.timeout(30000),
});
const bytes = (await sample.arrayBuffer()).byteLength;

console.log(JSON.stringify({
  ok: sample.status === 200 && bytes > 1000,
  site: 'baozimh',
  channels: channels.length,
  updatePage: first.length,
  pageTwo: second.length,
  keyword,
  searchMatches: search.length,
  detail: { title: detail.title.slice(0, 40), cover: detail.cover.slice(0, 60), chapters: detail.episodes[0].urls.length },
  chapter: { title: watch.title.slice(0, 40), pages: watch.urls.length, firstPage: watch.urls[0].slice(0, 80) },
  image: { status: sample.status, bytes },
  requests,
  cookies: [...jar.keys()],
}, null, 2));
