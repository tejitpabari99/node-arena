---
status: draft
summary: 10 tasks (5 M1, 5 M2) delivering symmetric Duel S/Duel M/Cross pvp levels, symmetry gate, pvp branch in validate:levels, self-play fairness report/smoke, listing helper and minimal editor routing.
date: 2026-10-28
---
# Tasks: PvP maps
Source of truth: docs/agent_files/feat-pvp-20261028-1435/03-pvp-maps/PRD.md. Campaign level checks and locks must stay byte-identical; only pvp levels get new gates. No [OPEN] items in the PRD. SP01 refs: SP01#3 (pvp level validation, `team`, 480 s default), SP01#8 (pvp outcomes), SP01#10 (golden/lock refresh).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | [M1] Symmetry checker + sidecar | SP01#3 | todo |
| 2 | [M1] Duel S level + pvp campaign + levels-gate listing | 1 | todo |
| 3 | [M1] validate:levels pvp branch + lock outcomes | 2, SP01#8 | todo |
| 4 | [M1] Self-play fairness: balance mode + gated smoke (Duel S) | 3 | todo |
| 5 | [M1] Versions, locks, LEVELS_GUIDE PvP section | 3, 4, SP01#10 | todo |
| 6 | [M2] Duel M level | 5 | todo |
| 7 | [M2] Cross level + 2v2 smoke | 6 | todo |
| 8 | [M2] listPvpMaps helper | 2 | todo |
| 9 | [M2] Editor routing for pvp levels | 2, 8 | todo |
| 10 | [M2] Editor finalize: symmetry + pvp outcomes | 3, 9 | todo |

## Task 1 — [M1] Symmetry checker + sidecar
What it is / what it means: Machine-checked fairness so owner editor edits cannot silently break symmetry (R5, R7, D2, D3).
What changes at a high level: Add `tools/src/pvp-symmetry.ts` with `checkSymmetry(level, kind)` and sidecar `tools/pvp-symmetry.json` (`d2` for Duel S/M, `d4` for Cross; entries for all three ids, files arrive later). d2 = identity, x-mirror, z-mirror, rot180; d4 = 4 rotations plus axis/diagonal mirrors. Transforms operate on milli-unit integers (no tolerance). Each must map buildings (pos, archetype, level, params, ignoreForWin), elements (pos, archetype, variant, params), bounds and per-seat owner onto themselves; seat permutation is derived by matching homes. Failure reports first offender id + transform. Unit tests with hand-built symmetric fixtures plus mutated copies (0.001 nudge, swapped owner, wrong level) must fail.
Done when: tools tests green; checker not yet wired into the CLI.

## Task 2 — [M1] Duel S level + pvp campaign + levels-gate listing
What it is / what it means: The first playable map and its listing (R1, R4, R5, D1, D6, D7).
What changes at a high level: Author `packages/content/data/levels/na-pvp-duel-s.json` (copy `levelview-3-ab.json` shape): objective `pvp`, 2 human placeholder players without bot, distinct colorKeys (blue/red), bounds, green theme, homes at (+-6,0) L12, four L3 neutral houses and centre L6, `timeLimitSec: 480`, all `ignoreForWin=false`, `requires` recomputed. Add `campaigns/pvp.json` (`id: pvp`, entry position 1). Extend `tools/src/levels.ts` `campaignLevels` union with pvp and add `pvpLevels()` accessor so the Common+custom==all-files check passes. Test: Duel S passes `checkSymmetry`; Common still 20 entries.
Done when: content loads; level schema/content validators accept it; existing `validate:levels` campaign results unchanged.

## Task 3 — [M1] validate:levels pvp branch + lock outcomes
What it is / what it means: Level gate accepts pvp maps without weakening campaign checks (R8, D5 of SP01 outcomes).
What changes at a high level: In `validateLevel` flow branch on objective `pvp`: (a) missing sidecar entry or symmetry failure fails; (b) all-idle seed 1 must end `draw`; (c) seeds 1..4 x delays 1000/2000, every seat a human-proxy bot via `runMatch`/`createSeatBot`: fail on rejected commands, non-termination (limit+margin) or rerun hash mismatch; (d) lock seed 1/delay 2000 outcome. Do not consult `humanSeat()`; `unsolved-by-proxy` allowlist not applicable. Extend `parseLevelsLock` outcome whitelist with `victory|timeLimit` (`draw` already allowed) and update `levels-output`. Tests for pass path and each failure mode (mutated level).
Done when: `pnpm validate:levels` green with Duel S; campaign path output byte-identical.

