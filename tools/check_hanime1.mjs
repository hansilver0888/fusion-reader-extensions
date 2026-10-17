// Optional live smoke test; not run by repository CI.
//
// Transport: the site's Cloudflare edge answers direct https requests from
// node's fetch with "Attention Required!" (403) and blocks node's http requests
// that carry fetch's default browser-ish headers, so this checker reads the
// site through curl — the same requests the app's dart client performs. Set
// HTTPS_PROXY (or HTTP_PROXY) to route through a proxy; the site is not
// reachable from mainland China without one.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy
  || process.env.HTTP_PROXY || process.env.http_proxy || '';

function curl(url, { range } = {}) {
  const args = ['-sS', '--max-time', '60', '-A', UA, '-H', 'Accept-Language: zh-TW,zh;q=0.9',
    '-w', '\n__STATUS__%{http_code}__%{size_download}'];
  if (range) args.push('-r', range);
  else args.push('-L');
  if (PROXY) args.push('--proxy', PROXY);
  args.push(url);
  const output = execFileSync('curl', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const trailer = output.match(/__STATUS__(\d+)__(\d+)\s*$/) || [];
  return {
    status: Number(trailer[1] || 0),
    bytes: Number(trailer[2] || 0),
    body: output.replace(/\n__STATUS__\d+__\d+\s*$/, ''),
  };
}

const context = vm.createContext({ sendMessage() {}, Date });
vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../sources/hanime1.js', import.meta.url), 'utf8')
  .replace('export default class', 'globalThis.Source = class'), context);
const source = vm.runInContext('new Source()', context);
source.webSite = 'http://hanime1.me';

let quality = 'auto';
source.getSetting = async () => quality;

const requests = new Set();
source.request = async (url, options = {}) => {
  assert.ok(String(url).startsWith('http://hanime1.me/'), `not the site entry point: ${url}`);
  requests.add(String(url).split('?')[0]);
  const { status, body } = curl(url, options.range);
  assert.equal(status, 200, `${url} answered ${status}`);
  return body;
};

const channels = await source.channels();
assert.ok(channels.length >= 40, 'expected the full category list');
assert.ok(channels.some((channel) => channel.key.startsWith('genre=')), 'genres must be browsable');

const first = await source.latest(1, '');
const second = await source.latest(2, '');
assert.ok(first.length > 0 && second.length > 0, 'listing pages must return items');
assert.notEqual(first[0].url, second[0].url, 'page 2 must differ from page 1');
const newest = first[0];

// genre pages use the grid layout, tag, sort and date pages the row layout;
// the keys are taken exactly as channels() hands them to the app.
const pick = (prefix, needle) => {
  const channel = channels.find((entry) => entry.key.startsWith(prefix) && (!needle || entry.key.includes(needle)));
  assert.ok(channel, `channel ${prefix}${needle || ''} must exist`);
  return channel;
};
const genreChannel = pick('genre=');
const tagChannel = pick('tags[]=', '中文字幕');
const sortChannel = pick('sort=', '本週排行');
const dateChannel = pick('date=', '過去 1 週');

const genre = await source.latest(1, genreChannel.key);
assert.ok(genre.length > 0, `genre listing ${genreChannel.title} must return items`);
const tagged = await source.latest(1, tagChannel.key);
assert.ok(tagged.length > 0, `tag listing ${tagChannel.title} must return items`);
const ranked = await source.latest(1, sortChannel.key);
assert.ok(ranked.length > 0, `ranking listing ${sortChannel.title} must return items`);
const dated = await source.latest(1, dateChannel.key);
assert.ok(dated.length > 0, `date listing ${dateChannel.title} must return items`);

const keyword = newest.title.replace(/^\[[^\]]*\]\s*/, '').split(/\s+/).slice(0, 2).join(' ');
const search = await source.search(keyword, 1);
assert.ok(search.length > 0, `search for ${keyword} must return items`);

const detail = await source.detail(newest.url);
assert.ok(detail.title, 'detail must carry a title');
assert.ok(detail.cover.startsWith('https://'), 'cover must be an image url');
assert.ok(detail.episodes[0].urls.length > 0, 'detail must carry a catalogue');
assert.ok(detail.authors.length > 0, 'detail must carry the uploader');

// find a work that belongs to a playlist, so the multi episode path is checked
let series = null;
for (const candidate of first.slice(0, 8)) {
  const candidateDetail = await source.detail(candidate.url);
  if (candidateDetail.episodes[0].urls.length > 1) {
    series = candidateDetail;
    break;
  }
}
assert.ok(series, 'expected at least one playlist work in the newest page');

const episode = detail.episodes[0].urls[0];
const auto = await source.watch(episode.url);
assert.ok(['mp4', 'hls'].includes(auto.type), 'watch must return a stream');
assert.ok(auto.url.startsWith('https://'), 'the stream url comes from the media host');
const media = curl(auto.url, { range: '0-1023' });
assert.ok([200, 206].includes(media.status), `media sample answered ${media.status}`);
assert.ok(media.bytes > 0, 'media sample must return bytes');

// a stored preference must be honoured when that quality exists
quality = '480p';
const preferred = await source.watch(episode.url);
assert.ok(preferred.url.includes('480p'), 'the preferred quality must be picked when available');

// work comments: one read returns the whole discussion, replies need the parent
const comments = await source.comments(newest.url, episode.url, 1);
assert.equal(comments.hasMore, false, 'the comment endpoint is not paginated');
assert.ok(Array.isArray(comments.comments), 'comments must be a list');
let repliesInThread = 0;
let withReplies = null;
for (const comment of comments.comments) {
  assert.ok(comment.id, 'every comment carries the site id');
  assert.ok(comment.username, 'every comment carries an author');
  if (comment.replyCount > 0 && withReplies === null) withReplies = comment;
}
if (withReplies) {
  const thread = await source.comments(newest.url, episode.url, 1, withReplies.id);
  assert.equal(thread.hasMore, false);
  repliesInThread = thread.comments.length;
}
quality = 'auto';

console.log(JSON.stringify({
  ok: true,
  channels: channels.length,
  firstPage: first.length,
  secondPage: second.length,
  genre: { title: genreChannel.title, items: genre.length },
  tag: { title: tagChannel.title, items: tagged.length },
  ranking: { title: sortChannel.title, items: ranked.length },
  date: { title: dateChannel.title, items: dated.length },
  keyword,
  searchMatches: search.length,
  newest: { title: detail.title, episodes: detail.episodes[0].urls.length, authors: detail.authors.length },
  playlistWork: { title: series.title, episodes: series.episodes[0].urls.length },
  stream: { type: auto.type, host: auto.url.split('/')[2], sampleBytes: media.bytes, preferred: preferred.url.includes('480p') },
  comments: {
    items: comments.comments.length,
    firstAuthor: comments.comments.length ? comments.comments[0].username : '',
    firstLikes: comments.comments.length ? comments.comments[0].likes : 0,
    replyThreadFor: withReplies ? withReplies.id : '',
    replies: repliesInThread,
  },
  hosts: Array.from(requests),
}, null, 2));
