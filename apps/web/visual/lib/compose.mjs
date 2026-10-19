// Pure helpers for visual:compose (PRD SP01 Req 7, Decision 4): ref-map.json loading/validation, detail-crop
// selection from the capture probe, layout model and HTML rendering. No browser, no image libs.
// Unit-tested in test/visual-compose.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { VISUAL_DIR, parseViewport } from './scenes.mjs';

export const PRIMARY_VIEWPORT = '1920x1080';
export const CROP_PX = 280; // displayed crop box edge
const FRAME_W = { single: 960, multi: 640 }; // displayed primary frame width
const SECONDARY_SCALE = 0.6; // other viewports relative to the primary frame width
const HUMAN = 'p1';
const ROLES = new Set(['look', 'chevrons']);

export function loadRefMap(file = path.join(VISUAL_DIR, 'ref-map.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadTemplate(file = path.join(VISUAL_DIR, 'compose.html.tpl')) {
  return fs.readFileSync(file, 'utf8');
}

/** Errors (empty = valid): every scenes.json scene mapped, ref files present, look refs Tower War only (picker excepted), V-ids well formed. */
export function validateRefMap(map, scenesConfig, refFiles) {
  const errors = [], have = new Set(refFiles), vid = /^V\d{2}$/;
  const scenes = map?.scenes ?? {};
  for (const s of scenesConfig.scenes) if (!scenes[s.id]) errors.push(`${s.id}: no ref-map entry`);
  for (const [id, entry] of Object.entries(scenes)) {
    if (!Array.isArray(entry.refs) || !entry.refs.length) { errors.push(`${id}: refs must be a non-empty list`); continue; }
    for (const v of entry.items ?? []) if (!vid.test(v)) errors.push(`${id}: bad item id ${v}`);
    for (const ref of entry.refs) {
      if (!have.has(ref.file)) errors.push(`${id}: ${ref.file} missing from the ref dir`);
      if (!ROLES.has(ref.role)) errors.push(`${id}: ${ref.file}: unknown role ${ref.role}`);
      if (ref.role === 'look' && !ref.file.startsWith('towerwar_') && id !== 'picker') errors.push(`${id}: ${ref.file}: not a Tower War ref (only picker may use another look ref)`);
      for (const v of ref.items ?? []) if (!vid.test(v)) errors.push(`${id}: ${ref.file}: bad item id ${v}`);
    }
  }
  return errors;
}

/** Square box of edge `size` (rounded) centred on `p`, shifted to stay inside the image. */
export function cropBox(p, size, { width, height }) {
  const s = Math.min(Math.floor(size / 2) * 2, width, height);
  const clamp = (v, max) => Math.max(0, Math.min(max - s, v));
  return { x: clamp(Math.round(p.x - s / 2), width), y: clamp(Math.round(p.y - s / 2), height), w: s, h: s };
}

/** Centre of the sample rect with the most neighbours within `radius` px (ties: first), averaged over that group. */
export function troopCluster(rects, radius) {
  if (!rects?.length) return null;
  const c = rects.map(r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 }));
  let best = null;
  for (const p of c) {
    const group = c.filter(q => Math.hypot(q.x - p.x, q.y - p.y) <= radius);
    if (!best || group.length > best.length) best = group;
  }
  const avg = k => Math.round(best.reduce((a, q) => a + q[k], 0) / best.length);
  return { x: avg('x'), y: avg('y'), n: best.length };
}

const fmt = p => `(${Math.round(p.x)}, ${Math.round(p.y)})`;

