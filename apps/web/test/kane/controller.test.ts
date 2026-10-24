import { afterEach, expect, it, vi } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { createAppController } from '../../src/app/state';
import { createSaveStore } from '../../src/save';
import { createKaneController } from '../../src/kane/controller';
import { createFixtureSim } from '../../src/test-harness/fixtures';

const files = Object.fromEntries(globSync('packages/content/data/**/*.json', { cwd: '../..' }).map(p => [p.slice('packages/content/'.length), readFileSync('../../' + p, 'utf8')]));
const manifest = JSON.parse(readFileSync('assets/manifest.json', 'utf8'));
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); vi.useRealTimers(); });
async function setup(fixture?: 'win' | 'loss') {
  const commands: unknown[] = [];
  const app = createAppController({ files, campaignId: 'kane', loadManifest: async () => manifest, save: createSaveStore({ storage: null }), autoStart: false,
    createBotDriver: () => ({ commands: () => [] }), ...(fixture ? { createSim: createFixtureSim(fixture) } : {}),
    createRuntime: async ctx => { controller.bindLevel(ctx.level, ctx.driver); return { frame() {}, tick() {}, refresh() {}, cancel: () => false, dispose() {} }; },
  });
  const controller = createKaneController(app);
  app.subscribeEvents(u => commands.push(...u.submissions));
  cleanup.push(() => { controller.dispose(); app.dispose(); });
  await app.boot(); await app.startLevel('na-kane');
  return { app, controller, commands, pair: () => controller.snapshot().groups[0]!.pairs[0]! };
}

it('rechecks legality before submit and retains the reason for 12 seconds or the next panel click', async () => {
  vi.useFakeTimers();
  const { app, controller, pair, commands } = await setup();
  const staleReady = pair();
  app.driver!.submit({ type: 'DrawLine', player: 0, from: 0, to: 2 }); app.step();
  controller.act(staleReady, 'click');
  expect(controller.snapshot().banner).toEqual({ text: 'This route already exists.', reason: 'duplicate', kind: 'error' });
  app.step(); expect(commands).toHaveLength(1);
  vi.advanceTimersByTime(11999); expect(controller.snapshot().banner?.reason).toBe('duplicate');
  vi.advanceTimersByTime(1); expect(controller.snapshot().banner).toBeNull();
  controller.act(staleReady, 'click'); controller.act(pair(), 'click');
  expect(controller.snapshot().banner).toBeNull();
});

it('reports human race rejections but ignores AI rejections and resets on restart', async () => {
  const { app, controller } = await setup();
  app.driver!.submit({ type: 'DrawLine', player: 1, from: 0, to: 2 }); app.step();
  expect(controller.snapshot().banner).toBeNull();
  app.driver!.submit({ type: 'DrawLine', player: 0, from: 0, to: 1 }); app.step();
  expect(controller.snapshot().banner?.text).toBe('An obstacle blocks this route.');
  await app.restart(); expect(controller.snapshot().banner).toBeNull();
  expect(controller.snapshot().groups[0]!.pairs.map(p => p.to)).toEqual([2, 4]);
});

it('a paused rejected submission shows Game paused without pending state blocking a later draw', async () => {
  const { app, controller, pair, commands } = await setup();
  app.pause(); controller.act(pair(), 'click');
  expect(controller.snapshot().banner?.text).toBe('Game paused');
  app.resume(); controller.act(pair(), 'click'); app.step();
  expect(commands).toHaveLength(1);
  expect(pair().state).toBe('active');
});

it('canvas acceptance time also guards cuts, and pending ignores all repeated gestures until a later tick', async () => {
  let now = 0; vi.spyOn(performance, 'now').mockImplementation(() => now);
  const { app, controller, pair, commands } = await setup();
  app.driver!.submit({ type: 'DrawLine', player: 0, from: 0, to: 2 }); app.step();
  now = 699; controller.act(pair(), 'dblclick'); app.step(); expect(pair().state).toBe('active');
  now = 700; controller.act(pair(), 'dblclick'); controller.act(pair(), 'dblclick'); controller.refresh(); controller.act(pair(), 'dblclick');
  app.step(); expect(pair().state).toBe('ready'); expect(commands).toHaveLength(2);
});

it('MatchOver locks immediately during the delayed result popup and the permanent banner cannot expire', async () => {
  vi.useFakeTimers();
  const { app, controller, pair } = await setup('win');
  controller.act(pair(), 'click'); app.step();
  expect(app.snapshot().screen).toBe('playing');
  expect(controller.snapshot()).toMatchObject({ locked: true, phase: 'over', result: { outcome: 'won', winner: 0 }, banner: { text: 'Game over', reason: 'gameover', kind: 'gameover' } });
  vi.advanceTimersByTime(13000); controller.act(pair(), 'click');
  expect(controller.snapshot().banner?.text).toBe('Game over');
  expect(app.snapshot().screen).toBe('result');
});

it('an ignored double click keeps the error from its preceding click', async () => {
  const { app, controller, pair } = await setup();
  const staleReady = pair();
  app.driver!.submit({ type: 'DrawLine', player: 0, from: 0, to: 2 }); app.step();
  controller.act(staleReady, 'click');
  expect(controller.snapshot().banner?.reason).toBe('duplicate');
  controller.act(pair(), 'dblclick');
  expect(controller.snapshot().banner?.reason).toBe('duplicate');
});
