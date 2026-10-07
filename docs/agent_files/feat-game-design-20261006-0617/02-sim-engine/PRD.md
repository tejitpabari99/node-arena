---
status: draft
summary: Deterministic render-free sim engine — generic interpreter of SP01 compiled content; component-to-system registry, lazy analytic troop movement, integer-only math, command/event API, state hash, replays, test and perf plan
date: 2026-10-07
---
# PRD: Sim Engine (SP02)

Repo/branch: node-arena · feat/game-design · Depends on: SP01 (GAME_RULES.md, `CompiledLevel`, component registry names)
Owns: `packages/sim/**` (engine, component systems, state/hash, replay record/playback, lint config, unit/property/golden tests, `bench:sim`), golden replay files. Does not own: bots, CLI runners, CI rule-ID scanner (SP04); rendering, input, pause/speed scheduling (SP03).

## TL;DR
- `create(compiledLevel, seed) → Sim`; `sim.step(commands) → events`; read-only `sim.view` + `sim.hash()`. Nothing else crosses the boundary.
- Engine is a generic interpreter: **each SP01 component = one registered system** (+ declared state columns); core owns only entities that are not components (players, lines/channels, troops). Zero tunable numbers in code.
- Troops are **lazy**: position = `p0 + (tick − t0) × speed`, stored per troop in per-line FIFO channels. Movement costs nothing per tick; only channel fronts are examined (clash, arrival).
- Integer math only (int32 columns, doubles used as exact ints ≤ 2^53, no `/`, no `Math.sqrt`, no trig); unique, total-ordered iteration everywhere; same code runs in Node (v3) and browser.

## Problem
SP01 fixes *what* the rules and data are; something must execute them identically in the browser, in bots/balance runners (headless, thousands of games) and on a v3 server. It must stay extensible (archer, tank, map objects, teams) without engine restructure and expose enough for the renderer to interpolate and for bots to decide.

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Implement every GAME_RULES.md rule; each rule ID has a `covers` test | Rendering, audio, input, UI, camera (SP03) |
| Component registry; v2 additions = one system + data | Implementing `shoots`, tank value 2, map objects, obstacles (hooks only) |
| Bit-identical results across Node/V8 versions and platforms | Bot logic, balance runner, replay CLI (SP04) |
| Replay = header + commands + checkpoints; hash for desync | Networking, prediction, rollback (v3) |
| Budget: 2,000 troops, p99 step < 1 ms | Multithreading / Web Worker (driver may do later; sim is worker-safe) |

## Requirements
1. Pure TS, ES2022 lib only (no DOM, no Node types); depends on `packages/content` types only.
2. Consumes only `CompiledLevel` (all int32). Needs from compile (SP01): dense indices with towers/players sorted by id; per-component int params; troop kinds `{value, speedMilli}`; `timeLimitSec`; `team`, `kind`, `colorKey` per player. Visual keys (and `colorKey`) pass through untouched to `view` (never read by rules); `CompiledLevel.bots` is ignored by sim.
3. Fixed tick = R-TCK constant (20 Hz). Progress unit = 1/(1000·tickRate) world unit (see Fixed-point). No wall clock; pause/1×/2× = how often the driver calls `step`.
4. One canonical ordering rule: players, towers, channels ascending by dense index (= sorted id). No `for…in`, no unsorted `Object.keys`, no default `sort()`.
5. Startup asserts sim component registry keys == content registry keys; unknown component = load error.
6. `step` never throws on bad commands (returns `CommandRejected`); throws only on internal invariant breach (debug builds assert int32 range, conservation).

## Architecture

