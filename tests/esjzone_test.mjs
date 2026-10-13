import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

function extension(settings = {}) {
  const context = vm.createContext({ sendMessage() {} });
  vm.runInContext(fs.readFileSync(new URL('../fixtures/runtime.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../sources/esjzone.js', import.meta.url), 'utf8')
    .replace('export default class', 'globalThis.Source = class'), context);
  const source = vm.runInContext('new Source()', context);
  source.webSite = 'https://www.esjzone.cc';
  source.getSetting = async key => settings[key] || '';
  return source;
}

const member = '<h6 class="user-name">演示用户</h6>';
const token = 'test-token-for-site-protocol';

function mockLogin(source, calls, status = 200) {
  source.request = async (path, options = {}) => {
    calls.push([path, options]);
    if (path === '/my/login' && options.method === 'post') return `<JinJing>${token}</JinJing>`;
    if (path === '/inc/mem_login.php') return { status, msg: '验证结果' };
    if (path === '/my/profile.html') return member;
    return '<form class="login-box"></form>';
  };
}

test('login obtains the official callback token before sending credentials and verifies its session cookie', async () => {
  const source = extension({ email: 'demo@example.invalid', password: 'A & B+' }), calls = [];
  mockLogin(source, calls);
  assert.equal(await source.ensureLogin(false), true);
  assert.deepEqual(calls.map(x => x[0]), ['/my/login', '/my/login', '/inc/mem_login.php', '/my/profile.html']);
  assert.equal(calls[1][1].data, 'plxf=getAuthToken');
  assert.equal(calls[2][1].headers.authorization, token);
  const form = new URLSearchParams(calls[2][1].data);
  assert.equal(form.get('email'), 'demo@example.invalid');
  assert.equal(form.get('pwd'), 'A & B+');
  assert.equal(calls[2][1].retry, false);
  await source.ensureLogin(false);
  assert.equal(calls.length, 4);
});

test('expired-authorization status 301 is rejected instead of claiming that login succeeded', async () => {
  const source = extension({ email: 'demo@example.invalid', password: 'demo' }), calls = [];
  mockLogin(source, calls, 301);
  await assert.rejects(source.ensureLogin(false), /登入失敗/);
  assert.equal(source.loggedIn, false);
  assert.equal(source._loginPending, null);
  assert.equal(calls.length, 3);
});

test('concurrent entry points perform only one login and a failed attempt can be retried', async () => {
  const source = extension({ email: 'demo@example.invalid', password: 'demo' }), calls = [];
  mockLogin(source, calls);
  await Promise.all([source.ensureLogin(false), source.ensureLogin(false), source.ensureLogin(false)]);
  assert.equal(calls.length, 4);
  source.loggedIn = false;
  mockLogin(source, calls, 203);
  await assert.rejects(source.ensureLogin(false), /登入失敗/);
  mockLogin(source, calls);
  assert.equal(await source.ensureLogin(false), true);
});

test('guests do not submit credentials and translated channels explain the login requirement', async () => {
  const source = extension();
  source.request = async () => { throw new Error('should not request'); };
  assert.equal(await source.ensureLogin(false), false);
  await assert.rejects(source.latest(1, 'japanese'), /翻譯小說需要登入/);
  const incomplete = extension({ email: 'demo@example.invalid' });
  await assert.rejects(incomplete.ensureLogin(false), /同時填寫/);
});

test('a verification page never reaches the credential POST; a lost cookie is a login error', async () => {
  const source = extension({ email: 'demo@example.invalid', password: 'demo' }), calls = [];
  source.request = async path => { calls.push(path); return '<html><title>Just a moment</title></html>'; };
  await assert.rejects(source.ensureLogin(false), /驗證資料/);
  assert.equal(calls.includes('/inc/mem_login.php'), false);
  source.request = async (path, options = {}) => path === '/inc/mem_login.php' ? { status: 200 }
    : options.method === 'post' ? `<JinJing>${token}</JinJing>` : '<h6 class="user-name"></h6>';
  await assert.rejects(source.ensureLogin(false), /Cookie/);
});

test('listing and search authenticate before fetching their data, including Japanese and Korean routes', async () => {
  const source = extension(), events = [];
  source.ensureLogin = async () => { events.push('login'); return true; };
  source.request = async path => { events.push(path); return '<html></html>'; };
  source.parseCards = async () => [];
  await source.latest(2, 'japanese');
  await source.latest(3, 'korean');
  await source.latest(1, 'original');
  await source.search('关键词 & A', 2);
  assert.deepEqual(events.filter(x => x !== 'login'), ['/list-11/2.html', '/list-31/3.html', '/list-21/', '/tags/' + encodeURIComponent('关键词 & A') + '/2.html']);
  assert.equal(events[0], 'login');
});

test('a member page that became a guest response reauthenticates once instead of showing a hidden catalogue', async () => {
  const source = extension(), events = [];
  source.loggedIn = true;
  source.ensureLogin = async force => { events.push(force); return true; };
  source.request = async () => events.includes(true) ? member : '<h6 class="user-name"></h6>';
  assert.equal(await source.page('/list-1/'), member);
  assert.deepEqual(events, [false, true]);
});

test('cover extraction uses lazy list images and the detail product gallery, never avatars or site logos', async () => {
  const source = extension(), selected = [];
  source.getAttributeText = async (_, selector, attr) => {
    selected.push([selector, attr]);
    return selector === '.main-img [data-src]' && attr === 'data-src' ? '//images.example/cover.png?a=1&amp;b=2' : null;
  };
  assert.equal(await source.cover('list-card'), 'https://images.example/cover.png?a=1&b=2');
  source.getAttributeText = async (_, selector, attr) => selector === '.product-gallery img' && attr === 'src'
    ? 'https://images.example/novel-cover.file' : null;
  assert.equal(await source.cover('detail', true), 'https://images.example/novel-cover.file');
  assert.equal(source.imageUrl('javascript:alert(1)'), '');
  assert.equal(source.imageUrl('data:image/png;base64,AAAA'), '');
});

test('cards retain book URLs, deduplicate repeated cards and include cover and update data', async () => {
  const source = extension();
  source.querySelectorAll = async () => [{ content: 'card-1' }, { content: 'card-1' }, { content: 'card-2' }];
  source.getAttributeText = async (html, selector) => selector === 'h5.card-title a' ? '/detail/' + (html === 'card-1' ? '7' : '8') + '.html' : null;
  source.querySelector = async (_, selector) => ({ text: selector === '.card-ep a' ? '第2章' : '示例小说' });
  source.cover = async html => 'https://images.example/' + html + '.png';
  const rows = await source.parseCards('list');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].url, '/detail/7.html');
  assert.equal(rows[0].cover, 'https://images.example/card-1.png');
  assert.equal(rows[0].update, '第2章');
});

test('a hidden translated book produces a login hint instead of an empty-title detail', async () => {
  const source = extension();
  source.page = async () => '<h1>論壇</h1>';
  source.querySelectorAll = async () => [];
  source.querySelector = async () => ({ text: '' });
  await assert.rejects(source.detail('/detail/7.html'), /需要登入/);
});
