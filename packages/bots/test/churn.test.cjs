const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const N = 4; // towers; channel key = from * N + to
const drawn = (tick, from, to, owner) => ({ type: 'LineDrawn', tick, channel: from * N + to, from, to, owner });
const cut = (tick, from, to, reason) => ({ type: 'LineCut', tick, channel: from * N + to, reason });

test('churn counter attributes cuts by reason and pairs redraws per unordered pair and seat', async () => {
  const { createChurnCounter, SEEDS } = await import('../scripts/churn.mjs');
  assert.deepEqual(SEEDS, [1, 2, 3, 5, 8, 13, 37, 704]);
  const counter = createChurnCounter({ towerCount: N, playerCount: 2 });
  counter.commands([{ type: 'DrawLine', player: 'b1' }, { type: 'CutLine', player: 'b1' }, { type: 'DrawLine', player: 'p1' }], ['p1', 'b1']);
  counter.events([
    drawn(1, 0, 1, 1),
    cut(5, 0, 1, 'player'),
    drawn(100, 1, 0, 1),        // reverse direction redraw, 95 ticks (< 10 s) -> cut-redraw(player) + flip
    cut(150, 1, 0, 'slots'),
    drawn(150 + 300, 0, 1, 1),  // 15 s later: flip only (<= 20 s), not cut-redraw
    cut(500, 0, 1, 'slots'),
    drawn(500 + 401, 0, 1, 1),  // 20.05 s later: neither
    drawn(1000, 2, 3, 0),
    cut(1001, 2, 3, 'replaced'),
    drawn(1001, 3, 2, 1),       // other seat drawing the pair is not a redraw by seat 0
    drawn(1010, 2, 3, 0),       // seat 0 redraws its replaced pair -> cut-redraw(replaced)
    cut(2000, 2, 3, 'captured'),
  ]);
  const [p1, b1] = counter.seats();
  assert.deepEqual(b1, {
    cuts: 1, draws: 1, lineCut: { player: 1, slots: 2, captured: 0, replaced: 0 },
    cutRedraw: { player: 1, slots: 0, captured: 0, replaced: 0, total: 1 }, flips: 2,
  });
  assert.deepEqual(p1, {
    cuts: 0, draws: 1, lineCut: { player: 0, slots: 0, captured: 1, replaced: 1 },
    cutRedraw: { player: 0, slots: 0, captured: 0, replaced: 1, total: 1 }, flips: 1,
  });
});

test('a single cut pairs with at most one redraw', async () => {
  const { createChurnCounter } = await import('../scripts/churn.mjs');
  const counter = createChurnCounter({ towerCount: N, playerCount: 1 });
  counter.events([drawn(1, 0, 1, 0), cut(2, 0, 1, 'player'), drawn(3, 0, 1, 0), drawn(4, 0, 2, 0), drawn(5, 1, 0, 0)]);
  assert.equal(counter.seats()[0].cutRedraw.total, 1);
  assert.equal(counter.seats()[0].flips, 1);
});

test('rates normalise by seat minutes', async () => {
  const { rates } = await import('../scripts/churn.mjs');
  const counts = { cuts: 3, draws: 6, lineCut: { player: 3, slots: 1, captured: 0, replaced: 0 }, cutRedraw: { player: 1, slots: 0, captured: 0, replaced: 0, total: 1 }, flips: 2 };
  const row = rates(counts, 1.5);
  assert.equal(row.cutsPerMin, 2); assert.equal(row.drawsPerMin, 4); assert.equal(row.slotCutsPerMin, 0.667);
  assert.equal(row.cutRedrawPerMin.total, 0.667); assert.equal(row.flipsPerMin, 1.333); assert.equal(row.seatMinutes, 1.5);
});

test('churn loop matches runMatch with the same controllers (events do not change the match)', async () => {
  const { runChurnMatch, HUMAN_SEAT_PROFILE } = await import('../scripts/churn.mjs');
  const { createProfileBot, runMatch } = await import('../dist/index.js');
  const { compileLevel, loadContent, resolveProfiles } = await import('../../content/dist/index.js');
  const { authoredFiles } = await import('./fixtures/corpus.mjs');
  const loaded = loadContent(await authoredFiles());
  const proxy = Object.values(resolveProfiles(loaded)).find(profile => profile.id === HUMAN_SEAT_PROFILE);
  const level = compileLevel(loaded, '10-two-foes');
  const churn = runChurnMatch(level, 3, proxy);
  const plain = runMatch({ level, seed: 3, controllers: [createProfileBot(level, 3, 'p1', proxy)], record: false });
  assert.equal(churn.finalHash, plain.stats.finalHash); assert.equal(churn.ticks, plain.ticks);
  const bots = churn.seats.filter(seat => seat.role === 'bot');
  assert.deepEqual(bots.map(seat => seat.profile), ['rusher-normal', 'economist-normal']);
  assert.ok(bots.some(seat => seat.counts.draws > 0));
});

test('bots:churn CLI is deterministic and prints both tables plus JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bots-churn-'));
  try {
    const run = out => spawnSync(process.execPath, [join(__dirname, '../scripts/churn.mjs'), '--seeds', '1', '--levels', '01-first-steps,10-two-foes', '--out', out], { encoding: 'utf8' });
    const a = run(join(dir, 'a.json')), b = run(join(dir, 'b.json'));
    assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr);
    assert.match(a.stdout, /Per bot profile/); assert.match(a.stdout, /Per level/);
    const json = readFileSync(join(dir, 'a.json'), 'utf8');
    assert.equal(json, readFileSync(join(dir, 'b.json'), 'utf8'));
    const report = JSON.parse(json);
    assert.deepEqual(report.seeds, [1]); assert.deepEqual(report.levels, ['01-first-steps', '10-two-foes']);
    assert.ok(report.totals.bots.seatMinutes > 0);
    assert.ok(report.byLevel['10-two-foes'] && report.byProfile['rusher-normal']);
    assert.ok(a.stdout.includes('"totals"'));
    const bad = spawnSync(process.execPath, [join(__dirname, '../scripts/churn.mjs'), '--seeds', '9'], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
