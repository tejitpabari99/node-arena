// Deploy smoke: compare a running server's /healthz `versions` with the versions
// this checkout would report (computed from the same constants, never hard-coded).
// Usage: node scripts/pvp-versions.mjs <healthz-url> [--attempts N] [--delay-ms MS]
// Needs `pnpm build:prerequisites` (reads built dist of content, bots, net).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const load = (pkg) => import(pathToFileURL(resolve(root, 'packages', pkg, 'dist/index.js')).href);

export async function expectedVersions() {
  const [content, bots, net] = await Promise.all([load('content'), load('bots'), load('net')]);
  const meta = content.parseContentMeta(readFileSync(resolve(root, 'packages/content/content.json'), 'utf8'));
  return {
    rules: content.RULES_VERSION,
    schema: meta.schemaVersion,
    content: meta.contentVersion,
    bot: bots.BOT_VERSION,
    protocol: net.PROTOCOL_VERSION,
  };
}

/** Returns mismatch descriptions; empty = equal. */
export function diffVersions(actual, expected) {
  const a = actual !== null && typeof actual === 'object' ? actual : {};
  const out = [];
  for (const k of new Set([...Object.keys(expected), ...Object.keys(a)])) {
    if (a[k] !== expected[k]) out.push(`${k}: server=${JSON.stringify(a[k])} expected=${JSON.stringify(expected[k])}`);
  }
  return out;
}

async function fetchVersions(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body?.ok !== true) throw new Error('healthz ok !== true');
  return body.versions;
}

export async function main(argv) {
  const url = argv[0];
  if (!url) { console.error('usage: pvp-versions.mjs <healthz-url> [--attempts N] [--delay-ms MS]'); return 2; }
  const opt = (name, d) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : d; };
  const attempts = opt('--attempts', 10);
  const delay = opt('--delay-ms', 6000);
  const expected = await expectedVersions();
  console.log(`expected versions: ${JSON.stringify(expected)}`);
  let last = 'no attempt';
  for (let i = 1; i <= attempts; i++) {
    try {
      const actual = await fetchVersions(url);
      const diff = diffVersions(actual, expected);
      if (diff.length === 0) { console.log(`ok: ${url} versions match`); return 0; }
      last = `version mismatch: ${diff.join('; ')}`;
    } catch (e) {
      last = `request failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    console.error(`attempt ${i}/${attempts}: ${last}`);
    if (i < attempts) await new Promise((r) => setTimeout(r, delay));
  }
  console.error(`::error::healthz smoke failed: ${last}`);
  return 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
