import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkConsistency, itemsForScene, loadChecklist, mergeScores, parseChecklist, resolveChecklist, scoreSheet, splitRow, stripMetricRefs } from '../visual/lib/checklist.mjs';
import { loadRefMap } from '../visual/lib/compose.mjs';
import { loadThresholds, METRIC_IDS } from '../visual/lib/metrics.mjs';
import { loadScenes } from '../visual/lib/scenes.mjs';

const ITEM_IDS = Array.from({ length: 24 }, (_, i) => `V${String(i + 1).padStart(2, '0')}`);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
type Th = ReturnType<typeof loadThresholds>;
const def = (t: Th, id: string) => { const d = t.metrics[id]; if (!d) throw new Error(`no ${id}`); return d; };
const md = fs.readFileSync(resolveChecklist(), 'utf8');

describe('CHECKLIST.md', () => {
  const cl = parseChecklist(md);
  it('has all 24 items with 4/6/8/10 anchors, scene, refs, pixel check and owner', () => {
    expect(cl.items.map(i => i.id)).toEqual(ITEM_IDS);
    for (const i of cl.items) {
      for (const k of ['item', 'refs', 'a4', 'a6', 'a8', 'a10', 'pixel', 'owner'] as const) expect(i[k], `${i.id}.${k}`).not.toBe('');
      expect(i.scenes.length, i.id).toBeGreaterThan(0);
    }
    expect(cl.items.find(i => i.id === 'V05')?.pixel).toBe('M11, M18(ii), M20');
    expect(cl.towerLook).toMatch(/^\*\*Tower look/);
    expect(md).toContain("test.fixme(true, 'SP05 baseline refresh: <reason>')");
    expect(md).toMatch(/## Probe contract/);
  });
  it('has all 20 metrics with threshold + status, the machine limits table and the colour spec', () => {
    expect(cl.metrics.map(m => m.id)).toEqual(METRIC_IDS);
    expect(cl.limits.map(m => m.id)).toEqual(METRIC_IDS);
    expect(cl.metrics.find(m => m.id === 'M12')?.metric).toContain('`|splitScreen - project(');
    expect(md).toMatch(/\| grass \| H 55-105/);
  });
  it('agrees with thresholds.json', () => {
    expect(checkConsistency(cl, loadThresholds())).toEqual([]);
    expect(checkConsistency(loadChecklist(), loadThresholds())).toEqual([]);
  });
});

describe('checkConsistency (CHECKLIST vs thresholds.json)', () => {
  const cl = parseChecklist(md), th = loadThresholds();
  it('reports an altered threshold text, status, limit, scene list or a missing metric', () => {
    const t1 = clone(th); def(t1, 'M05').threshold = '0.20-0.40';
    expect(checkConsistency(cl, t1).join('\n')).toMatch(/M05 threshold/);
    const t2 = clone(th); (def(t2, 'M02').limits as { ratio: { min: number } }).ratio.min = 0.10;
    expect(checkConsistency(cl, t2).join('\n')).toMatch(/M02 limits/);
    const t3 = clone(th); def(t3, 'M16').status = 'prov';
    expect(checkConsistency(cl, t3).join('\n')).toMatch(/M16 status/);
    const t4 = clone(th); def(t4, 'M09').scenes = ['l01'];
    expect(checkConsistency(cl, t4).join('\n')).toMatch(/M09 scenes/);
    const t5 = clone(th); delete (t5.metrics as Record<string, unknown>).M20;
    expect(checkConsistency(cl, t5).join('\n')).toMatch(/M20 .*missing in thresholds\.json/);
  });
  it('reports an altered CHECKLIST row', () => {
    const altered = md.replace('| M14 | grass share of the whole frame | pixels, class `grass` | 0.30-0.60 |', '| M14 | grass share of the whole frame | pixels, class `grass` | 0.25-0.60 |');
    expect(altered).not.toBe(md);
    expect(checkConsistency(parseChecklist(altered), th).join('\n')).toMatch(/M14 threshold/);
    const noItem = md.replace(/^\| V13 \|.*$/m, '');
    expect(checkConsistency(parseChecklist(noItem), th).join('\n')).toMatch(/V13 missing/);
  });
});

describe('splitRow / stripMetricRefs', () => {
  it('splits on unescaped pipes only', () => {
    expect(splitRow('| a | `\\|x\\|` | c |')).toEqual(['a', '`|x|`', 'c']);
  });
  it('removes metric ids from anchor text', () => {
    expect(stripMetricRefs('all of: neutral all grey; M11 passes')).toBe('all of: neutral all grey');
    expect(stripMetricRefs('floors correct (M04), white/team alternation')).toBe('floors correct, white/team alternation');
    expect(stripMetricRefs('bold fill + outline, centred in upper roof, M02 and M16 pass')).toBe('bold fill + outline, centred in upper roof');
    expect(stripMetricRefs('translucent, right width (M05)')).toBe('translucent, right width');
    expect(stripMetricRefs('count correct, legible, M19 passes')).toBe('count correct, legible');
  });
});

describe('score sheet', () => {
  const cl = parseChecklist(md), map = loadRefMap(), scenes = loadScenes() as { scenes: { id: string }[] };
  it('picks items by Scene column, ref-map items for appended scenes', () => {
    expect(itemsForScene(cl, map, 'menu').map(i => i.id)).toEqual(['V04', 'V07', 'V20', 'V22']);
    expect(itemsForScene(cl, map, 'clash').map(i => i.id)).toEqual(['V04', 'V07', 'V14', 'V15', 'V16', 'V22']);
    const appended = clone(map); appended.scenes['l01-tip'] = { refs: [{ file: 'towerwar_09.jpg', role: 'look' }], items: ['V19', 'V18'] };
    expect(itemsForScene(cl, appended, 'l01-tip').map(i => i.id)).toEqual(['V18', 'V19']);
    expect(() => itemsForScene(cl, map, 'nope')).toThrow(/nope/);
  });
  it('contains anchors, refs, composite and empty fields but no metrics, scores or code paths (grep)', () => {
    for (const { id } of scenes.scenes) {
      const sheet = scoreSheet({ checklist: cl, refMap: map, scene: id, refDir: '/refs', outDir: '/out' });
      expect(sheet, id).toContain(`/out/compare-${id}.png`);
      for (const r of map.scenes[id]?.refs ?? []) expect(sheet, id).toContain(`/refs/${r.file}`);
      for (const item of itemsForScene(cl, map, id)) {
        expect(sheet).toContain(`### ${item.id}`);
        expect(sheet).toContain(`"${item.id}": { "score": null, "differences": [] }`);
      }
      expect(sheet, id).not.toMatch(/\bM\d{2}\b/);
      expect(sheet, id).not.toMatch(/metric|threshold|pixel check|iteration|calibrat/i);
      expect(sheet, id).not.toMatch(/\.(?:mjs|ts|tsx|js|json)\b|src\/|apps\/web\/visual\//);
      expect(sheet, id).not.toMatch(/"score":\s*\d/);
    }
    const l01 = scoreSheet({ checklist: cl, refMap: map, scene: 'l01', refDir: '/refs', outDir: '/out' });
    expect(l01).toContain('**Tower look');
    expect(l01).toContain('citytakeover_01.jpg (chevrons; only for V11)');
    expect(l01).toMatch(/- \*\*8\*\*: all of: white body floors with slit.*neutral all grey\n/);
  });
});

describe('score merge', () => {
  const diffs = (n: number) => Array.from({ length: n }, (_, i) => `d${i}`);
  const self = { V01: { score: 8, differences: diffs(3) }, V02: { score: 5, differences: [] }, V03: { score: 9, differences: diffs(1) }, V04: { score: 3, differences: [] } };
  const blind = { V01: { score: 4, differences: diffs(1) }, V02: { score: 6, differences: [] }, V03: { score: 8, differences: diffs(3) }, V05: { score: 2, differences: [] } };
  it('takes the per-item min, flags |diff| >= 3, caps >=8 with <3 differences at 7', () => {
    const m = mergeScores(self, blind);
    expect(m.items.V01).toMatchObject({ self: 8, blind: 4, merged: 4, diff: 4 });
    expect(m.items.V01?.flags).toContain('diff>=3');
    expect(m.items.V02).toMatchObject({ self: 5, blind: 6, merged: 5, diff: 1, flags: [] });
    expect(m.items.V03).toMatchObject({ self: 7, selfRaw: 9, blind: 8, merged: 7 });
    expect(m.items.V03?.flags).toContain('self-capped');
    expect(m.items.V04).toMatchObject({ self: 3, blind: null, merged: null });
    expect(m.items.V04?.flags).toContain('missing-blind');
    expect(m.items.V05?.flags).toContain('missing-self');
    expect(m.flagged).toEqual(['V01']);
    expect(m.missing).toEqual(['V04', 'V05']);
  });
  it('accepts an {items:{}} wrapper and rejects bad scores', () => {
    expect(mergeScores({ items: { V01: { score: 6, differences: [] } } }, { V01: { score: 7, differences: [] } }).items.V01?.merged).toBe(6);
    expect(() => mergeScores({ V01: { score: 11, differences: [] } }, {})).toThrow(/V01/);
    expect(() => mergeScores({ V01: { score: 5, differences: 'x' } }, {})).toThrow(/V01/);
  });
});
