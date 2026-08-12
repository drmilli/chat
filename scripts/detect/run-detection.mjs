#!/usr/bin/env node
// Live detection check: loads each URL in Chrome and runs the REAL detector
// modules against it (previously this script carried its own copy of the
// detection logic, which drifted from the extension and reported false passes).
//
//   node scripts/detect/run-detection.mjs scripts/detect/urls.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { detectGMGN } from '../../apps/extension/detectors/gmgn.ts';
import { detectAxiom } from '../../apps/extension/detectors/axiom.ts';
import { detectPadre } from '../../apps/extension/detectors/padre.ts';
import { stubDocument, EXTRACT_SIGNALS } from './stub-dom.mjs';

const DETECTORS = { gmgn: detectGMGN, axiom: detectAxiom, padre: detectPadre };
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
// SPA shells need a moment before the DOM fallback has anything to find.
const RENDER_WAIT_MS = 4000;

function findLocalChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
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
    console.error('No local Chrome/Chromium binary found.');
    process.exit(1);
  }

  const outDir = path.join(repoRoot, 'docs', 'spike-samples');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  const results = [];

  for (const site of Object.keys(urls)) {
    const list = urls[site] || [];
    for (let i = 0; i < list.length; i += 1) {
      const url = list[i];
      process.stdout.write(`[${site}] ${url}\n`);

      const result = { site, url, urlOnly: null, withDom: null, finalUrl: null, error: null };
      try {
        // URL-only detection is what the extension gets on first paint.
        result.urlOnly = DETECTORS[site](url, undefined);

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(RENDER_WAIT_MS);
        result.finalUrl = page.url();

        fs.writeFileSync(path.join(outDir, `${site}-${i + 1}.html`), await page.content(), 'utf8');

        const signals = await page.evaluate(EXTRACT_SIGNALS);
        result.withDom = DETECTORS[site](signals.href, stubDocument(signals));
      } catch (err) {
        result.error = err?.message || String(err);
      }

      const status = result.withDom || result.urlOnly ? 'DETECTED' : 'MISS';
      console.log(`  ${status}  url-only=${result.urlOnly} after-render=${result.withDom}${result.error ? ` (${result.error.split('\n')[0]})` : ''}`);
      results.push(result);
    }
  }

  fs.writeFileSync(path.join(repoRoot, 'docs', 'spike-results.json'), JSON.stringify(results, null, 2));
  await browser.close();

  const detected = results.filter((r) => r.withDom || r.urlOnly).length;
  console.log(`\n${detected}/${results.length} pages detected`);
  process.exit(detected === results.length ? 0 : 1);
}

run(process.argv[2] || path.join(here, 'urls.json'));
