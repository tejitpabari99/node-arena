// Metric evaluation M01-M20 (PRD SP01 "Metrics") against thresholds.json. Pure: callers pass decoded pixels.
// Probe values are locators/structure; pixel metrics use lib/pixel-metrics.mjs. Null never passes.
import fs from 'node:fs';
import path from 'node:path';
import { nearestTeam } from './color.mjs';
import { VISUAL_DIR } from './scenes.mjs';
import {
  classVector, crop, decalBottom, digitHeight, floorStripes, grassShare, outlinedDigit, playQuadShares, polygonMask, rectMask, resample,
  roofRegion, slotDots, toHsv, towerPaint, tvDistance, voidShare, REF_TOWER_WIDTH,
} from './pixel-metrics.mjs';

/** Sim tick rate (packages/sim TICK_RATE) and progress units per world unit (combat progA scale = mm * TICK_RATE). */
export const TICK_RATE = 20;
export const PROGRESS_PER_WORLD = 1000 * TICK_RATE;
export const METRIC_IDS = Array.from({ length: 20 }, (_, i) => `M${String(i + 1).padStart(2, '0')}`);
/** Metrics computed from pixels (need the decoded frame); the rest read probe/DOM/sim/perf JSON. */
export const PIXEL_IDS = ['M02', 'M07', 'M09', 'M10', 'M11', 'M14', 'M16', 'M18', 'M19', 'M20'];

