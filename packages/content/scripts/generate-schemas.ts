import { readFile, writeFile } from 'node:fs/promises';
import { HostedSchemas, next } from '../src/index.js';

// v1 schemas live in schemas/, v2 (next/) schemas in schemas/next/.
const targets = [
  ...Object.entries(HostedSchemas).map(([name, schema]) => ({ dir: '', name, schema })),
  ...Object.entries(next.NextSchemas).map(([name, schema]) => ({ dir: 'next/', name, schema })),
];
for (const { dir, name, schema } of targets) {
  const filename = `${dir}${name}.schema.json`;
  const destination = new URL(`../schemas/${filename}`, import.meta.url);
  const generated = `${JSON.stringify(schema, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    const committed = await readFile(destination, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (committed !== generated) {
      console.error(`${filename} is stale or missing; run pnpm content:schemas`);
      process.exitCode = 1;
    } else {
      console.log(`${filename} is current`);
    }
  } else {
    await writeFile(destination, generated);
    console.log(`Generated schemas/${filename}`);
  }
}