/** Detail strip for one captured frame: first owned (human) tower, a lane midpoint, a troop cluster, the clash point. */
export function detailCrops(frame, viewport) {
  const keys = [['tower', 'first owned tower'], ['lane', 'lane midpoint'], ['troops', 'troop cluster'], ['clash', 'clash point']];
  const probe = frame.probe;
  if (!probe) return keys.map(([key, title]) => ({ key, title, rect: null, text: `n/a (UI screen${frame.screen ? ` '${frame.screen}'` : ''})` }));
  const k = viewport.width / 1920, size = n => n * k;
  const out = [];
  const tower = probe.towers.find(t => t.owner === HUMAN) ?? probe.towers.find(t => t.owner);
  if (tower) {
    const boxes = [tower.model, tower.countRect].filter(Boolean);
    const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y));
    const x1 = Math.max(...boxes.map(b => b.x + b.w)), y1 = Math.max(...boxes.map(b => b.y + b.h));
    const edge = Math.max(size(120), (Math.max(x1 - x0, y1 - y0)) * 1.6);
    out.push({ key: 'tower', title: 'first owned tower', rect: cropBox({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, edge, viewport), text: `${tower.id} (${tower.owner})` });
  } else out.push({ key: 'tower', title: 'first owned tower', rect: null, text: 'no owned tower' });
  const lane = probe.lanes[0];
  if (lane) out.push({ key: 'lane', title: 'lane midpoint', rect: cropBox(lane.mid, size(200), viewport), text: `${lane.pair} ${fmt(lane.mid)}` });
  else if (frame.laneCrop?.rect) {
    const r = frame.laneCrop.rect;
    out.push({ key: 'lane', title: 'lane midpoint', rect: { x: r.x, y: r.y, w: r.width, h: r.height }, text: 'cut lane crop (no live lane)' });
  } else out.push({ key: 'lane', title: 'lane midpoint', rect: null, text: 'no lane' });
  const cluster = troopCluster(probe.troops?.sampleRects, size(80));
  out.push(cluster
    ? { key: 'troops', title: 'troop cluster', rect: cropBox(cluster, size(200), viewport), text: `${cluster.n} of ${probe.troops.count} sampled ${fmt(cluster)}` }
    : { key: 'troops', title: 'troop cluster', rect: null, text: 'no troops' });
  const c = probe.clash ?? {}, split = probe.lanes.find(l => l.splitScreen)?.splitScreen;
  const point = c.eventScreen ?? c.fxScreen ?? split ?? null;
  const how = c.eventScreen ? `Clash ${c.eventPair ?? ''} @${c.eventTick}` : c.fxScreen ? 'clash fx' : split ? 'lane split' : '';
  out.push(point
    ? { key: 'clash', title: 'clash point', rect: cropBox(point, size(200), viewport), text: `${how} ${fmt(point)}`.trim() }
    : { key: 'clash', title: 'clash point', rect: null, text: 'no clash in scene' });
  return out;
}

const fileUrl = p => pathToFileURL(p).href;
const viewportOrder = v => (v === PRIMARY_VIEWPORT ? 0 : 1);

/**
 * Layout model for one scene. `byViewport` = metrics.json scenes[id]; `refs` = ref-map entries with source `width`/`height`.
 * Current: every viewport (1920x1080 first, larger) with its frames side by side; refs at the primary frame height.
 */
