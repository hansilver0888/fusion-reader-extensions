// SPDX-License-Identifier: MIT
// Offline tests for the shuyuan (Legado book-source engine) plugin.
// Original fixtures only; real HTML5 DOM parsing via the shared Python bridge.
// The extension runs in a vm realm, so structures crossing the boundary are
// normalized with plain()/Array.from() before deep comparison.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test, after } from 'node:test';
import { source, closeBridge } from '../tools/shuyuan-harness.mjs';
after(closeBridge);

const plain = (v) => JSON.parse(JSON.stringify(v));
const LIST_URL = 'https://repo.example.test/good.json';

const CSS_SOURCE = {
  bookSourceName: '原创测试源', bookSourceUrl: 'https://example.test', bookSourceType: 0, enabled: true,
  header: '{"User-Agent": "TestAgent/1.0"}',
  searchUrl: '/search.php?q={{key}}<,&p={{page-1}}>',
  exploreUrl: '玄幻::/list1/{{page}}/html\n完本::/quanben/<,{{page}}/>',
  ruleSearch: { bookList: '.row dl', name: 'tag.a.1@text##《|》', author: 'span@text', bookUrl: 'tag.a.1@href',
    coverUrl: 'img@src', lastChapter: 'tag.a.-1@text' },
  ruleExplore: { bookList: '.row dl', name: 'tag.a.1@text', bookUrl: 'tag.a.1@href', coverUrl: 'img@src' },
  ruleBookInfo: { name: '[property$=book_name]@content', author: '[property$=author]@content',
    coverUrl: '[property$=image]@content', intro: '[property$=description]@content', tocUrl: '{{baseUrl}}##$##ajax_index.html' },
  ruleToc: { chapterList: 'ul.row li a', chapterName: 'text', chapterUrl: 'href',
    nextTocUrl: '.page-item.active + .page-item a@href' },
  ruleContent: { content: '.font_max@html', nextContentUrl: 'text.下一@href', replaceRegex: '##本章未完.*' },
};
const POST_SOURCE = {
  bookSourceName: '原创表单源', bookSourceUrl: 'https://post.example.test', bookSourceType: 0, enabled: true,
  searchUrl: '/search,{\n"method":"post",\n"body":"searchkey={{key}}&searchtype=name"\n}',
  ruleSearch: { bookList: '.item', name: 'h3 a@text', bookUrl: 'h3 a@href', author: 'p.1@text' },
  ruleBookInfo: { name: 'h1@text' },
  ruleToc: { chapterList: '#list li a', chapterName: 'text', chapterUrl: 'href' },
  ruleContent: { content: '#content@text' },
};
const JSON_SOURCE = {
  bookSourceName: '原创接口源', bookSourceUrl: 'https://api.example.test', bookSourceType: 0, enabled: true,
  searchUrl: '/api/search?key={{key}}&page={{page}}',
  ruleSearch: { bookList: '$.data[*]', name: '$.bookName', author: '$.authorName', bookUrl: '$.id', coverUrl: '$.cover' },
  ruleBookInfo: { name: '$.info.name', author: '$.info.author', intro: '$.info.desc' },
  ruleToc: { chapterList: '$.chapters[*]', chapterName: '$.name', chapterUrl: '$.url||href' },
  ruleContent: { content: '$.text' },
};
const JSOUP_SOURCE = {
  bookSourceName: '原创规则源', bookSourceUrl: 'https://jsoup.example.test', bookSourceType: 0, enabled: true,
  searchUrl: 'https://jsoup.example.test/s.aspx?key={{key}}',
  ruleSearch: { bookList: 'class.item', name: 'tag.h3@tag.a@text## -原创站', author: 'class.author@text##作者：',
    bookUrl: 'tag.h3@tag.a@href', coverUrl: 'tag.img@src', lastChapter: 'tag.li.0@tag.a@text' },
  ruleBookInfo: { name: 'tag.h1@text', author: 'class.author@tag.a@text', intro: 'class.desc@tag.p@text' },
  ruleToc: { chapterList: 'id.list@tag.li', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href',
    nextTocUrl: "@xpath://div[@class='pages']//a[contains(text(),'下一页')]/@href" },
  ruleContent: { content: 'class.con@html##<div.*?>|</div>',
    nextContentUrl: "@xpath://div[@class='prenext']//a[contains(text(),'下一页')]/@href" },
};
const PUT_SOURCE = {
  bookSourceName: '原创变量源', bookSourceUrl: 'https://vars.example.test', bookSourceType: 0, enabled: true,
  searchUrl: '/s?q={{key}}',
  ruleSearch: { bookList: '.b', name: 'a@text', bookUrl: 'a@href' },
  ruleBookInfo: { init: '@put:{n:"h1@text",a:"[property$=author]@content"}', name: '@get:{n}', author: '@get:{a}' },
  ruleToc: { chapterList: 'li a', chapterName: 'text', chapterUrl: 'href' },
  ruleContent: { content: '#c@text' },
};
const JS_SOURCE = {
  bookSourceName: '脚本源', bookSourceUrl: 'https://js.example.test', bookSourceType: 0, enabled: true,
  searchUrl: '@js:java.ajax(baseUrl)',
  ruleSearch: { bookList: '<js>result</js>', name: 'a@text', bookUrl: 'a@href' },
  ruleToc: { chapterList: 'li a', chapterName: 'text', chapterUrl: 'href' },
  ruleContent: { content: '#c@text' },
};
const DISABLED_SOURCE = { ...CSS_SOURCE, bookSourceName: '停用源', bookSourceUrl: 'https://off.example.test', enabled: false };
const AUDIO_SOURCE = { ...CSS_SOURCE, bookSourceName: '音频源', bookSourceUrl: 'https://audio.example.test', bookSourceType: 1 };
const NOCONTENT_SOURCE = { ...CSS_SOURCE, bookSourceName: '无正文源', bookSourceUrl: 'https://nocontent.example.test', ruleContent: {} };
const ALL = [CSS_SOURCE, JS_SOURCE, DISABLED_SOURCE, AUDIO_SOURCE, NOCONTENT_SOURCE,
  POST_SOURCE, JSON_SOURCE, JSOUP_SOURCE, PUT_SOURCE, { ...CSS_SOURCE }];

