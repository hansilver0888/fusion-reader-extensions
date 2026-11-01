// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test,after} from 'node:test';
import {source,closeBridge} from '../tools/sonovel-harness.mjs';
after(closeBridge);
const meta=(name='原创测试作品',author='示例作者')=>`<meta property="og:novel:book_name" content="${name}"><meta property="og:novel:author" content="${author}"><meta name="description" content="原创简介"><meta property="og:image" content="/cover.jpg">`;
const searchHtml=(entries,next='')=>entries.map(([id,title])=>`<div class="book-coverlist"><h4><a href="/book/${id}/">${title}</a></h4><img src="/cover-${id}.jpg"></div>`).join('')+next;
const tocHtml=(entries,next='')=>meta()+`<dl id="newlist">${entries.map(([id,title])=>`<dd><a href="/book/1/${id}.html">${title}</a></dd>`).join('')}</dl>`+next;
const chapter=(text,next='')=>`<h1 class="readTitle">原创章节</h1><div id="booktxt"><p>${text}</p><script>advertisement();</script></div>${next}`;
function bqg(){const s=source({clock:true});s._active='bqg-info';return s;}

test('standalone distribution carries 13 reviewed rules, provenance and full AGPL license',()=>{
 const s=bqg(),script=fs.readFileSync(new URL('../sources/sonovel.js',import.meta.url),'utf8');
 assert.equal(s.rules().length,13);assert.equal(new Set(s.rules().map(r=>r.id)).size,13);
 assert.match(script,/@license\s+AGPL-3.0-only/);assert.match(script,/88acec6ee489ca1c2489c624cedd1ef417d3f3ee/);
 assert.match(script,/GNU AFFERO GENERAL PUBLIC LICENSE/);assert.doesNotMatch(script,/\b(?:eval|Function)\s*\(/);
});
test('URL resolution handles parents and query strings and refuses other origins',()=>{
 const s=bqg(),r=s.rule('bqg-info');
 assert.equal(s.absolute(r.url+'book/1/index.html','../2/'),'https://www.bqg.info/book/2/');
 assert.equal(s.absolute(r.url+'book/1/index.html','?page=2'),'https://www.bqg.info/book/1/index.html?page=2');
 assert.equal(s.absolute(r.url,'javascript:alert(1)'),'');
 assert.throws(()=>s.pack(r,'https://www.bqg.info.evil.example/book/1/'),/不匹配/);
 assert.throws(()=>s.unpack('sonovel:bqg-info:%ZZ'),/不正确/);
 assert.throws(()=>s.unpack('sonovel:bqg-info:'+encodeURIComponent('https://user@www.bqg.info/book/1/')),/不匹配/);
 assert.throws(()=>s.page(0),/页码/);
});
test('POST keywords and fixed form fields are encoded without form injection',()=>{
 const s=bqg(),r=s.rule('shuhaige-net'),q='原创 &+ /#';
 const request=s.searchRequest(r,q),fields=new URLSearchParams(request.options.data);
 assert.equal(fields.get('searchkey'),q);assert.equal(fields.get('searchtype'),'all');
 assert.equal(Array.from(fields).length,2);assert.equal(request.options.method,'post');
});
test('homepage cards include real book links and exclude chapters and external advertisements',async()=>{
 const s=bqg(),r=s.rule('bqg-info');s.request=async()=>`<a href="/book/1/"><img src="/1.jpg" alt="原创作品"></a><a href="/book/1/">原创作品</a><a href="/book/1/8.html">章节</a><a href="https://unrelated.example/book/2/">外链</a>`;
 const items=await s.latest(1,r.id);assert.equal(items.length,1);assert.equal(items[0].cover,r.url+'1.jpg');assert.equal(items[0].title,'原创作品');
 assert.equal((await s.latest(2,r.id)).length,0);
});
test('homepage aggregation keeps available sites when another site fails',async()=>{
 const s=bqg();s.home=async r=>{if(r.id==='bqg-info')return [{title:'原创',url:'fixture'}];throw Error('offline');};
 assert.equal((await s.latest(1,'all')).length,1);
 s.home=async()=>{throw Error('offline');};await assert.rejects(s.latest(1,'all'),/首页暂时/);
});
test('single-source search uses real selectors and never contacts other sites',async()=>{
 const s=bqg(),calls=[];s.request=async(url,options)=>{calls.push([url,options]);return searchHtml([[1,'原创示例']]);};
 const items=await s.search('原创',1);assert.equal(items.length,1);assert.match(items[0].url,/^sonovel:bqg-info:/);
 assert.equal(calls.length,1);assert.equal(new URL(calls[0][0]).searchParams.get('searchkey'),'原创');assert.equal(calls[0][1].netMode,'direct');
 assert.equal((await s.search('原创',2)).length,0);assert.equal(calls.length,1);
});
test('table headers are skipped and supported selector postprocessing is applied',async()=>{
 const s=bqg(),r=s.rule('d8zw-com');
 const html='<div class="box hot"><dl><dd><h3><a href="/1/2/">[分类]原创小说</a></h3></dd><dd class="book_other"><span>原创作者</span></dd></dl></div>';
 const items=await s.searchResults(r,html,r.url);assert.equal(items.length,1);assert.equal(items[0].title,'原创小说');
 assert.equal(await s.field('<div>更新时间：原创时间</div>','div@js:r=r.replace(/[^：]*：/,\'\')',r.url),'原创时间');
});
test('search pagination is lazy and concurrent same-key callers share the initial request',async()=>{
 const s=bqg(),r=s.rule('bqg-info');r.search.nextPage='a.next';let calls=0;
 s.request=async url=>{calls++;return url.includes('page=2')?searchHtml([[22,'第二页作品']]):searchHtml(Array.from({length:20},(_,i)=>[i+1,'原创作品'+i]),'<a class="next" href="/search/?page=2">下一页</a>');};
 const [a,b]=await Promise.all([s.search('原创',1),s.search('原创',1)]);assert.equal(a.length,20);assert.equal(b.length,20);assert.equal(calls,1);
 const page2=await s.search('原创',2);assert.equal(page2.length,1);assert.equal(calls,2);assert.equal((await s.search('原创',3)).length,0);
});
test('a definite empty search is distinct from all sources failing',async()=>{
 const s=bqg();s.request=async()=>'<html><div>暂无匹配作品</div></html>';assert.equal((await s.search('不存在',1)).length,0);
 s._active='all';s.searchOne=async()=>{throw Error('offline');};await assert.rejects(s.search('原创',1),/均未成功/);
 s.searchOne=async r=>r.id==='bqg-info'?[{title:'原创'}]:Promise.reject(Error('offline'));assert.equal((await s.search('原创',1)).length,1);
});
test('pasting a known detail URL works while foreign links are rejected',async()=>{
 const s=bqg();s.request=async()=>meta();assert.equal((await s.search('https://www.bqg.info/book/1/',1)).length,1);
 await assert.rejects(s.search('https://foreign.example/book/1/',1),/已支持/);assert.equal((await s.search('https://www.bqg.info/book/1/',2)).length,0);
});
test('metadata and a complete same-page catalog share one fetched document',async()=>{
 const s=bqg(),r=s.rule('bqg-info');let calls=0;s.request=async()=>{calls++;return tocHtml([[10,'第一章'],[11,'第二章'],[11,'第二章重复']]);};
 const result=await s.detail(s.pack(r,r.url+'book/1/'));assert.equal(result.title,'原创测试作品');assert.equal(result.authors[0].id,r.id);
 assert.equal(result.cover,r.url+'cover.jpg');assert.equal(result.episodes[0].urls.length,2);assert.equal(calls,1);
});
test('paged catalogs retain order, remove duplicate chapters and terminate directory cycles',async()=>{
 const s=bqg(),r=s.rule('d8zw-com');const calls=[];
 s.request=async url=>{calls.push(url);if(url.endsWith('/1/2/'))return meta();return url.includes('index_2')?
 '<div class="book_list2"><ul><li><a href="/1/2/11.html">第二章</a></li></ul></div><div class="pagination"><li class="page-item active"></li><li><a href="index_1.html">返回</a></li></div>':
 '<div class="book_list2"><ul><li><a href="/1/2/10.html">第一章</a></li><li><a href="/1/2/11.html">第二章</a></li></ul></div><div class="pagination"><li class="page-item active"></li><li><a href="index_2.html">下一页</a></li></div>';};
 const result=await s.detail(s.pack(r,r.url+'1/2/'));assert.deepEqual(Array.from(result.episodes[0].urls,x=>x.name),['第一章','第二章']);assert.equal(calls.length,3);
});
test('encoded-site catalog removes hidden leading/trailing rows and resolves onclick links',async()=>{
 const s=bqg(),r=s.rule('52bqg-com');
 const html='<style>li:nth-child(1){display:none} li:nth-last-child(1){display:none}</style><ul class="section-list"><li>广告</li><li><a onclick="read_tz(77);">原创章</a></li><li>广告</li></ul>';
 const converted=await s.tocMarkup(r,html,'123');assert.doesNotMatch(converted,/广告/);assert.match(converted,/book_123\/77.html/);
});
test('UTF-8 base64 chapter extraction strips scripts and leaves actual paragraphs',async()=>{
 const s=bqg(),r=s.rule('52bqg-com'),text='<p>自制中文段落🌸</p>',payload=Buffer.from(text).toString('base64');
 const html=`<div class="word_read"><h3>原创章（第2页）</h3><script>document.writeln('${payload}');</script></div>`;
 const blocks=await s.chapter(r,html,r.url);assert.equal(Array.from(blocks).join(''),'自制中文段落🌸');
 assert.equal(await s.field(html,r.chapter.title,r.url),'原创章');assert.throws(()=>s.base64('$$$'),/编码/);
});
test('chapter pagination reads only remaining pages of the current chapter',async()=>{
 const s=bqg(),r=s.rule('bqg-info'),calls=[];
 s.request=async url=>{calls.push(url);return url.endsWith('10_2.html')?chapter('自制第二段','<a id="linkNext" href="11.html">下一章</a>'):chapter('自制第一段','<a id="linkNext" href="10_2.html">下一页</a>');};
 const result=await s.watch(s.pack(r,r.url+'book/1/10.html'));assert.deepEqual(Array.from(result.content),['自制第一段','自制第二段']);assert.equal(calls.length,2);
 assert.equal(result.netMode,'direct');assert.equal(result.headers.Referer,r.url+'book/1/10.html');
});
test('encoded next-page scripts are read as data without executing script contents',async()=>{
 const s=bqg(),r=s.rule('52bqg-com');
 const html="<script>var next='77_2.html'; if(key==39)location=next; forbidden();</script>";
 assert.equal(await s.nextChapterPage(r,html,r.url+'book_1/77.html'),r.url+'book_1/77_2.html');
});
test('circular chapter pages and empty catalogs fail instead of caching partial content',async()=>{
 const s=bqg(),r=s.rule('bqg-info');s.request=async url=>chapter('原创',`<a id="linkNext" href="${url.includes('_2')?'10.html':'10_2.html'}">下一页</a>`);
 await assert.rejects(s.watch(s.pack(r,r.url+'book/1/10.html')),/分页异常/);
 s.advance(61000);s.request=async()=>meta();await assert.rejects(s.detail(s.pack(r,r.url+'book/1/')),/未返回可阅读章节/);
});
test('verification responses and network errors never expose raw page or private errors',async()=>{
 const s=bqg(),r=s.rule('bqg-info');s.request=async()=>'<html><form id="challenge-form">private-body</form></html>';
 await assert.rejects(s.html(r,r.url),error=>/验证/.test(error.message)&&!error.message.includes('private-body'));
 assert.equal(s._cache.size,0);s.request=async()=>{throw Error('private-http-headers');};
 await assert.rejects(s.html(r,r.url),error=>!error.message.includes('private-http-headers'));
});
test('cached responses coalesce requests and source pacing honors search-specific intervals',async()=>{
 const s=bqg(),r=s.rule('biquge365-net');let calls=0;const sleeps=[];s.sleep=async ms=>{sleeps.push(ms);s.advance(ms);};s.request=async()=>{calls++;return '<html>原创</html>';};
 await Promise.all([s.html(r,r.url),s.html(r,r.url)]);assert.equal(calls,1);
 await s.html(r,r.url+'s.php',{method:'post',data:'s=one',search:true});await s.html(r,r.url+'s.php',{method:'post',data:'s=two',search:true});
 assert.equal(calls,3);assert.ok(sleeps.some(ms=>ms>=15000));
});


test('detached table rows retain td selectors under the host HTML5 parsing model',async()=>{
 const s=bqg(),r=s.rule('ibiqugu-net');
 const html='<div id="checkform"><table><tr><th>标题</th></tr><tr><td class="even"><a href="/1/12/">原创表格作品</a></td><td class="odd"><a>原创章节</a></td><td>示例作者</td><td>时间</td></tr></table></div>';
 const items=await s.searchResults(r,html,r.url);assert.equal(items.length,1);assert.equal(items[0].title,'原创表格作品');
});
test('a next-chapter filename is not mistaken for another page of the current chapter',()=>{
 const s=bqg();assert.equal(s.sameChapter('https://example/book/chapter_1.html','https://example/book/chapter_2.html'),false);
 assert.equal(s.sameChapter('https://example/book/123.html','https://example/book/123_2.html'),true);
});
test('a page explicitly saying the chapter is unfinished cannot succeed without a next-page link',async()=>{
 const s=bqg(),r=s.rule('bqg-info');s.request=async()=>chapter('原创段落。本章未完，请点击下一页继续阅读');
 await assert.rejects(s.watch(s.pack(r,r.url+'book/1/10.html')),/未保存不完整/);
});
// New regression for image-element cover rules from the upstream default set.
test('source cover rules ending at an img element retain its src',async()=>{
 const s=bqg(),r=s.rule('ujxsw-org');
 const result=await s.metadata(r,meta()+'<div id="bookimg"><a><img src="/original-cover.jpg"></a></div>',r.url+'book/1/');
 assert.equal(result.coverUrl,r.url+'original-cover.jpg');
});


test('a latest-chapters preview never takes precedence over the full catalog order',async()=>{
 const s=bqg(),r=s.rule('bqg-info');s.request=async()=>tocHtml([[12,'第三章'],[10,'第一章'],[11,'第二章'],[12,'第三章']]);
 const result=await s.detail(s.pack(r,r.url+'book/1/'));
 assert.deepEqual(Array.from(result.episodes[0].urls,x=>x.name),['第一章','第二章','第三章']);
});
