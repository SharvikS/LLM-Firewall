import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config.js';

// Builds the MV3 extension with React + Tailwind. crxjs wires the manifest
// entrypoints (popup/options HTML, content script, service worker) into the Vite
// graph and emits a Chrome-ready bundle in dist/. A separate postbuild step
// (scripts/make-firefox.js) derives the Firefox variant.
export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Slightly larger inline limit keeps the tiny icons/data URIs out of extra
    // requests; rollup chunking is left to crxjs.
    chunkSizeWarningLimit: 1000,
  },
  // The content-script CSS is injected into a shadow root, so we don't want Vite
  // dev's HMR style injection there; production build is what we ship.
  server: { port: 5180, strictPort: false },
});
