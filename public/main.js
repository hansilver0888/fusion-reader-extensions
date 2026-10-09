const labels = {manga:'漫画', novel:'小说', anime:'动画'};
const symbols = {manga:'▧', novel:'文', anime:'▷'};
let entries = [], selectedType = 'all', toastTimer;
function toast(message) { const node=document.querySelector('#toast'); node.textContent=message; node.hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>node.hidden=true,2600); }
async function copy(value) { try { await navigator.clipboard.writeText(value); toast('已复制，在聚阅中粘贴即可'); } catch { toast('复制不可用，请复制仓库地址：'+value); } }
function element(tag, text, className) { const node=document.createElement(tag); if(text)node.textContent=text; if(className)node.className=className; return node; }
function render() {
  const query=document.querySelector('#search').value.trim().toLowerCase();
  const filtered=entries.filter(e=>(selectedType==='all'||e.type===selectedType)&&`${e.name} ${e.package} ${e.lang}`.toLowerCase().includes(query));
  const catalog=document.querySelector('#catalog'); catalog.replaceChildren();
  for(const entry of filtered) {
    const card=element('article',null,'card'); card.append(element('div',symbols[entry.type],'symbol'));
    const title=element('h2',entry.name); if(entry.nsfw)title.append(element('span','18+','badge')); card.append(title);
    card.append(element('div',`${labels[entry.type]} · ${entry.lang} · ${entry.version}`,'meta')); card.append(element('div',entry.package,'meta'));
    const button=element('button','复制安装链接'); button.addEventListener('click',()=>copy(new URL(entry.url, location.href).href)); card.append(button); catalog.append(card);
  }
  document.querySelector('#status').textContent=filtered.length?`${filtered.length} 个插件 · 可在应用内安装及更新`:'没有匹配的插件';
}
document.querySelector('#copy-repository').addEventListener('click',()=>copy(new URL('index.json',location.href).href));
document.querySelector('#search').addEventListener('input',render);
document.querySelectorAll('[data-type]').forEach(button=>button.addEventListener('click',()=>{selectedType=button.dataset.type;document.querySelectorAll('[data-type]').forEach(node=>node.setAttribute('aria-pressed',String(node===button)));render();}));
fetch('index.json',{cache:'no-cache'}).then(response=>{if(!response.ok)throw Error();return response.json();}).then(index=>{if(index.schemaVersion!==1||!Array.isArray(index.extensions))throw Error();entries=index.extensions;render();}).catch(()=>{document.querySelector('#status').textContent='暂时无法读取目录，请稍后刷新或在应用内查看插件仓库。';});
