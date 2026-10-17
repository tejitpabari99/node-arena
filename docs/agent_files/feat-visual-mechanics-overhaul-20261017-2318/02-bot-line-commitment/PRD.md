---
status: approved
summary: Bot line commitment — min line lifetime, cut-vs-keep margin, redraw block, near-tie hysteresis as profile params; churn metric tool; goldens regenerated; balance bands held
date: 2026-10-17
---
# PRD: Bot Line Commitment (SP02)

Repo/branch: node-arena · feat/visual-mechanics-overhaul · Depends on: none
Owns: `packages/bots/src/{utility,considerations,version}.ts`, `packages/bots/scripts/churn.mjs` (new), `packages/bots/test/**` (+ golden), `packages/bots/benchmark-evidence.json`, `packages/bots/README.md` (commitment section), `packages/content/src/bot-params.ts` + generated `schemas/bot.schema.json`, `packages/content/data/bots/*.json` (base profiles only), content lock/version files, `tools/balance-targets.json` only if explicitly justified (default: untouched). Does not own: sim, `docs/GAME_RULES.md`, level layouts, web.

## TL;DR
- Bots re-score every own line as a "cut" candidate each decision, with no memory of line age and no keep-vs-cut comparison; seeded noise then flips near-ties. Result: draw, cut, redraw loops.
- Add 4 profile params (min lifetime, cut margin, redraw block, tie hysteresis) enforced in the bot only; sim and rules unchanged.
- Add a headless churn metric (20 levels × fixed seeds); record v1 baseline first; require ≥80% fewer cut-then-redraw and materially fewer cuts/min, with balance bands intact.

## Problem
Players see the computer "keep changing the nodes". Diagnosis [verified: code read]:
| # | Cause | Evidence |
|---|---|---|
| C1 | Every decision enumerates a cut candidate for every own line, scored independently | `utility.ts` loop `for l of lines: add(2, …)`; selection picks any candidate `> holdThreshold` |
| C2 | No keep score, no margin: a cut only needs absolute score > `holdThreshold` (0.25–0.4 base) | `utility.ts` `scores[i] <= threshold`; no line-age state anywhere |
| C3 | Noise is uniform ±`skill.noise` (0.1–0.2 base, up to 0.35 on easy variants) added to every score, including cut and near-tie draws | `considerations.ts` `score()` end |
| C4 | Cut→redraw guard is weak: `stickiness` is only a consideration (zero effect unless a profile weights it), and returns 1000 (no penalty) when the *same* kind repeats; `cooldownSec` is only that input | `considerations.ts` `case 'stickiness'` |
| C5 | Cut benefits from source "danger" (`threatToSource` cut = `dangers[from]`), so a transient hostile surge flips lines; a later draw to the same pair is a fresh candidate | `considerations.ts` `consideration()` |
| C6 | Short intervals amplify it (0.5 s reference … 2.4 s rusher; variants 0.8–3.5 s) | `data/bots/*.json` |
Variant profiles (`*-easy/normal/hard/expert`) may only set `skill` and `extends` [verified: `bot-params.ts` `then` clause], so new params go in base profiles and inherit.

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Visibly stable lines: no flip-flop in a watched L10 match | Changing sim/rules/`GAME_RULES.md` |
| Cut-then-redraw (same pair, ≤10 s) ≥80% below v1 baseline | Making bots stronger/weaker as a goal (hold the bands) |
| Total cuts/min materially lower (target ≥40% below baseline) | New bot archetypes, new considerations beyond commitment |
| Params are data (schema + profiles), tunable per base profile | Level/balance edits; retuning `balance-targets.json` bands |

