---
status: draft
summary: 14 tasks — packages/bots (types, utility engine, driver, harness, profiles, tests, bench/golden) and tools/ CLIs (validate:content, check:manifest, check:rules, replay:verify, validate:levels, balance) with CI wiring
date: 2026-10-08
---
# Tasks: Bots + Tools (SP04)
Source of truth: docs/agent_files/feat-game-design-20261006-0617/04-bots-and-tools/PRD.md. Data-driven utility-AI bots outside the sim, plus one CLI per content/quality gate. No open items; resolved items are folded in (per-band pass rule: bands 1-3 win all K seeds, band 4 wins >= K-1 or an agent-authored scripted solution replay replayed via `runMatch` in CI; no owner-recorded replays, no web replay export). Deferred items (clashPotential, v6 pruning, MCTS, balance tuning) get no tasks.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | `packages/bots` scaffold + bot types + no-cheat context | SP01, SP02 | todo |
| 2 | Bot-params schema (contributed into content) | SP01 | todo |
| 3 | Utility engine: considerations, scoring, noise | T1, T2, SP02 | todo |
| 4 | Bot driver (`createBotDriver`) | T3 | todo |
| 5 | Bot profiles data (personalities, tiers, tooling, idle) | T2 | todo |
| 6 | Headless harness `runMatch` | T4, SP02 | todo |
| 7 | Bot test suite | T3, T4, T5, T6 | todo |
| 8 | `bench:bots`, `bots:golden`, `BOT_VERSION` | T5, T6, T7 | todo |
| 9 | `tools/` scaffold + `validate:content` + `check:manifest` | SP01, SP03 | todo |
| 10 | `check:rules` + `replay:verify` | SP01, SP02 | todo |
| 11 | `validate:levels` (per-band rule) | T5, T6, T10, SP05 | todo |
| 12 | `balance` runner + balance-targets schema | T5, T6 | todo |
| 13 | Tools fixture tests | T9, T10, T11, T12 | todo |
| 14 | CI: `pnpm ci` chain + GitHub Actions + nightly balance | T8, T9–T13 | todo |

## Task 1 — `packages/bots` scaffold + bot types + no-cheat context
What it is / what it means: Bots live outside the sim and see only what the player sees (Req 1, 2; Decisions 1, 2).
What changes at a high level: Pure-TS package (ES2022, no DOM/Node types in core) importing only SP02 public exports and SP01 types; shared SP02 determinism lint config (no `Math.random`/`sqrt`, `Date`, float literals). Define `BotContext` (`view`, `canDraw`, `readTroops` only) and `Bot`. Provide a context guard that throws on any other property access, used by tests.
Done when: package builds and lints; a deliberate banned-API use fails lint; accessing a property outside the three allowed throws.

## Task 2 — Bot-params schema (contributed into content)
What it is / what it means: The inner `params` shape for the SP01 bot envelope; lives in the content package to avoid a dependency cycle (Decision 9; Req 4).
What changes at a high level: Fill SP01's placeholder `bot-params.ts` (and the generated bot schema): `skill`, `bias`, `holdThreshold`, `maxTargetsPerSource`, `cooldownSec`, `componentValue`, `weights`, `extends`. Decimals ≤3 places tagged `fx3`; unknown consideration/component/field is an error; weight bound 10,000 milli and sum-below-2^31 bound; `extends` may override only `skill`.
Done when: valid profile passes; unknown field, over-bound weight and non-`skill` override on an extending profile are rejected with located errors.

## Task 3 — Utility engine: considerations, scoring, noise
What it is / what it means: The decision core (Utility AI section; Decisions 5, 6, 4; Reqs 3, 4, 6).
What changes at a high level: Consideration registry (`targetValue`, `timeToTake`, `distance`, `threatToSource`, `threatToTarget`, `targetWeakness`, `ownerDominance`, `sliceCost`, `lineUseless`, `stickiness`), each 0..1000 from view only; component extractors (`generates`, `garrison`) so `targetValue` stays component-generic. Candidate enumeration for attack/reinforce/cut/hold with `maxTargetsPerSource` pruning; int32 weighted-sum scoring times action bias; sfc32 noise; deterministic tie-break (score, source idx, target idx); top-N pick re-validated with `canDraw` and used-slot tracking. Typed arrays, no allocation in the scoring loop. Startup registry-parity assertion.
Done when: engine returns only commands `canDraw` accepts (or cuts of own lines) for a hand-built view; considerations stay in [0,1000].

