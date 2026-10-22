import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PARKED_COMMANDS } from './parked-commands.js';

export interface ParkedEntry { gate: string; owner: string }

/** Parses the active `PARKED=( "<gate>:<SPnn>" ... )` array from scripts/ci.sh text. Comment lines are ignored. */
export function parseParked(ciScript: string): ParkedEntry[] {
  const code = ciScript.split(/\r?\n/).filter(line => !/^\s*#/.test(line)).join('\n');
  const match = /^PARKED=\(([^)]*)\)/m.exec(code);
  if (!match) throw new Error('PARKED=( ... ) array not found in ci.sh');
  const entries: ParkedEntry[] = [];
  for (const [, quoted] of match[1]!.matchAll(/"([^"]*)"/g)) {
    const at = quoted!.lastIndexOf(':');
    const gate = quoted!.slice(0, at), owner = quoted!.slice(at + 1);
    if (at <= 0 || !/^SP\d{2}$/.test(owner)) throw new Error(`Malformed PARKED entry "${quoted}"; expected "<gate>:<SPnn>"`);
    entries.push({ gate, owner });
  }
  return entries;
}

/** Parked leftovers outside ci.sh: `_parked` source/test directories and the CLI refusal list. */
export function parkedArtifacts(root: string, commands: Readonly<Record<string, string>> = PARKED_COMMANDS): string[] {
  const out: string[] = [];
  for (const dir of ['tools/src/_parked', 'tools/test/_parked']) if (existsSync(resolve(root, dir))) out.push(`${dir} exists`);
  for (const [command, owner] of Object.entries(commands)) out.push(`cli command ${command} refused (PARKED_COMMANDS, ${owner})`);
  return out;
}

/** Default mode lists and passes; strict mode fails while any entry or parked artifact remains. */
export function checkParked(ciScript: string, strict: boolean, artifacts: readonly string[] = []): { ok: boolean; entries: ParkedEntry[]; text: string } {
  const entries = parseParked(ciScript);
  const lines = entries.length ? entries.map(e => `PARKED(${e.owner}) ${e.gate}`) : ['PARKED list is empty'];
  for (const a of artifacts) lines.push(`PARKED artifact: ${a}`);
  const remaining = entries.length + artifacts.length;
  const ok = !strict || remaining === 0;
  if (!ok) lines.push(`check:parked --strict failed: ${entries.length} parked gate(s) and ${artifacts.length} parked artifact(s) remain`);
  return { ok, entries, text: lines.join('\n') };
}

export async function runParked(args: string[], ciPath: string): Promise<number> {
  const strict = args.includes('--strict');
  const unknown = args.filter(a => a !== '--strict');
  if (unknown.length) { console.error(`Unknown option ${unknown[0]}`); return 2; }
  const result = checkParked(await readFile(ciPath, 'utf8'), strict, parkedArtifacts(resolve(dirname(ciPath), '..')));
  console.log(result.text);
  return result.ok ? 0 : 1;
}
