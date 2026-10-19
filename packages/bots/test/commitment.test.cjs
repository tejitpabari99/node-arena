// SP02 line commitment (PRD R1-R6, R8, R12, R13). Each test pairs the enforced behaviour with a
// control where only the rule's param is set to its neutral value, so disabling the rule fails it.
// Params are loaded milli-units (sec * 1000, scores/danger 0..1000, troops * 1000); TICK_RATE = 20.
const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
let api;
before(async () => { api = await import('../dist/index.js'); });

const COMMIT = Object.freeze({ minLineLifetimeSec: 8000, dangerOverride: 700, cutMargin: 150, redrawBlockSec: 10000,
  tieHysteresis: 50, slotGuardMargin: 3000, slotPreemptMargin: 1000 });
const LIFE = 160, BLOCK = 200; // ticks for the 8 s / 10 s defaults
const NEUTRAL = Object.freeze({ minLineLifetimeSec: 0, dangerOverride: 1000, cutMargin: 0, redrawBlockSec: 0,
  tieHysteresis: 0, slotGuardMargin: 0, slotPreemptMargin: 0 });

function fixture(owners) {
  const n = owners.length;
  const column = values => Int32Array.from(values);
  const view = {
    tick: 0, over: null, timeLimitTicks: 20000,
    ids: { towers: Array.from({ length: n }, (_, i) => `t${i}`), players: ['p0', 'p1', 'p2'] },
    players: ['red', 'blue', 'red'].map(team => ({ team, kind: 'bot', colorKey: team, alive: 1, transit: 0, stats: { generated: 0, overflowLost: 0, kills: 0, captures: 0 } })),
    tower: { owner: column(owners), team: column(owners.map(i => i === -1 ? -1 : i === 1 ? 1 : 0)), slots: column(Array(n).fill(1)), lines: column(Array(n).fill(0)), col: {
      'garrison.count': column(Array(n).fill(20)), 'garrison.cap': column(Array(n).fill(50)),
      'generates.ratePerSec': column(Array(n).fill(10000)), 'generates.troop': column(Array(n).fill(0)),
    } },
    towerStatic: Array.from({ length: n }, (_, i) => ({ x: i * 10000, y: 0, archetype: 'tower', visual: 'tower', footprintRadius: 1000, components: ['garrison', 'generates', 'drawsLines', 'capturable'] })),
    lines: [], kinds: [{ value: 1, speedPerTick: 1000, visual: 'troop' }],
  };
  const ctx = api.guardBotContext({ view, canDraw(player, from, to) {
    const s = view.ids.towers.indexOf(from), t = view.ids.towers.indexOf(to);
    if (player !== 'p0' || view.tower.owner[s] !== 0) return 'not-owner';
    if (s === t) return 'self';
    if (view.tower.lines[s] >= view.tower.slots[s]) return 'no-slot';
    if (view.lines.some(l => l.from === s && l.to === t)) return 'duplicate';
    return null;
  }, readTroops() { return 0; } });
  // Line helpers keep tower.lines consistent with view.lines.
  const draw = (from, to, owner = 0, drawSeq = 1) => {
    view.lines.push({ channel: from * n + to, from, to, owner, length: 10000, drawSeq });
    view.tower.lines[from]++;
  };
  const remove = (from, to) => {
    const i = view.lines.findIndex(l => l.from === from && l.to === to);
    assert.ok(i >= 0, `no line ${from}->${to}`);
    view.lines.splice(i, 1);
    view.tower.lines[from]--;
  };
  return { view, ctx, draw, remove };
}
function bot(n, params, { commitment = COMMIT, seed = 1, slotThresholds } = {}) {
  return api.createUtilityBot({ player: 'p0', profile: { id: 'commit-test', kind: 'utility',
    params: commitment ? { ...params, commitment } : params }, seed, towerCount: n, slotThresholds });
}
const pairs = commands => commands.map(c => `${c.type === 'CutLine' ? 'cut' : 'draw'} ${c.from}->${c.to}`);
const skill = (actionsPerDecision = 1, noise = 0) => ({ actionsPerDecision, noise, decisionIntervalSec: 1000 });
/** Cut = 1000 (own-target lines are useless), no draws: isolates the cut rules. */
const CUT_ONLY = { weights: { attack: {}, reinforce: {}, cut: { lineUseless: 1000 } }, skill: skill() };
/** Cut = 1000, reinforce = 500 on every own target (targetValue is uniform 1000 in the fixture). */
const CUT_AND_REINFORCE = { weights: { attack: {}, reinforce: { targetValue: 1000 }, cut: { lineUseless: 1000 } },
  bias: { cut: 1000, reinforce: 500 }, skill: skill() };
