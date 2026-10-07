---
status: draft
summary: Web client — fixed-step driver over SP02 sim, generic manifest-driven Three.js renderer (instanced troops, component-driven overlays), input/cut gestures, Preact UI, versioned saves, audio, dev panel, Playwright tests
date: 2026-10-07
---
# PRD: Web Client (SP03)

Repo/branch: node-arena · feat/game-design · Depends on: SP01 (content, visual keys, manifest schema/types), SP02 (sim API/view/events)
Owns: `apps/web/**` (shell, driver, renderer, input, UI, audio, saves, dev panel, Playwright tests), `apps/web/assets/manifest.json` **schema usage + loader** (schema/types live in SP01 content), `tools` manifest-check hook. Does not own: sim, content schemas, bot logic (SP04), art selection/levels/CREDITS (SP05).

## TL;DR
- Thin imperative renderer reads `sim.view` + `readTroops` each frame; **everything visual resolves through `manifest.json`** (key → model/material/scale/tint/anim/sfx/fx). No tower/troop type is named in renderer code.
- Driver: rAF accumulator at 20 Hz, frame clamp, 1×/2×, pause, auto-pause on tab hidden. Renderer extrapolates troops `progress + alpha·speedPerTick` as SP02 specifies.
- Troops: one `InstancedMesh` per (troop visual × team), custom per-instance attribute `(x,z,yaw,phase)`, procedural vertex bob in a patched `MeshStandardMaterial` (no VAT in v1; spike gates it).
- Fixed auto-fit tilted camera (no pan/zoom v1). Count labels = DOM overlay driven by which components an archetype has.
- Saves: versioned `localStorage` + migrations. Dev panel edits content in memory → recompile → restart level; exports JSON.

## Problem
SP01/SP02 define rules and a headless sim. Something must make it look like a polished low-poly city game, feel responsive on a laptop (mouse/trackpad), stay readable with ~2,000 troops, and — user requirement — stay fully data-driven so reskins and v2 archetypes (archer) need no renderer rewrite.

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Brief ACs 1–8 demonstrable in browser | Touch layout, mobile, gamepad |
| Generic archetype/troop rendering from manifest | Per-type renderer code, hardcoded colours/models |
| 60 fps target on integrated-GPU laptop at 2,000 troops (guideline: <100 draw calls) | Skeletal/VAT animation, post-processing, LOD (v1) |
| Greybox playable with primitives, same pipeline as final art | Networking, prediction (v3), level editor, camera pan/zoom |
| Live tunables dev panel + JSON export | Shipping tuned values automatically (human commits JSON) |

## Requirements
1. **Driver** (`GameDriver`): `acc += min(dt, 250 ms)·speed`; `while acc ≥ 50 ms && steps < 5: sim.step(cmds)`; leftover beyond 5 steps dropped (no spiral). `alpha = acc/50`. Pause = no `step`; 2× = speed multiplier. `commands.tick = sim.tick` at submission. `visibilitychange` hidden → auto-pause (shows pause screen); never catch up.
2. **Bot hook**: `interface BotController { decide(view: SimView, sim: Sim, player: number): Command[] }`, invoked once per sim tick per bot player before `step`; commands pass `canDraw`-equivalent path (same `step`). SP04 supplies implementations; web only wires `level.players[kind=bot].botProfile → controller`.
3. **Screens** (state machine): `boot → menu → picker → loading → playing ⇄ paused → results`; `error` from any loading failure. Settings reachable from menu and pause.
4. **Renderer** consumes only `view`, `readTroops`, events, manifest. Details in Architecture.
5. **Input**: pointer events only; draw, swipe-cut, right-click cut, hover feedback (below).
6. **UI (Preact)**: main menu; level picker (all 20 selectable, completed marker, `order`/`name` from content); HUD (countdown timer from `timeLimitSec`, speed 1×/2×, pause, perf HUD toggle); pause (resume, restart, settings, quit); results (won/lost/timeout/draw, retry, next, menu); settings (music/sfx volume + mute, colourblind, quality, reduced motion). No ad/payment/energy UI anywhere.
7. **Saves**: versioned, migrated, corrupt-safe.
8. **Audio**, **dev panel**, **accessibility**, **tests** as below.

## Architecture

### Layout
```
apps/web/src/{main.tsx, app/state.ts, driver/, render/{scene,towers,troops,lines,labels,fx,camera}.ts,
  manifest/{load,resolve,validate}.ts, input/, ui/, audio/, save/, dev/}
apps/web/assets/{manifest.json, models/, audio/}
```
Rule: `render/` and `input/` know sim-view columns and component *names* only via registries, never archetype/troop ids.

