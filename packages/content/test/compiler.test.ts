import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as content from '../src/index.js';

const envelope = (name: string) => ({ $schema: `${name}.schema.json`, schemaVersion: '1.0.0' as const });
function fixture(): content.ContentFileMap {
  return {
    'content.json': { ...envelope('content'), contentVersion: '1.0.0', rulesVersion: '1.0.0' },
    'balance.json': { ...envelope('balance'), defaults: { timeLimitSec: 300, theme: 'city' } },
    'troop.json': { ...envelope('troop'), id: 'regular', value: 1, speed: 10.125, visual: 'soldier' },
    'unused-troop.json': { ...envelope('troop'), id: 'unused', value: 1, speed: 5, visual: 'unused' },
    'other-troop.json': { ...envelope('troop'), id: 'a-regular', value: 1, speed: 8, visual: 'scout' },
    'base.json': { ...envelope('archetype'), id: 'standard', visual: 'tower', footprintRadius: 3, components: { garrison: { cap: 50 }, generates: { troop: 'a-regular', ratePerSec: 1.125 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } },
    'small.json': { ...envelope('archetype'), id: 'small', extends: 'standard', visual: 'tower.small', footprintRadius: 2.125, components: { garrison: { cap: 20 }, generates: { troop: 'regular', ratePerSec: 0.625 }, drawsLines: { extraSlotAbove: [10] } } },
    'bot.json': { ...envelope('bot'), id: 'base', kind: 'utility', params: { skill: { decisionIntervalSec: 1.25, noise: 0.1, actionsPerDecision: 2 }, bias: { attack: 1.125 }, weights: { attack: { targetValue: 9.25 } } } },
    'tier.json': { ...envelope('bot'), id: 'easy', kind: 'utility', params: { extends: 'base', skill: { decisionIntervalSec: 2.125, noise: 0.3, actionsPerDecision: 1 } } },
    'level.json': { ...envelope('level'), id: 'sample', name: 'Sample', order: 1, band: 1, bounds: { w: 120, h: 80 }, players: [{ id: 'p1', kind: 'human', colorKey: 'red' }, { id: 'p-1', kind: 'bot', colorKey: 'blue', botProfile: 'easy', team: 'p-1' }], towers: [{ id: 't1', archetype: 'small', pos: { x: -40.125, y: 0.001 }, owner: 'p1', garrison: 10 }, { id: 't-1', archetype: 'standard', pos: { x: 40, y: -2.125 }, owner: 'p-1', garrison: 15 }, { id: 'neutral', archetype: 'small', pos: { x: 0, y: 10 }, owner: null, garrison: 5 }], obstacles: [], mapObjects: [], overrides: { globals: { timeLimitSec: 120 }, troops: { regular: { speed: 12.375 } }, archetypes: { small: { components: { generates: { ratePerSec: 0.875 } } } } } },
  };
}
function compile(files: content.LoadedContent, id = 'sample'): content.CompiledLevel {
  assert.equal(typeof content.compileLevel, 'function', 'compiler must be exported');
  return content.compileLevel(files, id);
}

// Removing override resolution, sorting, owner mapping, inheritance or milli-unit
// preservation changes these hand-derived sim inputs.
test('golden sample compiles to dense sorted integer inputs with resolved bots and presentation keys', () => {
  const loaded = content.loadContent(fixture());
  const before = structuredClone(loaded);
  const level = compile(loaded);
  const { simHash, botHash, ...inputs } = level;
  assert.match(simHash, /^[a-f0-9]{64}$/);
  assert.match(botHash.easy ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual(inputs, {
    componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'], id: 'sample', timeLimitSec: 120, visual: 'city', bounds: { w: 120000, h: 80000 },
    globals: { timeLimitSec: 120, theme: 'city' },
    players: [{ id: 'p-1', kind: 'bot', colorKey: 'blue', team: 'p-1' }, { id: 'p1', kind: 'human', colorKey: 'red', team: 'p1' }],
    towers: [
      { id: 'neutral', archetype: 'small', x: 0, y: 10000, owner: -1, garrison: 5, visual: 'tower.small', footprintRadius: 2125, components: { garrison: { cap: 20 }, generates: { troop: 1, ratePerSec: 875 }, drawsLines: { extraSlotAbove: [10] }, capturable: {} } },
      { id: 't-1', archetype: 'standard', x: 40000, y: -2125, owner: 0, garrison: 15, visual: 'tower', footprintRadius: 3000, components: { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: 1125 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} } },
      { id: 't1', archetype: 'small', x: -40125, y: 1, owner: 1, garrison: 10, visual: 'tower.small', footprintRadius: 2125, components: { garrison: { cap: 20 }, generates: { troop: 1, ratePerSec: 875 }, drawsLines: { extraSlotAbove: [10] }, capturable: {} } },
    ],
    kinds: [{ id: 'a-regular', value: 1, speedMilli: 8000, visual: 'scout' }, { id: 'regular', value: 1, speedMilli: 12375, visual: 'soldier' }],
    bots: [{ player: 0, profile: { id: 'easy', kind: 'utility', params: { skill: { decisionIntervalSec: 2125, noise: 300, actionsPerDecision: 1 }, bias: { attack: 1125 }, weights: { attack: { targetValue: 9250 } } } } }],
  });
  assert.deepEqual(loaded, before);
  level.towers[0]!.components.drawsLines!.extraSlotAbove!.push(99);
  level.bots[0]!.profile.params.skill!.noise = 0;
  level.bounds.w = 0;
  assert.deepEqual(loaded, before);
  assert.equal(level.towers[2]!.components.drawsLines!.extraSlotAbove!.length, 1);
});

// An explicit limit/theme must win over defaults, while other levels remain isolated.
test('level values win over defaults and compiling another level cannot retain overrides', () => {
  const files = fixture();
  const level = files['level.json'] as content.Level;
  files['explicit.json'] = { ...structuredClone(level), id: 'explicit', timeLimitSec: 15, visual: 'night', overrides: {} };
  const loaded = content.loadContent(files);
  const explicit = compile(loaded, 'explicit');
  assert.equal(explicit.timeLimitSec, 15);
  assert.equal(explicit.visual, 'night');
  assert.equal(explicit.globals.timeLimitSec, 300);
  assert.equal(explicit.kinds[1]!.speedMilli, 10125);
  assert.equal(explicit.towers[0]!.components.generates!.ratePerSec, 625);
  assert.equal(compile(loaded).kinds[1]!.speedMilli, 12375);
  const defaults = { ...level, id: 'default', overrides: {} };
  assert.equal(compile(content.loadContent({ ...files, 'default.json': defaults }), 'default').timeLimitSec, 300);
});

// Source order must never select simulation indices, even when input arrays reverse.
test('source path and array order cannot change compiled indices or resolved profile content', () => {
  const files = fixture();
  const level = files['level.json'] as content.Level;
  level.players.reverse(); level.towers.reverse();
  const reversed = Object.fromEntries(Object.entries(files).reverse());
  assert.deepEqual(compile(content.loadContent(reversed)), compile(content.loadContent(fixture())));
});

test('unknown level ids produce a located content error instead of another level', () => {
  const loaded = content.loadContent(fixture());
  assert.throws(() => compile(loaded, 'missing'), (error: unknown) => error instanceof content.ContentLoadError && error.errors.some(issue => issue.pointer === '/id' && issue.message.includes('Unknown level')));
});

test('compiled metadata carries the actual content component registry names', () => {
  assert.deepEqual(compile(content.loadContent(fixture())).componentNames, Object.keys(content.COMPONENT_REGISTRY.components).sort());
});

for (const location of ['default', 'explicit', 'override'] as const) {
  const pointer = location === 'default' ? '/defaults/timeLimitSec' : location === 'explicit' ? '/timeLimitSec' : '/overrides/globals/timeLimitSec';
  function durationFiles(seconds: number) {
    const files = fixture();
    const level = files['level.json'] as content.Level;
    level.overrides = {};
    if (location === 'default') (files['balance.json'] as content.Balance).defaults.timeLimitSec = seconds;
    else if (location === 'explicit') level.timeLimitSec = seconds;
    else level.overrides = { globals: { timeLimitSec: seconds } };
    return files;
  }
  test(`${location} duration accepts the int32 tick boundary and rejects the next second with location`, () => {
    assert.equal(compile(content.loadContent(durationFiles(107374182))).timeLimitSec, 107374182);
    const files = durationFiles(107374183);
    const result = content.validateContent(files);
    assert.ok(result.errors.some(issue => issue.pointer === pointer));
    assert.throws(() => content.loadContent(files), (error: unknown) => error instanceof content.ContentLoadError && error.errors.some(issue => issue.file === (location === 'default' ? 'balance.json' : 'level.json') && issue.pointer === pointer));
  });
  test(`compiler rejects ${location} duration mutation beyond validated tick bounds`, () => {
    const loaded = content.loadContent(durationFiles(107374182));
    if (location === 'default') (loaded['balance.json'] as content.Balance).defaults.timeLimitSec = 107374183;
    else if (location === 'explicit') (loaded['level.json'] as content.Level).timeLimitSec = 107374183;
    else (loaded['level.json'] as content.Level).overrides.globals!.timeLimitSec = 107374183;
    assert.throws(() => compile(loaded), (error: unknown) => error instanceof content.ContentLoadError && error.errors.some(issue => issue.file === (location === 'default' ? 'balance.json' : 'level.json') && issue.pointer === pointer));
  });
}
