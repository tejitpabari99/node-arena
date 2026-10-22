// 06-ai-port Task 7: proxy solvability spike (levels at campaign positions 4-23).
// Run (after `pnpm --filter @node-arena/bots build`):
//   node packages/bots/scripts/proxy-spike.mjs [--seeds N] [--max-ticks N] [--json]
// Human seat = TW default AI (HUMAN_PROXY with actionDelayMs 500/1000/2000) vs authored level bots.
// Also: idle human (no commands), scripted-opening check, seed-1 determinism rerun.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContent } from '@node-arena/content';
import { runMatch, createSeatBot, HUMAN_PROXY } from '@node-arena/bots';

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i < 0 ? dflt : Number(process.argv[i + 1]); };
const SEEDS = arg('--seeds', 4);
const MAX_TICKS = arg('--max-ticks', 20000);
const ADS = [500, 1000, 2000];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../content');
const files = { 'data/balance.json': fs.readFileSync(path.join(root, 'data/balance.json'), 'utf8') };
for (const dir of ['units', 'buildings', 'elements', 'campaigns', 'levels']) {
  for (const name of fs.readdirSync(path.join(root, 'data', dir)).sort()) files[`data/${dir}/${name}`] = fs.readFileSync(path.join(root, 'data', dir, name), 'utf8');
}
const loaded = loadContent(files);
const entries = [...loaded.catalog.campaigns.common.entries].sort((a, b) => a.position - b.position);

const humanIndex = level => {
  const botSeats = new Set(level.bots.map(b => b.player));
  const idx = level.players.findIndex((_, i) => !botSeats.has(i));
  if (idx < 0) throw new Error('no human seat');
  return idx;
};
const proxy = (level, seed, ad) => createSeatBot(level, seed, humanIndex(level), { ...HUMAN_PROXY, actionDelayMs: ad });
const winnerIsHuman = (level, out) => {
  if (out.outcome === 'truncated' || out.winner === null || out.winner === undefined) return false;
  const h = humanIndex(level);
  return out.winner === h || out.winner === level.players[h].id;
};

function play(level, seed, human) {
  const h = humanIndex(level);
  const controller = human === 'idle' ? { player: h, commands: [] } : proxy(level, seed, human);
  const r = runMatch({ level, seed, maxTicks: MAX_TICKS, controllers: [controller] });
  return { outcome: r.outcome.outcome, players: r.stats.players.map(x => `${x.player}:${x.buildings}`).join(','), win: winnerIsHuman(level, r.outcome), ticks: r.ticks, rejected: r.stats.rejected, hash: r.stats.finalHash, commandCount: r.stats.commandCount };
}

// ---- expected scripted openings (timer-order-pin.md): T=-1 at match start; delay/line done at T+ceil(ms/50)+1.
const c50 = ms => Math.ceil(ms / 50);
function expectedFirst(seatBot, level, me) {
  const ids = level.buildings.map(b => b.id);
  let T = -1;
  for (const op of seatBot.script ?? []) {
    if (op.op === 'delay') { T += c50(op.ms) + 1; continue; }
    if (op.op === 'line') {
      const own = ids.indexOf(op.own);
      if (own >= 0 && level.buildings[own].owner !== level.players[me].id && level.buildings[own].owner !== me) { continue; } // skipped, no tick
      return { tick: T + c50(op.afterMs) + 1, from: op.own, to: op.target, note: '' };
    }
    if (op.op === 'steps') {
      // root starts at op first update T+1, fires at start + max(1, ceil(d/50)); ownership assumed held.
      return { tick: T + 1 + Math.max(1, c50(op.root.delayMs)), from: op.root.own, to: op.root.target, note: 'steps root' };
    }
  }
  return null;
}

function scriptedCheck(level, seed) {
  const h = humanIndex(level);
  const logs = new Map();
  const controllers = [{ player: h, commands: [] }];
  const ids = level.buildings.map(b => b.id);
  for (const { player, bot } of level.bots) {
    const inner = createSeatBot(level, seed, player, bot);
    controllers.push({ player, decide(ctx, tick) {
      const cmds = inner.decide(ctx, tick);
      for (const c of cmds) if (c.type === 'DrawLine' && !logs.has(player)) logs.set(player, { tick, from: ctx.view.ids.buildings[c.from], to: ctx.view.ids.buildings[c.to] });
      return cmds;
    } });
  }
  runMatch({ level, seed, maxTicks: 2000, controllers });
  return level.bots.map(({ player, bot }) => {
    if (!bot.script || bot.script.length === 0) return null;
    const exp = expectedFirst(bot, level, player);
    const got = logs.get(player) ?? null;
    const ok = !!(exp && got && got.tick === exp.tick && got.from === exp.from && got.to === exp.to);
    return { seat: level.players[player].id, exp, got, ok };
  }).filter(Boolean);
}

const t0 = performance.now();
const rows = [];
const scripted = [];
for (const { level: id, position } of entries) {
  const level = loaded.compiled[id];
  const isScripted = level.bots.some(b => (b.bot.script ?? []).length > 0);
  const row = { position, id, scripted: isScripted, bots: level.bots.length, runs: 0, rejected: 0, truncated: 0, idleTrunc: 0, endState: {}, idleWins: 0, idleRuns: 0, win: {}, maxTicks: 0, error: null };
  try {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const idle = play(level, seed, 'idle');
      row.idleRuns++; row.idleWins += idle.win ? 1 : 0; row.rejected += idle.rejected; row.idleTrunc += idle.outcome === 'truncated' ? 1 : 0;
      for (const ad of ADS) {
        const r = play(level, seed, ad);
        row.runs++; row.rejected += r.rejected; row.truncated += r.outcome === 'truncated' ? 1 : 0;
        if (r.outcome === 'truncated') (row.endState[ad] ??= []).push(r.players);
        row.win[ad] = (row.win[ad] ?? 0) + (r.win ? 1 : 0);
        row.maxTicks = Math.max(row.maxTicks, r.ticks);
      }
    }
    const a = play(level, 1, 2000), b = play(level, 1, 2000);
    row.determinism = a.hash === b.hash && a.ticks === b.ticks;
    if (isScripted) scripted.push({ position, id, seats: scriptedCheck(level, 1) });
  } catch (e) { row.error = String(e?.message ?? e); }
  rows.push(row);
  console.error(`pos ${position} ${id} done (${((performance.now() - t0) / 1000).toFixed(0)}s)`);
}
const runtimeSec = (performance.now() - t0) / 1000;
const out = { seeds: SEEDS, maxTicks: MAX_TICKS, ads: ADS, runtimeSec, rows, scripted };
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 1));
else {
  for (const r of rows) console.log(`${r.position}\t${r.id}\tscr=${r.scripted}\ttrunc=${r.truncated}/${r.runs}\tidleTrunc=${r.idleTrunc}\trej=${r.rejected}\tidleWins=${r.idleWins}/${r.idleRuns}\twin=${ADS.map(a => `${a}:${r.win[a] ?? '-'}/${SEEDS}`).join(' ')}\tdet=${r.determinism}\tmaxTicks=${r.maxTicks}\tend=${JSON.stringify(r.endState)}${r.error ? '\tERR ' + r.error : ''}`);
  for (const s of scripted) for (const x of s.seats) console.log(`script ${s.position} ${s.id} ${x.seat} exp=${JSON.stringify(x.exp)} got=${JSON.stringify(x.got)} ${x.ok ? 'MATCH' : 'MISMATCH'}`);
  console.log(`runtime ${runtimeSec.toFixed(1)}s`);
}
