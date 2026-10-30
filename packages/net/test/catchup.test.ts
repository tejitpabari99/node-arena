import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createReplayRecorder } from '@node-arena/sim';
import { CatchupError, createCatchup, createCatchupFromStart, createJoinLate, LockstepServer, type StartMsg } from '../src/index.js';

const { pvpLevel } = createRequire(import.meta.url)('./pvp-fixture.cjs');
const metadata = { rulesVersion: '2.0.0', schemaVersion: '9.0.0', contentVersion: '9.0.0' };
const SEED = 7;
const setup = { teams: [0, 1] };
const lv = () => pvpLevel([0, 1], [0, 1], { limit: 60, levels: [30, 2] });
const script: Record<number, [number, number, 'DrawLine' | 'CutLine'][]> = {
  0: [[0, 1, 'DrawLine']], 5: [[1, 0, 'DrawLine']], 30: [[0, 1, 'CutLine']], 45: [[0, 1, 'DrawLine']],
};

/** Run a server+referee for `ticks` ticks; returns the log, per-tick commands and referee. */
function play(ticks: number) {
  const server = new LockstepServer({ seats: ['human', 'human'], buildingCount: 2, log: { timeLimitTicks: 1200 } });
  const referee = createReplayRecorder(lv(), SEED, metadata, setup);
  const perTick: ReturnType<typeof server.closeTick>[] = [];
  for (let n = 0; n < ticks; n++) {
    for (const [from, to, type] of script[n] ?? []) server.submit(from, { type, from, to } as never);
    const t = server.closeTick();
    perTick.push(t);
    referee.step(t.cmds);
  }
  return { server, referee, perTick };
}

/** Fake clock: each call advances 1 ms, so a 6 ms budget allows ~6 steps. */
function fakeClock() { let t = 0; return () => t++; }

test('catch-up from tick 0 under 6 ms budget reaches server hash, in bounded slices', () => {
  const { server, referee } = play(100);
  const c = createCatchup(lv(), SEED, setup);
  const chunks = server.log.range(0, 100, 30);
  chunks.forEach((ch, i) => c.feed({ ...ch, done: i === chunks.length - 1 }));
  assert.deepEqual(c.progress, { tick: 0, target: 100 });
  const now = fakeClock();
  let runs = 0;
  while (!c.done) {
    const n = c.run(6, now);
    assert.ok(n >= 1 && n <= 7, `slice ${n}`);
    runs++;
    assert.ok(runs < 1000);
  }
  assert.ok(runs >= 100 / 7);
  assert.equal(c.sim.view.tick, 100);
  assert.equal(c.sim.hash(), referee.hash());
});

test('does not step past fed target (frozen/paused tick)', () => {
  const { server } = play(40);
  const c = createCatchup(lv(), SEED, setup);
  for (const ch of server.log.range(0, 25)) c.feed(ch);
  c.run(1e9, fakeClock());
  assert.equal(c.sim.view.tick, 25);
  assert.equal(c.run(1e9, fakeClock()), 0);
  assert.equal(c.done, false);
  for (const ch of server.log.range(25, 40)) c.feed({ ...ch, done: true });
  c.run(1e9, fakeClock());
  assert.equal(c.done, true);
});

test('feed rejects gap, overlap, out-of-range cmd', () => {
  const c = createCatchup(lv(), SEED, setup);
  assert.throws(() => c.feed({ from: 5, to: 10, cmds: [] }), (e: unknown) => e instanceof CatchupError && e.code === 'gap');
  c.feed({ from: 0, to: 10, cmds: [] });
  assert.throws(() => c.feed({ from: 5, to: 15, cmds: [] }), (e: unknown) => e instanceof CatchupError && e.code === 'gap');
  assert.throws(() => c.feed({ from: 10, to: 12, cmds: [{ tick: 12, cmd: { type: 'CutLine', player: 0, from: 0, to: 1 } as never }] }), (e: unknown) => e instanceof CatchupError && e.code === 'bad-range');
});

test('joined-late client resumes live with no gap', () => {
  const live = play(160);
  const referee = createReplayRecorder(lv(), SEED, metadata, setup);
  const join = createJoinLate(createCatchup(lv(), SEED, setup));
  const CATCH = 100;
  // Late joiner connects at tick 100: catchup chunks [0,100), then live ticks 100.. (one live tick arrives pre-done to test holding).
  const now = fakeClock();
  const chunks = live.server.log.range(0, CATCH, 40);
  chunks.forEach((ch, i) => join.push({ t: 'catchup', from: ch.from, to: ch.to, cmds: ch.cmds, done: i === chunks.length - 1 }));
  assert.equal(join.live, false);
  const hashes: { tick: number; h: string }[] = [];
  for (let n = CATCH; n < 160; n++) {
    join.push({ t: 'tick', n, ...(live.perTick[n]!.cmds.length ? { c: live.perTick[n]!.cmds } : {}) });
    for (const m of join.run(6, now)) hashes.push({ tick: m.tick, h: m.h });
  }
  while (join.catchup.sim.view.tick < 160) for (const m of join.run(6, now)) hashes.push({ tick: m.tick, h: m.h });
  assert.equal(join.live, true);
  assert.equal(join.catchup.sim.view.tick, 160);
  assert.equal(join.catchup.sim.hash(), live.referee.hash());
  assert.ok(hashes.length >= 3);
  // Hashes sent from live ticks match a fresh referee at those ticks.
  for (let n = 0; n < 160; n++) { referee.step(live.perTick[n]!.cmds); const h = hashes.find(x => x.tick === n + 1); if (h) assert.equal(h.h, referee.hash()); }
});

test('live ticks arriving before done chunk are held, not dropped', () => {
  const { server, perTick } = play(30);
  const join = createJoinLate(createCatchup(lv(), SEED, setup));
  join.push({ t: 'tick', n: 20, ...(perTick[20]!.cmds.length ? { c: perTick[20]!.cmds } : {}) });
  for (const ch of server.log.range(0, 20)) join.push({ t: 'catchup', ...ch, done: true });
  assert.equal(join.client?.queued(), 1);
});

test('start.simHash mismatch throws version-mismatch; match passes', () => {
  const level = lv();
  const start = { t: 'start', matchId: 'm', levelId: level.id, simHash: level.simHash.slice(0, 16), seed: SEED } as unknown as StartMsg;
  assert.ok(createCatchupFromStart(start, () => level, setup));
  const bad = { ...start, simHash: '0'.repeat(16) } as StartMsg;
  assert.throws(() => createCatchupFromStart(bad, () => level, setup), (e: unknown) => e instanceof CatchupError && e.code === 'version-mismatch');
  assert.throws(() => createCatchupFromStart(start, () => undefined, setup), (e: unknown) => e instanceof CatchupError && e.code === 'version-mismatch');
});
