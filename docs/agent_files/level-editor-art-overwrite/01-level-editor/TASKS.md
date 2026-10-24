---
status: done
summary: 12 tasks, P0 custom-list contract first (unblocks 02), then editor viewer/Save, editing tools, Play/Solvable/Finalize, Edit buttons and docs.
date: 2026-10-24
---
# Tasks: Level editor
Source of truth: docs/agent_files/level-editor-art-overwrite/01-level-editor/PRD.md. Dev-only editor page plus a `custom` campaign list shown below the 20 Common levels. Tasks 1-2 are the self-contained P0 contract; sibling 02-art-overrides can start after them.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Custom list: app state, picker, unlock, next | - | done |
| 2 | Custom list: tooling union, lock merge mode, trial level | 1 | done |
| 3 | Editor shell, dev gate, read-only middleware | 2 | done |
| 4 | Edit viewport and picking | 3 | done |
| 5 | Save: canonical write, checks, round-trip | 3, 4 | done |
| 6 | Doc model, undo/redo, library drag-drop | 4, 5 | done |
| 7 | Forms and script-removal banner | 6 | done |
| 8 | Editing tools: select, copy, mirror, snap, fit, LOS | 6 | done |
| 9 | Play overlay via real runtime | 5, 6 | done |
| 10 | Solvable? | 5 | done |
| 11 | Finalize | 2, 5 | done |
| 12 | Edit buttons and docs | 9, 11 | done |

## Task 1 — Custom list: app state, picker, unlock, next
What it is / what it means: R6 app-side contract (D3). `data/campaigns/custom.json` (campaign schema, id `custom`) lists custom levels; absent file means none. 02 relies on this exactly.
What changes at a high level: `AppSnapshot` gains `customLevels` built from `catalog.campaigns.custom` sorted by position; `levels` stays Common. Custom levels are always unlocked, and `next()` walks custom entries, ending with no `hasNext`. Picker keeps the 20-card grid (now `.level-grid.campaign`) and adds a "Custom levels" section (`.level-grid.custom`, cards labelled by level name), hidden when empty. Existing 20-card assertions switch to the new selector.
Done when: with and without a custom file the picker renders correctly; unit tests cover unlock, next/last, and snapshot shape; updated e2e/state tests still show exactly 20 campaign cards; unlock chain and `number = position-3` are unchanged.

## Task 2 — Custom list: tooling union, lock merge mode, trial level
What it is / what it means: R6 tools row plus resolved Open Questions 1, 2, 5, 6; D4, D5. Makes the gates accept custom levels and proves it with one hand-made level.
What changes at a high level: `campaignLevels` still returns exactly Common but its integrity check becomes files = Common plus custom entries; add `customLevels`. `validate:levels --levels all` covers both. `levels:lock` writes `na-*` entries and gains a `--levels <id>` merge mode that re-runs only the named levels. `unsolved-by-proxy.json` and the position argument become optional for custom ids (reporting only). Add one trial `na-*` level plus its custom entry, locks, and the contentVersion/BOT_VERSION bumps (including an AI seat) to verify the gates.
Done when: `pnpm test`, `validate:levels`, `levels:lock`, `validate:content --base HEAD`, `check:content --base HEAD` are green with the trial level; the Common-20 assertions still pass; merge mode leaves other lock entries byte-identical; the BOT_VERSION behaviour is confirmed against the trial.

## Task 3 — Editor shell, dev gate, read-only middleware
What it is / what it means: R1 start/gating and R2 security with list/read endpoints (D11). Owner-only tool, never in prod.
What changes at a high level: `editor.html` plus an editor Preact entry, registered as a build input only under `VITE_TEST_HOOKS==='1'`. A serve-only Vite plugin handles `/__editor/*` list and read, with `127.0.0.1` binding, Host check, `X-NA-Editor` + same-Origin check on POST, id regex, path containment, 1 MB cap, and no shell child processes. Start screen offers Blank (theme, size, 2 players), Copy of any level, Reopen `na-*`; levelview and na copies prompt a new id.
Done when: `/editor.html` loads under `pnpm dev` and is absent from `pnpm build`; middleware tests refuse non-localhost Host, missing header or Origin, bad ids and path escape; levels can be listed and opened.

## Task 4 — Edit viewport and picking
What it is / what it means: R3. The editor shows the real game view of the working level.
What changes at a high level: reuse `createLevelScene` with a `SimView` from a preview sim; rebuild via `setLevel` on structural edits; copy the `groundAt` math (D10); building picking via pick meshes, obstacle picking by nearest footprint on the ground hit (D6), and marquee on empty ground. Editor-only zoom/pan and game-camera framing. Coordinates are rounded to 0.01.
Done when: any of the 20 levels opens and renders matching the game; clicking selects the right building or obstacle; unit tests cover pointer-to-ground and obstacle picking; rebuild time is measured and recorded.

