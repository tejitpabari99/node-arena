import type { BotAction, BotConsideration, BotParams } from '@node-arena/content';
import { idiv, isqrt, mulDiv, Sfc32, TICK_RATE } from '@node-arena/sim';
import type { SimView, TroopBuf } from '@node-arena/sim';
import type { BotContext } from './index.js';

export type ComponentExtractor = (view: SimView, tower: number) => number;
export class ComponentExtractors {
  private readonly entries = new Map<string, ComponentExtractor>();
  register(name: string, extractor: ComponentExtractor): void {
    if (this.entries.has(name)) throw new Error(`Duplicate component extractor: ${name}`);
    this.entries.set(name, extractor);
  }
  definitions(): readonly (readonly [string, ComponentExtractor])[] {
    return [...this.entries.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  }
}
export function createComponentExtractors(): ComponentExtractors {
  const registry = new ComponentExtractors();
  registry.register('generates', (view, tower) => view.tower.col['generates.ratePerSec']?.[tower] ?? 0);
  registry.register('garrison', (view, tower) => view.tower.col['garrison.cap']?.[tower] ?? 0);
  registry.register('drawsLines', () => 1);
  registry.register('capturable', () => 1);
  return registry;
}

/** Exhaustiveness is checked against the public content type without a runtime import. */
const REGISTRY = {
  targetValue: 0, timeToTake: 1, distance: 2, threatToSource: 3, threatToTarget: 4,
  targetWeakness: 5, ownerDominance: 6, sliceCost: 7, lineUseless: 8, stickiness: 9,
} as const satisfies Record<BotConsideration, number>;
export const CONSIDERATION_IDS: readonly BotConsideration[] = Object.freeze(Object.keys(REGISTRY) as BotConsideration[]);
export function assertConsiderationParity(ids: readonly string[]): void {
  if (ids.length !== CONSIDERATION_IDS.length || new Set(ids).size !== ids.length || ids.some(id => !Object.hasOwn(REGISTRY, id))) {
    throw new Error('Consideration registry parity mismatch');
  }
}
assertConsiderationParity(CONSIDERATION_IDS);
const ACTIONS = ['attack', 'reinforce', 'cut'] as const satisfies readonly BotAction[];
const MAX = 2147483647;
const clamp = (value: number): number => Math.max(0, Math.min(1000, value));
const ratio = (value: number, scale: number): number => scale <= 0 ? 0 : clamp(mulDiv(value, 1000, scale));
export function towerDistance(view: SimView, from: number, to: number): number {
  const a = view.towerStatic[from]!, b = view.towerStatic[to]!;
  const dx = a.x - b.x, dy = a.y - b.y;
  return isqrt(dx * dx + dy * dy);
}
/** Simulation channel progress uses coordinates scaled by TICK_RATE before isqrt. */
function towerProgressLength(view: SimView, from: number, to: number): number {
  const a = view.towerStatic[from]!, b = view.towerStatic[to]!;
  const dx = (a.x - b.x) * TICK_RATE, dy = (a.y - b.y) * TICK_RATE;
  return Math.max(1, isqrt(dx * dx + dy * dy));
}
function troopBuffer(size: number): TroopBuf {
  return { channel: new Int32Array(size), seq: new Int32Array(size), owner: new Int32Array(size), kind: new Int32Array(size), progress: new Int32Array(size) };
}
export interface UtilityScorerOptions {
  readonly player: string;
  readonly towerCount: number;
  /** All numbers are already loaded milli-units. */
  readonly params: Omit<BotParams, 'extends'>;
  readonly seed: number;
  readonly extractors?: ComponentExtractors;
}

/** Scratch storage is reused. prepare may grow troop storage, never score/consideration. */
export class UtilityScorer {
  private view!: SimView;
  private tick = 0;
  private playerIndex = -1;
  private extent = 1;
  private readonly count: number;
  private readonly rng: Sfc32;
  private readonly noise: number;
  private readonly cooldown: number;
  private readonly weights = new Int32Array(30);
  private readonly totals = new Int32Array(3);
  private readonly activeIds = new Int8Array(30);
  private readonly activeCounts = new Int8Array(3);
  private readonly fixedSource: Float64Array;
  private readonly fixedTarget: Float64Array;
  private readonly biases = new Int32Array(3);
  private readonly extractors: readonly (readonly [string, ComponentExtractor])[];
  private readonly componentWeights: Int32Array;
  private readonly componentRaw: Float64Array;
  private readonly componentMax: Float64Array;
  private readonly componentTotal: number;
  private readonly value: Int32Array;
  private readonly generation: Float64Array;
  private readonly ownIncoming: Float64Array;
  private readonly ownIncomingPairs: Float64Array;
  private readonly hostileIncoming: Float64Array;
  private readonly dominance: Int32Array;
  private readonly recentTick: Float64Array;
  private readonly recentKind: Int32Array;
  private readonly recentDirection: Int32Array;
  private troops = troopBuffer(0);
  private cachedStatic: SimView['towerStatic'] | undefined;
  private readonly distances: Float64Array;
  private readonly proximity: Int32Array;
  private readonly orderedTargets: Int32Array;
  private readonly progressLengths: Float64Array;
  private readonly dangers: Int32Array;
  private readonly weakness: Int32Array;
  private readonly sliceCosts: Int32Array;
  private readonly proposedFlow: Float64Array;
  private readonly speed: Int32Array;
  private readonly garrison: Int32Array;
  private readonly redundantDefense: Float64Array;
  private remainingTicks = 0;
  private remainingSeconds = 1;
  private readonly teams: string[] = [];
  private playerTeams = new Int32Array(0);
  private playerTeam = -1;
  private owners!: SimView['tower']['owner'];

