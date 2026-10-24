import { afterEach, expect, it, vi } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { createAppController } from '../../src/app/state';
import type { DriverEnvironment, FrameUpdate } from '../../src/driver';
import { createSaveStore } from '../../src/save';
import { createKaneController } from '../../src/kane/controller';
import { createFixtureSim } from '../../src/test-harness/fixtures';

const files = Object.fromEntries(globSync('packages/content/data/**/*.json', { cwd: '../..' }).map(p => [p.slice('packages/content/'.length), readFileSync('../../' + p, 'utf8')]));
const manifest = JSON.parse(readFileSync('assets/manifest.json', 'utf8'));
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.unstubAllGlobals(); });
function fakeDriverEnvironment(initialHidden = false) {
  const target = Object.assign(new EventTarget(), { hidden: initialHidden });
  vi.stubGlobal('document', target);
  const environment: DriverEnvironment = { requestFrame: () => 1, cancelFrame() {}, isHidden: () => target.hidden,
    onVisibilityChange(fn) { target.addEventListener('visibilitychange', fn); return () => target.removeEventListener('visibilitychange', fn); } };
  return { target, environment, visibility(hidden: boolean) { target.hidden = hidden; target.dispatchEvent(new Event('visibilitychange')); } };
}
function prepare(kane = true, hidden = false, win = false, runtimeReady = async () => {}) {
  const env = fakeDriverEnvironment(hidden), cancel = vi.fn(() => false), refresh = vi.fn();
  const frames: FrameUpdate[] = [];
  const app = createAppController({ files, ...(kane ? { campaignId: 'kane' } : {}), environment: env.environment,
    loadManifest: async () => manifest, save: createSaveStore({ storage: null }), autoStart: false, resultDelayMs: 60000,
    ...(win ? { createSim: createFixtureSim('win') } : {}), createBotDriver: () => ({ commands: () => [] }),
    createRuntime: async ctx => { await runtimeReady(); controller.bindLevel(ctx.level, ctx.driver); return { frame(update) { frames.push(update); }, tick() {}, refresh, cancel, dispose() {} }; } });
  const controller = createKaneController(app);
  cleanup.push(() => { controller.dispose(); app.dispose(); });
  return { app, controller, env, cancel, refresh, frames };
}
async function setup(kane = true, hidden = false, win = false) {
  const result = prepare(kane, hidden, win);
  await result.app.boot(); await result.app.startLevel(result.app.snapshot().levels[0]!.id);
  return result;
}

it('Kane hidden pause cancels input without opening a popup, then resumes and publishes phase without a tick', async () => {
  const { app, controller, env, cancel, refresh } = await setup();
  env.visibility(true);
  expect(app.driver!.pauseReason).toBe('hidden'); expect(app.snapshot().restartPopup).toBe(false);
  expect(controller.snapshot().phase).toBe('paused'); expect(cancel).toHaveBeenCalled();
  env.visibility(false);
  expect(app.driver!.paused).toBe(false); expect(app.snapshot().restartPopup).toBe(false);
  expect(controller.snapshot().phase).toBe('playing'); expect(refresh).toHaveBeenCalled();
  expect(app.driver!.sim.view.tick).toBe(0); expect(app.step()).toBe(1);
});
it('starting hidden also avoids the Kane restart popup and resumes on visible', async () => {
  const { app, env } = await setup(true, true);
  expect(app.driver!.pauseReason).toBe('hidden'); expect(app.snapshot().restartPopup).toBe(false);
  env.visibility(false); expect(app.driver!.paused).toBe(false);
});
it('explicit resume works for a Kane hidden pause with no popup once visible', async () => {
  const { app, controller, env } = await setup();
  env.visibility(true); controller.dispose(); env.visibility(false);
  expect(app.snapshot().restartPopup).toBe(false); expect(app.driver!.paused).toBe(true);
  app.resume(); expect(app.driver!.paused).toBe(false);
});
it('manual pause survives hide/show even though the driver pause reason changes', async () => {
  const { app, env } = await setup();
  app.pause(); env.visibility(true); env.visibility(false);
  expect(app.snapshot().restartPopup).toBe(true); expect(app.driver!.paused).toBe(true);
  app.resume(); expect(app.driver!.paused).toBe(false);
});
it('common campaign keeps its hidden-pause popup and never auto resumes', async () => {
  const { app, env } = await setup(false);
  env.visibility(true); env.visibility(false);
  expect(app.snapshot().restartPopup).toBe(true); expect(app.driver!.paused).toBe(true);
});
it('visibility listener stops resuming after controller disposal', async () => {
  const { app, controller, env } = await setup();
  env.visibility(true); controller.dispose(); env.visibility(false);
  expect(app.driver!.paused).toBe(true);
});
it('visibility never resumes an over match during the delayed result popup', async () => {
  const { app, env } = await setup(true, false, true);
  app.driver!.submit({ type: 'DrawLine', player: 0, from: 0, to: 2 }); app.step();
  env.visibility(true); env.visibility(false);
  expect(app.driver!.pauseReason).toBe('hidden'); expect(app.driver!.sim.view.over?.outcome).toBe('won');
});

it.each([
  { restart: false, initialHidden: false },
  { restart: true, initialHidden: false },
  { restart: false, initialHidden: true },
  { restart: true, initialHidden: true },
])('Kane resumes when visible before asynchronous runtime resolves (restart=$restart, initially hidden=$initialHidden)', async ({ restart, initialHidden }) => {
  let waiting = false, resolveRuntime!: () => void;
  const runtimeReady = new Promise<void>(resolve => { resolveRuntime = resolve; });
  const { app, controller, env, frames } = prepare(true, false, false, async () => { if (waiting) await runtimeReady; });
  await app.boot();
  if (restart) await app.startLevel(app.snapshot().levels[0]!.id);
  env.visibility(initialHidden); waiting = true;
  const initialFrames = frames.length;
  const loading = restart ? app.restart() : app.startLevel(app.snapshot().levels[0]!.id);
  expect(app.snapshot().screen).toBe('boot'); expect(app.snapshot().loading).toBe(true);
  env.visibility(true); env.visibility(false);
  expect(app.driver!.pauseReason).toBe('hidden');
  resolveRuntime(); await loading;
  expect(app.driver!.paused).toBe(false);
  expect(app.snapshot().screen).toBe('playing'); expect(app.snapshot().loading).toBe(false);
  expect(app.snapshot().restartPopup).toBe(false); expect(controller.snapshot().phase).toBe('playing');
  expect(frames[initialFrames]!.paused).toBe(false);
  expect(app.driver!.sim.view.tick).toBe(0); expect(app.step()).toBe(1);
});
it('Kane stays paused when asynchronous runtime resolves while still hidden', async () => {
  let resolveRuntime!: () => void;
  const runtimeReady = new Promise<void>(resolve => { resolveRuntime = resolve; });
  const { app, controller, env } = prepare(true, true, false, () => runtimeReady);
  await app.boot();
  const loading = app.startLevel(app.snapshot().levels[0]!.id);
  expect(app.snapshot().screen).toBe('boot');
  resolveRuntime(); await loading;
  expect(app.driver!.pauseReason).toBe('hidden'); expect(app.step()).toBe(0);
  expect(app.snapshot().restartPopup).toBe(false); expect(controller.snapshot().phase).toBe('paused');
  env.visibility(false);
  expect(app.driver!.paused).toBe(false); expect(controller.snapshot().phase).toBe('playing');
  expect(app.step()).toBe(1);
});
