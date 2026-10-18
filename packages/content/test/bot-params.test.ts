import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { BotSchema, COMPONENT_REGISTRY, ContentLoadError, createAjv, loadContent, resolveProfiles, validateContent } from '../src/index.js';

const considerations = ['targetValue', 'timeToTake', 'distance', 'threatToSource', 'threatToTarget', 'targetWeakness', 'ownerDominance', 'sliceCost', 'lineUseless', 'stickiness'];
const skill = { decisionIntervalSec: 1.5, noise: 0.1, actionsPerDecision: 2 };
const profile = (params: object) => ({ $schema: 'bot.schema.json', schemaVersion: '1.0.0', id: 'rusher', kind: 'utility', params: { skill, ...params } });
const full = {
  skill, bias: { attack: 1, reinforce: 0.4, cut: 0.5 }, holdThreshold: 0.3,
  maxTargetsPerSource: 6, cooldownSec: 4.125,
  componentValue: { generates: 1, garrison: 0.3 },
  weights: { attack: { targetValue: 3, timeToTake: 2, distance: 2, targetWeakness: 2, threatToSource: 1 }, reinforce: { threatToTarget: 3, targetValue: 1 }, cut: { lineUseless: 3, threatToSource: 1 } },
};
function located(params: object, pointer: string) {
  assert.throws(() => loadContent({ 'bad.json': profile(params) }), (error: unknown) => {
    assert.ok(error instanceof ContentLoadError);
    assert.ok(error.errors.some(issue => issue.file === 'bad.json' && issue.pointer === pointer), JSON.stringify(error.errors));
    return true;
  });
}

// Missing fields or annotations reject a personality or leave fractions in compiled inputs.
test('full utility profiles load all action fields in milli-units while counts stay integral', () => {
  const loaded = loadContent({ 'rusher.json': profile(full) });
  assert.deepEqual(loaded['rusher.json'], profile({
    skill: { decisionIntervalSec: 1500, noise: 100, actionsPerDecision: 2 },
    bias: { attack: 1000, reinforce: 400, cut: 500 }, holdThreshold: 300,
    maxTargetsPerSource: 6, cooldownSec: 4125, componentValue: { generates: 1000, garrison: 300 },
    weights: { attack: { targetValue: 3000, timeToTake: 2000, distance: 2000, targetWeakness: 2000, threatToSource: 1000 }, reinforce: { threatToTarget: 3000, targetValue: 1000 }, cut: { lineUseless: 3000, threatToSource: 1000 } },
  }));
  assert.deepEqual(full.skill, skill);
});

test('maximum consideration weights keep each loaded scoring numerator below int32', () => {
  const weights = Object.fromEntries(considerations.map(key => [key, 10]));
  const source = profile({ weights: { attack: weights, reinforce: weights, cut: weights }, componentValue: Object.fromEntries(Object.keys(COMPONENT_REGISTRY.components).map(key => [key, 10])) });
  const loaded = loadContent({ 'max.json': source });
  const entity = loaded['max.json'];
  assert.ok(entity && 'params' in entity);
  for (const values of Object.values(entity.params.weights!)) {
    assert.equal(Object.values(values).reduce((sum, value) => sum + value!, 0) * 1000, 100000000);
  }
});

test('utility params reject unknown keys with source locations', () => {
  for (const [params, pointer] of [
    [{ weights: { reinforce: { mystery: 1 } } }, '/params/weights/reinforce/mystery'],
    [{ componentValue: { shoots: 1 } }, '/params/componentValue/shoots'],
    [{ weights: { hold: {} } }, '/params/weights/hold'],
    [{ bias: { hold: 1 } }, '/params/bias/hold'],
    [{ unknown: 1 }, '/params/unknown'],
  ] as const) located(params, pointer);
});

test('new fractional params reject excessive precision and invalid bounds at their fields', () => {
  for (const [params, pointer] of [
    [{ holdThreshold: 0.0001 }, '/params/holdThreshold'], [{ cooldownSec: 1.0001 }, '/params/cooldownSec'],
    [{ componentValue: { garrison: 0.0001 } }, '/params/componentValue/garrison'],
    [{ weights: { cut: { stickiness: 0.0001 } } }, '/params/weights/cut/stickiness'],
    [{ weights: { reinforce: { threatToTarget: 10.001 } } }, '/params/weights/reinforce/threatToTarget'],
    [{ componentValue: { generates: 10.001 } }, '/params/componentValue/generates'],
    [{ bias: { cut: 10.001 } }, '/params/bias/cut'],
    [{ holdThreshold: -0.001 }, '/params/holdThreshold'], [{ holdThreshold: 1.001 }, '/params/holdThreshold'],
    [{ cooldownSec: -1 }, '/params/cooldownSec'], [{ cooldownSec: 2147483.648 }, '/params/cooldownSec'],
    [{ maxTargetsPerSource: 0 }, '/params/maxTargetsPerSource'], [{ maxTargetsPerSource: 1.5 }, '/params/maxTargetsPerSource'],
    [{ maxTargetsPerSource: 2147483648 }, '/params/maxTargetsPerSource'],
  ] as const) located(params, pointer);
});

