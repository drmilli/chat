/**
 * Builds and zips the extension for the Chrome Web Store.
 *
 * WHY THIS SCRIPT EXISTS. The store rejects a package containing more than one
 * manifest.json, and this repo has two: the source at public/manifest.json and
 * the built one at dist/manifest.json. Zipping the extension FOLDER catches
 * both and is rejected with "More than one manifest found in package". The
 * upload must contain the CONTENTS of dist/ with manifest.json at the zip root
 * — not the folder itself, and not the project directory.
 *
 * Verifies the result before handing it over, so a bad package is caught here
 * rather than by the store.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const dist = resolve(root, 'dist');

const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
const zipName = `chorus-extension-v${manifest.version}.zip`;
const zipPath = resolve(root, zipName);

if (existsSync(zipPath)) rmSync(zipPath);

// `cd dist && zip -r ../out.zip .` packs the CONTENTS, which is what the store
// wants. Zipping `dist` from the parent would nest everything one level deep.
execFileSync('zip', ['-rq', zipPath, '.', '-x', '.*', '-x', '__MACOSX/*'], { cwd: dist });

const listing = execFileSync('unzip', ['-l', zipPath], { encoding: 'utf8' });
const entries = listing
  .split('\n')
  .slice(3, -3)
  .map((line) => line.trim().split(/\s+/).slice(3).join(' '))
  .filter(Boolean);

const problems = [];
const manifests = entries.filter((e) => e.endsWith('manifest.json'));
if (manifests.length !== 1) problems.push(`expected exactly 1 manifest.json, found ${manifests.length}`);
if (manifests[0] !== 'manifest.json') problems.push(`manifest.json must be at the zip root, found at "${manifests[0]}"`);
if (entries.some((e) => e.startsWith('dist/') || e.startsWith('public/'))) {
  problems.push('the zip contains a source folder — pack the contents of dist/, not the extension directory');
}
if (manifest.description.length > 132) {
  problems.push(`description is ${manifest.description.length} chars; the store limit is 132`);
}
if (JSON.stringify(manifest).includes('localhost')) problems.push('manifest still contains a localhost host');

if (problems.length) {
  console.error('\nPackage is NOT valid for upload:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`\n${zipName} — ${entries.length} files, ready to upload`);
console.log(`  ${manifest.name} v${manifest.version}`);
console.log(`  ${zipPath}`);
