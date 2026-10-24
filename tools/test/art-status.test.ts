import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artStatus, formatArtStatus } from '../src/art-status.js';

const base = () => ({
  visuals: {
    'unit.soldier': { kind: 'unit', model: { parts: 'models/tw/soldier.glb', lod: 'models/tw/soldier-lod.glb', budget: 'unit' }, team: { mode: 'textureSwap', textures: { blue: 'textures/tw/soldier-blue.png' } }, scale: 1 },
    'unit.tint': { kind: 'unit', model: { parts: 'models/tw/tint.glb' }, team: { mode: 'tintMask', base: 'textures/tw/tint.png', mask: 'textures/tw/tint-mask.png' }, scale: 1 },
  },
  themes: { snow: { ground: { mesh: 'models/tw/g.glb', texture: 'textures/tw/g.png' }, obstacle: { small: 'models/tw/o.glb#small', big: 'models/tw/o.glb#big', texture: 'textures/tw/o.png' }, light: { color: '#fff' }, sky: '#eee' } },
  fx: { ring: { texture: 'fx/ring.png', kind: 'ring' } },
  events: { Clash: { sfx: 'audio/clash.ogg' }, Silent: {} },
}) as any;

test('lists every original file field with TW/stock labels, skips scalars', () => {
  const r = artStatus(base());
  assert.equal(r.total, 13);
  assert.equal(r.onArt, 0);
  const text = formatArtStatus(r);
  assert.match(text, /unit\.soldier\s+model\.parts\s+models\/tw\/soldier\.glb\s+TW/);
  assert.match(text, /unit\.tint\s+team\.mask\s+textures\/tw\/tint-mask\.png\s+TW/);
  assert.match(text, /theme snow\s+obstacle\.small\s+models\/tw\/o\.glb#small\s+TW/);
  assert.match(text, /fx ring\s+texture\s+fx\/ring\.png\s+stock/);
  assert.match(text, /event Clash\s+sfx\s+audio\/clash\.ogg\s+stock/);
  assert.doesNotMatch(text, /sky|#eee|light/);
  assert.match(text.trimEnd().split('\n').pop()!, /^0 of 13 fields on art\/ \(13 original\)$/);
});

test('fields under art/ are counted but not listed', () => {
  const m = base();
  m.visuals['unit.soldier'].model.parts = 'art/models/soldier.glb';
  m.events.Clash.sfx = 'art/audio/clash.ogg';
  const r = artStatus(m);
  assert.equal(r.onArt, 2);
  assert.equal(r.original.length, 11);
  const text = formatArtStatus(r);
  assert.doesNotMatch(text, /art\/models\/soldier/);
  assert.match(text, /2 of 13 fields on art\/ \(11 original\)$/);
});

test('--strict exit codes via CLI', async () => {
  const { runArtStatus } = await import('../src/art-status.js');
  const log = console.log; console.log = () => {};
  try {
    assert.equal(runArtStatus(base(), []), 0);
    assert.equal(runArtStatus(base(), ['--strict']), 1);
    assert.equal(runArtStatus(base(), ['--bogus']), 2);
    const m = base();
    m.visuals['unit.soldier'].model.parts = 'art/a.glb'; m.visuals['unit.soldier'].model.lod = 'art/b.glb'; m.visuals['unit.soldier'].team.textures.blue = 'art/c.png';
    m.visuals['unit.tint'].model.parts = 'art/d.glb'; m.visuals['unit.tint'].team.base = 'art/e.png'; m.visuals['unit.tint'].team.mask = 'art/f.png';
    m.themes.snow.ground = { mesh: 'art/g.glb', texture: 'art/h.png' }; m.themes.snow.obstacle = { small: 'art/o.glb#small', big: 'art/o.glb#big', texture: 'art/p.png' };
    m.fx.ring.texture = 'art/r.png'; m.events.Clash.sfx = 'art/s.ogg';
    assert.equal(artStatus(m).original.length, 0);
    assert.equal(runArtStatus(m, ['--strict']), 0);
  } finally { console.log = log; }
});
