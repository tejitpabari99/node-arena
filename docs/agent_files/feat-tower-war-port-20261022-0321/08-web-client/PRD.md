---
status: draft
summary: Rewrite the web client shell (camera, HUD, input, screens, save) around Tower War's landscape-rotated 20-level campaign and gestures (boosters deferred); delete legacy menu/settings/dev/render-glue.
date: 2026-10-22
---
# PRD: 08 Web client (Tower War shell, HUD, input)

Repo/branch: node-arena, `feat/tower-war-port` · Depends on: 03 (sim read API R7), 07 (world renderer, anchors, FX); soft 04 (`canDraw` reasons, `explainDraw`), 05 (level order/rotation), 02 (campaign list, Frame contract)
Owns: `apps/web/src/{app,ui,input,save,driver,test-harness,main.tsx,style.css}`, `apps/web/src/render/{camera,scene,overlays,disposables}.ts` (incl. `worldRoot` and its single mirror), `apps/web/assets/ui/**`, `tools/assets/ui-sprites.mjs`, `apps/web/e2e/**` (except render specs, see Tests)
Does not own: `render/*` units/buildings/ground/lanes/FX and `manifest/*` (07); sim/rules (01,03,04); level files/rotation transform (05); bots (06); CI gate wiring (09)

## TL;DR
Boot straight into a 20-level picker; play with TW's HUD (back button, ownership bar; no boosters, [RESOLVED: owner — boosters deferred]); draw/cut/eraser gestures on mouse+trackpad; result popup -> next/retry. Camera = TW's FOV 21 / 55 deg pitch, dolly-fitted to the level. Rotation is baked into level data by SP05, so the camera stays unrotated. Menu, settings, dev tuning, strength pill, results/pause screens are deleted.

## Problem
- Current shell is built for the old game: screens `boot|menu|picker|loading|playing|paused|results|settings|error`, strength-pill HUD, 1x/2x speed toggle, string-id levels via glob, right-click/swipe cut, tower-specific camera bounds (`levelVisualBounds` reads tower models) [verified: app/state.ts:35, ui/Hud.tsx, app/boot.ts, render/camera.ts].
- TW HUD/controls are portrait-phone. We need the same elements and feel on a laptop landscape window with a mouse/trackpad.
- Their sprites live in `_extract` but nothing imports UI art yet; fonts are not extracted [verified: INDEX.md:72].

## Goals
1. Play levels 4-23 start to finish with TW-style HUD, flow and gestures.
2. Camera matches TW look (FOV 21, pitch 55) and fits any window 4:3..21:9 with HUD-safe margins.
3. Web mutates sim only via commands; no HUD/input code reads private sim state.
4. All legacy screens/HUD/save fields removed in the commit that replaces them.

## Non-Goals
Meta screens (shop, garage, quests, currencies), tutorials, emotes, level-start preview popup, AI-name display, Draw/Boss/Arena HUD variants, touch-first layout (pointer events still work), audio rework (stays as is, hooked to new events), settings screen.

## Requirements

