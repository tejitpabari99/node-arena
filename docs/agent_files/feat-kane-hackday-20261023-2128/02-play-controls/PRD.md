---
status: draft
summary: Slow speeds (0.25/0.5/1/2), one-click pair-button panel, DOM building tags, camera room and "Tower War" text removal so Kane can play and an audience can watch na-kane.
date: 2026-10-24
---
# PRD: 02 Play controls (speed, pair panel, tags, layout)

Repo/branch: node-arena, `feat/kane-hackday` · Depends on: 01-kane-level (campaign `kane`, `?kane=1`) · Brief: [brainstorm.md](../brainstorm.md) (locked)
Owns: `apps/web/src/kane/**` (new, test-build only), `apps/web/src/driver/index.ts`, `apps/web/src/test-harness/{gate,index}.ts`, `apps/web/src/render/{camera,scene}.ts` + `app/runtime.ts` (padding plumb only), `apps/web/src/ui/App.tsx` (one overlay slot), `apps/web/src/main.tsx` (gated wiring), `apps/web/src/style.css` (line 4 only), kane e2e specs
Does not own: sim/bots/content (01 owns level + bot delay), Kane driver and saved tests (03)

## TL;DR
In `?kane=1` test builds the game gets: a top-bar speed button (default 0.25x), a bottom panel of one-click pair buttons grouped by source building, A/B/C DOM tags over buildings, a red error banner, and a camera that leaves room for the panel. Sim, rules and replays are untouched. All Kane UI lives in `apps/web/src/kane/`, imported only inside the existing DEV/`VITE_TEST_HOOKS` gate, so the production bundle is unchanged.

## Problem
- Kane cannot drag on the canvas; it clicks DOM text reliably. The game is drag-only, with no slow speed and no readable building names [brief; verified: driver speed type `1|2` at `driver/index.ts:75,104,106`, `gate.ts:1`].
- Kane needs ~5-6 s per click, so one move must be one click on a self-describing button.
- Camera reserves only 64 px at the bottom (`render/camera.ts:9`).
- A CSS comment names the original game (`style.css:4`) [verified: grep -i 'tower war' in apps/web/{src,e2e,assets,index.html} -> 1 match, style.css:4].

## Goals / Non-Goals
Goals: items 1-6 of the scope below; stable DOM/test-hook contract for 03/04/05; existing e2e (`#game-hud button` count 2 on common levels) stays green.
Non-goals: sim/tick/rules changes, new commands, touch UI, panel in production or on `common` levels, speed button outside Kane mode, changing `building-label.ts` textures, Kane driver logic.

## Requirements

### R1 Speed {0.25, 0.5, 1, 2}
- Type `Speed = 0.25|0.5|1|2` exported from `driver/index.ts`; `setSpeed` throws RangeError for anything else; `TestHookRequest.speed: Speed`, parsed from `?speed=` (exact match against the four values, else default).
- Default 1; default 0.25 when `request.kane` (assumption A1). `?speed=` wins.
- Top-bar button (Kane mode only) cycles 0.25 -> 0.5 -> 1 -> 2 -> 0.25; text `Speed 0.25x`. Chosen speed survives restart (see Architecture).
- Bot `actionDelayMs` is game time: `tw-ai.ts:93` advances `state.timer += MS_PER_TICK` per tick [verified], so a 20 000 ms delay is 80 s wall at 0.25x. 01 must size it with that in mind.

### R2 Pair panel (bottom, Kane mode only)
- One group per source = building owned by human (player 0) with `buildingStatic.drawsLines`. Header `A (blue 20)` = letter, owner colourKey, level. Within a group one button per other building (own, neutral, enemy).
- Hidden: geometry-impossible pairs, taken from a per-level geometry precompute (blocked list), NOT from the `canDraw` reason: `canDraw` returns `no-slot`/`duplicate` before `blocked-*`, so a reason filter would show blocked pairs once slots fill [RESOLVED: owner 2026-10-24 design change; probe: probes-20261024.md §P-LEVEL]. na-kane blocked list (letters by JSON order A=b0 B=b1 C=b2 D=b3 E=b4): A->B, A->D, B->A, C->D, C->E, D->A, D->C. Precompute computes `blocksLines` for every ordered pair with all buildings treated as owned (static geometry), once per level load.
- States (colour + word, text is the contract):

| State | Text | Colour | Click | Dblclick |
|---|---|---|---|---|
| ready | `A → C · ready · C: grey 5` | green | DrawLine | n/a |
| active (line exists) | `A → C · active` | red | no-op | CutLine |
| unavailable | `A → B · no free route` | grey | red banner with reason | no-op |

