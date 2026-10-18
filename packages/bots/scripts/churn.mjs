// Node-only churn metric (SP02 R9). Headless, deterministic: same code + content => byte-identical JSON.
// Runs every campaign level x a FIXED seed list (never change SEEDS: baselines compare against it).
// The single human seat is played by the `human-proxy` profile so bot opponents face a live player;
// level bot seats keep their authored profiles. The loop mirrors `runMatch` (same controllers, same
// pre-step decide order) but steps the sim with events enabled to observe `LineCut` reasons.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BOT_VERSION, createProfileBot, guardBotContext } from '../dist/index.js';
import { compileLevel, loadContent, resolveProfiles } from '../../content/dist/index.js';
import { create, TICK_RATE } from '../../sim/dist/index.js';
import { authoredFiles } from '../test/fixtures/corpus.mjs';

export const SEEDS = Object.freeze([1, 2, 3, 5, 8, 13, 37, 704]);
export const CUT_REDRAW_SEC = 10;
export const FLIP_SEC = 20;
export const HUMAN_SEAT_PROFILE = 'human-proxy';
const REASONS = ['player', 'slots', 'captured', 'replaced'];

function emptyCounts() {
  return { cuts: 0, draws: 0, lineCut: { player: 0, slots: 0, captured: 0, replaced: 0 },
    cutRedraw: { player: 0, slots: 0, captured: 0, replaced: 0, total: 0 }, flips: 0 };
}
function addCounts(into, from) {
  into.cuts += from.cuts; into.draws += from.draws; into.flips += from.flips;
  for (const reason of REASONS) { into.lineCut[reason] += from.lineCut[reason]; into.cutRedraw[reason] += from.cutRedraw[reason]; }
  into.cutRedraw.total += from.cutRedraw.total;
}

/**
 * Per-match counter. Pairs are unordered (a->b and b->a are one visible pair) and attributed to the
 * seat that owned the removed line. A redraw is a `LineDrawn` by that same seat on the same pair after
 * a removal; each removal pairs with at most the next redraw. cut-redraw: <= CUT_REDRAW_SEC, split by
 * the removal reason; flip: <= FLIP_SEC, any reason (covers cut-then-redraw and draw/cut/draw).
 */
export function createChurnCounter({ towerCount, playerCount, tickRate = TICK_RATE }) {
  const counts = Array.from({ length: playerCount }, emptyCounts);
  const channelOwner = new Map(); // channel key -> owner of the most recent draw
  const lastRemoval = new Map(); // `${owner}:${pair}` -> { tick, reason }
  const pairOf = channel => { const from = Math.floor(channel / towerCount), to = channel % towerCount; return Math.min(from, to) * towerCount + Math.max(from, to); };
  const redrawTicks = CUT_REDRAW_SEC * tickRate, flipTicks = FLIP_SEC * tickRate;
  return {
    seedLines(lines) { for (const line of lines) channelOwner.set(line.channel, line.owner); },
    commands(commands, playerIds) {
      for (const cmd of commands) {
        const seat = playerIds.indexOf(cmd.player);
        if (seat < 0) continue;
        if (cmd.type === 'CutLine') counts[seat].cuts++;
        else if (cmd.type === 'DrawLine') counts[seat].draws++;
      }
    },
    events(events) {
      for (const event of events) {
        if (event.type === 'LineDrawn') {
          channelOwner.set(event.channel, event.owner);
          const key = `${event.owner}:${pairOf(event.channel)}`;
          const removal = lastRemoval.get(key);
          if (!removal) continue;
          lastRemoval.delete(key);
          const age = event.tick - removal.tick, seat = counts[event.owner];
          if (age <= redrawTicks) { seat.cutRedraw[removal.reason]++; seat.cutRedraw.total++; }
          if (age <= flipTicks) seat.flips++;
        } else if (event.type === 'LineCut') {
          const owner = channelOwner.get(event.channel);
          assert.ok(owner !== undefined && owner >= 0, `LineCut on unknown channel ${event.channel}`);
          assert.ok(REASONS.includes(event.reason), `Unknown LineCut reason ${event.reason}`);
          counts[owner].lineCut[event.reason]++;
          lastRemoval.set(`${owner}:${pairOf(event.channel)}`, { tick: event.tick, reason: event.reason });
        }
      }
    },
    seats() { return counts.map(row => structuredClone(row)); },
  };
}

