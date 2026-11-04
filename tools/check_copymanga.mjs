// Optional live check. Success requires a complete directory AND readable images.
// COPYMANGA_TEST_PROXY selects a test-only HTTP proxy; nothing is bundled in the source.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const proxy = process.env.COPYMANGA_TEST_PROXY || '';
if (proxy) {
  const parsed = new URL(proxy);
  assert.equal(parsed.protocol, 'http:');
  assert.ok(!parsed.username && !parsed.password, 'test proxy must not embed credentials');
}
const context = vm.createContext({ sendMessage() {}, Date });
vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
vm.runInContext(fs.readFileSync(new URL('../sources/copymanga.js', import.meta.url), 'utf8')
  .replace('export default class', 'globalThis.Source = class'), context);
const source = vm.runInContext('new Source()', context);
source.webSite = 'https://www.copy5000.com';
source.getSetting = async () => '';
source.sleep = async (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let requests = 0;

async function request(url, options = {}, discardImage = false) {
  requests += 1;
  if (proxy) {
    const args = ['--proxy', proxy, '--fail-with-body', '--location', '--silent', '--show-error', '--max-time', '30'];
    for (const [key, value] of Object.entries(options.headers || {})) args.push('--header', key + ': ' + value);
    if (discardImage) args.push('--output', process.platform === 'win32' ? 'NUL' : '/dev/null', '--write-out', '%{http_code} %{content_type} %{size_download}');
    args.push(url);
    const { stdout } = await exec('curl', args, { encoding: 'utf8', timeout: 35000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    return stdout;
  }
  const response = await fetch(url, { headers: options.headers, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  assert.ok(response.ok, 'HTTP request failed: ' + response.status);
  if (!discardImage) return response.text();
  const data = await response.arrayBuffer();
  return `${response.status} ${response.headers.get('content-type')} ${data.byteLength}`;
}
source.request = request;

const report = { source: 'copymanga', ok: false };
try {
  report.channels = (await source.channels()).length;
  const newest = await source.latest(1, '0');
  assert.ok(newest.length > 0, 'newest feed is empty');
  report.newest = newest.length;
  report.popular = (await source.latest(1, '1')).length;
  assert.ok(report.popular > 0, 'popular feed is empty');
  const found = await source.search('海賊王', 1);
  assert.ok(found.length > 0, 'search is empty');
  report.searchMatches = found.length;
  const detail = await source.detail(found[0].url);
  assert.ok(detail.title && detail.cover && detail.desc, 'detail metadata is incomplete');
  const chapters = detail.episodes.flatMap((group) => group.urls);
  assert.ok(chapters.length > 1, 'directory is incomplete');
  report.chapters = chapters.length;
  report.reader = [];
  for (const chapter of [chapters[0], chapters[chapters.length - 1]]) {
    const stream = await source.watch(chapter.url);
    assert.ok(stream.urls.length > 0, 'reader returned no pages');
    const image = await request(stream.urls[0], {}, true);
    assert.match(image, /^200 image\//, 'first image is not readable');
    assert.ok(Number(image.split(' ').at(-1)) > 0, 'image is empty');
    report.reader.push({ chapter: chapter.name, pages: stream.urls.length, firstImage: image });
  }
  report.ok = true;
} catch (error) {
  report.error = String(error.message || error).slice(0, 240);
  process.exitCode = 1;
}
report.requests = requests;
console.log(JSON.stringify(report, null, 2));
