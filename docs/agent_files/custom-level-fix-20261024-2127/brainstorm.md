---
status: draft
summary: Rebuild the dev level editor as a full-screen Canva-style workspace (top bar, left panel, pan/zoom canvas, fixed 40x30 buildable area); fixes out-of-bounds blank render.
date: 2026-10-24
---

# Level editor — Canva-style workspace

## TL;DR
Rebuild the dev level editor (`apps/web/src/editor/`) as a full-screen Canva-style workspace: top bar, collapsible left panel (Level / Library / Selection), and a pan/zoom canvas with a fixed 40×30 buildable area. Restructure existing Preact components and extend `viewport-engine.ts` rather than rewrite. Fixes the out-of-bounds blank-render bug by clamping and auto-fitting bounds. Adopts the main menu's look.

## Problem
Current editor (see `before/`) is a narrow dark page: stacked status text, boxed Level properties, button-list library, long sidebar with mirror/LOS/layout tools, small viewport, no real pan, tiny placement area. Dragging a building outside the dashed bounds commits an invalid position → validation error "Building position lies outside bounds" → 3D preview goes blank (only outline). "Start screen" discards the draft with no way back. Items are labelled by internal id (template's neutral building is `crossing`). For: the owner authoring custom levels locally.

## Decision log
| Decision | Alternative rejected | Why |
|---|---|---|
| Stay on branch custom-level-fix / PR #24 | New stacked branch | Owner preference |
| Restructure existing components; extend viewport-engine | Rewrite around a central store | Reuses tested reducer/history/api/validation; no user-visible gain from rewrite |
| Full-viewport layout: top bar + left panel (~300px) + canvas | Current centered max-width page | Canva-like; see whole map |
| Main-menu look: sky gradient #73c7e6→#ccecf2, Coiny headings/buttons, system-ui form text, green primary buttons | Current dark slate theme | Consistency with game; readability for forms |
| Fixed buildable area 40×30, outlined, centered on level | Resizable bounds handles; 60×40; per-level S/M/L | ~2× largest campaign level (21×15); bigger makes in-game units tiny (camera fits all buildings) |
| Drops/moves clamped to buildable area; level `bounds` auto-fit (existing 2-unit margin) after every edit | Manual bounds / auto-fit button | Preview never invalid; blank-render bug can't recur |
| Save and Finalize stay separate buttons | Save runs Finalize | Finalize runs 6 pnpm steps (locks, bot build, content checks) — slow |
| Autosave every 5s when dirty AND valid, only after first manual Save; never finalizes | Autosave immediately | Avoid junk na-custom-N files from abandoned "Create custom level" |
| Save chip: Saved ✓ / Saving… / Unsaved / Can't save · N issues (click lists issues) | Status text lines, lock details, draft summary | Plumbing not needed on screen |
| File modal (New blank / Copy level / Open custom) opened from level name; confirm on unsaved; shown standalone when nothing open | Start screen page; File section in left panel | Canva-like; fixes "can't get back" |
| Pan: Space+drag, middle/right drag, hand-tool toggle; wheel zoom; left-drag empty = marquee | Scroll-to-pan | Keep marquee on left-drag |
| Zoom: min = whole area fits, max ≈ 4× game camera, default = midpoint; +/− disabled at limits; no zoom % | Show zoom % | Owner preference |
| Canvas controls top-right: −, +, Fit area, Game camera, Hand, Show grid | Sidebar View section | Canva-like |
| Snap always on (0.25 units / 15°); Show grid toggle instead | Snap toggle | Owner preference |
| Library: thumbnail grid rendered offscreen once from game art (Three.js) | Flat icons | Matches canvas; renderer exists |
| Level section: collapsible, no box; name, theme, time limit, player cards, Add AI, green Apply | Boxed details form | Smaller, cleaner |
| Player cards: Human (color only, kind fixed, label "Human"), AI1..AI3 (color, action delay, behavior, kind fixed); collapsed shows tag chip + color swatch + delete; expanded shows delete inside | Kind selector per player | Exactly 1 human first; 1–3 AI (captureAll aiMax=3) |
| Add AI picks next unused color; disabled at 3 AIs | Free | Game limit; unique colors required |
| Deleting an AI: its buildings → Neutral, confirm with count; display labels renumber, internal ids stable | Block delete while owning | Simpler for user |
| Selection section: dropdown of all items with friendly labels (e.g. "Neutral tower 1", "AI1 house 2") + "Multi-select" entry; synced with canvas clicks | Internal-id labels | `crossing`/`b0` confusing |
| Building groups: Owner & level; Parameters; Line of sight. Obstacle group: Shape (variant, rotation, footprint). All groups closed by default; each its own green Apply; Copy/Paste/Delete below | One long form | Future groups slot in |
| Multi-select: "N selected", Select all, Clear, Copy, Paste, Delete (multi-delete new) | Separate Layout section | Single place |
| Top bar: left ← Game, level name, Undo/Redo; right save chip, Check (Solvable?), Finalize (spinner, log popover), Play, Save (green) | Current toolbar | Canva-like |
| Remove mirror tools, auto-fit button, pointer coordinates, render-time status | Keep | YAGNI |
| Shortcuts: Del/Backspace, Ctrl+C/V, Ctrl+Z / Ctrl+Shift+Z, Ctrl+S, Space pan, Esc clear | None | Cheap, Canva-like |
| All apply/submit buttons green | Blue | Owner preference |

## Design
| Part | Responsibility |
|---|---|
| Shell | Full-viewport grid; theme tokens |
| TopBar | Actions + save chip + Finalize popover |
| FileModal | New/Copy/Open; unsaved confirm |
| LeftPanel › Level | Level props + player cards |
| LeftPanel › Library | Offscreen thumbnails; drag to place |
| LeftPanel › Selection | Item dropdown, property groups, copy/paste/delete, multi-select |
| Canvas (viewport-engine) | Buildable-area outline, clamp, auto-fit bounds, pan/zoom limits, grid overlay, controls, shortcuts |
| Autosave | 5s timer, dirty+valid, post-first-save |

Sub-projects (sequential): 1) Shell + TopBar + FileModal + theme + autosave; 2) LeftPanel sections; 3) Canvas.

Verification: unit tests (clamp, auto-fit bounds, multi-delete, AI delete → Neutral); updated Playwright e2e; screenshots vs Canva-style references in `ref/`.

## Non-goals
Phone/tablet layout; resize/rotate handles on canvas; new objectives or >1 human; mirror tools; changes to the game's main page; multiple levels open at once.

## Open risks
| Risk | Cheapest test |
|---|---|
| Auto-fit bounds changes bounds of copied imported levels → may alter play | Diff bounds before/after auto-fit on a copy of each campaign level |
| Offscreen thumbnail render cost at load | Time it |
| Autosave racing a running Finalize | Pause autosave while Finalize/Check runs |
| Canvas pan/zoom conflicts with marquee/drag gestures | e2e covering each gesture |
