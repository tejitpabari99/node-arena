import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  COMPONENT_REGISTRY, ContentLoadError, compileLevel, loadContent, validateContent,
  type Archetype, type ComponentRegistry, type ContentFileMap, type Level, type Troop,
} from '../src/index.js';

function fixture<T>(file: string): T {
  return JSON.parse(readFileSync(new URL(`./fixtures/acceptance/${file}`, import.meta.url), 'utf8')) as T;
}
const valid = fixture<ContentFileMap>('valid-pack.json');
const manifest = fixture<object>('manifest.json');
interface Rejection {
  name: string;
  files: ContentFileMap;
  manifest?: object;
  expected: { file: string; pointer: string }[];
  ruleIds: string[];
}

// Removing any rejection check would admit the corresponding durable invalid pack.
// The baseline guard prevents independent invalid data from masking that regression.
test('AC4: rejection fixture baseline satisfies schema, registry, semantics and manifest', () => {
  assert.deepEqual(validateContent(valid, { manifest }), { errors: [], warnings: [] });
  assert.equal(compileLevel(loadContent(valid), 'sample').towers.length, 2);
});
for (const rejection of fixture<Rejection[]>('rejections.json')) {
  const tags = rejection.ruleIds.map(id => `covers ${id}`).join(', ');
  test(`AC4${tags ? ` (${tags})` : ''}: rejects fixture ${rejection.name}`, () => {
    const files = { ...structuredClone(valid), ...rejection.files };
    const options = { manifest: rejection.manifest ?? manifest };
    const errors = validateContent(files, options).errors;
    for (const expected of rejection.expected) {
      assert.ok(errors.some(issue => issue.file === expected.file && issue.pointer === expected.pointer), JSON.stringify(errors));
    }
    // Manifest validation is an explicit validateContent option, not a loader option.
    if (!rejection.manifest) assert.throws(() => loadContent(files), ContentLoadError);
  });
}

// Hardcoded component shapes or troop value ranges would keep rejecting these
// otherwise-valid fixtures after the injected support contract is widened.
test('AC5 (covers R-ENT-01, covers R-ENT-02): archer/tank fail only their support contract and pass a registry extension', () => {
  const archerFile = 'data/archetypes/archer.json';
  const tankFile = 'data/troops/tank.json';
  const files = {
    ...structuredClone(valid),
    [archerFile]: fixture<Archetype>('archer.json'),
    [tankFile]: fixture<Troop>('tank.json'),
  };
  const result = validateContent(files);
  const locations = [...new Set(result.errors.map(({ file, pointer }) => JSON.stringify({ file, pointer })))].map(value => JSON.parse(value) as { file: string; pointer: string });
  assert.deepEqual(locations, [
    { file: archerFile, pointer: '/components/shoots' },
    { file: tankFile, pointer: '/value' },
  ]);
  const registry: ComponentRegistry = {
    components: {
      ...COMPONENT_REGISTRY.components,
      shoots: { ruleIds: ['R-SHOOT-01'], params: {
        ratePerSec: { type: 'number', unit: 'fx3', minimum: 1, maximum: 2147483647 },
        radius: { type: 'number', unit: 'fx3', minimum: 1, maximum: 500000 },
        targeting: { type: 'string', values: ['nearestHostile', 'randomHostile'] },
      } },
    },
    troopValue: { ...COMPONENT_REGISTRY.troopValue, maximum: 2 },
  };
  assert.deepEqual(validateContent(files, { registry }), { errors: [], warnings: [] });
  const loaded = loadContent(files, { registry });
  assert.deepEqual((loaded[archerFile] as Archetype).components.shoots, { ratePerSec: 625, radius: 12125, targeting: 'nearestHostile' });
  assert.equal((loaded[tankFile] as Troop).value, 2);
  assert.deepEqual(validateContent(files), result, 'injected registry must not mutate default v1 support');
});

// Ignoring a resolved simulation parameter or hashing presentation would violate AC3.
const identities: [string, boolean, (files: ContentFileMap) => void][] = [
  ['generation rate', true, files => { (files['data/archetypes/standard.json'] as Archetype).components.generates!.ratePerSec = 1.5; }],
  ['troop speed', true, files => { (files['data/troops/regular.json'] as Troop).speed = 12.5; }],
  ['tower position', true, files => { (files['data/levels/sample.json'] as Level).towers[0]!.pos.x = -39; }],
  ['level name', false, files => { (files['data/levels/sample.json'] as Level).name = 'Other name'; }],
  ['archetype visual', false, files => { (files['data/archetypes/standard.json'] as Archetype).visual = 'other-tower'; }],
  ['troop visual', false, files => { (files['data/troops/regular.json'] as Troop).visual = 'other-soldier'; }],
  ['level visual', false, files => { (files['data/levels/sample.json'] as Level).visual = 'night'; }],
];
for (const [name, changes, edit] of identities) test(`AC3: ${name} ${changes ? 'changes' : 'preserves'} simHash`, () => {
  const baseline = compileLevel(loadContent(valid), 'sample').simHash;
  const files = structuredClone(valid);
  edit(files);
  assert.deepEqual(validateContent(files).errors, []);
  const actual = compileLevel(loadContent(files), 'sample').simHash;
  if (changes) assert.notEqual(actual, baseline);
  else assert.equal(actual, baseline);
});
