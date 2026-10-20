#!/usr/bin/env node
// visual:capture (PRD SP01 Req 1, 2, 4, 9): deterministic screenshots + probe JSON of the scenes in scenes.json.
// Usage: pnpm --filter @node-arena/web visual:capture [--scene id] [--viewport WxH] [--headed] [--gpu] [--dev] [--no-build] [--all-levels]
// Output (git-ignored): apps/web/visual-out/{<scene>-<WxH>[-<label>].png, <scene>-<WxH>[-<label>]-magenta.png (M07 pass, first frame
// of each level job), metrics.json (probe + dom + sim per frame; l18@1920x1080 `perf` for M13), run.json}
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { allScenes, captureJobs, frameFile, loadScenes, OUT_DIR, parseArgs, parseViewport, sceneFrames } from './lib/scenes.mjs';
import { collectHud, HUD_SELECTORS } from './lib/hud-metrics.mjs';
import { BASE_URL, buildTest, CLOCK_TIME, gitCommit, launch, newContext, resolveFonts, startServer, until } from './lib/browser.mjs';

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
/** Set from `--lod`: appended to the app URL so the harness can force a troop LOD set. */
let LOD_QUERY = '';
const log = (...a) => console.log('[visual:capture]', ...a);
/** SwiftShader screenshots of 1920px WebGL frames can exceed Playwright's 30 s default when the host is loaded. */
const SHOT_TIMEOUT = 120_000;
/** M13 perf sample: fresh page after the captures (stored as `perf`, which selfcheck ignores). */
const PERF = { scene: 'l18', viewport: '1920x1080', durationMs: 5000, warmupMs: 0 };
/** R7 `--gpu` perf mode: 5 s warm-up then a 30 s sample (default capture timing is untouched). */
const PERF_GPU = { durationMs: 30_000, warmupMs: 5000 };

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
  const buf = await page.screenshot({ path: path.join(OUT_DIR, file), animations: 'disabled', caret: 'hide', timeout: SHOT_TIMEOUT });
  return { png: file, sha256: sha256(buf) };
}

async function pageFonts(page) {
  return page.evaluate(() => ({
    css: [...new Set([...document.querySelectorAll('*')].map(e => getComputedStyle(e).fontFamily))].sort(),
    faces: [...document.fonts].map(f => `${f.family}|${f.weight}|${f.style}|${f.status}`).sort(),
  }));
}

/**
 * Per-frame record beside the probe (metrics M02/M12/M17/M19): DOM label/summary counts and card rects (page DOM, M17/M02),
 * and sim-view facts (slots per tower, troop kinds, tower world + projected screen positions) — not renderer self-reports.
 */
function frameState() {
  const na = window.__na, v = na.view, r3 = n => Math.round(n * 1000) / 1000;
  return {
    tick: v.tick, hash: na.hash(), over: v.over, screen: na.screen, probe: na.visualProbe(),
    dom: {
      labels: document.querySelectorAll('[data-tower-index], .tower-label').length,
      summary: document.querySelectorAll('[data-tower-summary]').length,
      cards: [...document.querySelectorAll('[data-tower-index]')].map(e => { const b = e.getBoundingClientRect(); return { index: Number(e.getAttribute('data-tower-index')), x: r3(b.x), y: r3(b.y), w: r3(b.width), h: r3(b.height) }; }),
    },
    sim: {
      slots: [...v.tower.slots], lines: [...v.tower.lines], kinds: v.kinds.map(k => ({ id: k.id, speedPerTick: k.speedPerTick })),
      towers: v.ids.towers.map((id, i) => { const p = na.project(id); return { id, x: v.towerStatic[i].x / 1000, z: v.towerStatic[i].y / 1000, screen: { x: r3(p.x), y: r3(p.y) } }; }),
    },
  };
}

/** M07: the same frame re-rendered with the clear colour forced to magenta, then the theme background restored. */
async function magentaPass(page, file, settle) {
  const paint = hex => page.evaluate(([h, s]) => { window.__na.clearColor(h); window.__na.render({ settle: s }); window.__na.render({ settle: s }); }, [hex, settle]);
  await paint('#ff00ff');
  await page.clock.runFor(32);
  const shot = await screenshot(page, file);
  await paint(null);
  await page.clock.runFor(32);
  return shot;
}

/**
 * M13 perf (PRD: l18, 5 s real time, fresh page, no clock): sim stepped at 20 Hz from real time, one render per rAF.
 * fps/frame p95 from rAF intervals, jsMs = step + render CPU per frame, drawCalls = max renderer.info calls.
 */