## Task 4 — [M1] Self-play fairness: balance mode + gated smoke (Duel S)
What it is / what it means: Report-only fairness view plus loose regression tripwire (R9, D5).
What changes at a high level: Add `pnpm balance --mode pvp` in `tools/src/balance*.ts`: all seats same proxy, seats rotated across seeds 1..40 and delays 1000/2000/4000; table of per-seat decisive win share, draws, mean duration per map. Add a gated smoke test (20 seeds): terminates with `victory|timeLimit|draw`, 0 rejected, rerun hash equal, seat decisive share within 20-80%; bounds only, never exact values. Seat-order bias is reported, not tuned.
Done when: smoke green for Duel S; report prints; campaign balance output unchanged.

## Task 5 — [M1] Versions, locks, LEVELS_GUIDE PvP section
What it is / what it means: Make M1 content gates green and documented (D8, Versions and locks).
What changes at a high level: After SP01 lands, bump `contentVersion` 2.3.4 -> 2.4.0 (relative to whatever SP01 left) in `content.json`; run `pnpm content:lock`, then `levels:lock --levels na-pvp-duel-s`. Bump `BOT_VERSION` only if `check:content` demands it (verify). Add a PvP section to `docs/LEVELS_GUIDE.md` (naming, symmetry sidecar, gates, how to add a map). Run sweep: `validate:content --base HEAD`, `check:content --base HEAD`, `check:schemas`, `check:manifest`, `check:docs`, `validate:levels`; confirm campaign lock entries and `campaign:verify` unchanged.
Done when: all listed gates green; owner can play-test Duel S once SP04/05 land.

## Task 6 — [M2] Duel M level
What it is / what it means: Larger 2-player map with satellites and a neutral tower (R2, R4, D6).
What changes at a high level: Author `na-pvp-duel-m.json` (snow, bounds 24x16, per-seat home L15 + two L5 satellites, neutrals per PRD: four L4, two L6, centre tower L5, two small obstacles, 14 buildings, 480 s). Add to `pvp.json` position 2. Tests: passes checkSymmetry (including elements); extend fairness smoke to it. Regenerate `content:lock` and `levels:lock` for the new id; bump content version only if the gate demands.
Done when: `validate:levels` and smoke green; neutral tower does not break proxy/determinism checks.

## Task 7 — [M2] Cross level + 2v2 smoke
What it is / what it means: 4-player D4 map with default teams `[0,1,0,1]` (R3, D2, D4).
What changes at a high level: Author `na-pvp-cross.json` (green, square bounds +-10, homes L12 on the four axes, seat k+1 = seat k rotated 90 deg, colors blue/red/green/yellow, neutral axis fronts L3, corners L5, centre house L8, 13 buildings, `players[].team` = `[0,1,0,1]`). Add to `pvp.json` position 3. Smoke: run 4-seat FFA plus 2v2 `[0,1,0,1]` and `[0,0,1,1]`, checking termination (ally-blocking/crossing stalls), 0 rejected, determinism, seat share bounds. Regenerate locks.
Done when: gates green; full M2 sweep from task 5 re-run clean; owner tuning noted as manual step.

## Task 8 — [M2] listPvpMaps helper
What it is / what it means: Single authoritative map list for server validation and lobby picker (R6).
What changes at a high level: Add `packages/content/src/pvp.ts` with `listPvpMaps(catalog)` returning `{id, name, seats, teams, timeLimitSec, theme}[]` in `pvp.json` order, using the compiled default teams (identity if absent), exported from the package. Tests: returns exactly shipped maps in order; Common still 20 and custom list unaffected; pvp ids absent from the single-player picker inputs.
Done when: content tests green.

## Task 9 — [M2] Editor routing for pvp levels
What it is / what it means: Owner can open, edit, save pvp maps in the dev editor (R10).
What changes at a high level: In `tools/src/editor-ops.ts` save routes to `pvp.json` when the id is listed there or `objective==='pvp'`, never `custom.json`. In `apps/web/src/editor/*` preserve `objective` and per-player `team` on round-trip (`toDraft`), label players "Seat N", hide Add AI / bot panel / proxy Check-Play for pvp and show "PvP: checked by validate:levels". Seat-count change, team pickers, mirror-edit helper stay deferred. Tests: open Duel S, edit a seat-0 building, save; file written, not in custom.json, objective/team retained.
Done when: editor unit tests green; existing editor tests unchanged.

## Task 10 — [M2] Editor finalize: symmetry + pvp outcomes
What it is / what it means: Finalize must catch asymmetric edits and not choke on pvp outcomes (R7, R10, risk "finalize/golden refresh").
What changes at a high level: Verify the Finalize chain (editor-finalize, golden refresh path) with a pvp level; add the symmetry check to its gate chain; fix any code assuming `humanSeat`, idle-human-loses or `victory`-only outcomes. Test: finalize on a nudged Duel S reports the symmetry failure; clean finalize passes and updates locks.
Done when: finalize tests green, campaign finalize behaviour unchanged.

## Manual steps (owner)
- Play-test Duel S (M1 gate), then Duel M/Cross; decide level/position/time-limit tuning.
