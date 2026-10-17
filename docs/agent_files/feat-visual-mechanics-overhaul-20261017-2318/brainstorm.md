---
status: draft
summary: v1.1 — re-skin Node Arena as a Tower War clone (diorama, painted towers, ribbon lanes, chibi troops), visible head-on clash, bot churn fix
date: 2026-10-17
---

# Node Arena v1.1 — Visual & Mechanics Overhaul Brief

## 1. TL;DR
v1 plays correctly but doesn't look or feel like the games it copies. v1.1 re-skins it as a close **Tower War: Tactical Conquest** (SayGames) clone: bright grass diorama with dressed edges, a steep camera, team-painted stacked towers with the count on the roof, translucent team-ribbon lanes with chevrons, and chunky chibi troops. Head-on attacks show as one shared lane with a visible brawl at the meeting point. Bots stop cutting and redrawing lines over and over. Game rules don't change. The work runs in an env with vision and Playwright, iterating against committed reference images until the user signs off at the end.

## 2. Problem
From the user's playtest (`ref/v1_playtest_1.png`, `ref/v1_playtest_2.png`):
- Count cards are about 3× the size of the buildings; buildings are tiny and grey.
- The board is a flat grey plane floating in a light-blue void, with a stray road slab hanging off it.
- Lines are thin dashes; troops are barely visible.
- A→B plus B→A shows as two overlapping dashed lines, not a clash.
- The bot keeps cutting and redrawing lines ("keeps changing the nodes"). Cause: `packages/bots/src/utility.ts` re-scores every 0.8–3.5 s with no minimum line lifetime, and noise of 0.1–0.35 flips close decisions.

## 3. Decision log
| Decision | Alternative rejected | Why |
|---|---|---|
| Visual target: clone Tower War | City Takeover clone; city hybrid; v1 "modern low-poly city" | User: Tower War is closest |
| Camera: steep (~65°), landscape; green play area centred, sand/rock/prop border fills the sides | Portrait column with blurred sides | Laptop landscape target |
| Ground: full-bleed bright grass diorama; edges dressed with trees, rocks, crates, tires; no visible board edge or void | Floating plane | Matches reference; fixes "no background" |
| Towers: whole tower in team colour (grey = neutral); one floor per count band (e.g. each 10 troops, max 5 floors); white outlined count on the roof plus 1–3 slot dots; "Max" at cap | Floating label cards | Reference look; readable |
| Colourblind mode: shape glyph on the roof | Glyph on every card | Keeps default look clean |
| Lines: straight, flat, translucent team-tinted ribbon about 1/3 of a tower's width, white chevrons for direction, slightly darker edges; builds outward from the source when drawn | Asphalt with lane markings; dashed lines | What both reference games use |
| Head-on clash: A→B + B→A render as ONE lane, split by colour at the live meeting point; troops brawl there (puff FX + small clash marker) | Two overlapping lines; tug-of-war rule | Sim already computes the meeting point; visual-only change |
| Other crossing lanes simply overlap | Merge or avoid | Reference behaviour |
| Troops: chunky CC0 chibi characters in team colour, single file | Current troop models | Current ones unreadable |
| Art: towers, lanes and ground made in code; props from CC0 packs (Kenney Nature Kit etc.) | All CC0; custom art | Easy recolouring; free |
| One theme (grass + sand/rock border) for all 20 levels; theme is a level/data field | Theme per band | YAGNI; other themes in docs/FUTURES.md |
| HUD Tower War style: top-centre level pill with team-strength bar (troop share per team), small round pause and 1×/2× buttons in corners; help text only as first-level tip | Current dark panel + help bar | Reference look |
| Menu and level picker: palette restyle only | Full redesign | Cheap consistency |
| Bot churn fix: minimum line lifetime ~8 s unless source is in danger; cut only when cut score beats keep score by a margin; reduce noise influence on near-ties | Leave as is | Bot keeps cutting and redrawing lines |
| GAME_RULES.md mechanics unchanged; bot change lives in bot params/code; golden replays that use bots get regenerated | Rule changes | User: rules OK for now |
| Slice-first gate: L1 rebuilt fully and iterated against refs until it passes, then rolled out to all 20 levels | All levels at once | Cheapest way to learn the look is wrong |
| Iteration loop: Playwright captures fixed scenes (L1, L10, L18, clash fixture); a vision agent scores them against `ref/` on a checklist; keep iterating, no per-task approval; user approves once at the end | Per-task human approval | User preference |
| Perf: 60 fps on laptop integrated GPU at L18 (perf HUD); if chibi troops miss it, fall back to simpler troop models | No budget | Many marching units |
| Cut: tank factory, watchtower, boosts, new SFX, layout/balance changes | Include | v2 scope; recorded in FUTURES.md |

