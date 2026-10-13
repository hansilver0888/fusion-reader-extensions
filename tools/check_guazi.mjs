// Optional live smoke test; not run by repository CI.
// Reads public metadata and a small media sample, without playing content.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ sendMessage() {} });
vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../sources/guazi.js', import.meta.url), 'utf8')
  .replace('export default class', 'globalThis.Source = class'), context);
const source = vm.runInContext('new Source()', context);
source.webSite = 'https://gz360.tv';
let requests = 0;
source.request = async (url, options = {}) => {
  requests++;
  const response = await fetch(url, { method: options.method || 'get', headers: options.headers,
    body: options.data, signal: AbortSignal.timeout(options.timeoutMs || 25000) });
  assert.equal(response.status, 200, 'Public API request failed');
  return response.text();
};

async function smallMediaSample(watch) {
  const response = await fetch(watch.url, { headers: watch.headers, signal: AbortSignal.timeout(25000) });
  assert.equal(response.status, 200, 'HLS playlist request failed');
  const playlist = await response.text();
  assert.ok(playlist.startsWith('#EXTM3U'), 'Expected an HLS playlist');
  const entries = playlist.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  assert.ok(entries.length > 0, 'Playlist is empty');
  const media = new URL(entries[0], watch.url);
  if (playlist.includes('#EXT-X-STREAM-INF')) {
    return smallMediaSample({ ...watch, url: media.href });
  }
  const key = playlist.match(/#EXT-X-KEY:[^\r\n]*URI="([^"]+)"/);
  if (key) {
    const result = await fetch(new URL(key[1], watch.url), { headers: watch.headers, signal: AbortSignal.timeout(25000) });
    assert.equal(result.status, 200, 'HLS key request failed');
    assert.equal((await result.arrayBuffer()).byteLength, 16, 'Expected an AES-128 HLS key');
  }
  const sample = await fetch(media, { headers: { ...watch.headers, Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(25000) });
  assert.ok([200, 206].includes(sample.status), 'Media sample request failed');
  const reader = sample.body.getReader();
  const first = await reader.read();
  await reader.cancel();
  assert.ok(first.value?.byteLength > 0, 'Media returned no bytes');
  return { playlist: true, segments: entries.length, keyReadable: Boolean(key), mediaSampleBytes: first.value.byteLength };
}

const channels = await source.channels();
assert.ok(channels.some(channel => channel.key === '4'));
const first = await source.latest(1, '4');
const second = await source.latest(2, '4');
assert.ok(first.length > 0 && second.length > 0);
assert.notEqual(first[0].url, second[0].url);
const search = await source.search('仙逆', 1);
assert.ok(search.some(item => item.title.includes('仙逆')));
const detail = await source.detail('/videoDetail/136398');
const watch = await source.watch(detail.episodes[0].urls[0].url);
const media = await smallMediaSample(watch);
const series = await source.detail('/videoDetail/154480');
assert.ok(series.episodes[0].urls.length > 1);
const seriesWatch = await source.watch(series.episodes[0].urls[1].url);
assert.notEqual(seriesWatch.url, watch.url);
const comments = await source.comments('/videoDetail/136398', detail.episodes[0].urls[0].url, 1);
const moreComments = await source.comments('/videoDetail/136398', null, 2);
assert.ok(comments.comments.length > 0 && moreComments.comments.length > 0);
assert.notEqual(comments.comments[0].id, moreComments.comments[0].id);
assert.ok(comments.comments.every(comment => comment.id));
const withReplies = moreComments.comments.find(comment => comment.replyCount > 0);
let replyCount = 0;
if (withReplies) {
  const replies = await source.comments('/videoDetail/136398', null, 1, withReplies.id);
  assert.equal(replies.comments.length, withReplies.replyCount);
  replyCount = replies.comments.length;
}
const lastPage = Math.ceil(comments.total / 10);
const lastComments = await source.comments('/videoDetail/136398', null, lastPage);
assert.equal(lastComments.hasMore, false);
const emptyComments = await source.comments('/videoDetail/154480', null, 1);
assert.equal(emptyComments.comments.length, 0);
assert.equal(emptyComments.hasMore, false);
console.log(JSON.stringify({ ok: true, channels: channels.length, firstPage: first.length, secondPage: second.length,
  searchMatches: search.length, movieEpisodes: detail.episodes[0].urls.length, seriesEpisodes: series.episodes[0].urls.length,
  requests, media, comments: { firstPage: comments.comments.length, secondPage: moreComments.comments.length,
    total: comments.total, lastPage: lastComments.comments.length, replies: replyCount, emptyWork: true } }, null, 2));
