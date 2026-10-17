---
status: approved
summary: HUD matching the Tower War refs as closely as possible (level pill + strength bar, round buttons, first-level tip), palette restyle of menu/picker/results/pause, L1 slice gate, 20-level rollout, L18 60 fps pass, deliberate baseline refresh, and the single final-review package
date: 2026-10-17
---
# PRD: SP05 — HUD, Rollout, Perf, Final Review
Repo/branch: node-arena · `feat/visual-mechanics-overhaul` · Depends on: SP03, SP04 (phase 4; SP01 tooling, SP02 churn numbers)
Owns: `apps/web/src/ui/{App.tsx,style.css}` (+ new `ui/Hud.tsx`, `ui/strength.ts` if split), `apps/web/src/save/index.ts` (one setting), `apps/web/visual/scenes.json` (add `--all-levels` mode, `l01-tip`, `pause`, `results` frames: SP01 provides none of these), append-only HUD metrics H01–H07 in `apps/web/visual/thresholds.json` + CHECKLIST.md Appendix B (never edits existing rows), `apps/web/e2e/*` baselines/specs touching HUD/menu, `apps/web/e2e/acceptance.spec.ts-snapshots/**`, `README.md`, `docs/CREDITS.md` (check), `<BF>/05-hud-rollout-perf/{iteration-log.md,rollout-log.md,perf-log.md}`, `<BF>/final-review.md`, `<BF>/final/**`. Per-level render-param fixes touch only manifest/theme/scatter params (SP03/SP04 files, params only).
Contract with SP04 (verified against its PRD): troop LOD is `createTroopRenderer({lod:'auto'|'high'|'low'})`; auto switches to low at **> 600 live troops or frame-time EMA > 20 ms for 1 s** (back to high at < 400 and < 14 ms for 3 s); thresholds are exported constants (`LOD_LOW_COUNT=600`, `LOD_HIGH_COUNT=400`, `LOD_LOW_EMA_MS=20`, `LOD_HIGH_EMA_MS=14`) with an optional manifest/quality override that SP05 may lower. SP04 keeps probe lane/troop/clash fields non-null (SP01 contract).

## TL;DR
- Replace dark top panel + bottom help bar with: top-centre level pill containing a live team-strength bar; round pause (top-left) and 1×/2× (top-right) buttons; timer inside/under the pill; one-time dismissable tip.
- Menu, picker, results, pause: colour/radius/type restyle only, same markup/layout.
- Gate 1: L1 slice gate (all L1 checklist items ≥ 8, metrics pass). Gate 2: 20-level sweep. Gate 3: L18 60 fps on real GPU. Then baselines, `pnpm run ci`, `final-review.md`.

## Problem
[verified: App.tsx:117-141] HUD is a dark bar: level name, timer, `N×`, text "Pause", "Performance" buttons. [verified: App.tsx:200] persistent bottom `instructions` bar. [verified: references yt1/citytakeover_01/towerwar_09] target is a compact top-centre pill with a team-share bar and small round corner buttons. [verified: save/index.ts] `SaveSettings` is validated with exact keys under `v: 1`, so remembering the tip needs a deliberate, migrating change. [verified: scripts/ci.sh] CI runs lint/typecheck/unit/content/sim/bots checks but NOT Playwright; e2e baselines are `test:e2e` only. [verified: acceptance.spec.ts:84-165] 7 `toHaveScreenshot` baselines (capture, clash, glb-fixture, menu, picker, greybox, colorblind), `maxDiffPixelRatio .01`.

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| HUD matches pill + bar look; keyboard/a11y intact | Layout redesign of menu/picker/settings |
| L1 slice gate passed before rollout | Level layout/balance/sim/bot edits |
| All 20 levels pass reduced checklist via render params only | New SFX, themes, mobile |
| L18 ≥ 60 fps (1% low ≥ 45) on integrated GPU | Perf on SwiftShader (informational) |
| Baselines regenerated deliberately, logged | Deleting/weakening tests |
| One approval package | Per-task approvals |

