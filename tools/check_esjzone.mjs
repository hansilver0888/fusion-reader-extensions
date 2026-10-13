// Launched by check_esjzone.py; bridge messages are consumed privately by Python.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import readline from 'node:readline';
import vm from 'node:vm';

function send(channel, data) { process.stdout.write(JSON.stringify({ channel, ...data }) + '\n'); }
const context = vm.createContext({ sendMessage(channel, message) {
  if (channel !== 'console') send(channel, JSON.parse(message));
} });
vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../sources/esjzone.js', import.meta.url), 'utf8')
  .replace('export default class', 'globalThis.Source = class'), context);
const source = vm.runInContext('new Source()', context);
source.webSite = 'https://www.esjzone.cc';
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  const reply = JSON.parse(line);
  context.__resolveBridge(reply.id, reply.ok, JSON.stringify(reply.data));
});

try {
  await source.load();
  const latest = await source.latest(1);
  assert.ok(latest.length > 0 && latest.some(item => item.cover));
  const result = await source.search('不相容', 1);
  const book = result.find(item => item.url.includes('/detail/1719825699.html'));
  assert.ok(book, 'The user benchmark novel is missing from search');
  assert.ok(book.cover, 'Search cover is missing');
  const detail = await source.detail('/detail/1719825699.html');
  assert.ok(detail.title.includes('不相容'));
  assert.ok(detail.cover && detail.episodes[0].urls.length > 1);
  const chapters = [];
  for (const episode of detail.episodes[0].urls.slice(0, 2)) {
    const chapter = await source.watch(episode.url);
    assert.ok(chapter.content.length > 0, 'Chapter text is missing');
    chapters.push({ blocks: chapter.content.length, characters: chapter.content.filter(x => typeof x === 'string').join('').length });
  }
  const id = ++context.__callSeq;
  const image = await new Promise((resolve, reject) => {
    context.__pendingCalls[id] = { resolve, reject };
    send('probeImage', { id, payload: { url: detail.cover } });
  });
  assert.equal(image.status, 200, 'Benchmark cover failed to load');
  assert.ok(image.imageBytes, 'Benchmark cover did not return an image');
  send('done', { result: { ok: true, loggedIn: source.loggedIn, latest: latest.length, latestWithCovers: latest.filter(x => x.cover).length,
    searchBenchmark: true, searchCover: true, detailCover: true, coverImageReadable: true,
    chapters: detail.episodes[0].urls.length, chapterSamples: chapters } });
} catch (error) {
  send('done', { result: { ok: false, error: error.message } });
  process.exitCode = 1;
} finally {
  lines.close();
}
