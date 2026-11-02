import { describe, expect, it } from 'vitest';
import type { PvpMapInfo } from '@node-arena/content';
import { createIdentity, PVP_KEY, type KV } from '../../src/net/identity';
import { createPvpController } from '../../src/pvp/controller';
import type { PvpConnection } from '../../src/net/connection';
import type { ClientMessage, ServerMessage, Versions } from '@node-arena/net';
import { botLabels, canCreate, clampDraft, defaultTeam, deriveType, draftToSeats, newDraft, playersMax, seatsToDraft, setMap, setPlayers, setRow, setTeams, setType, teamsMax, type CreateDraft } from '../../src/pvp/room-draft';

const map = (id: string, maxPlayers: number): PvpMapInfo => ({ id, name: id, maxPlayers, teams: Array.from({ length: maxPlayers }, (_, i) => i), timeLimitSec: null, theme: 't' });
const duel = map('duel', 2), cross = map('cross', 4), big = map('big', 12);

describe('draft helpers', () => {
  it('defaults', () => {
    const d = newDraft([duel, cross])!;
    expect(d).toMatchObject({ type: 'pvp', mapId: 'duel', players: 2, teams: 2 });
    expect(d.rows.map((r) => r.kind)).toEqual(['human', 'human']);
    expect(newDraft([])).toBeNull();
  });
  it.each([[duel, 2], [cross, 4], [big, 8]])('playersMax %#', (m, n) => expect(playersMax(m)).toBe(n));
  it.each([[2, 2], [3, 3], [4, 4], [8, 4]])('teamsMax(%i)=%i', (p, t) => expect(teamsMax(p)).toBe(t));
  it('clamp table', () => {
    const base = newDraft([cross])!;
    const t: Array<[Partial<CreateDraft>, number, number]> = [
      [{ players: 1 }, 2, 2], [{ players: 99 }, 4, 2], [{ players: 3, teams: 9 }, 3, 3], [{ players: 2, teams: 4 }, 2, 2], [{ players: 4, teams: 0 }, 4, 2],
    ];
    for (const [patch, players, teams] of t) {
      const c = clampDraft({ ...base, ...patch }, cross);
      expect([c.players, c.teams, c.rows.length]).toEqual([players, teams, players]);
    }
  });
  it('reducing players reduces teams; changing map clamps', () => {
    let d = setType(newDraft([cross])!, 'team', cross);
    d = setTeams(setPlayers(d, 4, cross), 4, cross); expect(d.teams).toBe(4);
    d = setPlayers(d, 3, cross); expect(d.teams).toBe(3);
    d = setPlayers(d, 2, cross); expect(d.teams).toBe(2);
    d = setMap(setPlayers(d, 4, cross), duel); expect(d).toMatchObject({ mapId: 'duel', players: 2 });
  });
  it('Team default pairing follows the map authored teams when the team count matches (Cross opposite corners)', () => {
    const crossT: PvpMapInfo = { ...cross, teams: [0, 0, 1, 1] };
    expect([0, 1, 2, 3].map((i) => defaultTeam(i, 'team', 2, crossT))).toEqual([0, 0, 1, 1]);
    expect([0, 1, 2, 3].map((i) => defaultTeam(i, 'team', 3, crossT))).toEqual([0, 1, 2, 0]); // count mismatch: round-robin
    expect([0, 1, 2, 3].map((i) => defaultTeam(i, 'team', 2, cross))).toEqual([0, 1, 0, 1]); // identity-authored map: round-robin
    const d = setType(setPlayers(newDraft([crossT])!, 4, crossT), 'team', crossT);
    expect(d.rows.map((r) => r.team)).toEqual([0, 0, 1, 1]);
  });
  it('Team default with fewer players than the map uses authored teams only if the used slice has `teams` distinct ids', () => {
    const crossT: PvpMapInfo = { ...cross, teams: [0, 0, 1, 1] };
    const mk = (players: number) => setType(setPlayers(newDraft([crossT])!, players, crossT), 'team', crossT);
    expect(mk(2).rows.map((r) => r.team)).toEqual([0, 1]);
    expect(canCreate(mk(2))).toBe(true);
    expect(mk(4).rows.map((r) => r.team)).toEqual([0, 0, 1, 1]);
  });
  it('seatsToDraft preserves non-dense team ids', () => {
    const d = seatsToDraft({ levelId: 'cross', seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 2 }, { kind: 'human', team: 2 }] }, cross);
    expect(d.type).toBe('team');
    expect(d.rows.map((r) => r.team)).toEqual([0, 2, 2]);
    expect(draftToSeats(d, cross).map((s) => s.team)).toEqual([0, 2, 2]);
  });
  it('team assignment: round-robin vs identity; host stays human', () => {
    expect([0, 1, 2, 3].map((i) => defaultTeam(i, 'team', 2))).toEqual([0, 1, 0, 1]);
    expect([0, 1, 2].map((i) => defaultTeam(i, 'pvp', 2))).toEqual([0, 1, 2]);
    let d = setPlayers(newDraft([cross])!, 4, cross);
    d = setType(d, 'team', cross); expect(d.rows.map((r) => r.team)).toEqual([0, 1, 0, 1]);
    d = setType(d, 'pvp', cross); expect(d.rows.map((r) => r.team)).toEqual([0, 1, 2, 3]);
    expect(setRow(d, 0, { kind: 'bot' }, cross).rows[0]!.kind).toBe('human');
  });
  it('bot labels renumber by order', () => {
    let d = setPlayers(newDraft([cross])!, 4, cross);
    d = setRow(setRow(d, 1, { kind: 'bot' }, cross), 3, { kind: 'bot' }, cross);
    expect(botLabels(d.rows)).toEqual([null, 'Bot1', null, 'Bot2']);
    d = setRow(d, 1, { kind: 'human' }, cross);
    expect(botLabels(d.rows)).toEqual([null, null, null, 'Bot1']);
  });
  it('draftToSeats + round trip', () => {
    let d = setPlayers(newDraft([cross])!, 3, cross);
    d = setRow(d, 2, { kind: 'bot', difficulty: 'hard' }, cross);
    const pvpSeats = draftToSeats(d, cross);
    expect(pvpSeats).toEqual([{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }, { kind: 'bot', difficulty: 'hard', team: 2 }]);
    expect(seatsToDraft({ levelId: 'cross', seats: pvpSeats }, cross)).toEqual(d);
    const t = setRow(setType(setPlayers(d, 4, cross), 'team', cross), 1, { team: 0 }, cross);
    const seats = draftToSeats(t, cross);
    expect(seats.map((s) => s.team)).toEqual([0, 0, 0, 1]);
    expect(seatsToDraft({ levelId: 'cross', seats }, cross)).toEqual(t);
    expect(seats.every((s) => (s.kind === 'bot') === (s.difficulty !== undefined))).toBe(true);
  });
  it('deriveType and canCreate', () => {
    expect(deriveType([{ team: 0 }, { team: 1 }])).toBe('pvp');
    expect(deriveType([{ team: 0 }, { team: 0 }, { team: 1 }])).toBe('team');
    const d = setType(newDraft([cross])!, 'team', cross);
    expect(canCreate(d)).toBe(true);
    expect(canCreate(setRow(d, 1, { team: 0 }, cross))).toBe(false);
    expect(canCreate(newDraft([duel])!)).toBe(true);
  });
});

