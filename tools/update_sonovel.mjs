// SPDX-License-Identifier: AGPL-3.0-only
// Rebuild from the reviewed, pinned upstream snapshot. Never executes rule DSL.
import fs from 'node:fs';
import crypto from 'node:crypto';
const root = new URL('../', import.meta.url);
const raw = fs.readFileSync(new URL('fixtures/sonovel/main.json',root),'utf8').replace(/\r\n/g,'\n');
const rules = JSON.parse(raw);
const patterns = {
 'ibiqugu-net':'^/\\d+/\\d+/$', 'shuhaige-net':'^/\\d+/$',
 'mcxs-la':'^/\\d+_\\d+/$', '99wx-info':'^/tag/\\d+_\\d+/$',
 'xbiquwk-com':'^/\\d+_\\d+/$', 'ujxsw-org':'^/book/\\d+/$',
 'yeudusk-com':'^/book/\\d+/$', 'biquge365-net':'^/book/\\d+/$',
 'd8zw-com':'^/\\d+/\\d+/$', '52bqg-com':'^/book_\\d+/$',
 'snxsw-com':'^/book/\\d+/$', 'xbiquge-info':'^/\\d+/\\d+/$', 'bqg-info':'^/book/\\d+/$',
};
for (const rule of rules) {
 rule.id=new URL(rule.url).hostname.replace(/^www\./,'').replace(/\./g,'-');
 if (!patterns[rule.id]) throw Error('Unreviewed source: '+rule.id);
 rule.homePattern=patterns[rule.id];
 rule.encoded=rule.chapter.content.includes('@java:base64.decode()');
 rule.searchInterval=rule.id==='biquge365-net'?15000:rule.id==='snxsw-com'?20000:700;
}
const header=`// ==MiruExtension==
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
// Rules: bundle/rules/main.json (SHA-256 ${crypto.createHash('sha256').update(raw).digest('hex')})
// Corresponding adaptation source is distributed in this repository under AGPL-3.0-only.
// Modifications: JavaScript host bridge, bounded pagination, paced requests and reading results.

`;
const runtime=fs.readFileSync(new URL('tools/sonovel-runtime.js',root),'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
const license=fs.readFileSync(new URL('licenses/so-novel-AGPL-3.0.txt',root),'utf8').replace(/\r\n/g,'\n');
if (license.includes('*/')) throw Error('Unexpected license comment terminator');
fs.writeFileSync(new URL('sources/sonovel.js',root),header+'const SONOVEL_RULES = '+JSON.stringify(rules,null,2)+';\n\n'+runtime+'\n/* Full upstream license, retained for standalone script distribution:\n'+license+'\n*/\n');
console.log('Generated So Novel script for '+rules.length+' default sources.');