- Target suffix `C: <ownerColourKey|grey> <level>` on ready buttons only. Reason words: `no-slot` -> `no free route`; any other reason -> reason with dashes as spaces. Banner sentence from `DRAW_REASON_TEXT` (`input/reasons.ts`).
- Click rules (no double fire): a pair with a submitted-but-not-yet-ticked command is "pending" and ignores further clicks; click on active does nothing; dblclick cuts only if the line was drawn >=700 ms ago (wall) so a slow human double-click on a ready button cannot draw then cut.
- Sequence on ready click: `sim.canDraw(human,from,to)`; non-null -> banner, no submit. Else `driver.submit(DrawLine)`; `null` return (paused/over) -> banner `Game paused` / `Game over`.
- Race rejections: any `CommandRejected` event for the human -> banner (reason sentence).
- Banner: red, full-width top, `role=alert`; sticky until the next panel click or 12 s (Kane step latency is 5-6 s, so it must outlive a step); `Game over` is permanent.
- Press feedback: 400 ms pressed animation plus ripple on every click (human or Kane); colour flips on the next tick when the sim accepts (<=200 ms wall at 0.25x).
- Game over (`screen==='result'`): all pair buttons `disabled`, banner `Game over`. While the restart popup is open the panel is under the scrim (not clickable).
- Result element: the existing dialog title for a win on a single-entry campaign is `All levels complete!` (`ResultPopup.tsx`, `hasNext` false) [verified], not Victory. The overlay renders its own `kane-result` (Victory! / Defeat / Time up) above the scrim; production popup untouched.
- Overflow: na-kane shows max 7 pair buttons (2 at start, 4 after capturing C, 7 with A, B, C owned) [probe: probes-20261024.md §P-LEVEL]; panel height fixed at `clamp(140px, 22vh, 220px)`; groups sit side by side, each group's buttons wrap in 2 columns; ready/active sort first; `overflow:auto` as last resort. Fixed height keeps the camera still as sources are captured.
- Canvas drag keeps working; the panel container is `pointer-events:none`, only buttons capture.

### R3 Building tags
- DOM `span`s over buildings, letter = bijective base-26 of the building index in `view.ids.buildings` (A..J for <=10; AA after Z). Index = level-JSON order, so stable across runs; reordering `na-kane.json` buildings changes letters (contract for 01/03).
- Positioned each frame from `anchors.building(id)` via the same projection math as `test-harness/probe.ts::projectAnchor`; transform-only writes, no layout reads.
- High-contrast disc with the owner colour ring; `pointer-events:none`. Cut-order item (floating tags last to go) - fallback is fixed tags without the ring.

### R4 Camera
- Kane mode passes `padding = {…HUD_PADDING, bottom: panelHeight + 12}` into `createLevelScene`. `fitCamera` already dolly-fits inside the padded rect via `setViewOffset` [verified: camera.ts], so the map shifts up and zooms out only when the shorter free height forces it. No camera algorithm change.
- `panelHeight(viewportH)` is one pure function used for both CSS (`--kane-panel-h`) and the padding getter. `SceneOptions.padding` accepts a getter so window resize recomputes.

### R5 Remove original-game name
- Reword `style.css:4` to drop the name. After the edit: grep -i 'tower war' over `apps/web/{src,e2e,assets,index.html}` returns 0.

### R6 DOM + hook contract (cited by 03/04/05)
See Architecture. Everything is `data-testid` plus data-attributes; Kane reads text, scripts read attributes.

## Architecture

### Components
| Unit | File | Role |
|---|---|---|
| Speed accumulator | `driver/index.ts` | Widen type only; the existing loop is already fractional |
| Pairs model | `kane/pairs.ts` (pure, node-testable) | `derivePairs(view, canDraw, blocked) -> Group[]`, `computeBlocked(sim/state) -> Set<from>>to>` (static geometry, once per level), labels, reason words, letters |
| Panel + tags + banner + speed button + result | `kane/Overlay.tsx`, `kane/tags.ts`, `kane/kane.css` | Preact overlay + imperative tag layer |
| Wiring | `main.tsx` (inside gated block) | Dynamic-imports `kane/`, passes overlay to `mountApp`, wraps `attachInput` so tag refresh rides `input.refresh()` (called each frame by `runtime.frame`) |
| Harness | `test-harness/{gate,index}.ts` | `request.kane`, speed parsing, owned `currentSpeed`, `api.kane` |

