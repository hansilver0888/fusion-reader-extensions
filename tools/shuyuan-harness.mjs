// SPDX-License-Identifier: MIT
// Offline harness for the shuyuan plugin: real HTML5 DOM parsing through the
// shared Python bridge, no network. Mirrors tools/sonovel-harness.mjs.
import fs from 'node:fs';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
let worker, seq = 0;
const pending = new Map();
function call(payload) {
  if (!worker) {
    worker = spawn(process.env.PYTHON || 'python', [fileURLToPath(new URL('./sonovel_dom.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
    worker.stderr.on('data', () => {});
    createInterface({ input: worker.stdout }).on('line', (line) => {
      const result = JSON.parse(line);
      const job = pending.get(result.id);
      if (!job) return;
      pending.delete(result.id);
      result.ok ? job.resolve(result.value) : job.reject(new Error(result.error));
    });
    worker.on('error', (error) => { for (const job of pending.values()) job.reject(error); pending.clear(); });
    worker.on('exit', () => { for (const job of pending.values()) job.reject(new Error('DOM bridge exited')); pending.clear(); worker = null; });
  }
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.stdin.write(JSON.stringify({ id, ...payload }) + '\n'); });
}
export function closeBridge() { if (worker) worker.kill(); }
export function source(settings = {}) {
  let ctx;
  ctx = vm.createContext({ Date, sendMessage(channel, payload) {
    const { id, payload: data } = JSON.parse(payload);
    if (channel === 'querySelectorAll') call({ op: 'dom', content: data.content, selector: data.selector })
      .then((value) => ctx.__resolveBridge(id, true, JSON.stringify(value)), (error) => ctx.__resolveBridge(id, false, JSON.stringify(error.message)));
    else throw new Error('Unexpected bridge channel: ' + channel);
  } });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(new URL('../sources/shuyuan.js', import.meta.url), 'utf8').replace('export default class', 'globalThis.Source = class'), ctx);
  const ext = vm.runInContext('new Source()', ctx);
  ext.registerSetting = async () => {};
  ext.getSetting = async (key) => (settings[key] != null ? settings[key] : '');
  ext.sleep = async () => {};
  ext.request = async () => { throw new Error('Unexpected network request'); };
  return ext;
}
