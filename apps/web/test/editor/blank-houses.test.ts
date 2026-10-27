import { beforeAll, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { compileLevel, convertAuthored, computeRequires, loadCatalog, type Catalog } from '@node-arena/content';
import { loadFiles } from '../../../../tools/src/files.js';
import { validateEditorDocument, assertPlayersHaveHouses } from '../../../../tools/src/editor-validation.js';
import { blankDocument, type SizePreset } from '../../src/editor/document.js';
import { BASE_HOUSE, isHouseArchetype, spawnsTroops } from '../../src/editor/houses.js';
import { combineIssues, ownershipIssues } from '../../src/editor/ownership.js';
import { formatIssue } from '../../src/editor/check-format.js';
import { reduceDocument } from '../../src/editor/model.js';

let catalog: Catalog;
beforeAll(async () => { const { 'content.json': _meta, ...files } = await loadFiles(resolve('../../packages/content')); catalog = loadCatalog(files); });

const troops = () => new Set(Object.values(catalog.buildings).filter(spawnsTroops).map(b => b.id));

describe('blank document base houses', () => {
  it('uses a real house archetype', () => { expect(isHouseArchetype(catalog.buildings[BASE_HOUSE])).toBe(true); expect(isHouseArchetype(catalog.buildings['tower'])).toBe(false); });
  it('places one house per player inside bounds, separated, over many random seeds', () => {
    for (const size of ['small', 'medium', 'large'] as SizePreset[]) for (let i = 0; i < 200; i++) {
      const doc = blankDocument('na-houses', 'green', size), [a, b] = doc.buildings;
      expect(doc.buildings).toHaveLength(2); expect(doc.elements).toEqual([]);
      expect([a!.owner, b!.owner]).toEqual(['p1', 'p2']); expect(a!.archetype).toBe(BASE_HOUSE); expect(b!.archetype).toBe(BASE_HOUSE);
      for (const h of [a!, b!]) {
        expect(h.pos.x).toBeGreaterThanOrEqual(doc.bounds.minX + 2); expect(h.pos.x).toBeLessThanOrEqual(doc.bounds.maxX - 2);
        expect(h.pos.z).toBeGreaterThanOrEqual(doc.bounds.minZ + 2); expect(h.pos.z).toBeLessThanOrEqual(doc.bounds.maxZ - 2);
      }
      expect(Math.hypot(a!.pos.x - b!.pos.x, a!.pos.z - b!.pos.z)).toBeGreaterThanOrEqual(3);
      expect(ownershipIssues(doc, troops())).toEqual([]);
      expect(() => validateEditorDocument(catalog, doc, doc.id)).not.toThrow();
    }
  });
  it('accepts an injected random source', () => {
    const lo = blankDocument('na-houses', 'green', 'medium', () => 0), hi = blankDocument('na-houses', 'green', 'medium', () => 1);
    expect(lo.buildings.map(b => b.pos)).toEqual([{ x: -8, z: -8 }, { x: 1.5, z: -8 }]);
    expect(hi.buildings.map(b => b.pos)).toEqual([{ x: -1.5, z: 8 }, { x: 8, z: 8 }]);
  });
});

describe('ownership issues', () => {
  it('flags every player without a building by display name, none duplicated', () => {
    const doc = blankDocument('na-own', 'green', 'small');
    doc.players.push({ id: 'p3', kind: 'ai', colorKey: 'green', bot: { kind: 'tw', actionDelayMs: 4000, behavior: 'full', script: [] } } as never);
    expect(ownershipIssues(doc, troops()).map(i => i.message)).toEqual(['AI2 has no troop building — add a house and set its owner to AI2']);
    doc.buildings = [];
    expect(ownershipIssues(doc, troops()).map(i => i.message)).toEqual([
      'Human has no troop building — add a house and set its owner to Human', 'AI1 has no troop building — add a house and set its owner to AI1', 'AI2 has no troop building — add a house and set its owner to AI2']);
  });
  it('only troop-generating buildings count; towers do not', () => {
    expect([...troops()].sort()).toEqual(['house-wt1', 'house-wt2']);
    expect(spawnsTroops(catalog.buildings['tower'])).toBe(false);
    const doc = blankDocument('na-own', 'green', 'small');
    doc.buildings[1]!.archetype = 'tower';
    expect(ownershipIssues(doc, troops()).map(i => i.message)).toEqual(['AI1 has no troop building — add a house and set its owner to AI1']);
    doc.buildings[1]!.archetype = 'house-wt2';
    expect(ownershipIssues(doc, troops())).toEqual([]);
  });
  it('reassigning or deleting a house is allowed and surfaces the issue; formatting is plain', () => {
    let doc = blankDocument('na-own', 'green', 'small');
    doc = reduceDocument(doc, { type: 'building-properties', id: 'b1', value: { owner: 'p1' } });
    const issues = ownershipIssues(doc, troops());
    expect(issues).toHaveLength(1);
    expect(formatIssue(issues[0]!, 'players p2 (/players/1)').text).toBe('AI1 has no troop building — add a house and set its owner to AI1');
  });
  it('replaces the generic zero-building message with per-player ones', () => {
    const doc = { ...blankDocument('na-own', 'green', 'small'), buildings: [] };
    let thrown: { errors: { pointer: string; message: string }[] } | undefined;
    try { validateEditorDocument(catalog, doc, doc.id); } catch (e) { thrown = e as never; }
    const shown = combineIssues(thrown!.errors as never, ownershipIssues(doc, troops()));
    expect(shown.map(i => i.message)).toEqual(ownershipIssues(doc, troops()).map(i => i.message));
  });
  it('Check still rejects a player without a house', () => {
    const doc = blankDocument('na-own', 'green', 'small'); doc.buildings.pop();
    expect(() => assertPlayersHaveHouses(catalog, doc)).toThrow();
  });
});

describe('preview of a draft without buildings', () => {
  it('converts and compiles ground plus elements (decimal pos/yaw/footprint)', () => {
    const doc = { ...blankDocument('na-empty', 'green', 'small'), buildings: [], elements: [{ id: 'e0', archetype: 'obstacle', variant: 'small', pos: { x: 1.25, z: -2.5 }, yawDeg: 33.5, footprint: { shape: 'box', w: 3.565, d: .713 } }] } as ReturnType<typeof blankDocument>;
    const authored = { ...doc, requires: computeRequires(catalog, doc) };
    const level = convertAuthored<Parameters<typeof compileLevel>[1]>('data/levels/na-empty.json', authored, 'level');
    const compiled = compileLevel(catalog, level);
    expect(compiled.buildings).toHaveLength(0); expect(compiled.elements).toHaveLength(1);
    // map with a deleted last house renders the same way
    const withHouse = blankDocument('na-empty', 'green', 'small');
    const deleted = reduceDocument(reduceDocument(withHouse, { type: 'delete', target: { kind: 'building', id: 'b0' } }), { type: 'delete', target: { kind: 'building', id: 'b1' } });
    expect(deleted.buildings).toHaveLength(0);
    const again = convertAuthored<Parameters<typeof compileLevel>[1]>('x', { ...deleted, requires: [] }, 'level');
    expect(compileLevel(catalog, again).buildings).toHaveLength(0);
  });
});
