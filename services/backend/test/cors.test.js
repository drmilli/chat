const test = require('node:test');
const assert = require('node:assert');

const OLD = 'https://token-chat.vercel.app';
const NEW = 'https://chorustrade.online';

/** Boots a fresh app with the given CORS_ORIGIN, bypassing the module cache. */
function bootApp(corsOrigin) {
  const saved = process.env.CORS_ORIGIN;
  if (corsOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = corsOrigin;

  for (const key of Object.keys(require.cache)) {
    if (key.includes('/services/backend/src/')) delete require.cache[key];
  }
  const app = require('../src/app');
  if (saved === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = saved;
  return app;
}

/** Runs one request through the middleware stack without opening a socket. */
function preflight(app, origin) {
  return new Promise((resolve) => {
    const headers = {};
    const req = {
      method: 'OPTIONS',
      url: '/api/health',
      headers: origin ? { origin } : {},
      on() {},
    };
    const res = {
      header(name, value) { headers[name] = value; return this; },
      setHeader(name, value) { headers[name] = value; return this; },
      getHeader(name) { return headers[name]; },
      sendStatus() { resolve(headers); return this; },
      status() { return this; },
      json() { resolve(headers); return this; },
      end() { resolve(headers); return this; },
    };
    app(req, res, () => resolve(headers));
  });
}

test('both origins are allowed during a domain migration', async () => {
  // The reason this is a list at all: Access-Control-Allow-Origin names exactly
  // one origin, so a cutover needs old and new permitted at the same time.
  const app = bootApp(`${OLD},${NEW}`);

  const fromOld = await preflight(app, OLD);
  assert.equal(fromOld['Access-Control-Allow-Origin'], OLD);

  const fromNew = await preflight(app, NEW);
  assert.equal(fromNew['Access-Control-Allow-Origin'], NEW, 'the new domain must work before cutover');
});

test('the allow header echoes the caller, never the whole list', async () => {
  // Sending "a,b" is invalid and every browser rejects it.
  const app = bootApp(`${OLD},${NEW}`);
  const headers = await preflight(app, NEW);
  assert.ok(!headers['Access-Control-Allow-Origin'].includes(','));
});

test('Vary: Origin is set so a cache cannot cross the wires', async () => {
  // Without it a CDN can serve one origin's allow header to another origin.
  const app = bootApp(`${OLD},${NEW}`);
  const headers = await preflight(app, NEW);
  assert.equal(headers.Vary, 'Origin');
});

test('an unlisted origin is not granted access', async () => {
  const app = bootApp(NEW);
  const headers = await preflight(app, 'https://evil.example');
  assert.notEqual(headers['Access-Control-Allow-Origin'], 'https://evil.example');
});

test('whitespace around entries is tolerated', async () => {
  // Env vars get pasted with spaces; that must not silently drop an origin.
  const app = bootApp(` ${OLD} , ${NEW} `);
  const headers = await preflight(app, NEW);
  assert.equal(headers['Access-Control-Allow-Origin'], NEW);
});

test('unset stays permissive for local development', async () => {
  const app = bootApp(undefined);
  const headers = await preflight(app, 'http://localhost:4173');
  assert.equal(headers['Access-Control-Allow-Origin'], '*');
});