## Requirements
Defaults below are starting points; the iteration loop tunes them.
- R1 `minLineLifetimeSec` (default 8): a bot-owned line younger than this is not a cut candidate, unless R1b.
- R1b Danger override: source tower `dangers[from]` ≥ `dangerOverride` (default 700/1000, existing `calculateDanger`) → the lifetime lock lifts for cuts from that source only. Rationale: reuses existing consideration; no new signal.
- R2 `cutMargin` (default 0.15): cut allowed only if `cutScore − keepScore ≥ margin`. `keepScore` = score of the line's best retained use, defined as the same scorer evaluated for `attack`/`reinforce` on that pair (the line's own purpose), so a line the bot would redraw is never cut.
- R3 `redrawBlockSec` (default 10): after the bot cuts a pair, DrawLine on that unordered pair is not a candidate for this duration (applies regardless of `stickiness` weight; fixes C4). Source-in-danger does not lift it.
- R4 `tieHysteresis` (default 0.05): when the top candidate beats the best *already-existing-line-consistent* option by less than this, noise is not applied for the cut decision (cuts use noise-free scores; draws keep noise). Keeps variety for attacks while removing noise-driven cuts.
- R5 Line age is bot-local: first-seen tick per `(from,to,drawSeq)` from `view.lines`, plus `record()`; no sim API change (`LineView` has `drawSeq`, no tick) [verified: `sim/src/read.ts`]. State is reset per match; arrays pre-allocated (package's no-allocation-in-decide rule).
- R6 Determinism: no extra RNG draws in the no-commitment path; RNG consumption order documented since goldens shift.
- R7 Schema: add optional fields to `BotParamsSchema` (`commitment: { minLineLifetimeSec, dangerOverride, cutMargin, redrawBlockSec, tieHysteresis }`, `x-unit: fx3`), forbidden on `extends` variants; `pnpm content:schemas`, `pnpm content:lock`, bump `BOT_VERSION` (1.0.7→1.1.0) and content version per AGENTS.md; `check:content --base` must pass.
- R8 Profiles without `commitment` behave exactly as v1 (so `idle`, `human-proxy` assumptions are explicit: human-proxy gets commitment too, since it models a human; reference gets a milder setting).
- R9 Churn tool `packages/bots/scripts/churn.mjs` (`pnpm bots:churn [--seeds N] [--levels …] [--out file]`): runs `runMatch` for all 20 levels × fixed seed set (default 8 seeds, listed in the script), counts from the command stream per bot seat: cuts, draws, cut-then-redraw same pair ≤10 s, line-flips (draw/cut/draw on one pair ≤20 s), normalised per minute of match time; prints per-bot and per-level table + JSON. Baseline saved as `packages/bots/churn-baseline-v1.json` (committed, from unmodified code) before any behavioural change.
- R10 Regenerate deliberately: `pnpm bots:golden --update`, `pnpm bench:bots` → `benchmark-evidence.json`, any `sim:golden`/replay goldens containing bot commands (`replay:verify golden`); commit message explains why each changed.
- R11 Rules check: grep `GAME_RULES.md` for bot-behaviour text [verified: only mentions "bots submit identical commands", E-LINES/E-CUT are sim rules] → no change; record result in log.

## Architecture
```
profile.params.commitment ──► createUtilityBot()
   per decide(): ageOf(line) ← firstSeen[from,to,drawSeq]
   cut candidates: skip if age<minLife && dangers[from]<dangerOverride
                   skip unless cutScore(noise-free) − keepScore ≥ cutMargin
   draw candidates: skip if now < cutTick[pair] + redrawBlock
```
Touchpoints: `utility.ts` (candidate filtering/selection), `considerations.ts` (expose `keepScore(from,to)` and noise-free `scoreCut`, `danger(tower)`, per-pair `cutTick`). Sim and driver cadence untouched.

## Iteration protocol
Non-visual loop (measure → log → change → re-measure; same metric and seed set).
1. Measure: `pnpm bots:churn` on the frozen seed set (8 seeds × 20 levels; seeds list is fixed in the script and never changed) vs `churn-baseline-v1.json`; then `pnpm balance` and `pnpm validate:levels`.
2. Log: append a row to `docs/agent_files/feat-visual-mechanics-overhaul-20261017-2318/02-bot-line-commitment/iteration-log.md`: iter #, date, commit, params, cuts/min, draws/min, cut-redraw/min and % vs baseline, flips/min, balance win rates per band, validate:levels pass/fail, top gaps, planned change.
3. Change: tune only the 1–2 params most implicated; order of levers: `minLineLifetimeSec` → `cutMargin` → `redrawBlockSec` → `tieHysteresis` → `dangerOverride`.
4. Commit each improving iteration: `02-bot-line-commitment: Task N — iter k: <change>`; revert any iteration that worsens a target metric or breaks a band.
5. Exit: cut-redraw ≥80% lower, cuts/min ≥40% lower, `validate:levels` passes, every balance band in `tools/balance-targets.json` passes, tests green.
6. Drift rule: if a band fails, first lower `cutMargin`/`minLineLifetimeSec` for the affected base profile only; never edit bands.
7. Stuck rule: 3 consecutive iterations without improvement → log hypotheses tried, switch approach (e.g. per-profile values, danger definition, keepScore definition). Hard cap 12 iterations per task → mark task `Blocked` with log and continue.
8. Never edit `balance-targets.json`, never delete tests to pass.
9. Optional visual sanity (non-gating, last): run web at 2× on L10, watch ~2 min, log "no visible flip-flop" or a gap in the iteration log. Playwright/browser is run by the executing environment, not asserted by the PRD.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Where to enforce | Bot-side candidate filtering | New sim cut cooldown | Rules/replays unchanged; bots aren't rules |
| D2 | Line age source | Bot-local first-seen tick | Add tick to `LineView` | No sim API/golden churn |
| D3 | Danger definition | Existing `calculateDanger` ≥ 700 | New threat model | Reuses vetted signal |
| D4 | Param location | `commitment` block on base profiles; variants inherit | Add to `skill` | Variants may only set `skill`; keeps difficulty knobs independent |
| D5 | Noise | Noise-free scores for cuts; hysteresis on near-ties | Lower all noise | Keeps attack variety / difficulty feel |
| D6 | Baseline | Commit v1 churn JSON before changes | Compare in-memory | Reproducible targets |
| D7 | Redraw block vs danger | Block always holds | Lift on danger | Redraw loop is the exact complaint |

## Risks / Open Questions
- [RESOLVED: lifetime lock may slow adaptation and cost win rate -> drift rule step 6; expert variants share base params so only base values are tuned]
- [RESOLVED: `keepScore` ambiguity -> best of attack/reinforce score on same pair, noise-free]
- [RESOLVED: bots built on removed lines (replaced by opponent) -> age map entry dropped when line absent]
- [RESOLVED: golden/bench churn is expected; explained in commit message]
- [DEFERRED] Applying commitment to human-proxy only vs all: default all base profiles; revisit if balance human-proxy bands fail.

## Acceptance Criteria
- `packages/bots/churn-baseline-v1.json` exists, produced from pre-change code, committed first.
- `pnpm bots:churn` reports per-bot/minute cuts, draws, cut-then-redraw ≤10 s, flips; cut-then-redraw ≥80% below baseline; cuts/min ≥40% below.
- `pnpm validate:levels` passes; `pnpm balance` passes all bands in unmodified `tools/balance-targets.json`.
- Schema + generated schema + content lock updated; `pnpm check:schemas`, `check:content`, `validate:content`, `typecheck`, `lint` and `pnpm test` (bots, content, tools) green; `BOT_VERSION` bumped.
- `bots:golden`, `benchmark-evidence.json`, bot-dependent sim/replay goldens regenerated with rationale in commit; `pnpm replay:verify golden` passes.
- `docs/GAME_RULES.md` diff is empty; sim package diff empty.
- `iteration-log.md` exists with baseline row and final row; optional L10 observation logged.
