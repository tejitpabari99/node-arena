/** Node-only boundary: read a literal version as data, never evaluate git source. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canonicalJson } from '../src/hash.js';
const VERSION_PATH = 'packages/bots/src/version.ts';
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
export function botVersionFromSource(source: string): string {
  const literal = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').trim();
  const match = /^export\s+const\s+BOT_VERSION\s*=\s*(['"])([^'"]+)\1\s*;?$/.exec(literal);
  if (!match) throw new Error('BOT_VERSION source must contain a single exported literal');
  if (!SEMVER.test(match[2]!)) throw new Error('BOT_VERSION must be canonical semver');
  return match[2]!;
}
export function readBotVersion(root: string, ref?: string): string | undefined {
  if (ref === undefined) {
    try { return botVersionFromSource(readFileSync(resolve(root, VERSION_PATH), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  }
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const revision = git('rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
  if (!git('ls-tree', '-r', '--name-only', revision, '--', VERSION_PATH)) return undefined;
  return botVersionFromSource(git('show', `${revision}:${VERSION_PATH}`));
}
export function checkBotVersion(currentHashes: Record<string, string>, baselineHashes: Record<string, string> | undefined, current: string | undefined, previous: string | undefined): void {
  if (current === undefined) {
    if (previous !== undefined) throw new Error('BOT_VERSION source is missing');
    return; // Older standalone content-only fixtures have no bot package.
  }
  if (!SEMVER.test(current) || (previous !== undefined && !SEMVER.test(previous))) throw new Error('BOT_VERSION must be canonical semver');
  if (previous === undefined) return; // First bot implementation establishes the baseline.
  const next = current.split('.').map(Number), old = previous.split('.').map(Number);
  const index = next.findIndex((value, i) => value !== old[i]);
  if (index >= 0 && next[index]! < old[index]!) throw new Error('BOT_VERSION must not decrease');
  if (baselineHashes && canonicalJson(currentHashes) !== canonicalJson(baselineHashes) && (index < 0 || next[index]! <= old[index]!)) {
    throw new Error('Bot hashes changed: BOT_VERSION must increase from the committed baseline, even after regenerating the lock');
  }
}
