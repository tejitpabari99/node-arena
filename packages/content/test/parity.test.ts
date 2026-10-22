import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { COMMANDS, MODULES, OBJECTIVES } from '@node-arena/defs';
import * as content from '../src/index.js';
import { ContentLoadError } from '../src/index.js';

const url = (rel: string) => new URL(rel, import.meta.url);
const rules = readFileSync(url('../../../docs/GAME_RULES.md'), 'utf8');

/** Active rule ids: `### R-XXX-NN` headings that are not tombstoned (mirrors tools/src/rules.ts for the shapes in use). */
function activeRuleIds(md: string): Set<string> {
  const active = new Set<string>();
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  let fence = false, cur: { id: string; tomb: boolean } | undefined;
  const finish = () => { if (cur && !cur.tomb) active.add(cur.id); cur = undefined; };
  for (const line of lines) {
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const h = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      finish();
      const id = /^`?(R-[A-Z]+-\d+)\b`?/.exec(h[2]!)?.[1];
      if (id) cur = { id, tomb: /\btombstone\b/i.test(h[2]!) };
    } else if (cur && /^\s*(?:\*\*?|_)?(?:status\s*:\s*)?tombstone\b/i.test(line)) cur.tomb = true;
  }
  finish();
  return active;
}

test('ruleIds parity: every MODULES/COMMANDS/OBJECTIVES ruleId is an active GAME_RULES heading', () => {
  const active = activeRuleIds(rules);
  assert.ok(active.size > 20);
  const defs = [...Object.values(MODULES), ...Object.values(COMMANDS), ...Object.values(OBJECTIVES)];
  for (const def of defs) {
    assert.ok(def.ruleIds.length > 0, def.id);
    for (const id of def.ruleIds) assert.ok(active.has(id), `${def.id}: ${id} is not an active rule heading`);
  }
});