### Public API (`packages/sim`)
```ts
create(level: CompiledLevel, seed: number): Sim
interface Sim {
  readonly tick: number; readonly view: SimView;           // view mutated in place; valid until next step
  step(cmds: readonly Command[], opts?: {events?: boolean}): readonly SimEvent[]; // no-op after GameOver
  readonly rejected: number;                                // cumulative CommandRejected count; maintained even with events:false
  canDraw(player: string, from: string, to: string): RejectReason | null;     // string ids like Command; same validator step() uses
  readTroops(out: TroopBuf): number;                        // fills caller typed arrays, no alloc
  hash(): string;                                           // 16 hex, dual 32-bit lanes
  snapshot(): SimSnapshot;                                  // JSON-serialisable (tests, golden diffs, v3 keyframes)
}
type Command =
  | {type:'DrawLine'; player:string; from:string; to:string}
  | {type:'CutLine';  player:string; from:string; to:string};
type SimEvent = // all carry tick; ids are dense indices into view.ids
  | LineDrawn{channel,from,to,owner} | LineCut{channel,reason:'player'|'slots'|'captured'|'replaced'}
  | TroopSpawned{channel,seq,owner} | Clash{channel,progA,progB,value}
  | TroopArrived{tower,owner,effect:'reinforce'|'overflow'|'hit'} | Captured{tower,from,to}
  | PlayerEliminated{player} | GameOver{outcome:'won'|'lost'|'draw'|'timeout',winnerTeam|null}
  | CommandRejected{cmd,reason};
```
- **Public exports** (SP03/SP04 may import only these): `create`, types `Sim, SimView, SimEvent, Command, RejectReason, TroopBuf, SimSnapshot`, replay helpers, `TICK_RATE`, and math/PRNG utilities `idiv, mulDiv, isqrt, Sfc32, mixSeed(...parts: number[]): number`. `events:false` skips event construction but still counts rejects in `sim.rejected` (harness asserts zero).
- **Clash event semantics**: `channel` = the A→B channel with A's dense index < B's; `progA` = progress of that channel's front measured from A (its source); `progB` = progress of the reverse channel's front measured from B (its own source). Both are channel-relative to their own source; the clash point on line A→B is at `progA/length`. `value` = value removed from each side.
- Commands use string ids (stable in replays/wire); events/views use dense indices + `view.ids.{towers,players}` (hot path). Commands in a step are canonicalised: stable-sorted by player index, original order within player.
- `Surrender` omitted in v1 ([DEFERRED] to v3 leave/forfeit). Swipe/right-click hit-testing lives in SP03 (geometry from `view.lines`); it just emits `CutLine`.
- `RejectReason`: `not-owner | self | no-slot | duplicate | gameover | unknown-id | no-component`. `canDraw` lets UI preview and bots never produce rejects.

### SimView (read-only, zero-copy typed arrays)
| Field | Content |
|---|---|
| `tick`, `over`, `timeLimitTicks` | current tick; `null` or `{outcome, winnerTeam}`; `timeLimitSec·tickRate` (HUD countdown, SP03) |
| `ids` | `towers[]`, `players[]` strings |
| `players[i]` | `{team, kind ('human'\|'bot'), colorKey, alive, transit, stats{generated, overflowLost, kills, captures}}` |
| `tower.*` | Int32Array columns: `owner` (−1 neutral), `team`, `slots` (derived max lines), `lines` (used), plus every component column (`garrison.count`, `garrison.cap`, `generates.acc`, `drawsLines.cursor`) via `tower.col[name]` |
| `towerStatic[i]` | `{x,y (milli), archetype, visual, footprintRadius, components: string[]}` (component names, sorted; drives SP03 overlays) |
| `lines[]` | drawn lines `{channel, from, to, owner, length, drawSeq}` (sorted) |
| `kinds[k]` | `{value, speedPerTick, visual}` — renderer extrapolates `progress + alpha·speedPerTick`, clamped to `length`; no troop identity needed |
| `readTroops` | per troop: `channel, seq (stable id, for animation phase), owner, kind, progress` at current tick |
World floats: renderer converts milli → units. Troop position along a line = `progress / length` lerp between tower positions (renderer-side float).

### Fixed-point (answers SP01 open item)
- Authored 3 decimals → milli (SP01). **Internal progress unit = 1/20 000 world unit (milli × tickRate).** Per-tick step = `speedMilli` exactly (speed 3.001 u/s → 3001 progress/tick), so there is *no* per-tick rounding or accumulator for movement. Line length = integer `isqrt` of `(dx²+dy²)` in progress units, computed once at `create` (floor, ≤ 1/20 000 u error, identical for all troops).
- Bounds (SP01 validator additions): `|coord| ≤ 500 u`, `speed ≤ 100 u/s`, so `dx² + dy² ≤ 8·10^14 < 2^53`; all temporaries exact doubles; stored columns int32.
- **Answer: scale 1000 for authoring is enough; no finer authored scale.** Spike (1 task, before engine core): property test over random lines/speeds comparing integer arrival tick against BigInt-exact; must match within 0 ticks for floor-length rule, and confirm overflow bounds. Fail → widen internal factor, not authored precision.
- Generation: `acc += ratePerSecMilli`; one unit per `1000·tickRate` of acc (SP01). Helpers `idiv` (trunc), `mulDiv` (range-checked) are the only division paths.

