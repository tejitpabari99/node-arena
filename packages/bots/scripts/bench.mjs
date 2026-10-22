// Node-only timer: per-decision cost of the tw seat bots on the campaign level with the most buildings.
// Every seat (HUMAN_PROXY + authored AIs) is wrapped; each `decide` call and each whole tick (sum over seats) is timed
// inside an ordinary headless match. Budget on the per-call p95: strict 1 ms local, 5 ms with --ci or CI=true.
import assert from 'node:assert/strict';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BOT_VERSION, runMatch, createSeatBot, HUMAN_PROXY } from '../dist/index.js';
import { loadAuthored, humanIndex, MAX_TICKS, HUMAN_ACTION_DELAY_MS } from './golden.mjs';

export function assertBudget(p95Ms, ci = false) {
  const limit = ci ? 5 : 1;
  assert.ok(Number.isFinite(p95Ms) && p95Ms >= 0 && p95Ms < limit, `Bot decision p95 budget exceeded: ${p95Ms} ms; requires < ${limit} ms`);
}
const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
const us = ms => Math.round(ms * 1000 * 100) / 100;
const summarize = values => { const s = [...values].sort((a, b) => a - b); return { n: s.length, meanUs: us(mean(s)), p95Us: us(pct(s, 0.95)), maxUs: us(s[s.length - 1]) }; };

export function largestLevel(loaded) {
  const entries = loaded.catalog.campaigns.common.entries;
  let best;
  for (const entry of entries) {
    const level = loaded.compiled[entry.level];
    if (!best || level.buildings.length > best.level.buildings.length) best = { entry, level };
  }
  return best;
}
export function measure({ seed = 1 } = {}) {
  const { loaded, metadata } = loadAuthored();
  const { entry, level } = largestLevel(loaded);
  const calls = [], acting = [], ticks = [];
  let tickSum = 0, lastTick = -1;
  const flush = () => { if (lastTick >= 0) ticks.push(tickSum); tickSum = 0; };
  const wrap = bot => ({ player: bot.player, decide(ctx, tick) {
    if (tick !== lastTick) { flush(); lastTick = tick; }
    const start = performance.now();
    const commands = bot.decide(ctx, tick);
    const elapsed = performance.now() - start;
    tickSum += elapsed; calls.push(elapsed); if (commands.length > 0) acting.push(elapsed);
    return commands;
  } });
  const human = humanIndex(level);
  const seats = [createSeatBot(level, seed, human, { ...HUMAN_PROXY, actionDelayMs: HUMAN_ACTION_DELAY_MS }), ...level.bots.map(b => createSeatBot(level, seed, b.player, b.bot))];
  const result = runMatch({ level, seed, maxTicks: MAX_TICKS, controllers: seats.map(wrap) });
  flush();
  assert.equal(result.stats.rejected, 0);
  assert.ok(calls.length > 0 && acting.length > 0, 'Benchmark must evaluate and select actions');
  const perCall = summarize(calls);
  return { botVersion: BOT_VERSION, position: entry.position, level: entry.level, buildings: level.buildings.length, seats: seats.length, seed, matchTicks: result.ticks,
    outcome: result.outcome.outcome, perDecideCall: perCall, perActingCall: summarize(acting), perTick: summarize(ticks), p95Ms: perCall.p95Us / 1000 };
}
function main() {
  const args = process.argv.slice(2); assert.ok(args.every(arg => arg === '--ci'), 'Unknown benchmark argument');
  const ci = args.includes('--ci') || /^(1|true)$/i.test(process.env.CI ?? '');
  const result = measure();
  console.log(JSON.stringify({ environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model }, mode: ci ? 'ci' : 'strict', budgetMs: ci ? 5 : 1, result }, null, 2));
  assertBudget(result.p95Ms, ci);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