describe('controller navigation + createRoom', () => {
  const versions: Versions = { rules: 'r', schema: 's', content: 'c', bot: 'b' };
  const welcome: ServerMessage = { t: 'welcome', pv: 1, playerId: 'p', serverVersions: versions };
  function setup(nick = 'Bob') {
    const sent: ClientMessage[] = [];
    const cbs = new Set<(m: ServerMessage) => void>();
    const c: PvpConnection = { state: 'connected', info: { attempt: 0, nextRetryAt: null, outageStartedAt: null, lastCloseCode: null }, send(m) { sent.push(m); return true; }, onMessage(cb) { cbs.add(cb); return () => cbs.delete(cb); }, onState() { return () => {}; }, retry() {}, close() {} };
    const identity = createIdentity({ local: null, session: null }); identity.setNick(nick);
    const ctl = createPvpController({ identity, serverUrl: 'ws://x', versions, createSocket: () => { throw new Error('no'); }, createConnection: () => c, maps: () => [duel, cross] });
    return { ctl, sent, push: (m: ServerMessage) => cbs.forEach((f) => f(m)) };
  }
  it('home -> create/join -> back one level; home back closes', () => {
    const h = setup(); h.ctl.open();
    expect(h.ctl.snapshot()).toMatchObject({ menuView: 'home', createDraft: null });
    h.ctl.goCreate(); expect(h.ctl.snapshot().menuView).toBe('create'); expect(h.ctl.snapshot().createDraft).toMatchObject({ mapId: 'duel', players: 2 });
    h.ctl.back(); expect(h.ctl.snapshot().menuView).toBe('home');
    h.ctl.goJoin(); expect(h.ctl.snapshot().menuView).toBe('join-role');
    h.ctl.chooseRole('watch'); expect(h.ctl.snapshot()).toMatchObject({ menuView: 'join-form', joinRole: 'watch' });
    h.ctl.back(); expect(h.ctl.snapshot().menuView).toBe('join-role');
    h.ctl.back(); h.ctl.back(); expect(h.ctl.snapshot().screen).toBe('idle');
  });
  it('draft survives Back/forth and edits clamp', () => {
    const h = setup(); h.ctl.open(); h.ctl.goCreate();
    h.ctl.draftMap('cross'); h.ctl.draftPlayers(4); h.ctl.draftType('team'); h.ctl.draftRow(2, { kind: 'bot' });
    h.ctl.back(); h.ctl.goCreate();
    expect(h.ctl.snapshot().createDraft).toMatchObject({ mapId: 'cross', players: 4, type: 'team' });
    h.ctl.draftMap('duel'); expect(h.ctl.snapshot().createDraft!.players).toBe(2);
  });
  it('createRoom sends room.create{levelId, seats}', () => {
    const h = setup(); h.ctl.open(); h.ctl.goCreate();
    h.ctl.draftMap('cross'); h.ctl.draftPlayers(3); h.ctl.draftRow(2, { kind: 'bot', difficulty: 'easy' });
    h.ctl.createRoom(); expect(h.ctl.snapshot().screen).toBe('connecting');
    h.push(welcome);
    expect(h.sent).toEqual([{ t: 'room.create', levelId: 'cross', seats: [{ kind: 'human', team: 0 }, { kind: 'human', team: 1 }, { kind: 'bot', difficulty: 'easy', team: 2 }] }]);
  });
  it('createRoom is a no-op without draft or with <2 teams', () => {
    const h = setup(); h.ctl.open(); h.ctl.createRoom(); expect(h.ctl.snapshot().screen).toBe('menu');
    h.ctl.goCreate(); h.ctl.draftMap('cross'); h.ctl.draftType('team'); h.ctl.draftRow(1, { team: 0 });
    h.ctl.createRoom(); expect(h.ctl.snapshot().screen).toBe('menu');
  });
  it('deep link opens join-form with code + role; stored nick auto-joins', () => {
    const h = setup(); h.ctl.openLink({ code: 'ABCD', role: 'watch' });
    expect(h.ctl.snapshot()).toMatchObject({ menuView: 'join-form', joinRole: 'watch', screen: 'connecting' });
    h.push(welcome); expect(h.sent).toEqual([{ t: 'room.join', code: 'ABCD', role: 'watch' }]);
    const g = setup(''); g.ctl.openLink({ code: 'ABCD', role: 'play' });
    expect(g.ctl.snapshot()).toMatchObject({ menuView: 'join-form', screen: 'menu', code: 'ABCD' });
  });
});
