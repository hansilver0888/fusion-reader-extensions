// Optional live smoke test; not run by repository CI.
// Reads the site's public pages and api and samples one gallery image.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const context = vm.createContext({ sendMessage() {}, Date });
vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../sources/fourkhd.js', import.meta.url), 'utf8')
  .replace('export default class', 'globalThis.Source = class'), context);
const source = vm.runInContext('new Source()', context);
source.webSite = 'https://usti.uuss.uk';

let requests = 0;
source.request = async (url) => {
  requests++;
  assert.ok(String(url).startsWith('https://usti.uuss.uk/'), `not the declared entry point: ${url}`);
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9', Accept: '*/*' },
    signal: AbortSignal.timeout(40000),
  });
  assert.ok(response.status < 400, `${url} answered ${response.status}`);
  return response.text();
};

async function imageSample(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, Range: 'bytes=0-1023' },
    signal: AbortSignal.timeout(30000),
  });
  assert.ok([200, 206].includes(response.status), `image answered ${response.status}`);
  const chunk = await response.arrayBuffer();
  assert.ok(chunk.byteLength > 0, 'image returned no bytes');
  return { status: response.status, bytes: chunk.byteLength, type: response.headers.get('content-type') };
}

const channels = await source.channels();
assert.ok(channels.length >= 8, 'expected the curated pages and the categories');

const first = await source.latest(1, '');
const second = await source.latest(2, '');
assert.ok(first.length > 0 && second.length > 0, 'listing pages must return items');
assert.notEqual(first[0].url, second[0].url, 'page 2 must differ from page 1');

const popular = await source.latest(1, 'page=/pages/popular');
assert.ok(popular.length > 0, 'the popular page must return items');
const cosplay = await source.latest(1, 'page=/pages/cosplay');
assert.ok(cosplay.length > 0, 'the cosplay page must return items');

const category = channels.find((channel) => channel.key.startsWith('category='));
assert.ok(category, 'a category channel must exist');
const categoryItems = await source.latest(1, category.key);
assert.ok(categoryItems.length > 0, `category ${category.title} must return items`);

const keyword = first[0].title.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().split(' ')[0];
assert.ok(keyword && keyword.length >= 2, `could not derive a keyword from ${first[0].title}`);
const search = await source.search(keyword, 1);
assert.ok(search.length > 0, `search for ${keyword} must return items`);

const detail = await source.detail(first[0].url);
assert.ok(detail.title, 'detail must carry a title');
assert.ok(detail.cover.startsWith('https://'), 'cover must be an image url');
assert.ok(detail.episodes[0].urls.length > 0, 'detail must carry a catalogue');

// a work that the site split into parts exercises the multi episode path
let series = null;
for (const candidate of first.slice(0, 6)) {
  const candidateDetail = await source.detail(candidate.url);
  if (candidateDetail.episodes[0].urls.length > 1) {
    series = candidateDetail;
    break;
  }
}
assert.ok(series, 'expected at least one multi part work in the newest page');
const lastEpisode = series.episodes[0].urls[series.episodes[0].urls.length - 1];

const reading = await source.watch(detail.episodes[0].urls[0].url);
assert.ok(reading.urls.length > 0, 'reading must return images');
const sample = await imageSample(reading.urls[0]);
const partReading = await source.watch(lastEpisode.url);
assert.ok(partReading.urls.length > 0, 'the last part must return images');
assert.notEqual(partReading.urls[0], reading.urls[0], 'parts must not share the same first image');

console.log(JSON.stringify({
  ok: true,
  channels: channels.length,
  firstPage: first.length,
  secondPage: second.length,
  popularPage: popular.length,
  cosplayPage: cosplay.length,
  category: { title: category.title, items: categoryItems.length },
  keyword,
  searchMatches: search.length,
  newest: { title: detail.title, episodes: detail.episodes[0].urls.length },
  multiPart: { title: series.title, parts: series.episodes[0].urls.length, lastPartImages: partReading.urls.length },
  images: { count: reading.urls.length, sample },
  requests,
}, null, 2));
