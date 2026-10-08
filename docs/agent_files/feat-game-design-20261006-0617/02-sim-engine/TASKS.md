---
status: in-progress
summary: 13 tasks to build the deterministic sim engine (packages/sim) - scaffold and lint, fixed-point spike, registry/state, tick phases, view/hash, replay, tests, perf
date: 2026-10-08
---
# Tasks: Sim Engine (SP02)
Source of truth: /root/projects/node-arena/.worktrees/feat/game-design/docs/agent_files/feat-game-design-20261006-0617/02-sim-engine/PRD.md. Generic interpreter of SP01 `CompiledLevel`; each component is one registered system; zero tunable numbers in code. All SP02 tasks depend on SP01 (GAME_RULES.md, CompiledLevel, component registry names, validator bounds).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Package scaffold + determinism lint preset | SP01 | in-progress |
| 2 | Fixed-point spike + math/PRNG utilities | 1 | todo |
| 3 | State model, component registry, `create` | 2, SP01 | todo |
| 4 | Commands, `canDraw`, generation, departures | 3 | todo |
| 5 | Lazy movement, clash, arrivals, capture | 4 | todo |
| 6 | Slot enforcement, win/lose/time, events, `step` | 5 | todo |
| 7 | SimView, `readTroops`, `snapshot`, `hash` | 6 | todo |
| 8 | Replay record/playback | 7 | todo |
| 9 | Rule tests (`covers R-XXX-NN`) | 6 | todo |
| 10 | Property tests | 8 | todo |
| 11 | Golden replays + `sim:golden` + cross-runtime | 8, 9 | todo |
| 12 | Extensibility fixture test | 6 | todo |
| 13 | `bench:sim` + perf/event-volume measurement | 7 | todo |

## Task 1 — Package scaffold + determinism lint preset
What it is / what it means: Creates `packages/sim` as pure TS (ES2022 lib, no DOM, no Node types), depending only on `packages/content` types (Req 1; Determinism).
What changes at a high level: tsconfig with `lib:["ES2022"], types:[]`; ESLint determinism rules exported as `eslint.determinism.cjs` (bans random/sqrt/trig/pow/round, Date, performance, timers, console, Intl, float literals, `for…in`, comparator-less sort, JSON.stringify in hash path); only `src/math.ts` may use `Math.floor/trunc/imul`; public export surface stub.
Done when: lint runs clean on the empty package and demonstrably fails on a seeded violation; preset is importable by `packages/bots` (SP04).

## Task 2 — Fixed-point spike + math/PRNG utilities
What it is / what it means: Decision 2 and the Fixed-point section. Runs the spike first (before engine core): property test over random lines/speeds comparing integer arrival tick to BigInt-exact, confirming zero-tick match for the floor-length rule and overflow bounds. Resolved: failure widens the internal factor only, never authored precision.
What changes at a high level: implement `idiv`, `mulDiv` (range-checked), `isqrt`, `Sfc32`, `mixSeed`; spike test and report text with the R-TCK scale statement.
Done when: spike passes (or internal factor adjusted) and report is written for commit; utilities exported; no other division path exists.

## Task 3 — State model, component registry, `create`
What it is / what it means: Decisions 3, 8, 13 and Requirements 2, 4, 5. Generic registry plus SoA state: player arrays, tower Int32 columns, lazily allocated per-pair channels with FIFO rings, sfc32 state.
What changes at a high level: `registerComponent` with declared state columns, phase systems, hooks; register v1 components (`garrison`, `generates`, `drawsLines`, `capturable`); startup parity assertion against the content registry (unknown component = load error); `create(level, seed)` precomputes sorted per-component tower lists and line lengths via `isqrt`; visual keys pass through; `bots` ignored; canonical ascending-index ordering.
Done when: `create` builds state from a compiled level, parity assertion passes and fails on mismatch.

## Task 4 — Commands, `canDraw`, generation, departures
What it is / what it means: Tick phases 1-3 (Decisions 4, 10; Send sharing and Cap decisions, both RESOLVED with user). Covers DrawLine/CutLine validation and the economy.
What changes at a high level: command canonicalisation (stable sort by player index); validate-then-mutate atomically; `RejectReason` set and `CommandRejected` (never throws); `canDraw` sharing the same validator; `generates` accumulator, no-line towers add to garrison below cap, at-cap-with-line keeps sending, at-cap-no-line stops accumulating; round-robin departures by ascending target index via cursor; capture resets `acc`/`cursor`.
Done when: commands and economy behave per rules incl. rejects counted in `sim.rejected` regardless of `events`.