export function composeModel({ scene, byViewport, refs, outDir, refDir, commit = null }) {
  const viewports = Object.keys(byViewport).sort((a, b) => viewportOrder(a) - viewportOrder(b));
  const primary = viewports[0];
  const nFrames = Math.max(...viewports.map(v => byViewport[v].frames.length));
  const baseW = nFrames > 1 ? FRAME_W.multi : FRAME_W.single;
  const current = viewports.map((v, i) => {
    const { width, height } = parseViewport(v), w = Math.round(i === 0 ? baseW : baseW * SECONDARY_SCALE);
    return {
      viewport: v, primary: i === 0,
      frames: byViewport[v].frames.map(f => ({
        label: f.label ?? null, tick: f.tick ?? null, simHash: f.simHash ?? null, screen: f.screen ?? null,
        src: fileUrl(path.join(outDir, f.png)), png: f.png, w, h: Math.round(w * height / width),
      })),
    };
  });
  const refH = current[0].frames[0].h;
  const refRows = refs.map(r => ({ ...r, src: fileUrl(path.join(refDir, r.file)), h: refH, w: Math.round(refH * r.width / r.height) }));
  const first = byViewport[primary], firstFrame = first.frames[0], pv = parseViewport(primary);
  const crops = detailCrops({ ...firstFrame, laneCrop: firstFrame.laneCrop ?? first.laneCrop }, pv).map(c => {
    if (!c.rect) return { ...c, box: { w: CROP_PX, h: CROP_PX } };
    const s = CROP_PX / Math.max(c.rect.w, c.rect.h);
    return { ...c, scale: s, src: fileUrl(path.join(outDir, firstFrame.png)), box: { w: Math.round(c.rect.w * s), h: Math.round(c.rect.h * s) } };
  });
  const frameLabel = f => (f.label ?? (f.tick !== null ? 'capture' : f.screen ?? 'capture'));
  return {
    id: scene.id, title: `compare-${scene.id}`,
    meta: [first.level ? `level ${first.level}` : `screen ${firstFrame.screen ?? scene.screen ?? '?'}`, first.fixture ? `fixture ${first.fixture}` : null, first.seed !== undefined ? `seed ${first.seed}` : null, first.fallbackUsed ? 'FALLBACK scene used' : null, commit ? `commit ${commit}` : null].filter(Boolean).join(' · '),
    current, refs: refRows, crops, cropSource: `${primary} ${frameLabel(firstFrame)}`, frameLabel,
  };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

/** Fills `{{title}}` / `{{body}}` in compose.html.tpl. */
export function renderHtml(template, model) {
  const e = escapeHtml, px = n => `${n}px`;
  // <canvas class="px">: the template script decodes data-src 1:1 and area-resamples data-crop in JS (deterministic;
  // browser <img> downscaling was not bit-stable on SwiftShader/CPU raster, see iteration log).
  const canvas = (src, w, h, crop = null) => `<canvas class="px" data-src="${e(src)}"${crop ? ` data-crop="${crop.x},${crop.y},${crop.w},${crop.h}"` : ''} width="${w}" height="${h}"></canvas>`;
  const frame = f => `<figure>${canvas(f.src, f.w, f.h)}<figcaption><b>${e(model.frameLabel(f))}</b>${f.tick !== null ? ` · tick ${f.tick}` : ''} <span class="sub">${e(f.png)}</span></figcaption></figure>`;
  const current = model.current.map(r => `<div class="viewport-label">${e(r.viewport)}${r.primary ? ' (primary)' : ''}</div><div class="frames">${r.frames.map(frame).join('')}</div>`).join('');
  const ref = r => `<figure class="role-${e(r.role)}">${canvas(r.src, r.w, r.h)}<figcaption style="max-width:${px(Math.max(r.w, 160))}"><b>${e(r.file)}</b> · ${e(r.role)}${r.items?.length ? ` (${e(r.items.join(', '))} only)` : ''}${r.note ? `<br><span class="sub">${e(r.note)}</span>` : ''}</figcaption></figure>`;
  const crop = c => c.rect
    ? `<figure><div class="crop">${canvas(c.src, c.box.w, c.box.h, c.rect)}</div><figcaption style="max-width:${px(Math.max(c.box.w, CROP_PX))}"><b>${e(c.title)}</b><br><span class="sub">${e(c.text)} · ${c.rect.w}x${c.rect.h} @${c.rect.x},${c.rect.y}</span></figcaption></figure>`
    : `<figure><div class="crop na" style="width:${px(c.box.w)};height:${px(c.box.h)}">${e(c.text)}</div><figcaption style="max-width:${px(CROP_PX)}"><b>${e(c.title)}</b></figcaption></figure>`;
  const body = `<header>${e(model.title)}</header><div class="meta">${e(model.meta)}</div>
<div class="row">
<div class="col"><h2>Current</h2>${current}</div>
<div class="col"><h2>References</h2><div class="refs">${model.refs.map(ref).join('')}</div></div>
<div class="col"><h2>Detail</h2><div class="sub">from ${e(model.cropSource)}</div><div class="crops">${model.crops.map(crop).join('')}</div></div>
</div>`;
  return template.replace('{{title}}', e(model.title)).replace('{{body}}', body);
}

/** Width/height from a PNG IHDR or a JPEG SOFn header. */
export function imageSize(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  throw new Error('unsupported image (PNG/JPEG only)');
}

