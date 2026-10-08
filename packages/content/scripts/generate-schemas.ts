import { readFile, writeFile } from 'node:fs/promises';
import { HostedSchemas } from '../src/index.js';

for (const [name, schema] of Object.entries(HostedSchemas)) {
  const filename = `${name}.schema.json`;
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
