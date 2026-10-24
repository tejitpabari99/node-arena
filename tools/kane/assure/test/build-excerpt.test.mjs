import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ids = ['R-LIN-01', 'R-LIN-02', 'R-LIN-03', 'R-LIN-04', 'R-LIN-05', 'R-WIN-01', 'R-WIN-02', 'R-WIN-03'];
const module = await import('../build-excerpt.mjs').catch(() => null);
const build = (...args) => {
  assert.equal(typeof module?.buildExcerpt, 'function', 'buildExcerpt must be implemented');
  return module.buildExcerpt(...args);
};
const blocks = ids.map(id => `### ${id}\n\nVerbatim **${id}** with trailing spaces.  \n\n#### Detail\n\n*Since:* 2.0.0.\n\n`);
const appendix = '## Panel UI facts\n\nUse the bottom panel.\n';
const fixture = `# Rules\n\nIgnore introduction.\n\n### R-GRW-02\n\nIgnore preceding rule.\n\n${blocks.slice(0, 5).join('')}### R-CAP-01\n\nIgnore middle rule.\n\n${blocks.slice(5).join('')}## Retired rules\n\nIgnore trailing section.\n`;

test('keeps exactly eight requested blocks verbatim, excludes unrelated sections, appends facts', () => {
  assert.equal(build(fixture, appendix), blocks.join('') + appendix);
});

test('fails explicitly for every missing required heading rather than producing partial input', () => {
  for (const id of ids) {
    assert.throws(() => build(fixture.replace(`### ${id}\n`, `### omitted-${id}\n`), appendix), new RegExp(`Missing required rule heading: ${id}`));
  }
});

test('rejects duplicate required headings rather than silently picking one', () => {
  assert.throws(() => build(fixture + blocks[0], appendix), /Duplicate required rule heading: R-LIN-01/);
});

test('CLI works outside the repository root and matches the committed eight-rule excerpt and appendix', () => {
  const script = fileURLToPath(new URL('../build-excerpt.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [script], { cwd: '/tmp', encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const committed = readFileSync(new URL('../excerpt.md', import.meta.url), 'utf8');
  const facts = readFileSync(new URL('../ui-facts.md', import.meta.url), 'utf8');
  const rules = readFileSync(new URL('../../../../docs/GAME_RULES.md', import.meta.url), 'utf8');
  assert.equal(run.stdout, committed, 'regenerate excerpt.md after changing rules or UI facts');
  assert.deepEqual([...run.stdout.matchAll(/^### (R-[A-Z]+-\d+)$/gm)].map(match => match[1]), ids);
  for (const id of ids) {
    const start = rules.indexOf(`### ${id}\n`);
    const end = rules.indexOf('\n### ', start + 1);
    assert.ok(run.stdout.includes(rules.slice(start, end + 1)), `${id} must remain verbatim`);
  }
  assert.ok(run.stdout.endsWith(facts), 'hand-written facts must be the final appendix');
  assert.doesNotMatch(run.stdout, /^### (?:R-CAP-|R-GRW-|Retired ids)/m);
});
