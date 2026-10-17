// Node-only timer. Setup uses ordinary public sim commands, bots see only guarded capabilities.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { create } from '../../sim/dist/index.js';
import { BOT_VERSION, createUtilityBot, guardBotContext } from '../dist/index.js';
import { loadContent, resolveProfiles } from '../../content/dist/index.js';
import { authoredFiles } from '../test/fixtures/corpus.mjs';

export function assertBudget(p99, ci = false) {
  const limit = ci ? 5 : 1;
  assert.ok(Number.isFinite(p99) && p99 >= 0 && p99 < limit, `Bot decision p99 budget exceeded: ${p99} ms; requires < ${limit} ms`);
}
export async function createWorkload() {
  const profile = Object.values(resolveProfiles(loadContent(await authoredFiles()))).find(row => row.id === 'rusher-expert');
  const level = {
    id: 'bot-performance', componentNames: ['capturable', 'drawsLines', 'garrison', 'generates'],
    timeLimitSec: 3600, visual: '', bots: [],
    players: [{ id: 'p0', team: 'red', kind: 'human', colorKey: '' }, { id: 'p1', team: 'blue', kind: 'bot', colorKey: '' }],
    kinds: [{ id: 'regular', value: 1, speedMilli: 1000, visual: '' }],
    towers: Array.from({ length: 50 }, (_, i) => ({ id: `t${String(i).padStart(2, '0')}`, x: (i % 10) * 100000 - 450000, y: Math.floor(i / 10) * 100000 - 200000,
      owner: i % 2, garrison: 50, archetype: '', visual: '', footprintRadius: 0,
      components: { garrison: { cap: 50 }, generates: { troop: 0, ratePerSec: 20000 }, drawsLines: { extraSlotAbove: [10, 30] }, capturable: {} },
    })),
  };
  const sim = create(level, 704);
  const commands = level.towers.map((tower, i) => ({ type: 'DrawLine', player: `p${i % 2}`, from: tower.id, to: level.towers[(i + 10) % 50].id }));
  // Forty live ticks generate 50 troops each. Paths are at least 100 seconds long.
  for (let tick = 0; tick < 40; tick++) sim.step(tick === 0 ? commands : [], { events: false });
  assert.equal(sim.rejected, 0); assert.equal(sim.view.over, null);
  const ctx = guardBotContext(sim);
  const out = Object.fromEntries(['channel', 'seq', 'owner', 'kind', 'progress'].map(key => [key, new Int32Array(2000)]));
  const troops = ctx.readTroops(out); assert.equal(troops, 2000);
  assert.equal(sim.view.lines.length, 50);
  const bot = createUtilityBot({ player: 'p1', profile, seed: 704, towerCount: 50 });
  return { ctx, bot, troops, sim, profile: profile.id };
}
export async function measure({ warmup = 1000, samples = 5000 } = {}) {
  assert.ok(Number.isInteger(warmup) && warmup > 0 && Number.isInteger(samples) && samples > 0);
  const { ctx, bot, troops, sim, profile } = await createWorkload();
  // A stable active snapshot isolates decisions from sim time. Every invocation calls
  // the complete utility decision, including troop reads/preparation/enumeration/selection.
  // No driver interval/phase shortcut is timed. Bot RNG and pair history remain live.
  for (let i = 0; i < warmup; i++) bot.decide(ctx, ctx.view.tick);
  const times = []; let commandCount = 0;
  for (let i = 0; i < samples; i++) {
    const start = performance.now(); const commands = bot.decide(ctx, ctx.view.tick);
    times.push(performance.now() - start); commandCount += commands.length;
    for (const cmd of commands) if (cmd.type === 'DrawLine') assert.equal(ctx.canDraw(cmd.player, cmd.from, cmd.to), null);
  }
  times.sort((a,b) => a - b);
  assert.ok(commandCount > 0, 'Benchmark must evaluate and select actions');
  assert.equal(ctx.view.over, null); assert.equal(sim.rejected, 0);
  return { botVersion: BOT_VERSION, profile, seed: 704, towers: 50, troops, lines: ctx.view.lines.length, ownTowers: 25,
    warmup, samples, commandCount, mean: times.reduce((a,b) => a + b, 0) / samples, p99: times[Math.ceil(samples * 0.99) - 1] };
}
async function main() {
  const args = process.argv.slice(2); assert.ok(args.every(arg => arg === '--ci'), 'Unknown benchmark argument');
  const ci = args.includes('--ci') || /^(1|true)$/i.test(process.env.CI ?? '');
  const result = await measure();
  console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model }, mode: ci ? 'ci' : 'strict', budgetMs: ci ? 5 : 1, result }, null, 2));
  assertBudget(result.p99, ci);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
