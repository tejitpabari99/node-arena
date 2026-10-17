import { createBotDriver, createProfileBot, guardBotContext, runMatch } from '../../dist/index.js';
import { create, playReplay } from '../../../sim/dist/index.js';
export const metadata = { rulesVersion: '1.0.0', schemaVersion: '1.0.0', contentVersion: '1.0.0' };
const proxy = { id: 'test-proxy', kind: 'utility', params: { skill: { decisionIntervalSec: 500, noise: 100, actionsPerDecision: 2 } } };
function requireInvariant(condition, message) { if (!condition) throw new Error(message); }

export function runCorpus(levels) {
  return levels.map((level, index) => {
    const seed = 13 + index;
    const player = level.players.find(p => p.kind === 'human').id;
    // Compare the harness with a separately driven full run. Check every tick,
    // including slot losses/captures, rather than just final tower rows.
    const sim = create(level, seed), driver = createBotDriver(level, seed);
    const human = createProfileBot(level, seed, player, proxy);
    const commands = [];
    while (!sim.view.over && sim.tick < sim.view.timeLimitTicks) {
      const selected = [...human.decide(guardBotContext(sim), sim.tick), ...driver.commands(sim)]
        .sort((a, b) => level.players.findIndex(p => p.id === a.player) - level.players.findIndex(p => p.id === b.player));
      commands.push(...selected.map(cmd => ({ tick: sim.tick, cmd })));
      sim.step(selected, { events: false });
      requireInvariant(sim.rejected === 0, `${level.id}: rejected at ${sim.tick}`);
      for (let t = 0; t < level.towers.length; t++) requireInvariant(sim.view.tower.lines[t] <= sim.view.tower.slots[t], `${level.id}: overslot at ${sim.tick}/${t}`);
    }
    requireInvariant(sim.view.over !== null, `${level.id}: did not terminate`);
    const result = runMatch({ level, seed, controllers: [createProfileBot(level, seed, player, proxy)], record: metadata });
    requireInvariant(JSON.stringify(result.replay.commands) === JSON.stringify(commands), `${level.id}: harness log diverged`);
    requireInvariant(result.stats.finalHash === sim.hash(), `${level.id}: harness hash diverged`);
    requireInvariant(result.outcome.outcome !== 'truncated', `${level.id}: truncated`);
    // Playback must never inspect a bot profile. Throw even on enumerating params.
    const noBots = { ...level, bots: level.bots.map(bot => ({ ...bot, profile: new Proxy(bot.profile, { get() { throw new Error('Replay accessed a bot profile'); } }) })) };
    const playback = playReplay({ level: noBots, metadata }, result.replay);
    requireInvariant(playback.ok && playback.sim.hash() === result.stats.finalHash, `${level.id}: replay diverged`);
    return { id: level.id, seed, commands, hash: sim.hash(), ticks: sim.tick, outcome: result.outcome };
  });
}
