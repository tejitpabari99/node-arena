import { describe, expect, it } from 'vitest';
import { createRoofAtlas, dotStates, roofText, drawRoof, CELL, GRID, BRIGHT_DOT, DIM_DOT, type RoofState } from '../src/render/roof-texture.js';

/** Minimal recording 2D context (vitest runs in node: no DOM canvas). */
function fakeCanvas() {
  const calls: { op: string; args: unknown[]; fill?: unknown }[] = []; let fillStyle: unknown = '';
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 36 }), save() {}, restore() {} } as Record<string, unknown>, {
    get: (t, k: string) => k in t ? t[k] : (...args: unknown[]) => { calls.push({ op: k, args, fill: fillStyle }); },
    set: (t, k: string, v) => { if (k === 'fillStyle') fillStyle = v; t[k] = v; return true; },
  });
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, calls };
}
const state = (over: Partial<RoofState> = {}): RoofState => ({ text: '12', dots: dotStates(2, 0), glyph: '', ...over });

describe('roof texture (covers R-SP03-R7)', () => {
  it('dot-state table: dots = slots, in use (dim) = lines, rest free (bright), clamped', () => {
    const table: [number, number, string[]][] = [
      [1, 0, ['free']], [1, 1, ['used']], [2, 0, ['free', 'free']], [2, 1, ['free', 'used']], [2, 2, ['used', 'used']],
      [3, 0, ['free', 'free', 'free']], [3, 1, ['free', 'free', 'used']], [3, 3, ['used', 'used', 'used']], [3, 9, ['used', 'used', 'used']], [0, 0, []], [2, -1, ['free', 'free']],
    ];
    for (const [slots, lines, expected] of table) expect(dotStates(slots, lines)).toEqual(expected);
  });
  it('shows Max at cap and the integer count below it', () => {
    expect(roofText(49, 50)).toBe('49'); expect(roofText(50, 50)).toBe('Max'); expect(roofText(51, 50)).toBe('Max'); expect(roofText(7, null)).toBe('7'); expect(roofText(7, 0)).toBe('7');
  });
  it('draws bright dots opaque white and in-use dots dim translucent, number outlined', () => {
    const { canvas, calls } = fakeCanvas(); const ctx = canvas.getContext('2d')!;
    drawRoof(ctx, 0, 0, state({ dots: dotStates(3, 1) }));
    const fills = calls.filter(c => c.op === 'fill').map(c => c.fill);
    expect(fills).toEqual([BRIGHT_DOT, BRIGHT_DOT, DIM_DOT]); expect(DIM_DOT).toMatch(/\.\d+\)$/); expect(BRIGHT_DOT).toBe('rgba(255,255,255,1)');
    expect(calls.map(c => c.op).filter(o => o === 'strokeText' || o === 'fillText')).toEqual(['strokeText', 'fillText', 'strokeText']); // outline, fill, thin fill-coloured fatten stroke
  });
  it('colourblind glyph is drawn only when set', () => {
    const a = fakeCanvas(); drawRoof(a.canvas.getContext('2d')!, 0, 0, state());
    const b = fakeCanvas(); drawRoof(b.canvas.getContext('2d')!, 0, 0, state({ glyph: '▲' }));
    expect(a.calls.filter(c => c.op === 'fillText').length).toBe(1); expect(b.calls.filter(c => c.op === 'fillText').length).toBe(2);
  });
  it('redraws a cell only when text, dots or glyph change; flush uploads once per batch', () => {
    const { canvas, calls } = fakeCanvas(), atlas = createRoofAtlas(4, canvas);
    expect(canvas.width).toBe(512); expect(canvas.height).toBe(512);
    expect(atlas.set(0, state())).toBe(true); expect(atlas.set(0, state())).toBe(false);
    expect(atlas.set(0, state({ text: '13' }))).toBe(true); expect(atlas.set(0, state({ text: '13', dots: dotStates(2, 1) }))).toBe(true);
    expect(atlas.set(0, state({ text: '13', dots: dotStates(2, 1), glyph: '■' }))).toBe(true); expect(atlas.set(0, state({ text: '13', dots: dotStates(2, 1), glyph: '■' }))).toBe(false);
    expect(atlas.redraws).toBe(4); expect(atlas.set(1, state())).toBe(true); expect(atlas.redraws).toBe(5);
    const before = atlas.texture.version; expect(atlas.flush()).toBe(true); expect(atlas.texture.version).toBe(before + 1); expect(atlas.flush()).toBe(false);
    // each redraw clears exactly its own 128x128 cell
    const clears = calls.filter(c => c.op === 'clearRect'); expect(clears.every(c => c.args[2] === CELL && c.args[3] === CELL)).toBe(true);
    atlas.dispose();
  });
  it('maps tower index to a 4x4 grid cell (v up) and rejects more than 16 towers', () => {
    const atlas = createRoofAtlas(16, fakeCanvas().canvas);
    expect(atlas.cell(0)).toEqual({ u: 0, v: 1 - 1 / GRID }); expect(atlas.cell(5)).toEqual({ u: .25, v: .5 }); expect(atlas.cell(15)).toEqual({ u: .75, v: 0 });
    expect(() => createRoofAtlas(17, fakeCanvas().canvas)).toThrow(/at most 16/);
  });
});
