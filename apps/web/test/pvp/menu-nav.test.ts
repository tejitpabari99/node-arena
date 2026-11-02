import { describe, expect, it } from 'vitest';
import type { PvpMapInfo } from '@node-arena/content';
import type { ClientMessage, ServerMessage, Versions } from '@node-arena/net';
import { createIdentity, PVP_KEY, type KV } from '../../src/net/identity';
import { createPvpController } from '../../src/pvp/controller';
import type { PvpConnection } from '../../src/net/connection';

const map = (id: string, maxPlayers: number): PvpMapInfo => ({ id, name: id, maxPlayers, teams: Array.from({ length: maxPlayers }, (_, i) => i), timeLimitSec: null, theme: 't' });
const versions: Versions = { rules: 'r', schema: 's', content: 'c', bot: 'b' };
const welcome: ServerMessage = { t: 'welcome', pv: 1, playerId: 'p', serverVersions: versions };

function setup(nick = 'Bob', local: KV | null = null) {
  const sent: ClientMessage[] = [], cbs = new Set<(m: ServerMessage) => void>();
  let made = 0;
  const conn: PvpConnection = { state: 'connected', info: { attempt: 0, nextRetryAt: null, outageStartedAt: null, lastCloseCode: null }, send(m) { sent.push(m); return true; }, onMessage(cb) { cbs.add(cb); return () => cbs.delete(cb); }, onState() { return () => {}; }, retry() {}, close() {} };
  const state = { maps: [map('duel', 2), map('cross', 4)] };
  const identity = createIdentity({ local, session: null }); if (nick) identity.setNick(nick);
  const ctl = createPvpController({ identity, serverUrl: 'ws://x', versions, createSocket: () => { throw new Error('no'); }, createConnection: () => { made++; return conn; }, maps: () => state.maps });
  return { ctl, sent, state, made: () => made, push: (m: ServerMessage) => cbs.forEach((f) => f(m)) };
}

