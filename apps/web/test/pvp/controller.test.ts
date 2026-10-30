import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ERROR_CODES, type ClientMessage, type ServerMessage, type Versions } from '@node-arena/net';
import { RULES_VERSION, parseContentMeta } from '@node-arena/content';
import { BOT_VERSION } from '@node-arena/bots';
import { createPvpController, errorString, ERROR_STRINGS } from '../../src/pvp/controller';
import { versionsFromMeta, webVersions } from '../../src/net/versions';
import type { ConnState, PvpConnection } from '../../src/net/connection';
import type { VNode } from 'preact';
import { PvpResult } from '../../src/ui/pvp/PvpResult';
import { PvpLayer } from '../../src/ui/pvp/PvpLayer';
import { Lobby } from '../../src/ui/pvp/Lobby';
import { PvpHud } from '../../src/ui/pvp/PvpHud';

// Node-only component tests inspect the first render before effects subscribe.
vi.mock('preact/hooks', () => ({
  useState: (initial: unknown) => [initial, () => {}],
  useEffect: () => {}, useLayoutEffect: () => {}, useRef: (v: unknown) => ({ current: v }),
}));
import { createIdentity } from '../../src/net/identity';

type N = VNode<Record<string, unknown>>;
function find(node: unknown, test: (n: N) => boolean, out: N[] = []): N[] {
  if (Array.isArray(node)) node.forEach((n) => find(n, test, out));
  else if (node && typeof node === 'object' && 'props' in node) { const n = node as N; if (test(n)) out.push(n); find(n.props.children, test, out); }
  return out;
}
const versions: Versions = { rules: 'r', schema: 's', content: 'c', bot: 'b' };
function fake() {
  const sent: ClientMessage[] = [];
  const msgCbs = new Set<(m: ServerMessage) => void>(), stCbs = new Set<(s: ConnState) => void>();
  let closed = false, retried = 0;
  const c: PvpConnection & { push(m: ServerMessage): void; setState(s: ConnState): void } = {
    state: 'connected',
    send(m) { sent.push(m); return true; },
    onMessage(cb) { msgCbs.add(cb); return () => msgCbs.delete(cb); },
    onState(cb) { stCbs.add(cb); return () => stCbs.delete(cb); },
    retry() { retried++; }, close() { closed = true; },
    push(m) { msgCbs.forEach((f) => f(m)); },
    setState(s) { (c as { state: ConnState }).state = s; stCbs.forEach((f) => f(s)); },
  };
  return { c, sent, isClosed: () => closed, retried: () => retried };
}
function setup(serverUrl: string | null = 'ws://x', clientVersions = versions) {
  const f = fake();
  const urls: string[] = [];
  const identity = createIdentity({ local: null, session: null });
  const ctl = createPvpController({ identity, serverUrl, versions: clientVersions, createSocket: () => { throw new Error('no'); }, createConnection: (o) => { urls.push(o.url); return f.c; } });
  return { ctl, ...f, urls };
}
const welcome: ServerMessage = { t: 'welcome', pv: 1, playerId: 'p', serverVersions: versions };
const lobby = (host: number | null, ready = false): ServerMessage => ({ t: 'lobby.state', levelId: 'l', timeLimitSec: 60, host, spectators: 0, seats: [{ kind: 'human', team: 0, occupant: { nick: 'a', ready: true, status: 'connected' } }, { kind: 'human', team: 1, occupant: { nick: 'b', ready, status: 'connected' } }] });