const round = value => Math.round(value * 1000) / 1000;
export function rates(counts, seatMinutes) {
  const per = value => seatMinutes > 0 ? round(value / seatMinutes) : 0;
  const lineCutPerMin = {}, cutRedrawPerMin = {};
  for (const reason of REASONS) { lineCutPerMin[reason] = per(counts.lineCut[reason]); cutRedrawPerMin[reason] = per(counts.cutRedraw[reason]); }
  cutRedrawPerMin.total = per(counts.cutRedraw.total);
  return { seatMinutes: round(seatMinutes), cutsPerMin: per(counts.cuts), drawsPerMin: per(counts.draws), slotCutsPerMin: lineCutPerMin.slots,
    lineCutPerMin, cutRedrawPerMin, flipsPerMin: per(counts.flips), counts };
}

/** Same controller set and decide/step order as `runMatch`, with events enabled. */
export function runChurnMatch(level, seed, humanProfile) {
  const humans = level.players.filter(player => player.kind === 'human');
  assert.equal(humans.length, 1, `${level.id}: expected exactly one human seat`);
  const humanId = humans[0].id;
  const byIndex = new Map(level.bots.map(({ player, profile }) => [player, profile]));
  const seats = level.players.map((player, index) => {
    const profile = player.id === humanId ? humanProfile : byIndex.get(index);
    return profile ? { player: player.id, role: player.id === humanId ? 'human' : 'bot', profile: profile.id, bot: createProfileBot(level, seed, player.id, profile) } : null;
  });
  const sim = create(level, seed);
  const playerIds = sim.view.ids.players;
  const counter = createChurnCounter({ towerCount: sim.view.ids.towers.length, playerCount: playerIds.length });
  counter.seedLines(sim.view.lines);
  while (!sim.view.over && sim.tick < sim.view.timeLimitTicks) {
    const context = guardBotContext(sim);
    const commands = [];
    for (const seat of seats) if (seat) for (const command of seat.bot.decide(context, sim.tick)) commands.push(command);
    counter.commands(commands, playerIds);
    counter.events(sim.step(commands, { events: true }));
    if (sim.rejected !== 0) throw new Error(`${level.id} seed ${seed}: ${sim.rejected} rejected command(s) at tick ${sim.tick}`);
  }
  const minutes = sim.tick / TICK_RATE / 60;
  const counts = counter.seats();
  return { ticks: sim.tick, finalHash: sim.hash(), outcome: sim.view.over ? { ...sim.view.over } : { outcome: 'truncated', winnerTeam: null },
    seats: seats.flatMap((seat, index) => seat ? [{ ...seat, bot: undefined, counts: counts[index], minutes }] : []) };
}

function parseArgs(args) {
  const options = { seeds: SEEDS.length, levels: 'all', out: null };
  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1];
    if (args[i] === '--seeds' && value !== undefined) { options.seeds = Number(value); i++; }
    else if (args[i] === '--levels' && value !== undefined) { options.levels = value; i++; }
    else if (args[i] === '--out' && value !== undefined) { options.out = resolve(process.env.INIT_CWD ?? process.cwd(), value); i++; } // INIT_CWD: pnpm --filter runs in the package dir
    else throw new Error(`Unknown churn argument ${args[i]}; usage: bots:churn [--seeds 1..${SEEDS.length}] [--levels all|id,id] [--out file]`);
  }
  if (!Number.isInteger(options.seeds) || options.seeds < 1 || options.seeds > SEEDS.length) throw new Error(`--seeds must be an integer in 1..${SEEDS.length} (prefix of the fixed seed list)`);
  return options;
}