  constructor(private readonly options: UtilityScorerOptions) {
    this.count = options.towerCount;
    if (!Number.isInteger(this.count) || this.count < 1) throw new RangeError('towerCount must be a positive integer');
    this.rng = new Sfc32(options.seed);
    const params = options.params;
    this.noise = params.skill?.noise ?? 0;
    this.cooldown = idiv((params.cooldownSec ?? 0) * TICK_RATE, 1000);
    for (let a = 0; a < ACTIONS.length; a++) {
      const action = ACTIONS[a]!;
      // Omitted maps get a neutral deterministic fallback; explicit empty maps disable actions.
      const map = params.weights?.[action] ?? (action === 'attack' ? { targetValue: 1000 } : {});
      this.biases[a] = params.bias?.[action] ?? 1000;
      for (let c = 0; c < CONSIDERATION_IDS.length; c++) {
        const weight = map[CONSIDERATION_IDS[c]!] ?? 0;
        this.weights[a * 10 + c] = weight;
        if (weight > 0 && c !== REGISTRY.targetValue && c !== REGISTRY.threatToSource &&
          c !== REGISTRY.threatToTarget && c !== REGISTRY.targetWeakness && c !== REGISTRY.ownerDominance && c !== REGISTRY.sliceCost) {
          this.activeIds[a * 10 + this.activeCounts[a]!] = c;
          this.activeCounts[a] = this.activeCounts[a]! + 1;
        }
        this.totals[a] = this.totals[a]! + weight;
      }
    }
    this.extractors = (options.extractors ?? createComponentExtractors()).definitions();
    this.componentWeights = new Int32Array(this.extractors.length);
    this.componentRaw = new Float64Array(this.extractors.length * this.count);
    this.componentMax = new Float64Array(this.extractors.length);
    const componentValues = params.componentValue ?? { generates: 1000, garrison: 1000 };
    let total = 0;
    for (let c = 0; c < this.extractors.length; c++) {
      const weight = componentValues[this.extractors[c]![0]] ?? 0;
      this.componentWeights[c] = weight;
      total += weight;
    }
    for (const name of Object.keys(componentValues)) {
      if (!this.extractors.some(entry => entry[0] === name) && componentValues[name]! > 0) throw new Error(`Missing component extractor: ${name}`);
    }
    this.componentTotal = total;
    this.fixedSource = new Float64Array(this.count * 3);
    this.fixedTarget = new Float64Array(this.count * 3);
    this.proximity = new Int32Array(this.count * this.count);
    this.orderedTargets = new Int32Array(this.count * this.count);
    this.dangers = new Int32Array(this.count);
    this.weakness = new Int32Array(this.count);
    this.sliceCosts = new Int32Array(this.count);
    this.proposedFlow = new Float64Array(this.count);
    this.speed = new Int32Array(this.count);
    this.garrison = new Int32Array(this.count);
    this.redundantDefense = new Float64Array(this.count);
    this.distances = new Float64Array(this.count * this.count);
    this.progressLengths = new Float64Array(this.count * this.count);
    this.value = new Int32Array(this.count);
    this.generation = new Float64Array(this.count);
    this.ownIncoming = new Float64Array(this.count);
    this.ownIncomingPairs = new Float64Array(this.count * this.count);
    this.hostileIncoming = new Float64Array(this.count);
    this.dominance = new Int32Array(this.count);
    this.recentTick = new Float64Array(this.count * this.count);
    this.recentTick.fill(-1);
    this.recentKind = new Int32Array(this.count * this.count);
    this.recentDirection = new Int32Array(this.count * this.count);
  }