### Speed: why the driver loop needs no new algorithm
`advanceFrame` does `accumulator += min(dt,250)*multiplier`, steps while `>=50 ms`, keeps the remainder [verified: driver/index.ts]. At 0.25x that is one tick per 200 ms wall with no drift (remainder carried), alpha interpolation smooth over those 200 ms. Pause/hidden/restart reset the accumulator (loses <1 tick, intended). Changing speed mid-run is continuous because the accumulator holds game-ms. Overdue-tick drop (`MAX_FRAME_STEPS`) never triggers when slow. Sim, `sim:golden`, `replay:verify`, `bots:golden` do not touch the driver, so they are unaffected; no RULES_VERSION/BOT_VERSION change.
New driver tests (`apps/web/test/driver.test.ts`): at 0.25 and 16.67 ms frames, 10 s wall gives 50 ticks (+-1); same tick count for different frame splits (<=250 ms); `setSpeed(0.3)` throws; speed change mid-run continuous; hash after N ticks equal across speeds.
Speed persistence: `startLevel` builds a new `GameDriver` (speed resets), and the harness already re-applies `request.speed` on every driver change [verified: harness `connect`]. Change it to apply `currentSpeed`, updated by `api.setSpeed()` (what the button calls).

### Per-tick data flow
`app.subscribeEvents` fires every tick (the throttled `subscribe` publishes every 2 ticks, ~400 ms wall at 0.25x: too coarse). The overlay recomputes `derivePairs` there (<=90 `canDraw` calls on <=10 buildings), builds a signature string, and re-renders only on change, coalesced to one rAF. Pending set is cleared when a tick with `tick > submission.tick` arrives.

### DOM contract (test-build only)
| Selector | Attributes / text |
|---|---|
| `[data-testid=kane-overlay]` | `data-speed` (0.25..2), `data-phase=playing\|paused\|over` |
| `[data-testid=kane-speed]` | text `Speed 0.25x`, `data-speed` |
| `[data-testid=kane-panel]` | `data-locked=true\|false` |
| `[data-testid=kane-group]` | `data-source=A`, header text `A (blue 20)` |
| `button[data-testid=kane-pair]` | `data-from=A data-to=C data-from-index=0 data-to-index=2 data-state=ready\|active\|unavailable data-reason=no-slot\|""`; text exactly as R2; `disabled` when locked |
| `[data-testid=kane-banner]` | `role=alert`, `data-kind=error\|gameover`, `data-reason`; hidden (`hidden` attr) when empty |
| `[data-testid=kane-result]` | `data-outcome=won\|lost\|timeout`, `data-winner`; text `Victory!`/`Defeat`/`Time up`; absent until MatchOver |
| `[data-testid=kane-tag]` | `data-letter=A data-index=0 data-building-id` |

### CDP ground truth (reuse existing, add one)
Existing `window.__na` already exposes `commandLog` (all submissions incl. bots, `{tick,cmd}`), `events` (incl. `LineDrawn`, `LineCut`, `CommandRejected`, `MatchOver`), `view`, `screen`, `state().result`, `legality(from,to)` [verified: test-harness/index.ts]. Gaps: bot rows mixed in, no letter mapping, no result summary. Add `window.__na.kane.summary()` (JSON-serialisable, one CDP `Runtime.evaluate`):
`{tick, speed, over:{outcome,winner}|null, result:'won'|'lost'|'timeout'|null, letters:[{letter,index,id,owner,level}], human:{commands:[{tick,cmd}], drawn:n, cut:n, rejected:[{command,reason}]}, banner:{text,reason}|null, pairs:[{from,to,state,reason,text}]}`.
Human rows = `player===0`. Drawn/cut/rejected come from `events`. Resets when the driver changes (existing behaviour). The driver (03) must key off `summary().result`, never Kane's claim or dialog text.

### Visibility / background tab (Kane mode)
Facts [probe: probes-20261024.md §P-INFRA-Q3]: when another tab is frontmost `document.hidden=true`, the driver pauses ('hidden') and does NOT auto-resume (needs `__na.resume()`); focus emulation keeps `hidden=false` but rAF throttles to ~5 ticks/s; Chromium throttle flags do not help. Proposal (minimal): in `kaneMode`, auto-resume the driver on `visibilitychange` -> visible (and do not open the restart popup for a hidden pause). Driver (03) additionally keeps a single tab and calls `Page.bringToFront`. Never set `?test=1` for Kane: it makes the driver manual (ticks stay 0); the kane boot URL has no `test=1` (01).