## Task 5 — Save: canonical write, checks, round-trip
What it is / what it means: R2 save, R1 inline errors, Goal 1; `tools/src/editor-ops.ts`.
What changes at a high level: `POST save` validates with `validateLevel`, canonicalizes (key order, `computeRequires`, id = filename, `source` dropped on copy, `JSON.stringify(...,2)+"\n"`), writes `na-<id>.json`, and upserts the `custom.json` entry (auto position = max+1; file created on first entry). Blocking errors show inline per item and write nothing; overlap and element-OOB are warnings. `levelview-*` and non-`na-` overwrite are refused. Save button in the editor.
Done when: a test opens all 20 levels and Save-as-copy output equals source modulo id/`source`, byte-stable; error saves write nothing; the custom file is created and updated correctly; the middleware rejects `levelview-*` writes.

## Task 6 — Doc model, undo/redo, library drag-drop
What it is / what it means: Architecture doc model and R1 library (D8). The editing core.
What changes at a high level: `LevelDoc` with pure reducer ops (place, move, delete, and so on) and a bounded 100-snapshot undo/redo stack, with drag coalesced to one entry. Library of `house-wt1`, `house-wt2`, `tower`, small and big obstacles dragged onto the view; dropped items are neutral with archetype default level. A ghost shows during drag and a rebuild runs on release.
Done when: reducer unit tests cover place, move, delete, undo and redo; dragging places items at the correct data coordinates; edits survive rebuilds.

## Task 7 — Forms and script-removal banner
What it is / what it means: R1 forms and delete rule; no JSON box.
What changes at a high level: level form (name, theme, fixed `captureAll`, timeLimitSec, players with colorKey, kind, bot `actionDelayMs`/`behavior`), building form (owner, level, `ignoreForWin`, per-building `params`), obstacle form (variant, yaw, footprint). Deleting a building referenced by a bot script removes that player's script as one compound undo step and shows a top banner such as "AI 2 script removed".
Done when: form commits update the doc and the preview; unit test covers delete-with-script and its undo; Save passes after the removal; banner shows.

## Task 8 — Editing tools: select, copy, mirror, snap, fit, LOS
What it is / what it means: R1 tools and Architecture Mirror, Auto-fit, Open Question 4 (D7).
What changes at a high level: multi-select move, copy/paste, mirror about a chosen axis (default vertical centre, horizontal option) with yaw reflect and an opt-in owner swap, applying to the selection or the whole level; grid snap (position 0.25 default, toggleable; yaw 15 degrees); auto-fit bounds via `boundsFromPositions` plus margin (preview until Save); line-of-sight preview using `canDraw`/`explainDraw` on the preview sim.
Done when: reducer tests cover mirror coordinates and yaw (both axes, with and without swap), copy/paste, and snap values; auto-fit and LOS show in the view.

## Task 9 — Play overlay via real runtime
What it is / what it means: R4 (D1, D2, D9). Tweak-Play loop with no drift from the real game.
What changes at a high level: a Play button mounts `createAppController` and `createBrowserRuntime` as a full-screen overlay. `options.files` is the shipped files plus the working copy as `na-<id>.json` and a synthetic `custom.json`; `campaignId` is `custom` and the save store is in-memory. The editor tears down on screen `picker` (pause menu "Levels") and has a "Back to editor" button; edit state stays intact. Measure the loadContent cost and record it.
Done when: e2e flow new level, place buildings, Save, Play to a win/lose result, back, reload shows the level in the custom section, always unlocked; the real save store is not polluted; same-seed state hash equals a main-game start of the same level.

## Task 10 — Solvable?
What it is / what it means: R2 `POST solvable`.
What changes at a high level: endpoint runs `validateLevel` proxy bots for one level, streams the result, one job at a time (second request refused or queued), via fixed-argv execFile where a process is used. Editor button shows the progress and the result as evidence only.
Done when: a known-solvable level and a deliberately unsolvable one report correctly; a concurrent request is rejected cleanly; middleware tests cover this.

## Task 11 — Finalize
What it is / what it means: R5, resolved Open Question 1. One click to a committable state, never an auto-commit.
What changes at a high level: `POST finalize` runs validate level, patch-bump `contentVersion`, bump `BOT_VERSION` when the bots hash map changes, `content:lock`, `levels:lock --levels <id>`, then `validate:content` and `check:content --base HEAD`, then prints the `git diff --stat`. Output is shown per step, aborts on first failure, and bumps are skipped if already bumped vs HEAD. Also an "unfinalized changes" banner via a validate:content dry-run.
Done when: on a fresh new-level edit, Finalize leaves `pnpm test`, `validate:levels`, `check:content` and `validate:content` green; a second run changes nothing; a forced failure aborts and shows the step; nothing is committed.

## Task 12 — Edit buttons and docs
What it is / what it means: Edit buttons (R1 plus acceptance) and docs (Owns list; Risks "guide still says put na- in common").
What changes at a high level: dev-only Edit button on the main page and on each picker card, opening the editor on that level and absent in production build. Update LEVELS_GUIDE §4/§6 (na-* goes in `custom.json`, supersedes the common step), `tools/README.md` (`--levels`, union, editor-ops), and add the FUTURES entry for deferred items (script editing, delete UI beyond v1.1, reorder, hot reload).
Done when: the Edit buttons open the right level under `pnpm dev` and are absent from the build; `pnpm check:docs` is green; all PRD acceptance criteria are verified end to end.

## Closing note — manual steps (PRD)
- Owner reviews `git diff` after Finalize and commits (tools never commit).
- Owner plays and signs off solvability; proxy is evidence only.
- No owner-only art/credits work here.
