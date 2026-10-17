import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { BOT_ACTIONS, BOT_CONSIDERATIONS, compileLevel, generateHashes, loadContent, validateContent, type BotProfile, type ContentFileMap, type Level } from '../src/index.js';

const personalities = ['rusher', 'turtle', 'economist', 'opportunist'];
const tiers = { easy: [3500, 350, 1], normal: [2200, 200, 1], hard: [1400, 100, 2], expert: [800, 30, 2] };
function corpus(): ContentFileMap {
  const files: ContentFileMap = { 'content.json': readFileSync(new URL('../content.json', import.meta.url), 'utf8') };
  function visit(path: string) {
    for (const entry of readdirSync(new URL(`../${path}`, import.meta.url), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else if (child.endsWith('.json')) files[child] = readFileSync(new URL(`../${child}`, import.meta.url), 'utf8');
    }
  }
  visit('data'); return files;
}
const pathFor = (id: string) => `data/bots/${id}.json`;

// Missing data, an accidental extra profile, or incomplete params must break this corpus contract.
test('named production bot corpus contains 23 distinct complete profiles and preserves the sample', () => {
  const files = corpus();
  const expected = [...personalities, ...personalities.flatMap(p => Object.keys(tiers).map(t => `${p}-${t}`)), 'reference', 'human-proxy', 'idle'].sort();
  assert.deepEqual(Object.keys(files).filter(p => p.startsWith('data/bots/')).map(p => p.slice(10, -5)).sort(), expected);
  assert.deepEqual(validateContent(files).errors, []);
  const loaded = loadContent(files);
  for (const id of [...personalities, 'reference']) {
    const params = (loaded[pathFor(id)] as BotProfile).params;
    for (const field of ['skill', 'bias', 'holdThreshold', 'maxTargetsPerSource', 'cooldownSec', 'componentValue', 'weights']) assert.ok(Object.hasOwn(params, field), `${id}: ${field}`);
    for (const action of BOT_ACTIONS) assert.deepEqual(Object.keys(params.weights![action]!).sort(), [...BOT_CONSIDERATIONS].sort());
  }
  const params = Object.fromEntries(personalities.map(id => [id, (loaded[pathFor(id)] as BotProfile).params]));
  assert.ok(params.rusher!.bias!.attack! > params.rusher!.bias!.reinforce!);
  assert.ok(params.rusher!.skill!.decisionIntervalSec < params.turtle!.skill!.decisionIntervalSec);
  assert.ok(params.turtle!.bias!.reinforce! > params.turtle!.bias!.attack!);
  assert.ok(params.turtle!.weights!.attack!.threatToSource! > params.rusher!.weights!.attack!.threatToSource!);
  assert.ok(params.economist!.weights!.attack!.targetValue! > params.rusher!.weights!.attack!.targetValue!);
  assert.ok(params.economist!.componentValue!.generates! > params.economist!.componentValue!.garrison!);
  assert.ok(params.opportunist!.weights!.attack!.targetWeakness! > params.rusher!.weights!.attack!.targetWeakness!);
  assert.ok(params.opportunist!.weights!.attack!.ownerDominance! > params.rusher!.weights!.attack!.ownerDominance!);
  // Campaign levels reference named bot profiles, so only the self-contained sample level is compared without bots.
  const without = Object.fromEntries(Object.entries(files).filter(([p]) => !p.startsWith('data/bots/') && !/^data\/levels\/\d{2}-/.test(p)));
  assert.equal(generateHashes(loaded).levels['sample'], generateHashes(loadContent(without)).levels['sample']);
  assert.equal(compileLevel(loaded, 'sample').bots[0]!.profile.id, 'sample-bot');
});

// A tier changing personality, authored units leaking through, or losing inherited values breaks compilation.
test('all sixteen three-line tiers compile inherited personality with exact skill bands; idle remains legal', () => {
  const files = corpus();
  const base = loadContent(files);
  for (const personality of personalities) for (const [tier, [interval, noise, actions]] of Object.entries(tiers)) {
    const id = `${personality}-${tier}`;
    const raw = files[pathFor(id)] as string;
    assert.equal(raw.trimEnd().split('\n').length, 3);
    assert.deepEqual(Object.keys((JSON.parse(raw) as BotProfile).params).sort(), ['extends', 'skill']);
    const level = JSON.parse(files['data/levels/sample.json'] as string) as Level;
    level.players.find(p => p.kind === 'bot')!.botProfile = id;
    const compiled = compileLevel(loadContent({ ...files, 'data/levels/sample.json': level }), 'sample');
    const { skill: _skill, ...personalityParams } = (base[pathFor(personality)] as BotProfile).params;
    assert.deepEqual(compiled.bots[0]!.profile.params, { ...personalityParams, skill: { decisionIntervalSec: interval, noise, actionsPerDecision: actions } });
  }
  const level = JSON.parse(files['data/levels/sample.json'] as string) as Level;
  level.players.find(p => p.kind === 'bot')!.botProfile = 'idle';
  assert.equal(compileLevel(loadContent({ ...files, 'data/levels/sample.json': level }), 'sample').bots[0]!.profile.kind, 'idle');
  const reference = (base[pathFor('reference')] as BotProfile).params.skill!;
  assert.equal(reference.decisionIntervalSec, 500); assert.equal(reference.noise, 0);
  assert.ok(reference.actionsPerDecision >= 2 && reference.actionsPerDecision <= 3);
  const proxy = base[pathFor('human-proxy')] as BotProfile;
  assert.equal(proxy.params.extends, 'reference');
  assert.deepEqual(proxy.params.skill, { decisionIntervalSec: 1800, noise: 200, actionsPerDecision: 1 });
});

// Merely checking the selected id would permit a skill-only alias of the reference bot in a level.
for (const root of ['reference', 'human-proxy']) for (const alias of [false, true]) {
  test(`levels reject tooling profile ${root}${alias ? ' through an alias' : ''}`, () => {
    const files = JSON.parse(readFileSync(new URL('./fixtures/acceptance/valid-pack.json', import.meta.url), 'utf8')) as ContentFileMap;
    const envelope = { $schema: 'bot.schema.json', schemaVersion: '1.0.0' as const, kind: 'utility' as const };
    files['tool.json'] = { ...envelope, id: root, params: { skill: { decisionIntervalSec: 0.5, noise: 0, actionsPerDecision: 2 } } };
    if (alias) files['alias.json'] = { ...envelope, id: 'alias', params: { extends: root, skill: { decisionIntervalSec: 2, noise: 0.2, actionsPerDecision: 1 } } };
    const level = files['data/levels/sample.json'] as Level;
    level.players[1]!.botProfile = alias ? 'alias' : root;
    const errors = validateContent(files).errors;
    assert.ok(errors.some(e => e.pointer === '/players/1/botProfile' && e.message.includes('Tooling-only')), JSON.stringify(errors));
  });
}
