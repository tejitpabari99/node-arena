import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { composeModel, cropBox, detailCrops, escapeHtml, imageSize, loadRefMap, loadTemplate, renderHtml, troopCluster, validateRefMap } from '../visual/lib/compose.mjs';
import { resolveRefDir } from '../visual/lib/refs.mjs';
import { loadScenes } from '../visual/lib/scenes.mjs';

/** Non-null index (noUncheckedIndexedAccess). */
const at = <T>(a: readonly T[], i: number): T => { const v = a[i]; if (v === undefined) throw new Error(`no index ${i}`); return v; };
const rect = (c: { rect: { x: number; y: number; w: number; h: number } | null }) => { if (!c.rect) throw new Error('no rect'); return c.rect; };
const vp = { width: 1920, height: 1080 };
const probe = {
  viewport: { w: 1920, h: 1080 }, clearColor: '#000000',
  ground: { cornerRayHits: [], playQuadScreen: null },
  towers: [
    { id: 'n', owner: null, model: { x: 10, y: 10, w: 40, h: 40 }, countRect: null },
    { id: 'b', owner: 'b1', model: { x: 900, y: 500, w: 60, h: 50 }, countRect: null },
    { id: 't1', owner: 'p1', model: { x: 250, y: 537, w: 64, h: 56 }, countRect: { x: 260, y: 520, w: 22, h: 14 } },
  ],
  lanes: [{ from: 't1', to: 't2', pair: 't1-t2', splitScreen: null, mid: { x: 382, y: 609 } }],
  troops: { count: 4, screenHeightPx: 10, sampleRects: [
    { x: 1500, y: 100, w: 20, h: 20 },
    { x: 400, y: 600, w: 20, h: 20 }, { x: 420, y: 610, w: 20, h: 20 }, { x: 440, y: 590, w: 20, h: 20 },
  ] },
  clash: { fxScreen: null, eventScreen: null, eventTick: null, eventPair: null },
};

describe('ref-map.json', () => {
  const map = loadRefMap(), scenes = loadScenes();
  it('has an entry for every scenes.json scene, all files present in the ref dir', () => {
    const files = fs.readdirSync(resolveRefDir());
    expect(validateRefMap(map, scenes, files)).toEqual([]);
  });
  it('matches the PRD mapping (Tower War only; chevrons role on l01; picker = citytakeover_06)', () => {
    const refsOf = (id: string) => { const e = map.scenes[id]; if (!e) throw new Error(id); return e.refs; };
    const files = (id: string) => refsOf(id).map(r => r.file.replace(/\.jpg$/, ''));
    expect(files('l01')).toEqual(['towerwar_01', 'towerwar_yt1', 'towerwar_09', 'citytakeover_01']);
    expect(at(refsOf('l01'), 3)).toMatchObject({ role: 'chevrons', items: ['V11'] });
    expect(files('picker')).toEqual(['citytakeover_06']);
    expect(files('menu')).toEqual(['towerwar_05']);
    expect(files('l18')).toEqual(['towerwar_03', 'towerwar_yt1']);
    expect(files('cut')).toEqual(['towerwar_01', 'towerwar_06']);
    for (const id of ['l10', 'l10cb', 'clash']) expect(files(id)).toEqual(['towerwar_06']);
  });
  it('flags missing scenes, missing files, non-Tower-War look refs and bad items', () => {
    const bad = { scenes: { l01: { refs: [{ file: 'citytakeover_02.jpg', role: 'look' }, { file: 'nope.jpg', role: 'look' }], items: ['X1'] } } };
    const errors = validateRefMap(bad, { scenes: [{ id: 'l01' }, { id: 'menu' }] }, ['citytakeover_02.jpg']);
    expect(errors.join('\n')).toMatch(/menu: no ref-map entry/);
    expect(errors.join('\n')).toMatch(/nope\.jpg missing/);
    expect(errors.join('\n')).toMatch(/citytakeover_02\.jpg: not a Tower War ref/);
    expect(errors.join('\n')).toMatch(/X1/);
  });
});

