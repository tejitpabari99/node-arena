---
status: draft
summary: 8 tasks to rewrite packages/sim as the Tower War 2.0.0 engine with SP04 seams, v2 goldens/bench, and un-parked sim gates
date: 2026-10-22
---
# Tasks: Sim core (SP03)
Source of truth: docs/agent_files/feat-tower-war-port-20261022-0321/03-sim-core/PRD.md. Rewrites `packages/sim` on SP02's `CompiledLevel`; shooters, crossings and blockers stay SP04 stubs behind named seams. No open questions block this SP.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Skeleton on CompiledLevel + CUT (shared with 02#4) + event payload types | 01, 02#3 | done |
| 2 | Core state: ring, streams, hash v2, replay v2 | 1 | done |
| 3 | Commands, validation, line modules, seam hooks | 2 | done |
| 4 | Timers: spawn and growth | 2, 3 | done |
| 5 | Contacts, arrival, capture, forward | 4 | done |
| 6 | Win, read API, event emission | 5 | done |
| 7 | Oracle, property and determinism suites | 6 | done |
| 8 | Goldens, bench, un-park gates | 6, 7 | done |

## Task 1 — Skeleton on CompiledLevel + CUT
What it is / what it means: The new engine compiles against `CompiledLevel` and the `Record<ModuleId, SimModule>` binding; this is the same commit as 02 step 4 (R1, Architecture, Decision 1).
What changes at a high level: Build create/step/hash/read skeleton additively in `src/next/` with empty phases and stub `IMPLS`; then the mechanical CUT: move up, delete v1 `registry/economy/combat/stats`, v1 tests and goldens, runtime `assertParity`. Write the complete R7 event payload types into `defs` EVENTS (incl. `Clash`, `TroopDied`, `TowerShot`) with a type test.
Done when: grep finds no `registry.ts`, `economy.ts`, `assertParity`, `garrison`, `generates`, `PlayerEliminated`, `draw` outcome in `packages/sim`; build/lint/typecheck live set and math/numeric/determinism/replay tests green; PARKED entries per 09 plan.

## Task 2 — Core state, streams, hash v2, replay v2
What it is / what it means: Foundations every later phase relies on (R2, R7, Decisions 2, 3, 4, 5, 9).
What changes at a high level: Building, player, channel (`drawn, drawSeq, timer, length`) and ring columns (adds `hp`, canonical `removeAt`/`killTroop`); pre-allocated zeroed `shoots.cooldown`; `Sfc32.below(n)`, `fnv1a32`, `createStreams(seed).fork(name, idx)` with `fwd` per building; `assertInvariants` incl. conservation; hash domain `sim-state-v2` with sorted module columns; replay header unchanged at 2.0.0, `winner` rename, no hard step bound when limit is 0.
Done when: ring/streams/hash tests pass, distinct purpose ids for `fwd`/`bot.tw` asserted, snapshot/hash round-trips under `playReplay`, v1 replays rejected.

## Task 3 — Commands, validation, line modules, seam hooks
What it is / what it means: Player input path and the `level/drawsLines` modules (R4, R3 phase 1, SP04 seams).
What changes at a high level: `DrawLine`/`CutLine` with the pinned check order and reject codes, atomic; reverse-replace and head-on coexistence; no auto-cut on level drop; public `canDraw` sharing validators and never throwing; `blocksLines` stub in the validator slot; `onLineDrawn`/`onLineCut`/`onCapture` hooks; stub `shoots`/`blocksLines` modules and stub `crossingPass`.
Done when: `covers` tests for LIN draw/cut/replace/no-auto-cut and rejection goldens-in-unit pass; malformed input fuzz never throws.

## Task 4 — Timers: spawn and growth
What it is / what it means: Per-line milli-tick spawn and per-building growth, exact to TCK-06 (R5, Decision 11).
What changes at a high level: Pure `spawnPeriodMt`/`growPeriodMt` in `timers.ts` (clamped >= 1000, mulDiv, < 2^53); `spawns` module (eligible lines, alive-cap skip consuming the timer, new line timer 0) and `grows` module (only when `lines == 0`, ticks at max level, reset on fire/capture); mid-interval change uses new period on carried timer; phases 3 and 4 wired in order.
Done when: `covers` tests for TCK, ENT, SPN, GRW, and the alive cap pass; periods reproduce 03#4.1/#4.6 values.

## Task 5 — Contacts, arrival, capture, forward
What it is / what it means: Core combat flow outside SP04 (R6, R3 phases 6 and 8, Decision 10).
What changes at a high level: exported `exchange(state, chA, seqA, chB, seqB)` (CMB-05, simultaneous, max 2 rounds, `Clash`/`TroopDied`); head-on pass in pair order; arrival ordering (overshoot desc, channel key, FIFO) with per-arrival ownership re-evaluation; reinforce/hit/neutral rules; capture flips owner, cuts outgoing lines, kills all troops from the source, resets growth; surplus forward via one `fwd.below(lines)` draw only when `lines >= 1` and `alive < cap`.
Done when: `covers` tests for CMB-01/02/03/05, CAP, CPT pass, including captured-source cancelled arrivals and soldier/tank exchanges.

## Task 6 — Win, read API, event emission
What it is / what it means: Match end plus the surface SP06 and SP08 code against (R6 win, R7, Decision 6).
What changes at a high level: `win.ts` evaluating win, then loss, then timeout after phase 8 (ignored buildings flip on win; `timeLimitTicks=0` means none); `view`, `sim.readTroops` (constant `speed`), `freeSlots`, `units`, `canDraw`; all R7 events emitted without altering state.
Done when: `covers` WIN tests pass; events on/off hash parity holds; view/read tests cover every R7 field listed.

## Task 7 — Oracle, property and determinism suites
What it is / what it means: Independent proof that the integer rules match the spec (R8, acceptance criteria).
What changes at a high level: BigInt oracles for both period functions incl. E-examples (18461/24000/20869 mt) and clamp; brute-force departure-tick oracle; fast-check invariant suite; 50-seed determinism; content test that all `units.*.speed` are equal; remove stale v1 `covers` tags.
Done when: every SP03-owned R-id has a non-skipped `covers` test and no stale v1 tag remains.

## Task 8 — Goldens, bench, un-park gates
What it is / what it means: Regenerated 2.0.0 baselines and perf proof, then closing this SP's red window (R8, 09 red-window plan "SP03 done").
What changes at a high level: Rewrite `scenarios.ts` (spawn table, growth 64600/45560 mt, capture, kill-on-capture, exchanges, replace, overflow forward, cap skip, win/loss/timeout, rejections) via `compileLevel` inline JSON; runner takes a scenario-list array; regenerate baseline with `VERSION_GUARD_BASE` set to the merge-base; rewrite bench (720-troop stress and 12-building realistic) at budgets 0.3/1/0.5 ms. Restore the sim browser-parity golden (Chromium run of the same scenarios, deleted at CUT; 02 review 2026-10-22 G). Delete this SP's PARKED entries: `sim:golden`, `bench:sim`, `replay:verify`, `test:sim:golden`, `test:tools:replay` (09 adapts `tools/src/replay.ts` in the same window, sim goldens only until SP06).
Done when: `pnpm sim:golden`, `bench:sim`, `replay:verify` green in `pnpm run ci`; `check:parked` lists none of these.

## Owner steps
None.
