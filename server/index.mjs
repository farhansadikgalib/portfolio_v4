import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import sharp from 'sharp';
import { accountVersion, atomicJSON, constantEqual, initializeAdminAccount, readAccount, verifyPassword } from './auth.mjs';
import { validateDocument } from './schema.mjs';

export { initializeAdminAccount } from './auth.mjs';

const COOKIE = 'portfolio_admin';
const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const MAX_UPLOAD = 8 * 1024 * 1024;
const PUBLIC_FILES = new Set(['index.html', 'styles.css', 'app.js', 'motion.js', 'cms.js', 'farhan_resume.pdf', 'data/projects.js', 'data/default-content.json']);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf' };
const mediaName = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 140) : '';
const tokenHash = value => createHash('sha256').update(value).digest('hex');
const httpError = (status, message) => Object.assign(new Error(message), { status });

async function readJSON(filename, fallback) {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function bodyJSON(req, limit = 2 * 1024 * 1024) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw httpError(415, 'Send application/json.');
  if (Number(req.headers['content-length']) > limit) throw httpError(413, 'The request is too large.');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw httpError(413, 'The request is too large.');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw httpError(400, 'The request contains invalid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Send a JSON object.');
  return body;
}

function references(document, src, label) {
  const matches = [];
  const walk = (value, path) => {
    if (typeof value === 'string' && value.replace(/^\//, '') === src.replace(/^\//, '')) matches.push(`${label}: ${path}`);
    else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${path}[${index}]`));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => walk(item, path ? `${path}.${key}` : key));
  };
  walk(document, '');
  return matches;
}

async function bundledMedia(rootDir) {
  const results = [];
  async function walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const filename = join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else if (entry.isFile() && /\.(webp|jpe?g|png)$/i.test(entry.name)) {
        const src = relative(rootDir, filename).split(sep).join('/');
        const metadata = await sharp(filename, { limitInputPixels: 24_000_000 }).metadata().catch(() => ({}));
        results.push({ id: `asset:${src}`, src, name: entry.name, mime: MIME[extname(filename)] || 'image/webp', width: metadata.width || 0, height: metadata.height || 0, size: (await stat(filename)).size, uploaded: false });
      }
    }
  }
  await walk(join(rootDir, 'assets'));
  return results;
}

export async function createPortfolioServer({ rootDir = process.cwd(), dataDir = process.env.CMS_DATA_DIR || join(process.cwd(), '.cms-data'), origin = process.env.SITE_ORIGIN } = {}) {
  rootDir = await realpath(resolve(rootDir));
  dataDir = resolve(dataDir);
  await mkdir(join(dataDir, 'uploads'), { recursive: true, mode: 0o700 });
  const trustedOrigin = origin ? new URL(origin).origin : null;
  if (origin && (!/^https?:\/\//.test(origin) || trustedOrigin !== origin.replace(/\/$/, ''))) throw new Error('SITE_ORIGIN must be an HTTP(S) origin without a path.');
  if (process.env.NODE_ENV === 'production' && !trustedOrigin?.startsWith('https://')) throw new Error('Production requires an HTTPS SITE_ORIGIN.');
  const secureCookies = Boolean(trustedOrigin?.startsWith('https://')) || process.env.NODE_ENV === 'production';
  const contentFile = join(dataDir, 'content.json');
  const mediaFile = join(dataDir, 'media.json');
  let snapshot = await readJSON(contentFile, null);
  if (!snapshot) {
    const seed = validateDocument(JSON.parse(await readFile(join(rootDir, 'data/default-content.json'), 'utf8')));
    const now = new Date().toISOString();
    snapshot = { draft: seed, published: seed, revision: 1, publishedAt: now, updatedAt: now };
    await atomicJSON(contentFile, snapshot);
  } else {
    snapshot.draft = validateDocument(snapshot.draft);
    snapshot.published = validateDocument(snapshot.published);
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) throw new Error('Saved content revision is invalid.');
  }
  let uploaded = await readJSON(mediaFile, []);
  if (!Array.isArray(uploaded)) throw new Error('Saved media index is invalid.');
  const bundled = await bundledMedia(rootDir);
  const sessions = new Map();
  const attempts = new Map();
  let queue = Promise.resolve();
  const serialize = task => {
    const pending = queue.then(task);
    queue = pending.catch(() => {});
    return pending;
  };

  function json(res, status, value) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  }

  function sessionCookie(res, token, clear = false) {
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : ABSOLUTE_MS / 1000}${secureCookies ? '; Secure' : ''}`);
  }

  function newSession(res, account) {
    const token = randomBytes(32).toString('base64url');
    const session = { email: account.email, accountVersion: accountVersion(account), csrfToken: randomBytes(32).toString('base64url'), createdAt: Date.now(), lastSeen: Date.now() };
    sessions.set(tokenHash(token), session);
    sessionCookie(res, token);
    return session;
  }

  function sessionResponse(account, session) {
    return { configured: Boolean(account), authenticated: Boolean(session), ...(session ? { email: session.email, csrfToken: session.csrfToken } : {}) };
  }

  function sameOrigin(req) {
    if (req.headers['sec-fetch-site'] === 'cross-site') throw httpError(403, 'Requests must come from this website.');
    let requestOrigin;
    try { requestOrigin = new URL(`http://${req.headers.host}`).origin; }
    catch { throw httpError(400, 'Invalid request host.'); }
    if (!trustedOrigin && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(requestOrigin).hostname)) throw httpError(403, 'Set SITE_ORIGIN before accessing the console from another host.');
    if (req.headers.origin && req.headers.origin !== (trustedOrigin || requestOrigin)) throw httpError(403, 'Requests must come from this website.');
  }

  async function currentSession(req) {
    const account = await readAccount(dataDir);
    const token = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    const key = token ? tokenHash(token) : null;
    const session = key ? sessions.get(key) : null;
    if (session && (Date.now() - session.createdAt >= ABSOLUTE_MS || Date.now() - session.lastSeen >= IDLE_MS || session.accountVersion !== accountVersion(account))) {
      sessions.delete(key);
      return { account, session: null, key };
    }
    if (session) session.lastSeen = Date.now();
    return { account, session: session || null, key };
  }

  function checkRevision(revision) {
    if (!Number.isSafeInteger(revision)) throw httpError(400, 'A content revision is required.');
    if (revision !== snapshot.revision) throw httpError(409, 'The content changed in another session. Reload the latest version before saving.');
  }

  function validateMediaReferences(document) {
    const available = new Set([...bundled, ...uploaded].map(item => item.src.replace(/^\//, '')));
    const sources = [
      ...document.fields.filter(field => field.type === 'image').map(field => field.value),
      ...document.sections.filter(section => section.kind !== 'builtin').map(section => section.image),
      ...document.projects.flatMap(project => [project.icon, ...project.screenshots]),
    ].filter(Boolean);
    if (sources.some(src => !available.has(src.replace(/^\//, '')))) throw httpError(400, 'One or more images are missing from the media library. Choose an existing image or upload it first.');
  }

  async function saveSnapshot(next) {
    await atomicJSON(contentFile, next);
    snapshot = next;
    return snapshot;
  }

  function mediaItem(item) {
    return { ...item, usedBy: [...references(snapshot.draft, item.src, 'Draft'), ...references(snapshot.published, item.src, 'Published')] };
  }

  async function api(req, res, pathname) {
    const method = req.method;
    if (method === 'GET' && pathname === '/api/content') return json(res, 200, snapshot.published);
    const context = await currentSession(req);
    if (method === 'GET' && pathname === '/api/session') return json(res, 200, sessionResponse(context.account, context.session));
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) sameOrigin(req);

    if (method === 'POST' && pathname === '/api/login') {
      const key = req.socket.remoteAddress || 'unknown';
      const record = attempts.get(key);
      if (record && record.expires > Date.now() && record.count >= 8) {
        res.setHeader('Retry-After', Math.ceil((record.expires - Date.now()) / 1000));
        throw httpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
      }
      const body = await bodyJSON(req, 4096);
      const attempt = record?.expires > Date.now() ? record : { count: 0, expires: Date.now() + 15 * 60 * 1000 };
      attempt.count++;
      attempts.set(key, attempt);
      const valid = await verifyPassword(context.account, body.password);
      if (!valid || typeof body.email !== 'string' || !constantEqual(body.email.trim().toLowerCase(), context.account?.email || '')) throw httpError(401, 'Email or password is incorrect.');
      attempts.delete(key);
      if (context.key) sessions.delete(context.key);
      return json(res, 200, sessionResponse(context.account, newSession(res, context.account)));
    }

    if (!context.session) throw httpError(401, 'Sign in to use the console.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !constantEqual(req.headers['x-csrf-token'], context.session.csrfToken)) throw httpError(403, 'Your session could not be verified. Reload the console and try again.');

    if (method === 'POST' && pathname === '/api/logout') {
      await bodyJSON(req, 4096);
      sessions.delete(context.key);
      sessionCookie(res, '', true);
      return json(res, 200, { configured: Boolean(context.account), authenticated: false });
    }
    if (method === 'POST' && pathname === '/api/password') {
      const body = await bodyJSON(req, 4096);
      return serialize(async () => {
        const account = await readAccount(dataDir);
        if (!await verifyPassword(account, body.currentPassword)) throw httpError(401, 'The current password is incorrect.');
        try { await initializeAdminAccount({ dataDir, email: account.email, password: body.newPassword, reset: true }); }
        catch (error) { throw httpError(400, error.message); }
        sessions.clear();
        const updated = await readAccount(dataDir);
        return json(res, 200, sessionResponse(updated, newSession(res, updated)));
      });
    }
    if (method === 'GET' && pathname === '/api/admin/content') return json(res, 200, snapshot);
    if (method === 'PUT' && pathname === '/api/admin/content') {
      const body = await bodyJSON(req);
      return serialize(async () => {
        checkRevision(body.revision);
        const document = validateDocument(body.document);
        validateMediaReferences(document);
        return json(res, 200, await saveSnapshot({ ...snapshot, draft: document, revision: snapshot.revision + 1, updatedAt: new Date().toISOString() }));
      });
    }
    if (method === 'POST' && ['/api/admin/publish', '/api/admin/discard'].includes(pathname)) {
      const body = await bodyJSON(req, 4096);
      return serialize(async () => {
        checkRevision(body.revision);
        if (pathname.endsWith('/publish')) validateMediaReferences(snapshot.draft);
        const now = new Date().toISOString();
        const next = pathname.endsWith('/publish')
          ? { ...snapshot, published: snapshot.draft, revision: snapshot.revision + 1, publishedAt: now, updatedAt: now }
          : { ...snapshot, draft: snapshot.published, revision: snapshot.revision + 1, updatedAt: now };
        return json(res, 200, await saveSnapshot(next));
      });
    }
    if (method === 'GET' && pathname === '/api/admin/media') return json(res, 200, { items: [...uploaded, ...bundled].map(mediaItem) });
    if (method === 'POST' && pathname === '/api/admin/media') {
      const body = await bodyJSON(req, Math.ceil(MAX_UPLOAD * 4 / 3) + 8192);
      const name = mediaName(body.name);
      if (!name) throw httpError(400, 'Give the image a name.');
      if (typeof body.data !== 'string' || body.data.length > Math.ceil(MAX_UPLOAD / 3) * 4 || body.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) throw httpError(400, 'Upload a valid PNG, JPEG, or WebP image.');
      const buffer = Buffer.from(body.data, 'base64');
      if (!buffer.length || buffer.length > MAX_UPLOAD || buffer.toString('base64') !== body.data) throw httpError(400, 'Images must be no larger than 8 MB.');
      const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg = buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
      const webp = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
      if (!png && !jpeg && !webp) throw httpError(400, 'Upload a PNG, JPEG, or WebP image.');
      let normalized;
      try {
        const metadata = await sharp(buffer, { limitInputPixels: 24_000_000, failOn: 'warning' }).metadata();
        if (!['png', 'jpeg', 'webp'].includes(metadata.format) || metadata.pages > 1 || metadata.width > 8192 || metadata.height > 8192) throw new Error('Unsupported image');
        normalized = await sharp(buffer, { limitInputPixels: 24_000_000, failOn: 'warning' }).rotate().webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
      } catch { throw httpError(400, 'Use a static PNG, JPEG, or WebP image up to 8 MB and 24 megapixels (maximum 8192 px per side).'); }
      return serialize(async () => {
        const id = randomUUID();
        const filename = join(dataDir, 'uploads', `${id}.webp`);
        const item = { id, src: `uploads/${id}.webp`, name, mime: 'image/webp', width: normalized.info.width, height: normalized.info.height, size: normalized.data.length, uploaded: true };
        await writeFile(filename, normalized.data, { mode: 0o600, flag: 'wx' });
        try { await atomicJSON(mediaFile, [item, ...uploaded]); }
        catch (error) { await unlink(filename).catch(() => {}); throw error; }
        uploaded = [item, ...uploaded];
        return json(res, 201, { item: mediaItem(item) });
      });
    }
    const mediaMatch = pathname.match(/^\/api\/admin\/media\/(.+)$/);
    if (mediaMatch && ['PUT', 'DELETE'].includes(method)) {
      const body = await bodyJSON(req, 4096);
      return serialize(async () => {
        const item = uploaded.find(value => value.id === mediaMatch[1]);
        if (!item) throw httpError(404, 'Uploaded image not found. Bundled project assets cannot be removed.');
        let next;
        if (method === 'DELETE') {
          if (mediaItem(item).usedBy.length) throw httpError(409, 'This image is still used in draft or published content. Replace or remove those references, then publish before deleting it.');
          next = uploaded.filter(value => value.id !== item.id);
        } else {
          const name = mediaName(body.name);
          if (!name) throw httpError(400, 'Give the image a name.');
          next = uploaded.map(value => value.id === item.id ? { ...value, name } : value);
        }
        await atomicJSON(mediaFile, next);
        uploaded = next;
        if (method === 'DELETE') await unlink(join(dataDir, 'uploads', `${item.id}.webp`)).catch(error => { if (error.code !== 'ENOENT') console.error('Unable to clean up an unreferenced media file.'); });
        return json(res, 200, method === 'DELETE' ? { deleted: true } : { item: mediaItem(uploaded.find(value => value.id === item.id)) });
      });
    }
    throw httpError(404, 'API endpoint not found.');
  }

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
    if (secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
      if (!pathname.startsWith('/') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').includes('..') || pathname.split('/').includes('.')) throw httpError(404, 'Not found.');
      if (pathname.startsWith('/api/')) return await api(req, res, pathname);
      if (!['GET', 'HEAD'].includes(req.method)) throw httpError(405, 'Method not allowed.');
      const name = pathname === '/' ? 'index.html' : ['/admin', '/admin/'].includes(pathname) ? 'admin/index.html' : pathname.slice(1);
      let filename;
      if (/^uploads\/[a-f0-9-]{36}\.webp$/.test(name) && uploaded.some(item => item.src === name)) filename = join(dataDir, name);
      else {
        if (!PUBLIC_FILES.has(name) && !/^assets\/[\w./-]+$/.test(name) && !/^admin\/(index\.html|admin\.js|admin\.css)$/.test(name)) throw httpError(404, 'Not found.');
        filename = await realpath(join(rootDir, name));
        if (!filename.startsWith(`${rootDir}${sep}`)) throw httpError(404, 'Not found.');
      }
      if (!(await stat(filename)).isFile()) throw httpError(404, 'Not found.');
      const buffer = await readFile(filename);
      res.setHeader('Content-Type', MIME[extname(filename)] || 'application/octet-stream');
      res.setHeader('Content-Length', buffer.length);
      if (!name.startsWith('admin/')) res.setHeader('Cache-Control', name.startsWith('uploads/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      res.writeHead(200);
      res.end(req.method === 'HEAD' ? undefined : buffer);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      const status = error.status || (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : error instanceof URIError ? 400 : 500);
      if (status >= 500) console.error('Portfolio request failed:', error.message);
      json(res, status, { error: status >= 500 ? 'Something went wrong. Please try again.' : error.message || 'Not found.' });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.maxHeadersCount = 60;
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions) if (now - session.createdAt >= ABSOLUTE_MS || now - session.lastSeen >= IDLE_MS) sessions.delete(key);
    for (const [key, attempt] of attempts) if (attempt.expires <= now) attempts.delete(key);
  }, 60_000).unref();
  server.on('close', () => { clearInterval(cleanup); sessions.clear(); });
  return server;
}
