import { describe, expect, it } from 'vitest';
import type { ClientMessage, PauseStateMsg, ServerMessage, Versions } from '@node-arena/net';
import { createPvpController } from '../../src/pvp/controller';
import { createIdentity } from '../../src/net/identity';
import type { ConnState, PvpConnection } from '../../src/net/connection';

const versions: Versions = { rules: 'r', schema: 's', content: 'c', bot: 'b' };
const flush = () => new Promise((r) => setTimeout(r, 0));

function game() {
  const sent: ClientMessage[] = [];
  const cbs = new Set<(m: ServerMessage) => void>();
  const c = { state: 'connected', send: (m: ClientMessage) => { sent.push(m); return true; }, onMessage: (cb: (m: ServerMessage) => void) => { cbs.add(cb); return () => cbs.delete(cb); }, onState: (_cb: (s: ConnState) => void) => () => {}, retry() {}, close() {} } as unknown as PvpConnection;
  const push = (m: ServerMessage) => cbs.forEach((f) => f(m));
  const sims: Array<{ view: { tick: number; over: unknown }; hash(): string }> = [];
  const rt = { made: 0, disposed: 0 };
  const ctl = createPvpController({
    identity: createIdentity({ local: null, session: null }), serverUrl: 'ws://x', versions, createSocket: () => { throw new Error('no'); },
    createConnection: () => c, getLevel: () => ({ simHash: '0123456789abcdef0000' }) as never, manifest: () => ({}) as never,
    createSim: () => { const view = { tick: 0, over: null as unknown, players: [], buildings: { owner: [], level: [] } }; const sim = { view, step: () => { view.tick++; return []; }, hash: () => `h${view.tick}` }; sims.push(sim); return sim as never; },
    createRuntime: () => { rt.made++; return { frame() {}, tick() {}, refresh() {}, cancel: () => false, dispose() { rt.disposed++; } } as never; },
    raf: () => 0, caf: () => {}, now: () => 100,
  });
  ctl.open(); ctl.create();
  push({ t: 'welcome', pv: 2, playerId: 'p', serverVersions: versions });
  push({ t: 'room.joined', code: 'ABCD', you: { seat: 0, host: true } });
  const start: ServerMessage = { t: 'start', matchId: 'm', levelId: 'l', simHash: '0123456789abcdef', seed: 1, seats: [{ player: 0, kind: 'human', team: 0, nick: 'a' }, { player: 1, kind: 'human', team: 1, nick: 'b' }], youPlayer: 0, inputDelay: 2, countdownMs: 3000, timeLimitTicks: 100, hashInterval: 10 };
  const ps = (o: Partial<PauseStateMsg> & { reason?: 'manual' | 'disconnect' } = {}): ServerMessage => ({ t: 'pause.state', epoch: 1, paused: true, tick: 5, unlimited: false, holds: [{ player: 0, reason: o.reason ?? 'disconnect', connected: true, since: 0 }], budgets: [30000, 30000], ...o } as ServerMessage);
  const catchup = (n: number): ServerMessage => ({ t: 'catchup', from: 0, to: n, cmds: [], done: true });
  const resumes = () => sent.filter((m) => m.t === 'resume');
  return { ctl, push, start, ps, catchup, sims, rt, sent, resumes };
}

describe('M2 reconnect', () => {
  it('repeated start: fresh sim/runtime, catches up to frozen tick, hash matches, auto-resume once for own disconnect hold', async () => {
    const g = game(); g.push(g.start); await flush();
    for (let i = 0; i < 3; i++) g.push({ t: 'tick', n: i });
    g.ctl.driver!.advance();
    const old = g.ctl.driver;
    g.push({ t: 'welcome', pv: 2, playerId: 'p', serverVersions: versions });
    g.push({ t: 'room.joined', code: 'ABCD', you: { seat: 0, host: true } });
    g.push(g.start); g.push(g.catchup(5)); g.push(g.ps());
    await flush();
    const d = g.ctl.driver!;
    expect(d).not.toBe(old);
    expect(g.sims.length).toBe(2); expect(g.rt.made).toBe(2); expect(g.rt.disposed).toBe(1);
    expect(g.ctl.snapshot().pause).toMatchObject({ epoch: 1, tick: 5 });
    expect(g.resumes()).toEqual([]); // not caught up yet
    for (let i = 0; i < 10; i++) d.advance();
    expect(d.tick).toBe(5);
    expect(d.sim.hash()).toBe('h5');
    expect(g.resumes()).toEqual([{ t: 'resume', epoch: 1 }]);
    for (let i = 0; i < 3; i++) d.advance();
    g.push(g.ps()); // stale same epoch
    expect(g.resumes().length).toBe(1);
  });
  it('manual hold is not auto-resumed; other player disconnect hold is not auto-resumed', async () => {
    const g = game(); g.push(g.start); await flush();
    g.push(g.catchup(5)); g.push(g.ps({ reason: 'manual' }));
    for (let i = 0; i < 10; i++) g.ctl.driver!.advance();
    expect(g.resumes()).toEqual([]);
    g.push(g.ps({ epoch: 2, holds: [{ player: 1, reason: 'disconnect', connected: false, since: 0 }] } as never));
    g.ctl.driver!.advance();
    expect(g.resumes()).toEqual([]);
  });
  it('reconnect after end shows the stored result', async () => {
    const g = game(); g.push(g.start); await flush();
    g.push(g.catchup(3));
    g.push({ t: 'end', outcome: { outcome: 'victory', winners: [0], winner: 0 }, finalTick: 3, finalHash: 'h3' } as never);
    const d = g.ctl.driver!;
    for (let i = 0; i < 5; i++) d.advance();
    g.sims[0]!.view.over = { outcome: 'victory', winners: [0], winner: 0 };
    d.advance();
    expect(g.ctl.snapshot().screen).toBe('result');
    // reconnect: start, catchup, stored end
    g.push({ t: 'welcome', pv: 2, playerId: 'p', serverVersions: versions });
    g.push({ t: 'room.joined', code: 'ABCD', you: { seat: 0, host: true } });
    g.push(g.start); g.push(g.catchup(3));
    g.push({ t: 'end', outcome: { outcome: 'victory', winners: [0], winner: 0 }, finalTick: 3, finalHash: 'h3' } as never);
    expect(g.ctl.snapshot().screen).toBe('playing');
    const d2 = g.ctl.driver!; expect(d2).not.toBe(d);
    for (let i = 0; i < 5; i++) d2.advance();
    g.sims[1]!.view.over = { outcome: 'victory', winners: [0], winner: 0 };
    d2.advance();
    expect(g.ctl.snapshot().screen).toBe('result');
    expect(g.ctl.snapshot().end?.finalTick).toBe(3);
  });
});