### Manifest contract (SP05 must follow)
Schema/types exported by SP01 `content`; `additionalProperties:false`. Sections:
| Section | Content |
|---|---|
| `palettes` | `{default:{player.1..N, neutral}, colorblind:{…same keys…}}` hex; `teamMarkers` glyph per `colorKey` (secondary encoding) |
| `models` | `{id:{src:"models/x.glb"} | {primitive:"box|capsule|cylinder", size:[..]}}` |
| `visuals` | key → `{kind:'tower'|'troop', model, scale, yOffset, teamMaterial?, tint?, anim?, label?, fx?, sfx?}` |
| `themes` | level `visual` key → `{ground, sky, light{dir,color,intensity}, fog?, props?[]}` |
| `events` | sim event name → `{sfx?, fx?}` (e.g. `Captured`, `Clash`, `GameOver`) |
| `camera` | `{pitchDeg, fov, margin}` |
```json
"troop.regular": {"kind":"troop","model":"char.walker","scale":0.6,"teamMaterial":"Shirt",
  "anim":{"type":"bob","hz":2.2,"amp":0.12,"sway":6}},
"tower.standard": {"kind":"tower","model":"city.office-a","scale":1.0,"teamMaterial":"Accent","label":{"height":4.2}}
```
- Every key referenced by content (`archetype.visual`, `troop.visual`, `colorKey`, `level.visual`) must resolve; every palette defines every used `colorKey`.
- `teamMaterial` = GLB material name recoloured per team (loader merges primitives; those get `teamMask=1`, shader mixes team colour). A model with no such material gets a tinted base plate instead.
- Greybox = `{primitive}` models; swapping to GLB is a manifest edit only. `anim.type` values: `bob` (v1), `none`; `vat` reserved.
- Tools hook (SP04): `validate:manifest` = schema + key resolution + file existence + budgets (troop ≤ 300 tris, tower ≤ 5k, texture ≤ 1024²) + each `src` listed in CREDITS.md.

### Generic rendering
- **Towers** (≤ ~50, individual groups, not instanced): for each `view.towerStatic[i]` → `visuals[visual]` → clone model, materials cloned per owner colour; owner change (column `owner`) swaps team colour + marker + plays `Captured` fx. Neutral uses `palette.neutral`.
- **Component overlays**: registry `overlay[componentName]` built from the archetype's component keys (needs SP02 `towerStatic.components: string[]`, ask #1). v1: `garrison` → count label (reads `col['garrison.count']`), `drawsLines` → slot pips (`slots`, `lines`), `capturable` → none. A future `shoots` registers a radius ring in one file; unknown components without overlay are ignored (never error). Overlay params come from `visual.label`.
- **Labels**: one absolutely-positioned DOM layer; element per tower, `transform` set only when screen position changes (camera fixed → once per resize), text only when value changes. High-contrast chip (dark outline, team-tinted), min 14 px, billboards above model so tall buildings do not hide counts; clamp to viewport. Switch to instanced digit sprites if label cost > ~8% frame (best-practices threshold).
- **Troops**: `readTroops(buf)` into preallocated typed arrays; per troop: `t = min((progress + alpha·speedPerTick)/length, 1)`, position = lerp(from, to), yaw precomputed per channel, `phase = seq`. Write to the `(kind visual, owner)` mesh's `InstancedBufferAttribute` (x,z,yaw,phase); `mesh.count` = live; `frustumCulled=false`, fixed bounding sphere; capacity grows ×2. Vertex shader (patched `onBeforeCompile`): translate/rotate, `y += amp·|sin(2π·hz·time + phase)|`, roll sway. Troops do not cast shadows; towers + ground receive from one directional light.
- **Lines**: one flat ribbon per drawn line (`view.lines`, ≤ ~100) with scrolling chevron texture pointing source→target, team colour, drawn under troops. A→B and B→A are **laterally offset** (±line width/2) so both stay visible. Rebuild on `LineDrawn/LineCut`, not per frame.
- **Clash**: on `Clash{channel,progA,progB}` spawn spark/puff at `progA/length` along line (event carries progs, no sim query). Head-on troops visibly meet because both fronts extrapolate toward the same midpoint. `fx` defined in manifest `events`; fx pool preallocated.
- **Camera**: fixed perspective, pitch/fov from manifest, auto-fit to level tower bounds + margin on resize; no pan/zoom.
- **Quality** (`low|med|high`): pixel ratio cap 1 / 1.5 / min(dpr,2); shadow map off/1024/2048; antialias off/on/on.
- **Disposal**: per-level resources tracked in a `Disposables` scope; level change/restart disposes geometries, materials, textures, instanced meshes, DOM labels. Shared asset cache (by `src`, refcounted) survives. Test: `renderer.info.memory` returns to baseline after 20 level switches.

