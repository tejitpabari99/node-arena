import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as content from '../src/index.js';

const envelope = (name: string) => ({ $schema: `../../schemas/${name}.schema.json`, schemaVersion: '1.0.0' });
const skill = { decisionIntervalSec: 1.5, noise: 0.1, actionsPerDecision: 2 };
const utility = { ...envelope('bot'), id: 'rusher', kind: 'utility', params: { skill, bias: { attack: 1 }, weights: { attack: { targetValue: 10 } } } };
const tier = { ...envelope('bot'), id: 'rusher-easy', kind: 'utility', params: { extends: 'rusher', skill: { ...skill, noise: 0.35 } } };
const manifest = {
  ...envelope('manifest'), palettes: { default: { 'player.1': '#ff0000', neutral: '#808080' }, colorblind: { 'player.1': '#0000ff', neutral: '#808080' } },
  teamMarkers: { 'player.1': 'circle', neutral: 'square' },
  models: { office: { src: 'models/office.glb' }, walker: { primitive: 'capsule', size: [1, 2, 1] } },
  visuals: { 'tower.standard': { kind: 'tower', model: 'office', scale: 1, yOffset: 0, teamMaterial: 'Accent', label: { height: 4.2 } }, 'troop.regular': { kind: 'troop', model: 'walker', scale: 0.6, yOffset: 0, anim: { type: 'bob', hz: 2.2, amp: 0.12, sway: 6 } } },
  themes: { 'theme.downtown': { ground: '#aaaaaa', sky: '#ffffff', light: { dir: [1, 2, 3], color: '#ffffff', intensity: 1 }, fog: { color: '#ffffff', near: 10, far: 100 }, props: [{ model: 'office', pos: [1, 0, 3], scale: 1 }] } },
  events: { Captured: { sfx: 'audio/capture.ogg', fx: 'capture' } }, camera: { pitchDeg: 45, fov: 50, margin: 10 },
};
async function validator(name: string) {
  const source = await readFile(new URL(`../schemas/${name}.schema.json`, import.meta.url), 'utf8').catch(() => '{}');
  return content.createAjv().compile(JSON.parse(source));
}

// Missing envelope/closed schemas would let malformed content enter downstream consumers.
for (const [name, sample] of [['bot', utility], ['manifest', manifest]] as const) {
  test(`${name} generated schema validates its contract and rejects extra or missing envelope fields`, async () => {
    const validate = await validator(name);
    assert.equal(validate(sample), true, JSON.stringify(validate.errors));
    for (const patch of [{ junk: true }, { schemaVersion: '2.0.0' }, { schemaVersion: undefined }, { $schema: undefined }]) assert.equal(validate({ ...sample, ...patch }), false);
  });
}

test('bot tiers accept params.extends and only skill changes, and every profile requires kind', async () => {
  const validate = await validator('bot');
  assert.equal(validate(tier), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...tier, kind: undefined }), false);
  assert.equal(validate({ ...envelope('bot'), id: 'idle', kind: 'idle', params: {} }), true);
  for (const bad of [
    { ...utility, kind: undefined }, { ...utility, kind: 'scripted' }, { ...utility, extends: 'rusher' },
    { ...tier, params: { ...tier.params, bias: { attack: 1 } } },
    { ...tier, params: { ...tier.params, weights: { attack: { targetValue: 1 } } } },
    { ...tier, params: { ...tier.params, skill: { ...skill, surprise: 1 } } },
    { ...utility, params: { skill, unknown: 1 } }, { ...utility, kind: 'idle' },
  ]) assert.equal(validate(bad), false, JSON.stringify(bad));
});

test('bot schema rejects invalid skill bounds, nonintegral counts and weights above 10000 milli', async () => {
  const validate = await validator('bot');
  for (const patch of [{ decisionIntervalSec: 0 }, { noise: -0.001 }, { noise: 1.001 }, { actionsPerDecision: 0 }, { actionsPerDecision: 1.5 }]) assert.equal(validate({ ...utility, params: { ...utility.params, skill: { ...skill, ...patch } } }), false);
  for (const params of [
    { ...utility.params, weights: { attack: { targetValue: 10.001 } } },
    { ...utility.params, weights: { attack: { unknown: 1 } } },
    { ...utility.params, bias: { attack: 10.001 } },
  ]) assert.equal(validate({ ...utility, params }), false);
});

// Missing catalog dispatch or numeric annotations would leave bot floats uncompiled.
test('loader recognizes bot bases and tiers and converts skill and bounded weights to milli', () => {
  const loaded = content.loadContent({ 'rusher.json': utility, 'easy.json': tier });
  assert.deepEqual(loaded['rusher.json'], { ...utility, params: { skill: { decisionIntervalSec: 1500, noise: 100, actionsPerDecision: 2 }, bias: { attack: 1000 }, weights: { attack: { targetValue: 10000 } } } });
  assert.deepEqual(loaded['easy.json'], { ...tier, params: { extends: 'rusher', skill: { decisionIntervalSec: 1500, noise: 350, actionsPerDecision: 2 } } });
  assert.throws(() => content.loadContent({ 'bad.json': { ...utility, params: { ...utility.params, skill: { ...skill, noise: 0.0001 } } } }), /\/params\/skill\/noise/);
});

test('manifest rejects invalid palettes, models, animation kinds and unknown nested fields', async () => {
  const validate = await validator('manifest');
  for (const patch of [
    { palettes: { ...manifest.palettes, default: { neutral: 'red' } } },
    { models: { broken: { src: 'x.glb', primitive: 'box', size: [1, 1, 1] } } },
    { models: { broken: { primitive: 'sphere', size: [1, 1, 1] } } },
    { models: { broken: { primitive: 'box', size: [1, 1] } } },
    { visuals: { a: { kind: 'tower', model: 'office', scale: 1, anim: { type: 'vat' } } } },
    { themes: { a: { ...manifest.themes['theme.downtown'], light: { dir: [1, 2, 3], color: '#ffffff', intensity: 1, junk: 1 } } } },
    { camera: { ...manifest.camera, junk: true } },
  ]) assert.equal(validate({ ...manifest, ...patch }), false, JSON.stringify(patch));
});

test('hosted TypeBox contracts and plain schema exports support browser validation', () => {
  const exports = content as unknown as Record<string, unknown>;
  for (const name of ['Bot', 'Manifest']) {
    assert.ok(exports[`${name}Schema`]);
    const plain = exports[`${name}JsonSchema`];
    assert.ok(plain);
    assert.equal(content.createAjv().compile(plain as object)(name === 'Bot' ? utility : manifest), true);
  }
});
