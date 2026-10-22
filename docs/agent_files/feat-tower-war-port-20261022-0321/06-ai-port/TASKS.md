---
status: draft
summary: 9 tasks to delete utility bots and ship the exact deterministic TW AI (default + scripts), tests, goldens, proxy spike, bench, plus the 09 follow-up that un-parks bots gates.
date: 2026-10-22
---
# Tasks: 06 AI port (Tower War bots)
Source of truth: [PRD.md](PRD.md). One bot kind `tw`, literal 20 Hz port of `DefaultBehavior` + scripted behaviours, driven by inline per-level params. Cross-SP deps: 03 (view, streams, commands), 05 (level `bot` blocks, tower order), 04 (`canDraw`), 02 (schema, `{player, bot}` entry, `buildingStatic.special`). Runs after 04 in program order.

| # | Task | Depends on | Status |
|---|---|---|---|
| 0 | Decomp timer-order pin | 03#1, 05#4 | todo |
| 1 | Delete utility bots; shell + `BOT_VERSION` 2.0.0 | 02#4, 03#1 | todo |
| 2 | Seat bot + default AI | 0, 1, 03#4, 04#3 | todo |
| 3 | Script interpreter | 2 | todo |
| 4 | Driver + `HUMAN_PROXY` export | 2, 3, 05#4 | todo |
| 5 | Unit + integration tests, lint test | 2, 3, 4 | todo |
| 6 | Goldens, bench, replay verify | 4, 5 | todo |
| 7 | Proxy solvability spike (levels 4-23) | 4, 05#4 | todo |
| 8 | Un-park bots gates and rewire tooling (with 09) | 6, 7 | todo |

## Task 0 — Decomp timer-order pin
What it is / what it means: Open Q1 resolved: implementer reads decomp first and pins tests to it. No ground truth otherwise (Risks).
What changes at a high level: Read `Game.Main.Player.{DelayBehavior,CreateWayBehavior}/UpdateBehavior.c` and `AiStepAction`; record exact check-vs-add order for delay, line, steps fire and capture poll (D4, R4). Findings feed test expectations in tasks 3 and 5. Doc note only, no source change.
Done when: A short pinned-order note exists in the branch docs folder and each R4 op has a stated first-check rule.

## Task 1 — Delete utility bots; shell + `BOT_VERSION` 2.0.0
What it is / what it means: Remove the v1 bot stack (D2, R1) so nothing dead remains; no coexistence.
What changes at a high level: Delete `utility.ts`, `considerations.ts`, utility/commitment/churn/corpus/context/progress-units/task8 tests, `churn.mjs`, churn baseline, benchmark evidence, `bots:churn` script. Reduce `index.ts` to `Bot`, `guardBotContext`, `BotContext = {view, canDraw}` (drop `readTroops`). Keep `harness.ts`. Bump `BOT_VERSION` to 2.0.0 (coordinate with CUT in 02/09 if already done). Bot JSON/schema removal belongs to 02.
Done when: No utility/consideration/commitment/churn code in `packages/bots`; package compiles against the 03 view; version is 2.0.0.

## Task 2 — Seat bot + default AI
What it is / what it means: Core of the port: `createSeatBot` and `decideDefault` (R2, R3, D3-D6, D8).
What changes at a high level: Add `seat.ts` (state, timer, queue, per-seat `streams.fork('bot.tw', seatIndex)`), `tw-ai.ts` (timer check then subtract with carry, free sources, all non-own towers sorted by weakest-first key with `special` from `buildingStatic.special` and index tie-break, random source via `below(n)`, `noLineBetween` over any owner either direction, `canDraw` check, `behavior` full vs attackOnly defense with nearest-own and index tie). Emits only `DrawLine`, never cuts; zero-tower seats freeze; no reaction handler.
Done when: A seat with fixed seed produces the expected decision sequence on a fixture level; no sim RNG touched; no `Math.random`/`Date`.