/** Hostile p1 line 2->0 with an undefended source 0: danger(0) = 1000. */
function endanger(f, source = 0, attacker = 2) {
  f.draw(attacker, source, 1, 99);
  f.view.tower.col['garrison.count'][source] = 0;
  f.view.tower.col['generates.ratePerSec'][source] = 0;
}

test('R1 lifetime lock: an own line younger than minLineLifetimeSec is not cut', () => {
  const run = commitment => {
    const f = fixture([0, 0, 1]);
    f.draw(0, 1);
    const b = bot(3, CUT_ONLY, { commitment });
    return [0, LIFE - 1, LIFE].map(tick => pairs(b.decide(f.ctx, tick)));
  };
  assert.deepEqual(run(COMMIT), [[], [], ['cut t0->t1']], 'first seen at tick 0, cuttable from tick 160');
  assert.deepEqual(run({ ...COMMIT, minLineLifetimeSec: 0 }), [['cut t0->t1'], ['cut t0->t1'], ['cut t0->t1']], 'neutral lifetime: cut at every decision');
});

test('R1b danger override lifts the lifetime lock for the endangered source only', () => {
  const run = commitment => {
    const f = fixture([0, 0, 1, 0]);
    f.draw(0, 1); f.draw(3, 1);
    endanger(f);
    const b = bot(4, { ...CUT_ONLY, skill: skill(2) }, { commitment });
    const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 4, params: {}, seed: 1 });
    scorer.prepare(f.ctx, 0);
    assert.equal(scorer.danger(0), 1000);
    assert.equal(scorer.danger(3), 0);
    return pairs(b.decide(f.ctx, 0));
  };
  assert.deepEqual(run(COMMIT), ['cut t0->t1'], 'young line from the safe source t3 stays locked');
  assert.deepEqual(run({ ...COMMIT, dangerOverride: 1001 }), [], 'override above any danger: lock holds for both');
  assert.deepEqual(run({ ...COMMIT, minLineLifetimeSec: 0 }), ['cut t0->t1', 'cut t3->t1']);
});

test('R2 cut margin: a cut needs noise-free cutScore - keepScore >= cutMargin', () => {
  const run = (keepBias, commitment) => {
    const f = fixture([0, 0, 1]);
    f.draw(0, 1);
    f.view.tower.slots[1] = 0; // no competing reinforcement from t1
    const params = { weights: { attack: {}, reinforce: { targetValue: 1000 }, cut: { lineUseless: 1000 } }, bias: { cut: 1000, reinforce: keepBias }, skill: skill() };
    const scorer = api.createUtilityScorer({ player: 'p0', towerCount: 3, params, seed: 1 });
    scorer.prepare(f.ctx, 0);
    assert.equal(scorer.keepScore(0, 1), keepBias, 'keepScore = best noise-free attack/reinforce on the pair');
    assert.equal(scorer.scoreRaw('cut', 0, 1), 1000);
    return pairs(bot(3, params, { commitment: { ...commitment, minLineLifetimeSec: 0 } }).decide(f.ctx, 0));
  };
  assert.deepEqual(run(851, COMMIT), [], 'margin 149 < 150');
  assert.deepEqual(run(850, COMMIT), ['cut t0->t1'], 'margin exactly 150');
  assert.deepEqual(run(851, { ...COMMIT, cutMargin: 0 }), ['cut t0->t1'], 'neutral margin');
  assert.deepEqual(run(1000, { ...COMMIT, cutMargin: 0 }), ['cut t0->t1'], 'margin 0 allows cut == keep');
});

