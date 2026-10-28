import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ERROR_CODES, type ClientMessage, type ServerMessage, type Versions } from '@node-arena/net';
import { RULES_VERSION, parseContentMeta } from '@node-arena/content';
import { BOT_VERSION } from '@node-arena/bots';
import { createPvpController, errorString, ERROR_STRINGS } from '../../src/pvp/controller';
import { versionsFromMeta, webVersions } from '../../src/net/versions';
import type { ConnState, PvpConnection } from '../../src/net/connection';
import { createIdentity } from '../../src/net/identity';

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
function setup(serverUrl: string | null = 'ws://x') {
  const f = fake();
  const urls: string[] = [];
  const identity = createIdentity({ local: null, session: null });
  const ctl = createPvpController({ identity, serverUrl, versions, createSocket: () => { throw new Error('no'); }, createConnection: (o) => { urls.push(o.url); return f.c; } });
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
  it('start message -> countdown, stores StartMsg', () => {
    const h = setup(); h.ctl.open(); h.ctl.create(); h.c.push(welcome);
    h.c.push({ t: 'room.joined', code: 'ABCD', you: { seat: 0, host: true } });
    const start: ServerMessage = { t: 'start', matchId: 'm', levelId: 'l', simHash: 'x', seed: 1, seats: [], youPlayer: 0, inputDelay: 3, countdownMs: 3000, timeLimitTicks: 10, hashInterval: 5 };
    h.c.push(start);
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'countdown', start });
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
    expect(r.ctl.snapshot().screen).toBe('menu');
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
