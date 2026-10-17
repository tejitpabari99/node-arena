// Usage: pnpm --filter @node-arena/tools layout <input.json> [--out <level.json>]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateLayout, type LayoutInput } from './layout.js';

const [input, flag, out] = process.argv.slice(2);
if (!input || (flag !== undefined && (flag !== '--out' || !out))) { console.error('Usage: layout <input.json> [--out <level.json>]'); process.exit(2); }
try {
  const json = `${JSON.stringify(generateLayout(JSON.parse(readFileSync(resolve(input), 'utf8')) as LayoutInput), null, 2)}\n`;
  if (out) writeFileSync(resolve(out), json); else process.stdout.write(json);
} catch (error) { console.error(`layout: ${(error as Error).message}`); process.exit(1); }
