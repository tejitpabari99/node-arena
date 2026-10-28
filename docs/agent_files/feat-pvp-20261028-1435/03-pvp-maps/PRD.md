---
status: draft
summary: Three exactly-symmetric PvP maps (Duel S, Duel M, Cross) as na-pvp-* level JSON in a new `pvp` campaign list, with a gated symmetry check, a bot self-play fairness smoke, pvp-aware level gates and minimal editor routing.
date: 2026-10-28
---
# PRD: SP03 PvP maps
Repo/branch: node-arena / `feat/pvp` · Depends on: 01-seat-rules (`pvp` objective, level `team`/`timeLimitSec`) · Consumed by: SP04 (map list, server validation), SP05 (lobby map picker, seat colors)
Owns: `packages/content/data/levels/na-pvp-*.json`, `packages/content/data/campaigns/pvp.json`, `packages/content/src/pvp.ts` (list helper), `tools/src/{levels,levels-output,pvp-symmetry}.ts` + `tools/pvp-symmetry.json`, `tools/levels-lock.json`, `packages/content/{content.json,hashes.lock.json}`, `tools/src/editor-ops.ts` + minimal `apps/web/src/editor/*`, tests, `docs/LEVELS_GUIDE.md` PvP section.

## TL;DR
- Maps: `na-pvp-duel-s` (2p, M1), `na-pvp-duel-m` (2p, M2), `na-pvp-cross` (4p, default teams `[0,1,0,1]`, M2). Houses (Duel M and Cross add one neutral tower), all `ignoreForWin=false`, explicit `timeLimitSec: 480`.
- Symmetry is machine-checked: Duel = mirror in x AND z (D2), Cross = full D4 (4-fold rotation + mirrors). So any lobby team assignment is fair.
- Listing: new campaign file `campaigns/pvp.json`; lobby enumerates it via `listPvpMaps()`. Not in Common, not in the custom picker.
- Gates: `validate:levels` gets a pvp branch (symmetry, all-seat proxy matches, lock); fairness self-play is report-only in `pnpm balance` plus a loose gated smoke.

## Problem
Campaign maps are asymmetric (human vs AI) and the validator assumes one human, idle-human-loses and proxy-wins [verified: tools/src/levels.ts `validateLevel`, `humanSeat`]. PvP needs maps where every seat has identical geometry and stats, and the content/level gates must accept them without weakening campaign checks.

## Goals / Non-Goals
Goals: 3 fair playable maps; one authoritative list; symmetry cannot silently rot (owner edits in the editor); content gates green; editor can open/save/finalize them.
Non-goals: new archetypes/art (reuse `house-wt1`, `tower`, `obstacle`) [verified: data/buildings, data/elements]; balance tuning beyond M1/M2 play-tests; map votes/rotation; per-seat camera rotation (SP05); full editor seat/team UI.

## Requirements
| # | Requirement | M |
|---|---|---|
| R1 | Duel S: bounds x[-9,9] z[-5.5,5.5], theme green. Homes `(±6,0)` L12 (stage 2, 2 slots). Neutral houses: four at `(±3.5,±2.5)` L3, one centre `(0,0)` L6. 7 buildings. Seat 0 = left (blue), seat 1 = right (red). | M1 |
| R2 | Duel M: bounds x[-12,12] z[-8,8], theme snow. Per seat: home `(±9,0)` L15 + two satellites `(±7,±5)` L5 (3 owned each). Neutral: four `(±4,±2.5)` L4, two `(0,±5)` L6, centre tower `(0,0)` L5, two small obstacles `(0,±2)`. 14 buildings. | M2 |
| R3 | Cross: bounds square x,z[-10,10], theme green. Homes `(-7,0),(0,-7),(7,0),(0,7)` L12, seat k+1 = seat k rotated 90 deg; colors blue,red,green,yellow in seat order. Neutral: axis fronts `(-3.5,0),(0,-3.5),(3.5,0),(0,3.5)` L3; corners `(±5.5,±5.5)` L5; centre `(0,0)` L8 house. 13 buildings. Level `players[].team` = `[0,1,0,1]` (teammates diagonal; every seat has enemies on both sides). | M2 |
| R4 | Starting troops = building level (garrison = level, GAME_RULES level definition); every seat starts with equal total level. Numbers above are the M1/M2 starting point, tuned after play-test [DEFERRED]. | M1 |
| R5 | Coordinates exact: 3-decimal values chosen so the transforms are integer-exact in milli-units (no rounding tolerance). | M1 |
| R6 | `listPvpMaps(catalog)` returns `{id, name, seats, teams (default, may be identity), timeLimitSec, theme}[]` ordered by `pvp.json` position. Server rejects `levelId` not in it. | M2 |
| R7 | Symmetry gate: `checkSymmetry(level, kind)` in `validate:levels`. Every transform must map buildings (pos, archetype, level, params, ignoreForWin), elements (pos, archetype, variant, params), bounds and per-seat owner (via the seat permutation) onto themselves. Fails with the first offender id + transform. | M1 |
| R8 | `validate:levels` pvp branch (see Architecture): no idle-human/solvable checks; all-seat proxy determinism, rejected-command check, seed-1 lock. Campaign path byte-identical. | M1 |
| R9 | Self-play fairness: `pnpm balance --mode pvp` reports per-seat decisive win share, draws, mean duration per map (seeds 1..40, proxy delays 1000/2000/4000). Gated smoke test: 20 seeds, all invariants hold (terminates, 0 rejected, deterministic) and seat share of decisive results within 20-80%. | M1 (Duel S), M2 (rest) |
| R10 | Editor (dev) opens, saves and finalizes pvp levels; saved level goes to `pvp.json` not `custom.json`. | M2 |

