import { beforeAll, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { loadCatalog, type Catalog } from '@node-arena/content';
import { loadFiles } from '../../../../tools/src/files.js';
import { blankDocument } from '../../src/editor/document.js';
import { placeCenter, reduceDocument } from '../../src/editor/model.js';

let catalog: Catalog;
beforeAll(async () => { const { 'content.json': _meta, ...files } = await loadFiles(resolve('../../packages/content')); catalog = loadCatalog(files); });
const blank = () => ({ ...blankDocument('na-center', 'green', 'medium'), buildings: [] as ReturnType<typeof blankDocument>['buildings'] });
it('uses the snapped buildable-area center for a free spot without mutating the document', () => {
  const doc = blank(); doc.bounds = { minX: 1.12, maxX: 2.12, minZ: 2.12, maxZ: 3.12 };
  expect(placeCenter(doc, 'tower', catalog)).toEqual({ type: 'place', item: 'tower', pos: { x: 1.5, z: 2.5 } });
  expect(doc.buildings).toEqual([]); expect(doc.elements).toEqual([]);
});
it('nudges repeated buildings at least 3.5 units apart with deterministic nearest-distance ties', () => {
  let doc = blank();
  doc = reduceDocument(doc, placeCenter(doc, 'tower', catalog)!);
  const second = placeCenter(doc, 'tower', catalog)!;
  expect(second.pos).toEqual({ x: 0, z: -3.5 });
  doc = reduceDocument(doc, second);
  expect(placeCenter(doc, 'tower', catalog)!.pos).toEqual({ x: 3.5, z: 0 });
  expect(doc.buildings.map(item => item.id)).toEqual(['b0', 'b1']);
});
it('finds the nearest free snap instead of the first free corner of a spiral ring', () => {
  const doc = blank();
  doc.elements = [{ id: 'circle', archetype: 'obstacle', pos: { x: 0, z: 0 }, yawDeg: 0, footprint: { shape: 'circle', radius: .5 } }];
  expect(placeCenter(doc, 'tower', catalog)!.pos).toEqual({ x: -.25, z: -.5 });
});
it('accounts for row footprints and rotation, while coincident elements always occupy their position', () => {
  const doc = blank();
  doc.elements = [{ id: 'row', archetype: 'obstacle', pos: { x: 0, z: 0 }, yawDeg: 0, footprint: { shape: 'box', w: 3.565, d: .713 } }];
  expect(placeCenter(doc, 'obstacle-small', catalog)!.pos).toEqual({ x: 0, z: -.5 });
  doc.elements[0]!.yawDeg = 90;
  expect(placeCenter(doc, 'obstacle-big', catalog)!.pos).toEqual({ x: .5, z: 0 });
  delete doc.elements[0]!.footprint;
  expect(placeCenter(doc, 'tower', catalog)!.pos).toEqual({ x: 0, z: -.5 });
});
it('stays inside the supplied area and returns null when no free snap exists', () => {
  const doc = blank(), area = { minX: 0, maxX: .5, minZ: 0, maxZ: .5 };
  doc.elements = [{ id: 'circle', archetype: 'obstacle', pos: { x: .25, z: .25 }, yawDeg: 0, footprint: { shape: 'circle', radius: .1 } }];
  expect(placeCenter(doc, 'tower', catalog, area)!.pos).toEqual({ x: .25, z: 0 });
  doc.elements[0]!.footprint = { shape: 'circle', radius: 1 };
  expect(placeCenter(doc, 'tower', catalog, area)).toBe(null);
});

it('blocks too-close placement and movement while allowing the 3.5 boundary and obstacles', () => {
  let doc = reduceDocument(blank(), { type: 'place', item: 'tower', pos: { x: 0, z: 0 } });
  expect(reduceDocument(doc, { type: 'place', item: 'tower', pos: { x: 3.49, z: 0 } })).toBe(doc);
  doc = reduceDocument(doc, { type: 'place', item: 'tower', pos: { x: 3.5, z: 0 } });
  expect(doc.buildings).toHaveLength(2);
  expect(reduceDocument(doc, { type: 'move', target: { kind: 'building', id: 'b1' }, pos: { x: 3.49, z: 0 } })).toBe(doc);
  expect(reduceDocument(doc, { type: 'move-selection', targets: [{ kind: 'building', id: 'b1' }], delta: { x: -.25, z: 0 } })).toBe(doc);
  expect(reduceDocument(doc, { type: 'place', item: 'obstacle-small', pos: { x: 0, z: 0 } }).elements).toHaveLength(1);
});
