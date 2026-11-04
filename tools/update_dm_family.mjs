// SPDX-License-Identifier: MIT
import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const common = fs.readFileSync(new URL('tools/dm-family-runtime.js', root), 'utf8').replace(/\r\n/g, '\n');
const license = fs.readFileSync(new URL('licenses/Aidoku-sources-MIT.txt', root), 'utf8').replace(/\r\n/g, '\n');
const configs = [
  { kind: 'mangabz', name: 'MangaBZ 漫画', base: 'https://mangabz.com', hosts: ['mangabz.com','www.mangabz.com'],
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36' },
  { kind: 'dm5', name: '动漫屋', base: 'https://www.dm5.com', hosts: ['www.dm5.com','www.dm5.cn','m.dm5.com'],
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36' },
];
for (const config of configs) {
  const header = [
    '// ==MiruExtension==', '// @name         ' + config.name, '// @version      v1.0.0',
    '// @author       Community adaptation', '// @lang         zh', '// @license      MIT',
    '// @package      ' + config.kind, '// @type         manga',
    '// @webSite      ' + config.base, '// @network      auto', '// @nsfw         false',
    '// ==/MiruExtension==', '// Protocol reference: Aidoku-Community/sources, zh.' + config.kind,
    '// Shared adaptation: tools/dm-family-runtime.js (data-only image decoding).',
    '// Source and standalone bundles are distributed with the upstream MIT notice below.', '',
  ].join('\n');
  fs.writeFileSync(new URL('sources/' + config.kind + '.js', root),
    header + '\nconst DM_SITE = ' + JSON.stringify(config) + ';\n\n' + common + '\n/*\n' + license + '*/\n');
}
console.log('Generated MangaBZ and DM5 standalone plugins.');
