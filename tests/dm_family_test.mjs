import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { source, closeBridge } from '../tools/dm-family-harness.mjs';
after(closeBridge);

function card(kind, id, title, banner = false) {
  const path = kind === 'mangabz' ? '/' + id + 'bz/' : '/manhua-' + id + '/';
  if (banner) return '<div class="banner_detail_form"><img src="https://image.example/cover.jpg"><p class="title"><a href="' + path + '">' + title + '</a></p></div>';
  const cover = kind === 'mangabz' ? '<img class="mh-cover" src="https://image.example/cover.jpg">' : '<p class="mh-cover" style="background-image:url(https://image.example/cover.jpg)"></p>';
  return '<ul class="mh-list"><li><div class="mh-item">' + cover + '<h2 class="title"><a href="' + path + '">' + title + '</a></h2><p class="chapter">最新 第51話</p></div></li></ul>';
}
function detail(kind, { chapters = true, ascending = false } = {}) {
  const info = kind === 'mangabz'
    ? '<p class="detail-info-title">示例作品</p><img class="detail-info-cover" src="https://image.example/cover.jpg"><p class="detail-info-tip"><span>作者：<a href="/search?title=作者&amp;f=2">作者</a></span></p><p class="detail-info-content">原創測試簡介</p>'
    : '<div class="banner_detail_form"><img src="https://image.example/cover.jpg"><p class="title">示例作品</p><p class="subtitle">作者：<a href="/search?title=作者&amp;f=2">作者</a></p><p class="content">原創測試簡介</p></div>';
  const links = (ascending ? [1, 2] : [2, 1]).map((n) => '<a class="detail-list-form-item" href="/m' + n + '/">第' + n + '話<span>（19P）</span></a>');
  const list = kind === 'mangabz' ? links.join('') : '<ul id="detail-list-select-1">' + links.map((link) => '<li>' + link + '</li>').join('') + '</ul>';
  return info + '<div class="detail-list-title"><a class="block">連載（2）</a><a class="order">' + (ascending ? '正序' : '倒序') + '</a></div>' +
    (chapters ? '<div id="chapterlistload" class="detail-list-form-con">' + list + '</div>' : '') +
    '<aside><a class="detail-list-form-item" href="/m999/">推薦作品第999話</a></aside>';
}
function reader(kind, { count = 3, cid = '51', signed = true } = {}) {
  const prefix = kind === 'mangabz' ? 'MANGABZ_' : 'DM5_';
  return '<script>var ' + prefix + 'CID=' + cid + ';var ' + prefix + 'IMAGE_COUNT=' + count + ';' +
    (kind === 'dm5' && signed ? 'var DM5_MID=1;var DM5_VIEWSIGN_DT="2026-01-01 12:00:00";var DM5_VIEWSIGN="public-test-sign";' : '') + '</script>';
}
function images(start, count = 2) {
  const items = Array.from({ length: count }, (_, i) => '/page-' + (start + i) + '.jpg');
  return 'function imagefun(){var pix="https://image.example";var pvalue=' + JSON.stringify(items) +
    ';for(var i=0;i<pvalue.length;i++){pvalue[i]=pix+pvalue[i]+\'?cid=51&key=fixture\'}return pvalue}var d;d=imagefun();';
}
function packed(code) {
  return 'eval(function(p,a,c,k,e,d){return p;}(' + JSON.stringify(code) + ',62,1,"".split("|"),0,{}))';
}

