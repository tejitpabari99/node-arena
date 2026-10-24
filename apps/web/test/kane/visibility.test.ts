import { afterEach, expect, it, vi } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { createAppController } from '../../src/app/state';
import type { DriverEnvironment } from '../../src/driver';
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
async function setup(kane = true, hidden = false, win = false) {
  const env = fakeDriverEnvironment(hidden), cancel = vi.fn(() => false), refresh = vi.fn();
  const app = createAppController({ files, ...(kane ? { campaignId: 'kane' } : {}), environment: env.environment,
    loadManifest: async () => manifest, save: createSaveStore({ storage: null }), autoStart: false, resultDelayMs: 60000,
    ...(win ? { createSim: createFixtureSim('win') } : {}), createBotDriver: () => ({ commands: () => [] }),
    createRuntime: ctx => { controller.bindLevel(ctx.level, ctx.driver); return { frame() {}, tick() {}, refresh, cancel, dispose() {} }; } });
  const controller = createKaneController(app);
  cleanup.push(() => { controller.dispose(); app.dispose(); });
  await app.boot(); await app.startLevel(app.snapshot().levels[0]!.id);
  return { app, controller, env, cancel, refresh };
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