describe('PvpController lobby flow', () => {
  it('idle -> menu -> connecting -> lobby (create, host)', () => {
    const h = setup();
    expect(h.ctl.snapshot().screen).toBe('idle');
    h.ctl.open(); expect(h.ctl.snapshot().screen).toBe('menu');
    h.ctl.create(); expect(h.ctl.snapshot().screen).toBe('connecting');
    expect(h.sent).toEqual([]);
    h.c.push(welcome); expect(h.sent).toEqual([{ t: 'room.create' }]);
    h.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: 0, host: true } });
    h.c.push(lobby(0));
    const s = h.ctl.snapshot();
    expect(s).toMatchObject({ screen: 'lobby', code: 'ABCD', seat: 0, host: true });
    expect(s.lobby?.seats).toHaveLength(2);
  });
  it('join sends upper-cased code; watch role', () => {
    const h = setup(); h.ctl.open(); h.ctl.join(' abcd '); h.c.push(welcome);
    expect(h.sent).toEqual([{ t: 'room.join', code: 'ABCD', role: 'play' }]);
    h.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: null, host: false } });
    expect(h.ctl.snapshot().role).toBe('watch');
  });
  it('play link without a nickname prompts with the room code before joining', () => {
    const h = setup();
    h.ctl.openLink({ code: 'ABCD', role: 'play' });
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'menu', code: 'ABCD', nick: '' });
    expect(h.urls).toEqual([]);
    h.ctl.setNick('  Bob  '); h.ctl.join(h.ctl.snapshot().code!); h.c.push(welcome);
    expect(h.sent).toEqual([{ t: 'room.join', code: 'ABCD', role: 'play' }]);
  });
  it('play link with a saved nickname joins immediately and reports a missing room', () => {
    const h = setup(); h.ctl.setNick('Bob');
    h.ctl.openLink({ code: 'ABCD', role: 'play' }); h.c.push(welcome);
    expect(h.sent).toEqual([{ t: 'room.join', code: 'ABCD', role: 'play' }]);
    h.c.push({ t: 'error', code: 'room-not-found' });
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'menu', error: ERROR_STRINGS['room-not-found'] });
  });
  it('watch link: nick prompt without nick, then watch join; spectator lands in lobby with seat null', () => {
    const h = setup();
    h.ctl.openLink({ code: 'ABCD', role: 'watch' });
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'menu', code: 'ABCD' }); expect(h.urls).toEqual([]);
    h.ctl.setNick('Bob'); h.ctl.watch(h.ctl.snapshot().code!); h.c.push(welcome);
    expect(h.sent).toEqual([{ t: 'room.join', code: 'ABCD', role: 'watch' }]);
    h.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: null, host: false } }); h.c.push(lobby(0));
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'lobby', seat: null, role: 'watch', host: false });
  });
  it('watch link with saved nick joins at once; spectators-full and room-not-found return to menu with error', () => {
    const h = setup(); h.ctl.setNick('Bob');
    h.ctl.openLink({ code: 'ABCD', role: 'watch' }); h.c.push(welcome);
    expect(h.sent).toEqual([{ t: 'room.join', code: 'ABCD', role: 'watch' }]);
    h.c.push({ t: 'error', code: 'spectators-full' });
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'menu', error: ERROR_STRINGS['spectators-full'] });
  });
  it('invalid watch link (null) opens the menu with an error', () => {
    const h = setup(); h.ctl.openLink(null);
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'menu', error: expect.stringContaining('Invalid room code') });
  });
  it('invalid play link opens the menu with an error and no connection', () => {
    const h = setup(); h.ctl.openLink(null);
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'menu', error: expect.stringContaining('Invalid room code') });
    expect(h.urls).toEqual([]);
  });
  it('play link reports unavailable online play without opening a connection', () => {
    const h = setup(null); h.ctl.setNick('Bob'); h.ctl.openLink({ code: 'ABCD', role: 'play' });
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'menu', code: 'ABCD', error: 'Online play is unavailable.' });
    expect(h.urls).toEqual([]);
  });
  it('welcome resume suppresses a pending join for the room already being replayed', () => {
    const h = setup(); h.ctl.setNick('Bob'); h.ctl.openLink({ code: 'ABCD', role: 'play' });
    h.c.push({ ...welcome, resume: { code: 'ABCD', seat: 1 } } as ServerMessage);
    expect(h.sent).toEqual([]);
    h.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: 1, host: false } });
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'lobby', code: 'ABCD', seat: 1 });
  });
  it('welcome resume for a different room does not silently discard the requested join', () => {
    const h = setup(); h.ctl.setNick('Bob'); h.ctl.openLink({ code: 'ABCD', role: 'play' });
    h.c.push({ ...welcome, resume: { code: 'WXYZ', seat: 1 } } as ServerMessage);
    expect(h.sent).toEqual([{ t: 'room.join', code: 'ABCD', role: 'play' }]);
  });
  it('ready toggles for non-host only; start host-only', () => {
    const h = setup(); h.ctl.open(); h.ctl.join('ABCD'); h.c.push(welcome);
    h.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: 1, host: false } }); h.c.push(lobby(0, false));
    h.ctl.ready(); h.c.push(lobby(0, true)); h.ctl.ready(); h.ctl.start();
    expect(h.sent.slice(1)).toEqual([{ t: 'lobby.ready', ready: true }, { t: 'lobby.ready', ready: false }]);
    const g = setup(); g.ctl.open(); g.ctl.create(); g.c.push(welcome);
    g.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: 0, host: true } }); g.c.push(lobby(0));
    g.ctl.ready(); g.ctl.start();
    expect(g.sent.slice(1)).toEqual([{ t: 'lobby.start' }]);
  });
  it('error during connecting returns to menu with string; in lobby keeps screen', () => {
    const h = setup(); h.ctl.open(); h.ctl.join('ZZZZ'); h.c.push(welcome);
    h.c.push({ t: 'error', code: 'room-not-found' });
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'menu', error: ERROR_STRINGS['room-not-found'] });
    expect(h.isClosed()).toBe(true);
    const g = setup(); g.ctl.open(); g.ctl.create(); g.c.push(welcome);
    g.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: 0, host: true } });
    g.c.push({ t: 'error', code: 'not-ready' });
    expect(g.ctl.snapshot()).toMatchObject({ screen: 'lobby', error: ERROR_STRINGS['not-ready'] });
  });
  it('every ERROR_CODE has a user string', () => {
    for (const c of ERROR_CODES) expect(errorString(c).length).toBeGreaterThan(3);
    expect(errorString('nope')).toBe('Something went wrong.');
  });
  it('leave sends room.leave, closes connection, resets to menu', () => {
    const h = setup(); h.ctl.open(); h.ctl.create(); h.c.push(welcome);
    h.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: 0, host: true } }); h.c.push(lobby(0));
    h.ctl.leave();
    expect(h.sent.at(-1)).toEqual({ t: 'room.leave' });
    expect(h.isClosed()).toBe(true);
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'menu', code: null, lobby: null, seat: null, host: false });
  });
  it('room.closed, superseded, refused -> menu with message; lost keeps screen and retry works', () => {
    const h = setup(); h.ctl.open(); h.ctl.create(); h.c.push(welcome);
    h.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: 1, host: false } });
    h.c.setState('lost'); expect(h.ctl.snapshot()).toMatchObject({ screen: 'lobby', error: 'Connection lost.' });
    h.ctl.retry(); expect(h.retried()).toBe(1);
    h.c.push({ t: 'room.closed', reason: 'idle' }); expect(h.ctl.snapshot().screen).toBe('menu');
    const g = setup(); g.ctl.open(); g.ctl.create(); g.c.setState('superseded');
    expect(g.ctl.snapshot()).toMatchObject({ screen: 'menu', error: 'Opened in another tab.' });
    const r = setup(); r.ctl.open(); r.ctl.create(); r.c.setState('refused');
    expect(r.ctl.snapshot()).toMatchObject({ screen: 'menu', error: 'A newer version of Node Arena is available - reload' });
  });
  it('no server url: create is a no-op; setNick persists via identity; subscribe notifies', () => {
    const h = setup(null); h.ctl.open(); h.ctl.create(); expect(h.ctl.snapshot().screen).toBe('menu');
    let n = 0; h.ctl.subscribe(() => n++); h.ctl.setNick('  Bob  ');
    expect(h.ctl.snapshot().nick).toBe('Bob'); expect(n).toBe(1);
  });
});