## Task 4 — Bot driver (`createBotDriver`)
What it is / what it means: The SP03/SP02-facing contract (Bot interface and driver section; Decision 8, 3).
What changes at a high level: `createBotDriver(level, matchSeed)` builds one Bot per `level.bots` entry; `commands(sim)` is called once per tick before `step`. Decision ticks `tick % intervalTicks == phase` (interval from `decisionIntervalSec` and `TICK_RATE`, min 1; phase from the seeded rng). Bot rng = sfc32 seeded from `mix(matchSeed, playerIndex, fnv32(profile.id))`, independent of the sim PRNG. `kind:"idle"` returns `[]`. Worker/server-safe, no events used.
Done when: SP03 can run a level with bots using only this plus the SP02 API; same inputs yield identical commands.

## Task 5 — Bot profiles data (personalities, tiers, tooling, idle)
What it is / what it means: Behaviour is 100% data (Requirements 4; Decision 7, 10; Bot profile section).
What changes at a high level: Author `rusher`, `turtle`, `economist`, `opportunist` under `packages/content/data/bots/`; tooling profiles `reference` (noise 0, 0.5 s, strong) and `human-proxy` (extends `reference`, slower/noisier `skill` only); `idle` (legal in levels). Generate and commit the 16 `<personality>-<tier>` three-line `extends` files with tier skills easy 3.5s/0.35/1, normal 2.2s/0.2/1, hard 1.4s/0.1/2, expert 0.8s/0.03/2. Numbers are starting guesses; SP05 tunes.
Done when: all 24 profiles validate and compile via SP01; `reference`/`human-proxy` are rejected if a level references them.

## Task 6 — Headless harness `runMatch`
What it is / what it means: Shared headless runner for tools, tests and a later dev-panel (Headless harness bullet).
What changes at a high level: `runMatch({level, seed, controllers, maxTicks, record}) → {outcome, ticks, replay, stats}` in `packages/bots/harness`; proxy controllers are Bots bound to the human seat; runs `events:false`, reads `sim.rejected`, records bot commands as ordinary commands via the SP02 recorder. Supports replaying a scripted command list as a controller (for band-4 solution replays).
Done when: a bot-vs-bot match terminates, produces a replay, and reports zero rejects.

## Task 7 — Bot test suite
What it is / what it means: Prove fairness and determinism (Tests table; Reqs 3, 5; Acceptance 2, 4).
What changes at a high level: Consideration unit tests incl. a `shoots` stub extractor with no edits elsewhere; scenario tests (takes undefended neutral, ignores safe own tower line, cuts after capture, reinforces threatened tower, holds idle, rusher attacks earlier than turtle); determinism (same seed identical log and hash, noise 0 seed-invariant, noise>0 seed-varying, Node vs Chromium); legality property test over random levels (zero rejects, no over-slot, terminates); no-cheat via the context guard; tier change alters only `skill`; bot replay verifies with no bot present.
Done when: suite passes in CI.

## Task 8 — `bench:bots`, `bots:golden`, `BOT_VERSION`
What it is / what it means: Perf budget and regression goldens (Req 6; Replay strategy; Tests Golden/Perf).
What changes at a high level: `bench:bots` at 50 towers / 2,000 troops, p99 < 1 ms per decision, CI fails at 5x. `bots:golden [--update]` recomputes 3 fixed (level, seed) pairs against committed command logs and replays. `BOT_VERSION` constant; goldens regenerate only on bump; integrate with SP01 `botHash` lock.
Done when: bench within budget; golden diff passes and fails on a deliberate scoring change.

