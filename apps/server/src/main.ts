import { fileURLToPath } from 'node:url';

export function serverName(): string {
  return '@node-arena/server';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`${serverName()} stub: no listener yet`);
}
