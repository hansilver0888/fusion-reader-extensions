// SPDX-License-Identifier: AGPL-3.0-only
// Opt-in live check. Fetches one chosen work per source; prints counts only.
import {source,http,closeBridge} from './sonovel-harness.mjs';
const ids=process.argv.slice(2).length?process.argv.slice(2):['bqg-info','d8zw-com','shuhaige-net'];
let failed=false;
try {
 for(const id of ids){
  const plugin=source(),calls=[];plugin.request=async(url,options)=>{calls.push(url);return http(url,options);};
  const result={source:id};
  try {
   const latest=await plugin.latest(1,id);result.homeItems=latest.length;
   const matches=await plugin.search('西游记',1);result.searchItems=matches.length;
   const item=matches[0]||latest[0];if(!item)throw Error('No discoverable work');
   const detail=await plugin.detail(item.url);result.hasTitle=!!detail.title;result.hasAuthor=!!detail.authors?.length;result.hasCover=!!detail.cover;
   result.chapters=detail.episodes.reduce((n,g)=>n+g.urls.length,0);if(!result.chapters)throw Error('Empty catalog');
   const watched=await plugin.watch(detail.episodes[0].urls[0].url);
   const lines=watched.content.filter(x=>typeof x==='string');result.paragraphs=lines.length;result.characters=lines.join('').length;
   if(result.characters<100)throw Error('Chapter too short');
   result.requests=calls.length;result.ok=true;
  }catch(error){result.ok=false;result.error=error.message;result.requests=calls.length;failed=true;}
  console.log(JSON.stringify(result));
 }
}finally{closeBridge();}
if(failed)process.exitCode=1;