## Requirements
**R1 Strength bar.** `strength(view)` pure fn: per team, troops = sum of tower garrison counts + troops in transit (all lines), neutrals excluded from the bar but shown as a grey neutral sliver only if neutral towers hold > 0 (default: omitted, bar is two-/N-team share of owned troops). Segments in team colours (colourblind palette respected + pattern/outline `aria` text), widths ease 250 ms (none under reducedMotion); zero total → equal split. Updated at HUD tick (≤ 10 Hz), not per frame. `role="meter"` with `aria-valuetext="Blue 62%, Red 38%"`.
**R2 HUD layout.** Top-centre pill: `Level N · Name` + bar beneath/inside; timer `m:ss` right of the name inside the pill (role=timer kept). Pause: round button top-left, `aria-label="Pause"`, Esc handler unchanged. Speed: round button top-right, shows `1×`/`2×`, `aria-label="Game speed"`, `aria-pressed` for 2×. Perf toggle moves into Settings (dev/perf only; `?perf` URL still works). Min 44 px hit targets, visible focus ring, `pointer-events:none` on the HUD container except controls so lane drawing near edges is never blocked. Remove `.hud` dark panel and `.instructions` bar. Brand header hidden during play (kept on menu).
**R3 First-level tip.** Dismissable card ("Drag from your tower to connect · swipe across a lane or right-click to cut · Esc to pause"), shown only when the loaded level is order 1 and `tipSeen` is false; auto-fades after first successful DrawLine or manual dismiss; sets `settings.tipSeen = true`. Save: add `tipSeen: boolean` to `SaveSettings`; v1 saves lacking the key load with `false` via the existing legacy/default path (no `v` bump); save spec updated. `role="status"`, focusable Dismiss.
**R4 Restyle.** Tokens in `:root` reuse SP03 palette (blue `#2E8BFF`, sand `#FFE1B3`, grass `#A3D419`), rounded 16–24 px panels, bold sans, white outlined headings like roof numbers, chunky buttons (blue primary). Menu over blurred/dim L1 scene is out of scope; flat sand/grass gradient background. Results screen keeps outcome `data-outcome` hooks. No DOM/aria/test-id renames.
**R5 Gates.** (a) Slice gate = all items scored, each on the scene its SP01 checklist row names (V09 on `l10cb`, V08 on `l10`/`l18`, V12 on `buildout`), ≥ 8: for `l01` (V01–V09 SP03, V10–V13/V16 SP04, V18–V19, V22, V23) and `menu`/`picker` ≥ 8 (V20–V21), all metrics M01–M12 pass at both viewports, `clash` scene V14/V15 ≥ 8 (SP04 owns but SP05 verifies). Failing item → attributed to owner SP area (per checklist "owner" column), fix via the smallest change in that area within SP05's budget, tagged `05-… fix(SP03|SP04):`.
**R6 Rollout.** Capture all 20 levels at 1920×1080 + 1366×768 (add `visual:capture --all-levels` generating scene entries from `content/levels` with capture tick 400 if SP01 lacks it). Reduced checklist per level (R-items): R1 camera fit (all towers inside with ≥ 2% margin, M08 9/9 rays), R2 no void (M07), R3 props/clutter not overlapping towers or lanes (probe: prop bbox vs tower footprint + lane corridor = 0 overlaps), R4 count/dot readability at level density (V07 ≥ 8 using roof glyph height ≥ 11 px at 1366), R5 lane overlap legibility (V16), R6 troop LOD sanity. Pass = each ≥ 8 (R1/R2/R3 binary-pass). Fix only via render params: per-level `visual` overrides in manifest theme (camera margin, scatter density/keep-out, prop exclusions), SP04 LOD constants. Level JSON layout/balance untouched (`check:content` simHash must not move).
**R7 Perf.** Measurement: `visual:capture --scene l18 --headed --gpu`, enabling perf HUD, 5 s warm-up then 30 s sample; record mean fps, 1% low (from frame-time array, add `frames[]` + p99 to `createPerfMetrics` snapshot), p95 ms, drawCalls, triangles, jsMs. Target: mean ≥ 58 (60 vsync), 1% low ≥ 45, drawCalls ≤ 100 (M13), jsMs p95 ≤ 8. Reference device: integrated GPU (Intel Iris Xe class); if the executor has only a discrete/software GPU, run with CPU throttle 4× + DPR 2 as proxy and log it; final-review flags "needs user spot-check on laptop". Tuning ladder (stop when met, one change per iteration): (1) pixel-ratio cap 1.5 → 1.25; (2) shadow map 2048 → 1024, prop shadows off on `med`; (3) merge/instance remaining static meshes; (4) SP04 troop LOD constants lowered (`LOD_LOW_COUNT` from 600, or `lod:'low'` forced on L18; L18 peak is only ~60–120 troops so the count trigger rarely fires); (5) roof-texture redraw throttle; (6) quality tier default `med` → auto-detect low on `<60 fps` for 3 s (setting stays user-overridable).
**R8 Tests/baselines.** Specs touching HUD (`app-flow`, `input`, `slice`, `boot`, `dev`, `towers` leftovers) updated to new selectors, never deleted. Snapshot specs SP03/SP04 marked `test.fixme(true, 'SP05 baseline refresh: …')` must be restored (grep `SP05 baseline refresh`; zero hits at exit); regenerate all 7 acceptance baselines with `playwright test acceptance --update-snapshots` only after gates 1–2 pass, one commit with log lines per baseline (old vs new composite viewed, reason "reskin"). `maxDiffPixelRatio` stays .01. `pnpm run ci` green (it excludes e2e; also run `pnpm --filter @node-arena/web test:e2e`).
**R9 Docs.** README: replace any v1 look description, add 3 final composite screenshots (`docs/img/` copies from `<BF>/final/`); `docs/CREDITS.md` completeness check: every GLB/texture in `apps/web/assets` has a source row (traceability only, not a gate) (`check:manifest` already guards manifest; grep-compare list); city-kit roads row removed by SP03.
**R10 Final review.** `<BF>/final-review.md` sections: how to run locally (`pnpm install && pnpm --filter @node-arena/web dev`, URL, `?perf`, levels 1/10/18, colourblind toggle); per-scene final composite links to `<BF>/final/<scene>-<viewport>.png` (committed copies; `visual-out` is git-ignored) + side-by-side ref composites; score table (all checklist items × scenes, iteration-0 vs final); metrics table (M01–M13 values vs thresholds); perf numbers (R7); bot churn before/after from SP02 `pnpm bots:churn` JSON; 20-level sweep table; Blocked-visual tasks (from every TASKS.md) with log links; known gaps; owner-only items; commit list. This is the only user approval point.

