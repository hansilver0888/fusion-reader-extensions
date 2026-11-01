import {source,http,closeBridge} from './sonovel-harness.mjs';
const plugin=source();plugin.request=http;
try{
 for(const r of plugin.rules()){
  let result={id:r.id};
  try{
   const home=await plugin.home(r);result.home=home.length;
   const matches=await plugin.searchOne(r,'西游记',1);result.matches=matches.length;result.ok=true;
  }catch(error){result.ok=false;result.error=error.message;}
  console.log(JSON.stringify(result));
 }
}finally{closeBridge();}
