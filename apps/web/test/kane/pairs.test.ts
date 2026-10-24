import { describe, expect, it } from 'vitest';
import { loadContent, type CompiledLevel } from '@node-arena/content';
import { create } from '@node-arena/sim';
import * as pairs from '../../src/kane/pairs.js';

const raw = import.meta.glob<string>('../../../../packages/content/data/**/*.json', { eager: true, query: '?raw', import: 'default' });
const files = Object.fromEntries(Object.entries(raw).map(([path, value]) => [path.replace('../../../../packages/content/', ''), value]));
const level = loadContent(files).compiled['na-kane']!;

// Catches unstable indexing and the Z -> AA carry boundary.
describe('building letters', () => {
  it.each([[0, 'A'], [25, 'Z'], [26, 'AA'], [27, 'AB'], [51, 'AZ'], [52, 'BA'], [701, 'ZZ'], [702, 'AAA']] as const)('index %i is %s', (index, letter) => {
    expect(pairs.buildingLetter(index)).toBe(letter);
  });
});

// Literal blocked routes catch geometry lost behind ownership, non-drawer or slot checks.
describe('geometry precompute', () => {
  it('finds the seven ordered na-kane blockers without changing its input or live sim', () => {
    const sim = create(level, 42), before = sim.snapshot(), original = structuredClone(level);
    const blocked = pairs.computeBlocked(level);
    expect([...blocked].sort()).toEqual(['0>1', '0>3', '1>0', '2>3', '2>4', '3>0', '3>2']);
    expect(level).toEqual(original);
    expect(sim.snapshot()).toEqual(before);
    expect(sim.canDraw(0, 0, 2)).toBeNull();
  });

  it('keeps blocked pairs hidden when the real source has no free routes', () => {
    const capped: CompiledLevel = { ...level, buildings: level.buildings.map(b => ({ ...b, level: 1 })) };
    const sim = create(capped, 42), blocked = pairs.computeBlocked(capped);
    sim.step([{ type: 'DrawLine', player: 0, from: 0, to: 2 }]);
    expect(sim.view.freeSlots(0)).toBe(0);
    expect(sim.canDraw(0, 0, 1)).toBe('no-slot');
    expect(sim.canDraw(0, 0, 3)).toBe('no-slot');
    const [group] = pairs.derivePairs(sim.view, (from, to) => sim.canDraw(0, from, to), blocked);
    expect(group!.pairs.map(p => [p.to, p.state, p.text])).toEqual([
      [2, 'active', 'A → C · active'],
      [4, 'unavailable', 'A → E · no free route'],
    ]);
    expect([...pairs.computeBlocked(capped)].sort()).toEqual(['0>1', '0>3', '1>0', '2>3', '2>4', '3>0', '3>2']);
  });
});

// Real views enforce source eligibility, ownership suffixes and line precedence.
describe('pair groups', () => {
  it('labels only human drawers and ready targets using authored building order', () => {
    const owned: CompiledLevel = { ...level, buildings: level.buildings.map((b, i) => ({ ...b, owner: i === 1 || i === 4 ? 0 : b.owner })) };
    const sim = create(owned, 42);
    const groups = pairs.derivePairs(sim.view, (from, to) => sim.canDraw(0, from, to), pairs.computeBlocked(owned));
    expect(groups.map(g => [g.from, g.letter, g.text])).toEqual([[0, 'A', 'A (blue 15)'], [1, 'B', 'B (blue 5)']]);
    expect(groups[0]!.pairs.map(p => [p.fromLetter, p.toLetter, p.reason, p.text])).toEqual([
      ['A', 'C', null, 'A → C · ready · C: grey 15'],
      ['A', 'E', null, 'A → E · ready · E: blue 3'],
    ]);
    expect(groups[1]!.pairs.find(p => p.to === 3)!.text).toBe('B → D · ready · D: yellow 5');
  });

  it('sorts ready and active before unavailable while keeping index order within each tier', () => {
    const sim = create(level, 42);
    sim.step([{ type: 'DrawLine', player: 0, from: 0, to: 2 }]);
    const [group] = pairs.derivePairs(sim.view, (_from, to) => to === 1 ? 'no-slot' : to === 2 ? 'duplicate' : to === 3 ? 'not-owner' : null, new Set());
    expect(group!.pairs.map(p => [p.to, p.state, p.reason, p.text])).toEqual([
      [2, 'active', null, 'A → C · active'],
      [4, 'ready', null, 'A → E · ready · E: grey 3'],
      [1, 'unavailable', 'no-slot', 'A → B · no free route'],
      [3, 'unavailable', 'not-owner', 'A → D · not owner'],
    ]);
  });

  it.each([['no-slot', 'no free route'], ['blocked-obstacle', 'blocked obstacle'], ['blocked-building', 'blocked building'], ['unknown-id', 'unknown id']] as const)('renders reason %s as %s', (reason, text) => {
    expect(pairs.reasonWords(reason)).toBe(text);
  });
});

// Tick boundaries catch early clearing; returned copies prevent accidental caller mutation.
describe('pending and click decisions', () => {
  it('ignores a repeated submission until a strictly later tick and retains other pending pairs', () => {
    const original = new Map<string, number>();
    const first = pairs.addPending(original, 0, 2, 10);
    const second = pairs.addPending(first, 1, 3, 11);
    expect(original.size).toBe(0);
    expect([...first]).toEqual([['0>2', 10]]);
    expect([...pairs.clearPending(second, 10)]).toEqual([['0>2', 10], ['1>3', 11]]);
    expect([...pairs.clearPending(second, 11)]).toEqual([['1>3', 11]]);
    expect([...pairs.clearPending(second, 12)]).toEqual([]);
    expect([...second]).toEqual([['0>2', 10], ['1>3', 11]]);
    expect(pairs.decidePairAction('ready', 'click', second.has('0>2'), undefined, 2000)).toBe('ignore');
    expect(pairs.decidePairAction('ready', 'click', pairs.clearPending(second, 11).has('0>2'), undefined, 2000)).toBe('draw');
  });

  it.each([
    ['ready', 'click', false, undefined, 2000, 'draw'],
    ['active', 'click', false, 1000, 2000, 'ignore'],
    ['unavailable', 'click', false, undefined, 2000, 'reason'],
    ['ready', 'dblclick', false, undefined, 2000, 'ignore'],
    ['unavailable', 'dblclick', false, 1000, 2000, 'ignore'],
    ['active', 'dblclick', true, 1000, 2000, 'ignore'],
    ['active', 'dblclick', false, undefined, 2000, 'ignore'],
    ['active', 'dblclick', false, 1000, 1699, 'ignore'],
    ['active', 'dblclick', false, 1000, 1700, 'cut'],
    ['active', 'dblclick', false, 1000, 2000, 'cut'],
  ] as const)('%s %s pending=%s drawn=%s now=%s => %s', (state, gesture, pending, drawnAt, now, action) => {
    expect(pairs.decidePairAction(state, gesture, pending, drawnAt, now)).toBe(action);
  });
});