function ext(settings = {}, router = null) {
  const s = source({ sourceUrl: LIST_URL, ...settings });
  const calls = [];
  s.request = async (url, options) => {
    calls.push({ url, options });
    if (url === LIST_URL) return ALL;
    if (router) return router(url, options);
    throw new Error('Unexpected URL in test: ' + url);
  };
  s.calls = calls;
  return s;
}

const searchPage = `<div class="row"><dl><dd><a href="/cover/1.jpg"><img src="/cover/1.jpg"></a></dd><dd><a href="/book/1/">《原创测试书》</a></dd><dd><span>原创作者</span></dd><dd><a href="/book/1/9.html">第九章 原创</a></dd></dl></div>`;
const explorePage = `<div class="row"><dl><dd><a href="/cover/2.jpg"><img src="/cover/2.jpg"></a></dd><dd><a href="/book/2/">原创发现书</a></dd></dl></div>`;
const metaPage = `<meta property="og:novel:book_name" content="原创测试书"><meta property="og:novel:author" content="原创作者"><meta property="og:image" content="/cover.jpg"><meta property="og:novel:description" content="原创简介">`;
const tocPage1 = `<ul class="row"><li><a href="/book/1/1.html">第一章 原创</a></li><li><a href="/book/1/2.html">第二章 原创</a></li></ul><ul class="pagination"><li class="page-item active"><a>1</a></li><li class="page-item"><a href="ajax_2.html">2</a></li></ul>`;
const tocPage2 = `<ul class="row"><li><a href="/book/1/3.html">第三章 原创</a></li><li><a href="/book/1/1.html">第一章 原创</a></li></ul><ul class="pagination"><li class="page-item"><a href="ajax_index.html">1</a></li><li class="page-item active"><a>2</a></li></ul>`;
const chapterPage1 = `<div class="font_max"><p>原创第一段。</p><p>本章未完广告</p></div><a href="1_2.html">下一页</a>`;
const chapterPage2 = `<div class="font_max"><p>第二段原创。</p></div>`;
const jsoupSearch = `<div class="item"><h3><a href="/book/9/">原创规则书 -原创站</a></h3><p class="author">作者：规则作者</p><img src="/c/9.jpg"><ul><li><a href="/book/9/3.html">第三章</a></li></ul></div>`;
const jsoupBook1 = `<h1>原创规则书</h1><p class="author"><a>规则作者</a></p><div class="desc"><p>原创规则简介</p></div><div id="list"><li><a href="/book/9/1.html">第一章 规则</a></li></div><div class="pages"><a href="2.html">下一页</a></div>`;
const jsoupBook2 = `<div id="list"><li><a href="/book/9/2.html">第二章 规则</a></li></div><div class="pages"><a href="1.html">上一页</a></div>`;