async function capturePerf(browser, config, scene, durationMs, warmupMs = 0, proxy = {}) {
  const { throttle = 1, dpr = 1, quality = null } = proxy;
  const context = await newContext(browser, { width: 1920, height: 1080 }, { deviceScaleFactor: dpr });
  const page = await context.newPage();
  try {
    if (throttle > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await page.goto(`${BASE_URL}/?test=1`);
    await page.waitForFunction(() => window.__na?.screen === 'menu');
    await page.evaluate(s => window.__na.settings(s), { ...config.settings, ...(scene.settings ?? {}), ...(quality ? { quality } : {}) });
    await page.evaluate(([id, s]) => window.__na.load(id, s), [scene.level, config.seed]);
    await page.waitForFunction(() => window.__na.screen === 'playing');
    const target = sceneFrames(scene)[0].tick ?? 0;
    await page.evaluate(([cmds, t]) => { for (const c of cmds) window.__na.submit(c); window.__na.step(t); }, [(scene.commands ?? []).filter(c => !c.tick).map(({ tick: _t, ...c }) => c), target]);
    return await page.evaluate(async ([ms, warmup, proxyThrottle, proxyDpr, proxyQuality]) => {
      const pct = (list, q) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.ceil(s.length * q) - 1] : null; };
      const mean = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
      const frames = [], js = [], calls = [], tris = [], origin = performance.now();
      let t0 = origin, last = t0, ticks = 0;
      // Warm-up (shader compile, texture upload, first sim catch-up): same loop, nothing recorded.
      const loop = async (until, record) => {
        while (performance.now() < until) {
          await new Promise(r => requestAnimationFrame(() => r()));
          const now = performance.now(); if (record) frames.push(now - last); last = now;
          const due = Math.floor((now - origin) * 20 / 1000) - ticks, start = performance.now();
          if (due > 0) { window.__na.step(Math.min(due, 5)); ticks += due; }
          window.__na.render({ settle: false });
          if (record) { js.push(performance.now() - start); const info = window.__na.renderInfo(); calls.push(info.calls); tris.push(info.triangles); }
        }
      };
      if (warmup > 0) { await loop(origin + warmup, false); window.__na.perfReset(); t0 = performance.now(); last = t0; }
      await loop(t0 + ms, true);
      const elapsed = performance.now() - t0, r = n => (n === null ? null : Math.round(n * 1000) / 1000);
      const sorted = [...frames].sort((a, b) => a - b), worst = sorted.slice(Math.max(0, sorted.length - Math.max(1, Math.ceil(sorted.length * 0.01))));
      const app = window.__na.perf()?.sample ?? null;
      return {
        durationMs: r(elapsed), warmupMs: warmup, proxy: { throttle: proxyThrottle, dpr: proxyDpr, quality: proxyQuality }, frames: frames.length, fps: r(frames.length / (elapsed / 1000)), frameMsP95: r(pct(frames, 0.95)), jsMsP95: r(pct(js, 0.95)), drawCalls: Math.max(0, ...calls), ticks, clock: 'real',
        frameMsP99: r(pct(frames, 0.99)), fps1Low: worst.length ? r(1000 / mean(worst)) : null, jsMsMean: r(mean(js)), triangles: Math.max(0, ...tris),
        // Informational: the app's own createPerfMetrics sample (frames[] ring) over the same window; renderMs is scene.render() only (jsMs also includes sim catch-up).
        app: app && Object.fromEntries(Object.entries(app).map(([k, v]) => [k, r(v)])),
      };
    }, [durationMs, warmupMs, throttle, dpr, quality ?? config.settings.quality]);
  } finally {
    await context.close();
  }
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
    } else if (frame.action === 'results') {
      await advanceTo(await tick()); // submit due scripted commands
      target = await tick();
    } else throw new Error(`frame without tick/relative/after/action in ${scene.id}`);
    if (target < await tick()) throw new Error(`frame tick ${target} already passed in ${scene.id}`);
    await advanceTo(target, { perTick: traceEnd !== null, settle: frame.settle });
    if (frame.action === 'pause') {
      await page.evaluate(() => window.__na.pause());
      await until(page, () => window.__na.screen === 'paused', undefined, { what: `${scene.id} paused screen` });
    } else if (frame.action === 'results') {
      // Bounded fast-forward: the sim ends by its time limit at the latest (L1: 180 s = 3600 ticks); 40 x 500 ticks cap.
      const reached = await page.evaluate(() => { for (let i = 0; i < 40 && window.__na.screen !== 'results'; i++) window.__na.step(500); return window.__na.screen; });
      if (reached !== 'results') throw new Error(`${scene.id}: no result screen after 20000 ticks (screen ${reached})`);
      await until(page, () => document.querySelector('[data-outcome]') !== null, undefined, { what: `${scene.id} results overlay` });
    }
    await finishFrame(page, frame.settle);
    if (scene.laneCrop && !laneRect) laneRect = await page.evaluate(({ from, to, w, h }) => {
      const a = window.__na.project(from), b = window.__na.project(to), pad = 24;
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - pad)), y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - pad));
      const x1 = Math.min(w, Math.ceil(Math.max(a.x, b.x) + pad)), y1 = Math.min(h, Math.ceil(Math.max(a.y, b.y) + pad));
      return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }, { ...scene.laneCrop, w: viewport.width, h: viewport.height });
    const state = await page.evaluate(frameState);
    const vp = `${viewport.width}x${viewport.height}`;
    const shot = await screenshot(page, frameFile(scene.id, vp, frame.label));
    const hud = await page.evaluate(collectHud, HUD_SELECTORS); // SP05 H01-H07 (lib/hud-metrics.mjs)
    const entry = { label: frame.label, settle: frame.settle, ...shot, tick: state.tick, simHash: state.hash, over: state.over, screen: state.screen, probe: state.probe, dom: state.dom, hud, sim: state.sim };
    if (laneRect) entry.laneCrop = { rect: laneRect, sha256: sha256(await page.screenshot({ clip: laneRect, animations: 'disabled', caret: 'hide', timeout: SHOT_TIMEOUT })) };
    if (!out.frames.length) entry.magenta = await magentaPass(page, frameFile(scene.id, vp, frame.label ? `${frame.label}-magenta` : 'magenta'), frame.settle);
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
    await page.goto(`${BASE_URL}/?test=1${scene.fixture ? `&fixture=${scene.fixture}` : ''}${LOD_QUERY}`);
    await until(page, () => window.__na?.screen === 'menu', undefined, { what: 'menu screen' });
    await page.mouse.move(viewport.width - 1, 0); // parked: top-right corner, away from towers/lanes/HUD buttons
    // SP05: every scene runs with the first-level tip dismissed (tipSeen) except l01-tip (fresh storage, tip visible).
    const settings = { tipSeen: true, ...config.settings, ...(scene.settings ?? {}) };
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
  if (opts.lod) LOD_QUERY = `&lod=${opts.lod}`;
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
    const previous = opts.scenes.length || opts.viewports.length || opts.allLevels ? (fs.existsSync(metricsFile) ? JSON.parse(fs.readFileSync(metricsFile, 'utf8')) : null) : null;
    const scenes = {};
    const known = allScenes(config);
    for (const s of known) if (previous?.scenes?.[s.id]) scenes[s.id] = previous.scenes[s.id];
    const css = new Set(), faces = new Set(), written = [];
    for (const { scene, viewport } of opts.perfOnly ? [] : jobs) {
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
      written.push(...result.frames.flatMap(f => [f.png, f.magenta?.png].filter(Boolean)));
      log(`${scene.id} ${viewport}: ${result.frames.map(f => `${f.png}${f.tick !== undefined ? `@${f.tick}` : ''}`).join(', ')}${result.laneCrop ? ` laneCropDistinct=${result.laneCrop.framesDistinct}` : ''}${result.botCommands?.length ? ` botCommands=${result.botCommands.length}` : ''}`);
    }
    const perfJob = jobs.find(j => j.scene.id === PERF.scene && j.viewport === PERF.viewport);
    if (perfJob) {
      const perf = await capturePerf(browser, config, perfJob.scene, opts.gpu ? PERF_GPU.durationMs : PERF.durationMs, opts.gpu ? PERF_GPU.warmupMs : PERF.warmupMs, { throttle: opts.throttle, dpr: opts.dpr, quality: opts.perfQuality });
      if (opts.perfOnly) fs.writeFileSync(path.join(OUT_DIR, 'perf.json'), `${JSON.stringify(perf, null, 2)}\n`);
      else scenes[PERF.scene][PERF.viewport].perf = perf;
      log(`perf ${PERF.scene} ${PERF.viewport} (${perf.durationMs} ms real time): fps ${perf.fps}, frame p95 ${perf.frameMsP95} ms, jsMs p95 ${perf.jsMsP95}, drawCalls ${perf.drawCalls}`);
    }
    // Stable key order: scenes.json order, viewports in capture order.
    const ordered = {};
    for (const s of known) if (scenes[s.id]) ordered[s.id] = scenes[s.id];
    if (!opts.perfOnly) fs.writeFileSync(metricsFile, `${JSON.stringify({ schema: 1, seed: config.seed, scenes: ordered }, null, 2)}\n`);

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
