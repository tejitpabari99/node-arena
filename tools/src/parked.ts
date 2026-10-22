import { readFile } from 'node:fs/promises';

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

/** Default mode lists and passes; strict mode fails while any entry remains. */
export function checkParked(ciScript: string, strict: boolean): { ok: boolean; entries: ParkedEntry[]; text: string } {
  const entries = parseParked(ciScript);
  const lines = entries.length ? entries.map(e => `PARKED(${e.owner}) ${e.gate}`) : ['PARKED list is empty'];
  const ok = !strict || entries.length === 0;
  if (!ok) lines.push(`check:parked --strict failed: ${entries.length} parked gate(s) remain`);
  return { ok, entries, text: lines.join('\n') };
}

export async function runParked(args: string[], ciPath: string): Promise<number> {
  const strict = args.includes('--strict');
  const unknown = args.filter(a => a !== '--strict');
  if (unknown.length) { console.error(`Unknown option ${unknown[0]}`); return 2; }
  const result = checkParked(await readFile(ciPath, 'utf8'), strict);
  console.log(result.text);
  return result.ok ? 0 : 1;
}
