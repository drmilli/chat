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

const before = manifest.host_permissions.length;
if (!keepDevHosts) {
  manifest.host_permissions = manifest.host_permissions.filter((host) => !host.includes('localhost'));
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const removed = before - manifest.host_permissions.length;
console.log(
  keepDevHosts
    ? 'manifest: kept localhost hosts (EXTENSION_DEV_HOSTS=true)'
    : `manifest: stripped ${removed} localhost host permission(s) for release`
);