test('R3 redraw block after an own cut: both directions, under source danger, without stickiness weight', () => {
  const run = commitment => {
    const f = fixture([0, 0, 1]);
    f.draw(0, 1);
    endanger(f);
    const b = bot(3, { ...CUT_AND_REINFORCE, cooldownSec: 0 }, { commitment: { ...commitment, minLineLifetimeSec: 0 } });
    const out = [pairs(b.decide(f.ctx, 0))];
    f.remove(0, 1);
    for (const tick of [1, BLOCK - 1, BLOCK]) out.push(pairs(b.decide(f.ctx, tick)));
    return out;
  };
  assert.deepEqual(run(COMMIT), [['cut t0->t1'], [], [], ['draw t0->t1']]);
  assert.deepEqual(run({ ...COMMIT, redrawBlockSec: 0 }), [['cut t0->t1'], ['draw t0->t1'], ['draw t0->t1'], ['draw t0->t1']], 'neutral block: immediate redraw');
});

test('R3 bot-local slot-cut detection stamps the redraw block; a source capture does not', () => {
  const run = (commitment, captured) => {
    const f = fixture([0, 0, 1]);
    f.draw(0, 1);
    f.view.tower.slots[1] = 0;
    const b = bot(3, { ...CUT_AND_REINFORCE, weights: { ...CUT_AND_REINFORCE.weights, cut: {} } }, { commitment });
    const out = [pairs(b.decide(f.ctx, 0))];
    f.remove(0, 1); // the sim removed it: no own CutLine was issued
    if (captured) f.view.tower.owner[0] = 1;
    out.push(pairs(b.decide(f.ctx, 10)));
    f.view.tower.owner[0] = 0;
    for (const tick of [11, 10 + BLOCK - 1, 10 + BLOCK]) out.push(pairs(b.decide(f.ctx, tick)));
    return out;
  };
  assert.deepEqual(run(COMMIT, false), [[], [], [], [], ['draw t0->t1']], 'slot-cut detected at tick 10 blocks until 210');
  const d = ['draw t0->t1'];
  assert.deepEqual(run({ ...COMMIT, redrawBlockSec: 0 }, false), [[], d, d, d, d], 'neutral block');
  assert.deepEqual(run(COMMIT, true), [[], [], d, d, d], 'captured source: no block after recapture');
});

test('R3 own reverse replacement stamps the block and obeys the replaced line lifetime lock', () => {
  const f = fixture([0, 0, 1]);
  f.draw(1, 0);
  f.view.tower.slots[0] = 1;
  const params = { weights: { attack: {}, reinforce: { targetValue: 1000 }, cut: {} }, skill: skill() };
  const b = bot(3, params);
  assert.deepEqual(pairs(b.decide(f.ctx, 0)), [], 'reverse t0->t1 would replace a young own line');
  assert.deepEqual(pairs(b.decide(f.ctx, LIFE)), ['draw t0->t1']);
  const neutral = bot(3, params, { commitment: { ...COMMIT, minLineLifetimeSec: 0 } });
  assert.deepEqual(pairs(neutral.decide(f.ctx, 0)), ['draw t0->t1']);
  // Flip-back: after the replacement (sim swaps t1->t0 for t0->t1) t1 wants t0 again. The new
  // line's own lock ends at 2*LIFE; the replacement stamp blocks the pair until LIFE + BLOCK.
  const flipBack = commitment => {
    const g = fixture([0, 0, 1]);
    g.draw(1, 0);
    const c = bot(3, params, { commitment });
    const out = [pairs(c.decide(g.ctx, 0)), pairs(c.decide(g.ctx, LIFE))];
    g.remove(1, 0); g.draw(0, 1, 0, 2);
    for (const tick of [2 * LIFE, LIFE + BLOCK - 1, LIFE + BLOCK]) out.push(pairs(c.decide(g.ctx, tick)));
    return out;
  };
  assert.deepEqual(flipBack(COMMIT), [[], ['draw t0->t1'], [], [], ['draw t1->t0']], 'replacement blocks flip-back');
  // Neutral: flip-back as soon as the new line's lock ends (later ticks would need the sim applied).
  assert.deepEqual(flipBack({ ...COMMIT, redrawBlockSec: 0 }).slice(0, 3), [[], ['draw t0->t1'], ['draw t1->t0']], 'neutral block');
});

