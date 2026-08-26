import { defineConfig } from 'vite';
import { resolve } from 'path';

// Each extension surface is built as its own self-contained IIFE bundle.
// A single multi-entry build would hoist shared modules (config.ts) into a
// separate ESM chunk, and MV3 content scripts cannot be ES modules.
const ENTRIES = {
  'content-script': 'content-script.ts',
  background: 'background.ts',
  popup: 'popup.ts',
  'session-bridge': 'session-bridge.ts',
} as const;

type EntryName = keyof typeof ENTRIES;

export default defineConfig(({ mode }) => {
  const entry = (mode in ENTRIES ? mode : 'content-script') as EntryName;
  // The first bundle in the sequence owns cleaning dist/ and copying public/.
  const isFirst = entry === 'content-script';

  return {
    publicDir: isFirst ? 'public' : false,
    build: {
      outDir: 'dist',
      emptyOutDir: isFirst,
      lib: {
        entry: resolve(__dirname, ENTRIES[entry]),
        formats: ['iife'],
        name: `tokenChat_${entry.replace(/-/g, '_')}`,
        fileName: () => `${entry}.js`,
      },
    },
  };
});
