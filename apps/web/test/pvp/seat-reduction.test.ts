import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import type { ClientMessage, ServerMessage, Versions } from '@node-arena/net';
import { loadContent } from '@node-arena/content';
import { create } from '@node-arena/sim';
import { createPvpController, type PvpOptions } from '../../src/pvp/controller';
import { createIdentity } from '../../src/net/identity';
import type { PvpConnection } from '../../src/net/connection';

const files = Object.fromEntries(globSync('packages/content/data/**/*.json', { cwd: '../..' }).map((p) => [p.slice('packages/content/'.length), readFileSync('../../' + p, 'utf8')]));
const manifest = JSON.parse(readFileSync('assets/manifest.json', 'utf8'));
const content = loadContent(files, { themes: Object.keys(manifest.themes), colorKeys: Object.keys(manifest.palettes) });
const versions: Versions = { rules: 'r', schema: 's', content: 'c', bot: 'b' };

function harness(createSim?: PvpOptions['createSim']) {
  const cbs = new Set<(m: ServerMessage) => void>(), sent: ClientMessage[] = [];
  const conn: PvpConnection = { state: 'connected', info: { attempt: 0, nextRetryAt: null, outageStartedAt: null, lastCloseCode: null }, send(m) { sent.push(m); return true; }, onMessage(cb) { cbs.add(cb); return () => cbs.delete(cb); }, onState() { return () => {}; }, retry() {}, close() {} };
  const ctl = createPvpController({
    identity: createIdentity({ local: null, session: null }), serverUrl: 'ws://x', versions, createSocket: () => { throw new Error('no'); }, createConnection: () => conn,
    getLevel: (id) => content.compiled[id], raf: () => 1, caf: () => {}, now: () => 0, ...(createSim ? { createSim } : {}),
  });
  ctl.open(); ctl.create();
  const push = (m: ServerMessage) => cbs.forEach((f) => f(m));
  push({ t: 'welcome', pv: 1, playerId: 'p', serverVersions: versions });
  push({ t: 'room.joined', code: 'ABCD', you: { seat: 1, host: false } });
  return { ctl, push, sent };
}
const start = (levelId: string, seats: Array<{ player: number; team: number }>): ServerMessage => ({
  t: 'start', matchId: 'm', levelId, simHash: content.compiled[levelId]!.simHash.slice(0, 16), seed: 7,
  seats: seats.map((s) => ({ ...s, kind: 'human' as const, nick: `n${s.player}` })), youPlayer: 1, inputDelay: 2, countdownMs: 3000, timeLimitTicks: 100, hashInterval: 10,
});
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('client seat reduction (n < level.players)', () => {
  it('covers R-SEA-01: a 2-seat match on the 4-player Cross passes teams of length n and the client sim reduces to n seats', async () => {
    const level = content.compiled['na-pvp-cross']!, args: Array<{ teams: number[] }> = [];
    const h = harness((l, seed, setup) => { args.push(setup); return create(l, seed, setup); });
    // Out-of-order seats: teams are ordered by player id, not by message order.
    h.push(start('na-pvp-cross', [{ player: 1, team: 1 }, { player: 0, team: 0 }])); await flush();
    expect(level.players.length).toBe(4);
    expect(args).toEqual([{ teams: [0, 1] }]);
    expect(args[0]!.teams.length).toBeLessThan(level.players.length);
    const sim = h.ctl.driver!.sim;
    expect(sim.view.players).toHaveLength(2);
    // Same inputs as the server's reduced sim: identical state hash at tick 0 (no desync).
    expect(sim.hash()).toBe(create(level, 7, { teams: [0, 1] }).hash());
    expect(sim.hash()).not.toBe(create(level, 7).hash());
    h.ctl.dispose();
  });
  it('covers R-SEA-01: 3 seats on Cross keep shared team ids and reduce to 3 seats', async () => {
    const h = harness();
    h.push(start('na-pvp-cross', [{ player: 0, team: 0 }, { player: 1, team: 1 }, { player: 2, team: 1 }])); await flush();
    const sim = h.ctl.driver!.sim;
    expect(sim.view.players.map((p) => p.team)).toEqual([0, 1, 1]);
    expect(sim.hash()).toBe(create(content.compiled['na-pvp-cross']!, 7, { teams: [0, 1, 1] }).hash());
    h.ctl.dispose();
  });
  it('covers R-SEA-01: a full-seat match passes all teams', async () => {
    const h = harness();
    h.push(start('na-pvp-cross', [0, 1, 2, 3].map((player) => ({ player, team: player < 2 ? 0 : 1 })))); await flush();
    expect(h.ctl.driver!.sim.view.players).toHaveLength(4);
    h.ctl.dispose();
  });
});