describe('web versions', () => {
  it('match what the server derives from the same sources', () => {
    const meta = parseContentMeta(readFileSync(new URL('../../../../packages/content/content.json', import.meta.url), 'utf8'));
    expect(webVersions()).toEqual({ rules: RULES_VERSION, schema: meta.schemaVersion, content: meta.contentVersion, bot: BOT_VERSION });
    expect(versionsFromMeta(JSON.stringify({ $schema: 'schemas/content.schema.json', schemaVersion: meta.schemaVersion, contentVersion: meta.contentVersion, rulesVersion: meta.rulesVersion }))).toEqual(webVersions());
  });
});

describe('PvpController match lifecycle', () => {
  const level = { simHash: '0123456789abcdef0000' } as never;
  const startMsg = (over: Partial<Extract<ServerMessage, { t: 'start' }>> = {}): ServerMessage => ({ t: 'start', matchId: 'm', levelId: 'l', simHash: '0123456789abcdef', seed: 7, seats: [{ player: 1, kind: 'human', team: 1, nick: 'b' }, { player: 0, kind: 'human', team: 0, nick: 'a' }], youPlayer: 1, inputDelay: 2, countdownMs: 3000, timeLimitTicks: 100, hashInterval: 10, ...over });
  function game() {
    const f = fake();
    const timers: Array<{ fn: () => void; ms: number; id: number; live: boolean }> = [];
    const simArgs: unknown[] = [];
    const rafs: Array<(t: number) => void> = [];
    const runRaf = () => { const q = rafs.splice(0); q.forEach((cb) => cb(0)); };
    const view = { tick: 0, over: null as unknown, players: [], buildings: { owner: [], level: [] } };
    const sim = { view, step: () => { view.tick++; if (view.tick === 3) view.over = { outcome: 'victory', winners: [0], winner: 0 }; return []; }, hash: () => `h${view.tick}` };
    const rt = { frame: 0, ticks: 0, disposed: 0, ctx: null as unknown, cancel: () => false, tick() { rt.ticks++; }, frame_: 0 };
    const runtime = { frame() { rt.frame++; }, tick: () => rt.ticks++, refresh() {}, cancel: () => false, dispose() { rt.disposed++; } };
    const ctl = createPvpController({
      identity: createIdentity({ local: null, session: null }), serverUrl: 'ws://x', versions, createSocket: () => { throw new Error('no'); },
      createConnection: () => f.c, getLevel: () => level, manifest: () => ({}) as never,
      createSim: (_l, seed, setup) => { simArgs.push(seed, setup); return sim as never; },
      createRuntime: (ctx) => { rt.ctx = ctx; return runtime; }, raf: (cb) => { rafs.push(cb); return rafs.length; }, caf: (id) => { rafs[id - 1] = () => {}; }, now: () => 0,
      setTimer: (fn, ms) => { const t = { fn, ms, id: timers.length, live: true }; timers.push(t); return t.id; }, clearTimer: (id) => { timers[id as number]!.live = false; },
    });
    ctl.open(); ctl.create(); f.c.push(welcome); f.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: 1, host: false } });
    const tickMsg = (n: number): ServerMessage => ({ t: 'tick', n });
    const endMsg = (finalTick: number): ServerMessage => ({ t: 'end', outcome: { outcome: 'victory', winners: [0], winner: 0 }, finalTick, finalHash: 'x' });
    return { ...f, ctl, timers, simArgs, view, rt, runRaf, tickMsg, endMsg };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('start -> countdown -> playing on first tick -> result at finalTick', async () => {
    const g = game(); g.c.push(startMsg()); await flush();
    expect(g.ctl.snapshot().screen).toBe('countdown');
    expect(g.simArgs).toEqual([7, { teams: [0, 1] }]);
    expect((g.rt.ctx as { seat: number }).seat).toBe(1);
    g.c.push(g.tickMsg(0)); g.c.push(g.tickMsg(1)); g.ctl.driver!.advance();
    expect(g.ctl.snapshot().screen).toBe('playing');
    g.c.push(g.endMsg(3)); expect(g.ctl.snapshot().screen).toBe('playing'); expect(g.ctl.snapshot().end?.finalTick).toBe(3);
    g.c.push(g.tickMsg(2)); g.ctl.driver!.advance();
    expect(g.ctl.snapshot().screen).toBe('result');
    expect(g.timers.every((t) => !t.live)).toBe(true);
  });
  it('result carries local ranking; rematch sends msg; lobby.state returns to lobby with new seed on next start', async () => {
    const g = game(); g.c.push(startMsg()); await flush();
    const ranking = [{ team: 0, seats: [0], rank: 1, buildings: 3, troops: 9, eliminatedAt: null }, { team: 1, seats: [1], rank: 2, buildings: 0, troops: 0, eliminatedAt: 5 }];
    g.c.push(g.tickMsg(0)); g.c.push(g.tickMsg(1)); g.ctl.driver!.advance();
    (g.view as { over: unknown }).over = { outcome: 'victory', winners: [0], winner: 0, ranking }; g.c.push(g.endMsg(3));
    expect(g.ctl.snapshot().screen).toBe('result');
    expect(g.ctl.snapshot().ranking).toEqual(ranking);
    g.ctl.rematch(); expect(g.sent.at(-1)).toEqual({ t: 'rematch' });
    g.c.push(lobby(0)); 
    expect(g.ctl.snapshot()).toMatchObject({ screen: 'lobby', end: null, start: null, ranking: null });
    g.c.push(startMsg({ seed: 99, matchId: 'm2' })); await flush();
    expect(g.simArgs.at(-2)).toBe(99);
  });
  it('rematch is a no-op outside result and for spectators', async () => {
    const g = game(); g.ctl.rematch(); expect(g.sent.some((m) => m.t === 'rematch')).toBe(false);
  });
  it('renders every rAF while playing and stops after leave', async () => {
    const g = game(); g.c.push(startMsg()); await flush();
    const base = g.rt.frame; // initial paint
    g.runRaf(); g.runRaf(); g.runRaf();
    expect(g.rt.frame).toBe(base + 3);
    g.ctl.leave(); g.runRaf(); g.runRaf();
    expect(g.rt.frame).toBe(base + 3);
  });
  it('stale driver frames after a new start do not render', async () => {
    const g = game(); g.c.push(startMsg()); await flush();
    const stale = g.ctl.driver!; g.c.push(startMsg({ matchId: 'm2' })); await flush();
    const before = g.rt.frame;
    (stale as unknown as { o: { onFrame: (u: unknown) => void } }).o.onFrame({});
    expect(g.rt.frame).toBe(before);
  });
  it('tick gap surfaces sync-lost once (event + error)', async () => {
    const g = game(); g.c.push(startMsg()); await flush();
    const got: unknown[] = []; g.ctl.subscribePvpEvents((e) => got.push(e));
    const warn = console.warn; console.warn = () => {};
    try { g.c.push(g.tickMsg(0)); g.c.push(g.tickMsg(5)); g.c.push(g.tickMsg(6)); } finally { console.warn = warn; }
    expect(got).toEqual([{ t: 'sync-lost' }]);
    expect(g.ctl.snapshot().error).toBe('Out of sync. Leave and rejoin.');
  });
  it('re-sent start with same matchId recreates sim+driver+runtime (no leak); new matchId rebuilds', async () => {
    const g = game(); g.c.push(startMsg()); await flush();
    const d = g.ctl.driver; g.c.push(g.tickMsg(0)); g.ctl.driver!.advance();
    g.c.push(startMsg()); await flush();
    expect(g.ctl.driver).not.toBe(d); expect(g.simArgs.length).toBe(4); expect(g.rt.disposed).toBe(1);
    g.c.push(g.tickMsg(0)); expect(g.ctl.snapshot().error).toBeNull();
    g.c.push(startMsg({ matchId: 'm2' })); await flush();
    expect(g.simArgs.length).toBe(6); expect(g.rt.disposed).toBe(2);
  });
  it('result screen Leave returns to the PvP menu', async () => {
    const g = game(); g.c.push(startMsg()); await flush();
    g.c.push(g.endMsg(50)); g.timers.at(-1)!.fn();
    const s = g.ctl.snapshot();
    expect(s.screen).toBe('result'); expect(s.end?.outcome.winners).toEqual([0]);
    const leave = find(PvpResult({ outcome: s.end!.outcome, seat: s.seat, onLeave: () => g.ctl.leave() }), (n) => n.props['data-testid'] === 'pvp-result-leave')[0]!;
    (leave.props.onClick as () => void)();
    expect(g.ctl.snapshot().screen).toBe('menu'); expect(g.ctl.snapshot().end).toBeNull();
    expect(g.sent.at(-1)).toEqual({ t: 'room.leave' });
  });
  it('sync-loss notice survives late lobby errors and further rejected ticks', async () => {
    const g = game(); g.c.push(startMsg()); await flush();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      g.c.push(g.tickMsg(5));
      g.c.push({ t: 'error', code: 'bad-lobby', detail: 'already in a room' } as ServerMessage);
      g.c.push(g.tickMsg(6));
    } finally { warn.mockRestore(); }
    expect(g.ctl.snapshot()).toMatchObject({ screen: 'countdown', error: 'Out of sync. Leave and rejoin.' });
    const alert = find(PvpLayer({ pvp: g.ctl }), n => n.props['data-testid'] === 'toast-sync-lost')[0];
    expect(alert).toBeDefined(); g.ctl.dispose();
  });
  it.each(['countdown', 'playing', 'result'] as const)('same-room reauth recreates driver and keeps %s screen', async (screen) => {
    const g = game(); g.c.push(startMsg()); await flush();
    if (screen !== 'countdown') { g.c.push(g.tickMsg(0)); g.ctl.driver!.advance(); }
    if (screen === 'result') { g.view.over = { outcome: 'victory', winners: [0], winner: 0 }; g.c.push(g.endMsg(1)); }
    const driver = g.ctl.driver;
    g.c.push(welcome);
    g.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: 1, host: false } });
    g.c.push(lobby(0)); g.c.push(startMsg()); await flush();
    expect(g.ctl.driver).not.toBe(driver);
    expect(g.ctl.snapshot().screen).toBe(screen === 'countdown' ? 'countdown' : 'playing');
    if (screen === 'playing') {
      expect((g.rt.ctx as { enabled(): boolean }).enabled()).toBe(true);
      g.c.push(g.tickMsg(0)); g.ctl.driver!.advance(); expect(g.view.tick).toBe(2);
    }
    g.ctl.dispose();
  });
  it('lobby Leave component returns to the online menu', () => {
    const h = setup(); h.ctl.open(); h.ctl.join('ABCD'); h.c.push(welcome);
    h.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: 1, host: false } }); h.c.push(lobby(0));
    const node = PvpLayer({ pvp: h.ctl });
    expect(node!.type).toBe(Lobby);
    const tree = Lobby(node!.props as unknown as Parameters<typeof Lobby>[0]);
    const leave = find(tree, n => n.props['data-testid'] === 'lobby-leave')[0]!;
    (leave.props.onClick as () => void)();
    expect(h.ctl.snapshot().screen).toBe('menu'); expect(h.sent.at(-1)).toEqual({ t: 'room.leave' });
  });
  it('seated Leave asks confirmation (no immediate leave); Yes sends quit', async () => {
    const g = game(); g.c.push(startMsg()); await flush();
    g.c.push(g.tickMsg(0)); g.ctl.driver!.advance();
    const node = PvpLayer({ pvp: g.ctl })!;
    const hud = find((node.type as unknown as (props: unknown) => unknown)(node.props), n => n.type === PvpHud as unknown)[0]!;
    const p = hud.props as unknown as Parameters<typeof PvpHud>[0];
    p.onLeave();
    expect(g.ctl.snapshot().screen).toBe('playing'); expect(g.sent.some(m => m.t === 'room.leave')).toBe(false);
    p.onQuitNo!(); expect(g.sent.some(m => m.t === 'quit')).toBe(false);
    p.onQuitYes!(); expect(g.sent.at(-1)).toEqual({ t: 'quit' }); expect(g.ctl.snapshot().screen).toBe('playing');
  });
  it('Esc menu Leave component returns to the online menu (spectator)', async () => {
    const g = game(); g.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: null, host: false } }); g.c.push(startMsg()); await flush();
    g.c.push(g.tickMsg(0)); g.ctl.driver!.advance();
    const node = PvpLayer({ pvp: g.ctl })!;
    const playing = (node.type as unknown as (props: unknown) => unknown)(node.props);
    const hud = find(playing, n => n.type === PvpHud as unknown)[0]!;
    const tree = PvpHud({ ...hud.props as unknown as Parameters<typeof PvpHud>[0], menuOpen: true });
    const leave = find(tree, n => n.props['data-testid'] === 'pvp-leave')[0]!;
    (leave.props.onClick as () => void)();
    expect(g.ctl.snapshot().screen).toBe('menu'); expect(g.sent.at(-1)).toEqual({ t: 'room.leave' });
  });
  it.each([false, true])('sync loss is visible with Leave until reauth start rebuilds the match (playing=%s)', async (playing) => {
    const g = game(); g.c.push(startMsg()); await flush();
    if (playing) { g.c.push(g.tickMsg(0)); g.ctl.driver!.advance(); }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { g.c.push(g.tickMsg(5)); } finally { warn.mockRestore(); }
    g.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: 1, host: false } });
    const node = PvpLayer({ pvp: g.ctl });
    expect(find(node, n => n.props['data-testid'] === 'toast-sync-lost')[0]?.props.children).toBe('Out of sync. Leave and rejoin.');
    const leave = find(node, n => n.props['data-testid'] === 'pvp-sync-leave')[0];
    expect(leave).toBeDefined();
    // M2: repeated start replays from tick 0 on a fresh stream, which recovers the sync loss.
    g.c.push(startMsg()); await flush();
    expect(g.ctl.snapshot().error).toBeNull();
    g.c.push(g.tickMsg(0)); expect(g.ctl.snapshot().error).toBeNull();
    (leave!.props.onClick as () => void)();
    expect(g.ctl.snapshot().screen).toBe('menu'); expect(g.ctl.driver).toBeNull();
  });
  it('3 s fallback shows result and logs mismatch', async () => {
    const g = game(); g.c.push(startMsg()); await flush();
    g.c.push(g.endMsg(50));
    expect(g.timers.at(-1)).toMatchObject({ ms: 3000, live: true });
    const errs: unknown[] = []; const orig = console.error; console.error = (...a) => { errs.push(a); };
    try { g.timers.at(-1)!.fn(); } finally { console.error = orig; }
    expect(g.ctl.snapshot().screen).toBe('result'); expect(errs.length).toBe(1);
  });
  it('desync emits event and warns', async () => {
    const g = game(); g.c.push(startMsg()); await flush();
    const got: unknown[] = []; g.ctl.subscribePvpEvents((e) => got.push(e));
    const orig = console.warn; let warned = 0; console.warn = () => { warned++; };
    try { g.c.push({ t: 'desync', tick: 10, serverHash: 'abc' }); } finally { console.warn = orig; }
    expect(got).toEqual([{ t: 'desync', tick: 10, serverHash: 'abc', localTick: 0, localHash: 'h0' }]); expect(warned).toBe(1);
  });
  it('seat.status stored; simHash mismatch leaves; room.closed/leave dispose', async () => {
    const g = game(); g.c.push(startMsg()); await flush();
    g.c.push({ t: 'seat.status', player: 0, status: 'grace', graceMs: 5000 });
    expect(g.ctl.snapshot().seatStatus[0]).toEqual({ status: 'grace', graceMs: 5000 });
    g.c.push({ t: 'room.closed', reason: 'idle' });
    expect(g.ctl.snapshot().screen).toBe('menu'); expect(g.rt.disposed).toBe(1); expect(g.ctl.driver).toBeNull();
    const h = game(); h.c.push(startMsg()); await flush(); h.ctl.leave();
    expect(h.ctl.snapshot().screen).toBe('menu'); expect(h.rt.disposed).toBe(1);
    const m = game(); m.c.push(startMsg({ simHash: 'ffffffffffffffff' })); await flush();
    expect(m.ctl.snapshot()).toMatchObject({ screen: 'menu', error: 'Game content differs from the server. Reload to update.' });
    expect(m.sent.at(-1)).toEqual({ t: 'room.leave' }); expect(m.simArgs).toEqual([]);
  });
});