## Architecture
```
SimView ──▶ strength.ts (pure) ──▶ Hud.tsx (pill, meter, round buttons, tip) ─▶ AppController (pause/setSpeed unchanged)
save.settings.tipSeen ◀──────────── tip dismiss
visual:capture --all-levels ─▶ metrics.json ─▶ visual:check ─▶ rollout-log.md ─▶ per-level manifest overrides
l18 --headed --gpu ─▶ perf snapshot (mean, p1-low, p95, calls) ─▶ perf-log.md ─▶ tuning ladder
```
HUD is DOM over the canvas; no renderer changes. Strength computed from the same `SimView` the renderer reads (read-only).

## Iteration protocol
Visual loop, per task with a visual outcome:
1. Capture: `pnpm --filter @node-arena/web visual:capture [--scene <id>]` — deterministic (fixed seed, paused at fixed tick, 1920×1080 and 1366×768); PNGs + `metrics.json` to `apps/web/visual-out/` (git-ignored).
2. Compose: `pnpm --filter @node-arena/web visual:compose` → `visual-out/compare-<scene>.png` (current | reference).
3. Score: view each composite; score every task-relevant item of `<BF>/01-visual-qa-harness/CHECKLIST.md` 0-10 against the reference; read `metrics.json` against thresholds. **Scoring rigor (mandatory):** (a) before scoring any item >= 8, log >= 3 concrete observable differences vs the matched ref (proportion, hue, density, stripe/chevron count, etc.) in the iteration log; (b) run the objective pixel checks for the item per SP01 metrics (colour-histogram distance on matched crops, probe-independent pixel visibility) via `pnpm --filter @node-arena/web visual:score-sheet` (SP01 tooling) and log the numbers; (c) a blind second scorer sub-agent sees only the composite + the checklist (no log, no prior scores, no probe/metrics) and scores the same items; the item's score = min(first score, blind score).
4. Log: append to `<BF>/05-hud-rollout-perf/iteration-log.md`: iter #, date, commit, scores, metrics, top 3 gaps, planned change.
5. Change only the top 1–3 gaps, smallest change; run unit/e2e for the touched area.
6. Commit each improving iteration: `05-hud-rollout-perf: Task N — iter k: <change>`. Revert an iteration that lowers any score.
7. Exit: all task-relevant items ≥ 8 AND metrics pass AND tests green. Stuck: 3 iterations without improvement → log hypotheses, switch approach. Cap 12 iterations/task → `Blocked-visual` in TASKS.md with log; continue.
8. Never edit refs, lower thresholds, or delete tests. Baselines updated only here, per R8, with logged reason.
9. This sub-project compiles `final-review.md`.

