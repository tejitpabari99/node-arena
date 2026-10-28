import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createReplayRecorder, playReplay, type ReplayRecord } from '@node-arena/sim';
import type { Command } from '@node-arena/defs';
import { CommandLog } from '../src/log.js';

const draw = (player: number, from: number, to: number): Command => ({ type: 'DrawLine', player, from, to });

test('append / commands keep order; out-of-order and bad ticks rejected', () => {
  const log = new CommandLog({ timeLimitTicks: 1000 });
  assert.deepEqual(log.append(0, draw(0, 0, 1)), { ok: true });
  assert.deepEqual(log.append(0, draw(1, 1, 0)), { ok: true });
  assert.deepEqual(log.append(5, draw(0, 0, 2)), { ok: true });
  assert.deepEqual(log.append(4, draw(0, 0, 2)), { ok: false, reason: 'out-of-order' });
  assert.deepEqual(log.append(-1, draw(0, 0, 2)), { ok: false, reason: 'bad-tick' });
  assert.deepEqual(log.append(1.5, draw(0, 0, 2)), { ok: false, reason: 'bad-tick' });
  assert.deepEqual(log.commands.map(e => e.tick), [0, 0, 5]);
});

test('tick cap = timeLimitTicks + 200; cmd cap configurable; no throw', () => {
  const log = new CommandLog({ timeLimitTicks: 100, cmdCap: 3 });
  assert.equal(log.maxTick, 300);
  assert.deepEqual(log.append(299, draw(0, 0, 1)), { ok: true });
  assert.deepEqual(log.append(300, draw(0, 0, 1)), { ok: false, reason: 'tick-cap' });
  log.append(299, draw(0, 0, 1)); log.append(299, draw(0, 0, 1));
  assert.deepEqual(log.append(299, draw(0, 0, 1)), { ok: false, reason: 'cmd-cap' });
  assert.equal(log.size, 3);
  assert.equal(new CommandLog({ timeLimitTicks: 1 }).cmdCap, 20000);
});

test('range chunks cover [from,to) with no gap/overlap, <=2000 ticks, every cmd once', () => {
  const log = new CommandLog({ timeLimitTicks: 10000 });
  const ticks = [0, 0, 1, 1999, 2000, 2001, 4000, 4500, 4999];
  ticks.forEach(t => log.append(t, draw(0, 0, 1)));
  const chunks = log.range(0, 5000);
  assert.deepEqual(chunks.map(c => [c.from, c.to]), [[0, 2000], [2000, 4000], [4000, 5000]]);
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i]!.from, chunks[i - 1]!.to);
  for (const c of chunks) { assert.ok(c.to - c.from <= 2000); for (const e of c.cmds) assert.ok(e.tick >= c.from && e.tick < c.to); }
  assert.deepEqual(chunks.flatMap(c => c.cmds.map(e => e.tick)), ticks);
  // oversize request clamps to 2000; small maxTicks splits finer; sparse (empty cmds ok)
  assert.equal(log.range(0, 5000, 99999).length, 3);
  const fine = log.range(0, 5000, 700);
  assert.equal(fine.length, 8);
  assert.equal(fine.flatMap(c => c.cmds).length, ticks.length);
  assert.deepEqual(log.range(10, 10), []);
  // partial window
  assert.deepEqual(log.range(1999, 2001, 1).map(c => [c.from, c.to, c.cmds.length]), [[1999, 2000, 1], [2000, 2001, 1]]);
});

test('checkpoint store: record, lookup, cap 480, overwrite allowed at cap', () => {
  const log = new CommandLog({ timeLimitTicks: 10000 });
  for (let i = 0; i < 480; i++) assert.equal(log.recordCheckpoint(i * 20 + 19, 'a'.repeat(16)), true);
  assert.equal(log.recordCheckpoint(99999, 'b'.repeat(16)), false);
  assert.equal(log.checkpointCount, 480);
  assert.equal(log.checkpoint(19), 'a'.repeat(16));
  assert.equal(log.checkpoint(20), undefined);
  assert.equal(log.recordCheckpoint(19, 'c'.repeat(16)), true);
  assert.equal(log.checkpoint(19), 'c'.repeat(16));
});

test('log feeds playReplay unchanged (ReplayRecord.commands)', () => {
  const fx = createRequire(import.meta.url)('../../sim/test/fixtures.cjs');
  const level = fx.compiledGolden();
  const rec = createReplayRecorder(level, 9, fx.metadata);
  const log = new CommandLog({ timeLimitTicks: 600 });
  const script: [number, Command][] = [[0, draw(0, 0, 1)], [3, draw(1, 1, 0)], [40, draw(0, 0, 2)]];
  for (let t = 0; t < 120; t++) {
    const cmds = script.filter(([tk]) => tk === t).map(([, c]) => c);
    for (const c of cmds) assert.equal(log.append(t, c).ok, true);
    rec.step(cmds, { events: false });
  }
  const recorded = rec.record();
  assert.ok(recorded.commands.length > 0);
  const fromLog: ReplayRecord = { ...recorded, commands: log.commands.map(e => ({ tick: e.tick, cmd: e.cmd })) as ReplayRecord['commands'] };
  assert.deepEqual(fromLog.commands, recorded.commands);
  const res = playReplay({ metadata: fx.metadata, level: fx.compiledGolden() }, fromLog);
  assert.equal(res.ok, true);
  // chunked reassembly also replays identically
  const merged = log.range(0, 120, 50).flatMap(c => c.cmds);
  const res2 = playReplay({ metadata: fx.metadata, level: fx.compiledGolden() }, { ...recorded, commands: merged as ReplayRecord['commands'] });
  assert.equal(res2.ok, true);
});