## Task 3 — Script interpreter
What it is / what it means: Event-sequenced openings for scripted levels (R4, R5).
What changes at a high level: Add `script.ts`: op queue run one at a time (`delay`, `line`, `steps` node tree with skip-if-lost, tick-quantized fire, capture poll every 20 ticks, parallel children same-tick), `scriptLine` with fallback, per-tick ledger of slots and pairs, hand-off to default with `timer = 0`. Honor null `own`/`target`; no RNG; no default logic while an op runs. Order semantics pinned by task 0.
Done when: Each op behaves per the R4 table on fixtures and the queue ends in default behavior.

## Task 4 — Driver + `HUMAN_PROXY` export
What it is / what it means: Wire the package to the sim and tools (R2, R6).
What changes at a high level: Rewrite `createBotDriver(level, matchSeed)` keeping name and signature (web re-export unchanged); one seat bot per `level.bots` entry `{player, bot}`; call every seat every tick before `sim.step`; no decisions after game over. Export `createSeatBot` and `HUMAN_PROXY = {kind:'tw', actionDelayMs:2000, behavior:'full', script:[]}`.
Done when: `apps/web` re-export and harness run a level end-to-end; same level and seed twice gives identical command logs.

## Task 5 — Unit + integration tests, lint test
What it is / what it means: R7 coverage with `covers`-style names; lint test per R1.
What changes at a high level: Rewrite `driver`, `harness`, `browser-parity` and `lint` tests for `tw`. Unit: timer carry (AD 1700 acts ticks 34/68/102), sort key incl. `special`, tie by index, source uniformity histogram, `noLineBetween` incl. reverse hostile line, defense nearest + tie, behavior parity, each script op, handoff. Integration: determinism, replay verify. Lint: no `CutLine`, `Math.random`, `Date`.
Done when: `pnpm test` and lint green for bots; all R7 items present.

## Task 6 — Goldens, bench, replay verify
What it is / what it means: Regression anchors and cost report (R6, AC3, AC6).
What changes at a high level: Rewrite `scripts/golden.mjs` and `test/golden/bots.json` for three campaign levels (pos 4 passive, pos 6 three AIs with delay+line, pos 11 nested `steps`), guarded by the BOT_VERSION-must-increase rule. Rewrite `scripts/bench.mjs` to report per-decision cost on the largest level.
Done when: Goldens committed; update without version bump is rejected; `replay:verify` ok on them; bench prints the cost.

## Task 7 — Proxy solvability spike (levels 4-23)
What it is / what it means: Resolved Q4: spike proxy win rate first; scripted openings checked (AC4, Risks).
What changes at a high level: Run TW-vs-TW on every level; confirm 0 rejected commands, termination, scripted levels (6, 11, 13, 15, 18, 20, 21, 22, prefab 10) show first scripted lines at expected ticks. Measure proxy wins over `AD` 500/1000/2000, full. Output a candidate unsolved list with reasons for the allowlist; owner signs off later.
Done when: Findings recorded; candidate `unsolved-by-proxy.json` entries and per-level win rates handed to task 8.

## Task 8 — Un-park bots gates and rewire tooling (with 09)
What it is / what it means: Same SP06 follow-up as 09's red-window table: bots gates leave `PARKED` and tools adopt R6 semantics. Spec is 06's, wiring/thresholds are 09's.
What changes at a high level: Remove `typecheck:bots`, `test:bots`, `bots:golden`, `bench:bots`, `validate:levels`, `balance` from `PARKED` in ci.sh. Rewire `validate:levels` to proxy checks (a)-(c) with unsolved allowlist warnings, `balance` to proxy AD 1000/2000/4000 + idle (report-only, `arena` all-`tw`), restore the parked tools files, update `tools/src/content.ts` BOT_VERSION gate. Append deferred items (resource piles dropped, reaction handler, boss/rocket/railway AI, `seatPower`, useless-attack) to `docs/FUTURES.md` without replacing earlier entries.
Done when: `pnpm run ci` bots-related gates green with `check:parked --strict` showing them removed; FUTURES entries present.

## Owner steps
None for 06 itself. Allowlist sign-off for `tools/unsolved-by-proxy.json` and level playtest are owner steps in 09 (owner pass).
