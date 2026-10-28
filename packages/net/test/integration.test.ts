import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { create, createReplayRecorder, playReplay, type ReplayRecord } from '@node-arena/sim';
import { encodeClient, encodeServer, encodeTick, endMessage, LockstepClient, LockstepServer, parseClientMessage, parseServerMessage, type ClientMessage, type ServerMessage } from '../src/index.js';

const { pvpLevel } = createRequire(import.meta.url)('./pvp-fixture.cjs');
const metadata = { rulesVersion: '2.0.0', schemaVersion: '9.0.0', contentVersion: '9.0.0' };
const SEED = 7;
const TEAMS = [0, 1];

function level() { return pvpLevel([0, 1], TEAMS, { limit: 60, levels: [30, 2] }); }
const setup = { teams: TEAMS };

function parseC(m: ClientMessage): ClientMessage {
  const r = parseClientMessage(encodeClient(m));
  assert.ok(r.ok);
  return r.msg;
}
function parseS(raw: string): ServerMessage {
  const r = parseServerMessage(raw);
  assert.ok(r.ok);
  return r.msg;
}

// Scripted: tick -> [seat, from, to, type]
const script: Record<number, [number, number, number, 'DrawLine' | 'CutLine'][]> = {
  0: [[0, 0, 1, 'DrawLine']],
  5: [[1, 1, 0, 'DrawLine']],
  30: [[1, 1, 0, 'CutLine'], [0, 0, 1, 'CutLine']],
  45: [[0, 0, 1, 'DrawLine']],
};

function harness(tamper = false) {
  const lv = level();
  const server = new LockstepServer({ seats: ['human', 'human'], buildingCount: 2, log: { timeLimitTicks: 1200 } });
  const referee = createReplayRecorder(lv, SEED, metadata, setup);
  const sims = [create(lv, SEED, setup), create(lv, SEED, setup)];
  const clients = [new LockstepClient(), new LockstepClient()];
  const checks: { tick: number; ref: string; c: string[] }[] = [];
  const hashResults: string[] = [];
  let end: ReturnType<typeof endMessage> = null;
  let n = 0;
  for (; n < 3000 && referee.view.over === null; n++) {
    for (const [seat, from, to, type] of script[n] ?? []) {
      const msg = parseC({ t: 'cmd', c: { type, from, to } });
      assert.equal(msg.t, 'cmd');
      if (msg.t === 'cmd') assert.ok(server.submit(seat, msg.c).accepted);
    }
    const { n: tn, cmds } = server.closeTick();
    assert.equal(tn, n);
    referee.step(cmds);
    if (referee.view.tick % 20 === 0) server.recordCheckpoint(referee.view.tick, referee.hash());
    const frame = encodeTick(tn, cmds);
    clients.forEach((c, i) => {
      assert.ok(c.push(parseS(frame)).ok);
      for (const t of c.drain(10)) {
        let cm = t.cmds;
        if (tamper && i === 1 && t.n === 8) cm = [];
        sims[i]!.step(cm);
        const h = c.after(t.n, () => sims[i]!.hash());
        if (h !== null) {
          const m = parseC(h);
          assert.equal(m.t, 'hash');
          if (m.t === 'hash') {
            const r = server.onHash(i, m.tick, m.h);
            hashResults.push(r.result);
            if (r.result === 'desync') hashResults.push(`desync@${m.tick}`);
          }
        }
      }
    });
    if (referee.view.tick % 20 === 0) checks.push({ tick: referee.view.tick, ref: referee.hash(), c: sims.map(s => s.hash()) });
  }
  end = endMessage(referee.view.over, referee.view.tick, referee.hash());
  return { server, referee, sims, checks, hashResults, end };
}

test('two clients stay hash-identical to referee; log replays', () => {
  const { server, referee, sims, checks, hashResults, end } = harness();
  assert.ok(checks.length >= 2, 'multiple checkpoints');
  for (const c of checks) assert.deepEqual(c.c, [c.ref, c.ref], `tick ${c.tick}`);
  assert.ok(hashResults.length >= 4);
  assert.ok(hashResults.every(r => r === 'ok'), hashResults.join());
  assert.ok(end, 'match reached end');
  assert.equal(end.finalHash, sims[0]!.hash());
  assert.equal(end.finalHash, sims[1]!.hash());
  assert.equal(sims[0]!.view.tick, referee.view.tick);
  const wire = parseS(encodeServer(end));
  assert.equal(wire.t, 'end');

  const rec = referee.record();
  const replay: ReplayRecord = { ...rec, commands: server.log.commands.map(e => ({ tick: e.tick, cmd: e.cmd as never })) };
  assert.ok(replay.commands.length >= 5);
  const res = playReplay({ metadata, level: level() }, replay);
  assert.equal(res.ok, true);
  assert.equal(res.sim.hash(), end.finalHash);
});

test('tampered client command array -> onHash desync', () => {
  const { hashResults } = harness(true);
  assert.ok(hashResults.some(r => r.startsWith('desync@')), hashResults.join());
});

