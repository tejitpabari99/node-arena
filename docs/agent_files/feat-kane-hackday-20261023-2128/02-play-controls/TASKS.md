---
status: done
summary: 9 tasks — widen speed, pure pairs model, gated Kane overlay shell, pair panel, tags, camera room, summary hook + auto-resume, text removal, e2e + gates.
date: 2026-10-24
---
# Tasks: 02 Play controls
Source of truth: [PRD.md](PRD.md). All Kane UI lives in `apps/web/src/kane/`, imported only inside the existing DEV/`VITE_TEST_HOOKS` gate; sim, rules, bots and content are untouched (no RULES_VERSION/BOT_VERSION change). Requires 01-kane-level landed first (campaign `kane`, `?kane=1`, na-kane building order frozen).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Speed type + driver tests | — | done |
| 2 | Pairs model (pure) | — | done |
| 3 | Kane overlay shell + gated wiring + speed button | 1, 01 | done |
| 4 | Pair panel, banner, result, game over | 2, 3 | done |
| 5 | Building tags | 3 | done |
| 6 | Camera room for panel | 3 | done |
| 7 | `__na.kane.summary()` + visibility auto-resume | 4, 5 | done |
| 8 | Remove original-game name | — | done |
| 9 | Kane panel e2e + final gates | 4–8 | done |

## Task 1 — Speed type + driver tests
What it is: slow speeds so a human and an audience can follow (R1, D1).
What changes at a high level: widen driver `Speed` to 0.25/0.5/1/2 (exported); `setSpeed` throws RangeError otherwise; `TestHookRequest.speed` parsed by exact match against the four values; harness re-applies an owned `currentSpeed` (updated by `api.setSpeed`) on every driver change so speed survives restart; default 0.25 when `request.kane` (add `request.kane` to the gate if 01 has not), `?speed=` wins. No new scheduler; the accumulator already handles fractions. Add driver tests: 50 ticks per 10 s wall at 0.25 for 16.67 ms frames, same count for different frame splits, invalid speed throws, mid-run change continuous, hash equal across speeds.
Done when: web unit tests pass; `sim:golden`, `replay:verify golden`, `bots:golden` unchanged.

## Task 2 — Pairs model (pure)
What it is: node-testable logic behind the panel (R2, R3 letters, D6, D7).
What changes at a high level: `kane/pairs.ts` with `derivePairs(view, canDraw, blocked)` returning groups per human source with `drawsLines`; per-level geometry precompute `computeBlocked` (all buildings treated as owned, once per level load, ordered pairs); labels per state table (ready/active/unavailable), target suffix on ready only, reason words (`no-slot` -> `no free route`, dashes to spaces), ready/active sort first, bijective base-26 letters from `view.ids.buildings` index. Pending-set and 700 ms cut-guard decision logic as pure functions.
Done when: unit tests cover labels, states, reason words, na-kane blocked list (A->B, A->D, B->A, C->D, C->E, D->A, D->C), blocked pairs stay hidden when a source has 0 free slots, letters AA after Z, pending/cut guard.

## Task 3 — Kane overlay shell + gated wiring + speed button
What it is: the mounting point and top-bar control (R1 button, D2, D3, D4; A1).
What changes at a high level: `app.kaneMode = campaignId==='kane'`; `App.tsx` gets one overlay slot; gated block in `main.tsx` dynamic-imports `kane/` and passes the overlay to `mountApp`, wraps `attachInput` so tag refresh rides `input.refresh()`. Overlay root `kane-overlay` with `data-speed`/`data-phase`, subscribes to `app.subscribeEvents` (per tick, signature diff, rAF coalesce). Speed button `kane-speed` (text `Speed 0.25x`) cycles via `api.setSpeed`. Kane CSS in `kane/kane.css`. Absent without `?kane=1` and on common levels.
Done when: button cycles speeds and tick rate scales; existing hud spec (2 HUD buttons on common) unchanged.

