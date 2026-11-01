// ==MiruExtension==
// @name         So Novel 多书源
// @version      v0.1.0
// @minAppVersion 1.4.0
// @author       So Novel contributors / community adaptation
// @lang         zh
// @license      AGPL-3.0-only
// @package      sonovel
// @type         fikushon
// @icon         https://raw.githubusercontent.com/freeok/so-novel/main/assets/logo.png
// @webSite      https://github.com/freeok/so-novel
// @network      direct
// @nsfw         false
// ==/MiruExtension==
// Adapted from freeok/so-novel by pcdd and contributors.
// Upstream: https://github.com/freeok/so-novel/tree/88acec6ee489ca1c2489c624cedd1ef417d3f3ee
// Rules: bundle/rules/main.json (SHA-256 9ffaf5324138a7f62cf567175ef8a8d26af3037d42ee5bb772093a201625e92e)
// Corresponding adaptation source is distributed in this repository under AGPL-3.0-only.
// Modifications: JavaScript host bridge, bounded pagination, paced requests and reading results.

const SONOVEL_RULES = [
  {
    "url": "http://www.ibiqugu.net/",
    "name": "香书小说",
    "comment": "",
    "search": {
      "url": "http://www.ibiqugu.net/modules/article/waps.php",
      "method": "post",
      "data": "{searchkey: %s}",
      "result": "#checkform > table > tbody > tr",
      "bookName": "td.even > a",
      "author": "td:nth-of-type(3)",
      "latestChapter": "td.odd > a",
      "lastUpdateTime": "td:nth-of-type(4)"
    },
    "book": {
      "latestChapter": "#info > p:nth-child(5) > a",
      "latestChapterUrl": "#info > p:nth-child(5) > a@href",
      "lastUpdateTime": "#info > p:nth-child(4)"
    },
    "toc": {
      "item": "#list > dl > dd > a"
    },
    "chapter": {
      "title": ".bookname > h1",
      "content": "#content",
      "paragraphTagClosed": false,
      "paragraphTag": "<br>+",
      "filterTxt": "一秒记住【文学巴士&nbsp;】，精彩无弹窗免费阅读！|(www.xbiquge.la 新笔趣阁)，高速全文字在线阅读！|天才一秒记住本站地址：.+。手机版阅读网址：m.|手机用户请浏览阅读，更优质的阅读体验。|天才壹秒記住.+，為您提供精彩小說閱讀。|\\(本章完\\)",
      "filterTag": "div, p, script"
    },
    "id": "ibiqugu-net",
    "homePattern": "^/\\d+/\\d+/$",
    "encoded": false,
    "searchInterval": 700
  },
  {
    "url": "https://www.shuhaige.net/",
    "name": "书海阁小说网",
    "comment": "部分书源正文段落顺序错乱的书在这里可能正常，搜索爬取过快会丢包(Unexpected end of file from server)",
    "search": {
      "url": "https://www.shuhaige.net/search.html",
      "method": "post",
      "data": "{searchkey: %s, searchtype: all}",
      "cookies": "waf_sc=''; HMACCOUNT=''",
      "result": "#sitembox > dl",
      "bookName": "dd > h3 > a",
      "author": "dd:nth-child(3) > span:nth-child(1)",
      "category": "dd:nth-child(3) > span:nth-child(3)",
      "latestChapter": "dd:nth-child(5) > a",
      "lastUpdateTime": "dd:nth-child(5) > span",
      "wordCount": "dd:nth-child(3) > span:nth-child(4)",
      "status": "dd:nth-child(3) > span:nth-child(2)",
      "nextPage": "#pagelink > a:not(.pgroup):not(.ngroup)"
    },
    "book": {
      "intro": "#intro > p:nth-child(1)"
    },
    "toc": {
      "item": "dl > dt:nth-of-type(2) ~ dd > a"
    },
    "chapter": {
      "title": ".bookname > h1",
      "content": "#content",
      "paragraphTagClosed": true,
      "filterTxt": "本小章还未完，请点击下一页继续阅读后面精彩内容！|小主，这个章节后面还有哦，请点击下一页继续阅读，后面更精彩！|这章没有结束，请点击下一页继续阅读！|喜欢(.+?)请大家收藏：\\(([^)]+)\\)\\1书海阁小说网更新速度全网最快。|\\(本章完\\)",
      "filterTag": ".bottem2, hr, script, table",
      "nextPage": "#pager_next"
    },
    "id": "shuhaige-net",
    "homePattern": "^/\\d+/$",
    "encoded": false,
    "searchInterval": 700
  },
  {
    "url": "http://www.mcxs.la/",
    "name": "梦书中文",
    "comment": "搜索有限流(Connect timed out)",
    "search": {
      "url": "http://www.mcxs.la/search.html",
      "method": "post",
      "data": "{name: %s}",
      "result": ".novelslist2 > ul > li",
      "bookName": "span.s2.wid > a",
      "author": "span.s4.wid > a",
      "latestChapter": "span.s3.wid3 > a",
      "lastUpdateTime": "span.s6.wid6"
    },
    "book": {
      "coverUrl": "meta[property=\"og:image\"]@js:r='http://www.mcxs.la'+r"
    },
    "toc": {
      "item": "dl > dt:nth-of-type(2) ~ dd > a"
    },
    "chapter": {
      "title": ".bookname > h1",
      "content": "#content",
      "paragraphTagClosed": false,
      "paragraphTag": "<br>+",
      "filterTxt": "天才一秒记住本站地址：[.+] .+最快更新！无广告！|(.+)，高速全文字在线阅读！|一秒记住【.+】，精彩无弹窗免费阅读！|《.+》.+全文字更新，牢记网址：([a-zA-Z0-9-]+(\\.[a-zA-Z0-9-]+)*\\.[a-zA-Z]{2,})|\\(本章完\\)",
      "filterTag": "div, p, script"
    },
    "id": "mcxs-la",
    "homePattern": "^/\\d+_\\d+/$",
    "encoded": false,
    "searchInterval": 700
  },
  {
    "url": "http://www.99wx.info/",
    "name": "鸟书网",
    "comment": "搜索有限流 (Read timed out)，数量15w+",
    "search": {
      "url": "http://www.99wx.info/read/search/",
      "method": "post",
      "data": "{searchkey: %s}",
      "result": "div.wrap > div > div > div",
      "bookName": "div.bookinfo > h4 > a",
      "author": "div.bookinfo > div.author",
      "latestChapter": "div.bookinfo > div.update > a"
    },
    "book": {},
    "toc": {
      "item": "dl > dt:nth-of-type(2) ~ dd > a"
    },
    "chapter": {
      "title": ".content > h1",
      "content": "#content",
      "paragraphTagClosed": false,
      "paragraphTag": "<br>+",
      "filterTxt": "请记住本书首发域名：.+。鸟书网手机版阅读网址：.+|7017k|\\(本章完\\)",
      "filterTag": ""
    },
    "id": "99wx-info",
    "homePattern": "^/tag/\\d+_\\d+/$",
    "encoded": false,
    "searchInterval": 700
  },
  {
    "url": "http://www.xbiquwk.com/",
    "name": "笔尖中文",
    "comment": "",
    "search": {
      "url": "http://www.xbiquwk.com/modules/article/search.php",
      "method": "post",
      "data": "{searchkey: %s}",
      "result": "#wrapper > table > tbody > tr",
      "bookName": "td:nth-child(1) > a",
      "author": "td:nth-child(3)",
      "latestChapter": "td:nth-child(2)",
      "lastUpdateTime": "td:nth-child(5)"
    },
    "book": {
      "url": "http://www.xbiquwk.com/(.*?)/"
    },
    "toc": {
      "baseUri": "http://www.xbiquwk.com/%s/",
      "item": "#list > dl > dd > a"
    },
    "chapter": {
      "title": ".bookname > h1",
      "content": "#content",
      "paragraphTagClosed": false,
      "paragraphTag": "<br>+",
      "filterTxt": "<!--.*?-->|喜欢.+请大家收藏：.+|\\(本章完\\)",
      "filterTag": ""
    },
    "id": "xbiquwk-com",
    "homePattern": "^/\\d+_\\d+/$",
    "encoded": false,
    "searchInterval": 700
  },
  {
    "url": "http://www.ujxsw.org/",
    "name": "悠久小说网",
    "comment": "下载速度快",
    "search": {
      "url": "http://www.ujxsw.org/searchbooks.php",
      "method": "post",
      "data": "{searchkey: %s}",
      "result": "#main > div.shuku_list > div.shulist > ul",
      "bookName": "li.three > a",
      "author": "li.four > a",
      "category": "li.two",
      "status": "li.six",
      "latestChapter": "li.three > span > a",
      "lastUpdateTime": "li.five"
    },
    "book": {
      "url": "http://www.ujxsw.org/book/(.*?)/",
      "bookName": "#maininfo > div.coverecom.w_770.left > div.tabstit > a:nth-child(4)",
      "author": "#bookinfo > div.bookright > div.d_title > h1 > em > a",
      "intro": "#bookintro",
      "category": "#count > span:nth-child(1)",
      "coverUrl": "#bookimg > a > img",
      "latestChapter": "#bookinfo > div.bookright > div.new > span.new_t > a",
      "latestChapterUrl": "#bookinfo > div.bookright > div.new > span.new_t > a@href",
      "lastUpdateTime": "#bookinfo > div.bookright > div.new > span.new_p"
    },
    "toc": {
      "url": "http://www.ujxsw.org/read/%s/",
      "item": "#readerlist > ul > li > a"
    },
    "chapter": {
      "title": "#mlfy_main_text > h3",
      "content": "#mlfy_main_text > div.read-content > p",
      "paragraphTagClosed": false,
      "paragraphTag": "<br>+",
      "filterTxt": "【悠久小説網ωωω.ＵＪХＳw.ｎｅｔ】，免费小说无弹窗免费阅读！|佰度搜索 【悠久小說網 ＷＷＷ.ＵＪХＳw．ＮＥＴ】 全集TXT电子书免费下载！|《.*》悠久小说网全文字更新,牢记网址:www.ujxsw.org|1秒记住网：",
      "filterTag": ""
    },
    "id": "ujxsw-org",
    "homePattern": "^/book/\\d+/$",
    "encoded": false,
    "searchInterval": 700
  },
  {
    "url": "http://www.yeudusk.com/",
    "name": "阅读库",
    "comment": "",
    "search": {
      "url": "http://www.yeudusk.com/modules/article/search.php?q=%s",
      "method": "get",
      "result": "#jieqi_page_contents > div > div:nth-child(2)",
      "bookName": "div:nth-child(1) > span > a",
      "author": "div:nth-child(2) > span:nth-child(2)",
      "category": "div:nth-child(2) > span:nth-child(4)",
      "status": "span:nth-child(8)",
      "latestChapter": "div:nth-child(4) > span:nth-child(2) > a",
      "lastUpdateTime": "div:nth-child(4) > span:nth-child(4)"
    },
    "book": {
      "url": "http://www.yeudusk.com/book/(.*?)/",
      "intro": "#content > div.divbox.cf > div:nth-child(2) > div:nth-child(3) > div.tabcontent > div:nth-child(1) > div",
      "latestChapter": "#content > div:nth-child(4) > h3",
      "latestChapterUrl": "#content > div:nth-child(4) > h3 > a@href",
      "lastUpdateTime": "#content > div.divbox.cf > div:nth-child(2) > div:nth-child(3) > div.tabcontent > div:nth-child(2) > table > tbody > tr:nth-child(1) > td:nth-child(3)"
    },
    "toc": {
      "url": "http://www.yeudusk.com/html/0/%s/",
      "item": "ul > li > a"
    },
    "chapter": {
      "title": "#cont > h1",
      "content": "#clickeye_content",
      "paragraphTagClosed": false,
      "paragraphTag": "<br>+",
      "filterTxt": "\\(阅读库\\s?www\\.yeudusk\\.com\\)|阅读库 www.yeudusk.comyeudusk www.yeudusk.com|《.+》阅读库全文字更新,牢记网址:www\\.yeudusk\\.com"
    },
    "id": "yeudusk-com",
    "homePattern": "^/book/\\d+/$",
    "encoded": false,
    "searchInterval": 700
  },
  {
    "url": "https://www.biquge365.net/",
    "name": "笔趣阁365",
    "comment": "搜索间隔15秒，若搜索结果为空则手动打开网页搜一次后再试",
    "search": {
      "url": "https://www.biquge365.net/s.php",
      "method": "post",
      "data": "{type: articlename, s: %s}",
      "result": "body > div.menu > div > ul > li",
      "bookName": "span.name > a",
      "author": "span.zuo > a",
      "category": "span.lei > a",
      "latestChapter": "span.jie > a",
      "lastUpdateTime": "span.time"
    },
    "book": {
      "url": "https://www.biquge365.net/book/(.*?)/",
      "latestChapterUrl": "body > div.menu > div.right > div:nth-child(1) > div > div.xinxi > span:nth-child(8) > a@href",
      "lastUpdateTime": "body > div.menu > div.right > div:nth-child(1) > div > div.xinxi > span:nth-child(7)"
    },
    "toc": {
      "url": "https://www.biquge365.net/newbook/%s/",
      "item": "body > div.menu > div.border > ul > li > a"
    },
    "chapter": {
      "title": "#neirong > h1",
      "content": "#txt",
      "paragraphTagClosed": false,
      "paragraphTag": "<br>+",
      "filterTxt": "",
      "filterTag": "p"
    },
    "id": "biquge365-net",
    "homePattern": "^/book/\\d+/$",
    "encoded": false,
    "searchInterval": 15000
  },
  {
    "url": "https://www.d8zw.com/",
    "name": "第八中文网",
    "comment": "搜索、目录自动翻页（每页 100 章）；偶尔 502，建议线程数 ≤ 5",
    "search": {
      "url": "https://www.d8zw.com/search.php?q=%s",
      "method": "get",
      "result": ".box.hot dl",
      "bookName": "dd > h3 > a@js:r=r.replace(/^\\[[^\\]]*\\]/,'')",
      "author": "dd.book_other > span",
      "status": "dd.book_other:nth-of-type(3)@js:r=r.replace(/[^：]*：/,'')",
      "lastUpdateTime": "dd.book_other:nth-of-type(4)@js:r=r.replace(/[^：]*：/,'')"
    },
    "book": {
      "url": "https://www.d8zw.com/(\\d+/\\d+)/"
    },
    "toc": {
      "url": "https://www.d8zw.com/%s/index_1.html",
      "item": ".book_list2 > ul > li > a",
      "nextPage": ".pagination li.page-item.active + li > a"
    },
    "chapter": {
      "title": "h1",
      "content": "article.font_max",
      "paragraphTagClosed": false,
      "paragraphTag": "<br>+",
      "filterTxt": "正在手打中，请稍等片刻|内容更新后，请重新刷新页面，即可获取最新更新！|请记住本书首发域名|天才一秒记住本站地址",
      "filterTag": "script",
      "timeout": 20
    },
    "crawl": {
      "concurrency": 5,
      "minInterval": 500,
      "maxInterval": 1200,
      "maxAttempts": 3,
      "retryMinInterval": 1500,
      "retryMaxInterval": 3000
    },
    "id": "d8zw-com",
    "homePattern": "^/\\d+/\\d+/$",
    "encoded": false,
    "searchInterval": 700
  },
  {
    "url": "https://www.52bqg.com/",
    "name": "笔趣阁52",
    "comment": "搜索可用；目录/章节链接为 JS onclick，规则用 @js 重写为绝对链接；正文 base64 编码（分页章节用 nextPageInJs 解析）",
    "search": {
      "url": "https://www.52bqg.com/search.html",
      "method": "post",
      "data": "{s: %s}",
      "result": "ul.txt-list > li",
      "bookName": "span.s2 > a",
      "author": "span.s3 > a",
      "category": "span.s1",
      "latestChapter": "span.s4 > a",
      "lastUpdateTime": "span.s5"
    },
    "book": {
      "url": "https://www.52bqg.com/book_(\\d+)/"
    },
    "toc": {
      "url": "https://www.52bqg.com/book_%s/index_1.html",
      "list": "html@js:var pre=0,post=0,m;var rp=/li:nth-child\\((\\d+)\\)\\s*\\{\\s*display\\s*:\\s*none/g;while((m=rp.exec(r))){pre=Math.max(pre,+m[1]);}var rq=/li:nth-last-child\\((\\d+)\\)\\s*\\{\\s*display\\s*:\\s*none/g;while((m=rq.exec(r))){post=Math.max(post,+m[1]);}var cnt={},rb=/\\/book_(\\d+)\\//g;while((m=rb.exec(r))){cnt[m[1]]=(cnt[m[1]]||0)+1;}var bid='',bn=0;for(var k in cnt){if(cnt[k]>bn){bn=cnt[k];bid=k;}}var best=[],bestN=-1,ru=/<ul[^>]*class=\"[^\"]*section-list[^\"]*\"[^>]*>([\\s\\S]*?)<\\/ul>/g;while((m=ru.exec(r))){var lis=m[1].match(/<li[\\s\\S]*?<\\/li>/g)||[];if(lis.length>bestN){bestN=lis.length;best=lis;}}if(bestN>0){best=best.slice(pre,bestN-post);}r='<ul class=\"section-list\">'+best.join('').replace(/<a\\s+onclick=\"read_tz\\((\\d+)\\);?\">/g,'<a href=\"https://www.52bqg.com/book_'+bid+'/$1.html\">').replace(/href=\"\\//g,'href=\"https://www.52bqg.com/')+'</ul>';",
      "item": "ul.section-list > li > a",
      "nextPage": "select > option"
    },
    "chapter": {
      "title": "div.word_read > h3@js:r=r.replace(/（第\\d+页）$/,'')",
      "content": "div.word_read@js:var o=[],m,re=/writeln\\([^']*'([^']+)'\\)/g;while((m=re.exec(r))){o.push(m[1]);}r=o.join('\\n');@java:base64.decode()",
      "paragraphTagClosed": true,
      "filterTxt": "请勿开启浏览器阅读模式，否则将导致章节内容缺失及无法阅读下一章。|\\(本章完\\)",
      "filterTag": "script",
      "nextPage": "a.kafekhf",
      "nextPageInJs": "script@js:var nm=(r.match(/key\\s*==\\s*39\\)\\s*location\\s*=\\s*([A-Za-z_$][\\w$]*)/)||[])[1];var u='';if(nm){var mm=r.match(new RegExp('var\\\\s+'+nm+'\\\\s*=\\\\s*\\'([^\\']+)\\''));u=mm?mm[1]:'';}r=(u&&/_\\d+\\.html$/.test(u))?('https://www.52bqg.com'+u):'END';",
      "nextChapterLink": "END"
    },
    "crawl": {
      "concurrency": 4,
      "minInterval": 800,
      "maxInterval": 1500,
      "maxAttempts": 3,
      "retryMinInterval": 2000,
      "retryMaxInterval": 4000
    },
    "id": "52bqg-com",
    "homePattern": "^/book_\\d+/$",
    "encoded": true,
    "searchInterval": 700
  },
  {
    "url": "https://www.snxsw.com/",
    "name": "少年小说网",
    "comment": "与笔趣阁52同款 CMS（搜索需带 submit 字段）；目录含隐藏 li、正文 base64、章节多页",
    "search": {
      "url": "https://www.snxsw.com/search.html",
      "method": "post",
      "data": "{s: %s}",
      "result": "ul.txt-list > li",
      "bookName": "span.s2 > a",
      "author": "span.s3 > a",
      "category": "span.s1",
      "latestChapter": "span.s4 > a",
      "lastUpdateTime": "span.s5",
      "timeout": 60
    },
    "book": {
      "url": "https://www.snxsw.com/book/(\\d+)/"
    },
    "toc": {
      "url": "https://www.snxsw.com/index/%s/1/",
      "list": "html@js:var pre=0,post=0,m;var rp=/li:nth-child\\((\\d+)\\)\\s*\\{\\s*display\\s*:\\s*none/g;while((m=rp.exec(r))){pre=Math.max(pre,+m[1]);}var rq=/li:nth-last-child\\((\\d+)\\)\\s*\\{\\s*display\\s*:\\s*none/g;while((m=rq.exec(r))){post=Math.max(post,+m[1]);}var cnt={},rb=/\\/book_(\\d+)\\//g;while((m=rb.exec(r))){cnt[m[1]]=(cnt[m[1]]||0)+1;}var bid='',bn=0;for(var k in cnt){if(cnt[k]>bn){bn=cnt[k];bid=k;}}var best=[],bestN=-1,ru=/<ul[^>]*class=\"[^\"]*section-list[^\"]*\"[^>]*>([\\s\\S]*?)<\\/ul>/g;while((m=ru.exec(r))){var lis=m[1].match(/<li[\\s\\S]*?<\\/li>/g)||[];if(lis.length>bestN){bestN=lis.length;best=lis;}}if(bestN>0){best=best.slice(pre,bestN-post);}r='<ul class=\"section-list\">'+best.join('').replace(/<a\\s+onclick=\"read_tz\\((\\d+)\\);?\">/g,'<a href=\"https://www.snxsw.com/book_'+bid+'/$1.html\">').replace(/href=\"\\//g,'href=\"https://www.snxsw.com/')+'</ul>';",
      "item": "ul.section-list > li > a",
      "nextPage": "select > option",
      "isDesc": true
    },
    "chapter": {
      "title": "div.word_read > h3@js:r=r.replace(/（第\\d+页）$/,'')",
      "content": "div.word_read@js:var o=[],m,re=/writeln\\([^']*'([^']+)'\\)/g;while((m=re.exec(r))){o.push(m[1]);}r=o.join('\\n');@java:base64.decode()",
      "paragraphTagClosed": true,
      "filterTxt": "请勿开启浏览器阅读模式，否则将导致章节内容缺失及无法阅读下一章。|\\(本章完\\)",
      "filterTag": "script",
      "nextPage": "div.read_btn > a:contains(下一章)"
    },
    "crawl": {
      "concurrency": 3,
      "minInterval": 400,
      "maxInterval": 1000,
      "maxAttempts": 3,
      "retryMinInterval": 1500,
      "retryMaxInterval": 3000
    },
    "id": "snxsw-com",
    "homePattern": "^/book/\\d+/$",
    "encoded": true,
    "searchInterval": 20000
  },
  {
    "url": "https://www.xbiquge.info/",
    "name": "新笔趣阁小说网",
    "comment": "与第八中文网同款 CMS 的镜像站；目录分页 .pagination、正文 article.font_max，章节分 3 页需翻页",
    "search": {
      "url": "https://www.xbiquge.info/search.php?q=%s",
      "method": "get",
      "result": ".box.hot dl",
      "bookName": "dd > h3 > a@js:r=r.replace(/^\\[[^\\]]*\\]/,'')",
      "author": "dd.book_other > span",
      "status": "dd.book_other:nth-of-type(3)@js:r=r.replace(/[^：]*：/,'')",
      "lastUpdateTime": "dd.book_other:nth-of-type(4)@js:r=r.replace(/[^：]*：/,'')"
    },
    "book": {
      "url": "https://www.xbiquge.info/(\\d+/\\d+)/"
    },
    "toc": {
      "url": "https://www.xbiquge.info/%s/index_1.html",
      "item": ".book_list2 > ul > li > a",
      "nextPage": ".pagination li.page-item.active + li > a"
    },
    "chapter": {
      "title": "h1",
      "content": "article.font_max",
      "paragraphTagClosed": false,
      "paragraphTag": "<br>+",
      "filterTxt": "正在手打中，请稍等片刻|内容更新后，请重新刷新页面，即可获取最新更新！|请记住本书首发域名|天才一秒记住本站地址|第 \\(\\d+/\\d+\\) 页",
      "filterTag": "script",
      "timeout": 20,
      "nextPage": "a:contains(下一章)"
    },
    "crawl": {
      "concurrency": 3,
      "minInterval": 400,
      "maxInterval": 1000,
      "maxAttempts": 3,
      "retryMinInterval": 1500,
      "retryMaxInterval": 3000
    },
    "id": "xbiquge-info",
    "homePattern": "^/\\d+/\\d+/$",
    "encoded": false,
    "searchInterval": 700
  },
  {
    "url": "https://www.bqg.info/",
    "name": "笔趣阁info",
    "comment": "Bootstrap(46f)模板：搜索 GET /search/?searchkey=，结果不返回作者(详情页 og:novel:author 有)；详情页直接含完整目录 dl#newlist(无独立目录页)；正文 #booktxt、章内分页 #linkNext(_N.html，末页链接无 _N 即终止)；收录主流书本体(搜索结果中排最后)+大量同人/续写；全程无地域风控",
    "search": {
      "url": "https://www.bqg.info/search/?searchkey=%s",
      "method": "get",
      "result": "div.book-coverlist",
      "bookName": "h4 a",
      "intro": "div.caption p"
    },
    "book": {
      "url": "https://www.bqg.info/book/(\\d+)/",
      "intro": "#bookIntro"
    },
    "toc": {
      "item": "dl#newlist > dd > a"
    },
    "chapter": {
      "title": "h1.readTitle",
      "content": "#booktxt",
      "paragraphTagClosed": true,
      "filterTxt": "\\[笔趣阁信息\\].*?超级好记！|本章未完，请点击下一页继续阅读|\\(本章完\\)|𝙱Ⓠ🅖.𝙄nf🅞",
      "filterTag": "script",
      "nextPage": "#linkNext"
    },
    "crawl": {
      "concurrency": 4,
      "minInterval": 600,
      "maxInterval": 1200,
      "maxAttempts": 3,
      "retryMinInterval": 1500,
      "retryMaxInterval": 3000
    },
    "id": "bqg-info",
    "homePattern": "^/book/\\d+/$",
    "encoded": false,
    "searchInterval": 700
  }
];

