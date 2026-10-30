import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LockstepClient, encode, parseServerMessage, type ClientMessage, type PauseStateMsg, type ServerMessage, type Versions } from '@node-arena/net';
import type { Sim } from '@node-arena/sim';
import { NetDriver } from '../../src/driver/net-driver';
import { createPvpController } from '../../src/pvp/controller';
import { pauseRemaining, toPauseView } from '../../src/pvp/pause';
import { createPvpConnection, PING_INTERVAL_MS, type WebSocketLike } from '../../src/net/connection';
import { createIdentity } from '../../src/net/identity';
import type { ConnState, PvpConnection } from '../../src/net/connection';

const versions: Versions = { rules: 'r', schema: 's', content: 'c', bot: 'b' };
const ps = (o: Partial<PauseStateMsg> = {}): PauseStateMsg => ({ t: 'pause.state', epoch: 1, paused: true, tick: 3, unlimited: false, holds: [{ player: 0, reason: 'manual', connected: true, since: 0 }], budgets: [30000, 20000], ...o });

function driverSetup() {
  const view = { tick: 0, over: false };
  const sim = { view, step() { view.tick++; return []; }, hash: () => `h${view.tick}` } as unknown as Sim;
  const sent: ClientMessage[] = [], errs: string[] = [];
  const d = new NetDriver({ sim, client: new LockstepClient(0), send: (m) => sent.push(m), now: () => 0, raf: () => 0, caf: () => {}, });
  return { d, view, sent, errs, tick: (n: number) => d.push({ t: 'tick', n }) };
}

describe('NetDriver pause freeze', () => {
  it('steps to the frozen tick then holds (hash equality), resumes after release', () => {
    const s = driverSetup();
    for (let i = 0; i < 3; i++) s.tick(i);
    s.d.setFrozen(3);
    s.d.advance(); s.d.advance();
    expect(s.view.tick).toBe(3);
    expect(s.d.advance()).toBe(0);
    expect(s.d.frozenTick).toBe(3);
    expect(s.d['o'].sim.hash()).toBe('h3');
    s.d.setFrozen(null);
    s.tick(3);
    expect(s.d.advance()).toBe(1);
    expect(s.view.tick).toBe(4);
  });
  it('never steps past frozen even with more queued behind it (frozen set early)', () => {
    const s = driverSetup();
    for (let i = 0; i < 4; i++) s.tick(i);
    s.d.setFrozen(2);
    s.d.advance(); s.d.advance();
    expect(s.view.tick).toBe(2);
  });
  it('frames past the frozen tick are queued, not stepped, then stepped on release', () => {
    const s = driverSetup();
    s.d.setFrozen(0);
    s.tick(0);
    s.d.push({ t: 'ticks', from: 1, to: 3, cmds: [] });
    expect(s.d.queued).toBe(3);
    expect(s.d.advance()).toBe(0);
    expect(s.view.tick).toBe(0);
    s.d.setFrozen(null);
    s.d.advance(); s.d.advance();
    expect(s.view.tick).toBe(3);
  });
  it('does not submit cmds while frozen', () => {
    const s = driverSetup();
    s.d.setFrozen(0);
    expect(s.d.submit({ type: 'CutLine' } as never)).toBeNull();
    expect(s.sent).toEqual([]);
  });
});

describe('pauseRemaining', () => {
  it('counts down holders only, clamps at 0, keeps null', () => {
    const v = toPauseView(ps({ budgets: [30000, 20000, null] }), 1000);
    expect(pauseRemaining(v, 1000)).toEqual([30000, 20000, null]);
    expect(pauseRemaining(v, 6000)).toEqual([25000, 20000, null]);
    expect(pauseRemaining(v, 99000)).toEqual([0, 20000, null]);
    expect(pauseRemaining(null, 0)).toEqual([]);
    expect(pauseRemaining(toPauseView(ps({ unlimited: true }), 0), 5000)).toEqual([30000, 20000]);
  });
});