## Task 5 — Lazy movement, clash, arrivals, capture
What it is / what it means: Phases 4-5 (Decisions 1, 5, 6, 7). Troop position is `p0+(t−t0)·speed`; only channel fronts are examined.
What changes at a high level: head-on front clash (`pA+pB ≥ L`, hostile fronts, loop on `min` value, friendly/mixed skipped, cut lines with troops included); arrivals collected and ordered by overshoot desc, channel key, FIFO; `garrison.onArrive` and `capturable.onHit` inline; hit/capture with leftover garrison (count 0 flips to hitter with 0 garrison, RESOLVED); capture cuts old owner's lines (`captured`); each troop re-evaluated at its turn.
Done when: mechanics match the PRD edge cases deterministically with no per-troop per-tick loop.

## Task 6 — Slot enforcement, win/lose/time, events, `step`
What it is / what it means: Phases 6-7 plus the `step` contract (Decision 12, Requirement 6).
What changes at a high level: end-of-tick slot enforcement cutting newest `drawSeq` until `lines ≤ slots`; per-player `alive = towers>0 ∨ transit>0`; outcomes won/lost/draw/timeout; step no-op after GameOver; full `SimEvent` set with clash progA/progB semantics; `events:false` skips construction; debug-build invariant asserts (int32 range, conservation) are the only throws.
Done when: full tick runs through all seven phases in order and emits the specified events.

## Task 7 — SimView, `readTroops`, `snapshot`, `hash`
What it is / what it means: Read-side API and Decision 11. Zero-copy typed-array view, no allocation troop read.
What changes at a high level: `SimView` fields (ids, players with stats, tower columns incl. component columns, towerStatic, lines, kinds with `speedPerTick`, `over`, `timeLimitTicks`); `readTroops(out)`; JSON `snapshot` iterating declared columns generically; `hash()` with dual murmur-style 32-bit lanes, 16 hex, covering tick, prng, alive/transit, tower columns, channel flags/seq, troop rings in channel order; excludes events/stats/caches.
Done when: view/hash/snapshot reflect state, new component columns are hashed for free, hash is stable across runs.

## Task 8 — Replay record/playback
What it is / what it means: Replay section and driver contract. Recorder wraps `step`; header carries rules/schema/content versions, levelId, simHash, seed.
What changes at a high level: record commands (including rejected, as submitted), checkpoints every 20 ticks, finalHash, outcome; `playReplay(content, rec)` re-creates, refuses header mismatch, verifies checkpoints, returns first diverging tick; export replay helpers and `TICK_RATE`; scheduling-independent result (pause/2× = number of `step` calls).
Done when: record then play round-trips and a tampered replay reports the diverging tick.

## Task 9 — Rule tests (`covers R-XXX-NN`)
What it is / what it means: Testing layer 1; acceptance criterion 2. Every R-ID in GAME_RULES.md gets at least one test whose title starts `covers R-XXX-NN:` (scanned by SP04 CI).
What changes at a high level: unit tests per rule using small hand-built compiled levels; registry parity and every v1 component registered; data-change test showing behaviour changes with no code edit (criterion 3).
Done when: all rule IDs covered and passing; grep/lint finds no float literals or tunable constants in `packages/sim/src`.

## Task 10 — Property tests
What it is / what it means: Testing layer 3 using seeded fast-check over random levels and random (including invalid) command streams.
What changes at a high level: invariants `0 ≤ count ≤ cap`, lines ≤ slots after each step, the conservation equation, `transit` equals recount, determinism (same hash twice and under split-step scheduling), replay round-trip.
Done when: properties pass over the agreed seeds/run counts.

## Task 11 — Golden replays + `sim:golden` + cross-runtime
What it is / what it means: Testing layers 2 and 4. Golden files are owned by SP02.
What changes at a high level: per-mechanic goldens plus 3 full-level goldens (final hash + event-log hash committed); `pnpm sim:golden --update` guarded by version bump (CI check); same goldens run in Node and Chromium (Playwright) with identical hashes.
Done when: goldens pass in both runtimes and update path refuses without version bump.

## Task 12 — Extensibility fixture test
What it is / what it means: Acceptance criterion 5 (v2 plug-in). Proves hooks without engine edits.
What changes at a high level: test-only fixture registers a `shoots` stub component (own `acc` column, system in a new `ranged` phase using core `killFront`) and runs a tank troop of value 2 through existing combat.
Done when: both run with zero edits to existing systems and the fixture column is hashed/snapshotted automatically.

## Task 13 — `bench:sim` + perf/event-volume measurement
What it is / what it means: Perf budget (2,000 troops, p99 < 1 ms) and the RESOLVED event-volume item (measure at 2× with `events:false` for the balance runner).
What changes at a high level: bench with 30 towers, 3 bots' worth of lines, 2,000 in flight: mean < 0.3 ms, p99 < 1 ms per step, `hash()` < 0.5 ms; CI fails at 5× budget; record event volume with and without events; commit spike report with R-TCK scale statement (acceptance 6).
Done when: bench within budget and measurements recorded.

## Manual steps (owner)
None in the PRD. No [OPEN] items; all Risks are RESOLVED or DEFERRED (surrender, `restore`, rollback, worker hosting, v4 friendly-front pass-through get no tasks).
