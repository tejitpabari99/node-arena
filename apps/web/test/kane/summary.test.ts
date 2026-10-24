import { afterEach, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { create, type SimEvent } from '@node-arena/sim';
import { createAppController, type AppOptions } from '../../src/app/state';
import { createKaneController } from '../../src/kane/controller';
import { createTestHarness } from '../../src/test-harness';
import { testHookRequest } from '../../src/test-harness/gate';
import { createFixtureSim } from '../../src/test-harness/fixtures';

const files = Object.fromEntries(globSync('packages/content/data/**/*.json', { cwd: '../..' }).map(p => [p.slice('packages/content/'.length), readFileSync('../../' + p, 'utf8')]));
const manifest = JSON.parse(readFileSync('assets/manifest.json', 'utf8'));
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(fn => fn()));
async function setup(extra: Partial<AppOptions> = {}) {
  const harness = createTestHarness(files, testHookRequest('?test=1&kane=1', true));
  const app = createAppController({ files, ...harness.options, loadManifest: async () => manifest,
    createBotDriver: () => ({ commands: () => [] }), ...extra,
    createRuntime: ctx => { controller.bindLevel(ctx.level, ctx.driver); return { frame() {}, tick() {}, refresh() {}, cancel: () => false, dispose() {} }; },
  });
  const controller = createKaneController(app), api = harness.connect(app, () => controller.snapshot());
  cleanup.push(() => { api.dispose(); controller.dispose(); app.dispose(); });
  await app.boot(); await harness.autoLoad(app);
  const summary = () => { if (!api.kane) throw Error('Expected Kane API'); return api.kane.summary(); };
  return { app, api, controller, summary };
}

it('returns a JSON summary with stable letters, speed and exact rendered pairs/banner', async () => {
  const { app, api, controller, summary } = await setup();
  expect(JSON.parse(JSON.stringify(summary()))).toEqual({ tick: 0, speed: 0.25, over: null, result: null,
    letters: [
      { letter: 'A', index: 0, id: 'b0', owner: 0, level: 15 },
      { letter: 'B', index: 1, id: 'b1', owner: -1, level: 5 },
      { letter: 'C', index: 2, id: 'b2', owner: -1, level: 15 },
      { letter: 'D', index: 3, id: 'b3', owner: 1, level: 5 },
      { letter: 'E', index: 4, id: 'b4', owner: -1, level: 3 },
    ], human: { commands: [], drawn: 0, cut: 0, rejected: [] }, banner: null,
    pairs: [
      { from: 'A', to: 'C', state: 'ready', reason: null, text: 'A → C · ready · C: grey 15' },
      { from: 'A', to: 'E', state: 'ready', reason: null, text: 'A → E · ready · E: grey 3' },
    ],
  });
  api.setSpeed(0.5); expect(summary().speed).toBe(0.5);
  app.pause(); controller.act(controller.snapshot().groups[0]!.pairs[0]!, 'click');
  expect(summary().banner).toEqual({ text: 'Game paused', reason: 'paused' });
  app.resume(); api.submit({ type: 'DrawLine', player: 0, from: 0, to: 2 }); api.step();
  expect(summary().pairs[0]).toEqual({ from: 'A', to: 'C', state: 'active', reason: null, text: 'A → C · active' });
  expect(summary().tick).toBe(1);
});

it('counts only human submissions, accepted draws/cuts and rejections and resets on restart', async () => {
  const { api, summary } = await setup({ createBotDriver: () => ({ commands: sim => sim.view.tick === 0
    ? [{ type: 'DrawLine', player: 1, from: 3, to: 1 }, { type: 'DrawLine', player: 1, from: 0, to: 2 }]
    : sim.view.tick === 1 ? [{ type: 'CutLine', player: 1, from: 3, to: 1 }] : [] }) });
  api.submit({ type: 'DrawLine', player: 0, from: 0, to: 2 });
  api.submit({ type: 'DrawLine', player: 0, from: 0, to: 1 }); api.step();
  api.submit({ type: 'CutLine', player: 0, from: 0, to: 2 }); api.step();
  expect(api.events).toContainEqual({ type: 'LineDrawn', from: 3, to: 1, owner: 1, drawSeq: 2 });
  expect(api.events).toContainEqual({ type: 'LineCut', from: 3, to: 1, reason: 'player' });
  expect(api.events).toContainEqual({ type: 'CommandRejected', player: 1, command: 'DrawLine', reason: 'not-owner' });
  expect(summary().human).toEqual({ commands: [
    { tick: 0, cmd: { type: 'DrawLine', player: 0, from: 0, to: 2 } },
    { tick: 0, cmd: { type: 'DrawLine', player: 0, from: 0, to: 1 } },
    { tick: 1, cmd: { type: 'CutLine', player: 0, from: 0, to: 2 } },
  ], drawn: 1, cut: 1, rejected: [{ command: 'DrawLine', reason: 'blocked-obstacle' }] });
  api.setSpeed(2); await api.restart();
  expect(summary()).toMatchObject({ tick: 0, speed: 2, result: null, over: null, banner: null, human: { commands: [], drawn: 0, cut: 0, rejected: [] } });
});

it('attributes cuts of initial live lines and excludes capture/replacement removals', async () => {
  const batches: SimEvent[][] = [
    [{ type: 'LineCut', from: 0, to: 2, reason: 'player' }],
    [{ type: 'LineDrawn', from: 0, to: 2, owner: 0, drawSeq: 2 }, { type: 'LineCut', from: 0, to: 2, reason: 'captured' }],
    [{ type: 'LineDrawn', from: 0, to: 2, owner: 0, drawSeq: 3 }, { type: 'LineCut', from: 0, to: 2, reason: 'replaced' }],
  ];
  const { api, summary } = await setup({ createSim: (level, seed) => {
    const sim = create(level, seed); sim.step([{ type: 'DrawLine', player: 0, from: 0, to: 2 }]);
    let index = 0;
    return { ...sim, step: () => { sim.view.tick++; return batches[index++] ?? []; } };
  } });
  api.step(3); expect(summary().human).toMatchObject({ drawn: 2, cut: 1 });
});

it.each(['won', 'lost', 'timeout'] as const)('reports authoritative %s immediately before the result popup', async outcome => {
  const { api, app, summary } = await setup({ resultDelayMs: 60000, createSim: outcome === 'timeout' ? (level, seed) => {
    const sim = create(level, seed);
    return { ...sim, step: () => { sim.view.over = { outcome: 'timeout', winner: null }; return []; } };
  } : createFixtureSim(outcome === 'won' ? 'win' : 'loss') });
  api.submit({ type: 'DrawLine', player: 0, from: 0, to: 2 }); api.step();
  expect(app.snapshot().result).toBeNull();
  expect(summary()).toMatchObject({ result: outcome, over: { outcome, winner: outcome === 'timeout' ? null : outcome === 'won' ? 0 : 1 }, banner: { text: 'Game over', reason: 'gameover' } });
});
