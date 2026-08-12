#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function detectGMGN(url, doc) {
  try {
    const urlObj = new URL(url);
    const pathMatch = urlObj.pathname.match(/\/[a-zA-Z0-9_-]+\/token\/(0x[0-9a-fA-F]{40}|[A-Za-z0-9]{32,64})/);
    if (pathMatch) return pathMatch[1].toLowerCase();
    const selectors = ['[data-token-address]', "meta[name='token-address']", '.token-address', '.address'];
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) {
        const text = (el.getAttribute && el.getAttribute('content')) || el.textContent || '';
        const m = text.match(/(0x[0-9a-fA-F]{40}|[A-Za-z0-9]{32,64})/);
        if (m) return m[1].toLowerCase();
      }
    }
  } catch (e) {}
  return null;
}

async function detectAxiom(url, doc) {
  try {
    const urlObj = new URL(url);
    const pathMatch = urlObj.pathname.match(/\/token\/(0x[0-9a-fA-F]{40}|[A-Za-z0-9]{32,64})/);
    if (pathMatch) return pathMatch[1].toLowerCase();
    const selectors = ['[data-address]', '.token-id', "meta[name='token-address']"];
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) {
        const text = (el.getAttribute && el.getAttribute('content')) || el.textContent || '';
        const m = text.match(/(0x[0-9a-fA-F]{40}|[A-Za-z0-9]{32,64})/);
        if (m) return m[1].toLowerCase();
      }
    }
  } catch (e) {}
  return null;
}

async function detectPadre(url, doc) {
  try {
    const urlObj = new URL(url);
    const pathMatch = urlObj.pathname.match(/\/tokens?\/(0x[0-9a-fA-F]{40}|[A-Za-z0-9]{32,64})/);
    if (pathMatch) return pathMatch[1].toLowerCase();
    const selectors = ['.token-address', '[data-token-address]', "meta[name='address']"];
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el) {
        const text = (el.getAttribute && el.getAttribute('content')) || el.textContent || '';
        const m = text.match(/(0x[0-9a-fA-F]{40}|[A-Za-z0-9]{32,64})/);
        if (m) return m[1].toLowerCase();
      }
    }
  } catch (e) {}
  return null;
}

function findLocalChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function run(urlsPath) {
  const abs = path.resolve(urlsPath);
  if (!fs.existsSync(abs)) {
    console.error('URLs file not found:', abs);
    process.exit(1);
  }
  const urls = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const executablePath = findLocalChrome();
  if (!executablePath) {
    console.error('No local Chrome/Chromium binary found. Install Chrome or point to a binary manually.');
    process.exit(1);
  }
  const outDir = path.join(__dirname, '..', '..', 'docs', 'spike-samples');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const resultsDir = path.join(__dirname, '..', '..', 'docs');
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const results = [];
  const browser = await chromium.launch({
    executablePath,
    headless: true,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  for (const site of Object.keys(urls)) {
    const list = urls[site] || [];
    for (let i = 0; i < list.length; i++) {
      const url = list[i];
      console.log(`Testing ${site} ${i+1}/${list.length}: ${url}`);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const html = await page.content();
        const snapFile = path.join(outDir, `${site}-${i+1}.html`);
        fs.writeFileSync(snapFile, html, 'utf8');
        const detection = await page.evaluate(() => {
          // Expose window location and document for serializable return
          return { href: location.href };
        });
        // Evaluate detectors in page context using the same logic
        const detected = await page.evaluate(() => {
          function extractAddress(s) { const m = s && s.match && s.match(/(0x[0-9a-fA-F]{40}|[A-Za-z0-9]{32,64})/); return m?m[1]:null }
          function detectGMGN() {
            try {
              const u = location.href;
              const m = u.match(/\/[a-zA-Z0-9_-]+\/token\/(0x[0-9a-fA-F]{40}|[A-Za-z0-9]{32,64})/);
              if (m) return m[1].toLowerCase();
              const sels = ['[data-token-address]', "meta[name=\'token-address\']", '.token-address', '.address'];
              for (const sel of sels) {
                const el = document.querySelector(sel);
                if (el) {
                  const txt = (el.getAttribute && el.getAttribute('content')) || el.textContent || '';
                  const found = extractAddress(txt);
                  if (found) return found.toLowerCase();
                }
              }
            } catch(e){}
            return null;
          }
          function detectAxiom() {
            try {
              const u = location.href;
              const m = u.match(/\/meme\/(0x[0-9a-fA-F]{40}|[A-Za-z0-9]{32,64})/);
              if (m) return m[1].toLowerCase();
              const sels = ['[data-address]', '.token-id', "meta[name=\'token-address\']", '.token-address', '.address'];
              for (const sel of sels) {
                const el = document.querySelector(sel);
                if (el) {
                  const txt = (el.getAttribute && el.getAttribute('content')) || el.textContent || '';
                  const found = extractAddress(txt);
                  if (found) return found.toLowerCase();
                }
              }
            } catch(e){}
            return null;
          }
          function extractRedirectUrl(u) {
            try {
              const url = new URL(u);
              return url.searchParams.get('backToUrl') || url.searchParams.get('next') || url.searchParams.get('redirect');
            } catch (e) {
              const m = u.match(/[?&](?:backToUrl|next|redirect)=([^&]+)/);
              return m ? decodeURIComponent(m[1]) : null;
            }
          }
          function detectPadre() {
            try {
              const u = location.href;
              const m = u.match(/\/trade\/(?:solana|[a-zA-Z0-9_-]+)\/(0x[0-9a-fA-F]{40}|[A-Za-z0-9]{32,64})/);
              if (m) return m[1].toLowerCase();
              const redirect = extractRedirectUrl(u);
              if (redirect) {
                const rm = redirect.match(/\/trade\/(?:solana|[a-zA-Z0-9_-]+)\/(0x[0-9a-fA-F]{40}|[A-Za-z0-9]{32,64})/);
                if (rm) return rm[1].toLowerCase();
              }
              const sels = ['.token-address', '[data-token-address]', "meta[name=\'address\']", '.trade-token', '.token-id'];
              for (const sel of sels) {
                const el = document.querySelector(sel);
                if (el) {
                  const txt = (el.getAttribute && el.getAttribute('content')) || el.textContent || '';
                  const found = extractAddress(txt);
                  if (found) return found.toLowerCase();
                }
              }
            } catch(e){}
            return null;
          }
          return { gmgn: detectGMGN(), axiom: detectAxiom(), padre: detectPadre() };
        });
        // Determine which detector matched (prefer site-specific)
        let matched = null;
        if (detected.gmgn) matched = { detector: 'gmgn', address: detected.gmgn };
        else if (detected.axiom) matched = { detector: 'axiom', address: detected.axiom };
        else if (detected.padre) matched = { detector: 'padre', address: detected.padre };
        results.push({ site, url, matched, snapshot: snapFile });
      } catch (err) {
        console.error('Error testing', url, err.message);
        results.push({ site, url, error: err.message });
      }
    }
  }

  await browser.close();
  const outPath = path.join(resultsDir, 'spike-results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log('Done — results written to', outPath);
}

const urlsPath = process.argv[2] || path.join(__dirname, 'urls.json');
run(urlsPath).catch(err => { console.error(err); process.exit(1); });