### State model
| Entity | Storage | Notes |
|---|---|---|
| players | arrays by index: `team`, `alive`, `transit`, `stats` | unbounded count; hostile = different team (v1 teams all distinct) |
| towers | Int32Array columns: core `owner`; plus columns each component declares | ≤ ~50 towers; archetype index static |
| channels | one per ordered pair `from×N+to`, lazily allocated, never freed: `drawn` flag, `drawSeq`, FIFO ring of troops (SoA: `p0,t0,owner,kind,seq`) | a *line* is a channel with `drawn=1`; cut = clear flag, troops in flight remain and complete |
| troops | in channel rings | `progress(t) = p0 + (t−t0)·speed`; spawn: `p0=0,t0=tick` |
| prng | sfc32, 4×uint32 | v1 never draws (all ties resolved by ordering); present for v2 neutral-archer targeting and for header parity |
Invariant: a tower generates exactly one troop kind (SP01 `generates.troop`), so each channel is a FIFO sorted by progress; front = oldest = furthest. v2 map objects that alter speed re-base `p0,t0` per troop.

### Tick phases (map to SP01 order)
| # | Phase | Systems (registry order) | Notes |
|---|---|---|---|
| 1 | commands | core command applier; `drawsLines` validator | validate fully, then mutate (atomic) |
| 2 | generation | `generates` | `acc` update; units emitted for owned towers; tower with no drawn line → `garrison.count++` if below cap |
| 3 | departures | `drawsLines` | each unit goes to one line: round-robin cursor by target index; count frozen |
| – | movement | (implicit) | lazy formula; no loop |
| 4 | clash | core | head-on fronts, below |
| 5 | arrivals + capture | core queue → `garrison.onArrive` → `capturable.onHit` | capture is inline (see below), not a separate loop |
| 6 | slot enforcement | `drawsLines` | cut newest (`max drawSeq`) until `lines ≤ slots(count)` |
| 7 | win/lose/time | core | per-player `alive = towers>0 ∨ transit>0` |
Slot enforcement at 6 (end of tick) rather than SP01's phase 2 ensures no observable state has more lines than slots (see SP01 change request).

### Component registry
```ts
registerComponent({ name:'generates', state:{acc:0}, systems:{generation: fn}, hooks?:{...} })
```
| Component | State columns | Systems / hooks |
|---|---|---|
| `garrison` | `count`, `cap` | `onArrive(tower, troop)`: friendly → `count=min(cap,count+value)`, excess = `overflow`; hostile → hit |
| `generates` | `acc` | generation system |
| `drawsLines` | `cursor` | command validator (slots, no self, one per pair), departures, slot enforcement; `slots = 1 + #{t ∈ extraSlotAbove : t < count}` |
| `capturable` | — | `onHit`: if `count==0` → flip owner |
- Phases are a fixed ordered list in code (mirrors GAME_RULES §4); a system declares phase + `order`. Adding a phase = rules minor bump. Towers lists per component precomputed at `create` (sorted).
- Hash and `snapshot` iterate declared columns generically → new components are hashed/snapshotted for free.
- **v2 plug-in**: `shoots` = new component with `acc` column + system in a new `ranged` phase between clash and arrivals, using core `killFront(channel,value)`; tank = troop `value` 2 flowing through existing value-unit combat; `gate/hazard` = map-object registry (same shape) with a `onCross` hook called by clash/arrival scan over lines. No existing system edited.