function glossary(): { parity: string[]; all: string[] } {
  const start = rules.indexOf('## 7. Parameter glossary');
  const end = rules.indexOf('\n## 8.', start);
  assert.ok(start >= 0 && end > start, 'glossary section not found');
  const parity: string[] = [], all: string[] = [];
  for (const line of rules.slice(start, end).split('\n')) {
    const m = /^\|\s*`([^`]+)`\s*\|.*\|\s*(yes)?\s*\|\s*$/.exec(line);
    if (!m) continue;
    all.push(m[1]!);
    if (m[2]) parity.push(m[1]!);
  }
  return { parity, all };
}

test('glossary parity: the 13 R10 keys equal the module schema params, both directions', () => {
  const { parity, all } = glossary();
  assert.equal(parity.length, 13, `parity rows: ${parity.join(',')}`);
  const params = new Map<string, { module: string; presentation: boolean }>();
  for (const [mid, def] of Object.entries(MODULES)) {
    for (const [key, schema] of Object.entries(def.params.properties as Record<string, Record<string, unknown>>)) {
      assert.ok(!params.has(key), `duplicate param key ${key}`);
      params.set(key, { module: mid, presentation: schema['x-presentation'] === true });
    }
  }
  // doc -> schema
  for (const key of parity) assert.ok(params.has(key), `glossary parity key "${key}" has no module param`);
  // schema -> doc: every non-presentation param is a parity row, or a non-parity glossary row (`spawns.troop`)
  for (const [key, info] of params) {
    if (info.presentation) continue;
    assert.ok(parity.includes(key) || all.includes(`${info.module}.${key}`), `module param "${info.module}.${key}" is not in the glossary`);
  }
  // presentation params stay out of the parity set
  for (const [key, info] of params) if (info.presentation) assert.ok(!parity.includes(key), `${key} is presentation-only`);
});

// ---- fixtures -------------------------------------------------------------------------------
function catalogFiles(): Record<string, string> {
  const root = url('../data/');
  const all: Record<string, string> = {};
  all['data/balance.json'] = readFileSync(new URL('balance.json', root), 'utf8');
  for (const dir of ['units', 'buildings', 'elements', 'campaigns']) {
    for (const name of readdirSync(new URL(`${dir}/`, root))) all[`data/${dir}/${name}`] = readFileSync(new URL(`${dir}/${name}`, root), 'utf8');
  }
  return all;
}
const goldenText = () => readFileSync(url('../data/levels/levelview-1.json'), 'utf8');
const syntheticText = () => readFileSync(url('./fixtures/obstacle-tower.json'), 'utf8');
const catalog = () => content.loadCatalog(catalogFiles());

// Pinned: moving these means the golden or sim-affecting compile semantics changed.
const PINNED_GOLDEN_SIM = 'f785555d1908dc2babffe94554d73c820870e10e586e583fa25fe6c9fbb5906a';
const PINNED_GOLDEN_BOT = 'cf6f32bbe314326acbdfee7de0d17855e776f701669c644980ee7416ccba6aaa';

test('golden levelview-1: serialization is JSON.stringify(...,null,2)+"\\n" in 05 R5 key order', () => {
  const text = goldenText();
  const obj = JSON.parse(text) as Record<string, unknown>;
  assert.equal(JSON.stringify(obj, null, 2) + '\n', text);
  assert.deepEqual(Object.keys(obj), ['$schema', 'schemaVersion', 'id', 'name', 'source', 'theme', 'bounds', 'objective', 'timeLimitSec', 'players', 'buildings', 'elements', 'requires']);
});

test('golden levelview-1: Frame contract rotation, bounds from the shared pad constant', () => {
  const lv = JSON.parse(goldenText()) as { bounds: unknown; buildings: Array<{ id: string; pos: { x: number; z: number } }> };
  // raw Unity (x,z) -> data (z,-x): b0 (-0.1,-6.79) -> (-6.79, 0.1)
  const raw: Array<[number, number]> = [[-0.1, -6.79], [2.56, 3.7], [4.95, -0.7], [-5.01, -4.66], [-2.74, 0.6]];
  raw.forEach(([x, z], i) => assert.deepEqual(lv.buildings[i]!.pos, { x: z === 0 ? 0 : z, z: x === 0 ? 0 : -x }, `b${i}`));
  assert.deepEqual(lv.buildings[0]!.pos, { x: -6.79, z: 0.1 });
  assert.deepEqual(lv.bounds, { minX: -9, maxX: 6, minZ: -7, maxZ: 8 });
  assert.equal(content.BOUNDS_PAD, 2);
  assert.deepEqual(content.boundsFromPositions(lv.buildings.map((b) => b.pos), content.BOUNDS_PAD), lv.bounds);
});

test('golden levelview-1: loads, compiles and hashes stably', () => {
  const c = catalog();
  const a = content.loadLevel(c, goldenText());
  assert.deepEqual(a.warnings, []);
  assert.deepEqual(a.level.requires, content.computeRequires(c, a.level));
  const x = content.compileLevel(c, a.level), y = content.compileLevel(catalog(), content.loadLevel(catalog(), goldenText()).level);
  assert.deepEqual(x, y);
  assert.equal(x.simHash, y.simHash);
  assert.equal(x.simHash, PINNED_GOLDEN_SIM);
  assert.equal(x.botHash['levelview-1#p2'], PINNED_GOLDEN_BOT);
  assert.equal(x.buildings.length, 5);
});

test('golden levelview-1: campaign common.json entry resolves through loadContent', () => {
  const loaded = content.loadContent({ ...catalogFiles(), 'data/levels/levelview-1.json': goldenText() });
  assert.deepEqual(Object.keys(loaded.compiled), ['levelview-1']);
});

test('synthetic obstacle+tower: obstacle outside bounds validates and is only logged', () => {
  const l = content.loadLevel(catalog(), syntheticText());
  assert.ok(l.warnings.some((w) => w.pointer === '/elements/1/pos' && /outside bounds/.test(w.message)), JSON.stringify(l.warnings));
  assert.ok(!l.warnings.some((w) => w.pointer === '/elements/0/pos'));
  const compiled = content.compileLevel(catalog(), l.level);
  assert.equal(compiled.elements.length, 2);
  assert.deepEqual(compiled.elements[0]!.footprint, { shape: 'box', w: 1200, d: 600 }, 'instance footprint override');
  assert.deepEqual(compiled.elements[1]!.footprint, { shape: 'circle', radius: 450 }, 'archetype footprint default');
  assert.ok(compiled.requires.includes('blocksLines') && compiled.requires.includes('shoots'));
});

test('synthetic obstacle+tower: a building outside bounds fails; no non-ignored building fails', () => {
  const c = catalog();
  const out = JSON.parse(syntheticText());
  out.buildings[0].pos.x = -20;
  assert.throws(() => content.loadLevel(c, out), (e) => e instanceof ContentLoadError && e.errors.some((x) => x.pointer === '/buildings/0/pos'));
  const none = JSON.parse(syntheticText());
  for (const b of none.buildings) b.ignoreForWin = true;
  assert.throws(() => content.loadLevel(c, none), (e) => e instanceof ContentLoadError && e.errors.some((x) => x.pointer === '/buildings' && /ignoreForWin/.test(x.message)));
});
