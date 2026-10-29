import { fileURLToPath, URL } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';
import { editorPlugin } from './src/dev/editor-middleware.js';

export default defineConfig(({ command }) => ({
  plugins: [preact(), ...(command === 'serve' ? [editorPlugin(fileURLToPath(new URL('../../packages/content/data/levels', import.meta.url)))] : [])],
  server: { host: '127.0.0.1' },
  publicDir: 'assets',
  build: {
    rollupOptions: { input: {
      main: fileURLToPath(new URL('./index.html', import.meta.url)),
      ...(process.env.VITE_TEST_HOOKS === '1' ? { parity: fileURLToPath(new URL('./e2e/content-parity.html', import.meta.url)), editor: fileURLToPath(new URL('./editor.html', import.meta.url)) } : {}),
    } },
  },
  resolve: {
    // Resolve public entrypoints from source for clean-checkout development and HMR.
    alias: [
      { find: /^@node-arena\/defs$/, replacement: fileURLToPath(new URL('../../packages/defs/src/index.ts', import.meta.url)) },
      { find: /^@node-arena\/bots$/, replacement: fileURLToPath(new URL('../../packages/bots/src/index.ts', import.meta.url)) },
      { find: /^@node-arena\/content$/, replacement: fileURLToPath(new URL('../../packages/content/src/index.ts', import.meta.url)) },
      { find: /^@node-arena\/net$/, replacement: fileURLToPath(new URL('../../packages/net/src/index.ts', import.meta.url)) },
      { find: /^@node-arena\/sim$/, replacement: fileURLToPath(new URL('../../packages/sim/src/index.ts', import.meta.url)) },
    ],
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
}));
