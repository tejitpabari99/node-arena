#!/usr/bin/env node
// visual:capture (PRD SP01 Req 1, 2, 4, 9): deterministic screenshots + probe JSON of the scenes in scenes.json.
// Usage: pnpm --filter @node-arena/web visual:capture [--scene id] [--viewport WxH] [--headed] [--gpu] [--dev] [--no-build]
// Output (git-ignored): apps/web/visual-out/{<scene>-<WxH>[-<label>].png, metrics.json, run.json}
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { captureJobs, frameFile, loadScenes, OUT_DIR, parseArgs, parseViewport, sceneFrames } from './lib/scenes.mjs';
import { BASE_URL, buildTest, CLOCK_TIME, gitCommit, launch, newContext, resolveFonts, startServer, until } from './lib/browser.mjs';

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const log = (...a) => console.log('[visual:capture]', ...a);

/** Headed without an X display: start a private Xvfb (xvfb-run needs xauth, often missing). Returns a stop function. */
async function ensureDisplay(opts) {
  if (!opts.headed || process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return () => {};
  if (spawnSync('sh', ['-c', 'command -v Xvfb'], { encoding: 'utf8' }).status !== 0) throw new Error('--headed needs a display (DISPLAY unset and Xvfb not found)');
  let n = 99;
  while (fs.existsSync(`/tmp/.X11-unix/X${n}`) || fs.existsSync(`/tmp/.X${n}-lock`)) n++;
  const xvfb = spawn('Xvfb', [`:${n}`, '-screen', '0', '1920x1200x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
  for (let i = 0; i < 100 && !fs.existsSync(`/tmp/.X11-unix/X${n}`); i++) {
    if (xvfb.exitCode !== null) throw new Error(`Xvfb :${n} exited (${xvfb.exitCode})`);
    await new Promise(r => setTimeout(r, 50));
  }
  process.env.DISPLAY = `:${n}`;
  log(`no DISPLAY: headed run on private Xvfb :${n}`);
  return () => xvfb.kill('SIGTERM');
}

/** Final-frame recipe: double render, clock frames around fonts.ready (rAF/font continuations need the clock advanced). */
async function finishFrame(page, settle) {
  await page.evaluate(s => { window.__na.render({ settle: s }); window.__na.render({ settle: s }); }, settle);
  await page.clock.runFor(32);
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.clock.runFor(32);
}

async function screenshot(page, file) {
  const buf = await page.screenshot({ path: path.join(OUT_DIR, file), animations: 'disabled', caret: 'hide' });
  return { png: file, sha256: sha256(buf) };
}

async function pageFonts(page) {
  return page.evaluate(() => ({
    css: [...new Set([...document.querySelectorAll('*')].map(e => getComputedStyle(e).fontFamily))].sort(),
    faces: [...document.fonts].map(f => `${f.family}|${f.weight}|${f.style}|${f.status}`).sort(),
  }));
}

/** Command identity for matching scripted commands against the replay record. */
const commandKey = c => `${c.type}|${c.player}|${c.from ?? ''}|${c.to ?? ''}`;

async function captureLevel(page, scene, config, viewport) {
  const frames = sceneFrames(scene);
  const commands = (scene.commands ?? []).map(c => ({ ...c, tick: c.tick ?? 0 })).sort((a, b) => a.tick - b.tick);
  const seed = config.seed;
  await page.evaluate(([id, s]) => { window.__visualLoad = window.__na.load(id, s).then(() => 'ok', e => String(e?.stack ?? e)); }, [scene.level, seed]);
  await until(page, () => window.__na.screen === 'playing', undefined, { what: `level ${scene.level} playing` });
  await until(page, () => window.__visualLoad !== undefined, undefined, { what: 'load promise' });
  const loaded = await page.evaluate(() => window.__visualLoad);
  if (loaded !== 'ok') throw new Error(`load ${scene.level} failed: ${loaded}`);

  const tick = () => page.evaluate(() => window.__na.view.tick);
  const out = { level: scene.level, fixture: scene.fixture ?? null, seed, frames: [] };
  let pending = [...commands], motion = false, traceEnd = null;
  const trace = [];
  const recordTrace = async () => {
    const t = await tick();
    if (traceEnd === null || t > traceEnd) return;
    trace.push(await page.evaluate(t => {
      const p = window.__na.visualProbe(), pair = p.clash.eventPair;
      return { tick: t, lanes: p.lanes.filter(l => pair === null || l.pair === pair).map(l => ({ pair: l.pair, from: l.from, to: l.to, splitWorld: l.splitWorld, splitScreen: l.splitScreen })),
        clashTick: p.clash.eventTick, clashPair: pair, eventScreen: p.clash.eventScreen };
    }, t));
  };
  /** Step to `target`, submitting due commands (after a settled render, so mid-run commands act on a settled frame). */
  const advanceTo = async (target, { perTick = false, settle = true } = {}) => {
    for (;;) {
      const now = await tick();
      const due = pending.filter(c => c.tick <= now);
      if (due.length) {
        if (now > 0) await page.evaluate(() => window.__na.render({ settle: true }));
        for (const cmd of due) {
          const { tick: _t, ...command } = cmd;
          const ok = await page.evaluate(c => window.__na.submit(c) !== null, command);
          if (!ok) throw new Error(`submit ${commandKey(cmd)} at tick ${now} refused (driver cannot step)`);
        }
        pending = pending.filter(c => !due.includes(c));
      }
      if (now >= target) return;
      const nextCommand = pending.length ? pending[0].tick : Infinity;
      const stop = Math.min(target, nextCommand, perTick ? now + 1 : Infinity);
      const stepped = await page.evaluate(([n, s]) => { const k = window.__na.step(n); if (!s) window.__na.render({ settle: false }); return k; }, [stop - now, settle]);
      if (stepped === 0) throw new Error(`sim stopped at tick ${now} before ${target} (game over or paused)`);
      if (perTick) await recordTrace();
    }
  };

  let previous = 0, laneRect = null;
  for (const frame of frames) {
    if (!frame.settle && !motion) {
      // Unsettled frames show animation: game reducedMotion off and no prefers-reduced-motion.
      await page.evaluate(() => window.__na.settings({ reducedMotion: false }));
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      motion = true;
    }
    let target;
    if (frame.tick !== undefined) target = frame.tick;
    else if (frame.relative !== undefined) target = previous + frame.relative;
    else if (frame.after) {
      await advanceTo(await tick());
      const found = await page.evaluate(([type, max]) => {
        for (let i = 0; i < max; i++) {
          const hit = window.__na.events.find(e => e.type === type);
          if (hit) return hit.tick;
          if (window.__na.step(1) === 0) return null;
        }
        return null;
      }, [frame.after.event, 5000]);
      if (found === null) throw new Error(`no ${frame.after.event} event`);
      target = found + frame.after.plus;
    } else throw new Error(`frame without tick/relative/after in ${scene.id}`);
    if (target < await tick()) throw new Error(`frame tick ${target} already passed in ${scene.id}`);
    await advanceTo(target, { perTick: traceEnd !== null, settle: frame.settle });
    await finishFrame(page, frame.settle);
    if (scene.laneCrop && !laneRect) laneRect = await page.evaluate(({ from, to, w, h }) => {
      const a = window.__na.project(from), b = window.__na.project(to), pad = 24;
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - pad)), y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - pad));
      const x1 = Math.min(w, Math.ceil(Math.max(a.x, b.x) + pad)), y1 = Math.min(h, Math.ceil(Math.max(a.y, b.y) + pad));
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }, { ...scene.laneCrop, w: viewport.width, h: viewport.height });
    const state = await page.evaluate(() => ({ tick: window.__na.view.tick, hash: window.__na.hash(), over: window.__na.view.over, screen: window.__na.screen, probe: window.__na.visualProbe() }));
    const shot = await screenshot(page, frameFile(scene.id, `${viewport.width}x${viewport.height}`, frame.label));
    const entry = { label: frame.label, settle: frame.settle, ...shot, tick: state.tick, simHash: state.hash, over: state.over, screen: state.screen, probe: state.probe };
    if (laneRect) entry.laneCrop = { rect: laneRect, sha256: sha256(await page.screenshot({ clip: laneRect, animations: 'disabled', caret: 'hide' })) };
    out.frames.push(entry);
    previous = state.tick;
    if (scene.splitTrace && traceEnd === null) { traceEnd = state.tick + scene.splitTrace.ticks - 1; await recordTrace(); }
  }
  if (traceEnd !== null) {
    await advanceTo(traceEnd, { perTick: true, settle: false });
    out.splitTrace = trace;
  }
  if (laneRect) {
    const hashes = out.frames.map(f => f.laneCrop.sha256);
    out.laneCrop = { from: scene.laneCrop.from, to: scene.laneCrop.to, rect: laneRect, framesDistinct: new Set(hashes).size === hashes.length };
  }
  // Event-log verification: every command beyond the scripted ones is a bot command.
  const record = await page.evaluate(() => ({ commands: window.__na.replay().record.commands, rejected: window.__na.events.filter(e => e.type === 'CommandRejected') }));
  const scripted = commands.map(commandKey), botCommands = [];
  for (const entry of record.commands) {
    const cmd = entry.cmd ?? entry.command ?? entry;
    const i = scripted.indexOf(commandKey(cmd));
    if (i >= 0) scripted.splice(i, 1); else botCommands.push({ tick: entry.tick, ...cmd });
  }
  const lastTick = out.frames.at(-1).tick;
  out.botCommands = botCommands;
  out.botCommandsThroughLastFrame = botCommands.filter(c => c.tick <= lastTick).length;
  out.rejected = record.rejected;
  out.scriptedMissing = scripted;
  return out;
}

