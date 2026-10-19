// Pure judging helpers for visual:selfcheck (PRD SP01 AC: same commit + machine => identical PNG SHA-256;
// fallback <=0.01% differing pixels, channel delta <=2, metrics.json identical after dropping `perf`).
import { PIXEL_FALLBACK } from './pixels.mjs';

/** One PNG pair: 'identical' (same SHA-256), 'near' (inside the PRD fallback) or 'fail'. */
export function judgePng(shaA, shaB, diff, limits = PIXEL_FALLBACK) {
  if (!shaA || !shaB) return { status: 'fail', reason: `missing in run ${shaA ? 2 : 1}` };
  if (shaA === shaB) return { status: 'identical' };
  if (!diff) return { status: 'fail', reason: 'hash differs, no pixel diff' };
  if (diff.sizeMismatch) return { status: 'fail', reason: `size ${diff.a.w}x${diff.a.h} != ${diff.b.w}x${diff.b.h}`, diff };
  const share = diff.differing / diff.total;
  if (diff.differing === 0) return { status: 'near', reason: 'pixels identical, encoding differs', diff, share };
  const ok = share <= limits.maxShare && diff.maxDelta <= limits.maxDelta;
  return { status: ok ? 'near' : 'fail', reason: `${diff.differing} px (${(share * 100).toFixed(4)}%), max delta ${diff.maxDelta}`, diff, share };
}

function dropKeys(value, drop) {
  if (Array.isArray(value)) return value.map(v => dropKeys(v, drop));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!drop(k)) out[k] = dropKeys(v, drop);
    return out;
  }
  return value;
}

/**
 * metrics.json reduced to the captured jobs (`scene@WxH`), `perf` removed at any depth, and the
 * SHA-256 fields (frame + laneCrop, magenta pass) removed only for PNGs judged near-identical.
 */
export function comparableMetrics(metrics, jobs, relaxedPngs) {
  const out = {};
  for (const job of jobs) {
    const [scene, viewport] = job.split('@');
    const entry = metrics?.scenes?.[scene]?.[viewport];
    if (!entry) { out[job] = null; continue; }
    const clean = dropKeys(entry, k => k === 'perf');
    for (const frame of clean.frames ?? []) {
      if (!relaxedPngs.has(frame.png)) continue;
      delete frame.sha256;
      if (frame.laneCrop) delete frame.laneCrop.sha256;
    }
    for (const frame of clean.frames ?? []) if (frame.magenta && relaxedPngs.has(frame.magenta.png)) delete frame.magenta.sha256;
    out[job] = clean;
  }
  return out;
}

/** Structural diff: list of `path: a != b` strings (empty when deep-equal). */
export function diffJson(a, b, at = '$', out = []) {
  if (Object.is(a, b)) return out;
  const fmt = v => (v === undefined ? 'undefined' : JSON.stringify(v));
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push(`${at}.length: ${a.length} != ${b.length}`); return out; }
    a.forEach((v, i) => diffJson(v, b[i], `${at}[${i}]`, out));
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) diffJson(a[k], b[k], `${at}.${k}`, out);
    return out;
  }
  out.push(`${at}: ${fmt(a)} != ${fmt(b)}`);
  return out;
}

/** 'identical' | 'near-identical' | 'fail' over all PNG judgements, metrics diffs and lint hits. */
export function verdict({ pngs, metricsDiffs, lintHits }) {
  if (lintHits.length || metricsDiffs.length || !pngs.length || pngs.some(p => p.status === 'fail')) return 'fail';
  return pngs.some(p => p.status === 'near') ? 'near-identical' : 'identical';
}
