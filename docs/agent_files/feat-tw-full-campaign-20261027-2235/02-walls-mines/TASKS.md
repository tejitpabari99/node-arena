---
status: draft
summary: 11 tasks — decode spike, rules text, defs/content, generic element-state facility, wall/mine modules, importer + position-23 re-import, web render, editor, curated selection and import of >=10 wall + >=10 mine levels, perf/ci gate
date: 2026-10-27
---
# Tasks: 02 Walls + mines
Source of truth: [PRD](PRD.md). Adds walls (hp sponge) and mines (0.1 s delayed kill) on a generic element-state/crossing facility that SP03/05/08 reuse, re-imports position 23 with its wall, and imports a provisional >=10 wall + >=10 mine level selection. Mechanics order: rule text + changelog + version bump, then tests, then code. Tasks 1, 6, 7, 9 need the rebuilt TW extract (`TW_EXTRACT`); Task 9 also needs SP01's `pnpm census`. No bot changes.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Decode spike: trigger size, layer, owner gate, update order | none | todo |
| 2 | Rules text: R-ELM / R-WAL / R-MIN, phase row, RULES_VERSION | 1 | todo |
| 3 | Defs, events, element JSON, schema, content version | 2 | todo |
| 4 | Element state columns + crossing helper | 3 | todo |
| 5 | Absorbs + detonates modules, element pass | 4 | todo |
| 6 | Importer rows, emitters, position 23 re-import | 3 | todo |
| 7 | Web render, asset rows (S4 spike folded in) | 3, 5 | todo |
| 8 | Editor library items | 7 | todo |
| 9 | Curated selection from pool tool | 6 | todo |
| 10 | Import selected levels, solvability, locks | 5, 6, 9 | todo |
| 11 | Perf, campaign:verify sample, ordering calibration, CI | 7, 8, 10 | todo |

## Task 1 — Decode spike: trigger size, layer, owner gate, update order
What it is / what it means: PRD Risks S1, S2, S3 and element-vs-clash ordering (all RESOLVED as "spike first, else fallback"). Wall/mine trigger shapes, wall length vs `Hp`, collision layer, who triggers them, and update order are undecoded.
What changes at a high level: Time-boxed (~1 h each) decomp via `/root/projects/tower-war/_tools/decomp.sh` of the Wall/Mine trigger classes, layer setup, trigger handlers and clash/element update order. No product code.
Done when: findings recorded per item. Each inconclusive item records its fallback as a deviation in GAME_RULES and the deviations ledger: wall box 1.2 x 0.4 yawed by `R` regardless of Hp, mine circle r 350; non-blocking layer (flip Decision 1 to `blocksLines` if the decode shows an obstacle layer); enemy-owned and AI troops trigger, mines hit tanks; element pass after clash. Needs `TW_EXTRACT`.

## Task 2 — Rules text: R-ELM / R-WAL / R-MIN, phase row, RULES_VERSION
What it is / what it means: PRD R1, Decisions 3–5, 10, Acceptance. Rules authority comes first.
What changes at a high level: `docs/GAME_RULES.md` gains areas ELM (swept crossing, deterministic iteration order), WAL (hp init, min(attack, hp) removal, troop consumed, neutral, hits every owner) and MIN (first crossing deactivates, 2-tick delayed kill, delayed troop still fights/arrives, air immune). Phase 6 row and R-OBS-02 cross-reference updated; spike results and any deviations written in; changelog; `RULES_VERSION` bumped to the next minor (indicative 3.1.0; rebase if SP03 lands first).
Done when: `pnpm check:rules` accepts the new IDs as untested stubs per repo convention; changelog and version present.

## Task 3 — Defs, events, element JSON, schema, content version
What it is / what it means: PRD R2, Decision 2. Walls and mines are content-driven modules, not hard-coded sim.
What changes at a high level: `absorbs` (hp, consumesTroop) and `detonates` (delayMs, destroyOnTrigger) defs with `appliesTo: 'element'`, rule ids and registry entries; events `WallHit`, `WallDestroyed`, `MineTriggered`; `KillCause` gains `wall | mine`; `elements/wall.json` and `mine.json` (neither `blocksLines`, unless Task 1 flipped it); level `requires` accepts both; `params.hp` and `punchStrength` (presentation only) in the schema. Content version/hash bump and `content:lock`.
Done when: schemas regenerated, `check:schemas`, `validate:content`, typecheck green; shipped level hashes unchanged apart from expected locks.

## Task 4 — Element state columns + crossing helper
What it is / what it means: PRD R3, Architecture, O4 resolution. The only new sim facility; reused by SP03/05/08.
What changes at a high level: `SimModule.elementState` allocates per-module Int32 columns per element, included in hash and snapshot with a schema version bump (no migration; no persisted sim snapshots). `elements.ts` precomputes cold crossing intervals per element/channel using the lane-interval primitive padded by troop radius, and exposes a generic `forEachCrossing` hook plus state accessor with no wall/mine-specific code. Skips empty channels and inactive elements.
Done when: tests titled `covers R-ELM-01` for ordering, mid-ring removal and spawn-tick inclusion; snapshot round-trip with element state; levels without elements replay bit-identically.