async function captureJob(browser, config, scene, viewportId) {
  const viewport = parseViewport(viewportId);
  const context = await newContext(browser, viewport);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e?.stack ?? e)));
  try {
    await page.clock.install({ time: CLOCK_TIME });
    await page.goto(`${BASE_URL}/?test=1${scene.fixture ? `&fixture=${scene.fixture}` : ''}`);
    await until(page, () => window.__na?.screen === 'menu', undefined, { what: 'menu screen' });
    await page.mouse.move(viewport.width - 1, 0); // parked: top-right corner, away from towers/lanes/HUD buttons
    const settings = { ...config.settings, ...(scene.settings ?? {}) };
    await page.evaluate(s => window.__na.settings(s), settings);
    let result;
    if (scene.screen === 'menu') {
      result = { frames: [] };
    } else if (scene.screen === 'picker') {
      await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Play').click());
      await until(page, () => window.__na.screen === 'picker' && document.querySelectorAll('.level-grid button').length > 0, undefined, { what: 'picker screen' });
      result = { frames: [] };
    } else {
      result = await captureLevel(page, scene, config, viewport);
    }
    if (scene.screen) {
      await page.clock.runFor(32);
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await page.clock.runFor(32);
      const shot = await screenshot(page, frameFile(scene.id, viewportId, null));
      result.frames.push({ label: null, settle: true, ...shot, screen: await page.evaluate(() => window.__na.screen) });
    }
    if (errors.length) throw new Error(`page errors in ${scene.id} ${viewportId}:\n${errors.join('\n')}`);
    return { result: { scene: scene.id, viewport: viewportId, settings, ...result }, fonts: await pageFonts(page) };
  } finally {
    await context.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = loadScenes();
  const jobs = captureJobs(config, opts);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (opts.build) { log('building dist-test (pnpm build:test)'); buildTest(); }
  const stopDisplay = await ensureDisplay(opts);
  const server = await startServer({ dev: opts.dev });
  const { browser, args } = await launch(opts);
  const started = Date.now();
  try {
    const metricsFile = path.join(OUT_DIR, 'metrics.json');
    const previous = opts.scenes.length || opts.viewports.length ? (fs.existsSync(metricsFile) ? JSON.parse(fs.readFileSync(metricsFile, 'utf8')) : null) : null;
    const scenes = {};
    for (const s of config.scenes) if (previous?.scenes?.[s.id]) scenes[s.id] = previous.scenes[s.id];
    const css = new Set(), faces = new Set(), written = [];
    for (const { scene, viewport } of jobs) {
      let job = await captureJob(browser, config, scene, viewport);
      if (scene.silentBots && job.result.botCommandsThroughLastFrame > 0) {
        if (!scene.fallback) throw new Error(`${scene.id} ${viewport}: bots emitted ${job.result.botCommandsThroughLastFrame} commands in the capture window`);
        log(`${scene.id} ${viewport}: bots emitted commands; falling back to ${scene.fallback.fixture ?? scene.fallback.level}`);
        job = await captureJob(browser, config, { ...scene, ...scene.fallback, fallback: undefined }, viewport);
        job.result.fallbackUsed = true;
        if (job.result.botCommandsThroughLastFrame > 0) throw new Error(`${scene.id} ${viewport}: fallback also has bot commands`);
      }
      const { result, fonts } = job;
      fonts.css.forEach(f => css.add(f)); fonts.faces.forEach(f => faces.add(f));
      (scenes[scene.id] ??= {})[viewport] = result;
      written.push(...result.frames.map(f => f.png));
      log(`${scene.id} ${viewport}: ${result.frames.map(f => `${f.png}${f.tick !== undefined ? `@${f.tick}` : ''}`).join(', ')}${result.laneCrop ? ` laneCropDistinct=${result.laneCrop.framesDistinct}` : ''}${result.botCommands?.length ? ` botCommands=${result.botCommands.length}` : ''}`);
    }
    // Stable key order: scenes.json order, viewports in capture order.
    const ordered = {};
    for (const s of config.scenes) if (scenes[s.id]) ordered[s.id] = scenes[s.id];
    fs.writeFileSync(metricsFile, `${JSON.stringify({ schema: 1, seed: config.seed, scenes: ordered }, null, 2)}\n`);

    const glPage = await browser.newPage();
    const renderer = await glPage.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
    });
    await glPage.close();
    const families = [...new Set([...css].flatMap(f => f.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''))))].sort();
    const fonts = { css: [...css].sort(), faces: [...faces].sort(), resolved: resolveFonts(families) };
    const run = {
      commit: gitCommit(), chromium: browser.version(), renderer, gpu: opts.gpu, headed: opts.headed, server: opts.dev ? 'vite dev' : 'vite preview dist-test',
      args, seed: config.seed, settings: config.settings, clock: CLOCK_TIME.toISOString(), fontHash: sha256(JSON.stringify(fonts)), fonts,
      filters: { scenes: opts.scenes, viewports: opts.viewports }, jobs: jobs.map(j => `${j.scene.id}@${j.viewport}`), files: written,
      startedAt: new Date(started).toISOString(), durationMs: Date.now() - started,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
    log(`${jobs.length} captures, ${written.length} PNGs -> ${path.relative(process.cwd(), OUT_DIR) || OUT_DIR} (renderer: ${renderer?.renderer ?? 'none'})`);
  } finally {
    await browser.close();
    server.stop();
    stopDisplay();
  }
}

main().catch(error => { console.error('[visual:capture] FAILED:', error?.stack ?? error); process.exit(1); });
