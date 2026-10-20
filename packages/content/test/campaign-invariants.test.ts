import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// SP05 AC2/AC4: campaign invariants over the shipped level files (sample.json is not campaign).
const dir = join(fileURLToPath(new URL('..', import.meta.url)), 'data', 'levels');

interface LevelFile {
  id: string;
  order: number;
  band: number;
  visual: string;
  timeLimitSec: number;
  overrides?: Record<string, unknown>;
  players: { kind: string; botProfile?: string }[];
  towers: { id: string; archetype: string; owner: string | null; garrison: number; pos: { x: number; y: number } }[];
}

const levels: LevelFile[] = readdirSync(dir)
  .filter((f) => /^\d\d-.*\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as LevelFile);

// PRD per-level table: [towers, bot profiles, time limit]. Shipped data matches the PRD on every row.
const table: [number, string[], number][] = [
  [5, ['idle'], 180],
  [6, ['turtle-easy'], 300],
  [6, ['turtle-easy'], 300],
  [7, ['rusher-easy'], 300],
  [7, ['rusher-easy'], 300],
  [8, ['economist-normal'], 300],
  [8, ['opportunist-normal'], 300],
  [9, ['rusher-normal'], 300],
  [9, ['turtle-normal'], 300],
  [10, ['rusher-normal', 'economist-normal'], 300],
  [12, ['rusher-hard', 'turtle-hard', 'economist-hard'], 300],
  [10, ['opportunist-hard'], 300],
  [11, ['rusher-hard', 'turtle-hard'], 300],
  [9, ['rusher-hard'], 180],
  [11, ['economist-hard', 'opportunist-hard'], 300],
  [10, ['turtle-expert'], 300],
  [11, ['rusher-normal', 'rusher-normal'], 300],
  [14, ['rusher-expert', 'turtle-expert', 'economist-expert'], 360],
  [12, ['opportunist-expert', 'turtle-expert'], 360],
  [14, ['rusher-expert', 'turtle-expert', 'economist-expert'], 360],
];
const themes = ['grass', 'grass', 'grass', 'grass'];

test('campaign has exactly 20 levels, order == level number, 5 per band', () => {
  assert.equal(levels.length, 20);
  assert.deepEqual(levels.map((l) => l.order), Array.from({ length: 20 }, (_, i) => i + 1));
  for (const l of levels) {
    assert.equal(l.id.slice(0, 2), String(l.order).padStart(2, '0'), l.id);
    assert.equal(l.band, Math.ceil(l.order / 5), l.id);
  }
  for (let b = 1; b <= 4; b++) assert.equal(levels.filter((l) => l.band === b).length, 5, `band ${b}`);
});

test('per-level table: tower count, bot profiles, time limit, visual theme', () => {
  levels.forEach((l, i) => {
    const [towers, bots, limit] = table[i]!;
    assert.equal(l.towers.length, towers, `${l.id} tower count`);
    assert.deepEqual(l.players.filter((p) => p.kind === 'bot').map((p) => p.botProfile), bots, `${l.id} bots`);
    assert.equal(l.players.filter((p) => p.kind === 'human').length, 1, `${l.id} humans`);
    assert.equal(l.timeLimitSec, limit, `${l.id} time limit`);
    assert.equal(l.visual, themes[l.band - 1], `${l.id} theme`);
  });
});

test('no non-empty overrides; only standard|small|large archetypes', () => {
  for (const l of levels) {
    assert.deepEqual(l.overrides ?? {}, {}, `${l.id} overrides`);
    for (const t of l.towers) assert.ok(['standard', 'small', 'large'].includes(t.archetype), `${l.id} archetype ${t.archetype}`);
  }
});

test('no variant before its intro: small first at L6, large first at L7', () => {
  const first = (a: string) => levels.find((l) => l.towers.some((t) => t.archetype === a))?.order;
  for (const l of levels.filter((x) => x.order <= 5)) {
    assert.ok(l.towers.every((t) => t.archetype === 'standard'), `${l.id} standard only`);
  }
  assert.equal(first('small'), 6);
  assert.ok((first('large') ?? 0) >= 7);
  assert.equal(first('large'), 7);
});

// Layout rules (PRD "Level-design guidelines"), mechanical subset. Caps come from the archetype data.
const archDir = join(dir, '..', 'archetypes');
const cap: Record<string, number> = Object.fromEntries(
  ['standard', 'small', 'large'].map((a) => {
    const j = JSON.parse(readFileSync(join(archDir, `${a}.json`), 'utf8')) as { components?: { garrison?: { cap?: number } } };
    return [a, j.components?.garrison?.cap ?? 50]; // small/large extend standard; they declare their own cap
  }),
);

test('layout: tower centre distance >= 18 u and <= 14 towers per level', () => {
  for (const l of levels) {
    assert.ok(l.towers.length <= 14, `${l.id} tower count`);
    for (let i = 0; i < l.towers.length; i++)
      for (let j = i + 1; j < l.towers.length; j++) {
        const a = l.towers[i]!, b = l.towers[j]!;
        assert.ok(Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) >= 18, `${l.id} ${a.id}-${b.id} spacing`);
      }
  }
});

test('layout: owned garrisons <= cap/2; neutral garrisons 8-25', () => {
  for (const l of levels)
    for (const t of l.towers) {
      if (t.owner !== null) assert.ok(t.garrison <= cap[t.archetype]! / 2, `${l.id} ${t.id} owned garrison ${t.garrison}`);
      else {
        assert.ok(t.garrison >= 8, `${l.id} ${t.id} neutral garrison ${t.garrison} < 8`);
        // Logged accepted deviation (tuning-notes.md, Task 10 / L7): central large neutral garrison 26.
        const max = l.order === 7 && t.archetype === 'large' ? 26 : 25;
        assert.ok(t.garrison <= max, `${l.id} ${t.id} neutral garrison ${t.garrison} > ${max}`);
      }
    }
});

// "Line length 20-90 u" is not mechanical: any tower pair may be linked, so it has no defined pair set. Not asserted.