## Architecture
**Files and ids.** Level ids `na-pvp-<slug>`: the `na-` prefix is required by the editor writer (`^na-[a-z0-9-]{1,40}$`) and exempts files from the importer's orphan check [verified: tools/src/editor-ops.ts, docs/LEVELS_GUIDE.md]. `campaigns/pvp.json`: `{id:"pvp", entries:[{level, position 1..3}]}`; the campaign schema and catalog already accept any campaign id and check level refs [verified: catalog.ts:25-30, content.ts:30]. Authoring is plain JSON (copy `levelview-3-ab.json` shape): `objective:"pvp"`, all players `kind:"human"` placeholders without `bot` (SP01 R1), unique `colorKey` from the manifest palette (blue/red/green/yellow/gray), `requires` recomputed (`objective:pvp`, no `bot:*`).

**Listing.** `objective === 'pvp'` identifies a PvP level, `pvp.json` orders and whitelists it. The picker builds Common/custom only from those two campaigns [verified: app/state.ts:53-55], so pvp levels never leak into single-player. `tools/levels.ts` `campaignLevels` currently demands Common + custom == all level files; extend the union with `pvp` (and a `pvpLevels()` accessor) or the gate fails on the new files.

**Symmetry declaration.** Level schema has no symmetry field (SP01 owns schema; keep it additive-free). Sidecar `tools/pvp-symmetry.json`: `{ "na-pvp-duel-s": "d2", "na-pvp-duel-m": "d2", "na-pvp-cross": "d4" }`; a pvp level without an entry fails `validate:levels`. Transform sets: d2 = {id, x→-x, z→-z, rot180} with seat perms `[0,1],[1,0]`...; d4 = rotations (seat k→k+1) and axis/diagonal mirrors (seat order reversed/reflected). Seat permutation is derived, not authored: match each home to its image. Teams are not part of geometry, so D2/D4 makes `[0,0,1,1]` and `[0,1,0,1]` equally fair.

**validate:levels pvp branch.** For each pvp level: (a) symmetry; (b) all-idle seats, seed 1: outcome `draw` (symmetric, nothing happens); (c) for seeds 1..4 and delays 1000/2000: all seats `HUMAN_PROXY`-style bots via `runMatch` + `createSeatBot` (same call as `proxyController`) [verified: levels.ts proxyController, harness.ts]; fail on rejected commands, non-termination (cap = limit+margin), or a rerun hash mismatch; (d) lock seed 1/delay 2000 outcome. `parseLevelsLock` outcome whitelist extends with `victory|timeLimit` (and `draw` already allowed) per SP01 D5 [verified: levels.ts:parseLevelsLock]. Seat count and `humanSeat()` are not consulted. The `unsolved-by-proxy` allowlist does not apply.

**Self-play fairness.** `tools/src/balance*.ts` gains a pvp mode (all seats same proxy, seats rotated so a given bot config occupies each seat across seeds); report-only table, same as existing balance matrix [verified: tools/README.md]. Because simultaneous commands apply in seat order, a small low-index bias is possible and is exactly what the report reveals; the 20-80% smoke bound is a regression tripwire, not a tuning target. Bot version changes shift results, so the smoke asserts bounds only, never exact values.

