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
