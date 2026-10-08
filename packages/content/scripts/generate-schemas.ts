import { readFile, writeFile } from 'node:fs/promises';
import { TroopSchema } from '../src/index.js';

const destination = new URL('../schemas/troop.schema.json', import.meta.url);
const generated = `${JSON.stringify(TroopSchema, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const committed = await readFile(destination, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (committed !== generated) {
    console.error('troop.schema.json is stale or missing; run pnpm content:schemas');
    process.exitCode = 1;
  } else {
    console.log('troop.schema.json is current');
  }
} else {
  await writeFile(destination, generated);
  console.log('Generated schemas/troop.schema.json');
}