test('R12 slot guard: no draw into a slot gated by T while garrison - T < slotGuardMargin', () => {
  const run = (garrison, commitment, lines = 1) => {
    const f = fixture([0, 0, 1]);
    if (lines) f.draw(0, 2);
    f.view.tower.slots[0] = 2; f.view.tower.slots[1] = 0;
    f.view.tower.col['garrison.count'][0] = garrison;
    const params = { weights: { attack: {}, reinforce: { targetValue: 1000 }, cut: {} }, skill: skill() };
    return pairs(bot(3, params, { commitment, slotThresholds: [[10, 30], [10, 30], [10, 30]] }).decide(f.ctx, 0));
  };
  assert.deepEqual(run(12, COMMIT), [], '12 - 10 = 2 < 3');
  assert.deepEqual(run(13, COMMIT), ['draw t0->t1'], '13 - 10 = 3');
  assert.deepEqual(run(12, { ...COMMIT, slotGuardMargin: 0 }), ['draw t0->t1'], 'neutral guard');
  assert.deepEqual(run(0, COMMIT, 0), ['draw t0->t1'], 'base slot is never gated');
});

test('R13 pre-emptive deliberate cut drops the lowest-keepScore line, bypassing lifetime, and blocks its redraw', () => {
  const run = (garrison, commitment, lowValueTarget = 2) => {
    const f = fixture([0, 0, 0]);
    f.draw(0, 1); f.draw(0, 2);
    f.view.tower.slots[0] = 2; f.view.tower.slots[1] = 0; f.view.tower.slots[2] = 0;
    f.view.tower.col['garrison.count'][0] = garrison;
    f.view.tower.col['garrison.cap'][lowValueTarget] = 10; // lower targetValue -> lower keepScore
    const params = { weights: { attack: {}, reinforce: { targetValue: 1000 }, cut: {} }, skill: skill() };
    const b = bot(3, params, { commitment, slotThresholds: [[10, 30], [10, 30], [10, 30]] });
    const first = pairs(b.decide(f.ctx, 0));
    if (!first.length) return [first];
    const to = Number(first[0].slice(-1));
    f.remove(0, to);
    f.view.tower.col['garrison.count'][0] = 40;
    return [first, pairs(b.decide(f.ctx, 1)), pairs(b.decide(f.ctx, BLOCK))];
  };
  assert.deepEqual(run(11, COMMIT), [['cut t0->t2'], [], ['draw t0->t2']], 'young line cut at tick 0; redraw blocked until 200');
  assert.deepEqual(run(11, COMMIT, 1), [['cut t0->t1'], [], ['draw t0->t1']]);
  assert.deepEqual(run(12, COMMIT), [[]], '12 - 10 = 2 > 1');
  assert.deepEqual(run(11, { ...COMMIT, slotPreemptMargin: 0 }), [[]], 'neutral pre-empt');
});

test('R4 near-tie cut competes noise-free, while draw scores stay noisy', () => {
  // cut raw 1000, keep 700 (diff 300 >= margin 150); holdThreshold 999 rejects any score below raw.
  const cutRate = commitment => {
    let cuts = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const f = fixture([0, 0, 1]);
      f.draw(0, 1);
      f.view.tower.slots[1] = 0;
      const params = { weights: { attack: {}, reinforce: { targetValue: 1000 }, cut: { lineUseless: 1000 } },
        bias: { cut: 1000, reinforce: 700 }, holdThreshold: 999, skill: skill(1, 300) };
      cuts += bot(3, params, { commitment: { ...commitment, minLineLifetimeSec: 0 }, seed }).decide(f.ctx, 0).length;
    }
    return cuts;
  };
  assert.equal(cutRate({ ...COMMIT, tieHysteresis: 200 }), 60, 'noisy - keep < 350 => raw score (1000 > 999)');
  const neutral = cutRate({ ...COMMIT, tieHysteresis: 0 });
  assert.ok(neutral > 0 && neutral < 60, `without hysteresis some noisy cuts fall below the threshold: ${neutral}`);
  const firstTargets = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const f = fixture([0, -1, -1, -1]);
    const b = bot(4, { weights: { attack: { targetValue: 1000 }, reinforce: {}, cut: {} }, skill: skill(1, 500) }, { seed });
    firstTargets.add(b.decide(f.ctx, 0)[0].to);
  }
  assert.ok(firstTargets.size > 1, 'commitment draws keep their seeded noise');
});