test('distribution carries engine metadata, provenance and no dynamic code execution', () => {
  const script = fs.readFileSync(new URL('../sources/shuyuan.js', import.meta.url), 'utf8');
  assert.match(script, /@package\s+shuyuan/);
  assert.match(script, /@license\s+MIT/);
  assert.match(script, /@version\s+v\d+\.\d+\.\d+/);
  assert.match(script, /shidahuilang\/shuyuan-bak/);
  assert.match(script, /不执行/);
  assert.doesNotMatch(script, /\b(?:eval|Function)\s*\(/);
  assert.doesNotMatch(script, /new\s+Function/);
});

test('JS-dependent, disabled, non-text and unreadable sources are filtered before use', async () => {
  const s = ext();
  const list = await s.sourceList(false);
  assert.deepEqual(Array.from(list, (x) => x.bookSourceName),
    ['原创测试源', '原创表单源', '原创接口源', '原创规则源', '原创变量源']);
});

test('source list is cached and github page links are converted to raw links', async () => {
  const s = ext();
  await s.sourceList(false);
  await s.sourceList(false);
  assert.equal(s.calls.filter((c) => c.url === LIST_URL).length, 1);
  assert.equal(s.rawUrl('https://github.com/shidahuilang/shuyuan-bak/blob/main/good.json'),
    'https://raw.githubusercontent.com/shidahuilang/shuyuan-bak/main/good.json');
});

test('source selection matches exact name, fragment and rejects unknown names', async () => {
  assert.equal((await ext({ sourceName: '表单' }).selectedSource()).bookSourceName, '原创表单源');
  assert.equal((await ext({ sourceName: 'jsoup.example.test' }).selectedSource()).bookSourceName, '原创规则源');
  assert.equal((await ext().selectedSource()).bookSourceName, '原创测试源');
  await assert.rejects(ext({ sourceName: '不存在' }).selectedSource(), /没有找到/);
});

test('bounded arithmetic replaces eval inside url templates', async () => {
  const s = ext();
  assert.equal(s.calc('(3-1)*20'), 40);
  assert.equal(s.calc('6/3+1'), 3);
  assert.equal(s.calc('3/0'), null);
  assert.equal(s.calc('page'), null);
  assert.equal(await s.fillTemplate('/a/{{page-1}}/b<,?p={{page}}>', { page: 3 }), '/a/2/b?p=3');
  assert.equal(await s.fillTemplate('/a/{{page-1}}/b<,?p={{page}}>', { page: 2 }), '/a/1/b?p=2');
  assert.equal(await s.fillTemplate('/a/{{page-1}}/b<,?p={{page}}>', { page: 1 }), '/a/0/b');
});

test('GET search encodes keywords, honors conditional page segments and source headers', async () => {
  const s = ext({}, () => searchPage);
  const items = await s.search('原创', 1);
  assert.equal(s.calls[1].url, 'https://example.test/search.php?q=%E5%8E%9F%E5%88%9B');
  assert.equal(s.calls[1].options.headers['User-Agent'], 'TestAgent/1.0');
  assert.equal(items.length, 1);
  assert.deepEqual(plain(items[0]), { title: '原创测试书', url: 'https://example.test/book/1/',
    cover: 'https://example.test/cover/1.jpg', update: '原创作者 · 第九章 原创' });
  const page2 = await s.search('原创', 2);
  assert.equal(s.calls[2].url, 'https://example.test/search.php?q=%E5%8E%9F%E5%88%9B&p=1');
  assert.equal(page2.length, 1);
});

test('POST search sends form-encoded body from url options', async () => {
  const s = ext({ sourceName: '表单' }, () => `<div class="item"><h3><a href="/book/2/">原创表单书</a></h3><p>分类</p><p>表单作者</p></div>`);
  const items = await s.search('原创', 1);
  const call = s.calls[1];
  assert.equal(call.options.method, 'post');
  assert.equal(call.options.data, 'searchkey=%E5%8E%9F%E5%88%9B&searchtype=name');
  assert.equal(call.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(items[0].title, '原创表单书');
  assert.equal(items[0].update, '表单作者');
});

test('search without page parameters stops after page one and empty keywords never request', async () => {
  const s = ext({ sourceName: '规则' }, () => jsoupSearch);
  assert.equal((await s.search('原创', 1)).length, 1);
  const before = s.calls.length;
  assert.deepEqual(plain(await s.search('原创', 2)), []);
  assert.deepEqual(plain(await s.search('', 1)), []);
  assert.equal(s.calls.length, before);
});

test('jsoup default rules parse class/tag segments, indexes and regex cleanup', async () => {
  const s = ext({ sourceName: '规则' }, () => jsoupSearch);
  const items = await s.search('原创', 1);
  assert.deepEqual(plain(items[0]), { title: '原创规则书', url: 'https://jsoup.example.test/book/9/',
    cover: 'https://jsoup.example.test/c/9.jpg', update: '规则作者 · 第三章' });
});

test('json api sources are read through the jsonpath subset', async () => {
  const s = ext({ sourceName: '接口' }, (url) => {
    if (url.startsWith('https://api.example.test/api/search')) {
      return { data: [{ bookName: '接口书', authorName: '接口作者', id: '/book/5', cover: '/c/5.jpg' }] };
    }
    if (url === 'https://api.example.test/book/5') {
      return { info: { name: '接口书', author: '接口作者', desc: '接口简介' },
        chapters: [{ name: '第一章 接口', url: '/book/5/1.html' }, { name: '第一章 接口', url: '/book/5/1.html' }] };
    }
    if (url === 'https://api.example.test/book/5/1.html') return { text: '接口正文第一段\n接口正文第二段' };
    throw new Error('Unexpected URL in test: ' + url);
  });
  const items = await s.search('接口', 1);
  assert.equal(s.calls[1].url, 'https://api.example.test/api/search?key=%E6%8E%A5%E5%8F%A3&page=1');
  assert.deepEqual(plain(items[0]), { title: '接口书', url: 'https://api.example.test/book/5',
    cover: 'https://api.example.test/c/5.jpg', update: '接口作者' });
  const detail = await s.detail('https://api.example.test/book/5');
  assert.equal(detail.title, '接口书');
  assert.deepEqual(plain(detail.authors), [{ name: '接口作者' }]);
  assert.deepEqual(plain(detail.episodes[0].urls), [{ name: '第一章 接口', url: 'https://api.example.test/book/5/1.html' }]);
  const read = await s.watch('https://api.example.test/book/5/1.html');
  assert.deepEqual(plain(read.content), ['接口正文第一段', '接口正文第二段']);
  assert.equal(s.evalJsonPath('$..book', { html: { book: 1 } }), '');
});

test('explore channels come from the selected source and drive latest()', async () => {
  const s = ext({}, (url) => {
    if (url.startsWith('https://example.test/list1/') || url.startsWith('https://example.test/quanben/')) return explorePage;
    throw new Error('Unexpected URL in test: ' + url);
  });
  assert.deepEqual(plain(await s.channels()), [
    { title: '玄幻', key: '/list1/{{page}}/html' },
    { title: '完本', key: '/quanben/<,{{page}}/>' }]);
  const items = await s.latest(1);
  assert.equal(s.calls[s.calls.length - 1].url, 'https://example.test/list1/1/html');
  assert.equal(items[0].title, '原创发现书');
  await s.latest(2, '/quanben/<,{{page}}/>');
  assert.equal(s.calls[s.calls.length - 1].url, 'https://example.test/quanben/2/');
  await assert.rejects(s.latest(1, '/不存在/'), /分类不存在/);
  assert.deepEqual(plain(s.exploreChannels({ exploreUrl: '[{"title":"限免","url":"/free/{{page}}","style":{"x":1}},{"title":"无地址","url":""}]' })),
    [{ title: '限免', key: '/free/{{page}}' }]);
});

test('detail follows tocUrl rewrite, pages the catalog and removes duplicate chapters', async () => {
  const s = ext({}, (url) => {
    if (url === 'https://example.test/book/1/') return metaPage;
    if (url === 'https://example.test/book/1/ajax_index.html') return tocPage1;
    if (url === 'https://example.test/book/1/ajax_2.html') return tocPage2;
    throw new Error('Unexpected URL in test: ' + url);
  });
  const detail = await s.detail('https://example.test/book/1/');
  assert.equal(detail.title, '原创测试书');
  assert.equal(detail.cover, 'https://example.test/cover.jpg');
  assert.equal(detail.desc, '原创简介');
  assert.deepEqual(plain(detail.authors), [{ name: '原创作者' }]);
  assert.deepEqual(Array.from(detail.episodes[0].urls, (x) => x.name), ['第一章 原创', '第二章 原创', '第三章 原创']);
  assert.deepEqual(Array.from(detail.episodes[0].urls, (x) => x.url),
    ['https://example.test/book/1/1.html', 'https://example.test/book/1/2.html', 'https://example.test/book/1/3.html']);
});

test('catalog pagination terminates on cycles and missing pages keep valid titles', async () => {
  // 第二页的“下一页”指回第一页时必须终止而不是循环抓取。
  const cyclic = ext({}, (url) => {
    if (url === 'https://example.test/book/1/') return metaPage;
    if (url === 'https://example.test/book/1/ajax_index.html') return tocPage1;
    if (url === 'https://example.test/book/1/ajax_2.html') {
      return `<ul class="row"><li><a href="/book/1/3.html">第三章 原创</a></li></ul><ul class="pagination"><li class="page-item"><a>1</a></li><li class="page-item active"><a>2</a></li><li class="page-item"><a href="ajax_index.html">下一页</a></li></ul>`;
    }
    throw new Error('Unexpected URL in test: ' + url);
  });
  const detail = await cyclic.detail('https://example.test/book/1/');
  assert.deepEqual(Array.from(detail.episodes[0].urls, (x) => x.name), ['第一章 原创', '第二章 原创', '第三章 原创']);
  assert.equal(cyclic.calls.filter((c) => c.url === 'https://example.test/book/1/ajax_index.html').length, 1);
  const empty = ext({}, () => '<html><body>没有元数据</body></html>');
  await assert.rejects(empty.detail('https://example.test/book/1/'), /未返回作品详情/);
});

test('chapter reading merges content pages, applies replaceRegex and stops on cycles', async () => {
  const s = ext({}, (url) => {
    if (url === 'https://example.test/book/1/1.html') return chapterPage1;
    if (url === 'https://example.test/book/1/1_2.html') return chapterPage2;
    throw new Error('Unexpected URL in test: ' + url);
  });
  const read = await s.watch('https://example.test/book/1/1.html');
  assert.deepEqual(plain(read.content), ['原创第一段。', '第二段原创。']);
  assert.equal(read.headers.Referer, 'https://example.test/book/1/1.html');
  const loop = ext({}, (url) => {
    if (url === 'https://example.test/book/1/1.html') return chapterPage1;
    if (url === 'https://example.test/book/1/1_2.html') return chapterPage2.replace('</div>', '</div><a href="1.html">下一页</a>');
    throw new Error('Unexpected URL in test: ' + url);
  });
  const looped = await loop.watch('https://example.test/book/1/1.html');
  assert.deepEqual(plain(looped.content), ['原创第一段。', '第二段原创。']);
  assert.equal(loop.calls.length, 3); // 列表 + 两个章节页，回链被识别后不再抓取
  const blank = ext({}, () => '<div class="font_max"></div>');
  await assert.rejects(blank.watch('https://example.test/book/1/1.html'), /没有可阅读内容/);
});

test('jsoup source reads catalog through the xpath subset for next-page links', async () => {
  const s = ext({ sourceName: '规则' }, (url) => {
    if (url === 'https://jsoup.example.test/book/9/') return jsoupBook1;
    if (url === 'https://jsoup.example.test/book/9/2.html') return jsoupBook2;
    throw new Error('Unexpected URL in test: ' + url);
  });
  const detail = await s.detail('https://jsoup.example.test/book/9/');
  assert.equal(detail.title, '原创规则书');
  assert.equal(detail.desc, '原创规则简介');
  assert.deepEqual(plain(detail.authors), [{ name: '规则作者' }]);
  assert.deepEqual(plain(detail.episodes[0].urls), [
    { name: '第一章 规则', url: 'https://jsoup.example.test/book/9/1.html' },
    { name: '第二章 规则', url: 'https://jsoup.example.test/book/9/2.html' }]);
});

test('put/get variables persist per book and feed metadata fields', async () => {
  const s = ext({ sourceName: '变量' }, () => `<h1>变量书</h1><meta property="og:author" content="变量作者"><ul><li><a href="/v/1.html">第一章 变量</a></li></ul>`);
  const detail = await s.detail('https://vars.example.test/book/3/');
  assert.equal(detail.title, '变量书');
  assert.deepEqual(plain(detail.authors), [{ name: '变量作者' }]);
  assert.deepEqual(plain(detail.episodes[0].urls), [{ name: '第一章 变量', url: 'https://vars.example.test/v/1.html' }]);
});

test('pasting a detail url opens the matching source and foreign hosts are rejected', async () => {
  const s = ext({}, (url) => {
    if (url === 'https://post.example.test/book/2/') return '<h1>粘贴书</h1>';
    throw new Error('Unexpected URL in test: ' + url);
  });
  const items = await s.search('https://post.example.test/book/2/', 1);
  assert.deepEqual(plain(items), [{ title: '粘贴书', url: 'https://post.example.test/book/2/', cover: '', update: '原创表单源' }]);
  assert.deepEqual(plain(await s.search('https://post.example.test/book/2/', 2)), []);
  await assert.rejects(s.search('https://foreign.example.test/book/1/', 1), /不属于/);
});

test('builtin list only exposes hosts present in the source json', async () => {
  // 内置清单里的 booksky.cc 出现在书源数据中，其余内置站点不存在时应被隐藏。
  const builtinSource = {
    bookSourceName: '快眼看书', bookSourceUrl: 'https://www.booksky.cc/', bookSourceType: 0, enabled: true,
    exploreUrl: '玄幻::/sort1/{{page}}.html',
    searchUrl: '/search.php?q={{key}}',
    ruleSearch: { bookList: '.item', name: 'h3 a@text', bookUrl: 'h3 a@href' },
    ruleExplore: { bookList: '.item', name: 'h3 a@text', bookUrl: 'h3 a@href' },
    ruleBookInfo: { name: 'h1@text' },
    ruleToc: { chapterList: '#list li a', chapterName: 'text', chapterUrl: 'href' },
    ruleContent: { content: '#content@text' },
  };
  const s = source({ sourceUrl: LIST_URL });
  s.request = async (url) => {
    if (url === LIST_URL) return [builtinSource];
    throw new Error('unexpected ' + url);
  };
  const builtins = await s.availableBuiltins();
  assert.deepEqual(Array.from(builtins, (b) => b.host), ['booksky.cc']);
  const channels = await s.channels();
  assert.deepEqual(plain(channels), [{ title: '快眼看书·玄幻', key: 'auto|booksky.cc|/sort1/{{page}}.html' }]);
});

test('builtin channel selection drives latest and is remembered for search', async () => {
  const builtinSource = {
    bookSourceName: '快眼看书', bookSourceUrl: 'https://www.booksky.cc/', bookSourceType: 0, enabled: true,
    exploreUrl: '玄幻::/sort1/{{page}}.html',
    searchUrl: '/search.php?q={{key}}',
    ruleSearch: { bookList: '.item', name: 'h3 a@text', bookUrl: 'h3 a@href' },
    ruleExplore: { bookList: '.item', name: 'h3 a@text', bookUrl: 'h3 a@href' },
    ruleBookInfo: { name: 'h1@text' },
    ruleToc: { chapterList: '#list li a', chapterName: 'text', chapterUrl: 'href' },
    ruleContent: { content: '#content@text' },
  };
  const page = `<div class="item"><h3><a href="/book/7/">山河稷</a></h3></div>`;
  const s = source({ sourceUrl: LIST_URL });
  const calls = [];
  s.request = async (url) => {
    calls.push(url);
    if (url === LIST_URL) return [builtinSource];
    return page;
  };
  const items = await s.latest(2, 'auto|booksky.cc|/sort1/{{page}}.html');
  assert.equal(calls[calls.length - 1], 'https://www.booksky.cc/sort1/2.html');
  assert.equal(items[0].title, '山河稷');
  // 点选过的书源会被记住，搜索直接走它。
  const found = await s.search('山河稷', 1);
  assert.equal(calls[calls.length - 1], 'https://www.booksky.cc/search.php?q=%E5%B1%B1%E6%B2%B3%E7%A8%B7');
  assert.equal(found[0].title, '山河稷');
});

test('search falls back across builtin sources until one returns results', async () => {
  const emptySource = {
    bookSourceName: '空结果源', bookSourceUrl: 'https://booksky.cc/', bookSourceType: 0, enabled: true,
    searchUrl: '/search?q={{key}}',
    ruleSearch: { bookList: '.item', name: 'h3 a@text', bookUrl: 'h3 a@href' },
    ruleBookInfo: { name: 'h1@text' },
    ruleToc: { chapterList: 'li a', chapterName: 'text', chapterUrl: 'href' },
    ruleContent: { content: '#c@text' },
  };
  const goodSource = {
    bookSourceName: '有结果源', bookSourceUrl: 'https://b.faloo.com/', bookSourceType: 0, enabled: true,
    searchUrl: '/search?q={{key}}',
    ruleSearch: { bookList: '.item', name: 'h3 a@text', bookUrl: 'h3 a@href' },
    ruleBookInfo: { name: 'h1@text' },
    ruleToc: { chapterList: 'li a', chapterName: 'text', chapterUrl: 'href' },
    ruleContent: { content: '#c@text' },
  };
  const s = source({ sourceUrl: LIST_URL });
  const calls = [];
  s.request = async (url) => {
    calls.push(url);
    if (url === LIST_URL) return [emptySource, goodSource];
    if (url.startsWith('https://booksky.cc/')) return '<html><body>没有找到相关作品</body></html>';
    return '<div class="item"><h3><a href="/book/9/">找到的书</a></h3></div>';
  };
  const items = await s.search('随便', 1);
  assert.equal(items[0].title, '找到的书');
  assert.equal(calls.filter((u) => u.startsWith('https://booksky.cc/')).length, 1);
  assert.equal(calls.filter((u) => u.startsWith('https://b.faloo.com/')).length, 1);
});

test('rule helpers keep invalid input safe instead of failing whole sources', () => {
  const s = ext();
  assert.deepEqual(plain(s.splitRegex('a@text##re##$1###')), { body: 'a@text', regex: 're', repl: '$1', flags: '' });
  assert.equal(s.applyRegex('原创文字', { regex: '([', repl: '' }), '原创文字');
  assert.equal(s.applyRegex('《原创》', { regex: '《|》', repl: '' }), '原创');
  assert.deepEqual(plain(s.pickIndex(['a', 'b', 'c'], s.parseIndex('-1'))), ['c']);
  assert.deepEqual(plain(s.pickIndex(['a', 'b', 'c'], s.parseIndex('0:1'))), ['a', 'b']);
  assert.equal(s.host('https://WWW.Example.test/a/b?c=1#d'), 'example.test');
  assert.equal(s.abs('https://example.test/book/1/', '../2/'), 'https://example.test/book/2/');
  assert.equal(s.abs('https://example.test/', 'javascript:alert(1)'), '');
  assert.equal(s.looseJson("{method:'post'}").method, 'post');
});