## Task 5 — Absorbs + detonates modules, element pass
What it is / what it means: PRD R3, Decisions 3–6, R-WAL/R-MIN.
What changes at a high level: `absorbs` drains hp by min(attack, hp), kills the entrant, emits `WallHit`/`WallDestroyed`; `detonates` flips inactive at once and queues a sorted, hashed delayed kill (due = tick + 2), processed at the start of the element pass. `contactsPass` calls `elementPass` after the crossing pass (or per Task 1 result). Zero-default talent hooks only.
Done when: tests `covers R-WAL-01..03` and `R-MIN-01..03`: soldier/tank clamp, several troops in one tick, mid-ring removal, delayed kill incl. troop dying first, arrival during delay, inactive mine ignored, replay hash determinism. `check:rules` fully green.

## Task 6 — Importer rows, emitters, position 23 re-import
What it is / what it means: PRD R6, Decision 9. Wall/Mine are blocked at import; position 23 (`levelview-100-es`) shipped with its wall dropped. Needs `TW_EXTRACT`.
What changes at a high level: `feature-map.json` Wall/Mine become `map` rows (remove `onlyLevels` and the `wall` drop token); `emitWalls`/`emitMines` in `map-level.ts` (pos, yaw, `params.hp = Hp`, `punchStrength = PS`; inactive entries omitted). Re-import position 23 with its wall; update `source.dropped`, `levels-lock.json`, `hashes.lock.json`, state-v2 test and campaign results.
Done when: `check:import` green; position 23 has its wall and is solvable by proxy (else allowlisted per rules); every other shipped level hash unchanged.

## Task 7 — Web render, asset rows (S4 spike folded in)
What it is / what it means: PRD R5, Risks S4. Wall/mine models plus event-driven feedback.
What changes at a high level: Short S4 decomp of wall/mine materials (~1 h); `assets-tw` rows for `DestroyedWallItem`/`MineItem`, manifest visual ids `element.wall`/`element.mine`, credits. A sibling element renderer registered by visual id (not special-cased in the obstacle renderer): one stick per remaining hp with pop+burst on `WallHit`, clear on `WallDestroyed`; mine 2.0 s scale-down and puff on `MineTriggered`.
Done when: S4 result recorded; if inconclusive the base-theme obstacle material is reused tinted per theme as a recorded deviation. `assets:tw:check` and `check:manifest` green; both render in-game with fx firing from events.

## Task 8 — Editor library items
What it is / what it means: PRD R5, editor bullet.
What changes at a high level: `wall` and `mine` library items with model and thumbnail (`LibraryItem` extended); no obstacle-overlap warnings; selection panel `hp` field (1–20) and yaw; `LevelDoc.elements[].params.hp`.
Done when: editor places both and exports valid level JSON that passes content validation; editor tests green.

## Task 9 — Curated selection from pool tool
What it is / what it means: README Curation + PRD R6 curated import; resolution 4 (SP01 owns census). Needs `TW_EXTRACT` and `pnpm census`.
What changes at a high level: From census output select >=10 wall and >=10 mine levels from Common 24–340 (re-imported 23 counts as a wall level; levels may carry both). First selected level introduces walls and mines with no other new element; spread across later positions; prefer proxy-solvable, avoid levels needing allowlisting when an equal-feature alternative exists; prefab-only ids swapped if `parse-prefab` fails. Selection list kept in the SP02 docs folder.
Done when: provisional selection recorded with source positions, features and metrics; coverage line (`walls and mines (>=10 each; re-imported position 23 counts as a wall level): n levels, first at display N`) drafted.

## Task 10 — Import selected levels, solvability, locks
What it is / what it means: PRD R6, Acceptance. Selection is provisional; only SP09 sets final order and numbers (resolution 11).
What changes at a high level: Import only the selected levels with provisional display ids after the shipped 20; run `validate:levels` on them; unsolvable by proxy go to `tools/unsolved-by-proxy.json` (reason, `ownerSignOff: null`); refresh only own entries via `levels:lock --levels`, content lock, CREDITS rows.
Done when: >=10 wall and >=10 mine levels imported, coverage line printed; shipped 1–20 unchanged except 23; `validate:content --base HEAD`, `check:content`, `check:import` green.

## Task 11 — Perf, campaign:verify sample, ordering calibration, CI
What it is / what it means: PRD Acceptance, ordering-calibration resolution, resolution 7.
What changes at a high level: `bench:sim` on a mine-heavy level within budget; add the wall/mine introduction level to the `campaign:verify` sample set; calibrate element-vs-clash order against TW playthrough refs and lock via golden/replay refresh if needed (deviation recorded if the fallback holds); full `pnpm run ci`.
Done when: bench within budget; sample verify passes; golden/replay gates green; `pnpm run ci` green. Phase A's `validate:levels --all` runs in SP03's last task.

## Owner manual steps
- Provide rebuilt `TW_EXTRACT` for Tasks 1, 6, 7, 9.
- Spot-check rows added to `tools/unsolved-by-proxy.json` here (`ownerSignOff` stays null).
- Approve the Phase A PR (full `validate:levels --all` is run pre-merge by SP03).
