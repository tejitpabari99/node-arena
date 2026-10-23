import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const three = fs.realpathSync(path.resolve(here, '../../../apps/web/node_modules/three'));
// Standalone dev page (never in the apps/web bundle). `TW_EXTRACT` is allowed in server.fs so GLBs load via /@fs/.
const extra = process.env.TW_EXTRACT ? [fs.realpathSync(process.env.TW_EXTRACT)] : [];
export default {
  root: here,
  configFile: false,
  cacheDir: path.resolve(here, '../../../node_modules/.vite-asset-validate'),
  resolve: { alias: { three } },
  server: { fs: { allow: [path.resolve(here, '../../..'), ...extra] } },
};
