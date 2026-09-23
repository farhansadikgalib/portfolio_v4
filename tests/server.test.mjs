import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import sharp from 'sharp';
import { createPortfolioServer, initializeAdminAccount } from '../server/index.mjs';

const rootDir = resolve(import.meta.dirname, '..');
const credentials = { email: 'test-admin@example.test', password: 'Test-only-secret-42!' };

async function fixture(t, { configure = true, origin } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'portfolio-api-test-'));
  if (configure) await initializeAdminAccount({ dataDir, ...credentials });
  let server;
  let base;
  const start = async () => {
    server = await createPortfolioServer({ rootDir, dataDir, origin });
    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  await start();
  t.after(async () => { await new Promise(resolveClose => server.close(resolveClose)); await rm(dataDir, { recursive: true, force: true }); });
  async function request(path, { method = 'GET', body, cookie, csrf, headers = {} } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let value;
    const text = await response.text();
    try { value = JSON.parse(text); } catch { value = text; }
    return { status: response.status, headers: response.headers, value };
  }
  async function login(password = credentials.password) {
    const response = await request('/api/login', { method: 'POST', body: { ...credentials, password } });
    return { ...response, cookie: response.headers.get('set-cookie')?.split(';')[0], csrf: response.value.csrfToken };
  }
  return { request, login, dataDir, get base() { return base; }, restart: async () => { await new Promise(resolveClose => server.close(resolveClose)); await start(); } };
}

test('console reads and all mutation routes require authentication', async t => {
  const api = await fixture(t, { configure: false });
  assert.deepEqual((await api.request('/api/session')).value, { configured: false, authenticated: false });
  for (const [method, path] of [['GET', '/api/admin/content'], ['GET', '/api/admin/media'], ['PUT', '/api/admin/content'], ['POST', '/api/admin/publish'], ['POST', '/api/admin/discard'], ['POST', '/api/admin/media'], ['DELETE', '/api/admin/media/example'], ['PUT', '/api/admin/media/example'], ['POST', '/api/password'], ['POST', '/api/logout']]) {
    const result = await api.request(path, { method, ...(method === 'GET' ? {} : { body: {} }) });
    assert.equal(result.status, 401, `${method} ${path}`);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await api.request('/api/content')).status, 200);
  assert.equal((await api.request('/api/login', { method: 'POST', body: credentials })).status, 401);
  assert.equal((await api.request('/.cms-data/account.json')).status, 404);
  assert.equal((await api.request('/server/auth.mjs')).status, 404);
});

