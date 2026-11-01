// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
let worker, seq=0;
const pending=new Map();
function call(payload) {
  if (!worker) {
    worker=spawn(process.env.PYTHON||'python',[fileURLToPath(new URL('./sonovel_dom.py',import.meta.url))],{stdio:['pipe','pipe','pipe']});
    worker.stderr.on('data',()=>{});
    createInterface({input:worker.stdout}).on('line',line=>{
      const result=JSON.parse(line), job=pending.get(result.id);if(!job)return;pending.delete(result.id);
      result.ok?job.resolve(result.value):job.reject(new Error(result.error));
    });
    worker.on('error',error=>{for(const job of pending.values())job.reject(error);pending.clear();});
    worker.on('exit',()=>{for(const job of pending.values())job.reject(new Error('DOM bridge exited'));pending.clear();worker=null;});
  }
  const id=++seq;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.stdin.write(JSON.stringify({id,...payload})+'\n');});
}
export function closeBridge() { if(worker)worker.kill(); }
export async function http(url,options) { return call({op:'http',url,options}); }
export function source({clock=false}={}) {
  let now=1700000000000,ctx;
  const NativeDate=Date;
  class TestDate extends NativeDate { static now(){return now;} }
  ctx=vm.createContext({Date:clock?TestDate:Date,sendMessage(channel,payload){
    const {id,payload:data}=JSON.parse(payload);
    if(channel==='querySelectorAll') call({op:'dom',content:data.content,selector:data.selector})
      .then(value=>ctx.__resolveBridge(id,true,JSON.stringify(value)),error=>ctx.__resolveBridge(id,false,JSON.stringify(error.message)));
    else throw new Error('Unexpected bridge channel: '+channel);
  }});
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js',import.meta.url),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(new URL('../sources/sonovel.js',import.meta.url),'utf8').replace('export default class','globalThis.Source = class'),ctx);
  const result=vm.runInContext('new Source()',ctx);
  result.sleep=async ms=>{if(clock)now+=ms;else await new Promise(resolve=>setTimeout(resolve,ms));};
  result.request=async()=>{throw new Error('Unexpected network request');};
  result.advance=ms=>{now+=ms;};
  return result;
}