### Cross-SP assumptions
- A1 (from 01): `?kane=1` yields `AppOptions.campaignId='kane'` and test-build gate; 02 defines `app.kaneMode = options.campaignId==='kane'` and adds `request.kane` to `gate.ts` if 01 has not. Both edit `gate.ts`; 01 lands first.
- A2 (from 01): na-kane human is player 0, building order in JSON is final before 03 authors tests.
- A3 (to 03/04/05): they use only the contract above plus `window.__na`; letters are read from `summary().letters` at runtime, not hard-coded in code (objective text may name letters after 01 freezes the map).
- A4 (to 05): hosted build needs `VITE_TEST_HOOKS=1`; panel adds no network calls. Headless rendering works with swiftshader flags (`--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader`) [probe: probes-20261024.md §P-RENDER].

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| D1 | Slow speed | Widen type; reuse existing accumulator | New fractional scheduler; change sim tick length | Loop is already fractional [verified]; sim untouched |
| D2 | Kane code placement | `apps/web/src/kane/`, imported only in gated block; `App` takes an overlay slot | Panel inside `Hud.tsx` | Keeps production bundle free of Kane code (brief: test-build only) |
| D3 | Speed button visibility | Kane mode only | All builds/levels | `hud.spec` asserts 2 HUD buttons; production unchanged |
| D4 | Re-render trigger | Per-tick events, signature diff, rAF coalesce | `app.subscribe` (every 2 ticks) | Colour flip must land inside the 400 ms press |
| D5 | Double-fire guard | Pending set + 700 ms cut guard | Debounce | Deterministic; handles human slow dblclick |
| D6 | Geometry hiding | Per-level geometry precompute (blocked list, static ownership-independent) | `canDraw` reason + memo | `canDraw` returns no-slot/duplicate before blocked-*; memo shows blocked pairs when slots are full (owner 2026-10-24) |
| D7 | Letters | Index in `view.ids.buildings` | By x/y sort; random | Stable, trivial, survives restarts |
| D8 | Result text | Own `kane-result` element | Edit `ResultPopup` | Dialog says "All levels complete!" on single-level win; avoids production edit |
| D9 | Panel size | Fixed height `clamp(140,22vh,220)` | Auto height + ResizeObserver | Camera would zoom while sources change |
| D10 | Banner lifetime | Sticky to next click or 12 s | 3 s toast | Kane reads ~5 s after the click |

## Risks / Open Questions
- [RESOLVED: confirmed: hidden pauses and never auto-resumes; focus emulation + flags do not give full speed off-front [probe: probes-20261024.md §P-INFRA-Q3]] O1 Hidden-tab pause. Requirement: Kane mode auto-resumes on visibilitychange->visible (see Visibility section); 03 keeps a single front tab (`Page.bringToFront`) and may call `__na.resume()`. [DEFERRED: verify at runtime in rehearsal that auto-resume leaves no stuck restart popup].
- [RESOLVED: max 7 pair buttons on na-kane (2 start, 4 after C, 7 max) [probe: probes-20261024.md §P-LEVEL]] O2 Overflow: fits in 220 px without scroll. [DEFERRED: verify at runtime in rehearsal: screenshot at 1600x900 and 1366x768].
- [RESOLVED: design change: hidden pairs come from a per-level geometry precompute, not a `canDraw` memo [probe: probes-20261024.md §P-LEVEL]] O3 Memo gap. Supersedes D6.
- [DEFERRED: verify at runtime in rehearsal; screenshots of na-kane in 01-kane-level/ref/ show the map small and centred] O4 Tag placement vs the number sprite (`labelPos`) overlap; decide via screenshot against the building footprint.
- [RESOLVED: moot, no overflow (max 7 buttons) [probe: probes-20261024.md §P-LEVEL]] O5 Scrolled-out button.
- [RESOLVED: driver tests] Tab-hidden/pause/resume at 0.25: accumulator reset, no catch-up.
- [RESOLVED: verified] Replays/goldens unaffected; bot delay is game-time.
- [DEFERRED] Keyboard shortcuts; panel on `common` levels; speed button persistence across reloads.

## Acceptance Criteria
- `pnpm --filter @node-arena/web test`: new driver tests (R1) and `kane/pairs` tests (labels, states, reason words, hidden geometry, pending/cut guard logic, letters AA after Z) pass.
- `pnpm --filter @node-arena/web test:e2e` (new `kane-panel.spec.ts` on `?kane=1`): default `data-speed=0.25`; speed button cycles 0.25/0.5/1/2 and `__na.view.tick` rate scales; ready click -> `commandLog` has human DrawLine and button becomes `data-state=active` within 1 s; one click on a ready button yields exactly one DrawLine; dblclick active -> `LineCut` event; click on a grey button -> banner text matches reason and no command logged; MatchOver -> every pair `disabled`, banner `Game over`, `kane-result` has `data-outcome`; canvas drag still draws; letters equal across two page loads; panel and tags absent without `?kane=1`.
- Existing e2e unchanged and green (`#game-hud button` count 2 on common).
- `pnpm build` then grep of the production `dist` for `kane-pair`, `kane-panel` -> 0 matches; grep -i 'tower war' over `apps/web/{src,e2e,assets,index.html}` -> 0.
- `pnpm sim:golden`, `pnpm replay:verify golden`, `pnpm bots:golden`, `pnpm check:rules` pass unchanged (no RULES_VERSION/BOT_VERSION diff).
- Hidden pairs: test that a source with 0 free slots still hides blocked pairs (A->B, A->D on na-kane) and shows only `no free route` for non-blocked pairs.
- Screenshot at 1600x900 and 1366x768 shows the whole map above the panel, no overlap of tags with the panel.