test('login, CSRF, cross-origin checks, secure headers, and logout are enforced', async t => {
  const api = await fixture(t);
  assert.equal((await api.login('incorrect-password')).status, 401);
  assert.equal((await api.request('/api/login', { method: 'POST', body: credentials, headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await api.request('/api/login', { method: 'POST', body: credentials, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const auth = await api.login();
  assert.equal(auth.status, 200);
  assert.match(auth.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(auth.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal(auth.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await api.request('/api/admin/content', auth)).status, 200);
  assert.equal((await api.request('/api/admin/publish', { method: 'POST', body: { revision: 1 }, cookie: auth.cookie })).status, 403);
  assert.equal((await api.request('/api/admin/publish', { ...auth, method: 'POST', body: { revision: 1 }, headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await api.request('/api/admin/publish', { ...auth, method: 'POST', body: { revision: 1 }, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await api.request('/api/logout', { ...auth, method: 'POST', body: {} })).status, 200);
  assert.equal((await api.request('/api/admin/content', auth)).status, 401);
});

test('drafts are private, publishing is explicit, revisions conflict, and content survives restart', async t => {
  const api = await fixture(t);
  let auth = await api.login();
  const initial = (await api.request('/api/admin/content', auth)).value;
  const document = structuredClone(initial.draft);
  document.settings.title = 'A saved private draft';
  let result = await api.request('/api/admin/content', { ...auth, method: 'PUT', body: { revision: initial.revision, document } });
  assert.equal(result.status, 200);
  assert.equal((await api.request('/api/content')).value.settings.title, initial.published.settings.title);
  assert.equal((await api.request('/api/admin/publish', { ...auth, method: 'POST', body: { revision: initial.revision } })).status, 409);
  result = await api.request('/api/admin/publish', { ...auth, method: 'POST', body: { revision: result.value.revision } });
  assert.equal(result.status, 200);
  assert.equal((await api.request('/api/content')).value.settings.title, document.settings.title);
  document.settings.title = 'Discard this change';
  result = await api.request('/api/admin/content', { ...auth, method: 'PUT', body: { revision: result.value.revision, document } });
  result = await api.request('/api/admin/discard', { ...auth, method: 'POST', body: { revision: result.value.revision } });
  assert.equal(result.value.draft.settings.title, 'A saved private draft');
  await api.restart();
  assert.equal((await api.request('/api/admin/content', auth)).status, 401, 'Restart invalidates old sessions');
  assert.equal((await api.request('/api/content')).value.settings.title, 'A saved private draft');
  auth = await api.login();
  assert.equal((await api.request('/api/admin/content', auth)).value.revision, result.value.revision);
});

test('concurrent draft writes serialize and stale revisions cannot overwrite the winner', async t => {
  const api = await fixture(t);
  const auth = await api.login();
  const initial = (await api.request('/api/admin/content', auth)).value;
  const outcomes = await Promise.all(['One', 'Two'].map(title => api.request('/api/admin/content', { ...auth, method: 'PUT', body: { revision: initial.revision, document: { ...initial.draft, settings: { ...initial.draft.settings, title } } } })));
  assert.deepEqual(outcomes.map(result => result.status).sort(), [200, 409]);
});

test('uploads normalize images, persist, reject unsafe input, and protect referenced files', async t => {
  const api = await fixture(t);
  const auth = await api.login();
  for (const data of ['not base64', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'), Buffer.from('not an image').toString('base64')]) {
    assert.equal((await api.request('/api/admin/media', { ...auth, method: 'POST', body: { name: 'Rejected image', data } })).status, 400);
  }
  const png = await sharp({ create: { width: 24, height: 32, channels: 3, background: '#abcdef' } }).png().toBuffer();
  const response = await api.request('/api/admin/media', { ...auth, method: 'POST', body: { name: '../../Example.png', data: png.toString('base64') } });
  assert.equal(response.status, 201);
  const item = response.value.item;
  assert.equal(item.mime, 'image/webp');
  assert.equal(item.width, 24);
  assert.equal(item.height, 32);
  assert.match(item.src, /^uploads\/[a-f0-9-]{36}\.webp$/);
  assert.equal((await api.request(`/${item.src}`)).headers.get('content-type'), 'image/webp');
  assert.equal((await api.request(`/api/admin/media/${item.id}`, { ...auth, method: 'PUT', body: { name: 'A renamed image' } })).value.item.name, 'A renamed image');
  const library = (await api.request('/api/admin/media', auth)).value.items;
  const original = library.find(media => !media.uploaded);
  assert.ok(original);
  assert.equal((await api.request(`/api/admin/media/${encodeURIComponent(original.id)}`, { ...auth, method: 'DELETE', body: {} })).status, 404);
  let state = (await api.request('/api/admin/content', auth)).value;
  const image = state.draft.fields.find(field => field.type === 'image');
  assert.ok(image);
  image.value = item.src;
  state = (await api.request('/api/admin/content', { ...auth, method: 'PUT', body: { revision: state.revision, document: state.draft } })).value;
  assert.equal((await api.request(`/api/admin/media/${item.id}`, { ...auth, method: 'DELETE', body: {} })).status, 409);
  state = (await api.request('/api/admin/publish', { ...auth, method: 'POST', body: { revision: state.revision } })).value;
  state.draft.fields.find(field => field.id === image.id).value = '';
  state = (await api.request('/api/admin/content', { ...auth, method: 'PUT', body: { revision: state.revision, document: state.draft } })).value;
  assert.equal((await api.request(`/api/admin/media/${item.id}`, { ...auth, method: 'DELETE', body: {} })).status, 409, 'Published references protect the image after removing it from the draft');
  state = (await api.request('/api/admin/publish', { ...auth, method: 'POST', body: { revision: state.revision } })).value;
  await api.restart();
  const renewed = await api.login();
  assert.ok((await api.request('/api/admin/media', renewed)).value.items.some(media => media.id === item.id));
  assert.equal((await api.request(`/api/admin/media/${item.id}`, { ...renewed, method: 'DELETE', body: {} })).status, 200);
  assert.equal((await api.request(`/${item.src}`)).status, 404);
});

test('content rejects unsafe links, broken image references, malformed documents, and path traversal', async t => {
  const api = await fixture(t);
  const auth = await api.login();
  const state = (await api.request('/api/admin/content', auth)).value;
  const unsafe = structuredClone(state.draft);
  unsafe.settings.github = 'javascript:alert(1)';
  assert.equal((await api.request('/api/admin/content', { ...auth, method: 'PUT', body: { revision: state.revision, document: unsafe } })).status, 400);
  const broken = structuredClone(state.draft);
  broken.fields.find(field => field.type === 'image').value = 'uploads/does-not-exist.webp';
  assert.equal((await api.request('/api/admin/content', { ...auth, method: 'PUT', body: { revision: state.revision, document: broken } })).status, 400);
  assert.equal((await api.request('/api/admin/content', { ...auth, method: 'PUT', body: { revision: state.revision, document: {} } })).status, 400);
  for (const path of ['/assets/%2e%2e/server/auth.mjs', '/assets/..%2f..%2f.cms-data/account.json', '/uploads/..%2faccount.json', '/%00', '/%zz']) {
    const status = await new Promise((resolveStatus, reject) => {
      const request = httpRequest(`${api.base}`, { path }, response => { response.resume(); response.on('end', () => resolveStatus(response.statusCode)); });
      request.on('error', reject);
      request.end();
    });
    assert.ok([400, 404].includes(status), path);
  }
});

test('password changes verify the current password, rotate sessions, and store no plaintext', async t => {
  const api = await fixture(t);
  const first = await api.login();
  const second = await api.login();
  assert.equal((await api.request('/api/password', { ...first, method: 'POST', body: { currentPassword: 'wrong', newPassword: 'Replacement-secret-99!' } })).status, 401);
  assert.equal((await api.request('/api/password', { ...first, method: 'POST', body: { currentPassword: credentials.password, newPassword: 'short' } })).status, 400);
  const result = await api.request('/api/password', { ...first, method: 'POST', body: { currentPassword: credentials.password, newPassword: 'Replacement-secret-99!' } });
  assert.equal(result.status, 200);
  assert.equal((await api.request('/api/admin/content', first)).status, 401);
  assert.equal((await api.request('/api/admin/content', second)).status, 401);
  assert.equal((await api.login()).status, 401);
  assert.equal((await api.login('Replacement-secret-99!')).status, 200);
  const account = await readFile(join(api.dataDir, 'account.json'), 'utf8');
  assert.ok(!account.includes('Replacement-secret-99!'));
  assert.match(JSON.parse(account).hash, /^[a-f0-9]{128}$/);
});

test('login rate limits repeated failures and HTTPS origins set Secure cookies', async t => {
  const api = await fixture(t);
  for (let index = 0; index < 8; index++) assert.equal((await api.login('invalid')).status, 401);
  const blocked = await api.login();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  const secure = await fixture(t, { origin: 'https://portfolio.example' });
  const login = await secure.login();
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /; Secure/);
});

test('sessions expire after inactivity and have an absolute lifetime even when active', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const api = await fixture(t);
  const idle = await api.login();
  t.mock.timers.tick(31 * 60 * 1000);
  assert.equal((await api.request('/api/admin/content', idle)).status, 401);
  const active = await api.login();
  for (let index = 0; index < 24; index++) {
    t.mock.timers.tick(29 * 60 * 1000);
    assert.equal((await api.request('/api/session', active)).value.authenticated, true);
  }
  t.mock.timers.tick(29 * 60 * 1000);
  assert.equal((await api.request('/api/admin/content', active)).status, 401);
});

test('request and decoded image limits reject oversized content before persistence', async t => {
  const api = await fixture(t);
  const auth = await api.login();
  assert.equal((await api.request('/api/login', { method: 'POST', body: { email: 'a'.repeat(5000), password: 'test' } })).status, 413);
  assert.equal((await api.request('/api/admin/content', { ...auth, method: 'PUT', body: { document: 'a'.repeat(2 * 1024 * 1024) } })).status, 413);
  assert.equal((await api.request('/api/admin/media', { ...auth, method: 'POST', body: { name: 'Too large', data: 'A'.repeat(12 * 1024 * 1024) } })).status, 413);
  const tooWide = await sharp({ create: { width: 8193, height: 1, channels: 3, background: '#123456' } }).png().toBuffer();
  assert.equal((await api.request('/api/admin/media', { ...auth, method: 'POST', body: { name: 'Too wide', data: tooWide.toString('base64') } })).status, 400);
  assert.equal((await api.request('/api/admin/media', auth)).value.items.filter(item => item.uploaded).length, 0);
});