export function loadThresholds(file = path.join(VISUAL_DIR, 'thresholds.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export const appliesTo = (def, scene, viewport) => def.scenes.includes(scene) && def.viewports.includes(viewport);

/** `limits[scene] ?? limits.default ?? limits`, then a per-viewport entry if present. */
export function limitsFor(def, scene, viewport) {
  const l = def.limits, base = l[scene] ?? l.default ?? l;
  return base[viewport] ?? base;
}

/** A px limit scales by viewport height from `atHeight` (default thresholds.pxBaseHeight). */
export function scaleLimit(limit, height, baseHeight = 1080) {
  if (!limit?.px) return limit;
  const k = height / (limit.atHeight ?? baseHeight), out = { ...limit };
  for (const key of ['min', 'max', 'eq']) if (typeof out[key] === 'number') out[key] = out[key] * k;
  return out;
}

/** Null/NaN never passes. */
export function within(value, limit) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (typeof limit.eq === 'number' && value !== limit.eq) return false;
  if (typeof limit.min === 'number' && value < limit.min - 1e-12) return false;
  if (typeof limit.max === 'number' && value > limit.max + 1e-12) return false;
  return true;
}

export const r3 = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const fmt = v => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(r3(v)) : String(v));
const median = values => { const s = values.filter(v => typeof v === 'number').sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const range = values => (values.length && values.every(v => typeof v === 'number') ? [Math.min(...values), Math.max(...values)] : null);
const fmtRange = rg => (rg ? (rg[0] === rg[1] ? fmt(rg[0]) : `${fmt(rg[0])}..${fmt(rg[1])}`) : 'null');

/** Primary frame of a capture entry: first settled unlabelled frame, else the first frame. */
export function primaryFrame(entry) {
  const frames = entry?.frames ?? [];
  return frames.find(f => f.label === null && f.settle) ?? frames[0] ?? null;
}

const ownedTowers = probe => probe.towers.filter(t => t.owner !== null);
const towerWidth = probe => median(ownedTowers(probe).map(t => t.model.w));
const isoIndex = (frame, id) => frame.sim?.towers?.findIndex(t => t.id === id) ?? -1;
const expectedFloors = t => (typeof t.count === 'number' && typeof t.cap === 'number' && t.cap > 0 ? Math.min(5, Math.max(1, Math.ceil(5 * t.count / t.cap))) : null);
const result = (pass, value, text) => ({ pass, value, text });
const nullResult = text => result(false, null, text ?? 'null');

/** Pixel locator for the roof number: upper 45% of the model rect, widened to the count decal rect when present. */
export function roofLocator(t) {
  const roof = roofRegion(t.model);
  if (!t.countRect) return roof;
  const x0 = Math.min(roof.x, t.countRect.x), y0 = Math.min(roof.y, t.countRect.y);
  const x1 = Math.max(roof.x + roof.w, t.countRect.x + t.countRect.w), y1 = Math.max(roof.y + roof.h, t.countRect.y + t.countRect.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------- probe / DOM / sim metrics: ctx = { entry, frame, probe, def, limits, scene, viewport, height, baseHeight, run } ----------

const PROBE = {
  /** T8 calibrated: tower width / viewport HEIGHT (aspect-independent; refs are portrait and landscape). */
  M01({ probe, limits }) {
    const w = towerWidth(probe), share = w === null ? null : w / probe.viewport.h;
    return result(within(share, limits), share, `median owned tower w ${fmt(share)} of vh`);
  },
  M03({ frame, probe, limits }) {
    const n = probe.towers.length; if (!n) return nullResult('no towers');
    const onRoof = probe.towers.filter(t => t.countOnRoof).length / n, cards = probe.towers.filter(t => t.hasCard).length + (frame.dom?.labels ?? NaN);
    return result(within(onRoof, limits.onRoofShare) && within(cards, limits.cards), { onRoof, cards }, `onRoof ${fmt(onRoof)}, cards+labels ${fmt(cards)}`);
  },
  M04({ probe, limits }) {
    const n = probe.towers.length; if (!n) return nullResult('no towers');
    const nulls = probe.towers.filter(t => t.floors === null).length;
    if (nulls) return nullResult(`floors null on ${nulls}/${n}`);
    const match = probe.towers.filter(t => t.floors === expectedFloors(t)).length / n;
    return result(within(match, limits.matchShare), match, `floors match ${fmt(match)}`);
  },
  M05({ probe, limits }) {
    const w = towerWidth(probe); if (!probe.lanes.length) return nullResult('no lanes');
    const ratios = probe.lanes.map(l => (l.screenWidthPx === null || w === null ? null : l.screenWidthPx / w));
    if (ratios.some(r => r === null)) return nullResult(`lane screenWidthPx null on ${ratios.filter(r => r === null).length}/${ratios.length}`);
    const rg = range(ratios);
    return result(ratios.every(r => within(r, limits.ratio)), rg, `lane/tower ${fmtRange(rg)}`);
  },
  M06({ probe, limits }) {
    const h = probe.troops.screenHeightPx, w = towerWidth(probe);
    if (h === null || w === null) return nullResult(h === null ? 'troop screenHeightPx null' : 'no owned towers');
    const share = h / probe.viewport.h, per = h / w;
    return result(within(share, limits.heightShare) && within(per, limits.perTowerWidth), { share, per }, `troop h ${fmt(share)} of vh, ${fmt(per)} of tower w`);
  },
  M08({ probe, limits }) {
    const hits = probe.ground.cornerRayHits.filter(Boolean).length;
    return result(within(hits, limits.hits), hits, `${hits}/9 rays hit ground`);
  },
  M12(ctx) { return headOn(ctx); },
  /** M13 portable proxies (always gated): drawCalls, jsMs p95. fps is the separate `M13fps` row (Decision 8). */
  M13({ entry, limits }) {
    const perf = entry.perf;
    if (!perf) return nullResult('no perf sample');
    return result(within(perf.drawCalls, limits.drawCalls) && within(perf.jsMsP95, limits.jsMsP95), { drawCalls: perf.drawCalls, jsMsP95: perf.jsMsP95 },
      `drawCalls ${fmt(perf.drawCalls)} (max ${limits.drawCalls.max}), jsMs p95 ${fmt(perf.jsMsP95)} (max ${limits.jsMsP95.max})`);
  },
  /** M13 fps: gated (>= 55) only on a real GPU run (`run.gpu`), informational (pass = null) on SwiftShader. */
  M13fps({ entry, limits, run }) {
    const perf = entry.perf;
    if (!perf) return nullResult('no perf sample');
    const gpu = run?.gpu === true, text = `fps ${fmt(perf.fps)}, frame p95 ${fmt(perf.frameMsP95)} ms${gpu ? ` (gpu, >= ${limits.fps.min})` : ' (informational: SwiftShader)'}`;
    return result(gpu ? within(perf.fps, limits.fps) : null, { fps: perf.fps, frameMsP95: perf.frameMsP95, gpu }, text);
  },
  M15({ probe, limits }) {
    const { w, h } = probe.viewport; if (!probe.towers.length) return nullResult('no towers');
    let minMargin = Infinity, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { model: m } of probe.towers) {
      minMargin = Math.min(minMargin, m.x / w, (w - m.x - m.w) / w, m.y / h, (h - m.y - m.h) / h);
      x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x + m.w); y1 = Math.max(y1, m.y + m.h);
    }
    const union = Math.min(Math.min(x0, w - x1) / w, Math.min(y0, h - y1) / h);
    return result(within(minMargin, limits.minMargin) && within(union, limits.unionMargin), { minMargin, union }, `min margin ${fmt(minMargin)}, tightest union margin ${fmt(union)}`);
  },
  M17({ entry, limits }) {
    const doms = (entry.frames ?? []).map(f => f.dom).filter(Boolean);
    if (!doms.length) return nullResult('no DOM record');
    const labels = Math.max(...doms.map(d => d.labels)), summary = Math.min(...doms.map(d => d.summary)), summaryMax = Math.max(...doms.map(d => d.summary));
    return result(within(labels, limits.labels) && within(summary, limits.summary) && within(summaryMax, limits.summary), { labels, summary },
      `labels ${labels}, [data-tower-summary] ${summary === summaryMax ? summary : `${summary}..${summaryMax}`}`);
  },
};

/** M12 (SP04 definition): lanes per pair, settled split error vs the most recent Clash, unsettled tolerance by closure. */
export function headOn({ entry, frame, probe, limits, height, baseHeight }) {
  const pair = probe.clash.eventPair;
  if (!pair) return nullResult('no Clash event');
  const pairLanes = probe.lanes.filter(l => l.pair === pair);
  const others = [...new Set(probe.lanes.map(l => l.pair).filter(p => p !== pair))];
  const crossing = others.length ? Math.max(...others.map(p => probe.lanes.filter(l => l.pair === p).length)) : null;
  const okA = within(pairLanes.length, limits.pairLanes), okB = crossing !== null && within(crossing, limits.crossingLanes);
  const tol = scaleLimit(limits.splitErrorPx, height, baseHeight);
  const error = (lanes, at) => (lanes.length && at && lanes.every(l => l.splitScreen) ? Math.max(...lanes.map(l => Math.hypot(l.splitScreen.x - at.x, l.splitScreen.y - at.y))) : null);
  const settled = probe.clash.eventTick !== null && probe.clash.eventTick <= frame.tick ? error(pairLanes, probe.clash.eventScreen) : null;
  const okC = within(settled, tol);
  // Unsettled frames (+6 PNG and splitTrace ticks): tolerance = 12 px (scaled) + 2 x troop speed x k / TICK_RATE projected.
  const towers = frame.sim?.towers ?? [], [lo, hi] = pair.split('-').map(id => towers.find(t => t.id === id));
  const pxPerWorld = lo && hi ? Math.hypot(hi.screen.x - lo.screen.x, hi.screen.y - lo.screen.y) / Math.hypot(hi.x - lo.x, hi.z - lo.z) : null;
  const speed = Math.max(0, ...(frame.sim?.kinds ?? []).map(k => k.speedPerTick)) / PROGRESS_PER_WORLD; // world units per tick
  const samples = [];
  for (const f of entry.frames ?? []) if (f !== frame && f.probe?.clash?.eventPair === pair) samples.push({ tick: f.tick, clashTick: f.probe.clash.eventTick, eventScreen: f.probe.clash.eventScreen, lanes: f.probe.lanes.filter(l => l.pair === pair) });
  for (const t of entry.splitTrace ?? []) if (t.clashPair === pair && t.tick !== frame.tick) samples.push({ tick: t.tick, clashTick: t.clashTick, eventScreen: t.eventScreen, lanes: t.lanes });
  let worst = null, okU = samples.length > 0;
  for (const s of samples) {
    const k = s.clashTick === null ? null : s.tick - s.clashTick, err = error(s.lanes, s.eventScreen);
    const allowed = pxPerWorld === null || k === null ? null : tol.max + limits.closureFactor * speed * k * pxPerWorld;
    if (err === null || allowed === null || err > allowed) okU = false;
    const margin = err === null || allowed === null ? null : err - allowed;
    if (worst === null || margin === null || (worst.margin !== null && margin > worst.margin)) worst = { tick: s.tick, err, allowed, margin };
    if (margin === null) break;
  }
  const value = { pairLanes: pairLanes.length, crossing, splitErrorPx: settled, unsettled: worst };
  return result(okA && okB && okC && okU, value,
    `(a) ${pair} lanes ${pairLanes.length}, (b) crossing ${fmt(crossing)}, (c) split err ${fmt(settled)} px <= ${fmt(tol.max)}, unsettled ${samples.length ? (worst?.err === null ? 'null' : `worst ${fmt(worst.err)}/${fmt(worst.allowed)} px @${worst.tick}`) : 'none'}`);
}

// ---------- pixel metrics: ctx += { hsv, magenta (decoded RGBA or null), refs } ----------

const PIXEL = {
  M02({ frame, probe, hsv, limits }) {
    if (!probe.towers.length) return nullResult('no towers');
    const ratios = [], cards = [];
    for (const t of probe.towers) {
      const h = t.countRect ? digitHeight(hsv, { x: t.countRect.x - 1, y: t.countRect.y - 1, w: t.countRect.w + 2, h: t.countRect.h + 2 }) : null;
      ratios.push(h === null || !t.model.w ? null : h / t.model.w);
      const card = frame.dom?.cards?.find(c => c.index === isoIndex(frame, t.id));
      cards.push(card ? (card.w * card.h) / Math.max(1, t.model.w * t.model.h) : 0);
    }
    const cardMax = Math.max(...cards);
    if (ratios.some(r => r === null)) return nullResult(`digit null on ${ratios.filter(r => r === null).length}/${ratios.length}; card/tower ${fmt(cardMax)}`);
    const rg = range(ratios);
    return result(ratios.every(r => within(r, limits.ratio)) && within(cardMax, limits.cardArea), { ratio: rg, cardMax }, `digit/tower w ${fmtRange(rg)}, card/tower area ${fmt(cardMax)}`);
  },
  M07({ magenta, limits }) {
    if (!magenta) return nullResult('no magenta pass');
    const share = voidShare(magenta);
    return result(within(share, limits.share), share, `void ${fmt(share * 100)}%`);
  },
  M09({ probe, hsv, limits }) {
    const q = probe.ground.playQuadScreen; if (!q) return nullResult('playQuadScreen null');
    const share = playQuadShares(hsv, polygonMask(hsv.width, hsv.height, q)).grassInside;
    return result(within(share, limits.share), share, `grass in play quad ${fmt(share)}`);
  },
  M10({ probe, hsv, limits }) {
    const q = probe.ground.playQuadScreen; if (!q) return nullResult('playQuadScreen null');
    const b = playQuadShares(hsv, polygonMask(hsv.width, hsv.height, q)).border;
    return borderResult(b, limits);
  },
  M11({ probe, hsv, limits }) {
    if (!probe.towers.length) return nullResult('no towers');
    const rows = probe.towers.map(t => paintResult(hsv, t.model, t.owner === null ? null : nearestTeam(t.paintHue), t.owner !== null, limits));
    return mergePaint(rows);
  },
  M14({ hsv, limits }) {
    const share = grassShare(hsv);
    return result(within(share, limits.share), share, `grass ${fmt(share)}`);
  },
  M16({ probe, hsv, limits, height, baseHeight }) {
    if (!probe.towers.length) return nullResult('no towers');
    const lim = scaleLimit(limits, height, baseHeight), hs = probe.towers.map(t => outlinedDigit(hsv, roofLocator(t))?.glyphH ?? null);
    if (hs.some(h => h === null)) return nullResult(`no outlined digit on ${hs.filter(h => h === null).length}/${hs.length} (min ${fmt(lim.min)} px)`);
    const min = Math.min(...hs);
    return result(within(min, lim), min, `min digit ${fmt(min)} px >= ${fmt(lim.min)}`);
  },
  M18({ probe, hsv, limits, refs }) {
    if (!refs?.length) return nullResult('no refs');
    const frameTv = bestTv(classVector(hsv), refs.map(r => r.frameVector));
    const first = ownedTowers(probe)[0];
    const towerTv = first ? bestTv(classVector(hsv, first.model, { fgOnly: true }), refs.flatMap(r => r.towerVectors)) : null;
    return result(within(frameTv, limits.frame) && within(towerTv, limits.tower), { frame: frameTv, tower: towerTv }, `TV frame ${fmt(frameTv)}, tower ${fmt(towerTv)}`);
  },
  M19({ frame, probe, hsv, limits }) {
    if (!probe.towers.length) return nullResult('no towers');
    const slots = frame.sim?.slots; if (!slots) return nullResult('no sim slots');
    const towers = probe.towers.map(t => ({ rect: t.model, team: t.owner === null ? null : nearestTeam(t.paintHue), slots: slots[isoIndex(frame, t.id)] }));
    return roofDecalResult(hsv, towers, limits);
  },
  M20({ probe, hsv, limits }) {
    const owned = ownedTowers(probe); if (!owned.length) return nullResult('no owned towers');
    return stripesResult(hsv, owned.map(t => ({ rect: t.model, team: nearestTeam(t.paintHue), floors: expectedFloors(t) })), limits);
  },
};

export function borderResult(b, limits) {
  return result(within(b.sandRock, limits.sandRock) && within(b.grass, limits.grass) && within(b.area, limits.area), b,
    `border sand+rock ${fmt(b.sandRock)}, grass ${fmt(b.grass)}, area ${fmt(b.area)}`);
}

/** One tower's M11 judgement. */
export function paintResult(hsv, rect, team, owned, limits) {
  if (owned && !team) return { pass: false, owned, value: null };
  const v = towerPaint(hsv, rect, owned ? team : null);
  if (!v) return { pass: false, owned, value: null };
  const pass = owned ? within(v.a, limits.a) && within(v.b, limits.b) && within(v.c, limits.c) : within(v.sat, limits.neutralSat) && within(v.greyWhite, limits.neutralGreyWhite);
  return { pass, owned, value: v };
}

export function mergePaint(rows) {
  const owned = rows.filter(r => r.owned), neutral = rows.filter(r => !r.owned);
  if (rows.some(r => r.value === null)) return nullResult(`paint null on ${rows.filter(r => r.value === null).length}/${rows.length} towers`);
  const pick = (list, k) => fmtRange(range(list.map(r => r.value[k])));
  const text = [owned.length ? `owned a ${pick(owned, 'a')} b ${pick(owned, 'b')} c ${pick(owned, 'c')}` : null, neutral.length ? `neutral sat ${pick(neutral, 'sat')} g+w ${pick(neutral, 'greyWhite')}` : null].filter(Boolean).join('; ');
  const failing = rows.filter(r => !r.pass).length;
  return result(failing === 0, rows.map(r => r.value), `${text}${failing ? ` (${failing}/${rows.length} fail)` : ''}`);
}

/** M19 over towers [{ rect, team, slots }]: outlined digit (h >= minDigitRatio x w) in the upper 45% and dot count == slots. */
export function roofDecalResult(hsv, towers, limits) {
  let numbers = 0, dots = 0; const counts = [];
  for (const t of towers) {
    const digit = outlinedDigit(hsv, roofRegion(t.rect)), okDigit = digit !== null && digit.glyphH >= limits.minDigitRatio * t.rect.w;
    const n = slotDots(hsv, t.rect, digit, t.team);
    if (okDigit) numbers++;
    if (typeof t.slots === 'number' && n === t.slots) dots++;
    counts.push(`${n}/${t.slots ?? '?'}`);
  }
  const numberShare = numbers / towers.length, dotsShare = dots / towers.length;
  return result(within(numberShare, limits.numberShare) && within(dotsShare, limits.dotsShare), { numberShare, dotsShare, counts },
    `outlined number ${fmt(numberShare)}, dots match ${fmt(dotsShare)} [${counts.join(' ')}]`);
}

/** M20 over owned towers [{ rect, team, floors }]: white runs in [max(1, floors-1), floors+1] and bands >= white runs. */
export function stripesResult(hsv, towers, limits) {
  let ok = 0; const parts = [];
  for (const t of towers) {
    if (!t.team || t.floors === null) { parts.push('null'); continue; }
    const fromY = decalBottom(hsv, t.rect, t.team);
    const s = floorStripes(hsv, t.rect, t.team, fromY);
    const pass = s !== null && s.whiteRuns >= Math.max(1, t.floors - limits.slack) && s.whiteRuns <= t.floors + limits.slack && s.bands >= s.whiteRuns;
    if (pass) ok++;
    parts.push(s ? `${s.whiteRuns}w/${s.bands}b~${t.floors}` : 'null');
  }
  const share = ok / towers.length;
  return result(within(share, limits.matchShare), { share, parts }, `stripes match ${fmt(share)} [${parts.join(' ')}]`);
}

const bestTv = (vector, refs) => { const d = refs.map(r => tvDistance(vector, r)).filter(v => v !== null); return d.length ? Math.min(...d) : null; };

/** Evaluates one metric for a capture job. Returns a table row. */
export function evaluate(id, ctx) {
  const fn = PROBE[id] ?? PIXEL[id];
  if (!fn) throw new Error(`unknown metric ${id}`);
  if (!ctx.probe && !id.startsWith('M13') && id !== 'M17') return { id, status: 'fail', value: null, text: 'no probe' };
  let r;
  try { r = fn(ctx); } catch (error) { r = nullResult(`error: ${error.message}`); }
  return { id, status: r.pass === null ? 'info' : r.pass ? 'pass' : 'fail', value: r.value ?? null, text: r.text };
}

/**
 * All rows for one capture job (scene x viewport). `pixels(png)` -> decoded RGBA (async, cached by caller) or null.
 */
export async function evaluateJob({ scene, viewport, entry, thresholds, run, refs, pixels }) {
  const rows = [], frame = primaryFrame(entry), height = Number(viewport.split('x')[1]), baseHeight = thresholds.pxBaseHeight ?? 1080;
  let hsv = null;
  for (const id of METRIC_IDS) {
    const def = thresholds.metrics[id];
    if (!def || !appliesTo(def, scene, viewport)) continue;
    const ctx = { entry, frame, probe: frame?.probe ?? null, def, limits: limitsFor(def, scene, viewport), scene, viewport, height, baseHeight, run, refs };
    if (PIXEL_IDS.includes(id) && id !== 'M07') {
      if (!hsv && frame?.png) { const img = await pixels(frame.png); hsv = img ? toHsv(img) : null; }
      if (!hsv) { rows.push({ id, scene, viewport, status: 'fail', value: null, text: `no pixels for ${frame?.png ?? 'frame'}` }); continue; }
      ctx.hsv = hsv;
    }
    if (id === 'M07') ctx.magenta = frame?.magenta?.png ? await pixels(frame.magenta.png) : null;
    rows.push({ ...evaluate(id, ctx), scene, viewport });
    if (id === 'M13') rows.push({ ...evaluate('M13fps', ctx), id, scene, viewport });
  }
  return rows;
}

// ---------- refs (visual:calibrate + M18 reference vectors) ----------

/** Ref record from ref-calib.json + decoded full image -> per-metric inputs in frame coordinates. */
export function prepareRef(spec, img) {
  const frameImg = crop(img, spec.frame), hsv = toHsv(frameImg);
  const local = b => ({ x: b[0] - spec.frame.x, y: b[1] - spec.frame.y, w: b[2] - b[0], h: b[3] - b[1] });
  const towers = spec.towers.map(t => {
    const rect = local(t.box), scaled = toHsv(resample(crop(frameImg, rect), REF_TOWER_WIDTH));
    return { ...t, rect, scaled, scaledRect: { x: 0, y: 0, w: scaled.width, h: scaled.height }, floors: t.team ? Math.min(5, Math.max(1, Math.ceil(5 * t.count / t.cap))) : null };
  });
  const play = { x: spec.playQuad.x - spec.frame.x, y: spec.playQuad.y - spec.frame.y, w: spec.playQuad.w, h: spec.playQuad.h };
  return {
    id: spec.id, hsv, towers, playMask: rectMask(hsv.width, hsv.height, play),
    frameVector: classVector(hsv), towerVectors: towers.filter(t => t.team).map(t => classVector(hsv, t.rect, { fgOnly: true })),
  };
}

/** visual:calibrate rows for one prepared ref; `others` = the other prepared refs (M18 compares against them). */
export function calibrateRef(ref, others, thresholds) {
  const L = id => limitsFor(thresholds.metrics[id], 'l01', '1366x768'), rows = [];
  const push = (id, r) => rows.push({ id, scene: ref.id, viewport: `${ref.hsv.width}x${ref.hsv.height}`, status: r.pass === null ? 'info' : r.pass ? 'pass' : 'fail', value: r.value ?? null, text: r.text });
  const shares = playQuadShares(ref.hsv, ref.playMask);
  push('M09', result(within(shares.grassInside, L('M09').share), shares.grassInside, `grass in play band ${fmt(shares.grassInside)}`));
  push('M10', borderResult(shares.border, L('M10')));
  push('M11', mergePaint(ref.towers.map(t => paintResult(ref.hsv, t.rect, t.team, Boolean(t.team), L('M11')))));
  const grass = grassShare(ref.hsv);
  push('M14', result(within(grass, L('M14').share), grass, `grass ${fmt(grass)}`));
  const frameTv = bestTv(ref.frameVector, others.map(o => o.frameVector)), first = ref.towers.find(t => t.team);
  const towerTv = first ? bestTv(classVector(ref.hsv, first.rect, { fgOnly: true }), others.flatMap(o => o.towerVectors)) : null;
  push('M18', result(within(frameTv, L('M18').frame) && within(towerTv, L('M18').tower), { frame: frameTv, tower: towerTv }, `TV frame ${fmt(frameTv)}, tower ${fmt(towerTv)} (vs ${others.map(o => o.id).join(',')})`));
  // Size-dependent pixel parts on crops rescaled to REF_TOWER_WIDTH (67 px = M01 band max at 1366x768; M16's calibration base).
  const m02 = ref.towers.map(t => { const h = digitHeight(t.scaled, roofRegion(t.scaledRect)); return h === null ? null : h / t.scaledRect.w; });
  push('M02', m02.some(v => v === null) ? nullResult(`digit null on ${m02.filter(v => v === null).length}/${m02.length}`)
    : result(m02.every(v => within(v, L('M02').ratio)), range(m02), `digit/tower w ${fmtRange(range(m02))} [${m02.map(fmt).join(' ')}]`));
  const m16Lim = scaleLimit(L('M16'), 768, 1080), m16 = ref.towers.map(t => outlinedDigit(t.scaled, roofRegion(t.scaledRect))?.glyphH ?? null);
  push('M16', m16.some(v => v === null) ? nullResult(`no outlined digit on ${m16.filter(v => v === null).length}/${m16.length}`)
    : result(within(Math.min(...m16), m16Lim), Math.min(...m16), `min digit ${fmt(Math.min(...m16))} px >= ${fmt(m16Lim.min)}`));
  push('M19', roofDecalPerTower(ref, L('M19')));
  push('M20', stripesPerTower(ref, L('M20')));
  return rows;
}

/**
 * visual:calibrate (b) rows for the landscape mock (visual/calib/mock-landscape.html): M09, M10, M14 on a 1920x1080 frame whose
 * play quad (`quad`, 4 screen points, same as ground.playQuadScreen) has border on every side. Limits as for l01@1920x1080.
 */
export function calibrateMock(hsv, quad, thresholds, scene = 'mock-landscape') {
  const L = id => limitsFor(thresholds.metrics[id], 'l01', '1920x1080'), rows = [];
  const push = (id, r) => rows.push({ id, scene, viewport: `${hsv.width}x${hsv.height}`, status: r.pass === null ? 'info' : r.pass ? 'pass' : 'fail', value: r.value ?? null, text: r.text });
  const shares = playQuadShares(hsv, polygonMask(hsv.width, hsv.height, quad));
  push('M09', result(within(shares.grassInside, L('M09').share), shares.grassInside, `grass in play quad ${fmt(shares.grassInside)}`));
  push('M10', borderResult(shares.border, L('M10')));
  const grass = grassShare(hsv);
  push('M14', result(within(grass, L('M14').share), grass, `grass ${fmt(grass)}`));
  return rows;
}

function roofDecalPerTower(ref, limits) {
  // Each tower is measured on its own rescaled crop (shared hsv not possible), then merged.
  let numbers = 0, dots = 0; const parts = [];
  for (const t of ref.towers) {
    const r = roofDecalResult(t.scaled, [{ rect: t.scaledRect, team: t.team, slots: t.slots }], limits);
    numbers += r.value.numberShare; dots += r.value.dotsShare; parts.push(`${r.value.numberShare ? '#' : '-'}${r.value.counts[0]}`);
  }
  const numberShare = numbers / ref.towers.length, dotsShare = dots / ref.towers.length;
  return result(within(numberShare, limits.numberShare) && within(dotsShare, limits.dotsShare), { numberShare, dotsShare }, `outlined number ${fmt(numberShare)}, dots match ${fmt(dotsShare)} [${parts.join(' ')}] (#=outlined digit, dots/slots)`);
}

function stripesPerTower(ref, limits) {
  const owned = ref.towers.filter(t => t.team); let ok = 0; const parts = [];
  for (const t of owned) { const r = stripesResult(t.scaled, [{ rect: t.scaledRect, team: t.team, floors: t.floors }], limits); ok += r.value.share; parts.push(...r.value.parts); }
  const share = ok / owned.length;
  return result(within(share, limits.matchShare), share, `stripes match ${fmt(share)} [${parts.join(' ')}]`);
}

// ---------- table ----------

/** Plain-text table; deterministic for identical inputs. */
export function formatTable(rows, thresholds) {
  const head = ['ID', 'St', 'scene@viewport', 'result', 'value'];
  const body = rows.map(r => [r.id, thresholds.metrics[r.id]?.status ?? '?', `${r.scene}@${r.viewport}`, r.status.toUpperCase(), r.text]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)));
  const line = cells => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join('  ');
  return [line(head), widths.map(w => '-'.repeat(w)).join('  '), ...body.map(line)].join('\n');
}

/** Per-metric verdict: fail if any row fails, info if all rows are info, else pass; missing = no rows. */
export function summarize(rows) {
  const out = {};
  for (const id of METRIC_IDS) {
    const mine = rows.filter(r => r.id === id);
    out[id] = !mine.length ? 'missing' : mine.some(r => r.status === 'fail') ? 'fail' : mine.every(r => r.status === 'info') ? 'info' : 'pass';
  }
  return out;
}
