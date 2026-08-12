// Regenerates every logo asset from the single source of truth: /logo.svg.
// Run after changing the logo:  npm run logo:build
//
// Chrome cannot use an SVG for extension icons, so the PNGs are rasterised with
// headless Chrome (already a dependency via playwright) rather than adding an
// image toolchain.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'logo.svg');
const EXTENSION_PUBLIC = path.join(ROOT, 'apps', 'extension', 'public');
const WEB_PUBLIC = path.join(ROOT, 'apps', 'web', 'public');

const TARGETS = [
  { size: 16, file: path.join(EXTENSION_PUBLIC, 'icons', 'icon-16.png') },
  { size: 32, file: path.join(EXTENSION_PUBLIC, 'icons', 'icon-32.png') },
  { size: 48, file: path.join(EXTENSION_PUBLIC, 'icons', 'icon-48.png') },
  { size: 128, file: path.join(EXTENSION_PUBLIC, 'icons', 'icon-128.png') },
  { size: 180, file: path.join(WEB_PUBLIC, 'apple-touch-icon.png') },
  { size: 512, file: path.join(WEB_PUBLIC, 'logo-512.png') },
];

async function main() {
  if (!fs.existsSync(SOURCE)) {
    console.error(`Missing ${SOURCE}`);
    process.exit(1);
  }
  const svg = fs.readFileSync(SOURCE, 'utf8');

  // The SVG itself is used directly by the web app and the popup.
  for (const dir of [EXTENSION_PUBLIC, WEB_PUBLIC]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(SOURCE, path.join(dir, 'logo.svg'));
  }

  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const { size, file } of TARGETS) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(
        `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
      );
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, await page.screenshot({ omitBackground: true }));
      await page.close();
      console.log(`${size}px → ${path.relative(ROOT, file)}`);
    }
  } finally {
    await browser.close();
  }
  console.log('Logo assets rebuilt from logo.svg');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
