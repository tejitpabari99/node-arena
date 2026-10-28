import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Value from 'typebox/value';
import {
  BOT_KINDS, CAPABILITIES, COMMANDS, EVENTS, MODULES, OBJECTIVES, PHASES, VISUAL,
  type Command, type ModuleId, type SimEvent,
} from '../src/index.js';

const rules = readFileSync(new URL('../../../docs/GAME_RULES.md', import.meta.url), 'utf8');
const ruleHeadings = new Set([...rules.matchAll(/^### (R-[A-Z]+-\d+)\s*$/gm)].map((m) => m[1]));

test('module ids match def ids and ruleIds exist in GAME_RULES.md', () => {
  assert.deepEqual(Object.keys(MODULES).sort(), ['blocksLines', 'drawsLines', 'grows', 'level', 'shoots', 'spawns']);
  for (const [key, def] of Object.entries(MODULES)) {
    assert.equal(def.id, key);
    assert.equal(def.feature, key);
    assert.ok(def.ruleIds.length > 0, key);
    for (const id of def.ruleIds) assert.ok(ruleHeadings.has(id), `${key}: ${id} not in GAME_RULES.md`);
    for (const phase of def.phases) assert.ok(PHASES.includes(phase));
  }
  for (const def of [...Object.values(COMMANDS), ...Object.values(OBJECTIVES)]) {
    for (const id of def.ruleIds) assert.ok(ruleHeadings.has(id), `${def.id}: ${id}`);
  }
});

test('PHASES is the 9-name tuple of GAME_RULES section 4', () => {
  assert.equal(PHASES.length, 9);
  assert.equal(PHASES[1], 'reserved');
});

test('param builders embed x-unit tags; counts are untagged', () => {
  const spawns = MODULES.spawns.params.properties as unknown as Record<string, Record<string, unknown>>;
  assert.equal(spawns.spawnSpeed?.['x-unit'], 'fx3');
  assert.equal(spawns.lineSpawnPenalty?.['x-unit'], 'fx3');
  assert.equal(spawns.troop?.['x-unit'], undefined);
  const level = MODULES.level.params.properties as unknown as Record<string, Record<string, unknown>>;
  assert.equal(level.maxLevel?.type, 'integer');
  assert.equal(level.maxLevel?.['x-unit'], undefined);
  const shoots = MODULES.shoots.params.properties as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['attackDelay', 'attackRadius', 'speedUpByLevel', 'radiusUpByLevel', 'radiusUnit', 'minRadius', 'troopPad', 'bulletSpeed']) {
    assert.equal(shoots[key]?.['x-unit'], 'fx3', key);
  }
  assert.equal(shoots.neutralFires?.type, 'boolean');
  assert.equal(shoots.hitsNeutralHouses?.type, 'boolean');
  assert.equal(shoots.bulletSpeed?.['x-presentation'], true);
  assert.equal(shoots.attackDelay?.['x-presentation'], undefined);
});

test('module params validate TW defaults and reject unknown keys', () => {
  assert.ok(Value.Check(MODULES.level.params, { maxLevel: 64 }));
  assert.ok(Value.Check(MODULES.spawns.params, { troop: 'soldier', spawnSpeed: 0.5, lineSpawnPenalty: 0.3 }));
  assert.ok(Value.Check(MODULES.grows.params, { growTime: 1.7 }));
  assert.ok(Value.Check(MODULES.shoots.params, {
    attackDelay: 2, attackRadius: 1.6, speedUpByLevel: 1.75, radiusUpByLevel: 0.9, radiusUnit: 2.4, minRadius: 1,
    neutralFires: true, troopPad: 0.35, hitsNeutralHouses: true, bulletSpeed: 12,
  }));
  assert.ok(!Value.Check(MODULES.level.params, { maxLevel: 64, extra: 1 }));
  assert.ok(!Value.Check(MODULES.level.params, { maxLevel: 1.5 }));
  assert.ok(Value.Check(MODULES.drawsLines.params, {}));
});

test('commands and events', () => {
  assert.deepEqual(Object.keys(COMMANDS), ['DrawLine', 'CutLine']);
  assert.ok(Value.Check(COMMANDS.DrawLine.payload, { player: 0, from: 1, to: 2 }));
  assert.ok(!Value.Check(COMMANDS.DrawLine.payload, { player: 0, from: 1 }));
  assert.ok(!('UseBooster' in COMMANDS));
  const cmd: Command = { type: 'CutLine', player: 0, from: 1, to: 2 };
  assert.equal(cmd.type, 'CutLine');
  for (const [key, ev] of Object.entries(EVENTS)) assert.equal(ev.id, key);
  const ev: SimEvent = { type: 'MatchOver', outcome: 'won', winner: 0 };
  assert.ok(Value.Check(EVENTS.MatchOver.payload, { outcome: ev.type === 'MatchOver' ? ev.outcome : 'lost', winner: null }));
  assert.ok(Value.Check(EVENTS.TowerShot.payload, { tower: 1, target: { kind: 'house', building: 2 }, x: 0, z: -5 }));
  assert.ok(!Value.Check(EVENTS.TroopDied.payload, { channel: 0, seq: 0, owner: 0, kind: 'soldier', cause: 'bomb', x: 0, z: 0 }));
});

test('objectives and visuals', () => {
  assert.deepEqual(Object.keys(OBJECTIVES), ['captureAll', 'pvp']);
  assert.deepEqual(OBJECTIVES.pvp.seats, { min: 2, max: 4 });
  assert.deepEqual(OBJECTIVES.pvp.ruleIds, ['R-SEA-01', 'R-TEM-01', 'R-TEM-02', 'R-TEM-03', 'R-ELM-01', 'R-WIN-04', 'R-WIN-05', 'R-WIN-06', 'R-WIN-07']);
  for (const outcome of ['victory', 'timeLimit', 'draw']) assert.ok(Value.Check(EVENTS.MatchOver.payload, { outcome, winner: null, winners: [0, 2] }), outcome);
  assert.ok(!Value.Check(EVENTS.MatchOver.payload, { outcome: 'draw', winner: null, winners: [-1] }));
  assert.ok(Value.Check(EVENTS.SeatEliminated.payload, { player: 1 }));
  assert.ok(!Value.Check(EVENTS.SeatEliminated.payload, { player: 1, x: 0 }));
  assert.deepEqual(OBJECTIVES.captureAll.seats, { human: 1, aiMax: 3 });
  assert.deepEqual([...VISUAL.RENDER_KINDS], ['unit', 'building', 'element', 'ground', 'lane', 'fx']);
  assert.deepEqual(Object.keys(VISUAL.BUDGET_CLASSES), ['unit', 'building', 'obstacle', 'ground']);
});

test('tw bot kind validates and lists building refs', () => {
  const bot = {
    kind: 'tw', actionDelayMs: 12000, behavior: 'full',
    script: [
      { op: 'delay', ms: 8000 },
      { op: 'line', own: 'b3', target: 'b2', afterMs: 6000 },
      { op: 'line', own: null, target: 'b9', afterMs: 0 },
      { op: 'steps', root: { goal: 'line', own: 'b1', target: 'b2', delayMs: 5000, then: [{ goal: 'capture', own: 'b7', target: null }, { goal: 'none' }] } },
    ],
  };
  assert.ok(Value.Check(BOT_KINDS.tw.params, bot));
  assert.deepEqual(BOT_KINDS.tw.buildingRefs(bot as never).sort(), ['b1', 'b2', 'b3', 'b7', 'b9']);
  assert.ok(Value.Check(BOT_KINDS.tw.params, { kind: 'tw', actionDelayMs: 50, behavior: 'attackOnly' }));
  assert.deepEqual(BOT_KINDS.tw.buildingRefs({ kind: 'tw', actionDelayMs: 50, behavior: 'attackOnly' }), []);
  assert.ok(!Value.Check(BOT_KINDS.tw.params, { ...bot, actionDelayMs: 49 }));
  assert.ok(!Value.Check(BOT_KINDS.tw.params, { ...bot, behavior: 'other' }));
  assert.ok(!Value.Check(BOT_KINDS.tw.params, { ...bot, kind: 'utility' }));
  assert.ok(!Value.Check(BOT_KINDS.tw.params, { ...bot, script: [{ op: 'steps', root: { goal: 'line', then: [{ goal: 'nope' }] } }] }));
});

test('CAPABILITIES = module ids + bot:<kind> + objective:<id>', () => {
  assert.deepEqual([...CAPABILITIES].sort(), ['blocksLines', 'bot:tw', 'drawsLines', 'grows', 'level', 'objective:captureAll', 'objective:pvp', 'shoots', 'spawns']);
});

test('binding map: missing module impl is a compile error (checked by tsc)', () => {
  // @ts-expect-error blocksLines missing
  const missing: Record<ModuleId, true> = { level: true, drawsLines: true, spawns: true, grows: true, shoots: true };
  const full = { level: true, drawsLines: true, spawns: true, grows: true, shoots: true, blocksLines: true } satisfies Record<ModuleId, true>;
  // @ts-expect-error stray impl is an excess-property error
  const stray: Record<ModuleId, true> = { ...full, extra: true, level: true };
  void missing; void stray;
  assert.equal(Object.keys(full).length, Object.keys(MODULES).length);
});

test('FX_KINDS equals the 07 art-pipeline contract values', () => {
  assert.deepEqual([...VISUAL.FX_KINDS], ['sprite-burst', 'ring', 'beam']);
});

test('CommandRejected payload only accepts COMMANDS ids and reject reasons', () => {
  const ok = { player: 0, command: 'DrawLine', reason: 'no-slot' };
  assert.equal(Value.Check(EVENTS.CommandRejected.payload, ok), true);
  assert.equal(Value.Check(EVENTS.CommandRejected.payload, { ...ok, command: 'Nope' }), false);
  assert.equal(Value.Check(EVENTS.CommandRejected.payload, { ...ok, reason: 'because' }), false);
  for (const c of Object.values(COMMANDS)) for (const reason of c.rejectReasons) assert.equal(Value.Check(EVENTS.CommandRejected.payload, { player: 0, command: c.id, reason }), true, reason);
});