## 4. Design
### Parts
| Part | Change | Files (current) |
|---|---|---|
| Environment | Grass diorama, sand/rock border, CC0 props scattered procedurally (seeded, outside tower/lane keep-out zones), sky/clear colour, soft shadow, camera rig at ~65° fitting level bounds into landscape viewport | `apps/web/src/render/scene.ts`, `camera.ts`, `apps/web/assets`, `docs/CREDITS.md` |
| Towers | Code-built stacked floors in team colour; floor count from count bands; roof decal/canvas texture with number + slot dots + "Max"; capture recolour pop | `render/towers.ts`, `labels.ts`, `model.ts` |
| Lanes | Ribbon mesh + scrolling chevron texture; build-out animation; merged shared-lane renderer for opposed hostile pairs with split at live meeting point | `render/lines.ts`, `overlays.ts` |
| Troops | CC0 chibi model, instanced, team tint, walk bob; brawl cluster + puff at clash point; LOD fallback | `render/troops.ts`, `troop-material.ts`, `fx.ts` |
| HUD/menus | Level pill + team-strength bar, round pause/speed buttons, first-level tip; palette restyle of menus | `apps/web/src/ui/App.tsx`, `style.css` |
| Bots | Line-commitment (min lifetime, cut margin, noise damping) as profile params with schema update; regenerate affected golden/bot evidence | `packages/bots/src/*`, `packages/content/data/bots`, `schemas` |
| Visual QA harness | Playwright spec capturing fixed scenes at fixed ticks (paused, deterministic seed) to `apps/web/e2e/visual-out/`; checklist file the vision agent scores against | `apps/web/e2e`, `test-harness/` |

### Flow
The sim is unchanged → the renderer reads state + events. The meeting point of an opposed pair is derived from the oldest troop on each channel (front progress), so the renderer needs no new sim data. If it does need a helper, add a read-only selector in sim that is not part of the hash.

### Verification
- **Visual checklist** (each item scored 0–10 vs `ref/`, pass ≥ 8): steep camera; no void or board edge visible; edge props present; towers team-painted and large (≥ 6% viewport width); roof count readable at 1080p; slot dots visible; lanes ribbon + chevrons; single shared lane on head-on with visible brawl; troops readable; HUD pill + strength bar; saturated palette.
- Existing unit/property/golden tests stay green (bots-related goldens regenerated deliberately).
- Bot churn metric: in headless runs, each bot's cut-then-redraw count per minute drops ≥ 80% vs v1 with win rates within the existing `tools/balance-targets.json` bands.
- L18 perf at 60 fps via perf HUD.

### Build order
1. Visual QA harness + checklist.
2. Bot churn fix (independent; can run alongside).
3. L1 slice: environment → towers → lanes + clash → troops → HUD; iterate to pass.
4. Roll out to all levels, plus menu restyle and perf pass.
5. User final review.

## 5. Non-goals
Rule changes; new tower types (tank factory, watchtower), boosts or other power-ups; new SFX; level layout or balance edits; extra themes; mobile/portrait; multiplayer.

## 6. Open risks
| Risk | Cheapest test |
|---|---|
| CC0 chibi troops don't match the Tower War look or are too heavy | Slice L1 with one pack; perf HUD at L18 |
| Roof numbers unreadable at steep angle with many towers | L18 screenshot at 1366×768 |
| Shared-lane split point jitters (front changes discretely) | Smooth the split point in the renderer; clash fixture capture sequence |
| Vision scoring drifts or is too lenient | Fixed checklist + side-by-side composite images; user final review |
| Bot fix changes difficulty curve | `validate:levels` + balance runner before/after |
