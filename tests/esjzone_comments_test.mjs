import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const script = fs.readFileSync(new URL('../sources/esjzone.js', import.meta.url), 'utf8');
const work = '/detail/42.html', chapter = '/forum/42/7.html';

function fixture(count = 1) {
  let now = 1000000, requests = 0;
  const context = vm.createContext({ sendMessage() {}, Date: class extends Date { static now() { return now; } } });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(script.replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'https://www.esjzone.cc';
  const rows = Array.from({ length: count }, (_, i) => ({
    id: String(i + 1), html: 'comment-row-' + (i + 1),
    header: '<div class="comment-header"><span>讀者</span><span>1樓</span><span>2026-10-13 10:00</span></div>',
    footer: '<div class="comment-footer">檢舉 回覆</div>',
    text: '<p class="comment-text">原創測試留言 ' + (i + 1) + '</p>',
  }));
  const body = row => '<div class="comment-body">' + row.header + row.text + row.footer + '</div>';
  const node = row => ({ content: row.html, getAttributeText: async key => key === 'id' ? 'comment-' + row.id : null });
  source.page = async () => { requests++; return 'thread-page'; };
  source.querySelector = async (html, selector) => {
    if (selector === '#reply') return { content: '<h4 id="reply">回應</h4>' };
    const row = rows.find(row => row.html === html);
    assert.ok(row, 'Unknown comment fixture');
    if (selector === '.comment-body') return { content: body(row) };
    if (selector === '.comment-header .comment-title') return { text: '讀者 ' + row.id };
    if (selector === '.comment-header .comment-meta:not(.comment-floor)') return { text: '2026-10-13 10:00' };
    throw new Error('Unexpected selector: ' + selector);
  };
  source.querySelectorAll = async (html, selector) => {
    if (selector === '.comments-section .comment') return rows.map(node);
    if (selector === '.comment-header') return rows.filter(row => html.includes(row.header)).slice(0, 1).map(row => ({ content: row.header }));
    if (selector === '.comment-footer') return rows.filter(row => html.includes(row.footer)).slice(0, 1).map(row => ({ content: row.footer }));
    if (selector === '.show-more') return html.includes('<button class="show-more">查看更多</button>')
      ? [{ content: '<button class="show-more">查看更多</button>' }] : [];
    throw new Error('Unexpected selector: ' + selector);
  };
  return { source, rows, node, tick: ms => { now += ms; }, requests: () => requests };
}

test('ESJ declares chapter comments so the existing catalogue and reader show their buttons', () => {
  assert.match(script, /@comments\s+chapter\s/);
});

test('ESJ reads embedded sections once and returns 15 comments per page without duplicate IDs', async () => {
  const { source, requests, rows } = fixture(31);
  rows.push(rows[0]);
  const first = await source.comments(work, 'https://www.esjzone.cc' + chapter + '#comment-1', 1);
  const second = await source.comments(work, chapter, 2);
  const last = await source.comments(work, chapter, 3);
  const beyond = await source.comments(work, chapter, 4);
  assert.equal(first.total, 31);
  assert.equal(first.comments.length, 15);
  assert.equal(first.hasMore, true);
  assert.deepEqual(Array.from(second.comments, row => row.id), Array.from({ length: 15 }, (_, i) => String(i + 16)));
  assert.equal(second.hasMore, true);
  assert.equal(last.comments.length, 1);
  assert.equal(last.hasMore, false);
  assert.equal(beyond.comments.length, 0);
  assert.equal(beyond.hasMore, false);
  assert.equal(requests(), 1);
  assert.equal(first.headers.Referer, 'https://www.esjzone.cc' + chapter);
});

test('ESJ retains author, timestamp, quotes, div-based text and comment images, excluding page controls', async () => {
  const { source, rows } = fixture();
  rows[0].text = '<blockquote><p>原讀者：引用 &amp; 內容</p></blockquote>'
    + '<p class="comment-text"></p><div>正文第一段<br>第二段</div>'
    + '<img data-src="/uploads/comment.png"><img src="/uploads/comment.png">'
    + '<img src="javascript:bad()"><img src="data:image/png;base64,AAAA">'
    + '<script>should never display</script><style>nor styles</style>'
    + '<button class="show-more">查看更多</button>';
  const result = await source.comments(work, chapter, 1);
  const comment = result.comments[0];
  assert.equal(comment.username, '讀者 1');
  assert.equal(comment.time, '2026-10-13 10:00');
  assert.match(comment.text, /引用：\n原讀者：引用 & 內容/);
  assert.match(comment.text, /正文第一段\n第二段/);
  assert.doesNotMatch(comment.text, /1樓|10:00|檢舉|回覆|查看更多|should never|nor styles/);
  assert.deepEqual(Array.from(comment.images), ['https://www.esjzone.cc/uploads/comment.png']);
  assert.equal(comment.replyCount, 0);
});

test('a genuine empty thread is accepted but a hidden login page is an error', async () => {
  const { source } = fixture(0);
  const empty = await source.comments(work, chapter, 1);
  assert.equal(empty.total, 0);
  assert.equal(empty.hasMore, false);
  const hidden = fixture().source;
  hidden.querySelector = async () => ({ content: '' });
  await assert.rejects(hidden.comments(work, chapter, 1), /需要登入/);
  hidden.loggedIn = true;
  await assert.rejects(hidden.comments(work, chapter, 1), /未返回評論區/);
});

test('ESJ rejects external URLs, cross-book chapters and invalid pages before making requests', async () => {
  const { source, requests } = fixture();
  for (const [book, episode] of [[work, '/forum/43/7.html'], [work, 'https://evil.example' + chapter],
    ['https://evil.example' + work, chapter], [work, '/forum/42/7.html/extra'], [work, '//evil.example' + chapter]]) {
    await assert.rejects(source.comments(book, episode, 1), /無效/);
  }
  for (const page of [0, -1, 1.5, 'bad', Infinity]) await assert.rejects(source.comments(work, chapter, page), /頁碼/);
  assert.equal(requests(), 0);
});

test('ESJ reuses just-read chapter HTML without another network request', async () => {
  const { source, requests } = fixture();
  source.rememberComments('https://www.esjzone.cc' + chapter, 'thread-page');
  const result = await source.comments(work, chapter, 1);
  assert.equal(result.comments.length, 1);
  assert.equal(requests(), 0);
});

test('ESJ combines concurrent loads, throttles refreshes and keeps a consistent snapshot for later pages', async () => {
  const { source, tick, requests } = fixture(16);
  await Promise.all([source.comments(work, chapter, 1), source.comments(work, chapter, 1)]);
  assert.equal(requests(), 1);
  tick(14999);
  await source.comments(work, chapter, 1);
  assert.equal(requests(), 1);
  tick(1);
  await source.comments(work, chapter, 2);
  assert.equal(requests(), 1);
  await source.comments(work, chapter, 1);
  assert.equal(requests(), 2);
  tick(120001);
  await source.comments(work, chapter, 2);
  assert.equal(requests(), 3);
});

test('failed loads and malformed posts can be retried and cache memory stays bounded', async () => {
  const { source, rows } = fixture();
  let fail = true;
  source.page = async () => { if (fail) throw new Error('temporary failure'); return 'thread-page'; };
  await assert.rejects(source.comments(work, chapter, 1), /temporary failure/);
  assert.equal(source._commentPending.size, 0);
  fail = false;
  const originalQuery = source.querySelector;
  source.querySelector = async (html, selector) => selector === '.comment-body' ? { content: '' } : originalQuery(html, selector);
  await assert.rejects(source.comments(work, chapter, 1), /格式/);
  source.querySelector = originalQuery;
  assert.equal((await source.comments(work, chapter, 1)).comments[0].id, rows[0].id);
  for (let i = 0; i < 20; i++) source.rememberComments('/forum/42/' + (i + 20) + '.html', 'thread-page');
  assert.equal(source._commentPages.size, 6);
});

test('ESJ offers a detail-thread fallback and never fabricates a nested-reply endpoint', async () => {
  const { source, requests } = fixture();
  assert.equal((await source.comments(work, '', 1)).comments.length, 1);
  assert.equal((await source.comments(work, chapter, 1, '1')).comments.length, 0);
  assert.equal(requests(), 1);
});
