// Pure scene/argument helpers for visual:capture (no browser). Unit-tested in test/visual-scenes.test.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VISUAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEB_DIR = path.resolve(VISUAL_DIR, '..');
export const OUT_DIR = path.join(WEB_DIR, 'visual-out');
export const PORT = 4174;
export const VIEWPORTS = ['1920x1080', '1366x768', '1920x1200'];

export function loadScenes(file = path.join(VISUAL_DIR, 'scenes.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** `--scene id`, `--viewport WxH` (repeatable or comma list), `--headed`, `--gpu`, `--dev`, `--no-build`. */
export function parseArgs(argv) {
  const opts = { scenes: [], viewports: [], headed: false, gpu: false, dev: false, build: true };
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
  const known = new Set(config.scenes.map(s => s.id));
  for (const id of opts.scenes) if (!known.has(id)) throw new Error(`unknown scene ${id} (expected ${[...known].join('|')})`);
  const jobs = [];
  for (const scene of config.scenes) {
    if (opts.scenes.length && !opts.scenes.includes(scene.id)) continue;
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
