---
status: draft
summary: Data-driven utility-AI bots (profile JSON, integer scoring, seeded noise, same commands as player), packages/bots driver + headless harness, and tools/ CLI (validate:levels, balance runner, replay verify, rule-ID coverage, manifest check) with CI wiring
date: 2026-10-07
---
# PRD: Bots + Tools (SP04)

Repo/branch: node-arena · feat/game-design · Depends on: SP01 (content/validator/profile envelope), SP02 (sim API)
Owns: `packages/bots/**` (bot engine, consideration registry, driver, headless harness, tests, `bench:bots`), bot `params` schema (file `packages/content/src/bot-params.ts`, contributed into SP01's package), `packages/content/data/bots/*.json` (profiles), `tools/**` (CLIs, CI workflow). Does not own: sim, level data (SP05), web driver wiring and manifest file (SP03).

## TL;DR
- Bots live in `packages/bots`, outside sim. A bot sees exactly what the player sees (`view`, `readTroops`, `canDraw`) and emits the same `DrawLine`/`CutLine` commands. No events, no snapshot, no hidden state, no cheats.
- Behaviour is **100% profile data**: utility considerations (generic over components), weights, action biases, plus a `skill` block (decision interval, noise, actions per decision). New personality = new JSON file. Difficulty = `skill` only.
- **Integer/fixed-point scoring** (answers SP01 open item): authored decimals <=3 places, same loader, int32 after compile. Noise from a per-bot sfc32 seeded from the match seed.
- Replays record bot commands (SP02 recorder); playback never runs bots. Headless runs recompute bots deterministically.
- `tools/` gives one CLI per gate: `validate:levels`, `balance`, `replay:verify`, `check:rules`, `check:manifest`; GitHub Actions + local `pnpm ci` run them.

## Problem
Levels are only as good as their opponents. Bots must be fair (same rules as player), tunable by data alone (user requirement), reproducible (replays, balance matrix, v3 server), and cheap. Separately, content quality gates (playable, every rule tested, manifest keys real) need one tools package so SP05 can tune 20 levels without hand-playing each.

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Bot interface, driver cadence, determinism + replay strategy | Learning/MCTS bots, dynamic difficulty, easy/hard toggle |
| Utility-AI over generic component-derived considerations | Bot code for archer/tank (extension point only) |
| Bot-params schema + 4 personalities + reference + idle | Authoring the 20 levels or tuning numbers (SP05) |
| Tools CLIs, output formats, CI wiring | Web bot wiring, UI (SP03); sim golden tooling (SP02 owns `sim:golden`) |
| Test strategy + perf budget | Server hosting of bots (v3; designed worker/server-safe) |

## Requirements
1. `packages/bots` pure TS (ES2022, no DOM/Node types in core); imports only SP02's public exports and SP01 types; same lint bans as sim (`Math.random/sqrt/...`, `Date`, float literals).
2. No cheating by construction: `BotContext` exposes `view`, `canDraw`, `readTroops` only. The player sees all counts, lines and troops (no fog in v1), so bots see the same; bots never read PRNG, other bots' state, `snapshot`, or events.
3. Bots only emit commands `canDraw` accepts (or `CutLine` of own existing line): zero `CommandRejected` in any run is a test.
4. Every profile number is data; code holds no tunables except structural caps (`maxTargetsPerSource` is data too).
5. Determinism: output is a pure function of (profile, level, match seed, view history). Same inputs -> identical commands on Node/Chromium.
6. Budget: p99 decision < 1 ms at 50 towers / 2,000 troops; zero allocation in the scoring loop (typed arrays).
7. Tools exit non-zero on any gate failure; machine-readable JSON output beside human Markdown.

## Architecture

### Bot interface and driver
```ts
interface BotContext { view: SimView; canDraw: Sim['canDraw']; readTroops: Sim['readTroops'] }
interface Bot { readonly player: string; decide(ctx: BotContext, tick: number): Command[] }
createBotDriver(level: CompiledLevel, matchSeed: number): BotDriver   // one Bot per bot player
interface BotDriver { commands(sim: Sim): Command[] }                  // call once per tick BEFORE sim.step
```
- SP03 contract: each fixed tick, `sim.step([...playerCmds, ...driver.commands(sim)])`. Driver is a no-op between decision ticks, so calling every tick is free. Pause/2x need no bot logic (sim tick is the only clock; interval is in ticks).
- `createBotDriver` reads `level.bots` (SP01 compile: `[{player: dense index, profile: resolved}]`); `Bot.player` is the id string via `view.ids.players`. `tickRate` comes from SP02's `TICK_RATE` export.
- Decision ticks: `tick % intervalTicks == phase`, `phase = bot rng seed-derived` (bots do not all act on the same tick). `intervalTicks = floor(decisionIntervalSec_milli * tickRate / 1000)`, min 1.
- `kind:"idle"` -> bot returning `[]`. Runs on web main thread in v1; pure and worker/server-safe (v3 server can host the same driver).
- **Replay strategy (decided)**: bot commands are recorded as ordinary commands by SP02's recorder. Playback never instantiates bots, so replays survive bot code changes. Bot determinism is verified separately (see Tests); `BOT_VERSION` + `botHash` mark when committed bot goldens must regenerate.
- **Seeds**: bot rng = sfc32 seeded `mix(matchSeed, playerIndex, fnv32(profile.id))`; independent of sim's PRNG.

### Utility AI
Per decision, each bot: enumerate candidates -> score -> pick up to `actionsPerDecision` best above `holdThreshold` (re-validating with `canDraw` after each pick, tracking slots it just used) -> emit.

| Action | Candidate set | Command |
|---|---|---|
| `attack` | own source with a free slot x non-friendly target (neutral or hostile team), pruned to `maxTargetsPerSource` nearest | DrawLine |
| `reinforce` | own source with free slot x own target | DrawLine |
| `cut` | own existing line | CutLine |
| `hold` | single null action, fixed utility `holdThreshold` | none |

Note: stored stack is never sent (send = generation), so "force" means sustained flow. Considerations model flow, not stack.

Considerations (registry; each returns 0..1000 from view only; profile picks and weights them per action kind):
| Id | Meaning |
|---|---|
| `targetValue` | Component-derived worth of target: sum over target's components of `componentValue[comp] * extractor(comp)`; extractors registered per component (`generates` -> ratePerSec, `garrison` -> cap). v2 `shoots` = one extractor + data weight; no bot rewrite |
| `timeToTake` | est. seconds to capture at sustained flow (source generation share + already-incoming friendly lines vs target garrison + its generation) vs remaining time |
| `distance` | line length vs map extent (integer isqrt), shorter = faster effect |
| `threatToSource` | hostile inflow (lines + in-flight troops) vs source garrison; high = do not drain/overextend |
| `threatToTarget` | (reinforce) hostile inflow into target vs its garrison |
| `targetWeakness` | low garrison / recently clashed target (current count only) |
| `ownerDominance` | prefer hitting the leading opponent in multi-bot levels (towers share) |
| `sliceCost` | generation split cost: how many lines source already runs |
| `lineUseless` | (cut) line to a now-friendly tower, or to a target already overwhelmed by other flow |
| `stickiness` | penalty for reversing a pair acted on within `cooldownSec` (bot-local memory, ticks) |
Score = `bias[kind] * (sum w_i * c_i) / (sum w_i)` + noise; noise = rng uniform in `[-noise, +noise]` (milli of score range). Ties: score desc, source idx, target idx (no rng). All int32: weights <= 10,000 (milli), c <= 1000, sums < 2^31 (validator bound).

### Bot profile (SP01 envelope; this is `params`)
```json
{ "$schema":"../../schemas/bot.schema.json", "id":"rusher-easy", "kind":"utility",
  "params":{ "extends":"rusher", "skill":{"decisionIntervalSec":3.0,"noise":0.35,"actionsPerDecision":1} } }
{ "id":"rusher", "kind":"utility", "params":{
  "skill":{"decisionIntervalSec":1.5,"noise":0.1,"actionsPerDecision":2},
  "bias":{"attack":1.0,"reinforce":0.4,"cut":0.5},
  "holdThreshold":0.30, "maxTargetsPerSource":6, "cooldownSec":4,
  "componentValue":{"generates":1.0,"garrison":0.3},
  "weights":{"attack":{"targetValue":3,"timeToTake":2,"distance":2,"targetWeakness":2,"threatToSource":1},
             "reinforce":{"threatToTarget":3,"targetValue":1}, "cut":{"lineUseless":3,"threatToSource":1}} } }
```
- Authored decimals <=3 places -> milli by SP01's loader (tag `fx3`); unknown consideration/component/field = validation error; consideration registry parity asserted at startup (like sim).
- `extends` depth 1 (SP01 pattern). **Semantic rule: a profile with `extends` may override only `skill`** -> difficulty variants cannot change personality. Tier profiles are therefore 3-line files.
- Floats vs fixed-point: **fixed-point**. Bot params do not touch sim state, but balance reproducibility and v3 server parity want identical decisions on all runtimes.
- Personalities v1: `rusher` (attack bias, short interval), `turtle` (reinforce/cut, high `threatToSource`), `economist` (heavy `targetValue`/generates), `opportunist` (`targetWeakness`, `ownerDominance`). Plus tooling profiles `reference` (strong, noise 0, interval 0.5 s, 2-3 actions; tooling-only: levels may not reference it) and `idle` (`kind:"idle"`, legal in levels, e.g. tutorial opponents).
- Starting difficulty bands -> skill tiers (tuned by SP05 via runner): band 1 `3.5s / noise 0.35 / 1 action`; band 2 `2.2s / 0.2 / 1`; band 3 `1.4s / 0.1 / 2`; band 4 `0.8s / 0.03 / 2`. Level picks `<personality>-<tier>` ids.

### tools/ (TS, `tsx`, workspace scripts)
| Script | Does |
|---|---|
| `validate:content` | SP01 `validateContent` for all data + hashes.lock (`simHash` and `botHash`; regenerate with SP01 `pnpm content:lock`) / versions check |
| `check:manifest` | **owned here** (CLI/CI); calls `validateContent(fileMap,{manifest})` so every visual key exists in SP03's `apps/web/assets/manifest.json` (schema from SP01), then SP03's `validateManifest()` for file existence, tri/texture budgets, CREDITS listing; SP03 owns manifest file + runtime fallback |
| `validate:levels [--levels id\|all] [--seeds 4]` | validate:content, then per level: reference proxy plays the human seat vs the level's bots, K seeds, must **win all K**; idle proxy must **not win any**; every run terminates, no `CommandRejected`, no invariant throw; one seed run twice -> same final hash. Reports per level |
| `balance --levels all --proxy reference,<profiles> --seeds 200 --jobs 2 --format md\|json` | win-rate matrix: levels x proxy profile; also median seconds-to-win, timeout %, draw %, median towers at end; flags levels outside `tools/balance-targets.json` band ranges (values authored by SP05); lists levels using SP01 overrides. `--mode arena` rotates profiles across all seats (profile-vs-profile). Runs `events:false` |
| `replay:verify <file\|dir>` | SP02 `playReplay`: header check, checkpoints, final hash; prints first diverging tick. Covers `golden/` replays |
| `check:rules` | regex-extract `R-[A-Z]+-\d+` headings from GAME_RULES.md (tombstones exempt) and `covers R-...` tags in test titles across packages; fails on untested IDs and on tags naming unknown IDs |
| `bots:golden [--update]` | recompute bots on 3 fixed (level, seed) pairs and diff against committed command logs |
| `pnpm ci` | lint, typecheck, test, `validate:content`, `check:manifest`, `check:rules`, `validate:levels --seeds 4`, `replay:verify golden`, `bench:sim`, `bench:bots` |

- Headless harness `runMatch({level, seed, controllers, maxTicks, record}) -> {outcome, ticks, replay, stats}` in `packages/bots/harness` (used by tools, tests, dev panel "simulate" later). Proxy controllers are just Bots bound to the human seat.
- Balance output is byte-reproducible: seeds `1..N`, sorted rows, header carries `rulesVersion/contentVersion/botHash/BOT_VERSION`, no timestamps. `--jobs` = `worker_threads` pool (default 2 per machine limits); results independent of job count.
- **CI**: `.github/workflows/ci.yml` on push/PR runs `pnpm ci` (+ separate Playwright job from SP03). Balance runner is not a gate (slow, statistical): manual/nightly workflow uploads the report artifact. Local: `pnpm ci` is the same chain; optional `pre-push` hook (not pre-commit; too slow).

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| 1 | Location | `packages/bots` | inside sim; inside web | Sim stays rules-only; server/tools/web all reuse |
| 2 | Info available | `view`+`readTroops`+`canDraw` (what player sees) | peek at snapshot/enemy plans; events too | Fairness; events absent in `events:false` runs |
| 3 | Replay | Record commands; bots only recomputed in tests/runs | Re-run bots in playback | Replays immune to bot changes; server-ready |
| 4 | Numerics | Fixed-point int scoring + sfc32 | floats | Cross-runtime identical decisions |
| 5 | Scoring | Weighted sum of 0..1000 considerations x action bias, additive noise, argmax | multiplicative/curves; softmax top-k | Easy to author/debug; noise is the single randomness knob |
| 6 | Genericity | Value derives from component extractors | hardcode "rate" and "cap" | v2 archer/tank = extractor + data |
| 7 | Difficulty | `skill` only; `extends` limited to `skill` | per-tier full profiles | Enforces brief; personalities cannot drift per tier |
| 8 | Cadence | Per-bot interval ticks + seeded phase | all bots same tick; every tick | Cheap; reads as human reaction time |
| 9 | Params schema file | SP04 contributes into content package | schema in bots (content would depend on bots) | Validator in content must know it; avoids cycle |
| 10 | Reference bot | Strong utility profile as human proxy | per-level scripted solutions | Zero authoring; scales to 20 levels (fallback in Risks) |
| 11 | Manifest check | Tools owns CLI | SP03 | Same CI home as other validators; SP03 owns data |
| 12 | CI | GitHub Actions + local `pnpm ci` | local-only hooks | Repo is on GitHub; local-only hosting is separate |

## Manual steps
- Enable Actions on the repo once; no secrets needed.

## Risks / Open Questions
- [OPEN] Can one generic `reference` utility bot win all 20 levels (esp. band 4 built for clever human play)? Fallback: committed `data/solutions/<level>.replay.json` accepted by `validate:levels` as alternative proof. Decide after SP05 greybox.
- [OPEN] `validate:levels` pass rule: all 4 seeds vs win-rate threshold; start strict, loosen if noise>0 reference flakes.
- [OPEN] Consideration set sufficiency: head-on clash exploitation and line-cut timing may need `clashPotential`. Add by data+registry after greybox playtest.
- [OPEN] Per-decision cost at v6 (>4 owners, >50 towers): `maxTargetsPerSource` pruning; re-bench.
- [OPEN] Balance bands (`balance-targets.json`) and tier values are guesses until SP05 playtests.
- [RESOLVED: SP01 accepted; `botHash` per profile in `hashes.lock.json`, outside `simHash`] bot hash.
- [RESOLVED: fixed-point, same loader] SP01 floats vs fixed-point item.
- [RESOLVED: lives in tools] manifest visual-key check.
- [DEFERRED] MCTS/lookahead hard-mode bot, dynamic difficulty, server-hosted bots (v3), v2 archer/tank considerations.

### Asks (status)
All SP01/SP02/SP03 asks below were ACCEPTED by the owning PRDs: SP01 hosts `bot-params.ts`/`bot.schema.json`, resolves profiles into `CompiledLevel.bots`, adds `botHash`, enforces `extends`-only-`skill`, `reference` non-referenceable, weight bounds, `validateContent(fileMap,{manifest})`; SP02 exports `idiv, mulDiv, isqrt, Sfc32, mixSeed, RejectReason, SimView, TICK_RATE`, shares `eslint.determinism.cjs`, and exposes `sim.rejected` for `events:false` runs; SP03 uses `createBotDriver` exactly as named here.
- SP01: (a) host `bot-params.ts` + schema `bot.schema.json`, (b) `compileLevel` resolves `botProfile` (extends, fx3->int) into `CompiledLevel.bots[{player, profile}]`, (c) `botHash` per profile in `hashes.lock.json`, excluded from `simHash`, (d) validator: `extends`-only-`skill`, `reference` not referenceable by levels, bounds on weights, `validateContent(fileMap,{manifest})`.
- SP02: (a) export `idiv`, `mulDiv`, `isqrt`, `Sfc32`, `mixSeed`, `RejectReason`, `SimView` types; (b) shared ESLint determinism config consumable by `packages/bots`; (c) `step(...,{events:false})` still maintains `sim.rejected` (cumulative count) so harness can assert zero rejects.
- SP03: call `driver.commands(sim)` each tick before `step`; never feed bots events.

## Tests
| Layer | What |
|---|---|
| Consideration units | each on hand-built tiny views; `[0,1000]` bounds; extractor fixture for `shoots` stub with no edits elsewhere |
| Scenario | takes undefended neutral; ignores line to own safe tower; cuts line after target captured; reinforces threatened tower; holds when nothing scores; rusher attacks earlier than turtle |
| Determinism | same seed twice -> identical command log + final hash; noise 0 -> seed-invariant; noise>0 -> seeds differ; Node vs Chromium identical |
| Legality | full-run property test over random levels: zero rejects, no over-slot, terminates |
| No-cheat | context proxy throws on any property outside the three allowed |
| Golden | 3 bot match replays + command logs (`bots:golden`), regenerated only with `BOT_VERSION` bump |
| Perf | `bench:bots`: 50 towers, 2,000 troops: p99 < 1 ms/decision; CI fails at 5x |
| Tools | fixtures: unwinnable level fails validate; winnable passes; balance report byte-identical across `--jobs 1/2`; `check:rules` fails on missing/unknown ID |

## Acceptance Criteria
1. `createBotDriver` + `Bot` types exported; SP03 can run a level with bots using only that and SP02 API.
2. Adding a profile `foo.json` (new weights) changes behaviour with zero code edits; changing a tier changes only `skill`.
3. All v1 profiles validate; `extends` override of non-`skill` fields is rejected by fixture.
4. Bot matches record to replays that `replay:verify` passes with no bot present; bot re-run reproduces command logs byte-identically.
5. `validate:levels` flags a fixture level the reference cannot win and one the idle proxy wins.
6. `balance` emits md + json matrix, reproducible across `--jobs`.
7. `check:rules` and `check:manifest` fail on fixtures (untested ID, missing visual key) and pass on repo.
8. GitHub Actions workflow and `pnpm ci` run the full gate chain; perf bench within budget.
