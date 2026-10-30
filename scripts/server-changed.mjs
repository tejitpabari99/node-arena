// Prints `true` when the PvP server must be redeployed for a push, else `false`.
// Usage: node scripts/server-changed.mjs <before-sha> <after-sha>
// Missing/zero/unknown `before` (first push, force-push, shallow clone) => true (safe default).
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PREFIXES = [
  'apps/server/',
  'packages/net/', 'packages/sim/', 'packages/content/', 'packages/bots/', 'packages/defs/',
];
const FILES = new Set(['pnpm-lock.yaml', '.github/workflows/deploy-server.yml']);

export function isServerPath(p) {
  return FILES.has(p) || PREFIXES.some((x) => p.startsWith(x));
}

export function serverChanged(before, after, cwd = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (!before || /^0+$/.test(before) || !after) return true;
  try {
    git('cat-file', '-e', `${before}^{commit}`);
    const files = git('diff', '--name-only', `${before}..${after}`).split('\n').filter(Boolean);
    return files.some(isServerPath);
  } catch {
    return true;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(String(serverChanged(process.argv[2], process.argv[3])));
}