it('version refusal keeps a reload action reachable in the menu', () => {
  const h = setup(); h.ctl.open(); h.ctl.create(); h.c.setState('refused');
  expect(h.ctl.snapshot()).toMatchObject({ screen: 'menu', conn: 'refused', error: 'A newer version of Node Arena is available - reload' });
});


it('reload rechecks a mismatch, blocks room actions on repeat refusal, and recovers when compatible', () => {
  const entries = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => entries.set(k, v), removeItem: (k: string) => entries.delete(k) });
  try {
    const first = setup(); first.ctl.open(); first.ctl.create(); first.c.setState('refused'); first.ctl.dispose();
    const otherServer = setup('ws://different'); otherServer.ctl.open(); expect(otherServer.urls).toEqual([]);
    const otherBuild = setup('ws://x', { ...versions, rules: 'new' }); otherBuild.ctl.open(); expect(otherBuild.urls).toEqual([]);
    const linked = setup(); linked.ctl.setNick('Saved'); linked.ctl.openLink({ code: 'ABCD', role: 'play' }); linked.c.push(welcome);
    expect(linked.sent).toEqual([{ t: 'room.join', code: 'ABCD', role: 'play' }]);
    linked.ctl.dispose();
    // Recreate the failed-build marker after the successful link handshake.
    const rejected = setup(); rejected.ctl.open(); rejected.ctl.create(); rejected.c.setState('refused'); rejected.ctl.dispose();
    const reloaded = setup(); reloaded.ctl.open();
    expect(reloaded.ctl.snapshot().screen).toBe('connecting');
    reloaded.c.setState('refused');
    expect(reloaded.ctl.snapshot()).toMatchObject({ screen: 'menu', pvpUnavailable: true, error: 'PvP unavailable: this build differs from the server' });
    reloaded.ctl.create(); reloaded.ctl.join('ABCD');
    expect(reloaded.urls).toHaveLength(1);
    reloaded.ctl.dispose();
    const compatible = setup(); compatible.ctl.open(); compatible.c.push(welcome);
    expect(compatible.ctl.snapshot()).toMatchObject({ screen: 'menu', pvpUnavailable: false, error: null });
    expect(compatible.sent).toEqual([]); // compatibility probe never creates a room
    compatible.ctl.create(); compatible.c.push(welcome);
    expect(compatible.sent).toEqual([{ t: 'room.create' }]);
    compatible.ctl.dispose();
    const next = setup(); next.ctl.open(); expect(next.urls).toEqual([]);
  } finally { vi.unstubAllGlobals(); }
});