### R1 Inventory (keep / rewrite / delete)
| Path | Verdict | Note |
|---|---|---|
| `app/runtime.ts`, `app/boot.ts` | rewrite | level source = campaign list (02) not glob; manifest load via 07 |
| `app/state.ts` (427 loc) | rewrite | screens reduce to `boot|picker|playing|result|error`; `restartPopup` is an overlay flag, not a screen |
| `ui/App.tsx`, `ui/Hud.tsx`, `ui/strength.ts`, `ui/tokens.ts` | delete + new | new `ui/{Picker,Hud,OwnershipBar,RestartPopup,ResultPopup}.tsx` |
| `ui/Credits.tsx` | keep (restyle) | link from picker; content from 07's CREDITS |
| `input/index.ts` (165), `input/geometry.ts` | rewrite | keep `pointSegmentDistance/segmentDistance`; drop lane-material/preview mesh (07's `previewLane`) |
| `driver/*` | keep | add ownership passthrough; `setSpeed` stays but is dev/test only (R5) |
| `save/index.ts` | rewrite | v2, see R4 |
| `render/camera.ts`, `scene.ts`, `overlays.ts`, `disposables.ts` | rewrite/keep | fit logic kept, bounds source changed (R2) |
| `test-harness/*` | rewrite | probes for new HUD/anchors, URL params |
| `dev/` (tuning, spike), `app` tuning fields | delete | spike is troop-render only; tuning is old-content shaped |
| `audio/*` | keep | rewire events |
| Settings screen/menu | delete | mute toggle lives on picker + HUD corner |

### R2 Camera and rotation
- **Frame contract (owned by 02, cited here):** data frame = Unity coords rotated `(x,z)->(z,-x)`, yaw `(Y+90)`; assets are imported RAW (07). **08 owns the single LH->RH mirror** at the scene root (`worldRoot.scale.z = -1` or equivalent) so screen-right = +x, screen-up = +z; three.js flips face winding for negative-determinant objects. Label/text sprites and the HUD stay outside the mirrored root. 08 Task 1 renders L4 against its ref to confirm the frame end to end.
- **Rotation is importer-time.** SP05 emits every level already in the landscape frame: rotate 90 deg clockwise about the origin, `(x, z) -> (z, -x)` (a pure rotation in data, det +1; the mirror is the root's), so TW "player at bottom" lands on the left and the 1080x1920 field becomes ~1920x1080. Building/obstacle/gate yaw is shifted by the same 90 deg. Level `bounds` is post-rotation. Render and input then use an **unrotated** TW camera: looks along +z axis, screen-right = +x, screen-up = +z. Sim, bots, lane geometry, 07 art and e2e coordinates are all in this one frame; nothing downstream knows about the original portrait frame.
- Why not render-time yaw: every consumer (input raycast, 07 shadows/light dir, label billboards, harness coordinates, goldens) would carry a hidden 90 deg transform; the sim bounds would be portrait while the screen is landscape.
- Handedness: Unity is left-handed; data is a pure rotation (05), assets RAW (07), and exactly one mirror lives at `worldRoot` (here). No double flip: neither 05 nor 07 mirrors. [RESOLVED: B3]
- Camera: `PerspectiveCamera` FOV 21, pitch 55 (manifest `camera`), fixed; **dolly-fit** (existing `fitCamera`) to level bounds + obstacle/building extents from `anchors`, not FOV change (TW widens FOV for narrow screens; we have no narrow target). Extra per-edge padding for HUD (top bar, bottom button row) in screen-space, applied via `setViewOffset` or an equivalent framing margin. Refit on `ResizeObserver`; max DPR 2; resize never rebuilds the scene.
- Level bounds source: sim `view.bounds` (post-rotation) union `renderer.anchors`; no model loading in camera code.

### R3 HUD (Preact, over canvas)
| Element | Behaviour | Data |
|---|---|---|
| Back button (top-left) | opens RestartPopup; sim paused while open (driver `pause`) | - |
| RestartPopup | "DO YOU WANT TO RESTART THE BATTLE?" Restart / Continue / Levels | - |
| Ownership bar (top-centre) | up to 4 colour segments, widths = control share; animated 200 ms; level name under it | web-side `ui/ownership.ts` over `view.buildings` (D4; no `view.control`) |
| ResultPopup | Victory: Next level (if exists) / Replay / Levels; Defeat: Retry / Levels; timeout/draw as defeat wording | `view.over.winner` |
| Level number on buildings | 07 world label, not HUD | - |
- Sprites: `back_button`, `bar_back`, etc. from `_extract/assets/defaultlocalgroup_assets/Sprite`, copied by `tools/assets/ui-sprites.mjs` into `apps/web/assets/ui/` with a hash lock (same pattern as 07; manifest entries merged by 07's script). Exact sprite-to-slot mapping is picked in Task 1 against App Store refs.
- **Ownership math** (pure fn `ui/ownership.ts`, no sim change, no `view.control`): per non-neutral player, `share = sum(building level) / sum over all non-neutral players`, integer permille, segments ordered by player index, last takes the remainder; units in flight not counted. [RESOLVED: building-level sum, neutral not shown; verify vs ref frames in task 1, adjust only if refs clearly contradict]
- HUD re-renders at <=10 Hz from a tick subscriber; canvas frame loop never waits on Preact.

### R4 Picker and save
- Picker: grid of 20 cards, **displayed 1..20 (`position - 3`)**; `position` stays in data and the save is keyed by `levelId` (S4), states locked / unlocked / completed; click starts level. Unlock = previous completed; level 1 always open. Last-played card focused. Mute toggle + credits link only.
- Save `nodearena:save` v2: `{ v:2, completed: Record<levelId,{firstAt}>, lastLevel, settings:{musicVol,sfxVol,musicMute,sfxMute} }`. Same try/catch, backup key and notice behaviour as today. v1 blobs are discarded (no migration, per no-backcompat). `tipSeen`, `colorblind`, `quality`, `reducedMotion` removed unless 07 needs quality [RESOLVED: dropped unless 07 perf result shows need; decided at 08 implementation].
- Result flow: win -> `recordResult`, unlock next, ResultPopup. Last level win -> "All levels complete" variant.

### R5 Game speed
- Driver `setSpeed(1|2)` is R-TCK-01 accelerated stepping: wall-clock only, never in replays. It is **removed from player UI**; kept for tests (`?speed=`), bot-vs-bot soak, dev console.
- No in-game speed booster (out of scope; FUTURES). Driver speed stays wall-clock/test-only.

### R6 Input (mouse/trackpad)
Pointer Events on the canvas, `touch-action:none`, single active pointer.
| Gesture | TW | Laptop mapping |
|---|---|---|
| Draw line | press own building, drag, release over target | same; hit radius from `anchors.building`; preview via 07 `previewLane`; drag starts after 1% screen-diagonal move |
| Drag delay 0.2 s | `_delayBeforeDragChecking` | applies to `pointerType !== 'mouse'`; mouse starts instantly (else quick flicks are lost) [RESOLVED: touch 0.2 s, mouse instant; retune in owner feel pass] |
| Cut | swipe across own line | press on empty ground or right-button drag, stroke segment vs projected lane; each channel cut once per stroke (existing logic) |
| Eraser | long press 0.7 s | hold 0.7 s on empty ground without moving: eraser mode (cursor + trail), movement cuts until release |
| Cancel | focus loss | blur, `Esc`, popup open cancel any gesture |
- Blocked preview: while dragging over a target call `sim.canDraw(player, from, to)`; non-null -> preview red, reason label near cursor (code -> text table in web), blocker point from `sim.explainDraw(player,from,to)` (04; `canDraw` has no `blockPoint`), release sends nothing and flashes the source building. Free-ground target (no building) is also red (TW commits only on a building).
- Commands submitted only through the driver (`driver.submit`), stamped with the tick.

### R7 Sim read API (verbatim from 03 R7; 08 will not touch sim internals)
| Item | Shape |
|---|---|
| `sim.view.bounds` | `{minX,maxX,minZ,maxZ}` milli-units, post-rotation |
| `view.buildingStatic[i]` | `{x,z,footprint,kind,special,...}`; `footprint` = circle (radius) or box (size) shape; `kind` = `house|tower` (milli `x,z`; replaces `towerStatic{x,y}`) |
| `view.buildings.owner[i]`, `.level[i]`, `.stage[i]` (also `maxLevel, lines, alive`) | column (`ReadColumn`) layout, not row objects; owner `-1` neutral (replaces `view.towers`) |
| `view.players[i]` | `{kind:'human'|'ai', colorKey}` (exists) |
| `view.lines` | `{channel,owner,from,to}` (exists) |
| `Command` | `DrawLine` / `CutLine` only (no boosters) |
| `sim.canDraw(player,from,to)` | `null | ReasonCode` (code, not prose); no `blockPoint` |
| `sim.explainDraw(player,from,to)` | `{reason, point:{x,z}, ref}` or null (04; seam stub in 03) for the red preview |
| `view.over` | `{outcome: won, lost or timeout; winner: number or null} or null`; winner is `view.over.winner` (no `view.winner`) |
| events (payloads fixed by 03's CUT) | `BuildingCaptured`, `MatchOver`, `TroopDied`, `Clash`, `TowerShot` (for 07/audio) |
No `view.control` (ownership bar is web-side, D4). [RESOLVED: review 2026-10-22 — 08 PRD matches the real read API: `view.over.winner`, column views, `footprint`, `update(frame, events, dtMs)`] 03 publishes these in the sim's exported types; 08 consumes them from `@node-arena/sim` only.

## Architecture
```
main.tsx -> app/runtime (state machine boot|picker|playing|result|error)
  campaign (02 list) -> levels; save v2
  GameDriver (fixed step) --view/events--> world renderer (07)
  canvas+camera (08) <-> input controller -> driver.submit(Command)
  Preact HUD <- tick subscriber (ownership) -> overlay flags (restart popup)
```
08 creates `WebGLRenderer`, canvas, camera; passes scene to 07's `createWorldRenderer`; calls `update(frame, events, dtMs)` per frame, where `frame = {view, troops: TroopBuffer, n, alpha}` is built by 08 (`n = sim.readTroops(buf)`, `alpha` = fixed-step accumulator fraction; `sim.snapshot()` is persistence/debug only, never called per frame); uses `anchors.building(id)` and `pickMeshes` for hit tests and HUD placement. There is no booster or targeting state. `worldRoot` (mirrored) is created here; 07 adds its content under it.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| D1 | Where rotation happens | importer-time (05), 90 deg CW `(x,z)->(z,-x)` | render-time camera yaw | one coordinate frame everywhere; no hidden transforms in input/art/harness |
| D2 | Fit method | dolly fit at fixed FOV 21/pitch 55 | TW-style FOV rescale | landscape needs no FOV change; keeps their perspective feel |
| D3 | Pause | no pause button; Back opens restart popup which pauses | pause screen | matches TW HUD (no pause) |
| D4 | Ownership bar math | web-side pure fn over `view` | sim `control` API | no sim surface; easy to retune |
| D5 | Driver speed | driver speed test-only; no booster in scope ([RESOLVED: owner — boosters deferred]) | keep 1x/2x toggle | toggle is not a TW feature |
| D6 | Drag delay | 0.2 s only for non-mouse | apply to all | mouse flicks would drop |
| D7 | Right-button drag cut | kept as laptop extra | remove | trackpad two-finger click is natural; harmless |
| D8 | Save | v2, drop v1, no migration | migrate | explicit no-backcompat |
| D9 | Settings/dev tuning | delete both | keep | tied to old content/screens |
| D10 | UI sprite import | 08-owned script, separate from 07's | extend 07 importer | different owner/cadence; shares manifest merge |

## Manual steps (owner)
- Final visual approval of HUD vs refs (`BF/ref/tw-yt/`). Real-device screenshots no longer needed [RESOLVED: owner supplied video refs].

## Risks
| Risk | Mitigation |
|---|---|
| Rotation handedness/yaw mismatch with 07 art | single verified Task 1 render of L4 vs ref before HUD work |
| HUD layout positions unknown (RectTransforms not read) | design landscape layout by judgment; owner approves |
| Gesture conflicts (cut vs draw vs eraser) feel wrong | e2e per gesture + manual feel pass |
| 03/04 API differs from R7 | R7 is now verbatim from 03 R7 (resolved); any 03 change must be mirrored here |
| Preact re-render cost | 10 Hz throttle, memoised segments |

## Open Questions
- [RESOLVED: building-level sum per non-neutral player, neutral not shown, units in flight not counted; verify vs ref frames in task 1] Ownership bar: building-level sum vs total troops incl. units; does neutral show? Verify against `BF/ref/tw-yt` frames in task 1.
- [RESOLVED: S4 picker shows 1..20 (`position - 3`); `position` stays in data; save keyed by `levelId`]
- [RESOLVED: derive positions from ref frames, adapted to landscape, in task 1] Exact HUD slot positions/sizes and which sprite per slot (positions in RectTransforms not exported). Verify against `BF/ref/tw-yt` frames in task 1.
- [RESOLVED: fallback bundled self-hosted OFL display font] TW UI font (not extracted); verify against `BF/ref/tw-yt` frames in task 1; fallback = bundled OFL display font, self-hosted.
- [RESOLVED: touch 0.2 s, mouse instant; eraser UX as designed; retune during owner feel pass (owner step)] Mouse drag delay value and eraser enter/exit UX after feel test.
- [RESOLVED: `canDraw` returns `code|null` only; blocker point via `sim.explainDraw` (04)]
- [RESOLVED: shapes per 03 R7; boosters (bomb/speed) out of scope — [RESOLVED: owner — boosters deferred], HUD has no booster buttons/ring/label]
- [RESOLVED: drop unless 07 perf result shows need; decided at 08 implementation] Keep `quality` setting for perf on weak GPUs (07 perf result).
- [DEFERRED] Emotes, level-start preview, touch layout, pause menu.
- [RESOLVED: D1] rotation location.
- [RESOLVED: B1 08 R3/R6/R7 rewritten from 03 R7; boosters removed]
- [RESOLVED: B3 08 owns the single mirror at `worldRoot`]

## Acceptance Criteria
- Fresh profile boots to picker: only level 1 unlocked; completing it unlocks 2; reload persists; v1 save ignored.
- Each of 20 levels loads at 1280x720, 1600x900, 1920x1080, 1366x768, 2560x1080: all buildings in frame, clear of HUD.
- Playwright: draw (valid), draw blocked (red + reason, no command), swipe cut, long-press eraser, restart popup, win -> next, defeat -> retry. All via `driver.submit` command log assertion.
- Ownership bar matches `ui/ownership.ts` unit tests and the e2e after a capture; 4-colour level shows 4 segments.
- Driver speed not reachable from UI; no booster controls exist.
- HUD frame cost <1 ms median; no per-frame allocation in input/camera paths.
- Grep finds no `strength`, `Settings`, `menu` screen, `tuningFields`, `spike` references; `pnpm lint typecheck test test:web:all` green.
- `simHash`, goldens unchanged by any 08 change.
- Visual refs (`BF/ref/tw-yt/INDEX.md`) are portrait (phone); our game is landscape. Match style/content (art, colours, building/unit looks, labels, HUD elements, effects), adapt layout/HUD placement to landscape (owner-approved).
- Screenshots (HUD + L4) in branch `ref/out/` compared against TW refs (`BF/ref/tw-yt/` frames, indexed by `BF/ref/tw-yt/INDEX.md`; visual compare loop). Task 1 renders L4 under the mirrored `worldRoot` and compares against its ref (frame sanity: weapon hand, level layout not mirrored); labels sit outside the mirrored root and read correctly.
- Picker shows 1..20; save keyed by `levelId`.

## Tests
- Unit: ownership, camera fit (all aspects), save v2, gesture state machine (pure, injected clock).
- E2E (rewrite): `app-flow`, `boot`, `hud`, `input`, `input-palette`->`input-gestures`, `slice`, `acceptance`, `dev`(delete); render-specific specs `towers|troops|lines-fx|model-regressions|scene|assets|spike` belong to 07 (08 only deletes those that reference removed UI).
- Harness: `?level=<id>&seed=<n>&speed=<1..>`; probes expose anchors' screen coordinates, HUD state, command log; visual harness captures picker, HUD, popups at 1600x900.
- Perf: 720 troops + HUD via 07's perf scene with 08 shell; record frame time.
- [RESOLVED: review 2026-10-22 — content hash browser parity re-added by SP08] The v1 content browser-parity test (content hashing in a real browser vs Node) was deleted at CUT with no owner; SP08 re-adds it against the v2 `simHash`/`botHash` (sim golden browser parity is SP03 Task 8).