### Asset loading and errors
`resolveLevelAssets(level)` → set of visual/model/audio keys → parallel load (GLTFLoader + meshopt, `Audio` decode) with per-asset retries(2) and typed `AssetError{key, src, cause}`. Failure → `error` screen: which asset, **Retry** (reload failed only), Back to menu. Invalid manifest at boot → same screen with validation message.

### Input
- Picking: pointer → ray ∩ ground plane (y=0); tower hit = distance < `footprintRadius·pad` (data from view, not mesh raycast; works for any model).
- **Draw**: pointerdown on own tower with `drawsLines` → drag; preview ribbon follows cursor, snaps to hovered tower; on hover call `sim.canDraw(human, from, to)`: null = team-colour valid, else red + reason tooltip (`no-slot`, `duplicate`, …). Release on tower → `DrawLine`; elsewhere/Esc → cancel. Optional click-source-then-click-target equivalent (trackpad ergonomics).
- **Swipe-cut**: pointerdown on empty ground begins a stroke (trail effect); each pointermove segment tested (2D segment intersection in world space, ~8 px tolerance) against `view.lines` owned by the human → `CutLine` once per line per stroke.
- **Right-click cut**: `contextmenu` suppressed; nearest own line within 12 px of click → `CutLine`. Hover highlights the line that would be cut. Two-finger-tap on Mac trackpads fires `contextmenu`, so it works; swipe is the fallback.
- Input is blocked while paused/results; commands queued to next tick.

### Saves
Key `nodearena:save`: `{v:1, completed:{[levelId]:{firstAt}}, settings:{musicVol,sfxVol,musicMute,sfxMute,colorblind,quality,reducedMotion}, lastLevel}`. Keyed by level **id** (survives reorder). `migrations: Array<(old)=>new>` pure, tested with fixtures per version. Corrupt/unparseable/future version → copy raw to `nodearena:save.bak`, reset to defaults, show one-time notice. Completion recorded only on `won` and never while dev-tuned or in replay. Writes wrapped in try/catch (private mode → in-memory, notice).

### Audio
Thin WebAudio wrapper (no lib). SFX ids and event mapping from manifest `events`; voice cap (e.g. 8) + per-event cooldown so 2× clash spam stays pleasant. One looping music track; separate mute + volume; context resumed on first user gesture. CC0 only (SP05 supplies).

### Dev panel
Behind `?dev=1`. Inputs generated from content JSON Schema (balance globals, troop speed, archetype component params, level overrides). Edit → mutate in-memory content copy → `compileLevel` → restart level (sim never mutated mid-match); "tuned" badge; completion disabled. **Export** downloads edited JSON files. Perf HUD (also in settings): fps, frame p95, JS ms/frame, sim step ms, draw calls, triangles, troops live.

### Accessibility
Colourblind palette is data (`palettes.colorblind`, e.g. Okabe-Ito) **plus** non-colour marker glyph per team on tower base and label chip. Reduced motion: no bob/sway, no screenshake, shorter fx. Full keyboard on menus; `Esc` = pause; text ≥ 14 px; label contrast ≥ 4.5:1 via chip.

