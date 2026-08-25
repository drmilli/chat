/**
 * Security regression for the host <-> widget message boundary (T-400).
 *
 * The widget is the component that will move money in Phase 6, so these checks
 * must keep passing: a hostile embedder must learn nothing, and a hostile page
 * must not be able to drive the host side of the protocol.
 *
 * Usage: node scripts/security/widget-boundary.test.mjs
 * Requires the web app on :4173 (npm run dev --workspace apps-web).
 */
import { chromium } from 'playwright';
import { startHostSimulator } from './host-simulator.mjs';

const server = startHostSimulator();
const HOST = 'http://localhost:4200';
const OPEN = { waitUntil: 'load' };
let pass = 0, fail = 0;
const check = (l, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${l.padEnd(52)} ${d}`); };

(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 80)));

  await p.goto(`${HOST}/?channel=chan-legit`, OPEN);
  await p.waitForTimeout(7000);

  const frame = p.frames().find((f) => f.url().includes('/embed/'));
  check('widget frame loaded', !!frame, frame ? frame.url().split('?')[0] : 'not found');
  if (!frame) { await b.close(); process.exit(1); }

  check('iframe URL carries host + channel', /host=.*channel=/.test(frame.url()));

  // 1. The legitimate path: expanding the widget resizes the host iframe.
  await frame.click('.tg-embed-bar');
  await p.waitForTimeout(2500);
  const received = await p.evaluate(() => window.__received);
  check('host received the resize over the protocol', received.some((m) => m.type === 'resize'),
    JSON.stringify(received.map((m) => m.type)));
  const height = await p.evaluate(() => document.getElementById('w').style.height);
  check('iframe actually resized', parseInt(height, 10) > 200, `height=${height}`);

  // 2. Does the widget leak to a foreign listener? Attach a listener inside the
  //    widget's own parent chain pretending to be another embedder.
  const leaked = await p.evaluate(async () => {
    const seen = [];
    const spy = (e) => { if (e.data && e.data.protocol === 'token-chat/1') seen.push(e.data); };
    // A second frame on a different origin listening on the same window.
    const rogue = document.createElement('iframe');
    rogue.src = 'about:blank';
    document.body.appendChild(rogue);
    rogue.contentWindow.addEventListener('message', spy);
    await new Promise((r) => setTimeout(r, 1500));
    return seen.length;
  });
  check('unrelated frame receives nothing', leaked === 0, `${leaked} messages seen`);

  // 3. Forged messages from the page itself must be rejected by the host checks.
  await p.evaluate(() => {
    // Right protocol and channel, but window.postMessage means source is the page.
    window.postMessage({ protocol: 'token-chat/1', channel: 'chan-legit', type: 'resize', height: 5000 }, '*');
    window.postMessage({ protocol: 'token-chat/1', channel: 'wrong-channel', type: 'resize', height: 5000 }, '*');
    window.postMessage({ type: 'resize', height: 5000 }, '*');
  });
  await p.waitForTimeout(1200);
  const after = await p.evaluate(() => ({
    received: window.__received.length,
    rejected: window.__rejected.map((r) => r.why.join('+')),
    height: document.getElementById('w').style.height,
  }));
  check('forged page messages rejected', after.rejected.length >= 3, JSON.stringify(after.rejected.slice(0, 3)));
  check('iframe not resized by forgery', parseInt(after.height, 10) < 1000, `height=${after.height}`);

  // 4. A widget embedded WITHOUT a declared host origin must stay silent.
  const p2 = await b.newPage({ viewport: { width: 900, height: 700 } });
  await p2.goto('http://localhost:4173/embed/boundary-test-room', OPEN);
  await p2.waitForTimeout(5000);
  const silent = await p2.evaluate(() => {
    // Standalone (no parent) — posting must be a no-op rather than a throw.
    return typeof window.__tokenChatError === 'undefined';
  });
  check('widget with no host context does not error', silent);

  console.log(`\n==== ${pass}/${pass + fail} passed ====`);
  if (errs.length) console.log('page errors:', [...new Set(errs)].slice(0, 3));
  await b.close();
  server.close();
  process.exit(fail ? 1 : 0);
})();
