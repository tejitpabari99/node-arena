import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const preact = fs.realpathSync(path.resolve(here, '../../../apps/web/node_modules/preact'));
const three = fs.realpathSync(path.resolve(here, '../../../apps/web/node_modules/three'));
// Standalone dev page: never part of the apps/web production bundle. three resolved from apps/web's deps.
export default {
  root: here,
  publicDir: path.resolve(here, '../../../apps/web/assets'),
  configFile: false,
  cacheDir: path.resolve(here, '../../../node_modules/.vite-asset-capture'),
  define: { __WEB_ASSETS__: JSON.stringify(`/@fs${path.resolve(here, '../../../apps/web/assets')}`) },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  resolve: { alias: [
    { find: /^preact\/hooks$/, replacement: `${preact}/hooks/dist/hooks.module.js` },
    { find: /^preact\/jsx-dev-runtime$/, replacement: `${preact}/jsx-runtime/dist/jsxRuntime.module.js` },
    { find: /^preact\/jsx-runtime$/, replacement: `${preact}/jsx-runtime/dist/jsxRuntime.module.js` },
    { find: /^preact$/, replacement: `${preact}/dist/preact.module.js` },
    { find: /^@node-arena\/content$/, replacement: path.resolve(here, '../../../packages/content/src/index.ts') },
    { find: /^@node-arena\/bots$/, replacement: path.resolve(here, '../../../packages/bots/src/index.ts') },
    { find: /^three\/addons\//, replacement: `${three}/examples/jsm/` },
    { find: /^three$/, replacement: `${three}/build/three.module.js` },
    { find: /^@node-arena\/defs$/, replacement: path.resolve(here, '../../../packages/defs/src/index.ts') },
    { find: /^@node-arena\/sim$/, replacement: path.resolve(here, '../../../packages/sim/src/index.ts') },
  ] },
  server: { fs: { allow: [path.resolve(here, '../../..')] } },
};
