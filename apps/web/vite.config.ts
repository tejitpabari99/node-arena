import { fileURLToPath, URL } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact()],
  publicDir: 'assets',
  build: {
    rollupOptions: { input: {
      main: fileURLToPath(new URL('./index.html', import.meta.url)),
      spike: fileURLToPath(new URL('./spike.html', import.meta.url)),
    } },
  },
  resolve: {
    // Resolve public entrypoints from source for clean-checkout development and HMR.
    alias: [
      { find: /^@node-arena\/bots$/, replacement: fileURLToPath(new URL('../../packages/bots/src/index.ts', import.meta.url)) },
      { find: /^@node-arena\/content$/, replacement: fileURLToPath(new URL('../../packages/content/src/index.ts', import.meta.url)) },
      { find: /^@node-arena\/sim$/, replacement: fileURLToPath(new URL('../../packages/sim/src/index.ts', import.meta.url)) },
    ],
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