## Task 9 — `tools/` scaffold + `validate:content` + `check:manifest`
What it is / what it means: Content gates (tools table; Decision 11, 12 context).
What changes at a high level: `tools/` TS workspace (`tsx`), shared exit-non-zero and Markdown plus JSON output helpers (Req 7). `validate:content` wraps SP01 `validateContent` and the `hashes.lock.json` (`simHash`, `botHash`) and versions check. `check:manifest` calls `validateContent(fileMap,{manifest})` then SP03's `validateManifest()`; this repo owns the CLI only, SP03 owns the manifest file.
Done when: both pass on the repo and fail on a missing visual key or stale lock.

## Task 10 — `check:rules` + `replay:verify`
What it is / what it means: Rule-coverage and replay gates (tools table; Acceptance 4, 7).
What changes at a high level: `check:rules` regex-extracts `R-[A-Z]+-\d+` headings from GAME_RULES.md (tombstones exempt) and `covers R-...` test-title tags across packages; fails on untested IDs and unknown tagged IDs. `replay:verify <file|dir>` uses SP02 `playReplay`: header check, checkpoints, final hash, prints first diverging tick; covers `golden/`.
Done when: both pass on the repo and fail on fixtures (untested ID, unknown tag, tampered replay).

## Task 11 — `validate:levels` (per-band rule)
What it is / what it means: Playability gate for 20 levels (tools table; resolved per-band rule, Decision 10).
What changes at a high level: `validate:levels [--levels id|all] [--seeds 4]`: runs validate:content, then per level the `reference` proxy vs the level's bots over K seeds. Band from `level.band`: bands 1-3 must win all K; band 4 must win >= K-1, or pass via committed `tools/solutions/<levelId>.replay.json`. Solution replays are agent-authored scripted command lists run through `runMatch` (no owner recording) and confirmed a win by `replay:verify`; any `simHash` change invalidates them. Also: idle proxy must win none, every run terminates, no `CommandRejected`/invariant throw, same seed twice gives the same final hash. Per-level report.
Done when: fixtures behave per Acceptance 5 (unwinnable fails; band-4 3/4 or valid solution passes; idle-winnable fails).

## Task 12 — `balance` runner + balance-targets schema
What it is / what it means: Statistical tuning tool, not a gate (tools table; Acceptance 6).
What changes at a high level: `balance --levels all --proxy reference,<profiles> --seeds N --jobs J --format md|json` producing a levels x proxy matrix (win rate, median seconds-to-win, timeout %, draw %, median towers), flags levels outside `tools/balance-targets.json`, lists levels using SP01 overrides; `--mode arena` rotates profiles across seats. Own the targets schema (`bands.<1-4>:{referenceWinMin, humanProxyWin:[min,max], timeoutMaxPct, idleWinMax}`); SP05 supplies values. Byte-reproducible: seeds 1..N, sorted rows, versions in header, no timestamps; `worker_threads` pool, results independent of job count.
Done when: md and json reports are byte-identical across `--jobs 1` and `2`.

## Task 13 — Tools fixture tests
What it is / what it means: Prove each gate fails when it should (Tests Tools row; Acceptance 3, 5, 7).
What changes at a high level: Fixtures: unwinnable level fails validate, winnable passes, band-4 3/4 and solution-replay cases, idle-winnable fails; `check:rules` missing/unknown ID; `check:manifest` missing key; extends-overriding-non-`skill` profile rejected; balance byte-identical across `--jobs`.
Done when: all fixtures behave as listed and run in CI.

## Task 14 — CI: `pnpm ci` chain + GitHub Actions + nightly balance
What it is / what it means: One chain, local and remote (Decision 12; CI bullet; Acceptance 8).
What changes at a high level: `pnpm ci` = lint, typecheck, test, `validate:content`, `check:manifest`, `check:rules`, `validate:levels --seeds 4`, `replay:verify golden`, `bench:sim`, `bench:bots`. `.github/workflows/ci.yml` on push/PR runs it (SP03's Playwright job stays separate). Manual/nightly workflow runs `balance` and uploads the report artifact (not a gate). Optional `pre-push` hook (not pre-commit).
Done when: the workflow and local chain run the full gate set green; balance workflow uploads an artifact.

## Manual steps (owner)
- Enable GitHub Actions on the repo once; no secrets needed.