### Mechanics decisions (edge cases)
- **Send sharing**: one accumulator per tower. Each unit with ≥1 drawn line departs on exactly one line, chosen round-robin by ascending target index after `cursor`. Total out = generation exactly; integer; independent of draw order; each line gets ≈ rate/k.
- **Cap**: gates only additions to garrison. Tower at cap with ≥1 line keeps sending (send = generation); at cap with 0 lines `acc` stops accumulating (no banked burst). Capture resets `acc`, `cursor`.
- **Simultaneous arrivals**: collect all front arrivals in the tick, apply in order: overshoot (`progress − length`) descending (earlier true arrival first), then channel key, then FIFO. Fair (no id bias except exact ties); each troop re-evaluated against tower owner/team *at its turn*, so a mid-tick capture turns later hostile arrivals into reinforcements and vice versa.
- **Hit/capture**: hostile arrival value v: `d=min(v,count)`; `count-=d`; if `count==0` and tower is `capturable` → flip to troop owner, new garrison = `v−d`; capture cuts old owner's outgoing lines (`LineCut captured`) and fires `Captured`. Arrival at an owned tower with count 0 therefore flips it.
- **Head-on clash**: for each channel pair (A→B, B→A) non-empty: while `progA(front)+progB(front) ≥ length` and fronts hostile → both lose `min(valueA,valueB)`; loop. Integer only, no midpoint division (event carries progA/progB; renderer derives point). Friendly or mixed-front pairs are skipped until the front clears (rare; v4 only). Clash runs on any channel incl. cut lines still carrying troops.
- **Win/lose**: after phases 1–6: eliminate players with no towers and no troops in transit; game over when ≤1 team alive or the human is eliminated (`lost`); both sides eliminated same tick → `draw` (counts as not completed); `tick ≥ timeLimitSec·tickRate` → `timeout` (loss for all). Post-GameOver `step` is a no-op.

### Determinism, hash, replay
- **Lint** (ESLint on `packages/sim`; the config is exported as a shared preset `packages/sim/eslint.determinism.cjs` that `packages/bots` extends): ban `Math.random|sqrt|sin|cos|tan|atan2|pow|exp|log|hypot|round`, `Date`, `performance`, `setTimeout`, `console`, `Intl`, float literals (`Literal[raw=/\./]`), `for…in`, `sort` without comparator, `JSON.stringify` in hash path; tsconfig `lib:["ES2022"], types:[]`. Only `src/math.ts` may use `Math.floor/trunc/imul`.
- **Hash**: stream int32 words through two murmur3-style lanes (different seeds) → 16 hex. Covers tick, prng, player alive/transit, tower columns, channel flags/seq, troop ring contents in channel order. Excludes events, stats, view caches. Content identity is SP01 `simHash`, not this.
- **Replay** `{header{rulesVersion,schemaVersion,contentVersion,levelId,simHash,seed}, commands:[{tick,cmd}], checkpoints:[{tick,hash}] every 20 ticks, finalHash, outcome}`. Recorder wraps `step`; `playReplay(content, rec)` re-creates, refuses header mismatch, verifies checkpoints, returns first diverging tick. Rejected commands are recorded as submitted.
- Driver contract for SP03: `commands.tick = sim.tick` at submission; pause = don't call `step`; 2× = two `step`s per interval; result identical regardless of scheduling.