describe('detail crops', () => {
  it('cropBox is square, clamped inside the image', () => {
    expect(cropBox({ x: 5, y: 5 }, 100, vp)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(cropBox({ x: 1915, y: 1075 }, 100, vp)).toEqual({ x: 1820, y: 980, w: 100, h: 100 });
    expect(cropBox({ x: 500, y: 500 }, 101, vp)).toEqual({ x: 450, y: 450, w: 100, h: 100 });
  });
  it('troopCluster centres on the densest sample group', () => {
    expect(troopCluster(probe.troops.sampleRects, 80)).toEqual({ x: 430, y: 610, n: 3 });
    expect(troopCluster([], 80)).toBeNull();
  });
  it('picks first human-owned tower, first lane mid, troop cluster and clash point', () => {
    const crops = detailCrops({ probe }, vp);
    expect(crops.map(c => c.key)).toEqual(['tower', 'lane', 'troops', 'clash']);
    const [tower, lane, troops, clash] = [0, 1, 2, 3].map(i => at(crops, i)) as [typeof crops[0], typeof crops[0], typeof crops[0], typeof crops[0]];
    expect(tower.text).toContain('t1');
    // tower crop contains the model and roof count
    expect(rect(tower).x).toBeLessThanOrEqual(250); expect(rect(tower).y).toBeLessThanOrEqual(520);
    expect(rect(tower).x + rect(tower).w).toBeGreaterThanOrEqual(314); expect(rect(tower).y + rect(tower).h).toBeGreaterThanOrEqual(593);
    expect(rect(lane).x + rect(lane).w / 2).toBe(382); expect(lane.text).toContain('t1-t2');
    expect(rect(troops).x + rect(troops).w / 2).toBe(430);
    expect(clash.rect).toBeNull(); expect(clash.text).toMatch(/no clash/);
  });
  it('uses the Clash event point, falling back to fx and lane split; laneCrop when no lane is left', () => {
    const withClash = { ...probe, lanes: [], clash: { fxScreen: { x: 700, y: 500 }, eventScreen: { x: 660, y: 556 }, eventTick: 100, eventPair: 'a-b' } };
    const crops = detailCrops({ probe: withClash, laneCrop: { rect: { x: 270, y: 556, width: 229, height: 105 } } }, vp);
    expect(rect(at(crops, 3)).x + rect(at(crops, 3)).w / 2).toBe(660); expect(at(crops, 3).text).toMatch(/a-b.*100/);
    expect(at(crops, 1).rect).toEqual({ x: 270, y: 556, w: 229, h: 105 });
    const split = { ...probe, lanes: [{ ...at(probe.lanes, 0), splitScreen: { x: 800, y: 400 } }] };
    expect(rect(at(detailCrops({ probe: split }, vp), 3)).x + 100).toBe(800);
  });
  it('UI screens (no probe) get n/a crops', () => {
    const crops = detailCrops({ screen: 'menu' }, vp);
    expect(crops.every(c => c.rect === null)).toBe(true);
    expect(at(crops, 0).text).toMatch(/UI screen/);
  });
});

describe('imageSize', () => {
  it('reads PNG and JPEG headers (refs keep their aspect)', () => {
    const dir = resolveRefDir();
    expect(imageSize(fs.readFileSync(`${dir}/towerwar_01.jpg`))).toEqual({ width: 554, height: 1200 });
    expect(imageSize(fs.readFileSync(`${dir}/towerwar_yt1.jpg`))).toEqual({ width: 1280, height: 720 });
    const png = Buffer.alloc(24); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(1920, 16); png.writeUInt32BE(1080, 20);
    expect(imageSize(png)).toEqual({ width: 1920, height: 1080 });
    expect(() => imageSize(Buffer.from('GIF89a......'))).toThrow();
  });
});

describe('compose model + html', () => {
  const entry = (label: string | null, n = 1) => ({ level: '01-first-steps', seed: 1, frames: Array.from({ length: n }, (_, i) => ({ label: n > 1 ? `${label}${i}` : label, png: `x-${i}.png`, tick: 240 + i, simHash: 'abc', probe })) });
  it('1920x1080 is primary, other viewports follow; refs get equal height; frames side by side', () => {
    const model = composeModel({
      scene: { id: 'cut' }, byViewport: { '1366x768': entry('p', 3), '1920x1080': entry('p', 3) },
      refs: [{ file: 'towerwar_01.jpg', role: 'look', width: 554, height: 1200 }, { file: 'towerwar_yt1.jpg', role: 'look', width: 1280, height: 720 }],
      outDir: '/out', refDir: '/ref',
    });
    expect(model.current.map(r => r.viewport)).toEqual(['1920x1080', '1366x768']);
    expect(at(model.current, 0).frames).toHaveLength(3);
    const h = model.refs.map(r => r.h);
    expect(new Set(h).size).toBe(1);
    expect(at(h, 0)).toBe(at(at(model.current, 0).frames, 0).h);
    // undistorted: displayed aspect == source aspect
    for (const r of model.refs) expect(Math.abs(r.w / r.h - r.width / r.height)).toBeLessThan(0.01);
    expect(at(at(model.current, 0).frames, 0).w / at(at(model.current, 0).frames, 0).h).toBeCloseTo(1920 / 1080, 2);
  });
  it('renderHtml fills the template and escapes text', () => {
    const model = composeModel({ scene: { id: 'l01' }, byViewport: { '1920x1080': entry(null) }, refs: [{ file: 'a<b>.jpg', role: 'look', width: 100, height: 200 }], outDir: '/out', refDir: '/ref', commit: 'deadbeef' });
    const html = renderHtml(loadTemplate(), model);
    expect(html).not.toMatch(/\{\{/);
    expect(html).toContain('compare-l01');
    expect(html).toContain('a&lt;b&gt;.jpg');
    expect(html).toContain('file:///out/x-0.png');
    expect(html).toContain('first owned tower');
    expect(escapeHtml('<&"\'>')).toBe('&lt;&amp;&quot;&#39;&gt;');
  });
});
