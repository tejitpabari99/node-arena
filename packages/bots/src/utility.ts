import type { ResolvedBotProfile } from '@node-arena/content';
import { idiv, TICK_RATE, type Command } from '@node-arena/sim';
import type { Bot, BotContext } from './index.js';
import { createUtilityScorer, type ComponentExtractors } from './considerations.js';

export interface UtilityBotOptions {
  readonly player: string;
  readonly profile: ResolvedBotProfile;
  /** Caller supplies the independently mixed per-seat seed; cadence is driver-owned. */
  readonly seed: number;
  readonly towerCount: number;
  readonly extractors?: ComponentExtractors;
  /** Per-tower `drawsLines.extraSlotAbove` (whole troops, ascending) from the compiled level.
   * The public view does not expose it; without it the commitment slot guard/pre-empt is off. */
  readonly slotThresholds?: readonly (readonly number[] | undefined)[];
}

/**
 * SP02 line commitment (bot-side only; profiles without `params.commitment` run the v1 path,
 * with identical candidates, scores and RNG draws).
 *
 * State (bot-local, pre-allocated, reset when a new match is detected by a tick regression):
 * - line age: first-seen tick per directed channel keyed by its drawSeq (own lines only; an
 *   entry is dropped when the line disappears, so a replaced/redrawn line starts a new age);
 * - cutTick per unordered pair: stamped by an own CutLine, an own reverse draw that replaces the
 *   own line (R-LIN-03), a pre-emptive slot cut, or a detected sim slot-cut (an own line seen at the
 *   previous decision is gone, no own cut/replacement was issued, its source is still owned and
 *   no own reverse line replaced it). A source capture (`captured`) stamps nothing.
 *
 * Rules per decision, in this order:
 * 1. Slot pre-empt (R13): an own tower at slot capacity whose top gated slot threshold T has
 *    garrison - T <= slotPreemptMargin cuts its lowest-keepScore own line (ties: lowest target
 *    index), bypassing lifetime and margin; uses one action and stamps the redraw block.
 * 2. Draw candidates are not enumerated (no score, no RNG) when the unordered pair is inside the
 *    redraw block (any danger, any stickiness weight), when the slot the line would occupy is
 *    gated by T with garrison - T < slotGuardMargin (R12), or when the draw would replace an own
 *    reverse line (R-LIN-03) that is still under its lifetime lock (danger below dangerOverride).
 * 3. Cut candidates: an own line younger than minLineLifetimeSec is skipped (no RNG) unless
 *    danger(from) >= dangerOverride. Otherwise the noisy score is drawn (one RNG word, same
 *    enumeration position as v1) and the noise-free cutScore and keepScore (noise-free score of
 *    the line's own purpose: reinforce if the target is on the bot's team, else attack) are
 *    computed without RNG. The cut is dropped unless
 *    cutScore - keepScore >= cutMargin. Near-tie hysteresis (R4): when the noisy cut beats the
 *    keep option by less than cutMargin + tieHysteresis, the cut competes with its noise-free
 *    score, so noise cannot carry a marginal cut. Draw scores keep their noise.
 * RNG order (commitment path): reinforce draws (source asc, target asc), attack draws (source
 * asc, nearest rank), then own cuts in view.lines order; skipped candidates draw nothing.
 */
const NEVER = -1e15;
/** No allocations during enumeration, scoring or top-N selection. Ordinary command
 * objects and the returned array are allocated only when emitting accepted actions. */
