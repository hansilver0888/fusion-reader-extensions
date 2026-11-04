// Optional live validation; never run by CI.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { source, closeBridge } from './dm-family-harness.mjs';
const run = promisify(execFile);
const proxy = process.env.DM_FAMILY_TEST_PROXY || '';
const kinds = process.argv.slice(2).length ? process.argv.slice(2) : ['mangabz', 'dm5'];
if (kinds.some((kind) => !['mangabz', 'dm5'].includes(kind))) throw new Error('Unknown source');
async function download(url, headers, image = false) {
  const args = ['-sS', '--location', '--max-time', '25'];
  if (proxy) args.push('--proxy', proxy);
  for (const [key, value] of Object.entries(headers || {})) args.push('--header', key + ': ' + value);
  if (image) args.push('--fail', '--output', process.platform === 'win32' ? 'NUL' : '/dev/null', '--write-out', '%{http_code} %{content_type} %{size_download}');
  else args.push('--write-out', '\n%{http_code}');
  args.push(url);
  const { stdout } = await run('curl', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000, windowsHide: true });
  if (image) return stdout;
  const last = stdout.lastIndexOf('\n');
  return { body: stdout.slice(0, last), status: Number(stdout.slice(last + 1)), headers: {} };
}
try {
  for (const kind of kinds) {
    const s = source(kind, { clock: false });
    let requests = 0;
    s.request = async (url, options) => { requests += 1; return download(url, options.headers); };
    const report = { source: kind, ok: false };
    try {
      const latest = await s.latest(1, 'new'); assert.ok(latest.length > 0);
      report.latest = latest.length;
      const found = await s.search('二人巴士', 1);
      const item = found.find((entry) => entry.title.trim() === '二人巴士');
      assert.ok(item, 'target work not found');
      const d = await s.detail(item.url);
      const chapters = d.episodes.flatMap((group) => group.urls);
      report.chapters = chapters.length; report.authors = d.authors.length;
      const chapter = chapters.find((entry) => /第\s*51\s*[话話]/.test(entry.name));
      assert.ok(chapter, 'chapter 51 not found');
      const stream = await s.watch(chapter.url);
      assert.equal(stream.urls.length, 19, 'chapter 51 should have all 19 pages');
      report.pages = stream.urls.length;
      report.images = [];
      for (const url of [stream.urls[0], stream.urls.at(-1)]) {
        const result = await download(url, stream.headers, true);
        assert.match(result, /^200 image\//);
        report.images.push(result);
      }
      report.ok = true;
    } catch (error) {
      report.error = String(error.message || error).replace(/https?:\/\/\S+/g, '[url]').slice(0, 180);
      process.exitCode = 1;
    }
    report.requests = requests;
    console.log(JSON.stringify(report));
  }
} finally { closeBridge(); }