test('R5 line age is per drawSeq and dropped when the line is gone or replaced', () => {
  const f = fixture([0, 0, 1]);
  f.draw(0, 1, 0, 1);
  const b = bot(3, CUT_ONLY);
  assert.deepEqual(pairs(b.decide(f.ctx, 0)), []);
  // Replaced by a new draw on the same channel between decisions: age restarts at first sight.
  f.remove(0, 1); f.draw(0, 1, 0, 2);
  assert.deepEqual(pairs(b.decide(f.ctx, 300)), [], 'new drawSeq at tick 300 is young');
  assert.deepEqual(pairs(b.decide(f.ctx, 300 + LIFE - 1)), []);
  assert.deepEqual(pairs(b.decide(f.ctx, 300 + LIFE)), ['cut t0->t1']);
  // Absent at a decision (captured source: no block), then back with the same drawSeq: new age.
  const g = fixture([0, 0, 1]);
  g.draw(0, 1, 0, 1);
  const c = bot(3, CUT_ONLY);
  assert.deepEqual(pairs(c.decide(g.ctx, 0)), []);
  g.remove(0, 1); g.view.tower.owner[0] = 1;
  assert.deepEqual(pairs(c.decide(g.ctx, 200)), []);
  g.view.tower.owner[0] = 0; g.draw(0, 1, 0, 1);
  assert.deepEqual(pairs(c.decide(g.ctx, 300)), [], 'entry was dropped while absent');
  assert.deepEqual(pairs(c.decide(g.ctx, 300 + LIFE)), ['cut t0->t1']);
});

test('R5 per-match reset: a tick regression clears ages and redraw blocks', () => {
  const sequence = (b, base) => {
    const f = fixture([0, 0, 1]);
    f.draw(0, 1);
    const out = [pairs(b.decide(f.ctx, base)), pairs(b.decide(f.ctx, base + LIFE))];
    f.remove(0, 1);
    out.push(pairs(b.decide(f.ctx, base + LIFE + 1)));
    return out;
  };
  const reused = bot(3, CUT_AND_REINFORCE);
  const first = sequence(reused, 1000);
  assert.deepEqual(first, [[], ['cut t0->t1'], []]);
  // New match on the same instance: without the reset the tick-1000 age/cut state would leak.
  const f = fixture([0, 0, 1]);
  assert.deepEqual(pairs(reused.decide(f.ctx, 5)), ['draw t0->t1'], 'redraw block from the previous match is gone');
  const again = bot(3, CUT_AND_REINFORCE);
  sequence(again, 1000);
  assert.deepEqual(sequence(again, 0), sequence(bot(3, CUT_AND_REINFORCE), 0), 'reused instance matches a fresh one');
});

test('R8 profiles without commitment reproduce the v1 churn baseline matches exactly (R6: no extra RNG)', async () => {
  const { runChurnMatch, HUMAN_SEAT_PROFILE } = await import('../scripts/churn.mjs');
  const { authoredFiles } = await import('./fixtures/corpus.mjs');
  const content = await import('../../content/dist/index.js');
  const baseline = JSON.parse(readFileSync(join(__dirname, '..', 'churn-baseline-v1.json'), 'utf8'));
  const loaded = content.loadContent(await authoredFiles());
  const strip = profile => {
    if (!profile.params.commitment) return profile;
    const { commitment: _drop, ...params } = profile.params;
    return { ...profile, params };
  };
  const human = Object.values(content.resolveProfiles(loaded)).find(profile => profile.id === HUMAN_SEAT_PROFILE);
  assert.ok(human.params.commitment, 'current human-proxy carries commitment');
  let stripped = 0, differs = 0;
  for (const expected of baseline.matches) {
    const level = content.compileLevel(loaded, expected.level);
    stripped += level.bots.filter(seat => seat.profile.params.commitment).length;
    const v1 = { ...level, bots: level.bots.map(seat => ({ ...seat, profile: strip(seat.profile) })) };
    const match = runChurnMatch(v1, expected.seed, strip(human));
    assert.deepEqual([match.ticks, match.finalHash], [expected.ticks, expected.finalHash], `${expected.level} seed ${expected.seed}`);
    if (expected.seed === 1 && runChurnMatch(level, 1, human).finalHash !== expected.finalHash) differs++;
  }
  assert.equal(baseline.matches.length, 160);
  assert.ok(stripped > 0, 'the comparison actually stripped commitment blocks');
  assert.ok(differs > 0, 'with commitment the same matches diverge (the check is sensitive)');
});