describe('controller pause.state', () => {
  function game() {
    const sent: ClientMessage[] = [];
    const msgCbs = new Set<(m: ServerMessage) => void>();
    const c = { state: 'connected', send: (m: ClientMessage) => { sent.push(m); return true; }, onMessage: (cb: (m: ServerMessage) => void) => { msgCbs.add(cb); return () => msgCbs.delete(cb); }, onState: (_cb: (s: ConnState) => void) => () => {}, retry() {}, close() {} } as unknown as PvpConnection;
    const push = (m: ServerMessage) => msgCbs.forEach((f) => f(m));
    let t = 100;
    const view = { tick: 0, over: null as unknown, players: [], buildings: { owner: [], level: [] } };
    const sim = { view, step: () => { view.tick++; return []; }, hash: () => `h${view.tick}` };
    const ctl = createPvpController({
      identity: createIdentity({ local: null, session: null }), serverUrl: 'ws://x', versions, createSocket: () => { throw new Error('no'); },
      createConnection: () => c, getLevel: () => ({ simHash: '0123456789abcdef0000' }) as never, manifest: () => ({}) as never,
      createSim: () => sim as never, createRuntime: () => ({ frame() {}, tick() {}, refresh() {}, cancel: () => false, dispose() {} }) as never,
      raf: () => 0, caf: () => {}, now: () => t,
    });
    ctl.open(); ctl.create();
    push({ t: 'welcome', pv: 3, playerId: 'p', serverVersions: versions });
    push({ t: 'room.joined', code: 'ABCD', you: { seat: 0, host: true } });
    const start = (matchId = 'm'): ServerMessage => ({ t: 'start', matchId, levelId: 'l', simHash: '0123456789abcdef', seed: 1, seats: [{ player: 0, kind: 'human', team: 0, nick: 'a' }, { player: 1, kind: 'human', team: 1, nick: 'b' }], youPlayer: 0, inputDelay: 2, countdownMs: 3000, timeLimitTicks: 100, hashInterval: 10 });
    return { ctl, push, start, setT: (x: number) => { t = x; }, view, sent };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('stores snapshot, freezes driver, countdown estimate from snapshot', async () => {
    const g = game(); g.push(g.start()); await flush();
    for (let i = 0; i < 4; i++) g.push({ t: 'tick', n: i });
    g.push(ps({ tick: 4 }));
    expect(g.ctl.snapshot().pause).toMatchObject({ epoch: 1, paused: true, tick: 4, receivedAt: 100 });
    expect(g.ctl.driver!.frozenTick).toBe(4);
    g.setT(2100);
    expect(g.ctl.pauseRemaining()).toEqual([28000, 20000]);
    g.push(ps({ epoch: 2, paused: false, holds: [], budgets: [28000, 20000] }));
    expect(g.ctl.driver!.frozenTick).toBeNull();
  });
  it('ignores stale epochs; resets lastEpoch on every start (AC15)', async () => {
    const g = game(); g.push(g.start()); await flush();
    g.push(ps({ epoch: 5, tick: 2 }));
    g.push(ps({ epoch: 5, paused: false, holds: [] }));
    g.push(ps({ epoch: 4, paused: false, holds: [] }));
    expect(g.ctl.snapshot().pause).toMatchObject({ epoch: 5, paused: true });
    expect(g.ctl.driver!.frozenTick).toBe(2);
    // reconnect into the same match: start again, epoch restarts low but is accepted
    g.push(g.start());
    g.push(ps({ epoch: 1, tick: 1 }));
    expect(g.ctl.snapshot().pause).toMatchObject({ epoch: 1 });
    expect(g.ctl.driver!.frozenTick).toBe(1);
    // rematch / new matchId
    g.push(g.start('m2')); await flush();
    expect(g.ctl.snapshot().pause).toBeNull();
    g.push(ps({ epoch: 1, tick: 0 }));
    expect(g.ctl.snapshot().pause).toMatchObject({ epoch: 1 });
  });
  it('terminal forfeit while paused (server order): no sync-lost, final hash matches end', async () => {
    const g = game(); g.push(g.start()); await flush();
    const ev: string[] = []; g.ctl.subscribePvpEvents((e) => ev.push(e.t));
    for (let i = 0; i < 3; i++) g.push({ t: 'tick', n: i });
    g.ctl.driver!.advance(); g.ctl.driver!.advance();
    g.push(ps({ epoch: 1, tick: 3 }));
    g.ctl.driver!.advance();
    expect(g.view.tick).toBe(3);
    g.push({ t: 'tick', n: 3, c: [{ type: 'Forfeit', player: 1 }] } as never);
    expect(g.ctl.driver!.advance()).toBe(0);
    expect(g.view.tick).toBe(3);
    g.push(ps({ epoch: 2, paused: false, tick: 3, holds: [] }));
    g.push({ t: 'end', outcome: { kind: 'win', winner: 0 } as never, finalTick: 4, finalHash: 'h4' });
    g.ctl.driver!.advance();
    expect(ev).toEqual([]);
    expect(g.view.tick).toBe(4);
    expect(g.ctl.driver!.sim.hash()).toBe('h4');
    expect(g.ctl.snapshot().error).toBeNull();
    expect(g.ctl.snapshot().screen).toBe('result');
  });
  it('end while still frozen releases the freeze and steps the queued tail', async () => {
    const g = game(); g.push(g.start()); await flush();
    g.push({ t: 'tick', n: 0 }); g.ctl.driver!.advance();
    g.push(ps({ tick: 1 }));
    g.push({ t: 'tick', n: 1 });
    g.push({ t: 'end', outcome: { kind: 'draw' } as never, finalTick: 2, finalHash: 'h2' });
    expect(g.ctl.driver!.frozenTick).toBeNull();
    g.ctl.driver!.advance();
    expect(g.ctl.snapshot().screen).toBe('result');
  });
  it('pause/resume/quit senders: seated, state-guarded, resume carries epoch', async () => {
    const g = game();
    g.ctl.pause(); g.ctl.quit(); g.ctl.resume();
    expect(g.sent.filter((m) => m.t !== 'room.create')).toEqual([]);
    g.push(g.start()); await flush();
    g.push({ t: 'tick', n: 0 }); g.ctl.driver!.advance();
    g.ctl.pause(); g.ctl.resume();
    expect(g.sent.filter((m) => m.t !== 'room.create')).toEqual([{ t: 'pause' }]);
    g.push(ps({ epoch: 7, tick: 1 }));
    g.ctl.resume(); g.ctl.quit();
    expect(g.sent.filter((m) => m.t !== 'room.create').slice(1)).toEqual([{ t: 'resume', epoch: 7 }, { t: 'quit' }]);
  });
  it('spectator sends nothing', async () => {
    const g = game(); g.push({ t: 'room.joined', code: 'ABCD', you: { seat: null, host: false } });
    g.push({ ...(g.start() as object), youPlayer: null } as never); await flush();
    g.push({ t: 'tick', n: 0 }); g.ctl.driver!.advance();
    g.ctl.pause(); g.ctl.quit(); g.ctl.resume();
    expect(g.sent.filter((m) => m.t !== 'room.create')).toEqual([]);
  });
  it('start.cancel discards the match and returns to lobby; a later start works', async () => {
    const g = game(); g.push(g.start('m1')); await flush();
    const d = g.ctl.driver!;
    expect(g.ctl.snapshot().screen).toBe('countdown');
    g.push({ t: 'start.cancel', matchId: 'other' });
    expect(g.ctl.snapshot().screen).toBe('countdown');
    g.push({ t: 'start.cancel', matchId: 'm1' });
    expect(g.ctl.snapshot()).toMatchObject({ screen: 'lobby', start: null, pause: null });
    expect(g.ctl.driver).toBeNull();
    expect(d.advance()).toBe(0);
    g.push(g.start('m2')); await flush();
    expect(g.ctl.snapshot()).toMatchObject({ screen: 'countdown' });
    expect(g.ctl.snapshot().start?.matchId).toBe('m2');
    expect(g.ctl.driver).not.toBe(d);
  });
});

describe('connection app ping', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('pings every 3 s while connected, stops on close/drop', () => {
    const sent: string[] = [];
    let sock!: WebSocketLike;
    const conn = createPvpConnection({ url: 'ws://x', nick: 'n', token: 't', versions, createSocket: () => { sock = { onopen: null, onmessage: null, onclose: null, onerror: null, send: (d) => sent.push(d), close() {} }; return sock; } });
    sock.onopen!();
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(PING_INTERVAL_MS - 1); expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(JSON.parse(sent[1]!)).toEqual({ t: 'ping', id: 1 });
    vi.advanceTimersByTime(PING_INTERVAL_MS * 2);
    expect(sent.map((d) => JSON.parse(d).t)).toEqual(['hello', 'ping', 'ping', 'ping']);
    sock.onclose!({ code: 1006 });
    const n = sent.length;
    vi.advanceTimersByTime(PING_INTERVAL_MS * 3 - 1);
    expect(sent.length).toBe(n);
    conn.close();
  });
  it('server pong parses and is ignored by the controller path', () => {
    expect(parseServerMessage(encode({ t: 'pong', id: 1, tick: 0 })).ok).toBe(true);
  });
});
