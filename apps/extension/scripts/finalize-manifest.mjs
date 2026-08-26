/**
 * Post-build manifest pass.
 *
 * The source manifest carries localhost hosts so a dev build can talk to a local
 * API. Shipping those to the Chrome Web Store is both a review flag and a real
 * (if small) surface, so they are stripped unless EXTENSION_DEV_HOSTS=true.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(here, '..', 'dist', 'manifest.json');

const keepDevHosts = process.env.EXTENSION_DEV_HOSTS === 'true';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const isDevHost = (host) => host.includes('localhost');

let before = manifest.host_permissions.length;
for (const script of manifest.content_scripts ?? []) before += script.matches.length;

if (!keepDevHosts) {
  manifest.host_permissions = manifest.host_permissions.filter((host) => !isDevHost(host));

  // Content-script matches need the same treatment. Stripping only
  // host_permissions left `http://localhost:4173/*` in a shipped manifest —
  // the exact thing this pass exists to prevent, and a review flag (T-507).
  manifest.content_scripts = (manifest.content_scripts ?? [])
    .map((script) => ({ ...script, matches: script.matches.filter((host) => !isDevHost(host)) }))
    // A script whose every match was a dev host has nothing left to run on.
    .filter((script) => script.matches.length > 0);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

let after = manifest.host_permissions.length;
for (const script of manifest.content_scripts ?? []) after += script.matches.length;
const removed = before - after;
console.log(
  keepDevHosts
    ? 'manifest: kept localhost hosts (EXTENSION_DEV_HOSTS=true)'
    : `manifest: stripped ${removed} localhost host/match entr(ies) for release`
);