export async function buildReport({ seeds = SEEDS.length, levels = 'all' } = {}) {
  const files = await authoredFiles();
  const loaded = loadContent(files);
  const envelope = JSON.parse(files['content.json']);
  const campaign = Object.values(loaded).filter(entity => 'towers' in entity && /^\d\d-/.test(entity.id)).map(entity => entity.id).sort();
  const selected = levels === 'all' ? campaign : levels.split(',');
  for (const id of selected) assert.ok(campaign.includes(id), `Unknown campaign level ${id}`);
  const humanProfile = Object.values(resolveProfiles(loaded)).find(profile => profile.id === HUMAN_SEAT_PROFILE);
  assert.ok(humanProfile, `Missing ${HUMAN_SEAT_PROFILE} profile`);
  const seedList = SEEDS.slice(0, seeds);
  const aggregate = () => ({ counts: emptyCounts(), minutes: 0, seats: 0 });
  const add = (row, seat) => { addCounts(row.counts, seat.counts); row.minutes += seat.minutes; row.seats++; };
  const totals = { bots: aggregate(), allSeats: aggregate() };
  const byProfile = new Map(), byLevel = new Map(), matches = [];
  for (const id of selected) {
    const level = compileLevel(loaded, id);
    for (const seed of seedList) {
      const match = runChurnMatch(level, seed, humanProfile);
      matches.push({ level: id, seed, ticks: match.ticks, outcome: match.outcome.outcome, finalHash: match.finalHash });
      for (const seat of match.seats) {
        add(totals.allSeats, seat);
        const key = seat.role === 'human' ? `${seat.profile} (human seat)` : seat.profile;
        if (!byProfile.has(key)) byProfile.set(key, aggregate());
        add(byProfile.get(key), seat);
        if (seat.role !== 'bot') continue;
        add(totals.bots, seat);
        if (!byLevel.has(id)) byLevel.set(id, aggregate());
        add(byLevel.get(id), seat);
      }
    }
  }
  const finish = row => ({ seats: row.seats, ...rates(row.counts, row.minutes) });
  const sorted = map => Object.fromEntries([...map.keys()].sort().map(key => [key, finish(map.get(key))]));
  return {
    tool: 'bots:churn', format: 1, botVersion: BOT_VERSION,
    rulesVersion: envelope.rulesVersion, contentVersion: envelope.contentVersion,
    seeds: seedList, levels: selected, humanSeatProfile: HUMAN_SEAT_PROFILE,
    windows: { cutRedrawSec: CUT_REDRAW_SEC, flipSec: FLIP_SEC },
    note: 'Rates are per seat-minute of match time. totals.bots = authored level bot seats (the opponents players see); allSeats adds the human-proxy seat.',
    totals: { bots: finish(totals.bots), allSeats: finish(totals.allSeats) },
    byProfile: sorted(byProfile), byLevel: sorted(byLevel), matches,
  };
}

function table(title, rows) {
  const header = ['name', 'seats', 'min', 'cuts/m', 'draws/m', 'slot/m', 'cut:ply/m', 'cut:cap/m', 'cut:rep/m', 'redraw:ply/m', 'redraw:slot/m', 'redraw:tot/m', 'flips/m'];
  const lines = Object.entries(rows).map(([name, r]) => [name, r.seats, r.seatMinutes, r.cutsPerMin, r.drawsPerMin, r.slotCutsPerMin,
    r.lineCutPerMin.player, r.lineCutPerMin.captured, r.lineCutPerMin.replaced, r.cutRedrawPerMin.player, r.cutRedrawPerMin.slots, r.cutRedrawPerMin.total, r.flipsPerMin].map(String));
  const all = [header, ...lines];
  const widths = header.map((_, i) => Math.max(...all.map(row => row[i].length)));
  const fmt = row => row.map((cell, i) => i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i])).join('  ');
  return [`## ${title}`, fmt(header), widths.map(w => '-'.repeat(w)).join('  '), ...lines.map(fmt)].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = await buildReport(options);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  console.log(table('Per bot profile', report.byProfile));
  console.log('');
  console.log(table('Per level (level bot seats)', report.byLevel));
  console.log('');
  console.log(table('Totals', report.totals));
  console.log('');
  console.log(json);
  if (options.out) await writeFile(options.out, json);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
