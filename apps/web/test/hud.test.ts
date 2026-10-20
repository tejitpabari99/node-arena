import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { VNode } from 'preact';
import type { SimView } from '@node-arena/sim';
import { HudView, TIP_TEXT, formatTime, humanDrewLine, tipVisible, type HudViewProps } from '../src/ui/Hud';
import { strength } from '../src/ui/strength';
import { createAppController } from '../src/app/state';
import { contentFiles } from '../src/app/boot';
import { parseManifest } from '../src/manifest/load';
import { createSaveStore } from '../src/save';
import manifestJSON from './fixtures/greybox-manifest.json';

const view = {
  players: [{ team: 'a', colorKey: 'player.1', transit: 4, kind: 'human' }, { team: 'b', colorKey: 'player.2', transit: 0, kind: 'bot' }],
  tower: { owner: Int32Array.from([0, 1, -1]), col: { 'garrison.count': Int32Array.from([14, 24, 9]) } },
} as unknown as SimView;

function flat(node: unknown, out: VNode<Record<string, unknown>>[] = []): VNode<Record<string, unknown>>[] {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => flat(n, out)); return out; }
  const v = node as VNode<Record<string, unknown>>;
  out.push(v);
  flat(v.props.children, out);
  return out;
}
const props = (over: Partial<HudViewProps> = {}): HudViewProps => ({
  levelOrder: 1, levelName: 'First Steps', time: '1:05', strength: strength(view), colors: { 'player.1': '#2E8BFF', 'player.2': '#E5484D' },
  colorblind: false, reducedMotion: false, speed: 1, canAct: true, tip: null, onPause() {}, onSpeed() {}, onDismissTip() {}, ...over,
});
const by = (nodes: VNode<Record<string, unknown>>[], hud: string) => nodes.find(n => n.props['data-hud'] === hud);

describe('HudView', () => {
  it('renders pill, role=meter with aria-valuetext and segments matching strength()', () => {
    const s = strength(view);
    const nodes = flat(HudView(props()));
    const meter = by(nodes, 'meter')!;
    expect(meter.props.role).toBe('meter');
    expect(meter.props['aria-valuetext']).toBe(s.ariaText);
    expect(s.ariaText).toBe('Blue 43%, Red 57%');
    const segs = nodes.filter(n => 'data-hud-seg' in n.props);
    expect(segs.map(n => n.props['data-team'])).toEqual(s.segments.map(x => x.team));
    expect(segs.map(n => (n.props.style as { width: string }).width)).toEqual(s.segments.map(x => `${x.pct}%`));
    expect(nodes.find(n => n.props.role === 'timer')).toBeTruthy();
    expect(by(nodes, 'pill')).toBeTruthy();
    expect(by(nodes, 'root')).toBeTruthy();
  });
  it('pause / speed buttons carry aria-label, aria-pressed and the Esc-independent handlers', () => {
    let paused = 0, sped = 0;
    const nodes = flat(HudView(props({ speed: 2, onPause: () => paused++, onSpeed: () => sped++ })));
    const pause = by(nodes, 'pause')!, speed = by(nodes, 'speed')!;
    expect(pause.props['aria-label']).toBe('Pause');
    expect(speed.props['aria-label']).toBe('Game speed');
    expect(speed.props['aria-pressed']).toBe(true);
    (pause.props.onClick as () => void)(); (speed.props.onClick as () => void)();
    expect([paused, sped]).toEqual([1, 1]);
    expect(by(flat(HudView(props({ speed: 1 }))), 'speed')!.props['aria-pressed']).toBe(false);
  });
  it('tip is role=status with a focusable Dismiss only when shown', () => {
    expect(by(flat(HudView(props())), 'tip')).toBeUndefined();
    let dismissed = 0;
    const nodes = flat(HudView(props({ tip: 'shown', onDismissTip: () => dismissed++ })));
    const tip = by(nodes, 'tip')!;
    expect(tip.props.role).toBe('status');
    const button = flat(tip).find(n => n.type === 'button')!;
    expect(button.props.tabIndex).toBeUndefined();
    (button.props.onClick as () => void)();
    expect(dismissed).toBe(1);
    expect(flat(tip).some(n => n.props.children === TIP_TEXT)).toBe(true);
  });
  it('formats m:ss', () => { expect(formatTime(65)).toBe('1:05'); expect(formatTime(600)).toBe('10:00'); });
});

describe('first-level tip', () => {
  it('shows once on order 1 only while tipSeen is false, in play screens', () => {
    expect(tipVisible(1, false, 'playing')).toBe(true);
    expect(tipVisible(1, false, 'paused')).toBe(true);
    expect(tipVisible(1, true, 'playing')).toBe(false);
    expect(tipVisible(2, false, 'playing')).toBe(false);
    expect(tipVisible(10, false, 'playing')).toBe(false);
    expect(tipVisible(1, false, 'results')).toBe(false);
    expect(tipVisible(1, false, 'menu')).toBe(false);
  });
  it('humanDrewLine is true only for the human LineDrawn event', () => {
    const sim = { view } as never;
    expect(humanDrewLine({ sim, events: [{ type: 'LineDrawn', tick: 1, channel: 0, from: 0, to: 1, owner: 0 }] })).toBe(true);
    expect(humanDrewLine({ sim, events: [{ type: 'LineDrawn', tick: 1, channel: 0, from: 1, to: 0, owner: 1 }] })).toBe(false);
    expect(humanDrewLine({ sim, events: [{ type: 'LineCut', tick: 1, channel: 0, reason: 'player' }] })).toBe(false);
  });
  it('tipSeen persists via updateSettings and survives a reload of the same storage', async () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const make = () => createAppController({ files: contentFiles(), loadManifest: async () => parseManifest(manifestJSON), save: createSaveStore({ storage }), autoStart: false });
    const app = make();
    await app.boot();
    expect(app.snapshot().save.settings.tipSeen).toBe(false);
    app.updateSettings({ tipSeen: true });
    expect(app.snapshot().save.settings.tipSeen).toBe(true);
    const again = make();
    expect(again.snapshot().save.settings.tipSeen).toBe(true);
    app.dispose(); again.dispose();
  });
});

describe('App markup', () => {
  const src = readFileSync(new URL('../src/ui/App.tsx', import.meta.url), 'utf8');
  it('has no .hud panel or .instructions bar; perf toggle lives in Settings', () => {
    expect(src).not.toMatch(/class="hud"|class="instructions"/);
    expect(src).toContain('<Hud ');
    const settings = src.slice(src.indexOf('state.screen === "settings"'));
    expect(settings).toContain('Performance HUD');
    expect(src.slice(0, src.indexOf('state.screen === "settings"'))).not.toMatch(/>\s*Performance\s*</);
  });
  it('?perf URL param enables perf at start', async () => {
    (globalThis as { window?: unknown }).window = { location: { search: '?perf' }, matchMedia: undefined };
    try {
      const app = createAppController({ files: contentFiles(), loadManifest: async () => parseManifest(manifestJSON), save: createSaveStore({ storage: null }), autoStart: false });
      expect(app.snapshot().perf).toBe(true);
      app.dispose();
    } finally { delete (globalThis as { window?: unknown }).window; }
  });
});
