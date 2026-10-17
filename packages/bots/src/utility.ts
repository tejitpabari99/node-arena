import type { ResolvedBotProfile } from '@node-arena/content';
import type { Command } from '@node-arena/sim';
import type { Bot, BotContext } from './index.js';
import { createUtilityScorer, type ComponentExtractors } from './considerations.js';

export interface UtilityBotOptions {
  readonly player: string;
  readonly profile: ResolvedBotProfile;
  /** Caller supplies the independently mixed per-seat seed; cadence is driver-owned. */
  readonly seed: number;
  readonly towerCount: number;
  readonly extractors?: ComponentExtractors;
}

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
    for (let s = 0; s < n; s++) {
      slotsUsed[s] = towerLines[s]!;
      if (owners[s] !== p || towerLines[s]! >= towerSlots[s]! || !view.towerStatic[s]!.components.includes('drawsLines')) continue;
      // Keep reinforcement scoring in ascending target order so RNG consumption
      // remains identical. These candidates use public v1 feasibility facts.
      for (let t = 0; t < n; t++) {
        if (s !== t && !drawnPairs[s * n + t] && owners[t] === p) add(1, s, t);
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
      for (let i = 0; i < nearestCount; i++) add(0, s, nearest[i]!);
    }
    for (let l = 0; l < lines.length; l++) {
      const line = lines[l]!;
      if (line.owner === p) add(2, line.from, line.to);
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
      const action = cut ? 'cut' : kind[best] === 0 ? 'attack' : 'reinforce';
      scorer.record(action, s, t, tick);
      commands.push({ type: cut ? 'CutLine' : 'DrawLine', player, from: towerIds[s]!, to: towerIds[t]! });
    }
    return commands;
  } };
}