**Editor.** Findings [verified: editor/document.ts:23 hardcodes `captureAll`/2 players for new docs; `toDraft` carries only name/theme/timeLimitSec/players; `playerLabel` yields "Human"/"AIn"; editor-ops `save` upserts `custom.json` and Check/Play use the human-proxy]. Minimal change for R10: (1) save routes to `pvp.json` when the level id is in it or `objective==='pvp'`; (2) editor must preserve `objective` and per-player `team` on round-trip (test); (3) labels for pvp = "Seat N"; (4) hide Add AI, per-player bot panel and proxy Check/Play for pvp (show "PvP: checked by validate:levels"); (5) the time-limit field already accepts a value. Seat count change, team pickers and "mirror-edit" helper are [DEFERRED]; owners edit `team` in JSON. Asymmetric edits are caught by Finalize because it runs the content gates; add the symmetry check to Finalize's chain.

**Versions and locks.** Order after SP01 lands: add files → bump `contentVersion` minor (2.3.4 to 2.4.0; additive levels) in `content.json` → `pnpm content:lock` → `pnpm levels:lock --levels na-pvp-duel-s,...`. `BOT_VERSION` bump only if `check:content` demands it (the guide says new levels move the bots lock, but pvp levels carry no bot block) [verify when authoring]. Art is theme only (`green`/`snow` from the manifest); no new visuals, so no manifest/asset lock change [verified: manifest themes, LEVELS_GUIDE art section].

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Where maps live | `na-pvp-*` + `campaigns/pvp.json` | Flag on level; stuff in `custom.json` | Reuses catalog integrity checks, editor-compatible id, keeps single-player lists clean [RESOLVED: agent recommendation] |
| D2 | Symmetry type | Duel D2, Cross D4 | Duel mirror-x only; Cross rot90 only | Fair under any team assignment, any seat [RESOLVED] |
| D3 | Symmetry declaration | Sidecar `tools/pvp-symmetry.json` | New level schema field | Keeps SP01 schema frozen at 2.0.0 [RESOLVED] |
| D4 | Cross default teams | `[0,1,0,1]` | `[0,0,1,1]` | Rot90-invariant up to team swap; D4 makes either fair [RESOLVED: orchestrator] |
| D5 | Fairness smoke | Exact symmetry gated; self-play report-only + loose gated bounds | Gate strict win-rate | Bot changes would flake strict gates |
| D6 | Neutral tower | Duel M, Cross excludes (house centre) | Towers everywhere | Neutral towers fire (`neutralFires`) so a tower is a hazard, not just a prize; one per map max, M1 Duel S has none [verified: tower.json] |
| D7 | Time limit | Explicit 480 in every file | `null` (compile fills) | Visible to owner in editor |
| D8 | Version bump | `contentVersion` minor | Patch | New levels = additive content |

## Manual steps
- Owner play-test of Duel S (M1 gate), then Duel M/Cross; tuning of levels/positions after (decision only the owner can make).

## Risks / Open Questions
- 1v1 snowball / mirror-first-strike dominance on small map; timeout draws common on symmetric maps. [DEFERRED: tune after M1 play-test; levers: starting levels, centre level, timeLimit]
- Seat-order command bias in simultaneous ticks may skew self-play. [RESOLVED: report seat shares; smoke rotates seats; any real bias goes to SP01/FUTURES]
- Cross 4-player line crossings plus ally-blocking could stall; check in 2v2 smoke run. [RESOLVED: include 2v2 `[0,1,0,1]` and `[0,0,1,1]` in the pvp smoke]
- Editor finalize/golden refresh path may not understand pvp outcomes. [RESOLVED: verify in M2 task; fix in tools/editor-finalize]
- Seat color vs team readability (blue+green vs red+yellow) is SP05's team-ring problem. [DEFERRED]
- [RESOLVED: orchestrator - Cross ships with default teams `[0,1,0,1]`; only affects the lobby default]

## Acceptance Criteria
- `pnpm validate:levels` green including three pvp levels; symmetry test fails when any building/element is nudged by 0.001 or an owner swapped (unit test with mutated copy). M1 (Duel S) / M2
- `pnpm validate:content --base HEAD`, `pnpm check:content --base HEAD`, `pnpm check:schemas`, `pnpm check:manifest`, `pnpm check:docs` green; `contentVersion` bumped; `hashes.lock.json` and `tools/levels-lock.json` updated; `pnpm campaign:verify` and campaign lock entries unchanged. M1/M2
- `listPvpMaps()` returns exactly the shipped maps in order; Common stays 20 entries, custom list unaffected. M2
- `runMatch` all-seat proxies on each map for seeds 1..20: terminates with `victory|timeLimit|draw`, 0 rejected, rerun hash equal, seat decisive share 20-80%. 2v2 variants on Cross. M1 (Duel S) / M2
- Editor: open `na-pvp-duel-s`, edit a building owned by seat 0, save: file written, not in `custom.json`, `objective` and `team` retained, asymmetry reported by the gate. M2
- Manual: owner can play Duel S 1v1 in two tabs (SP04/05) and finds it fair. M1
