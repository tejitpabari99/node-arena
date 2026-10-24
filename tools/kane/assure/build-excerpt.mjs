import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const required = ['R-LIN-01', 'R-LIN-02', 'R-LIN-03', 'R-LIN-04', 'R-LIN-05', 'R-WIN-01', 'R-WIN-02', 'R-WIN-03'];

/** Preserve each selected heading and body up to the next peer or higher heading. */
export function buildExcerpt(rules, uiFacts) {
  const headings = [...rules.matchAll(/^#{1,3}[ \t]+[^\r\n]*(?:\r?\n|$)/gm)];
  const blocks = new Map();
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const id = /^### (R-(?:LIN|WIN)-\d{2})[ \t]*\r?\n?$/.exec(heading[0])?.[1];
    if (!required.includes(id)) continue;
    if (blocks.has(id)) throw new Error(`Duplicate required rule heading: ${id}`);
    blocks.set(id, rules.slice(heading.index, headings[i + 1]?.index ?? rules.length));
  }
  for (const id of required) {
    if (!blocks.has(id)) throw new Error(`Missing required rule heading: ${id}`);
  }
  return required.map(id => blocks.get(id)).join('') + uiFacts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const rules = readFileSync(new URL('../../../docs/GAME_RULES.md', import.meta.url), 'utf8');
    const facts = readFileSync(new URL('./ui-facts.md', import.meta.url), 'utf8');
    process.stdout.write(buildExcerpt(rules, facts));
  } catch (error) {
    console.error(`build-excerpt: ${error.message}`);
    process.exitCode = 1;
  }
}
