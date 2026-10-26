import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { compileLevel, computeRequires, loadCatalog, loadLevel } from '@node-arena/content';
import { create } from '@node-arena/sim';
import { loadFiles } from '../../../../tools/src/files.js';
import { blankDocument } from '../../src/editor/document.js';
import { reduceDocument } from '../../src/editor/model.js';

it('covers R-OBS-01: an authored rotated three-tile row blocks a line and deleting its one element clears it', async () => {
  const { 'content.json': _meta, ...files } = await loadFiles(resolve('../../packages/content'));
  const catalog = loadCatalog(files);
  const base = blankDocument('na-row-collider', 'green', 'medium');
  base.buildings = [
    { id: 'human', archetype: 'house-wt1', pos: { x: -4, z: 0 }, owner: 'p1', level: 10, ignoreForWin: false },
    { id: 'ai', archetype: 'house-wt1', pos: { x: 4, z: 0 }, owner: 'p2', level: 10, ignoreForWin: false },
  ];
  let doc = reduceDocument(base, { type: 'place', item: 'obstacle-small', pos: { x: 0, z: 1 } });
  const id = doc.elements[0]!.id;
  const compile = (level: typeof doc) => compileLevel(catalog, loadLevel(catalog, { ...level, requires: computeRequires(catalog, level) }).level);
  expect(create(compile(doc), 1).canDraw(0, 0, 1)).toBe(null);
  doc = reduceDocument(doc, { type: 'obstacle-properties', id, value: { yawDeg: 45, footprint: { shape: 'box', w: 2.139, d: .713 } } });
  const compiled = compile(doc);
  expect(compiled.elements).toHaveLength(1); expect(compiled.elements[0]!.footprint).toEqual({ shape: 'box', w: 2139, d: 713 });
  expect(create(compiled, 1).canDraw(0, 0, 1)).toBe('blocked-obstacle');
  const deleted = reduceDocument(doc, { type: 'delete', target: { kind: 'obstacle', id } });
  expect(create(compile(deleted), 1).canDraw(0, 0, 1)).toBe(null);
});