SP05 specifics:
- **HUD/menu scenes**: `l01` (HUD, tip visible: capture a second frame `l01-tip` right after load; tip dismissed in `l10`), `l10`, `menu`, `picker`; add `pause` and `results` capture frames if SP01 lacks (harness may screenshot after `app.pause()` / fast-forward to result). References: HUD → `towerwar_yt1.jpg`, `citytakeover_01.jpg`, `towerwar_09.jpg`; menu → `towerwar_05.jpg`, `citytakeover_05.jpg`; picker → `citytakeover_06.jpg`; pause/results → `towerwar_08.jpg`. Items: V18, V19, V20, V21 (+ pause/results judged under V20). Added HUD metrics (probe/DOM, at both viewports): pill centre within ±2% of viewport centre x; pill top ≤ 4% of height; buttons ≥ 44 px, ≤ 64 px; HUD DOM area / viewport ≤ 12% (vs v1 bar); bottom help bar count 0; strength bar segment widths sum to bar width ±1 px and match `strength()` ±2%; contrast of pill text ≥ 4.5:1 (computed from tokens, unit test).
- **L1 slice gate loop**: capture `l01`,`clash`,`buildout`,`menu`,`picker` → score all owned+shared items → worst item first. Gate passes when R5(a) holds in one capture. Budget: ≤ 12 iterations per gate-failing item, ≤ 30 total for the gate; beyond that mark `Blocked-visual`, record in final-review, and roll out anyway (don't halt).
- **All-level sweep loop**: `visual:capture --all-levels`, `visual:check`, score reduced items per level, view composites in contact-sheet (4×5 grid, compose at thumbnail size) first, full-size only for failing levels. Each iteration batches fixes across levels by shared cause (e.g. one scatter keep-out change fixes many). Per-level cap 6 iterations; global cap 25 iterations. Log in `rollout-log.md` (level × R1–R6 matrix, fix applied). L10 and L18 get the full checklist, not reduced.
- **Perf (non-visual loop)**: measure (R7 protocol, same level L18, same seed, same sampling window) → log in `perf-log.md` → one ladder change → re-measure; tests green each step. Stuck: 3 steps with <3% fps gain → skip to next rung. Cap 12 measures; unmet → flag in final-review as `Perf-open` with numbers and the measured bottleneck (GPU vs JS). Visual regressions caused by perf changes re-score affected checklist items (must stay ≥ 8).
- **Final review compilation**: after all gates, one fresh capture of all scenes at both viewports from a clean build; copy to `<BF>/final/`; run `visual:check --strict`; fill tables from `metrics.json`/logs only (no hand-typed numbers); commit as `05-hud-rollout-perf: final review`.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Bar basis | Garrisons + in-transit troops, owned teams only | Tower count; total incl. neutral | Matches brief ("troop share"); neutrals don't compete |
| 2 | Tip persistence | `settings.tipSeen` via save, default migration, no `v` bump | localStorage side key; bump v2 | Uses existing save system; legacy path exists |
| 3 | Perf toggle | Moves to Settings + `?perf` | Keep in HUD | Clean HUD; dev feature |
| 4 | fps gate | mean ≥ 58, 1% low ≥ 45 on `--gpu` | strict 60 min | Vsync jitter; 1% low catches stutter |
| 5 | Rollout fixes | Render params only | Edit level layouts | Non-goal; sim hashes locked |
| 6 | Baselines | Regenerate once after gates, logged | Per task | Avoid churn; brief says SP05 |
| 7 | Gate failure | Fix in owner area, tagged | Bounce to SP03/04 | No human handoffs; autonomy |
| 8 | Final composites | Committed under `<BF>/final/` | Only visual-out | visual-out is git-ignored |

## Manual steps
- User approves `final-review.md` (only approval point); optionally spot-checks fps on their laptop if the executor lacked an integrated GPU.

## Risks / Open Questions
- [RESOLVED: DOM HUD with pointer-events none container] HUD overlapping drawing zone near top-centre.
- [RESOLVED: default migration] new save key breaking existing saves; unit test loads a key-less v1 blob.
- [RESOLVED: log proxy; flag for user spot-check] no integrated GPU on executor; headless SwiftShader fps is informational only (SP01 decision).
- [RESOLVED: the user confirmed the executing environment runs Playwright, browser captures and --update-snapshots; AGENTS.md permits it]
- [RESOLVED: reduced checklist + contact sheet] 20 × 2 viewports full scoring is too costly.
- [DEFERRED] Dense L18 may need small-tower dot hiding (SP03 fallback) — decided by sweep.
- [DEFERRED] Extra themes → `docs/FUTURES.md`.

## Acceptance Criteria
- No `.hud` dark panel or `.instructions` bar in DOM; level pill centred with `role="meter"` strength bar matching `strength()`; round Pause/speed buttons ≥ 44 px with aria-labels; Esc pauses.
- Tip appears once on L1 only; after dismiss/first line, reload does not show it; key-less old save loads.
- Menu, picker, pause, results restyled; selectors/aria unchanged; V18–V21 ≥ 8.
- Slice gate: L1 items ≥ 8, M01–M12 pass at 1920×1080 and 1366×768 (logged capture).
- `rollout-log.md` covers 20 levels with R1–R6 pass or documented `Blocked-visual`; `check:content` simHash unchanged.
- L18 perf-log shows mean ≥ 58, 1% low ≥ 45 (or `Perf-open` with numbers).
- No `test.fixme` remains; 7 acceptance baselines regenerated with logged reasons; `pnpm run ci` and `pnpm --filter @node-arena/web test:e2e` green.
- README and CREDITS.md current; `<BF>/final-review.md` and `<BF>/final/*.png` committed, containing all R10 sections.