### Test plan (maps to brief ACs)
`?test=1`: fixed seed, rAF driver off, exposes `window.__na.{step(n),hash(),view}`; software GL; screenshot tolerance (≤ 1% px) on few scenes.
| Layer | Check | AC |
|---|---|---|
| Playwright flow | draw line, wait 30 s sim (stepped), assert troops continue, hash matches replay | 1 |
| Playwright | right-click / swipe cut → no new `TroopSpawned` on channel, in-flight arrive | 2 |
| Screenshots | tower before/after `Captured` (colour, label, lines) | 3 |
| Playwright | complete level, reload, picker shows marker, pick any of 20 | 4 |
| Playwright | retry/finish with no interstitial; DOM assertion for no ad/energy | 5 |
| Screenshots | greybox + final-art scenes (menu, picker, in-level), colourblind variant | 6 |
| Screenshot | head-on level at replay tick of first `Clash`: sparks at midpoint | 7 |
| Playwright | step to `timeLimitSec·20` → results "timeout"/lost | 8 |
| Unit (vitest) | driver (clamp, 2×, pause, hidden), save migrations, manifest resolve/validate, cut geometry | – |
| Perf | stress level, 2,000 troops: CPU JS/frame < 4 ms, draw calls < 100 (`renderer.info`); real-GPU fps check manual | – |
| Leak | memory baseline after 20 level switches | – |

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| 1 | Troop animation | Procedural vertex bob, custom instance attribute | VAT; SkinnedMesh; no anim | Cheapest, instanced, readable at distance; VAT only if spike says art needs it |
| 2 | Instancing granularity | Mesh per (visual × team) | Per-instance colour; one mesh | Matches brief; uniform team colour; few draw calls |
| 3 | Camera | Fixed auto-fit tilted | Pan/zoom; orbit | Levels authored to fit; simplest input (no gesture conflict with swipe-cut) |
| 4 | Labels | DOM overlay, update on change | CSS2DRenderer; sprites | Crisp text, a11y, cheap with ≤50 towers |
| 5 | Overlays | Registry keyed by component name | Per-archetype code | Generic; archer ring = one registration |
| 6 | Picking | Ground-plane distance vs `footprintRadius` | Mesh raycast | Model-independent, reskin-safe |
| 7 | Overlapping A↔B lines | Lateral offset | Overlap/dual-colour | Both directions visible |
| 8 | Hidden tab | Auto-pause | Catch up; run | Avoids burst/desync-feel |
| 9 | Placeholder art | `primitive` models in manifest | Separate greybox path | One pipeline; reskin = data |
| 10 | Dev panel edits | In-memory content → recompile → restart | Live sim mutation | Preserves determinism |
| 11 | Saves | Versioned JSON + migration array, keyed by level id | IndexedDB; keyed by order | Small data, reorder-safe |
| 12 | Audio | Own WebAudio wrapper | Howler | ~100 lines, no dep, manifest-mapped |

## Manual steps
- Real-GPU laptop playtest for 60 fps and readability sign-off (owner only).

## Risks / Open Questions
- [OPEN] Spike (before renderer lock): 2,000 bobbing instanced troops at 60 fps on integrated GPU; fall back to static-bob/no-bob or VAT.
- [OPEN] Team recolour of GLB via merged `teamMask` — verify with chosen CC0 pack (SP05); fallback: per-team texture/atlas.
- [OPEN] Label readability when buildings overlap in screen space on dense levels; may need height offset or declutter.
- [OPEN] Fixed camera vs large levels; if min label size unreachable, add zoom (DEFERRED otherwise).
- [OPEN] `BotController` signature and who runs bots (main thread v1) — SP04 to confirm.
- [OPEN] Playwright software-GL screenshot stability; fall back to structural asserts.
- [OPEN] Extrapolated front may briefly overshoot a clash point (< 1 tick); clamp to `length − progB` if visible.
- [RESOLVED: results copy] `draw` shown as "Mutual defeat — not completed" (answers SP02 UI wording).
- [DEFERRED] Pan/zoom, VAT/skeletal, instanced digit labels, sim in Web Worker, roads decor.

## Asks to other sub-projects
1. SP02: add `components: string[]` (or per-component presence) to `towerStatic`; expose `timeLimitTicks` in view/level; confirm `Clash` progs are channel-relative to source.
2. SP01: browser-safe `loadContent(objects)` + `compileLevel` (no fs); `level.visual` = theme key; export manifest schema/types; JSON Schema usable for dev-panel form generation.
3. SP04: `validate:manifest` runner calls web resolver; `BotController` signature.
4. SP05: follow manifest contract; keep tower/troop within tri budgets; pivots base-centre, 1 unit ≈ 1 m.

## Acceptance Criteria
1. Renderer contains no archetype/troop ids; adding a fixture archetype + visual key in data renders with no code change; changing a key's model/scale/tint in manifest reskins it.
2. `validate:manifest` fails on any unresolved key, missing palette colour, missing file, over-budget model.
3. Driver tests: clamp, 2×, pause, hidden-tab, split-step determinism (hash equal to unthrottled run).
4. Brief ACs 1–8 pass in Playwright/screenshot suite above.
5. Level switch ×20 leaves GPU memory counts at baseline; asset failure shows error screen and Retry recovers.
6. Stress level: draw calls < 100, JS/frame < 4 ms; spike report committed; manual laptop sign-off recorded.
7. Saves migrate from every fixture version; corrupt save resets with notice and `.bak`.
8. Dev panel edit of `generates.ratePerSec` changes in-game behaviour after restart; Export reproduces the JSON; completion not recorded while tuned.
9. Colourblind mode swaps palette and shows team glyphs.
