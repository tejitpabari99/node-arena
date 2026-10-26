---
status: approved
summary: Editor chrome polish brief — File/Share menus, editorVersion, Google-Maps-style map controls, neutral theme; decision log.
date: 2026-10-26
---

# Brainstorm: Editor chrome polish

## Idea
Rework the level editor chrome (not the game UI): a cleaner top bar (Back + File left; status, Play, Share right), automatic level versioning and autosave, a polished left panel (read-only level id, human parameter labels with tooltips), Google-Maps-style vertical map controls, and a neutral modern theme replacing the Coiny "main-menu" look. Reference shots: `before/` (current), `ref/canva.png` (Share panel), `ref/gmaps.png` (map controls).

## Decision log
| # | Topic | Decision |
|---|---|---|
| 1 | Base | `origin/main`; custom-level-fix already squash-merged as #24 |
| 2 | Top-left | Back + File menu. File: Create, Duplicate, Open, Undo, Redo |
| 3 | Create dialog | Level id; Theme + Size box; "or"; copy existing; Create button |
| 4 | Duplicate / Open | Duplicate = server copy; Open = dialog |
| 5 | Top-right | Canva-style Share panel: Save; Finalize; Check; version |
| 6 | Finalize | Plain row (no dropdown); saves first; no gate |
| 7 | Check | Spinner, then toast with Details, then results popover to the left; no persisted checkmark |
| 8 | Save status | Plain text "✓ Saved", green check, no box |
| 9 | Play | Kept |
| 10 | Versioning | `editorVersion` 0.0.N; bump on every real save incl. autosave; no-op when unchanged; new/copies 0.0.1; missing shows 0.0.0 |
| 11 | Autosave | 30s |
| 12 | Left panel | Level id read-only above name; param human labels + tooltips; troop read-only |
| 13 | Back | Confirm if unsaved |
| 14 | Map controls | Google-Maps-style vertical stack, top-right |
| 15 | Theme | Neutral, Inter/system 13px, no Coiny, accent blue, green for success only |
| 16 | Gutter contract | `--ed-controls-gutter: 56px` in SP01 tokens; controls z3; popovers z `--ed-z-pop` (5); right-anchored panels keep `right >= gutter` |
| 17 | Font / accent | No webfont; accent `#2563c9` tuned in screenshot review; 56px bar stays |
| 18 | schemaVersion | No bump |
| 19 | Duplicate when dirty | "Save & duplicate / Cancel" only |

## Non-goals
Real sharing/collaboration, level rename/delete, persisting check results, game UI changes.

## Field meanings (Q&A)
- `maxLevel`: highest upgrade level the building can reach.
- `troop`: unit type the building produces/holds; shown read-only (humanized id, e.g. "Soldier").
- `lineSpawnPenalty`: spawn-rate penalty applied when units are sent along a line (tooltip wording follows GAME_RULES/defs).
- `growTime`: time for the building to grow/produce its next unit/step (units per defs: seconds/cells).
- `ignoreForWin`: if set, the building does not count toward the win/lose condition.