  prepare(ctx: BotContext, tick: number): void {
    this.view = ctx.view;
    this.tick = tick;
    if (this.view.ids.towers.length !== this.count) throw new RangeError('View tower count changed');
    this.playerIndex = this.view.ids.players.indexOf(this.options.player);
    if (this.playerIndex === -1) throw new Error('Unknown bot player');
    const view = this.view;
    this.remainingTicks = view.timeLimitTicks - tick;
    this.remainingSeconds = Math.max(1, idiv(Math.max(0, this.remainingTicks), TICK_RATE));
    this.teams.length = view.players.length;
    for (let player = 0; player < view.players.length; player++) this.teams[player] = view.players[player]!.team;
    if (this.playerTeams.length !== view.players.length) this.playerTeams = new Int32Array(view.players.length);
    for (let player = 0; player < view.players.length; player++) {
      this.playerTeams[player] = player;
      for (let previous = 0; previous < player; previous++) if (this.teams[player] === this.teams[previous]) {
        this.playerTeams[player] = this.playerTeams[previous]!; break;
      }
    }
    this.playerTeam = this.playerTeams[this.playerIndex]!;
    this.owners = view.tower.owner;
    const simKinds = view.kinds;
    const garrison = view.tower.col['garrison.count'], cap = view.tower.col['garrison.cap'];
    const generation = view.tower.col['generates.ratePerSec'], kindIds = view.tower.col['generates.troop'];
    // Sim publishes one immutable towerStatic array per match. Replacement contexts
    // invalidate both geometric distance and exact scaled-before-isqrt progress caches.
    const geometryChanged = this.cachedStatic !== view.towerStatic;
    if (geometryChanged) {
      for (let from = 0; from < this.count; from++) for (let to = 0; to < this.count; to++) {
        const pair = from * this.count + to;
        this.distances[pair] = towerDistance(view, from, to);
        this.progressLengths[pair] = towerProgressLength(view, from, to);
      }
      for (let from = 0; from < this.count; from++) for (let to = 0; to < this.count; to++) {
        const row = from * this.count, distance = this.distances[row + to]!;
        let position = to;
        while (position > 0) {
          const previous = this.orderedTargets[row + position - 1]!;
          const previousDistance = this.distances[row + previous]!;
          if (previousDistance < distance || (previousDistance === distance && previous < to)) break;
          this.orderedTargets[row + position] = previous;
          position--;
        }
        this.orderedTargets[row + position] = to;
      }
      this.cachedStatic = view.towerStatic;
    }
    let minX = view.towerStatic[0]!.x, maxX = minX, minY = view.towerStatic[0]!.y, maxY = minY;
    this.ownIncoming.fill(0); this.ownIncomingPairs.fill(0); this.hostileIncoming.fill(0); this.componentMax.fill(0);
    for (let t = 0; t < this.count; t++) {
      const tower = view.towerStatic[t]!;
      minX = Math.min(minX, tower.x); maxX = Math.max(maxX, tower.x);
      minY = Math.min(minY, tower.y); maxY = Math.max(maxY, tower.y);
      const kind = simKinds[kindIds?.[t] ?? 0];
      this.generation[t] = view.tower.owner[t]! < 0 ? 0 : Math.min(MAX, (generation?.[t] ?? 0) * (kind?.value ?? 0));
      this.garrison[t] = garrison?.[t] ?? 0;
      this.weakness[t] = 1000 - ratio(this.garrison[t]!, cap?.[t] ?? 0);
      this.sliceCosts[t] = idiv(1000, Math.max(1, view.tower.lines[t]! + 1));
      this.proposedFlow[t] = idiv(this.generation[t]!, Math.max(1, view.tower.lines[t]! + 1));
      this.speed[t] = kind?.speedPerTick ?? 0;
      this.redundantDefense[t] = this.generation[t]! + mulDiv(this.garrison[t]! + 1, 1000, this.remainingSeconds);
      let owned = 0;
      for (let other = 0; other < this.count; other++) if (view.tower.owner[t]! >= 0 && view.tower.owner[t] === view.tower.owner[other]) owned++;
      this.dominance[t] = ratio(owned, this.count);
      for (let c = 0; c < this.extractors.length; c++) {
        const [name, extractor] = this.extractors[c]!;
        const raw = tower.components.includes(name) ? extractor(view, t) : 0;
        if (!Number.isSafeInteger(raw) || raw < 0 || raw > MAX) throw new RangeError('Component extractor must return a nonnegative int32');
        this.componentRaw[c * this.count + t] = raw;
        this.componentMax[c] = Math.max(this.componentMax[c]!, raw);
      }
    }
    this.extent = Math.max(1, isqrt((maxX - minX) * (maxX - minX) + (maxY - minY) * (maxY - minY)));
    if (geometryChanged) {
      for (let pair = 0; pair < this.proximity.length; pair++) this.proximity[pair] = 1000 - ratio(this.distances[pair]!, this.extent);
    }
    for (let t = 0; t < this.count; t++) {
      let value = 0;
      for (let c = 0; c < this.extractors.length; c++) value += this.componentWeights[c]! * ratio(this.componentRaw[c * this.count + t]!, this.componentMax[c]!);
      this.value[t] = this.componentTotal > 0 ? idiv(value, this.componentTotal) : 0;
    }
    for (let l = 0; l < view.lines.length; l++) {
      const line = view.lines[l]!;
      this.addFlow(line.owner, line.from, line.to, idiv(this.generation[line.from]!, Math.max(1, view.tower.lines[line.from]!)));
    }
    let count = ctx.readTroops(this.troops);
    if (count > this.troops.seq.length) { this.troops = troopBuffer(count); count = ctx.readTroops(this.troops); }
    if (count > this.troops.seq.length) throw new Error('Troop read changed during preparation');
    const troopChannels = this.troops.channel, troopKinds = this.troops.kind;
    const troopProgress = this.troops.progress, troopOwners = this.troops.owner;
    for (let i = 0; i < count; i++) {
      const channel = troopChannels[i]!;
      const to = channel % this.count;
      const kind = simKinds[troopKinds[i]!]!;
      const remaining = Math.max(1, this.progressLengths[channel]! - troopProgress[i]!);
      const ticks = Math.max(1, idiv(remaining + Math.max(1, kind.speedPerTick) - 1, Math.max(1, kind.speedPerTick)));
      // Near-term flow from the visible pipeline remains relevant after a line is cut.
      this.addFlow(troopOwners[i]!, idiv(channel, this.count), to, mulDiv(kind.value, 1000 * TICK_RATE, ticks));
    }
    for (let tower = 0; tower < this.count; tower++) this.dangers[tower] = this.calculateDanger(tower);
    // These weighted integer terms depend on only one tower for this decision.
    // Sum once; pair-dependent terms and per-score RNG keep their original order.
    for (let a = 0; a < ACTIONS.length; a++) for (let tower = 0; tower < this.count; tower++) {
      const w = a * 10, row = a * this.count + tower;
      this.fixedTarget[row] = this.weights[w + REGISTRY.targetValue]! * this.value[tower]! +
        this.weights[w + REGISTRY.threatToTarget]! * this.dangers[tower]! +
        this.weights[w + REGISTRY.targetWeakness]! * this.weakness[tower]! +
        this.weights[w + REGISTRY.ownerDominance]! * this.dominance[tower]!;
      this.fixedSource[row] = this.weights[w + REGISTRY.threatToSource]! * (a === 2 ? this.dangers[tower]! : 1000 - this.dangers[tower]!) +
        this.weights[w + REGISTRY.sliceCost]! * this.sliceCosts[tower]!;
    }
  }