export function createUtilityBot(options: UtilityBotOptions): Bot {
  if (options.profile.kind !== 'utility') throw new Error('createUtilityBot requires a utility profile');
  const n = options.towerCount;
  const params = options.profile.params;
  const scorer = createUtilityScorer({ ...options, params });
  const capacity = n * n * 2;
  const source = new Int32Array(capacity), target = new Int32Array(capacity);
  const kind = new Int8Array(capacity), scores = new Int32Array(capacity), consumed = new Uint8Array(capacity);
  const nearest = new Int32Array(n), slotsUsed = new Int32Array(n);
  const pairUsed = new Uint8Array(n * n);
  const drawnPairs = new Uint8Array(n * n);
  const maxTargets = Math.min(n, params.maxTargetsPerSource ?? n);
  const actions = params.skill?.actionsPerDecision ?? 1;
  const threshold = params.holdThreshold ?? 0;
  const player = options.player;
  const teams: string[] = [];
  let count = 0;
  const commit = params.commitment;
  const toTicks = (milli: number): number => idiv(milli * TICK_RATE, 1000);
  const minLife = commit ? toTicks(commit.minLineLifetimeSec) : 0;
  const redrawBlock = commit ? toTicks(commit.redrawBlockSec) : 0;
  const thresholds = options.slotThresholds;
  // Directed-channel line age: drawSeq (-1 = absent) and first-seen tick; tick of an own draw.
  const seenSeq = new Int32Array(n * n).fill(-1), seenTick = new Float64Array(n * n);
  const drawTick = new Float64Array(n * n).fill(NEVER), cutTick = new Float64Array(n * n).fill(NEVER);
  const ownNow = new Uint8Array(n * n);
  let lastTick = NEVER;

  function resetCommitment(): void {
    seenSeq.fill(-1); seenTick.fill(0); drawTick.fill(NEVER); cutTick.fill(NEVER); lastTick = NEVER;
  }
  function stampCut(s: number, t: number, tick: number): void { cutTick[s * n + t] = tick; cutTick[t * n + s] = tick; }
  /** Threshold gating slot `index` (0 = base slot, never gated) of tower s, or -1. */
  function gate(s: number, index: number): number {
    if (index < 1 || !thresholds) return -1;
    const list = thresholds[s];
    return list && index - 1 < list.length ? list[index - 1]! : -1;
  }
  function slotGuarded(s: number, index: number, garrison: number): boolean {
    const threshold = gate(s, index);
    return commit !== undefined && threshold >= 0 && (garrison - threshold) * 1000 < commit.slotGuardMargin;
  }

  /** Pre-emptive slot cut: retire the age entry (no slot-cut misdetection), start the redraw block. */
  function preemptCut(s: number, t: number, tick: number): void {
    seenSeq[s * n + t] = -1; stampCut(s, t, tick);
    slotsUsed[s] = Math.max(0, slotsUsed[s]! - 1);
    pairUsed[s * n + t] = 1; pairUsed[t * n + s] = 1;
    scorer.record('cut', s, t, tick);
  }
  /** Commitment draw gate: redraw block, and the lifetime lock of an own reverse line that the
   * draw would replace (R-LIN-03 replacement is a cut of that line). */
  function drawAllowed(s: number, t: number, tick: number): boolean {
    if (tick < cutTick[s * n + t]! + redrawBlock) return false;
    const reverse = t * n + s;
    return !(seenSeq[reverse]! >= 0 && tick - seenTick[reverse]! < minLife && scorer.danger(t) < commit!.dangerOverride);
  }
  function add(action: 0 | 1 | 2, from: number, to: number): void {
    source[count] = from; target[count] = to; kind[count] = action;
    scores[count] = scorer.score(action === 0 ? 'attack' : action === 1 ? 'reinforce' : 'cut', from, to);
    count++;
  }

  return { player, decide(ctx: BotContext, tick: number): Command[] {
    const view = ctx.view;
    const commands: Command[] = [];
    if (view.over) return commands;
    scorer.prepare(ctx, tick);
    const playerIds = view.ids.players, towerIds = view.ids.towers;
    const owners = view.tower.owner, towerLines = view.tower.lines, towerSlots = view.tower.slots;
    const lines = view.lines;
    const p = playerIds.indexOf(player);
    teams.length = view.players.length;
    for (let owner = 0; owner < view.players.length; owner++) teams[owner] = view.players[owner]!.team;
    count = 0; consumed.fill(0); pairUsed.fill(0); drawnPairs.fill(0);
    for (let l = 0; l < lines.length; l++) drawnPairs[lines[l]!.from * n + lines[l]!.to] = 1;
    const garrisons = view.tower.col['garrison.count'];
    if (commit) {
      if (tick <= lastTick) resetCommitment();
      ownNow.fill(0);
      for (let l = 0; l < lines.length; l++) {
        const line = lines[l]!;
        if (line.owner !== p) continue;
        const key = line.from * n + line.to;
        ownNow[key] = 1;
        if (seenSeq[key] !== line.drawSeq) {
          seenSeq[key] = line.drawSeq;
          // An own draw issued since the previous decision dates the line; otherwise first sight.
          seenTick[key] = drawTick[key] !== NEVER && drawTick[key]! >= lastTick && drawTick[key]! <= tick ? drawTick[key]! : tick;
        }
      }
      for (let key = 0; key < n * n; key++) {
        if (seenSeq[key]! < 0 || ownNow[key]) continue;
        seenSeq[key] = -1;
        const s = idiv(key, n), t = key % n;
        // Vanished without an own cut/replacement (those clear the entry when issued): a source
        // capture needs no block; an own reverse line means replacement; otherwise a slot-cut.
        if (owners[s] === p && !ownNow[t * n + s]) stampCut(s, t, tick);
      }
      lastTick = tick;
    }
    for (let s = 0; s < n; s++) slotsUsed[s] = towerLines[s]!;
    if (commit && commit.slotPreemptMargin > 0 && thresholds) {
      for (let s = 0; s < n && commands.length < actions; s++) {
        if (owners[s] !== p || towerLines[s]! < towerSlots[s]!) continue;
        const threshold = gate(s, towerLines[s]! - 1);
        if (threshold < 0 || ((garrisons?.[s] ?? 0) - threshold) * 1000 > commit.slotPreemptMargin) continue;
        let worst = -1, worstKeep = 0;
        for (let l = 0; l < lines.length; l++) {
          const line = lines[l]!;
          if (line.owner !== p || line.from !== s || pairUsed[s * n + line.to]) continue;
          const keep = scorer.keepScore(s, line.to);
          if (worst === -1 || keep < worstKeep || (keep === worstKeep && line.to < worst)) { worst = line.to; worstKeep = keep; }
        }
        if (worst === -1) continue;
        preemptCut(s, worst, tick);
        commands.push({ type: 'CutLine', player, from: towerIds[s]!, to: towerIds[worst]! });
      }
    }
    for (let s = 0; s < n; s++) {
      if (owners[s] !== p || towerLines[s]! >= towerSlots[s]! || !view.towerStatic[s]!.components.includes('drawsLines')) continue;
      if (commit && slotGuarded(s, towerLines[s]!, garrisons?.[s] ?? 0)) continue;
      // Keep reinforcement scoring in ascending target order so RNG consumption
      // remains identical. These candidates use public v1 feasibility facts.
      for (let t = 0; t < n; t++) {
        if (s !== t && !drawnPairs[s * n + t] && owners[t] === p && (!commit || drawAllowed(s, t, tick))) add(1, s, t);
      }
      let nearestCount = 0;
      // Static distance/index order avoids validating candidates later displaced.
      // Dynamic ownership, line presence and authoritative custom vetoes stay live.
      for (let rank = 0; rank < n && nearestCount < maxTargets; rank++) {
        const t = scorer.nearestTarget(s, rank);
        if (s === t || drawnPairs[s * n + t]) continue;
        const owner = owners[t]!;
        if (owner >= 0 && teams[owner] === teams[p]) continue;
        if (ctx.canDraw(player, towerIds[s]!, towerIds[t]!) !== null) continue;
        nearest[nearestCount++] = t;
      }
      for (let i = 0; i < nearestCount; i++) if (!commit || drawAllowed(s, nearest[i]!, tick)) add(0, s, nearest[i]!);
    }
    for (let l = 0; l < lines.length; l++) {
      const line = lines[l]!;
      if (line.owner !== p) continue;
      if (!commit) { add(2, line.from, line.to); continue; }
      const from = line.from, to = line.to, key = from * n + to;
      if (pairUsed[key]) continue;
      if (tick - seenTick[key]! < minLife && scorer.danger(from) < commit.dangerOverride) continue;
      const noisy = scorer.score('cut', from, to);
      const raw = scorer.scoreRaw('cut', from, to), keep = scorer.keepScore(from, to);
      if (raw - keep < commit.cutMargin) continue;
      source[count] = from; target[count] = to; kind[count] = 2;
      scores[count] = noisy - keep < commit.cutMargin + commit.tieHysteresis ? raw : noisy;
      count++;
    }

    while (commands.length < actions) {
      let best = -1;
      for (let i = 0; i < count; i++) {
        if (consumed[i] || scores[i]! <= threshold) continue;
        if (best === -1 || scores[i]! > scores[best]! || (scores[i] === scores[best] &&
          (source[i]! < source[best]! || (source[i] === source[best] && target[i]! < target[best]!)))) best = i;
      }
      if (best === -1) break;
      consumed[best] = 1;
      const s = source[best]!, t = target[best]!, cut = kind[best] === 2;
      if (pairUsed[s * n + t]) continue;
      if (commit && !cut && slotGuarded(s, slotsUsed[s]!, garrisons?.[s] ?? 0)) continue;
      if (cut) {
        let ownLine = false;
        for (let l = 0; l < lines.length; l++) {
          const line = lines[l]!;
          if (line.from === s && line.to === t && line.owner === p) { ownLine = true; break; }
        }
        if (!ownLine) continue;
        slotsUsed[s] = Math.max(0, slotsUsed[s]! - 1);
      } else {
        if (slotsUsed[s]! >= towerSlots[s]! || ctx.canDraw(player, towerIds[s]!, towerIds[t]!) !== null) continue;
        slotsUsed[s] = slotsUsed[s]! + 1;
      }
      pairUsed[s * n + t] = 1; pairUsed[t * n + s] = 1;
      if (commit) {
        if (cut) { seenSeq[s * n + t] = -1; stampCut(s, t, tick); } else {
          drawTick[s * n + t] = tick;
          // An own reverse line is replaced by this draw (R-LIN-03): retire it and block flip-back.
          if (seenSeq[t * n + s]! >= 0) { seenSeq[t * n + s] = -1; stampCut(s, t, tick); }
        }
      }
      const action = cut ? 'cut' : kind[best] === 0 ? 'attack' : 'reinforce';
      scorer.record(action, s, t, tick);
      commands.push({ type: cut ? 'CutLine' : 'DrawLine', player, from: towerIds[s]!, to: towerIds[t]! });
    }
    return commands;
  } };
}
