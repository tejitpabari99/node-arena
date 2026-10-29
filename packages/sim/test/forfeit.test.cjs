const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/internal.ts');
const { step } = api;
const { compiledGolden, metadata } = require('./fixtures.cjs');

// levelview-1: b0 p0 (L20), b1 p1 (L10), b2/b3 neutral, b4 neutral tower. Third seat p2 owns b2.
const pvp = (teams) => {
  const l = structuredClone(compiledGolden());
  l.players.push({ id: 'p3', kind: 'ai', colorKey: 'green' });
  l.objective = 'pvp';
  l.buildings[2].owner = 2;
  return l;
};
const F = (player) => ({ type: 'Forfeit', player });
const draw = (player, from, to) => ({ type: 'DrawLine', player, from, to });
const mk = (setup, seed = 5) => { const s = api.createState(pvp(), seed, setup); s.events = []; return s; };
const run = (s, cmds = [], n = 1) => { let ev = []; for (let i = 0; i < n; i++) ev = ev.concat(step(s, i === 0 ? cmds : [], true)); return ev; };
const rejects = (ev) => ev.filter((e) => e.type === 'CommandRejected');

test('covers R-FFT-01: forfeit neutralizes buildings keeping level, cancels lines, kills troops, eliminates seat', () => {
  const s = mk();
  run(s, [draw(0, 0, 3), draw(1, 1, 3)], 1);
  run(s, [], 60);
  const live = () => api.liveChannels(s).filter((c) => c.from === 0);
  assert.ok(live().some((c) => c.troops.len > 0), 'seat 0 has troops in flight');
  const level0 = s.buildings.level[0], level1 = s.buildings.level[1];
  assert.equal(s.buildings.lines[0], 1);
  s.buildings.col['grows.timer'][0] = 12345;
  const tick = s.tick + 1;
  const ev = run(s, [F(0)]);
  assert.equal(s.buildings.owner[0], -1);
  assert.equal(s.buildings.level[0], level0);
  assert.equal(s.buildings.lines[0], 0);
  assert.equal(s.buildings.alive[0], 0);
  assert.equal(s.buildings.ignoreForWin[0], 0);
  assert.equal(live().reduce((n, c) => n + c.troops.len, 0), 0);
  assert.equal(s.buildings.col['grows.timer'][0] < 12345, true);
  assert.equal(s.players.eliminatedAt[0], tick);
  assert.deepEqual(ev.filter((e) => e.type === 'SeatEliminated'), [{ type: 'SeatEliminated', player: 0 }]);
  assert.ok(ev.some((e) => e.type === 'LineCut' && e.from === 0 && e.to === 3));
  assert.ok(ev.some((e) => e.type === 'TroopDied' && e.owner === 0 && e.cause === 'capture'));
  // Other seats untouched: lines from seat 1 survive, level of b1 unchanged except normal growth, match continues.
  assert.equal(s.buildings.owner[1], 1);
  assert.equal(s.buildings.lines[1], 1);
  assert.ok(s.buildings.level[1] >= level1);
  assert.equal(s.over, null);
  api.assertInvariants(s);
});

test('covers R-FFT-01: lines other seats drew toward the now-neutral buildings stay valid', () => {
  const s = mk();
  run(s, [draw(1, 1, 0)], 1);
  run(s, [F(0)]);
  assert.equal(s.buildings.lines[1], 1);
  assert.equal(api.getChannel(s, 1, 0).drawn, 1);
  assert.equal(api.canDraw(s, 1, 1, 3), null);
});

test('covers R-FFT-01: a forfeited tower becomes neutral at its level without resetting its cooldown upward', () => {
  const s = mk();
  s.buildings.owner[4] = 1;
  const cd = s.buildings.col['shoots.cooldown'];
  if (cd) cd[4] = 7;
  run(s, [F(1)]);
  assert.equal(s.buildings.owner[4], -1);
  if (cd) assert.ok(cd[4] >= 0 && cd[4] <= 7, 'cooldown not reset upward');
});

test('covers R-FFT-02: rejected forfeits (unknown-id, malformed, eliminated, not-pvp, gameover) change nothing', () => {
  const s = mk();
  let ev = run(s, [F(9), { type: 'Forfeit' }, { type: 'Forfeit', player: 0, extra: 1 }, { type: 'Forfeit', player: -1 }, { type: 'Forfeit', player: 1.5 }]);
  assert.equal(s.players.eliminatedAt.every((v) => v === -1), true);
  assert.deepEqual(rejects(ev).filter((e) => e.command === 'Forfeit').map((e) => [e.player, e.reason]), [[0, 'malformed'], [9, 'unknown-id']]);
  assert.equal(s.rejected, 5);
  run(s, [F(2)]);
  ev = run(s, [F(2)]);
  assert.equal(s.players.eliminatedAt[2] >= 0, true);
  assert.deepEqual(rejects(ev).filter((e) => e.command === 'Forfeit'), [{ type: 'CommandRejected', player: 2, command: 'Forfeit', reason: 'eliminated' }]);
  assert.equal(s.players.eliminatedAt[2], 2, 'keeps first eliminatedAt');
  // not-pvp: captureAll campaign level
  const c = api.createState(compiledGolden(), 1); c.events = [];
  const cev = run(c, [F(0)]);
  assert.deepEqual(rejects(cev), [{ type: 'CommandRejected', player: 0, command: 'Forfeit', reason: 'not-pvp' }]);
  assert.equal(c.buildings.owner[0], 0);
  // gameover
  const g = mk(); g.over = { outcome: 'draw', winner: null, winners: [], ranking: [] };
  const gev = run(g, [F(0)]);
  assert.deepEqual(rejects(gev), [{ type: 'CommandRejected', player: 0, command: 'Forfeit', reason: 'gameover' }]);
  assert.equal(g.buildings.owner[0], 0);
});

