import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { VNode } from 'preact';
import { defaultSave } from '../../src/save';
import type { AppSnapshot } from '../../src/app/state';

type N = VNode<Record<string, unknown>>;
function find(node: unknown, test: (n: N) => boolean, out: N[] = []): N[] {
  if (Array.isArray(node)) node.forEach((n) => find(n, test, out));
  else if (node && typeof node === 'object' && 'props' in node) { const n = node as N; if (test(n)) out.push(n); find(n.props.children, test, out); }
  return out;
}
const cls = (n: N) => String(n.props.class ?? '');
const tiles = (v: unknown) => find(v, (n) => cls(n).includes('menu-tile')).map((n) => (n.props.children as N).props.children);
const base = { save: defaultSave(), levels: [{ id: 'a', position: 4, number: 1, name: 'Level 1' }], customLevels: [{ id: 'na-test', position: 1, number: 1, name: 'My battle' }] };
const state = (pickerView: string) => ({ ...base, pickerView }) as unknown as AppSnapshot;
const plain = { onStart: () => {}, onMute: () => {}, onCredits: () => {} }, cb = { ...plain, onPlayOnline: () => {} };

async function loadPicker(dev: boolean) {
  vi.resetModules();
  vi.stubEnv('DEV', dev);
  return (await import('../../src/ui/Picker')).Picker;
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('Picker build gating', () => {
  it('production build hides the Custom tile and Play online stays after Campaign', async () => {
    const Picker = await loadPicker(false);
    expect(tiles(Picker({ state: state('main'), ...cb }))).toEqual(['Campaign', 'Play online']);
    expect(tiles(Picker({ state: state('main'), ...plain }))).toEqual(['Campaign']);
  });
  it('production build falls back to main when pickerView is custom (no grid, no create card, no edit links)', async () => {
    const Picker = await loadPicker(false);
    const v = Picker({ state: state('custom'), ...cb });
    expect(tiles(v)).toEqual(['Campaign', 'Play online']);
    expect(find(v, (n) => cls(n).startsWith('level-grid'))).toHaveLength(0);
    expect(find(v, (n) => cls(n).includes('create-card') || cls(n) === 'level-edit')).toHaveLength(0);
    expect(find(v, (n) => n.type === 'h1')[0]!.props.children).toBe('Choose your battle');
    expect((v as N).props['aria-label']).toBe('Main menu');
    expect(find(v, (n) => cls(n).includes('back-button'))).toHaveLength(0);
  });
  it('production campaign cards have no edit links', async () => {
    const Picker = await loadPicker(false);
    expect(find(Picker({ state: state('campaign'), ...cb }), (n) => cls(n) === 'level-edit')).toHaveLength(0);
  });
  it('dev build shows Custom between Campaign and Play online, and the custom grid with edit links', async () => {
    const Picker = await loadPicker(true);
    expect(tiles(Picker({ state: state('main'), ...cb }))).toEqual(['Campaign', 'Custom', 'Play online']);
    const v = Picker({ state: state('custom'), ...cb });
    expect(find(v, (n) => cls(n).startsWith('level-grid')).map(cls)).toEqual(['level-grid custom']);
    expect(find(v, (n) => cls(n) === 'level-edit')).toHaveLength(1);
    expect(find(v, (n) => n.type === 'h1')[0]!.props.children).toBe('Custom levels');
  });
  it('custom cards show a thumbnail and carry the name only in aria-label/title', async () => {
    const Picker = await loadPicker(true), { LevelThumb } = await import('../../src/ui/Picker');
    const card = find(Picker({ state: state('custom'), ...cb }), (n) => n.props['data-level-id'] === 'na-test')[0]!;
    expect(card.props['aria-label']).toBe('My battle'); expect(card.props.title).toBe('My battle');
    const kids = card.props.children as N[];
    expect(kids.some((k) => k.type === LevelThumb && k.props.id === 'na-test')).toBe(true);
    expect(find(card, (n) => n.props.children === 'My battle')).toHaveLength(0);
  });
});

describe('main.tsx custom-view deep link', () => {
  it('?view=custom is honored only in DEV builds (literal guard so production drops it)', () => {
    const main = readFileSync('src/main.tsx', 'utf8').replace(/\s+/g, '');
    expect(main).toContain("if(import.meta.env.DEV&&query.get('view')==='custom')app.setPickerView('custom')");
    expect(main.match(/setPickerView\(/g)).toHaveLength(1);
    expect(main.indexOf("query.get('view')")).toBe(main.lastIndexOf("query.get('view')"));
  });
});
