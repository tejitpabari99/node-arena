const assert = require('node:assert/strict');
const { test } = require('node:test');

test('bounded validated authored/random corpus completes legally and reproduces every recorded command', async () => {
  const { compiledCorpus } = await import('./fixtures/corpus.mjs');
  const { runCorpus } = await import('./fixtures/matches.mjs');
  const levels = await compiledCorpus();
  const first = runCorpus(levels);
  assert.ok(first.length >= 9);
  assert.ok(first.every(match => match.commands.length > 0));
  assert.deepEqual(runCorpus(levels), first);
});

test('utility bot captures an undefended neutral then cuts that actual surviving line', async () => {
  const { compiledCorpus } = await import('./fixtures/corpus.mjs');
  const { createUtilityBot, guardBotContext } = await import('../dist/index.js');
  const { create } = await import('../../sim/dist/index.js');
  const level = structuredClone((await compiledCorpus())[0]);
  const human = level.players.find(p => p.kind === 'human').id;
  const owned = level.towers.find(t => level.players[t.owner]?.id === human);
  const neutral = level.towers.find(t => t.owner === -1);
  neutral.garrison = 0;
  owned.components.generates.ratePerSec = 20000;
  level.kinds[0].speedMilli = 100000;
  const sim = create(level, 42);
  const bot = createUtilityBot({ player: human, seed: 42, towerCount: level.towers.length, profile: { id: 'capture-cut', kind: 'utility', params: {
    holdThreshold: 300, weights: { attack: { targetWeakness: 1000 }, reinforce: {}, cut: { lineUseless: 1000 } }, bias: { cut: 2000 },
  } } });
  const draw = { type: 'DrawLine', player: human, from: owned.id, to: neutral.id };
  assert.deepEqual(bot.decide(guardBotContext(sim), sim.tick), [draw]);
  sim.step([draw], { events: false });
  while (sim.view.tower.owner[level.towers.indexOf(neutral)] !== level.players.findIndex(p => p.id === human) && sim.tick < 100) sim.step([], { events: false });
  assert.ok(sim.tick < 100, 'neutral must actually be captured');
  assert.ok(sim.view.lines.some(l => l.from === level.towers.indexOf(owned) && l.to === level.towers.indexOf(neutral)));
  const cut = { ...draw, type: 'CutLine' };
  assert.deepEqual(bot.decide(guardBotContext(sim), sim.tick), [cut]);
  sim.step([cut], { events: false });
  assert.equal(sim.rejected, 0);
  assert.ok(!sim.view.lines.some(l => l.from === level.towers.indexOf(owned) && l.to === level.towers.indexOf(neutral)));
});

test('authored rusher makes its first attack before authored turtle on the same view history', async () => {
  const { compiledCorpus, authoredFiles } = await import('./fixtures/corpus.mjs');
  const { loadContent, resolveProfiles } = await import('../../content/dist/index.js');
  const { createProfileBot, guardBotContext } = await import('../dist/index.js');
  const { create } = await import('../../sim/dist/index.js');
  const level = (await compiledCorpus())[0];
  const profiles = resolveProfiles(loadContent(await authoredFiles()));
  const human = level.players.find(p => p.kind === 'human').id;
  const firstAttack = id => {
    const sim = create(level, 42);
    const bot = createProfileBot(level, 42, human, profiles[`data/bots/${id}.json`]);
    for (let tick = 0; tick < 100; tick++) {
      if (bot.decide(guardBotContext(sim), tick).some(cmd => cmd.type === 'DrawLine' && cmd.player === human)) return tick;
      sim.step([], { events: false });
    }
    assert.fail(`${id} must attack`);
  };
  assert.ok(firstAttack('rusher') < firstAttack('turtle'));
});

test('all authored tiers preserve personality through the bot compiler boundary', async () => {
  const { authoredFiles } = await import('./fixtures/corpus.mjs');
  const { compileLevel, loadContent } = await import('../../content/dist/index.js');
  const files = await authoredFiles();
  for (const personality of ['rusher', 'turtle', 'economist', 'opportunist']) {
    function params(id) {
      const map = structuredClone(files);
      const level = JSON.parse(map['data/levels/sample.json']);
      level.players.find(p => p.kind === 'bot').botProfile = id;
      map['data/levels/sample.json'] = level;
      return compileLevel(loadContent(map), 'sample').bots[0].profile.params;
    }
    const { skill: baseSkill, ...base } = params(personality);
    for (const tier of ['easy', 'normal', 'hard', 'expert']) {
      const { skill, ...inherited } = params(`${personality}-${tier}`);
      assert.deepEqual(inherited, base);
      assert.notDeepEqual(skill, baseSkill);
    }
  }
});