test('covers R-FFT-02: forfeits apply first by ascending player, before the draws of the same tick', () => {
  const s = mk();
  // seat 1 draws from b1; seat 0's forfeit is listed last but applies first. Seat 1 draw toward neutralized b0 stays legal.
  const ev = run(s, [draw(1, 1, 0), draw(0, 0, 3), F(2), F(0)]);
  const elim = ev.filter((e) => e.type === 'SeatEliminated').map((e) => e.player);
  assert.deepEqual(elim, [0, 2]);
  assert.equal(s.buildings.lines[0], 0, 'seat 0 own draw on its forfeit tick is rejected (not-owner)');
  assert.equal(s.buildings.lines[1], 1);
  assert.ok(rejects(ev).some((e) => e.player === 0 && e.command === 'DrawLine' && e.reason === 'not-owner'));
  const first = ev.findIndex((e) => e.type === 'SeatEliminated' && e.player === 0), lineDrawn = ev.findIndex((e) => e.type === 'LineDrawn');
  assert.ok(first < lineDrawn, 'elimination events precede draw events');
});

test('covers R-FFT-03: 1v1 forfeit gives victory to the other team in the same tick; eliminatedAt = forfeit tick', () => {
  const l = pvp(); l.players.pop(); l.buildings[2].owner = -1;
  const s = api.createState(l, 5); s.events = [];
  run(s, [], 3);
  const ev = run(s, [F(1)]);
  assert.equal(s.over.outcome, 'victory');
  assert.equal(s.over.winner, 0);
  assert.deepEqual(s.over.winners, [0]);
  assert.equal(s.players.eliminatedAt[1], s.tick);
  assert.ok(ev.some((e) => e.type === 'MatchOver'));
});

test('covers R-FFT-03: forfeit of a teammate leaves the team alive and play continues (2v2 shape)', () => {
  const l = pvp(); l.players.push({ id: 'p4', kind: 'ai', colorKey: 'yellow' });
  l.buildings[3].owner = 3;
  const s = api.createState(l, 5, { teams: [0, 0, 1, 1] }); s.events = [];
  run(s, [F(0)]);
  assert.equal(s.over, null);
  run(s, [], 5);
  assert.equal(s.over, null);
  run(s, [F(1)]);
  assert.equal(s.over.outcome, 'victory');
  assert.deepEqual(s.over.winners, [2, 3]);
  assert.equal(s.over.winner, 2);
});

test('covers R-FFT-03: simultaneous forfeits of every remaining team in one tick are a draw with no winner', () => {
  const l = pvp(); l.players.pop(); l.buildings[2].owner = -1;
  const s = api.createState(l, 5); s.events = [];
  const ev = run(s, [F(1), F(0)]);
  assert.equal(s.over.outcome, 'draw');
  assert.equal(s.over.winner, null);
  assert.deepEqual(s.over.winners, []);
  assert.deepEqual(ev.filter((e) => e.type === 'SeatEliminated').map((e) => e.player), [0, 1]);
  assert.deepEqual(Array.from(s.players.eliminatedAt), [s.tick, s.tick]);
});

test('covers R-FFT-03: a forfeit after the outcome is recorded changes nothing; hash gains no words (domain unchanged)', () => {
  const l = pvp(); l.players.pop(); l.buildings[2].owner = -1;
  const s = api.createState(l, 5); s.events = [];
  run(s, [F(1)]);
  const over = JSON.stringify(s.over), h = api.hashState(s);
  const ev = run(s, [F(0)]);
  assert.equal(JSON.stringify(s.over), over);
  assert.equal(api.hashState(s), h);
  assert.deepEqual(rejects(ev).map((e) => e.reason), ['gameover']);
});

test('covers R-FFT-01: forfeit log round-trips through recorder and playReplay with equal final hash', () => {
  const l = pvp();
  const rec = api.createReplayRecorder(l, 7, metadata, { teams: [0, 1, 2] });
  for (let i = 0; i < 40; i++) rec.step(i === 0 ? [draw(0, 0, 3), draw(1, 1, 3)] : []);
  rec.step([F(0)]);
  for (let i = 0; i < 30; i++) rec.step([]);
  rec.step([F(1)]);
  assert.equal(rec.view.over?.outcome, 'victory');
  const r = rec.record();
  assert.deepEqual(r.commands.filter((c) => c.cmd.type === 'Forfeit').map((c) => c.cmd.player), [0, 1]);
  const res = api.playReplay({ metadata, level: l }, JSON.parse(JSON.stringify(r)));
  assert.equal(res.ok, true);
  assert.equal(res.sim.hash(), rec.hash());
  assert.deepEqual(res.sim.view.over, rec.view.over);
});