  /** Geometric milli-distance; call prepare before using the current public view. */
  distance(from: number, to: number): number { return this.distances[from * this.count + to]!; }
  /** Immutable geometry order, with index tie-break; dynamic legality is caller-owned. */
  nearestTarget(from: number, rank: number): number { return this.orderedTargets[from * this.count + rank]!; }
  private sameTeam(a: number, b: number): boolean {
    return a >= 0 && b >= 0 && this.playerTeams[a] === this.playerTeams[b];
  }
  private addFlow(owner: number, from: number, to: number, flow: number): void {
    const team = owner >= 0 ? this.playerTeams[owner]! : -1;
    if (team >= 0 && team === this.playerTeam) {
      this.ownIncoming[to] = Math.min(MAX, this.ownIncoming[to]! + flow);
      const pair = from * this.count + to;
      this.ownIncomingPairs[pair] = Math.min(MAX, this.ownIncomingPairs[pair]! + flow);
    }
    const targetOwner = this.owners[to]!;
    if (team < 0 || targetOwner < 0 || team !== this.playerTeams[targetOwner]) this.hostileIncoming[to] = Math.min(MAX, this.hostileIncoming[to]! + flow);
  }
  private calculateDanger(tower: number): number {
    const view = this.view;
    const reserveRate = mulDiv(this.garrison[tower]!, 1000, this.remainingSeconds);
    const defense = Math.min(MAX, reserveRate + this.generation[tower]! + (this.sameTeam(view.tower.owner[tower]!, this.playerIndex) ? this.ownIncoming[tower]! : 0));
    const hostile = this.hostileIncoming[tower]!;
    return ratio(hostile, Math.min(MAX * 2, hostile + defense));
  }
  /** Positive weights always mean desirability. Source threat is inverted to safety
   * for draws, while cuts benefit from source danger. All outputs are 0..1000. */
  consideration(id: BotConsideration, action: BotAction, from: number, to: number): number {
    const view = this.view;
    switch (id) {
      case 'targetValue': return this.value[to]!;
      case 'distance': return this.proximity[from * this.count + to]!;
      case 'targetWeakness': return this.weakness[to]!;
      case 'ownerDominance': return this.dominance[to]!;
      case 'sliceCost': return this.sliceCosts[from]!;
      case 'threatToSource': return action === 'cut' ? this.dangers[from]! : 1000 - this.dangers[from]!;
      case 'threatToTarget': return this.dangers[to]!;
      case 'stickiness': {
        const key = from * this.count + to;
        const recent = this.recentTick[key]!;
        if (recent < 0 || (this.recentKind[key] === (action === 'cut' ? 1 : 0) && this.recentDirection[key] === key) || this.cooldown === 0) return 1000;
        return ratio(Math.max(0, this.tick - recent), this.cooldown);
      }
      case 'timeToTake': {
        const own = this.ownIncoming[to]! + this.proposedFlow[from]!;
        const net = own - this.generation[to]!;
        if (net <= 0) return 0;
        const speed = this.speed[from]!;
        if (speed <= 0) return 0;
        const travel = idiv(this.progressLengths[from * this.count + to]! + speed - 1, speed);
        const capture = mulDiv(this.garrison[to]! + 1, 1000 * TICK_RATE, net);
        const remaining = this.remainingTicks;
        return remaining <= 0 ? 0 : 1000 - ratio(travel + capture + 1, remaining);
      }
      case 'lineUseless': {
        if (this.sameTeam(view.tower.owner[to]!, this.playerIndex)) return 1000;
        // Exclude the entire candidate source pair, including its in-flight troops.
        // Sum other pairs before saturation so a saturated own pipeline cannot hide
        // independent support. Cut channels still contribute their visible troops.
        let otherFlow = 0;
        for (let source = 0; source < this.count; source++) {
          if (source !== from) otherFlow = Math.min(MAX, otherFlow + this.ownIncomingPairs[source * this.count + to]!);
        }
        const defense = this.redundantDefense[to]!;
        return otherFlow > defense ? ratio(otherFlow - defense, otherFlow) : 0;
      }
    }
  }
  /** Source danger 0..1000 from the last prepare (existing calculateDanger signal). */
  danger(tower: number): number { return this.dangers[tower]!; }
  /** Noise-free score: score() without its noise term; consumes no RNG. */
  scoreRaw(action: BotAction, from: number, to: number): number {
    const a = ACTIONS.indexOf(action);
    if (this.totals[a] === 0) return 0;
    return mulDiv(this.normalized(a, action, from, to), this.biases[a]!, 1000);
  }
  /** Commitment keep score: best noise-free retained use (attack or reinforce) of the pair. */
  keepScore(from: number, to: number): number {
    return Math.max(this.scoreRaw('attack', from, to), this.scoreRaw('reinforce', from, to));
  }
  private normalized(a: number, action: BotAction, from: number, to: number): number {
    let numerator = this.fixedSource[a * this.count + from]! + this.fixedTarget[a * this.count + to]!;
    for (let i = 0; i < this.activeCounts[a]!; i++) {
      const c = this.activeIds[a * 10 + i]!;
      numerator += this.weights[a * 10 + c]! * this.consideration(CONSIDERATION_IDS[c]!, action, from, to);
    }
    return idiv(numerator, this.totals[a]!);
  }
  score(action: BotAction, from: number, to: number): number {
    const a = ACTIONS.indexOf(action);
    if (this.totals[a] === 0) return 0;
    const normalized = this.normalized(a, action, from, to);
    let noise = 0;
    if (this.noise > 0) {
      const span = this.noise * 2 + 1;
      const limit = idiv(4294967296, span) * span;
      let word = this.rng.next();
      // Reject the incomplete final bucket so integer noise is exactly uniform.
      while (word >= limit) word = this.rng.next();
      noise = word % span - this.noise;
    }
    return mulDiv(normalized, this.biases[a]!, 1000) + noise;
  }
  record(action: BotAction, from: number, to: number, tick: number): void {
    const kind = action === 'cut' ? 1 : 0;
    this.recentTick[from * this.count + to] = tick;
    this.recentTick[to * this.count + from] = tick;
    this.recentKind[from * this.count + to] = kind;
    this.recentKind[to * this.count + from] = kind;
    this.recentDirection[from * this.count + to] = from * this.count + to;
    this.recentDirection[to * this.count + from] = from * this.count + to;
  }
}
export function createUtilityScorer(options: UtilityScorerOptions): UtilityScorer { return new UtilityScorer(options); }
