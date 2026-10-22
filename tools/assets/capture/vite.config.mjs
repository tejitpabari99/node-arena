import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const three = fs.realpathSync(path.resolve(here, '../../../apps/web/node_modules/three'));
// Standalone dev page: never part of the apps/web production bundle. three resolved from apps/web's deps.
export default {
  root: here,
  configFile: false,
  cacheDir: path.resolve(here, '../../../node_modules/.vite-asset-capture'),
  resolve: { alias: { 'three/addons': path.join(three, 'examples/jsm'), three: three, '@node-arena/defs': path.resolve(here, '../../../packages/defs/src/index.ts') } },
  server: { fs: { allow: [path.resolve(here, '../../..')] } },
};
