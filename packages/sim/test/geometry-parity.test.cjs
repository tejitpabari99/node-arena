const assert = require('node:assert/strict');
const { test } = require('node:test');
require('tsx/cjs');
const api = require('../src/internal.ts');
const { geometryScenarios } = require('./golden/scenarios-geometry.ts');
const { metadata } = require('./fixtures.cjs');
const { EVENTS } = require('../../defs/src/events.ts');
const ajv = require('../../content/src/index.ts').createAjv();
const validators = Object.fromEntries(['Clash','TroopDied','TowerShot'].map(type => [type, ajv.compile(EVENTS[type].payload)]));

for (const scenario of geometryScenarios) test(`geometry golden behavior and per-tick event/replay parity: ${scenario.name}`, () => {
  assert.equal(require('../../content/src/index.ts').computeSimHash(scenario.level), scenario.level.simHash, 'compiled geometry fixture identity');
  const rec = api.createReplayRecorder(scenario.level, scenario.seed, metadata), silent = api.create(scenario.level, scenario.seed);
  const events = [];
  let rebuilt;
  for (let t = 0; t < scenario.ticks; t++) {
    const commands = scenario.commands.filter(c => c.tick === t).map(c => c.cmd);
    const emitted = rec.step(commands, { events: true }); events.push(...emitted);
    silent.step(commands, { events: false });
    assert.equal(rec.hash(), silent.hash(), `event parity tick ${t+1}`);
    if (rebuilt) { rebuilt.step(commands, {events:false}); assert.equal(rebuilt.hash(), rec.hash(), `continued replay tick ${t+1}`); }
    for (const event of emitted) if (validators[event.type]) {
      const {type, ...payload} = event;
      assert.equal(validators[type](payload), true, JSON.stringify(validators[type].errors));
      if (type === 'TowerShot' && payload.target.kind === 'house') {
        const b = scenario.level.buildings[payload.target.building];
        assert.deepEqual([payload.x,payload.z], [b.x,b.z]);
      }
      if (type === 'TowerShot' && payload.target.kind === 'troop') {
        const death = emitted.find(e => e.type === 'TroopDied' && e.seq === payload.target.seq && e.channel === payload.target.channel);
        assert.ok(death); assert.equal(death.cause,'tower');
        assert.deepEqual([payload.x,payload.z], [death.x,death.z]);
      }
    }
    if (t === 59 || t === scenario.ticks-1) {
      const replay = api.playReplay({metadata,level:scenario.level}, rec.record());
      assert.equal(replay.ok, true); assert.equal(replay.sim.hash(), rec.hash());
      if (t === 59) rebuilt = replay.sim;
    }
  }
  if (scenario.name === 'geometry-neutral-troop') assert.ok(events.some(e => e.type==='TowerShot' && e.target.kind==='troop'));
  if (scenario.name === 'geometry-neutral-house') {
    assert.ok(events.some(e => e.type==='TowerShot' && e.target.kind==='house'));
    assert.equal(rec.view.buildings.owner[1],-1); assert.equal(rec.view.buildings.level[1],0);
  }
  if (scenario.name === 'geometry-crossing-cut') {
    assert.ok(events.some(e => e.type==='Clash' && e.kind==='crossing'));
    assert.ok(events.some(e => e.type==='TowerShot'));
    assert.equal(events.filter(e => e.type==='LineCut').length,1);
  }
  if (scenario.name === 'geometry-obstacle-building') {
    const reasons=events.filter(e=>e.type==='CommandRejected').map(e=>e.reason);
    assert.ok(reasons.includes('blocked-obstacle')); assert.ok(reasons.includes('blocked-building'));
    assert.ok(events.some(e=>e.type==='LineDrawn'));
  }
});
