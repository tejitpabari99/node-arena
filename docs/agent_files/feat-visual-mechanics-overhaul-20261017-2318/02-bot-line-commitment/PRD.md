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
- Add 4 profile params (min lifetime, cut margin, redraw block, tie hysteresis) plus 2 slot-guard params enforced in the bot only; sim and rules unchanged.
- Churn the user sees also comes from the **sim's slot enforcement** (R-LIN-02 auto-cut of the newest line when garrison falls to a slot threshold), not only bot `CutLine`; the metric and the bot guard cover both.
- Add a headless churn metric (20 levels × fixed seeds); record v1 baseline first; require ≥80% fewer visible cut-then-redraw (any LineCut reason, incl. slot-cuts) and materially fewer cuts/min, with balance bands intact.

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
| C7 | Slot-cut churn with no bot cut command: a tower has 1 base slot + one per `drawsLines.extraSlotAbove` threshold strictly below its garrison (standard/large `[10,30]`, small `[10]`); at tick end the sim cuts the newest drawn line (`LineCut`, `reason:'slots'`) until lines fit. Sending troops lowers the garrison, so a bot garrison near 10 or 30 loses a line to slot enforcement, then redraws it = visible cut/redraw loop that bot-only counting misses | `sim/src/commands.ts:12,43` (`cutChannel` reason union `'player'\|'slots'\|'captured'\|'replaced'`), `docs/GAME_RULES.md` R-LIN-02 (~§159), `content/data/archetypes/{small,large,standard}.json` |
Verified for C7: `commands.ts` `cutChannel(..., reason)` emits `LineCut` with `reason:'slots'`; rules R-LIN-02 cuts the newest drawn line by greatest draw sequence; archetype `extraSlotAbove` is `[10,30]` (standard, large) or `[10]` (small). `docs/GAME_RULES.md` is intentionally not edited.
Variant profiles (`*-easy/normal/hard/expert`) may only set `skill` and `extends` [verified: `bot-params.ts` `then` clause], so new params go in base profiles and inherit.

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Visibly stable lines: no flip-flop in a watched L10 match | Changing sim/rules/`GAME_RULES.md` |
| Total visible cut-then-redraw (same pair, ≤10 s, **any LineCut reason**: player/slots/captured/replaced) ≥80% below v1 baseline | Making bots stronger/weaker as a goal (hold the bands) |
| Total cuts/min materially lower (target ≥40% below baseline) | New bot archetypes, new considerations beyond commitment |
| Params are data (schema + profiles), tunable per base profile | Level/balance edits; retuning `balance-targets.json` bands |