### Testing & perf
| Layer | What |
|---|---|
| Rule tests | one+ per rule ID, titled `covers R-XXX-NN: …` (SP04 scans) |
| Golden replays | per-mechanic + 3 full-level replays; final hash + event-log hash committed; update only via `pnpm sim:golden --update` with version bump (CI checks) |
| Property (fast-check, seeded) | random levels + random incl. invalid command streams: `0 ≤ count ≤ cap`; lines ≤ slots after each step; conservation `initial+generated = Σcount+Σin-flight value+hits×2+clash×2+overflow`; `transit` equals recount; determinism (twice → same hash; split-step scheduling → same hash); replay round-trip |
| Cross-runtime | goldens run in Node and in Chromium (Playwright) with identical hashes |
| Extensibility | test registers fixture `shoots` stub + tank value 2 with no engine edits |
| Perf | `bench:sim`: 30 towers, 3 bots' worth of lines, 2,000 in flight: mean < 0.3 ms, p99 < 1 ms per step; `hash()` < 0.5 ms; CI fails at 5× budget (noise margin). Expect large headroom from lazy movement. |

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| 1 | Troop motion | Lazy `p0+(t−t0)·speed`; examine fronts only | Mutate every troop per tick; float lerp | O(channels) per tick; hash/snapshot tiny; renderer extrapolates |
| 2 | Progress scale | milli × tickRate internal; authored stays 3 decimals | Finer authored scale; per-tick accumulator | Exact per-tick step, no rounding drift |
| 3 | Troop storage | Per ordered-pair channel FIFO rings | Global pool + free list; per-line lanes | FIFO sorted by invariant, stable order without sorting, cut lines need no special case |
| 4 | Send sharing | One accumulator + round-robin cursor | Per-line accumulators (rate/k); fractional | Exact conservation, k-independent |
| 5 | Arrival ties | Overshoot desc → channel → FIFO | Tower id order; PRNG | Fair and deterministic without RNG |
| 6 | Clash | Fronts, `pA+pB ≥ L` | Pairwise all troops; position grid | O(1) per channel pair, no division |
| 7 | Capture | Inline on hit leaving 0; leftover value = garrison | Separate end-of-tick phase | Later same-tick arrivals re-evaluate correctly |
| 8 | Components | Registry: state columns + phase systems + hooks | ECS library; if-chains | Generic hash/snapshot; add = register |
| 9 | Phase list | Fixed in code mirroring rules | Data-driven phases | Phase order is a rule, not a tunable |
| 10 | IDs | Strings in commands, indices in events/views | All strings; all indices | Replay readability vs hot path |
| 11 | Hash | Dual 32-bit murmur lanes over int32 words | SHA-256 per tick; FNV 32 | Fast, enough for desync detection, no deps |
| 12 | Slot enforcement | End of tick (SP01 amendment) | Start of next tick | No observable over-slot state |
| 13 | PRNG | sfc32, present but unused in v1 | Omit until v2 | Header/seed parity; avoids later state-layout change |
| 14 | Scheduling | Outside sim; step = one tick | Sim-owned clock | Pause/2×/server/test all trivial |

## Risks / Open Questions
- [OPEN] Cap semantics with lines (tower at cap keeps sending; acc not banked) — confirm in R-CAP wording with the user at greybox.
- [OPEN] Capture with count exactly 0 flips to hitter with 0 garrison; playtest whether feels punishing.
- [RESOLVED: SP03 results copy "Mutual defeat — not completed"] `draw` outcome UI wording.
- [OPEN] Friendly/mixed front pass-through during head-on clash is simplified; revisit for v4 teams.
- [OPEN] Fixed-point spike result may change internal factor (low risk).
- [OPEN] Event volume with 2× speed and `events:false` bypass for balance runner — measure.
- [RESOLVED: lazy progress + overshoot ordering] arrival fairness and perf.
- [DEFERRED] Surrender/leave, `restore(snapshot)`, mid-tick rollback, worker hosting (v3).

## Requested SP01 changes
[ACCEPTED: all four folded into SP01 (phase order, R-CMB/R-CAP/R-LIN text, validator bounds, compile output). Kept here for traceability.]
1. Move slot enforcement to after arrivals/capture (phase 6); movement and capture become implicit/inline in R-TCK phase text.
2. R-CMB: define clash on fronts, overshoot-ordered simultaneous arrivals, hit-leaving-0 capture with leftover value.
3. R-CAP: cap gates garrison additions only; no banked accumulator at cap.
4. Validator bounds: `|coord| ≤ 500`, `speed ≤ 100 u/s`; compile exposes dense sorted indices and `team` per player.

## Acceptance Criteria
1. API above exists with exported types; SP03/SP04 can depend only on `create`, `step`, `view`, `readTroops`, `canDraw`, `hash`, `snapshot`, replay helpers.
2. Every R-ID in GAME_RULES.md has a `covers` test; every v1 component registered; registry parity assertion passes.
3. Editing rate/speed/pos/cap/thresholds in data changes behaviour with no sim code change; grep/lint finds no float literals or tunable constants in `packages/sim/src`.
4. Property + golden + cross-runtime (Node/Chromium) hash tests pass; replay round-trip verifies checkpoints.
5. Fixture `shoots` stub and tank value 2 run without editing existing systems.
6. Perf bench within budget; fixed-point spike report committed with the R-TCK scale statement.
