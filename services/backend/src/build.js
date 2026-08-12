const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const distDir = path.join(__dirname, '..', 'dist');

// Build-time only — never shipped to dist/.
const EXCLUDED_FILES = new Set(['build.js', 'migrate.js']);
// Migrations are read from src/ by the migrate script, not from the bundle.
const EXCLUDED_DIRS = new Set(['migrations']);

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let count = 0;

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      count += copyTree(path.join(from, entry.name), path.join(to, entry.name));
      continue;
    }
    if (!entry.name.endsWith('.js') || EXCLUDED_FILES.has(entry.name)) continue;
    fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
    count += 1;
  }

  return count;
}

// Copy the whole source tree so a new route/middleware file can never be
// forgotten the way a hardcoded file list allows.
fs.rmSync(distDir, { recursive: true, force: true });
const copied = copyTree(srcDir, distDir);
console.log(`Build complete: copied ${copied} source files to dist/`);