// SPDX-License-Identifier: AGPL-3.0-only
// Source selectors derive from freeok/so-novel; no upstream Java or JS is evaluated.
export default class extends Extension {
  _active = 'all';
  _cache = new Map();
  _cacheSize = 0;
  _pending = new Map();
  _queues = new Map();
  _next = new Map();
  _searchNext = new Map();
  _searches = new Map();

  rules() { return SONOVEL_RULES; }
  rule(id) {
    const r = this.rules().find(r => r.id === id);
    if (!r) throw new Error('书源不存在，请重新选择。');
    return r;
  }
  async channels() { return [{title:'全部书源',key:'all'}, ...this.rules().map(r => ({title:r.name,key:r.id}))]; }
  page(value) { if (!Number.isInteger(value) || value < 1 || value > 10000) throw new Error('页码不正确。'); }
  text(value) { return this.decodeEntities(String(value || '')).replace(/\s+/g,' ').trim(); }
  origin(url) { return String(url).match(/^https?:\/\/[^/?#]+/i)?.[0] || ''; }
  host(url) {
    const match = String(url).match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
    if (!match || /[@\s\\]/.test(match[1]) || /[\r\n]/.test(url)) return '';
    return match[1].toLowerCase().replace(/^www\./,'');
  }
  absolute(base, ref) {
    ref = this.decodeEntities(String(ref || '').trim());
    if (!ref || /[\r\n\\]/.test(ref) || /^(?:javascript|data|file):/i.test(ref)) return '';
    if (/^https?:\/\//i.test(ref)) return this.host(ref) ? ref.split('#')[0] : '';
    if (ref.startsWith('//')) return this.absolute(base,base.split(':')[0]+':'+ref);
    const origin = this.origin(base); if (!origin) return '';
    const path = base.slice(origin.length).split(/[?#]/)[0] || '/';
    if (ref.startsWith('?')) return origin+path+ref.split('#')[0];
    if (ref.startsWith('#')) return base.split('#')[0];
    const joined = (ref.startsWith('/') ? '' : path.replace(/[^/]*$/,''))+ref.split('#')[0];
    const query = joined.includes('?') ? joined.slice(joined.indexOf('?')) : '';
    const parts = joined.split('?')[0].split('/'), out=[];
    for (const part of parts) { if (part === '..') out.pop(); else if (part !== '.') out.push(part); }
    return origin+'/'+out.filter((part,i) => part || i===out.length-1).join('/')+query;
  }
  same(r,url) { return this.host(url) === this.host(r.url) && String(url).length <= 8192; }
  bookLink(r,url) {
    const path = url.slice(this.origin(url).length).split(/[?#]/)[0];
    return this.same(r,url) && new RegExp(r.homePattern).test(path.endsWith('/') ? path : path+'/');
  }
  pack(r,url) {
    if (!this.same(r,url)) throw new Error('书源地址不匹配。');
    let path=url.slice(this.origin(url).length).split('#')[0];
    if(this.bookLink(r,url)){const parts=path.split('?');parts[0]=parts[0].replace(/\/?$/,'/');path=parts.join('?');}
    return 'sonovel:'+r.id+':'+encodeURIComponent(this.origin(r.url)+path);
  }
  unpack(value) {
    const match = String(value).match(/^sonovel:([a-z0-9-]+):(.+)$/);
    if (!match) throw new Error('阅读地址不正确，请重新打开作品。');
    const r = this.rule(match[1]); let url;
    try { url=decodeURIComponent(match[2]); } catch (_) { throw new Error('阅读地址不正确。'); }
    if (!this.same(r,url)) throw new Error('阅读地址与书源不匹配。');
    return {r,url};
  }
  headers(url) { return {'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',Referer:url}; }
  async html(r,url,{method='get',data,search=false}={}) {
    if (!this.same(r,url)) throw new Error('已阻止无关站点请求。');
    const key=method+'|'+url+'|'+(data||''), now=Date.now();
    const cached=this._cache.get(key);
    if (cached && now-cached.at<60000) return cached.html;
    if (this._pending.has(key)) return this._pending.get(key);
    const previous=this._queues.get(r.id)||Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      const wait=Math.max(this._next.get(r.id)||0,search ? this._searchNext.get(r.id)||0 : 0)-Date.now();
      if (wait>0) await this.sleep(wait);
      this._next.set(r.id,Date.now()+Math.max(700,r.crawl?.minInterval||0));
      if (search) this._searchNext.set(r.id,Date.now()+r.searchInterval);
      let response;
      try { response=await this.request(url,{method,data,headers:{...this.headers(r.url),...(method==='post'?{'Content-Type':'application/x-www-form-urlencoded'}:{})},netMode:'direct',timeoutMs:12000,retry:false}); }
      catch (_) { throw new Error(r.name+'连接失败，请检查网络或切换书源。'); }
      if (typeof response!=='string' || !response.trim()) throw new Error(r.name+'未返回有效网页。');
      if (response.length>4*1024*1024) throw new Error(r.name+'网页过大，已停止加载。');
      if (/cf-chl-|id=["']challenge-form|<title[^>]*>\s*(?:Just a moment|Attention Required)|访问过于频繁|您的访问过于频繁|访问验证|安全验证中/i.test(response)) {
        this._next.set(r.id,Date.now()+30000);
        throw new Error(r.name+'要求网页验证或限制访问，请稍后重试或切换书源。');
      }
      if(this._cache.has(key))this._cacheSize-=this._cache.get(key).html.length;
      this._cache.set(key,{at:Date.now(),html:response});this._cacheSize+=response.length;
      while(this._cache.size>24||this._cacheSize>6*1024*1024){const first=this._cache.keys().next().value;this._cacheSize-=this._cache.get(first).html.length;this._cache.delete(first);}
      return response;
    });
    this._queues.set(r.id,task); this._pending.set(key,task);
    try { return await task; } finally { this._pending.delete(key);if(this._queues.get(r.id)===task)this._queues.delete(r.id); }
  }
  async elements(html,selector) {
    if (!selector) return [];
    // The host parses a full HTML5 document: detached table rows need context.
    if(/^\s*<tr\b/i.test(html))html='<table><tbody>'+html+'</tbody></table>';
    else if(/^\s*<(td|th)\b/i.test(html))html='<table><tbody><tr>'+html+'</tr></tbody></table>';
    else if(/^\s*<(thead|tbody|tfoot)\b/i.test(html))html='<table>'+html+'</table>';
    else if(/^\s*<option\b/i.test(html))html='<select>'+html+'</select>';
    const contains=[];
    selector=selector.replace(/:contains\(([^)]+)\)/g,(_,text)=>{contains.push(text.replace(/^["']|["']$/g,''));return '';});
    const nodes=await this.querySelectorAll(html,selector);
    if (!contains.length) return nodes;
    const out=[]; for(const node of nodes) { const text=await node.text; if(contains.every(term=>text.includes(term))) out.push(node); }
    return out;
  }
  async field(html,spec,base,kind='text') {
    if (!spec) return '';
    const selector=spec.split(/@(?:js:|java:|href\b|src\b)/)[0];
    const nodes=await this.elements(html,selector); if(!nodes.length) return '';
    let value;
    if(kind==='html') value=(await Promise.all(nodes.map(n=>n.content))).map(h=>h.replace(/^<[^>]+>/,'').replace(/<\/[^>]+>\s*$/,'')).join('\n');
    else if (/@href(?:$|@)/.test(spec)) value=await nodes[0].getAttributeText('href');
    else if (/@src(?:$|@)/.test(spec)) value=await nodes[0].getAttributeText('src');
    else if (/^meta\[/i.test(selector)) value=await nodes[0].getAttributeText('content');
    else if (/^\s*<img\b/i.test(await nodes[0].content)) value=await nodes[0].getAttributeText('data-src')||await nodes[0].getAttributeText('src');
    else value=(await Promise.all(nodes.map(n=>n.text))).join(' ');
    value=String(value||'');
    if(spec.includes('@js:')) {
      if(spec.includes("replace(/^\\[")) value=value.replace(/^\[[^\]]*\]/,'');
      else if(spec.includes('replace(/[^：]*：/')) value=value.replace(/[^：]*：/,'');
      else if(spec.includes('第\\d+页')) value=value.replace(/（第\d+页）$/,'');
      else if(!spec.includes("r='http://www.mcxs.la'+r") && !spec.includes('writeln')) throw new Error('书源规则已变化，需要更新插件。');
    }
    return kind==='html' ? value : this.text(value);
  }
  async metadata(r,html,url) {
    const defaults={bookName:'meta[property="og:novel:book_name"]',author:'meta[property="og:novel:author"]',intro:'meta[name="description"]',coverUrl:'meta[property="og:image"]',category:'meta[property="og:novel:category"]',status:'meta[property="og:novel:status"]'};
    const data={};
    await Promise.all(Object.entries(defaults).map(async([key,fallback])=>{data[key]=await this.field(html,r.book[key]||fallback,url);if(!data[key]&&r.book[key])data[key]=await this.field(html,fallback,url);}));
    data.bookName=data.bookName||await this.field(html,'h1',url);
    data.author=data.author.replace(/^作者[:：]\s*/,'');
    data.coverUrl=this.absolute(url,data.coverUrl);
    return data;
  }
  async cover(html,base) {
    const images=await this.elements(html,'img'); if(!images.length) return '';
    const ref=await images[0].getAttributeText('data-src')||await images[0].getAttributeText('data-original')||await images[0].getAttributeText('src');
    return this.absolute(base,ref);
  }
  item(r,title,url,cover='',extra='',author='') { return {title:this.text(title),url:this.pack(r,url),cover,update:r.name+(author?' · '+author:'')+(extra?' · '+this.text(extra):'')}; }
  async home(r) {
    const html=await this.html(r,r.url); const map=new Map();
    for(const a of await this.elements(html,'a[href]')) {
      const url=this.absolute(r.url,await a.getAttributeText('href')); if(!this.bookLink(r,url)) continue;
      const outer=await a.content; let title=this.text(await a.text)||this.text(await a.getAttributeText('title'));
      if(!title) { const imgs=await this.elements(outer,'img'); if(imgs.length) title=this.text(await imgs[0].getAttributeText('alt')); }
      if(!title||title.length>120) continue;
      const cover=await this.cover(outer,url), old=map.get(url);
      if(!old) map.set(url,this.item(r,title,url,cover)); else if(cover&&!old.cover) old.cover=cover;
    }
    return Array.from(map.values());
  }
  async pool(list,task,limit=3) {
    const result=new Array(list.length); let next=0;
    const worker=async()=>{while(next<list.length){const i=next++;try{result[i]={ok:true,value:await task(list[i])};}catch(error){result[i]={ok:false,error};}}};
    await Promise.all(Array.from({length:Math.min(limit,list.length)},worker)); return result;
  }
  interleave(lists) { const out=[]; const max=Math.max(0,...lists.map(x=>x.length)); for(let i=0;i<max;i++)for(const list of lists)if(list[i])out.push(list[i]);return out; }
  async latest(page,channel) {
    this.page(page); this._active=channel||'all';
    const rules=this._active==='all'?this.rules().filter(r=>['bqg-info','d8zw-com','shuhaige-net'].includes(r.id)):[this.rule(this._active)];
    const result=await this.pool(rules,async r=>(await this.home(r)).slice((page-1)*20,page*20));
    if(result.every(x=>!x.ok)) throw new Error('书源首页暂时无法访问，请使用搜索或切换书源。');
    return this.interleave(result.filter(x=>x.ok).map(x=>x.value));
  }
  searchRequest(r,keyword) {
    const url=r.search.url.replace(/%s/g,encodeURIComponent(keyword));
    if(r.search.method.toLowerCase()!=='post')return {url,options:{search:true}};
    const data=r.search.data.slice(1,-1).split(',').map(pair=>{
      const i=pair.indexOf(':'); const key=pair.slice(0,i).trim(); let value=pair.slice(i+1).trim();
      if(value==='%s')value=keyword; else value=value.replace(/^["']|["']$/g,'');
      return encodeURIComponent(key)+'='+encodeURIComponent(value);
    }).join('&');
    return {url,options:{method:'post',data,search:true}};
  }
  async searchResults(r,html,url) {
    const items=[],seen=new Set();
    for(const node of await this.elements(html,r.search.result)) {
      const row=await node.content, selector=r.search.bookName.split('@js:')[0];
      const title=await this.field(row,r.search.bookName,url);
      const anchors=await this.elements(row,selector);
      if(!title||!anchors.length)continue;
      const href=this.absolute(url,await anchors[0].getAttributeText('href'));
      if(!this.bookLink(r,href)||seen.has(href))continue;seen.add(href);
      const author=await this.field(row,r.search.author,url), extra=await this.field(row,r.search.latestChapter,url);
      items.push(this.item(r,title,href,await this.cover(row,url),extra,author.replace(/^作者[:：]\s*/,'')));
    }
    if(!items.length) {
      const title=await this.field(html,'meta[property="og:novel:book_name"]',url);
      if(title) {
        const canonical=await this.field(html,'meta[property="og:url"]',url)||await this.field(html,'meta[property="og:novel:read_url"]',url);
        const full=this.absolute(url,canonical);
        if(this.bookLink(r,full)) {const meta=await this.metadata(r,html,full);items.push(this.item(r,meta.bookName,full,meta.coverUrl,'',meta.author));}
      }
    }
    return items;
  }
  async searchOne(r,keyword,page) {
    const key=r.id+'|'+keyword;
    let state=this._searches.get(key);
    if(!state||Date.now()-state.at>180000) {
      state={items:[],queue:[],visited:new Set(),seen:new Set(),loaded:false,at:Date.now()};this._searches.set(key,state);
      while(this._searches.size>16)this._searches.delete(this._searches.keys().next().value);
    }
    if(state.pending)await state.pending;
    const load=async()=>{
      let fetched=0;
      while((!state.loaded||state.items.length<page*20)&&(!state.loaded||state.queue.length)) {
        if(++fetched>8)break;
        const request=!state.loaded?this.searchRequest(r,keyword):{url:state.queue.shift(),options:{search:true}};
        if(state.visited.has(request.url))continue;state.visited.add(request.url);
        let html;
        try {html=await this.html(r,request.url,request.options);}catch(error){state.visited.delete(request.url);if(state.loaded)state.queue.unshift(request.url);throw error;}
        state.loaded=true;
        for(const item of await this.searchResults(r,html,request.url))if(!state.seen.has(item.url)){state.seen.add(item.url);state.items.push(item);}
        for(const a of await this.elements(html,r.search.nextPage)) {
          const link=this.absolute(request.url,await a.getAttributeText('href'));
          if(this.same(r,link)&&!state.visited.has(link)&&!state.queue.includes(link))state.queue.push(link);
        }
      }
    };
    state.pending=load();try{await state.pending;}finally{state.pending=null;}
    return state.items.slice((page-1)*20,page*20);
  }
  async search(keyword,page) {
    this.page(page);keyword=String(keyword||'').trim();if(!keyword)return [];
    if(keyword.length>200)throw new Error('搜索内容过长。');
    if(/^https?:\/\//i.test(keyword)) {
      if(page>1)return [];
      const r=this.rules().find(r=>this.bookLink(r,keyword));if(!r)throw new Error('链接不属于已支持书源的作品详情页。');
      const html=await this.html(r,keyword),meta=await this.metadata(r,html,keyword);if(!meta.bookName)throw new Error('未找到作品信息。');
      return [this.item(r,meta.bookName,keyword,meta.coverUrl,'',meta.author)];
    }
    const rules=this._active==='all'?this.rules():[this.rule(this._active)];
    const result=await this.pool(rules,r=>this.searchOne(r,keyword,page));
    if(result.every(x=>!x.ok))throw new Error('书源搜索均未成功，请检查网络后重试，或选择单个书源。');
    return this.interleave(result.filter(x=>x.ok).map(x=>x.value));
  }
  async searchAuthor(author,page) {
    const r=this.rules().find(r=>r.id===author.id);
    if(!r)return this.search(author.name,page);
    return (await this.searchOne(r,author.name,page)).filter(item=>!item.update.includes(' · ')||item.update.includes(' · '+author.name));
  }
  bookId(r,url) { if(!r.book.url)return '';return new RegExp(r.book.url).exec(url)?.[1]||''; }
  async tocMarkup(r,html,id) {
    if(!r.encoded)return html;
    let pre=0,post=0;
    for(const m of html.matchAll(/li:nth-child\((\d+)\)\s*\{\s*display\s*:\s*none/g))pre=Math.max(pre,+m[1]);
    for(const m of html.matchAll(/li:nth-last-child\((\d+)\)\s*\{\s*display\s*:\s*none/g))post=Math.max(post,+m[1]);
    let largest=[];
    for(const list of await this.elements(html,'ul.section-list')) {const items=await this.elements(await list.content,'li');if(items.length>largest.length)largest=items;}
    const selected=largest.slice(pre,Math.max(pre,largest.length-post));
    const fragments=await Promise.all(selected.map(n=>n.content));
    return '<ul class="section-list">'+fragments.join('').replace(/<a\b([^>]*?)\bonclick=(["'])read_tz\((\d+)\);?\2([^>]*)>/g,(_,before,quote,cid,after)=>'<a '+before+after+' href="'+this.origin(r.url)+'/book_'+id+'/'+cid+'.html">')+'</ul>';
  }
  async detail(value) {
    const {r,url}=this.unpack(value);if(!this.bookLink(r,url))throw new Error('作品地址不正确。');
    const html=await this.html(r,url),meta=await this.metadata(r,html,url),id=this.bookId(r,url);
    if(!meta.bookName)throw new Error(r.name+'未找到作品详情，请稍后重试。');
    let first=r.toc.url?r.toc.url.replace(/%s/g,id):url;
    if(r.toc.url&&!id)throw new Error('未能解析作品编号，请更新插件。');
    const queue=[first],visited=new Set(),chapters=new Map();const deadline=Date.now()+90000;
    for(let index=0;index<queue.length;index++) {
      if(index>=80||Date.now()>deadline)throw new Error('目录分页过多或响应过慢，未保存不完整目录，请稍后重试。');
      const current=queue[index];if(visited.has(current))continue;visited.add(current);
      const pageHtml=await this.html(r,current),markup=await this.tocMarkup(r,pageHtml,id);
      let links=await this.elements(markup,r.toc.item);if(r.toc.isDesc)links=links.slice().reverse();
      for(const link of links) {
        const name=this.text(await link.text),href=this.absolute(current,await link.getAttributeText('href'));
        if(!name||!this.same(r,href)||this.bookLink(r,href))continue;
        chapters.delete(href);chapters.set(href,{name,url:this.pack(r,href)});
      }
      for(const next of await this.elements(pageHtml,r.toc.nextPage)) {
        const href=this.absolute(current,await next.getAttributeText('href')||await next.getAttributeText('value'));
        if(this.same(r,href)&&!visited.has(href)&&!queue.includes(href))queue.push(href);
      }
    }
    const episodes=Array.from(chapters.values());
    if(!episodes.length)throw new Error(r.name+'未返回可阅读章节，不能将验证页或空目录作为正常作品。');
    return {title:meta.bookName,cover:meta.coverUrl,desc:[meta.intro,meta.category,meta.status,r.name].filter(Boolean).join('\n\n'),authors:meta.author?[{name:meta.author,id:r.id}]:[],episodes:[{title:'正文 · '+r.name,urls:episodes}]};
  }
  base64(value) {
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',bytes=[];
    value=value.replace(/\s/g,'');if(!/^[A-Za-z0-9+/]*={0,2}$/.test(value)||value.length%4===1)throw new Error('正文编码格式已变化，请更新插件。');
    let bits=0,buffer=0;
    for(const char of value.replace(/=+$/,'')){buffer=(buffer<<6)|alphabet.indexOf(char);bits+=6;if(bits>=8){bits-=8;bytes.push((buffer>>bits)&255);}}
    try{return decodeURIComponent(bytes.map(byte=>'%'+byte.toString(16).padStart(2,'0')).join(''));}catch(_){throw new Error('正文字符编码无法解析，请切换书源。');}
  }
  async chapter(r,html,url) {
    let body=await this.field(html,r.chapter.content,url,'html');
    if(r.encoded) {
      const parts=Array.from(body.matchAll(/writeln\([^']*'([^']+)'\)/g),m=>m[1]);
      if(!parts.length)throw new Error('未找到章节正文，请稍后重试。');
      body=parts.map(part=>this.base64(part)).join('\n');
    }
    body=body.replace(/<(script|style|noscript|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
    const selectors=['script','style','noscript','iframe','form','button',...(r.chapter.filterTag||'').split(',').map(x=>x.trim()).filter(Boolean)];
    for(const selector of new Set(selectors))for(const el of await this.elements(body,selector))body=body.replace(await el.content,'');
    const needsNext=/本章未完[，,]|本小章还未完|这个章节后面还有|这章没有结束/.test(body);
    if(r.chapter.filterTxt)body=body.replace(new RegExp(r.chapter.filterTxt,'g'),'');
    body=body.replace(/<!--[^]*?-->/g,'');
    const blocks=this.htmlToBlocks(body,url);
    if(!blocks.some(x=>typeof x==='string'&&x.trim()))throw new Error('未找到章节正文，请检查网络或切换书源。');
    blocks.needsNext=needsNext;return blocks;
  }
  sameChapter(current,next) {
    const key=url=>url.split(/[?#]/)[0].replace(/(\/\d+)[-_]\d+(\.[a-z]+)$/i,'$1$2');
    return current!==next&&key(current)===key(next);
  }
  async nextChapterPage(r,html,current) {
    let href='';
    if(r.chapter.nextPageInJs) {
      const variable=html.match(/key\s*==\s*39\)\s*location\s*=\s*([A-Za-z_$][\w$]*)/)?.[1];
      if(variable){const escaped=variable.replace(/[$]/g,'\\$');href=new RegExp("var\\s+"+escaped+"\\s*=\\s*'([^']+)'").exec(html)?.[1]||'';}
    } else if(r.chapter.nextPage) {
      const links=await this.elements(html,r.chapter.nextPage);if(links.length)href=await links[0].getAttributeText('href')||'';
    }
    const url=this.absolute(current,href);return this.same(r,url)&&this.sameChapter(current,url)?url:'';
  }
  async watch(value) {
    const {r,url}=this.unpack(value);let current=url;const visited=new Set(),content=[];let subtitle='',size=0;
    for(let page=0;current;page++) {
      if(page>=20||visited.has(current))throw new Error('章节分页异常，已停止读取，未保存不完整正文。');visited.add(current);
      const html=await this.html(r,current);if(!subtitle)subtitle=await this.field(html,r.chapter.title,current);
      const blocks=await this.chapter(r,html,current);size+=blocks.reduce((n,block)=>n+(typeof block==='string'?block.length:0),0);
      if(size>2*1024*1024)throw new Error('章节正文过大，已停止读取。');
      content.push(...blocks);
      const next=await this.nextChapterPage(r,html,current);
      if(blocks.needsNext&&!next)throw new Error('正文提示仍有下一页，但未找到有效链接，未保存不完整章节。');
      current=next;
    }
    return {content,subtitle,headers:this.headers(url),netMode:'direct'};
  }
}

/* Full upstream license, retained for standalone script distribution:
                    GNU AFFERO GENERAL PUBLIC LICENSE
                       Version 3, 19 November 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.

                            Preamble

  The GNU Affero General Public License is a free, copyleft license for
software and other kinds of works, specifically designed to ensure
cooperation with the community in the case of network server software.

  The licenses for most software and other practical works are designed
to take away your freedom to share and change the works.  By contrast,
our General Public Licenses are intended to guarantee your freedom to
share and change all versions of a program--to make sure it remains free
software for all its users.

  When we speak of free software, we are referring to freedom, not
price.  Our General Public Licenses are designed to make sure that you
have the freedom to distribute copies of free software (and charge for
them if you wish), that you receive source code or can get it if you
want it, that you can change the software or use pieces of it in new
free programs, and that you know you can do these things.

  Developers that use our General Public Licenses protect your rights
with two steps: (1) assert copyright on the software, and (2) offer
you this License which gives you legal permission to copy, distribute
and/or modify the software.

  A secondary benefit of defending all users' freedom is that
improvements made in alternate versions of the program, if they
receive widespread use, become available for other developers to
incorporate.  Many developers of free software are heartened and
encouraged by the resulting cooperation.  However, in the case of
software used on network servers, this result may fail to come about.
The GNU General Public License permits making a modified version and
letting the public access it on a server without ever releasing its
source code to the public.

  The GNU Affero General Public License is designed specifically to
ensure that, in such cases, the modified source code becomes available
to the community.  It requires the operator of a network server to
provide the source code of the modified version running there to the
users of that server.  Therefore, public use of a modified version, on
a publicly accessible server, gives the public access to the source
code of the modified version.

  An older license, called the Affero General Public License and
published by Affero, was designed to accomplish similar goals.  This is
a different license, not a version of the Affero GPL, but Affero has
released a new version of the Affero GPL which permits relicensing under
this license.

  The precise terms and conditions for copying, distribution and
modification follow.

                       TERMS AND CONDITIONS

  0. Definitions.

  "This License" refers to version 3 of the GNU Affero General Public License.

  "Copyright" also means copyright-like laws that apply to other kinds of
works, such as semiconductor masks.

  "The Program" refers to any copyrightable work licensed under this
License.  Each licensee is addressed as "you".  "Licensees" and
"recipients" may be individuals or organizations.

  To "modify" a work means to copy from or adapt all or part of the work
in a fashion requiring copyright permission, other than the making of an
exact copy.  The resulting work is called a "modified version" of the
earlier work or a work "based on" the earlier work.

  A "covered work" means either the unmodified Program or a work based
on the Program.

  To "propagate" a work means to do anything with it that, without
permission, would make you directly or secondarily liable for
infringement under applicable copyright law, except executing it on a
computer or modifying a private copy.  Propagation includes copying,
distribution (with or without modification), making available to the
public, and in some countries other activities as well.

  To "convey" a work means any kind of propagation that enables other
parties to make or receive copies.  Mere interaction with a user through
a computer network, with no transfer of a copy, is not conveying.

  An interactive user interface displays "Appropriate Legal Notices"
to the extent that it includes a convenient and prominently visible
feature that (1) displays an appropriate copyright notice, and (2)
tells the user that there is no warranty for the work (except to the
extent that warranties are provided), that licensees may convey the
work under this License, and how to view a copy of this License.  If
the interface presents a list of user commands or options, such as a
menu, a prominent item in the list meets this criterion.

  1. Source Code.

  The "source code" for a work means the preferred form of the work
for making modifications to it.  "Object code" means any non-source
form of a work.

  A "Standard Interface" means an interface that either is an official
standard defined by a recognized standards body, or, in the case of
interfaces specified for a particular programming language, one that
is widely used among developers working in that language.

  The "System Libraries" of an executable work include anything, other
than the work as a whole, that (a) is included in the normal form of
packaging a Major Component, but which is not part of that Major
Component, and (b) serves only to enable use of the work with that
Major Component, or to implement a Standard Interface for which an
implementation is available to the public in source code form.  A
"Major Component", in this context, means a major essential component
(kernel, window system, and so on) of the specific operating system
(if any) on which the executable work runs, or a compiler used to
produce the work, or an object code interpreter used to run it.

  The "Corresponding Source" for a work in object code form means all
the source code needed to generate, install, and (for an executable
work) run the object code and to modify the work, including scripts to
control those activities.  However, it does not include the work's
System Libraries, or general-purpose tools or generally available free
programs which are used unmodified in performing those activities but
which are not part of the work.  For example, Corresponding Source
includes interface definition files associated with source files for
the work, and the source code for shared libraries and dynamically
linked subprograms that the work is specifically designed to require,
such as by intimate data communication or control flow between those
subprograms and other parts of the work.

  The Corresponding Source need not include anything that users
can regenerate automatically from other parts of the Corresponding
Source.

  The Corresponding Source for a work in source code form is that
same work.

  2. Basic Permissions.

  All rights granted under this License are granted for the term of
copyright on the Program, and are irrevocable provided the stated
conditions are met.  This License explicitly affirms your unlimited
permission to run the unmodified Program.  The output from running a
covered work is covered by this License only if the output, given its
content, constitutes a covered work.  This License acknowledges your
rights of fair use or other equivalent, as provided by copyright law.

  You may make, run and propagate covered works that you do not
convey, without conditions so long as your license otherwise remains
in force.  You may convey covered works to others for the sole purpose
of having them make modifications exclusively for you, or provide you
with facilities for running those works, provided that you comply with
the terms of this License in conveying all material for which you do
not control copyright.  Those thus making or running the covered works
for you must do so exclusively on your behalf, under your direction
and control, on terms that prohibit them from making any copies of
your copyrighted material outside their relationship with you.

  Conveying under any other circumstances is permitted solely under
the conditions stated below.  Sublicensing is not allowed; section 10
makes it unnecessary.

  3. Protecting Users' Legal Rights From Anti-Circumvention Law.

  No covered work shall be deemed part of an effective technological
measure under any applicable law fulfilling obligations under article
11 of the WIPO copyright treaty adopted on 20 December 1996, or
similar laws prohibiting or restricting circumvention of such
measures.

  When you convey a covered work, you waive any legal power to forbid
circumvention of technological measures to the extent such circumvention
is effected by exercising rights under this License with respect to
the covered work, and you disclaim any intention to limit operation or
modification of the work as a means of enforcing, against the work's
users, your or third parties' legal rights to forbid circumvention of
technological measures.

  4. Conveying Verbatim Copies.

  You may convey verbatim copies of the Program's source code as you
receive it, in any medium, provided that you conspicuously and
appropriately publish on each copy an appropriate copyright notice;
keep intact all notices stating that this License and any
non-permissive terms added in accord with section 7 apply to the code;
keep intact all notices of the absence of any warranty; and give all
recipients a copy of this License along with the Program.

  You may charge any price or no price for each copy that you convey,
and you may offer support or warranty protection for a fee.

  5. Conveying Modified Source Versions.

  You may convey a work based on the Program, or the modifications to
produce it from the Program, in the form of source code under the
terms of section 4, provided that you also meet all of these conditions:

    a) The work must carry prominent notices stating that you modified
    it, and giving a relevant date.

    b) The work must carry prominent notices stating that it is
    released under this License and any conditions added under section
    7.  This requirement modifies the requirement in section 4 to
    "keep intact all notices".

    c) You must license the entire work, as a whole, under this
    License to anyone who comes into possession of a copy.  This
    License will therefore apply, along with any applicable section 7
    additional terms, to the whole of the work, and all its parts,
    regardless of how they are packaged.  This License gives no
    permission to license the work in any other way, but it does not
    invalidate such permission if you have separately received it.

    d) If the work has interactive user interfaces, each must display
    Appropriate Legal Notices; however, if the Program has interactive
    interfaces that do not display Appropriate Legal Notices, your
    work need not make them do so.

  A compilation of a covered work with other separate and independent
works, which are not by their nature extensions of the covered work,
and which are not combined with it such as to form a larger program,
in or on a volume of a storage or distribution medium, is called an
"aggregate" if the compilation and its resulting copyright are not
used to limit the access or legal rights of the compilation's users
beyond what the individual works permit.  Inclusion of a covered work
in an aggregate does not cause this License to apply to the other
parts of the aggregate.

  6. Conveying Non-Source Forms.

  You may convey a covered work in object code form under the terms
of sections 4 and 5, provided that you also convey the
machine-readable Corresponding Source under the terms of this License,
in one of these ways:

    a) Convey the object code in, or embodied in, a physical product
    (including a physical distribution medium), accompanied by the
    Corresponding Source fixed on a durable physical medium
    customarily used for software interchange.

    b) Convey the object code in, or embodied in, a physical product
    (including a physical distribution medium), accompanied by a
    written offer, valid for at least three years and valid for as
    long as you offer spare parts or customer support for that product
    model, to give anyone who possesses the object code either (1) a
    copy of the Corresponding Source for all the software in the
    product that is covered by this License, on a durable physical
    medium customarily used for software interchange, for a price no
    more than your reasonable cost of physically performing this
    conveying of source, or (2) access to copy the
    Corresponding Source from a network server at no charge.

    c) Convey individual copies of the object code with a copy of the
    written offer to provide the Corresponding Source.  This
    alternative is allowed only occasionally and noncommercially, and
    only if you received the object code with such an offer, in accord
    with subsection 6b.

    d) Convey the object code by offering access from a designated
    place (gratis or for a charge), and offer equivalent access to the
    Corresponding Source in the same way through the same place at no
    further charge.  You need not require recipients to copy the
    Corresponding Source along with the object code.  If the place to
    copy the object code is a network server, the Corresponding Source
    may be on a different server (operated by you or a third party)
    that supports equivalent copying facilities, provided you maintain
    clear directions next to the object code saying where to find the
    Corresponding Source.  Regardless of what server hosts the
    Corresponding Source, you remain obligated to ensure that it is
    available for as long as needed to satisfy these requirements.

    e) Convey the object code using peer-to-peer transmission, provided
    you inform other peers where the object code and Corresponding
    Source of the work are being offered to the general public at no
    charge under subsection 6d.

  A separable portion of the object code, whose source code is excluded
from the Corresponding Source as a System Library, need not be
included in conveying the object code work.

  A "User Product" is either (1) a "consumer product", which means any
tangible personal property which is normally used for personal, family,
or household purposes, or (2) anything designed or sold for incorporation
into a dwelling.  In determining whether a product is a consumer product,
doubtful cases shall be resolved in favor of coverage.  For a particular
product received by a particular user, "normally used" refers to a
typical or common use of that class of product, regardless of the status
of the particular user or of the way in which the particular user
actually uses, or expects or is expected to use, the product.  A product
is a consumer product regardless of whether the product has substantial
commercial, industrial or non-consumer uses, unless such uses represent
the only significant mode of use of the product.

  "Installation Information" for a User Product means any methods,
procedures, authorization keys, or other information required to install
and execute modified versions of a covered work in that User Product from
a modified version of its Corresponding Source.  The information must
suffice to ensure that the continued functioning of the modified object
code is in no case prevented or interfered with solely because
modification has been made.

  If you convey an object code work under this section in, or with, or
specifically for use in, a User Product, and the conveying occurs as
part of a transaction in which the right of possession and use of the
User Product is transferred to the recipient in perpetuity or for a
fixed term (regardless of how the transaction is characterized), the
Corresponding Source conveyed under this section must be accompanied
by the Installation Information.  But this requirement does not apply
if neither you nor any third party retains the ability to install
modified object code on the User Product (for example, the work has
been installed in ROM).

  The requirement to provide Installation Information does not include a
requirement to continue to provide support service, warranty, or updates
for a work that has been modified or installed by the recipient, or for
the User Product in which it has been modified or installed.  Access to a
network may be denied when the modification itself materially and
adversely affects the operation of the network or violates the rules and
protocols for communication across the network.

  Corresponding Source conveyed, and Installation Information provided,
in accord with this section must be in a format that is publicly
documented (and with an implementation available to the public in
source code form), and must require no special password or key for
unpacking, reading or copying.

  7. Additional Terms.

  "Additional permissions" are terms that supplement the terms of this
License by making exceptions from one or more of its conditions.
Additional permissions that are applicable to the entire Program shall
be treated as though they were included in this License, to the extent
that they are valid under applicable law.  If additional permissions
apply only to part of the Program, that part may be used separately
under those permissions, but the entire Program remains governed by
this License without regard to the additional permissions.

  When you convey a copy of a covered work, you may at your option
remove any additional permissions from that copy, or from any part of
it.  (Additional permissions may be written to require their own
removal in certain cases when you modify the work.)  You may place
additional permissions on material, added by you to a covered work,
for which you have or can give appropriate copyright permission.

  Notwithstanding any other provision of this License, for material you
add to a covered work, you may (if authorized by the copyright holders of
that material) supplement the terms of this License with terms:

    a) Disclaiming warranty or limiting liability differently from the
    terms of sections 15 and 16 of this License; or

    b) Requiring preservation of specified reasonable legal notices or
    author attributions in that material or in the Appropriate Legal
    Notices displayed by works containing it; or

    c) Prohibiting misrepresentation of the origin of that material, or
    requiring that modified versions of such material be marked in
    reasonable ways as different from the original version; or

    d) Limiting the use for publicity purposes of names of licensors or
    authors of the material; or

    e) Declining to grant rights under trademark law for use of some
    trade names, trademarks, or service marks; or

    f) Requiring indemnification of licensors and authors of that
    material by anyone who conveys the material (or modified versions of
    it) with contractual assumptions of liability to the recipient, for
    any liability that these contractual assumptions directly impose on
    those licensors and authors.

  All other non-permissive additional terms are considered "further
restrictions" within the meaning of section 10.  If the Program as you
received it, or any part of it, contains a notice stating that it is
governed by this License along with a term that is a further
restriction, you may remove that term.  If a license document contains
a further restriction but permits relicensing or conveying under this
License, you may add to a covered work material governed by the terms
of that license document, provided that the further restriction does
not survive such relicensing or conveying.

  If you add terms to a covered work in accord with this section, you
must place, in the relevant source files, a statement of the
additional terms that apply to those files, or a notice indicating
where to find the applicable terms.

  Additional terms, permissive or non-permissive, may be stated in the
form of a separately written license, or stated as exceptions;
the above requirements apply either way.

  8. Termination.

  You may not propagate or modify a covered work except as expressly
provided under this License.  Any attempt otherwise to propagate or
modify it is void, and will automatically terminate your rights under
this License (including any patent licenses granted under the third
paragraph of section 11).

  However, if you cease all violation of this License, then your
license from a particular copyright holder is reinstated (a)
provisionally, unless and until the copyright holder explicitly and
finally terminates your license, and (b) permanently, if the copyright
holder fails to notify you of the violation by some reasonable means
prior to 60 days after the cessation.

  Moreover, your license from a particular copyright holder is
reinstated permanently if the copyright holder notifies you of the
violation by some reasonable means, this is the first time you have
received notice of violation of this License (for any work) from that
copyright holder, and you cure the violation prior to 30 days after
your receipt of the notice.

  Termination of your rights under this section does not terminate the
licenses of parties who have received copies or rights from you under
this License.  If your rights have been terminated and not permanently
reinstated, you do not qualify to receive new licenses for the same
material under section 10.

  9. Acceptance Not Required for Having Copies.

  You are not required to accept this License in order to receive or
run a copy of the Program.  Ancillary propagation of a covered work
occurring solely as a consequence of using peer-to-peer transmission
to receive a copy likewise does not require acceptance.  However,
nothing other than this License grants you permission to propagate or
modify any covered work.  These actions infringe copyright if you do
not accept this License.  Therefore, by modifying or propagating a
covered work, you indicate your acceptance of this License to do so.

  10. Automatic Licensing of Downstream Recipients.

  Each time you convey a covered work, the recipient automatically
receives a license from the original licensors, to run, modify and
propagate that work, subject to this License.  You are not responsible
for enforcing compliance by third parties with this License.

  An "entity transaction" is a transaction transferring control of an
organization, or substantially all assets of one, or subdividing an
organization, or merging organizations.  If propagation of a covered
work results from an entity transaction, each party to that
transaction who receives a copy of the work also receives whatever
licenses to the work the party's predecessor in interest had or could
give under the previous paragraph, plus a right to possession of the
Corresponding Source of the work from the predecessor in interest, if
the predecessor has it or can get it with reasonable efforts.

  You may not impose any further restrictions on the exercise of the
rights granted or affirmed under this License.  For example, you may
not impose a license fee, royalty, or other charge for exercise of
rights granted under this License, and you may not initiate litigation
(including a cross-claim or counterclaim in a lawsuit) alleging that
any patent claim is infringed by making, using, selling, offering for
sale, or importing the Program or any portion of it.

  11. Patents.

  A "contributor" is a copyright holder who authorizes use under this
License of the Program or a work on which the Program is based.  The
work thus licensed is called the contributor's "contributor version".

  A contributor's "essential patent claims" are all patent claims
owned or controlled by the contributor, whether already acquired or
hereafter acquired, that would be infringed by some manner, permitted
by this License, of making, using, or selling its contributor version,
but do not include claims that would be infringed only as a
consequence of further modification of the contributor version.  For
purposes of this definition, "control" includes the right to grant
patent sublicenses in a manner consistent with the requirements of
this License.

  Each contributor grants you a non-exclusive, worldwide, royalty-free
patent license under the contributor's essential patent claims, to
make, use, sell, offer for sale, import and otherwise run, modify and
propagate the contents of its contributor version.

  In the following three paragraphs, a "patent license" is any express
agreement or commitment, however denominated, not to enforce a patent
(such as an express permission to practice a patent or covenant not to
sue for patent infringement).  To "grant" such a patent license to a
party means to make such an agreement or commitment not to enforce a
patent against the party.

  If you convey a covered work, knowingly relying on a patent license,
and the Corresponding Source of the work is not available for anyone
to copy, free of charge and under the terms of this License, through a
publicly available network server or other readily accessible means,
then you must either (1) cause the Corresponding Source to be so
available, or (2) arrange to deprive yourself of the benefit of the
patent license for this particular work, or (3) arrange, in a manner
consistent with the requirements of this License, to extend the patent
license to downstream recipients.  "Knowingly relying" means you have
actual knowledge that, but for the patent license, your conveying the
covered work in a country, or your recipient's use of the covered work
in a country, would infringe one or more identifiable patents in that
country that you have reason to believe are valid.

  If, pursuant to or in connection with a single transaction or
arrangement, you convey, or propagate by procuring conveyance of, a
covered work, and grant a patent license to some of the parties
receiving the covered work authorizing them to use, propagate, modify
or convey a specific copy of the covered work, then the patent license
you grant is automatically extended to all recipients of the covered
work and works based on it.

  A patent license is "discriminatory" if it does not include within
the scope of its coverage, prohibits the exercise of, or is
conditioned on the non-exercise of one or more of the rights that are
specifically granted under this License.  You may not convey a covered
work if you are a party to an arrangement with a third party that is
in the business of distributing software, under which you make payment
to the third party based on the extent of your activity of conveying
the work, and under which the third party grants, to any of the
parties who would receive the covered work from you, a discriminatory
patent license (a) in connection with copies of the covered work
conveyed by you (or copies made from those copies), or (b) primarily
for and in connection with specific products or compilations that
contain the covered work, unless you entered into that arrangement,
or that patent license was granted, prior to 28 March 2007.

  Nothing in this License shall be construed as excluding or limiting
any implied license or other defenses to infringement that may
otherwise be available to you under applicable patent law.

  12. No Surrender of Others' Freedom.

  If conditions are imposed on you (whether by court order, agreement or
otherwise) that contradict the conditions of this License, they do not
excuse you from the conditions of this License.  If you cannot convey a
covered work so as to satisfy simultaneously your obligations under this
License and any other pertinent obligations, then as a consequence you may
not convey it at all.  For example, if you agree to terms that obligate you
to collect a royalty for further conveying from those to whom you convey
the Program, the only way you could satisfy both those terms and this
License would be to refrain entirely from conveying the Program.

  13. Remote Network Interaction; Use with the GNU General Public License.

  Notwithstanding any other provision of this License, if you modify the
Program, your modified version must prominently offer all users
interacting with it remotely through a computer network (if your version
supports such interaction) an opportunity to receive the Corresponding
Source of your version by providing access to the Corresponding Source
from a network server at no charge, through some standard or customary
means of facilitating copying of software.  This Corresponding Source
shall include the Corresponding Source for any work covered by version 3
of the GNU General Public License that is incorporated pursuant to the
following paragraph.

  Notwithstanding any other provision of this License, you have
permission to link or combine any covered work with a work licensed
under version 3 of the GNU General Public License into a single
combined work, and to convey the resulting work.  The terms of this
License will continue to apply to the part which is the covered work,
but the work with which it is combined will remain governed by version
3 of the GNU General Public License.

  14. Revised Versions of this License.

  The Free Software Foundation may publish revised and/or new versions of
the GNU Affero General Public License from time to time.  Such new versions
will be similar in spirit to the present version, but may differ in detail to
address new problems or concerns.

  Each version is given a distinguishing version number.  If the
Program specifies that a certain numbered version of the GNU Affero General
Public License "or any later version" applies to it, you have the
option of following the terms and conditions either of that numbered
version or of any later version published by the Free Software
Foundation.  If the Program does not specify a version number of the
GNU Affero General Public License, you may choose any version ever published
by the Free Software Foundation.

  If the Program specifies that a proxy can decide which future
versions of the GNU Affero General Public License can be used, that proxy's
public statement of acceptance of a version permanently authorizes you
to choose that version for the Program.

  Later license versions may give you additional or different
permissions.  However, no additional obligations are imposed on any
author or copyright holder as a result of your choosing to follow a
later version.

  15. Disclaimer of Warranty.

  THERE IS NO WARRANTY FOR THE PROGRAM, TO THE EXTENT PERMITTED BY
APPLICABLE LAW.  EXCEPT WHEN OTHERWISE STATED IN WRITING THE COPYRIGHT
HOLDERS AND/OR OTHER PARTIES PROVIDE THE PROGRAM "AS IS" WITHOUT WARRANTY
OF ANY KIND, EITHER EXPRESSED OR IMPLIED, INCLUDING, BUT NOT LIMITED TO,
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
PURPOSE.  THE ENTIRE RISK AS TO THE QUALITY AND PERFORMANCE OF THE PROGRAM
IS WITH YOU.  SHOULD THE PROGRAM PROVE DEFECTIVE, YOU ASSUME THE COST OF
ALL NECESSARY SERVICING, REPAIR OR CORRECTION.

  16. Limitation of Liability.

  IN NO EVENT UNLESS REQUIRED BY APPLICABLE LAW OR AGREED TO IN WRITING
WILL ANY COPYRIGHT HOLDER, OR ANY OTHER PARTY WHO MODIFIES AND/OR CONVEYS
THE PROGRAM AS PERMITTED ABOVE, BE LIABLE TO YOU FOR DAMAGES, INCLUDING ANY
GENERAL, SPECIAL, INCIDENTAL OR CONSEQUENTIAL DAMAGES ARISING OUT OF THE
USE OR INABILITY TO USE THE PROGRAM (INCLUDING BUT NOT LIMITED TO LOSS OF
DATA OR DATA BEING RENDERED INACCURATE OR LOSSES SUSTAINED BY YOU OR THIRD
PARTIES OR A FAILURE OF THE PROGRAM TO OPERATE WITH ANY OTHER PROGRAMS),
EVEN IF SUCH HOLDER OR OTHER PARTY HAS BEEN ADVISED OF THE POSSIBILITY OF
SUCH DAMAGES.

  17. Interpretation of Sections 15 and 16.

  If the disclaimer of warranty and limitation of liability provided
above cannot be given local legal effect according to their terms,
reviewing courts shall apply local law that most closely approximates
an absolute waiver of all civil liability in connection with the
Program, unless a warranty or assumption of liability accompanies a
copy of the Program in return for a fee.

                     END OF TERMS AND CONDITIONS

            How to Apply These Terms to Your New Programs

  If you develop a new program, and you want it to be of the greatest
possible use to the public, the best way to achieve this is to make it
free software which everyone can redistribute and change under these terms.

  To do so, attach the following notices to the program.  It is safest
to attach them to the start of each source file to most effectively
state the exclusion of warranty; and each file should have at least
the "copyright" line and a pointer to where the full notice is found.

    <one line to give the program's name and a brief idea of what it does.>
    Copyright (C) <year>  <name of author>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.

Also add information on how to contact you by electronic and paper mail.

  If your software can interact with users remotely through a computer
network, you should also make sure that it provides a way for users to
get its source.  For example, if your program is a web application, its
interface could display a "Source" link that leads users to an archive
of the code.  There are many ways you could offer source, and different
solutions will be better for different programs; see section 13 for the
specific requirements.

  You should also get your employer (if you work as a programmer) or school,
if any, to sign a "copyright disclaimer" for the program, if necessary.
For more information on this, and how to apply and follow the GNU AGPL, see
<https://www.gnu.org/licenses/>.

*/