## Requirements
Defaults below are starting points; the iteration loop tunes them.
- R1 `minLineLifetimeSec` (default 8): a bot-owned line younger than this is not a cut candidate, unless R1b.
- R1b Danger override: source tower `dangers[from]` ≥ `dangerOverride` (default 700/1000, existing `calculateDanger`) → the lifetime lock lifts for cuts from that source only. Rationale: reuses existing consideration; no new signal.
- R2 `cutMargin` (default 0.15): cut allowed only if `cutScore − keepScore ≥ margin`. `keepScore` = score of the line's best retained use, defined as the same scorer evaluated for `attack`/`reinforce` on that pair (the line's own purpose), so a line the bot would redraw is never cut.
- R3 `redrawBlockSec` (default 10): after a pair is cut (by the bot's own `CutLine` **or by the sim's slot enforcement**), DrawLine on that unordered pair is not a candidate for this duration (applies regardless of `stickiness` weight; fixes C4, C7). Source-in-danger does not lift it. Slot-cut detection is bot-local: an own line present at the previous decision and absent now, with no own `CutLine` issued for it, the source still owned, and not replaced by an own reverse draw, is a slot-cut (or `captured` if the source changed owner: no block needed) and stamps `cutTick[pair]`; if the bot is handed `LineCut` events it uses `reason` directly.
- R4 `tieHysteresis` (default 0.05): when the top candidate beats the best *already-existing-line-consistent* option by less than this, noise is not applied for the cut decision (cuts use noise-free scores; draws keep noise). Keeps variety for attacks while removing noise-driven cuts.
- R5 Line age is bot-local: first-seen tick per `(from,to,drawSeq)` from `view.lines`, plus `record()`; no sim API change (`LineView` has `drawSeq`, no tick) [verified: `sim/src/read.ts`]. State is reset per match; arrays pre-allocated (package's no-allocation-in-decide rule).
- R6 Determinism: no extra RNG draws in the no-commitment path; RNG consumption order documented since goldens shift.
- R7 Schema: add optional fields to `BotParamsSchema` (`commitment: { minLineLifetimeSec, dangerOverride, cutMargin, redrawBlockSec, tieHysteresis, slotGuardMargin, slotPreemptMargin }`, `x-unit: fx3`), forbidden on `extends` variants; `pnpm content:schemas`, `pnpm content:lock`, bump `BOT_VERSION` (1.0.7→1.1.0) and content version per AGENTS.md; `check:content --base` must pass.
- R8 Profiles without `commitment` behave exactly as v1 (so `idle`, `human-proxy` assumptions are explicit: human-proxy gets commitment too, since it models a human; reference gets a milder setting).
- R9 Churn tool `packages/bots/scripts/churn.mjs` (`pnpm bots:churn [--seeds N] [--levels …] [--out file]`, available as both the package script and a root `package.json` script `bots:churn`): runs `runMatch` for all 20 levels × fixed seed set (default 8 seeds, listed in the script). From the command stream **and the sim `LineCut` events** (run with events enabled; if `runMatch` does not expose them, the tool steps the sim itself or reconstructs cuts from per-tick line views) it counts per bot seat: bot cuts, draws, **`LineCut` events by reason (player / slots / captured / replaced)**, **slot-cuts/min**, cut-then-redraw same pair ≤10 s **split by reason and in total (any reason)**, **visible line flips per pair regardless of cause** (line removed then redrawn, or draw/cut/draw, on one unordered pair ≤20 s), normalised per minute of match time; prints per-bot and per-level table + JSON. Baseline saved as `packages/bots/churn-baseline-v1.json` (committed, from unmodified code) before any behavioural change.
- R10 Regenerate deliberately: `pnpm bots:golden --update`, `pnpm bench:bots` → `benchmark-evidence.json`, any `sim:golden`/replay goldens containing bot commands (`replay:verify golden`); commit message explains why each changed.
- R12 Slot guard (`slotGuardMargin`, default 3 troops): the bot does not draw a new line that would occupy a slot gated by threshold `T` (the line index ≥ 1 maps to `extraSlotAbove[index-1]`; base slot has no threshold and is never at risk) when `garrison − T < slotGuardMargin` (garrison within the margin of losing that slot, using the garrison after already-planned departures). Uses the archetype's `extraSlotAbove` read via the tower view; no new sim API (if the view lacks it, expose via content tables the bot already loads).
- R13 Prefer deliberate cuts (`slotPreemptMargin`, default 1): when a tower is at slot capacity and `garrison − T ≤ slotPreemptMargin` for its top gated slot, the bot cuts its own lowest-`keepScore` line from that tower (bypassing `minLineLifetimeSec` and `cutMargin`, since the sim would cut the *newest* line regardless) instead of letting the sim cut the newest line; this stamps `cutTick[pair]` so R3 blocks the redraw. R12/R13 params live in the `commitment` block (R7) and default to the values above; setting both to 0 disables them.
- R11 Rules check: grep `GAME_RULES.md` for bot-behaviour text [verified: only mentions "bots submit identical commands", E-LINES/E-CUT are sim rules; R-LIN-02/E-SLOTS slot enforcement stays as is] → **no GAME_RULES edit**; record result in log.

## Architecture
```
profile.params.commitment ──► createUtilityBot()
   per decide(): ageOf(line) ← firstSeen[from,to,drawSeq]
   cut candidates: skip if age<minLife && dangers[from]<dangerOverride
                   skip unless cutScore(noise-free) − keepScore ≥ cutMargin
   draw candidates: skip if now < cutTick[pair] + redrawBlock   (cutTick set by own cut OR detected slot-cut)
                    skip if slot to use has garrison − T < slotGuardMargin
   slot preempt: garrison − T ≤ slotPreemptMargin at capacity → cut lowest-keepScore line (stamps cutTick)
```
Touchpoints: `utility.ts` (candidate filtering/selection), `considerations.ts` (expose `keepScore(from,to)` and noise-free `scoreCut`, `danger(tower)`, per-pair `cutTick`). Sim and driver cadence untouched.

## Iteration protocol
Non-visual loop (measure → log → change → re-measure; same metric and seed set).
1. Measure: `pnpm bots:churn` on the frozen seed set (8 seeds × 20 levels; seeds list is fixed in the script and never changed) vs `churn-baseline-v1.json`; then `pnpm balance` and `pnpm validate:levels`.
2. Log: append a row to `docs/agent_files/feat-visual-mechanics-overhaul-20261017-2318/02-bot-line-commitment/iteration-log.md`: iter #, date, commit, params, cuts/min, draws/min, cut-redraw/min and % vs baseline, flips/min, balance win rates per band, validate:levels pass/fail, top gaps, planned change.
3. Change: tune only the 1–2 params most implicated; order of levers: `minLineLifetimeSec` → `cutMargin` → `redrawBlockSec` → `tieHysteresis` → `dangerOverride`.
4. Commit each improving iteration: `02-bot-line-commitment: Task N — iter k: <change>`; revert any iteration that worsens a target metric or breaks a band.
5. Exit: **total visible cut-redraw (any reason) ≥80% lower**, bot cuts/min ≥40% lower, **slot-cuts/min reported with baseline and final (secondary target ≥60% lower)**, `validate:levels` passes, every balance band in `tools/balance-targets.json` passes, tests green.
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
| D8 | Tier-aware commitment scaling (owner-approved 2026-10-19) | Code change: scale `minLineLifetimeSec`/`redrawBlockSec` by `decisionIntervalSec` vs a fixed reference (variants still only set `skill`, D4 unchanged) | Schema change letting variants override `commitment` | Tried in Task 5 resume iters 11-14 and **not shipped**: shortening fast-tier windows breaks the churn targets (turtle-expert cliff) and does not fix 17h (needs ~no rusher-expert commitment, a 5-6x churn budget overrun). See iteration log |
| D9 | keepScore definition | Noise-free score of the line's own purpose (reinforce if target is own team, else attack) | max(attack, reinforce) | Task 5 iter 3: max() over-kept lines and broke bands |
| D10 | cutMargin | 0 on all base profiles; `tieHysteresis` is the only cut band | PRD default 0.15 | Task 5 iter 4: margin plus hysteresis double-banded and blocked needed cuts |
| D11 | Opportunist / turtle windows | Opportunist `redrawBlockSec` 0 + `slotGuardMargin` 2 (deviates from D7 "block always holds"; owner sign-off pending); turtle `minLineLifetimeSec` 6 (iter 7) | One shared set | Task 5 iter 6: opportunist bands; iter 7: turtle bands |
| D12 | Reference / human-proxy commitment | None (v1 path) - R8 deviation, owner sign-off pending | All base profiles carry commitment | Task 5 iter 4: human-proxy bands failed with commitment |

## Risks / Open Questions
- [RESOLVED: lifetime lock may slow adaptation and cost win rate -> drift rule step 6; expert variants share base params so only base values are tuned]
- [RESOLVED: `keepScore` ambiguity -> best of attack/reinforce score on same pair, noise-free — SUPERSEDED by D9 / D12 (Task 5)]
- [RESOLVED: bots built on removed lines (replaced by opponent) -> age map entry dropped when line absent]
- [RESOLVED: golden/bench churn is expected; explained in commit message]
- [DEFERRED] Applying commitment to human-proxy only vs all: default all base profiles; revisit if balance human-proxy bands fail. — SUPERSEDED by D9 / D12 (Task 5)

## Acceptance Criteria
- `packages/bots/churn-baseline-v1.json` exists, produced from pre-change code, committed first.
- `pnpm bots:churn` (package and root script) reports per-bot/minute cuts, draws, LineCut by reason, slot-cuts/min, cut-then-redraw ≤10 s (by reason and total), visible flips per pair; **total** cut-then-redraw (any reason) ≥80% below baseline; bot cuts/min ≥40% below.
- `pnpm validate:levels` passes; `pnpm balance` passes all bands in unmodified `tools/balance-targets.json`.
- Schema + generated schema + content lock updated; `pnpm check:schemas`, `check:content`, `validate:content`, `typecheck`, `lint` and `pnpm test` (bots, content, tools) green; `BOT_VERSION` bumped.
- `bots:golden`, `benchmark-evidence.json`, bot-dependent sim/replay goldens regenerated with rationale in commit; `pnpm replay:verify golden` passes.
- `docs/GAME_RULES.md` diff is empty; sim package diff empty.
- `iteration-log.md` exists with baseline row and final row; optional L10 observation logged.