## Task 4 — Pair panel, banner, result, game over
What it is: one-click pair buttons Kane can click (R2, D5, D8, D10).
What changes at a high level: bottom panel `kane-panel` (container `pointer-events:none`, only buttons capture), groups side by side, 2-column wrap, fixed height `clamp(140px,22vh,220px)`, `overflow:auto` last resort. Click rules: ready -> `canDraw` then `submit(DrawLine)`, null return -> `Game paused`/`Game over` banner; active click no-op, dblclick cuts only if drawn >=700 ms ago; unavailable -> banner with reason sentence from `DRAW_REASON_TEXT`; pending set ignores repeat clicks until a later tick. `CommandRejected` for human -> banner. Banner `kane-banner` role=alert, sticky until next click or 12 s, `Game over` permanent. 400 ms press animation + ripple. On result: all pairs `disabled`, own `kane-result` (`data-outcome`, `data-winner`; Victory!/Defeat/Time up) above the scrim; production popup untouched. DOM contract attributes exactly as PRD table.
Done when: manual click draws one line, button turns active within 1 s, canvas drag still works.

## Task 5 — Building tags
What it is: A/B/C labels over buildings (R3).
What changes at a high level: `kane/tags.ts` imperative layer; one `span` per building (`data-letter`, `data-index`, `data-building-id`), positioned per frame from `anchors.building(id)` using the `projectAnchor` math, transform-only writes; high-contrast disc with owner colour ring, `pointer-events:none`. Fallback if time-pressed: fixed tags without ring (cut order, last to go).
Done when: letters identical across two loads; tags track buildings while panning. [DEFERRED] check tag vs number-sprite overlap via screenshot in rehearsal.

## Task 6 — Camera room for panel
What it is: keep the map above the panel (R4, D9).
What changes at a high level: pure `panelHeight(viewportH)` used for both `--kane-panel-h` and the padding getter; `SceneOptions.padding` accepts a getter so resize recomputes; Kane mode passes `{...HUD_PADDING, bottom: panelHeight + 12}` into `createLevelScene` via the `runtime.ts` plumb. No camera algorithm change.
Done when: screenshots at 1600x900 and 1366x768 show the whole map above the panel, tags clear of it; non-Kane framing unchanged.

## Task 7 — `__na.kane.summary()` + visibility auto-resume
What it is: ground-truth hook for 03/04/05 and background-tab safety (R6, O1).
What changes at a high level: add `api.kane.summary()` returning the JSON in the PRD (tick, speed, over, result, letters, human commands/drawn/cut/rejected, banner, pairs); human rows = `player===0`; resets with the driver. In Kane mode, auto-resume the driver on `visibilitychange` to visible and do not open the restart popup for a hidden pause.
Done when: one `Runtime.evaluate` returns the summary; hide/show leaves the game running with no stuck popup. [DEFERRED] re-verify no stuck restart popup in rehearsal.

## Task 8 — Remove original-game name
What it is: R5.
What changes at a high level: reword the single CSS comment at `style.css` line 4 only.
Done when: case-insensitive grep for the original game name over `apps/web/{src,e2e,assets,index.html}` returns 0.

## Task 9 — Kane panel e2e + final gates
What it is: acceptance coverage (Acceptance Criteria).
What changes at a high level: new `kane-panel.spec.ts` on `?kane=1`: default speed, cycle and tick rate, ready click -> single human DrawLine and `active`, dblclick -> `LineCut`, grey click -> banner and no command, MatchOver -> disabled + `Game over` + `kane-result`, canvas drag, letter stability, absence without `?kane=1`. Run web unit + e2e, `pnpm build` then grep production `dist` for `kane-pair`/`kane-panel` (0), `check:rules`, goldens. [DEFERRED] rehearsal screenshots for overflow (O2) and tags (O4).
Done when: all green; no RULES_VERSION/BOT_VERSION diff.

## Owner-only steps
None in PRD. Rehearsal visual checks (O2, O4) and auto-resume verification (O1) happen at runtime in rehearsal.