for (const kind of ['mangabz', 'dm5']) {
  test(kind + ' browsing and author search use their own paginated endpoints', async () => {
    const s = source(kind), calls = [];
    s.request = async (url, options) => { calls.push({ url, options }); return card(kind, kind === 'mangabz' ? '123' : 'test', '示例作品'); };
    assert.equal((await s.latest(2, 'new')).length, 1);
    assert.match(calls[0].url, kind === 'mangabz' ? /manga-list-0-0-2-p2/ : /manhua-list-s2-p2/);
    await s.search('作者 A&B', 3);
    let params = new URL(calls.at(-1).url).searchParams;
    assert.equal(params.get('title'), '作者 A&B'); assert.equal(params.get('page'), '3');
    await s.searchAuthor({ name: '作者 A&B' }, 2);
    params = new URL(calls.at(-1).url).searchParams;
    assert.equal(params.get('f'), '2'); assert.equal(params.get('page'), '2');
    assert.ok(calls.every((call) => call.options.retry === false));
    assert.equal((await s.channels()).length, 5);
    await assert.rejects(s.latest(0, 'new'), /頁碼/);
  });
  test(kind + ' detail keeps the complete ordered directory and author, excluding recommendations', async () => {
    const s = source(kind);
    s.request = async () => detail(kind);
    const d = await s.detail(kind === 'mangabz' ? '/123bz/' : '/manhua-test/');
    assert.equal(d.title, '示例作品'); assert.match(d.desc, /原創/);
    assert.equal(d.authors[0].name, '作者'); assert.match(d.cover, /cover.jpg/);
    assert.deepEqual(Array.from(d.episodes[0].urls, (x) => x.name), ['第1話', '第2話']);
    assert.equal(d.episodes[0].urls.some((x) => x.url.includes('999')), false);
  });
  test(kind + ' respects an ascending directory and rejects a missing full directory', async () => {
    const s = source(kind);
    s.request = async () => detail(kind, { ascending: true });
    const d = await s.detail(kind === 'mangabz' ? '/123bz/' : '/manhua-test/');
    assert.equal(d.episodes[0].urls[0].url, '/m1/');
    const missing = source(kind); missing.request = async () => detail(kind, { chapters: false });
    await assert.rejects(missing.detail(kind === 'mangabz' ? '/123bz/' : '/manhua-test/'), /完整目錄/);
  });
  test(kind + ' reads all image batches with correct referer and no extra discovery request', async () => {
    const s = source(kind), calls = [];
    s.request = async (url, options) => {
      calls.push({ url, options });
      if (!url.includes('.ashx')) return reader(kind);
      const page = Number(new URL(url).searchParams.get('page'));
      return packed(images(page, page === 3 ? 1 : 2));
    };
    const result = await s.watch('/m51/');
    assert.equal(result.urls.length, 3); assert.match(result.urls[0], /page-1\.jpg/); assert.match(result.urls[2], /page-3\.jpg/);
    assert.equal(calls.length, 3);
    assert.equal(new URL(calls[1].url).searchParams.get('page'), '1');
    assert.equal(new URL(calls[2].url).searchParams.get('page'), '3');
    assert.match(calls[1].options.headers.Referer, /\/m51\/$/);
    assert.equal(result.headers['User-Agent'], calls[1].options.headers['User-Agent']);
    if (kind === 'dm5') {
      const params = new URL(calls[1].url).searchParams;
      assert.equal(params.get('_sign'), 'public-test-sign'); assert.equal(params.get('_dt'), '2026-01-01 12:00:00');
      assert.match(result.headers.Referer, /\/m51\/$/);
    }
  });
  test(kind + ' a repeated/partial batch fails without looping or returning a truncated chapter', async () => {
    const s = source(kind); let calls = 0;
    s.request = async (url) => { calls += 1; return url.includes('.ashx') ? packed(images(1, 2)) : reader(kind); };
    await assert.rejects(s.watch('/m51/'), /不完整/);
    assert.equal(calls, 3);
  });
  test(kind + ' coalesces requests and backs off instead of hammering a rejected site', async () => {
    const s = source(kind); let calls = 0;
    s.request = async () => { calls += 1; return '<html>fixture</html>'; };
    await Promise.all([s.get('/same'), s.get('/same')]); assert.equal(calls, 1);
    s.request = async () => { calls += 1; return { status: 429, body: 'busy', headers: { 'retry-after': ['60'] } }; };
    await assert.rejects(s.get('/limited'), /HTTP 429/);
    await assert.rejects(s.get('/another'), /暫時拒絕/); assert.equal(calls, 2);
  });
  test(kind + ' rejects foreign or malformed work/chapter addresses before requesting', async () => {
    const s = source(kind);
    assert.throws(() => s.path('https://unrelated.invalid/m51/', true), /不是本來源/);
    await assert.rejects(s.watch('/not-a-chapter'), /章節/);
    await assert.rejects(s.detail('/m51/'), /作品/);
  });
}

test('dm5 supports a complete direct-image chapter and does not unlock paid chapters', async () => {
  const s = source('dm5');
  s.request = async () => '<div id="barChapter"><img class="load-src" data-src="https://image.example/a.jpg"><img class="load-src" data-src="https://image.example/b.jpg"></div>';
  assert.equal((await s.watch('/m51/')).urls.length, 2);
  const locked = source('dm5');
  locked.request = async () => '<div class="view-pay-form"><p class="subtitle">本章需要購買</p></div>';
  await assert.rejects(locked.watch('/m51/'), /需要購買/);
});

test('script decoding handles base62 packing and never executes returned JavaScript', () => {
  const s = source('mangabz');
  assert.equal(s.decodeImages(packed(images(1))).length, 2);
  const dictionary = Array.from({ length: 38 }, () => '');
  dictionary[36] = 'var'; dictionary[37] = 'pix';
  const wire = 'eval(function(p,a,c,k,e,d){return p;}(' + JSON.stringify('A B="https://image.example";var pvalue=["/a.jpg"];') +
    ',62,38,' + JSON.stringify(dictionary.join('|')) + '.split("|"),0,{}))';
  assert.equal(s.decodeImages(wire)[0], 'https://image.example/a.jpg');
  const malicious = 'throw new Error("must not execute");' + images(1);
  assert.equal(s.decodeImages(malicious).length, 2);
  for (const input of ['', 'arbitrary code', 'var d=["javascript:alert(1)"];']) assert.throws(() => s.decodeImages(input));
});
