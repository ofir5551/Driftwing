import { defineConfig, type Plugin } from 'vitest/config';

/** Files in public/ the service worker precaches with the build (Vite copies them as they are).
 *  Keep in step with public/: a listed file that is missing fails the worker's install. */
const PUBLIC_FILES = [
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

/** Builds src/sw.ts to dist/sw.js, filled in with this build's file list and a version that
 *  changes whenever any file does. Hashed file names change with their content, and index.html
 *  is hashed by its text, so a new deploy always gets a new cache. */
function serviceWorker(): Plugin {
  return {
    name: 'driftwing-service-worker',
    apply: 'build',
    config: () => ({
      build: {
        rollupOptions: {
          input: { index: 'index.html', sw: 'src/sw.ts' },
          output: {
            // The worker must keep a fixed name at the root: its URL is how browsers find updates.
            entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js'),
          },
        },
      },
    }),
    // `post`: Vite's own HTML plugin emits index.html during generateBundle too.
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const worker = bundle['sw.js'];
        if (!worker || worker.type !== 'chunk') throw new Error('service worker chunk missing');
        let fingerprint = '';
        for (const f of Object.values(bundle)) {
          if (f.fileName === 'sw.js') continue;
          fingerprint += f.fileName;
          if (f.fileName === 'index.html' && f.type === 'asset') fingerprint += String(f.source);
        }
        const files = Object.keys(bundle)
          .filter((n) => n !== 'sw.js' && !n.endsWith('.map'))
          .concat(PUBLIC_FILES)
          .sort();
        worker.code = worker.code
          .replace('__DW_VERSION__', hash(fingerprint + files.join(',')))
          .replace('__DW_FILES__', files.join(','));
      },
    },
  };
}

/** FNV-1a, 32 bit, as hex: enough to tell builds apart. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Relative base so the build works on GitHub Pages under /<repo>/ and from any static host.
export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
  test: { include: ['tests/**/*.test.ts'] },
});
