// Optional live smoke test; not run by repository CI.
// CopyManga answers an empty chapter list and an empty contentKey to clients it
// dislikes (and its json api answers `code 210`), so this check reports what the
// site actually returned instead of pretending a partial answer is a failure.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0.1 Safari/605.1.15';

const context = vm.createContext({ sendMessage() {}, Date });
vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../sources/copymanga.js', import.meta.url), 'utf8')
  .replace('export default class', 'globalThis.Source = class'), context);
const source = vm.runInContext('new Source()', context);
source.webSite = 'https://www.copy5000.com';
source.getSetting = async () => '';
source.setSetting = async () => {};
source.sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 400)));

let requests = 0;
source.request = async (url, options = {}) => {
  requests += 1;
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, ...(options.headers || {}) },
    redirect: 'follow',
    signal: AbortSignal.timeout(45000),
  });
  return response.text();
};

const report = { source: 'copymanga', ok: false, requests: 0 };

const channels = await source.channels();
const newest = await source.latest(1, '0');
assert.ok(newest.length > 0, 'the newest feed must return items');
report.channels = channels.length;
report.newest = newest.length;
report.newestSample = newest[0];

const popular = await source.latest(1, '1');
report.popular = popular.length;

const keyword = '海賊王';
const found = await source.search(keyword, 1);
assert.ok(found.length > 0, 'search must return items');
report.keyword = keyword;
report.searchMatches = found.length;
report.searchSample = found[0];

// detail: the chapter list may legitimately come back empty (site side limit)
let detail = null;
let detailError = '';
try {
  detail = await source.detail(found[0].url);
} catch (error) {
  detailError = String(error.message || error);
}
report.detail = detail ? {
  title: detail.title,
  cover: detail.cover ? detail.cover.slice(0, 70) : '',
  hasDesc: Boolean(detail.desc),
  chapters: detail.episodes[0].urls.length,
  firstChapter: detail.episodes[0].urls[0] && detail.episodes[0].urls[0].name,
} : { error: detailError };

// reader: works only when the site hands out a contentKey
if (detail && detail.episodes[0].urls.length) {
  try {
    const stream = await source.watch(detail.episodes[0].urls[detail.episodes[0].urls.length - 1].url);
    report.reader = { pages: stream.urls.length, first: stream.urls[0] };
  } catch (error) {
    report.reader = { error: String(error.message || error).slice(0, 120) };
  }
}

report.requests = requests;
report.entry = source.currentSite();
report.ok = report.newest > 0 && report.searchMatches > 0;
console.log(JSON.stringify(report, null, 2));
