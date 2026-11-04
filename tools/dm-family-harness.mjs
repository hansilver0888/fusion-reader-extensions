// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

let processHandle;
let sequence = 0;
const jobs = new Map();
function select(html, selector) {
  if (!processHandle) {
    processHandle = spawn(process.env.PYTHON || 'python', [fileURLToPath(new URL('html_test_bridge.py', import.meta.url))]);
    const fail = () => { for (const job of jobs.values()) job.reject(new Error('HTML fixture stopped')); jobs.clear(); };
    processHandle.on('error', fail);
    processHandle.on('exit', () => { fail(); processHandle = undefined; });
    processHandle.stderr.resume();
    createInterface({ input: processHandle.stdout }).on('line', (line) => {
      const reply = JSON.parse(line), job = jobs.get(reply.id);
      if (!job) return;
      jobs.delete(reply.id);
      reply.error ? job.reject(new Error(reply.error)) : job.resolve(reply.result);
    });
  }
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    processHandle.stdin.write(JSON.stringify({ id, html, selector }) + '\n');
  });
}
export function closeBridge() { if (processHandle) processHandle.kill(); }
export function source(kind, { clock = true } = {}) {
  let now = 100000;
  class Clock extends Date { static now() { return now; } }
  let context;
  context = vm.createContext({
    Date: clock ? Clock : Date,
    sendMessage(channel, raw) {
      if (!['querySelector', 'querySelectorAll'].includes(channel)) throw new Error('Unexpected bridge ' + channel);
      const call = JSON.parse(raw);
      select(call.payload.content, call.payload.selector).then(
        (items) => context.__resolveBridge(call.id, true, JSON.stringify(channel === 'querySelector' ? items[0] || {} : items)),
        () => context.__resolveBridge(call.id, false, JSON.stringify('DOM fixture failed')),
      );
    },
  });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/' + kind + '.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const result = vm.runInContext('new Source()', context);
  result.sleep = async (ms) => { if (clock) now += ms; else await new Promise((resolve) => setTimeout(resolve, ms)); };
  result.advance = (ms) => { now += ms; };
  result.request = async () => { throw new Error('Unexpected network request'); };
  return result;
}
