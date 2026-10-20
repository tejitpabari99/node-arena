// Pure scene/argument helpers for visual:capture (no browser). Unit-tested in test/visual-scenes.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VISUAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEB_DIR = path.resolve(VISUAL_DIR, '..');
export const OUT_DIR = path.join(WEB_DIR, 'visual-out');
export const PORT = 4174;
export const LEVELS_DIR = path.resolve(VISUAL_DIR, '../../../packages/content/data/levels');
/** `--all-levels` capture tick (PRD SP05 R6). */
export const ALL_LEVELS_TICK = 400;
export const VIEWPORTS = ['1920x1080', '1366x768', '1920x1200'];

export function loadScenes(file = path.join(VISUAL_DIR, 'scenes.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * `--all-levels` scenes (PRD SP05 R6): one per shipped level (`content/levels/NN-name.json`, not `sample.json`), id `lvl-NN`,
 * no scripted commands, one settled frame at tick 400. Selected by `--all-levels` or `--scene lvl-NN`.
 */
export function levelScenes(dir = LEVELS_DIR) {
  return fs.readdirSync(dir).filter(f => /^\d{2}-.+\.json$/.test(f)).sort()
    .map(f => ({ id: `lvl-${f.slice(0, 2)}`, level: f.replace(/\.json$/, ''), generated: true, frames: [{ tick: ALL_LEVELS_TICK }] }));
}

/** scenes.json scenes plus the generated level scenes (metrics.json key order, valid `--scene` ids). */
export function allScenes(config, dir = LEVELS_DIR) {
  return [...config.scenes, ...levelScenes(dir)];
}

/** `--scene id`, `--viewport WxH` (repeatable or comma list), `--headed`, `--gpu`, `--dev`, `--no-build`, `--all-levels`, `--throttle N` / `--dpr N` / `--perf-quality q` (perf sample only: CDP CPU slowdown, device scale factor, quality override; SP05 R7 proxy), `--perf-only` (skip screenshots, perf sample only), `--lod low|high` (adds `?lod=` to the app URL; default auto). */
/** Run-record filename: `--perf-only` must not clobber the full-capture run.json (it leaves metrics.json untouched). */
export const runFileName = opts => (opts.perfOnly ? 'perf-run.json' : 'run.json');

export function parseArgs(argv) {
  const opts = { scenes: [], viewports: [], headed: false, gpu: false, dev: false, build: true, lod: null, allLevels: false, throttle: 1, dpr: 1, perfQuality: null, perfOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = () => { const v = inline ?? argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`); return v; };
    if (flag === '--scene') opts.scenes.push(...value().split(','));
    else if (flag === '--viewport') opts.viewports.push(...value().split(','));
    else if (flag === '--headed') opts.headed = true;
    else if (flag === '--gpu') opts.gpu = true;
    else if (flag === '--dev') opts.dev = true;
    else if (flag === '--no-build') opts.build = false;
    else if (flag === '--all-levels') opts.allLevels = true;
    else if (flag === '--lod') { opts.lod = value(); if (!['low', 'high'].includes(opts.lod)) throw new Error('--lod expects low|high'); }
    else if (flag === '--throttle') { opts.throttle = Number(value()); if (!(opts.throttle >= 1)) throw new Error('--throttle expects a CPU slowdown factor >= 1'); }
    else if (flag === '--dpr') { opts.dpr = Number(value()); if (!(opts.dpr >= 1)) throw new Error('--dpr expects a device scale factor >= 1'); }
    else if (flag === '--perf-quality') { opts.perfQuality = value(); if (!['low', 'med', 'high'].includes(opts.perfQuality)) throw new Error('--perf-quality expects low|med|high'); }
    else if (flag === '--perf-only') opts.perfOnly = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  for (const v of opts.viewports) if (!VIEWPORTS.includes(v)) throw new Error(`unknown viewport ${v} (expected ${VIEWPORTS.join('|')})`);
  if (opts.dev) opts.build = false;
  return opts;
}

export function parseViewport(id) {
  const [width, height] = id.split('x').map(Number);
  return { width, height };
}

/** Every (scene, viewport) capture job, in scenes.json order; filters from parseArgs. */
export function captureJobs(config, opts = { scenes: [], viewports: [] }) {
  const scenes = allScenes(config), known = new Set(scenes.map(s => s.id));
  for (const id of opts.scenes) if (!known.has(id)) throw new Error(`unknown scene ${id} (expected ${[...known].join('|')})`);
  const jobs = [];
  for (const scene of scenes) {
    if (opts.scenes.length ? !opts.scenes.includes(scene.id) : Boolean(opts.allLevels) !== Boolean(scene.generated)) continue;
    const viewports = [...config.viewports, ...Object.entries(config.extraViewports ?? {}).filter(([, ids]) => ids.includes(scene.id)).map(([v]) => v)];
    for (const viewport of viewports) if (!opts.viewports.length || opts.viewports.includes(viewport)) jobs.push({ scene, viewport });
  }
  return jobs;
}

/** `<scene>-<WxH>.png` for the primary frame, `<scene>-<WxH>-<label>.png` for labelled frames. */
export function frameFile(sceneId, viewport, label) {
  return `${sceneId}-${viewport}${label ? `-${label}` : ''}.png`;
}

/** Frames with defaults; level scenes default to one settled frame, screen scenes to one frame. */
export function sceneFrames(scene) {
  return (scene.frames ?? [{}]).map(f => ({ label: null, settle: true, ...f }));
}