test('every new personality field is forbidden in skill-only tiers by schemas and semantics', () => {
  const base = profile(full);
  for (const key of ['bias', 'holdThreshold', 'maxTargetsPerSource', 'cooldownSec', 'componentValue', 'weights'] as const) {
    const tier = { ...profile({ extends: 'rusher', skill, [key]: full[key] }), id: 'rusher-easy' };
    assert.ok(validateContent({ 'base.json': base, 'tier.json': tier }).errors.some(issue => issue.file === 'tier.json' && issue.pointer === `/params/${key}`));
    // The loaded semantic boundary must also defend direct callers, without relying on Ajv.
    const loaded = loadContent({ 'base.json': base, 'tier.json': { ...tier, params: { extends: 'rusher', skill } } });
    const entity = loaded['tier.json'];
    assert.ok(entity && 'params' in entity);
    Object.assign(entity.params, { [key]: full[key] });
    assert.throws(() => resolveProfiles(loaded), (error: unknown) => error instanceof ContentLoadError && error.errors.some(issue => issue.file === 'tier.json' && issue.pointer === `/params/${key}`));
  }
  const loaded = loadContent({ 'base.json': base, 'tier.json': { ...profile({ extends: 'rusher', skill: { ...skill, noise: 0.35 } }), id: 'rusher-easy' } });
  const resolved = resolveProfiles(loaded)['tier.json']!;
  assert.equal(resolved.params.holdThreshold, 300);
  assert.equal(resolved.params.skill?.noise, 350);
});

// SP02 R7: commitment is base-profile data in fx3 units; variants inherit it and may not set it.
const commitment = { minLineLifetimeSec: 8, dangerOverride: 0.7, cutMargin: 0.15, redrawBlockSec: 10, tieHysteresis: 0.05, slotGuardMargin: 3, slotPreemptMargin: 1 };
test('commitment block loads every field in fx3 milli-units and is optional', () => {
  const loaded = loadContent({ 'rusher.json': profile({ ...full, commitment }) });
  const entity = loaded['rusher.json'];
  assert.ok(entity && 'params' in entity);
  assert.deepEqual(entity.params.commitment, { minLineLifetimeSec: 8000, dangerOverride: 700, cutMargin: 150, redrawBlockSec: 10000, tieHysteresis: 50, slotGuardMargin: 3000, slotPreemptMargin: 1000 });
  const without = loadContent({ 'rusher.json': profile(full) })['rusher.json'];
  assert.ok(without && 'params' in without);
  assert.equal(Object.hasOwn(without.params, 'commitment'), false);
});

test('commitment rejects unknown, missing, out-of-range and over-precise fields at their pointers', () => {
  for (const [value, pointer] of [
    [{ ...commitment, mystery: 1 }, '/params/commitment/mystery'],
    [{ ...commitment, minLineLifetimeSec: -1 }, '/params/commitment/minLineLifetimeSec'],
    [{ ...commitment, minLineLifetimeSec: 2147483.648 }, '/params/commitment/minLineLifetimeSec'],
    [{ ...commitment, dangerOverride: 1.001 }, '/params/commitment/dangerOverride'],
    [{ ...commitment, cutMargin: -0.001 }, '/params/commitment/cutMargin'],
    [{ ...commitment, cutMargin: 1.001 }, '/params/commitment/cutMargin'],
    [{ ...commitment, redrawBlockSec: 10.0001 }, '/params/commitment/redrawBlockSec'],
    [{ ...commitment, tieHysteresis: 1.001 }, '/params/commitment/tieHysteresis'],
    [{ ...commitment, slotGuardMargin: -1 }, '/params/commitment/slotGuardMargin'],
    [{ ...commitment, slotPreemptMargin: -0.001 }, '/params/commitment/slotPreemptMargin'],
  ] as const) located({ commitment: value }, pointer);
  const { cutMargin: _omitted, ...missing } = commitment;
  assert.throws(() => loadContent({ 'bad.json': profile({ commitment: missing }) }), ContentLoadError);
});

test('variants carrying commitment are rejected by schema and semantic resolution; tiers inherit it', () => {
  const base = profile({ ...full, commitment });
  const tier = { ...profile({ extends: 'rusher', skill, commitment }), id: 'rusher-easy' };
  assert.ok(validateContent({ 'base.json': base, 'tier.json': tier }).errors.some(issue => issue.file === 'tier.json' && issue.pointer === '/params/commitment'));
  const loaded = loadContent({ 'base.json': base, 'tier.json': { ...tier, params: { extends: 'rusher', skill } } });
  const entity = loaded['tier.json'];
  assert.ok(entity && 'params' in entity);
  assert.equal(resolveProfiles(loaded)['tier.json']!.params.commitment?.cutMargin, 150);
  Object.assign(entity.params, { commitment });
  assert.throws(() => resolveProfiles(loaded), (error: unknown) => error instanceof ContentLoadError && error.errors.some(issue => issue.file === 'tier.json' && issue.pointer === '/params/commitment'));
});

test('editor schema and runtime schema agree on full profiles and tier restrictions', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/bot.schema.json', import.meta.url), 'utf8'));
  for (const contract of [BotSchema, schema]) {
    const validate = createAjv().compile(contract);
    assert.equal(validate(profile(full)), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...profile({ extends: 'rusher', skill, cooldownSec: 4 }), id: 'rusher-easy' }), false);
    assert.equal(validate(profile({ ...full, commitment })), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...profile({ extends: 'rusher', skill, commitment }), id: 'rusher-easy' }), false);
  }
});
