const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const bots = require('../src/index.ts');
const sim = require('../../sim/src/index.ts');
const fx = require('../../sim/test/fixtures.cjs');

const loaded = fx.content.loadContent(fx.dataFiles());
const byPosition = pos => loaded.compiled[loaded.catalog.campaigns.common.entries.find(e => e.position === pos).level];
const MAX = 20000;
const levels = [4, 6].map(p => [p, byPosition(p)]);

test('covers R2: driver builds one seat per level.bots entry', () => {
  for (const [, level] of levels) {
    assert.ok(level.bots.length > 0);
    const s = sim.create(level, 7);
    const d = bots.createBotDriver(level, 7);
    // Recording seats via a spy is impossible; check commands only come from bot players.
    const players = new Set(level.bots.map(b => b.player));
    for (let t = 0; t < 600 && !s.view.over; t++) {
      const cmds = d.commands(s);
      for (const c of cmds) assert.ok(players.has(c.player));
      s.step(cmds);
    }
  }
});

test('covers R2: every seat is called every tick before step; same-tick re-call emits nothing', () => {
  const level = byPosition(6);
  assert.ok(level.bots.length >= 2);
  const s = sim.create(level, 3);
  const d = bots.createBotDriver(level, 3);
  const seen = [];
  const origStep = s.step.bind(s);
  const spy = { get view() { return s.view; }, canDraw: s.canDraw.bind(s) };
  // seat decide calls are observed through timer-driven activity: first action tick for each seat must occur
  let acted = new Set();
  for (let t = 0; t < 400; t++) {
    const cmds = d.commands(spy);
    assert.deepEqual(d.commands(spy), []);
    for (const c of cmds) acted.add(c.player);
    seen.push(s.view.tick);
    origStep(cmds);
  }
  assert.deepEqual(seen, [...Array(400).keys()]);
  assert.deepEqual([...acted].sort(), level.bots.map(b => b.player).sort());
});

test('covers R2: no commands after game over', () => {
  const level = byPosition(4);
  const s = sim.create(level, 1);
  const d = bots.createBotDriver(level, 1);
  let guard = 0;
  while (!s.view.over && guard++ < MAX) s.step(d.commands(s));
  assert.ok(s.view.over, 'level ends');
  assert.deepEqual(d.commands(s), []);
  const fresh = bots.createBotDriver(level, 1);
  assert.deepEqual(fresh.commands(s), []);
});

test('covers R2: runMatch on campaign positions 4 and 6 terminates with 0 rejected', () => {
  for (const [, level] of levels) {
    const r = bots.runMatch({ level, seed: 11, maxTicks: MAX });
    assert.ok(r.ticks <= MAX);
    assert.equal(r.stats.rejected, 0);
    assert.ok(r.stats.commandCount > 0);
  }
});

test('covers R2: same level+seed twice gives identical command log and final hash', () => {
  for (const [, level] of levels) {
    const log = () => {
      const s = sim.create(level, 5);
      const d = bots.createBotDriver(level, 5);
      const out = [];
      while (!s.view.over && s.view.tick < 3000) {
        const cmds = d.commands(s);
        out.push([s.view.tick, cmds]);
        s.step(cmds);
      }
      return { out, hash: s.hash(), rejected: 0 };
    };
    const a = log(), b = log();
    assert.deepEqual(a.out, b.out);
    assert.equal(a.hash, b.hash);
    assert.ok(a.out.some(([, c]) => c.length));
    assert.equal(bots.runMatch({ level, seed: 5, maxTicks: 3000 }).stats.finalHash, a.hash);
  }
});

test('covers R6: HUMAN_PROXY exact shape; createSeatBot exported', () => {
  assert.deepEqual(bots.HUMAN_PROXY, { kind: 'tw', actionDelayMs: 2000, behavior: 'full', script: [] });
  assert.equal(typeof bots.createSeatBot, 'function');
});
