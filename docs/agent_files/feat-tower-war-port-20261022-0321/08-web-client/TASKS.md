---
status: draft
summary: 10 tasks to rebuild the web shell (camera, mirror, HUD, picker, save v2, gestures, harness, e2e) for Tower War, landscape, no boosters.
date: 2026-10-22
---
# Tasks: 08 Web client
Source of truth: docs/agent_files/feat-tower-war-port-20261022-0321/08-web-client/PRD.md. Consumes 03's R7 view API and 07's world renderer/anchors/previewLane; 04's explainDraw is soft. Legacy screens, HUD, save fields and dev tuning are deleted in the same commit that replaces them. Visual tasks iterate screenshots against `ref/tw-yt/` (portrait refs, landscape layout).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Camera, worldRoot mirror, L4 frame check | 03 (R7), 07 renderer | done |
| 2 | UI sprites, font, HUD layout from refs | 1 | done |
| 3 | Ownership bar math | 03 (R7) | done |
| 4 | Save v2, state machine, runtime, picker | 1, 2 | in-progress |
| 5 | In-play HUD and popups | 2, 3, 4 | todo |
| 6 | Gesture state machine and input controller | 1, 4 | done |
| 7 | Blocked-draw preview and reasons | 6, 04 explainDraw | in-progress |
| 8 | Driver passthrough and test harness | 4, 6 | todo |
| 9 | E2E rewrite and legacy purge | 5, 7, 8 | todo |
| 10 | Visual pass, perf, gate un-park | 9, 07 perf scene, 09 red-window table | todo |

## Task 1 — Camera, worldRoot mirror, L4 frame check
What it is / what it means: First proof that the landscape frame works end to end: the single LH->RH mirror lives at `worldRoot` here (D1, B3), camera is unrotated.
What changes at a high level: Rewrite camera/scene/overlays: TW FOV 21 / pitch 55 from the manifest, dolly-fit to `view.bounds` union `renderer.anchors` (no model loading), HUD-edge padding via view offset, refit on resize, DPR cap 2, resize never rebuilds. Create mirrored `worldRoot` for 07 content; labels and HUD stay outside it. Render L4 and compare to its ref (weapon hand, layout not mirrored).
Done when: L4 matches ref frame sanity; camera-fit unit tests pass for 4:3..21:9; all buildings in frame at the five test sizes.

## Task 2 — UI sprites, font, HUD layout from refs
What it is / what it means: Get TW UI art and decide landscape HUD slots (RectTransforms unknown; refs only) (D10).
What changes at a high level: Add the 08-owned `ui-sprites.mjs` copying sprites (back button, bar background, etc.) into `apps/web/assets/ui/` with a hash lock and manifest merge shared with 07's pattern. Pick sprite-to-slot mapping and landscape positions from ref frames. Bundle a self-hosted OFL display font fallback.
Done when: sprites committed and lock-checked; slot map and layout recorded; a HUD mock screenshot is compared with refs.

## Task 3 — Ownership bar math
What it is / what it means: Pure web-side function for bar segments (D4, no `view.control`).
What changes at a high level: `ui/ownership.ts` over `view.buildings`: per non-neutral player, building-level sum share, integer permille, ordered by player index, last takes remainder; neutral hidden, units in flight ignored. Check against ref frames; adjust only if refs clearly contradict.
Done when: unit tests cover 2- and 4-colour cases, rounding, and zero-owner edge; 4 colours yield 4 segments.

## Task 4 — Save v2, state machine, runtime, picker
What it is / what it means: Replace the shell's flow with `boot|picker|playing|result|error`; level source is the campaign list (02), not a glob (R1, R4).
What changes at a high level: Save `nodearena:save` v2 keyed by `levelId` with settings, same backup/notice behaviour, v1 discarded; `quality`/`tipSeen` etc. dropped. Rewrite state/runtime/boot; `restartPopup` is an overlay flag. New Picker: 20 cards shown 1..20 (`position - 3`), locked/unlocked/completed, last-played focus, mute toggle and credits link. Delete old App/menu/settings/strength/tokens, tuning and `dev/`.
Done when: fresh profile shows only level 1 open; completing unlocks next and persists on reload; v1 blob ignored; save and reducer unit tests pass.