describe('menu navigation + draft persistence', () => {
  it('goCreate re-clamps a stale draft when the map shrinks, and starts fresh when the map is gone', () => {
    const h = setup(); h.ctl.open(); h.ctl.goCreate();
    h.ctl.draftMap('cross'); h.ctl.draftPlayers(4); h.ctl.draftType('team'); h.ctl.draftTeams(3);
    h.ctl.back();
    h.state.maps = [map('duel', 2), map('cross', 3)];
    h.ctl.goCreate();
    expect(h.ctl.snapshot().createDraft).toMatchObject({ mapId: 'cross', players: 3, teams: 3, type: 'team' });
    expect(h.ctl.snapshot().createDraft!.rows).toHaveLength(3);
    h.ctl.back();
    h.state.maps = [map('duel', 2)];
    h.ctl.goCreate();
    expect(h.ctl.snapshot().createDraft).toMatchObject({ mapId: 'duel', players: 2, type: 'pvp' });
  });
  it('goCreate with no maps leaves the draft null', () => {
    const h = setup(); h.state.maps = []; h.ctl.open(); h.ctl.goCreate();
    expect(h.ctl.snapshot()).toMatchObject({ menuView: 'create', createDraft: null });
    h.ctl.createRoom(); expect(h.ctl.snapshot().screen).toBe('menu');
  });
  it('createRoom is a no-op when the drafted map disappeared', () => {
    const h = setup(); h.ctl.open(); h.ctl.goCreate(); h.ctl.draftMap('cross');
    h.state.maps = [map('duel', 2)];
    h.ctl.createRoom();
    expect(h.ctl.snapshot().screen).toBe('menu'); expect(h.made()).toBe(0); expect(h.sent).toEqual([]);
    h.ctl.draftType('team'); expect(h.ctl.snapshot().createDraft!.type).toBe('pvp'); // draft edits ignore the missing map too
  });
  it('reset(error) keeps the create draft and raw nick draft', () => {
    const h = setup(); h.ctl.open(); h.ctl.setNick('a b '); h.ctl.goCreate();
    h.ctl.draftMap('cross'); h.ctl.draftPlayers(3); h.ctl.draftRow(2, { kind: 'bot', difficulty: 'hard' });
    const draft = h.ctl.snapshot().createDraft;
    h.ctl.createRoom(); h.push(welcome);
    h.push({ t: 'error', code: 'internal' } as ServerMessage);
    const s = h.ctl.snapshot();
    expect(s).toMatchObject({ screen: 'menu', error: 'Server error. Try again.', menuView: 'home', nickDraft: 'a b ' });
    expect(s.createDraft).toEqual(draft);
    h.ctl.goCreate(); expect(h.ctl.snapshot().createDraft).toEqual(draft);
  });
  it('leaving a room keeps the create draft for the next visit', () => {
    const h = setup(); h.ctl.open(); h.ctl.goCreate(); h.ctl.draftMap('cross'); h.ctl.draftPlayers(4);
    h.ctl.createRoom(); h.push(welcome); h.push({ t: 'room.joined', code: 'ABCD', you: { seat: 0, host: true } });
    h.ctl.leave();
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'menu', createDraft: { mapId: 'cross', players: 4 } });
  });
  it('back() create -> home keeps the draft; back() from home closes and drops it', () => {
    const h = setup(); h.ctl.open(); h.ctl.goCreate(); h.ctl.draftMap('cross');
    const draft = h.ctl.snapshot().createDraft;
    h.ctl.back();
    expect(h.ctl.snapshot()).toMatchObject({ menuView: 'home', screen: 'menu' }); expect(h.ctl.snapshot().createDraft).toEqual(draft);
    h.ctl.back();
    expect(h.ctl.snapshot()).toMatchObject({ screen: 'idle', createDraft: null });
    h.ctl.back(); expect(h.ctl.snapshot().screen).toBe('idle');
  });
  it('deep link with an existing create draft switches to the join form and keeps the draft', () => {
    const h = setup(''); h.ctl.open(); h.ctl.goCreate(); h.ctl.draftMap('cross');
    const draft = h.ctl.snapshot().createDraft;
    h.ctl.openLink({ code: 'WXYZ', role: 'watch' });
    expect(h.ctl.snapshot()).toMatchObject({ menuView: 'join-form', joinRole: 'watch', code: 'WXYZ', screen: 'menu' });
    expect(h.ctl.snapshot().createDraft).toEqual(draft);
    h.ctl.openLink({ code: 'ABCD', role: 'play' });
    expect(h.ctl.snapshot()).toMatchObject({ menuView: 'join-form', joinRole: 'play', code: 'ABCD' });
  });
  it('draft* calls are no-ops outside the menu screen', () => {
    const h = setup();
    h.ctl.draftType('team'); h.ctl.draftMap('cross'); h.ctl.draftPlayers(4); h.ctl.draftTeams(3); h.ctl.draftRow(1, { kind: 'bot' });
    expect(h.ctl.snapshot().createDraft).toBeNull(); // idle
    h.ctl.open(); h.ctl.goCreate();
    const draft = h.ctl.snapshot().createDraft;
    h.ctl.createRoom(); // connecting
    expect(h.ctl.snapshot().screen).toBe('connecting');
    h.ctl.draftType('team'); h.ctl.draftMap('cross'); h.ctl.draftPlayers(2); h.ctl.draftTeams(2); h.ctl.draftRow(1, { kind: 'bot' });
    expect(h.ctl.snapshot().createDraft).toEqual(draft);
    h.push(welcome); h.push({ t: 'room.joined', code: 'ABCD', you: { seat: 0, host: true } }); // lobby
    h.ctl.draftMap('cross'); expect(h.ctl.snapshot().createDraft).toEqual(draft);
    const view = h.ctl.snapshot().menuView;
    h.ctl.goCreate(); h.ctl.goJoin(); h.ctl.chooseRole('watch'); h.ctl.back();
    expect(h.ctl.snapshot()).toMatchObject({ menuView: view, screen: 'lobby', joinRole: 'play' }); // navigation also ignored outside the menu
  });
  it('unknown map id is ignored by draftMap', () => {
    const h = setup(); h.ctl.open(); h.ctl.goCreate();
    const draft = h.ctl.snapshot().createDraft; h.ctl.draftMap('nope');
    expect(h.ctl.snapshot().createDraft).toBe(draft);
  });
});

describe('nickname persistence through the controller', () => {
  class Mem implements KV { m = new Map<string, string>(); writes: string[] = []; getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.writes.push(v); this.m.set(k, v); } }
  it('raw draft is capped at NICK_MAX untrimmed while the stored nick is trimmed first', () => {
    const local = new Mem(), h = setup('', local); h.ctl.open();
    h.ctl.setNick('  ' + 'x'.repeat(30));
    expect(h.ctl.snapshot().nickDraft).toBe(('  ' + 'x'.repeat(30)).slice(0, 20));
    expect(h.ctl.snapshot().nick).toBe('x'.repeat(20));
    expect(JSON.parse(local.m.get(PVP_KEY)!).nick).toBe('x'.repeat(20));
  });
  it('empty nick is persisted and clears the draft', () => {
    const local = new Mem(), h = setup('Bob', local); h.ctl.open();
    local.writes.length = 0;
    h.ctl.setNick('');
    expect(h.ctl.snapshot()).toMatchObject({ nick: '', nickDraft: '' });
    expect(local.writes.map((w) => JSON.parse(w).nick)).toEqual(['']);
  });
  it('every setNick call persists, including repeats of the same value', () => {
    const local = new Mem(), h = setup('', local); h.ctl.open();
    for (const v of ['a', 'a', 'ab', 'ab ']) h.ctl.setNick(v);
    expect(local.writes.map((w) => JSON.parse(w).nick)).toEqual(['a', 'a', 'ab', 'ab']);
  });
});