## Task 5 — In-play HUD and popups
What it is / what it means: TW HUD elements without boosters (R3, D3).
What changes at a high level: Back button opens RestartPopup (Restart / Continue / Levels) and pauses via the driver; ownership bar (200 ms animation) with level name; ResultPopup for win (Next / Replay / Levels), defeat and timeout/draw (Retry / Levels), plus an "All levels complete" last-level variant; win records result and unlocks next. HUD updates at <=10 Hz from a tick subscriber; mute corner toggle.
Done when: flows work in browser; HUD matches refs in style; frame loop never waits on Preact; no booster or speed controls exist.

## Task 6 — Gesture state machine and input controller
What it is / what it means: Mouse/trackpad draw, cut, eraser per R6, as a pure injected-clock state machine plus a pointer-event adapter.
What changes at a high level: Draw from own building (hit radius from anchors, 1% diagonal start threshold, 07 `previewLane`); touch delay 0.2 s, mouse instant (D6); cut by empty-ground or right-button stroke once per channel (D7); 0.7 s hold eraser mode; cancel on blur, Esc, popup open. Keep segment-distance helpers; commands only via `driver.submit`. No per-frame allocation.
Done when: state-machine unit tests cover each gesture and cancel; a valid draw and a cut produce correct commands in the browser.

## Task 7 — Blocked-draw preview and reasons
What it is / what it means: Red preview with reason when a line is not allowed (R6).
What changes at a high level: While dragging over a target call `sim.canDraw`; non-null shows red preview, reason text from a web code->text table, blocker point from `sim.explainDraw`; free-ground target is red too; release sends nothing and flashes the source building.
Done when: blocked drag shows red plus reason and emits no command; every reason code has text.

## Task 8 — Driver passthrough and test harness
What it is / what it means: Keep the driver, expose what tests and tools need (R1, R5).
What changes at a high level: Driver ownership passthrough; `setSpeed` kept wall-clock only and unreachable from UI. Harness rewritten: `?level=&seed=&speed=`, probes for anchor screen coordinates, HUD state, command log, plus visual capture of picker, HUD and popups at 1600x900. Audio rewired to new events.
Done when: probes drive a level from URL; no UI path reaches `setSpeed`; `simHash` and goldens unchanged.

## Task 9 — E2E rewrite and legacy purge
What it is / what it means: Replace web specs and verify the old shell is gone (Tests, Goal 4).
What changes at a high level: Rewrite `app-flow`, `boot`, `hud`, `input`, `input-gestures`, `slice`, `acceptance`; delete `dev` and any render spec referencing removed UI (07's remain). Cover draw, blocked draw, cut, eraser, restart popup, win->next, defeat->retry via command-log assertions, 20 levels at five window sizes, ownership vs unit tests. Re-add the content hash browser-parity check (deleted at CUT; 02 review 2026-10-22 G).
Done when: web e2e green; grep finds no `strength`, Settings, menu screen, `tuningFields`, `spike`.

## Task 10 — Visual pass, perf, gate un-park
What it is / what it means: Close out acceptance and return web gates to CI (09 red-window table: SP08 done un-parks `typecheck:web`, `test:web`, `test:web:e2e`).
What changes at a high level: Iterate HUD + L4 screenshots to `ref/out/` against refs; measure HUD cost (<1 ms median) and 720-troop frame time with 07's perf scene; decide whether `quality` is needed (default dropped); remove web entries from the PARKED list with 09.
Done when: `pnpm lint typecheck test test:web:all` green; screenshots and perf numbers recorded; owner can review.

## Owner steps
Final visual approval of HUD vs refs; mouse feel pass to retune drag delay and eraser UX.
