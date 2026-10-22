---
status: draft
summary: 9 tasks - colliders dump first, then parsers, rotate/serialize + golden, gating map, mapper, bot script merge, CLI, import the 20 levels, LEVELS_GUIDE.
date: 2026-10-22
---
# Tasks: Level importer, campaign list and LEVELS_GUIDE (SP05)
Source of truth: [PRD](PRD.md). Deterministic TS importer from `TW_EXTRACT` (plus 2 frozen prefab files) to level v2 files for positions 4-23 and `campaigns/common.json`, gated by the registry, with a durable guide. Census/generated tracker (N6) is out of scope here. Cross-SP deps use "02#3" style: 02 step/task 3 = golden `levelview-1` + `loadCatalog`/`computeRequires`/level schema.

| # | Task | Depends on | Status |
|---|---|---|---|
| 0 | Colliders dump (frozen `colliders.json`) | none | todo |
| 1 | Parsers: raw TextAsset, prefab ext, campaign order, fixtures | none | todo |
| 2 | Rotation, bounds, serializer + golden byte test | 02#3, 1 | todo |
| 3 | `feature-map.json` + gating | 02#3, 1 | todo |
| 4 | Level mapper (players, buildings, params, obstacles) | 0, 2, 3 | todo |
| 5 | Bot script merge | 4 | todo |
| 6 | CLI, root scripts, `check:import`, determinism | 4, 5 | todo |
| 7 | Import the 20 levels + `common.json` | 6, 02#3 | todo |
| 8 | `docs/LEVELS_GUIDE.md` | 7 | todo |

## Task 0 — Colliders dump
What it is / what it means: R0, B7. Obstacle and building footprints become data, not guesses; 04 reads this file (04 depends on this task) for content values.
What changes at a high level: A Python/UnityPy script dumps `BoxCollider` size/center plus child local scale and yaw for the `Obstacle.prefab` children and the `Building` collider into a committed, frozen `prefab/colliders.json`. Frozen like the prefab inputs (not reproducible in TS). Fallback if infeasible within a day: circle 450 + calibration vs ref screenshots, recorded as a known deviation for the guide.
Done when: `colliders.json` is committed with box size + yaw for every obstacle child and the building box; the colliders test (present, every child has size + yaw) passes; 04 can consume it.

## Task 1 — Parsers and fixtures
What it is / what it means: Decision 1/2. Input stage producing typed `TwLevel`; v1-short only.
What changes at a high level: `parseRaw` (asset file by anchored regex `^<asset>_-?\d+\.json$`, 0 or >1 match = error), `parsePrefab` for the 2 frozen `ext` files (positions 10, 23; flagged hand-data), campaign order from the remote-config defaults JSON (position = 1-based index). Long/v0/boss dialects refused explicitly. Commit raw fixtures (`LevelView 1` plus 2 with scripts/obstacles). `TW_EXTRACT` unset: tools exit 2 with a one-line message.
Done when: fixtures parse without the extract; raw -> `TwLevel` parity with the 14 `converted/ext` files passes (skips without env); unknown dialect and ambiguous file match error.

## Task 2 — Rotation, bounds, serializer, golden
What it is / what it means: R3/R5. Implements 02's Frame contract; owns the bounds constant and canonical formatting that 02's fixture imports.
What changes at a high level: `rotate.ts` (position `(x,z)->(z,-x)`, `-0` normalised; yaw `(Y+90) mod 360` to 2 dp; bounds = building AABB, pad 2.0 constant exported via `defs`, integer outward; out-of-bounds elements only logged). `serialize.ts` (2-space JSON + newline, schema key order, authored array order).
Done when: rotation unit values, 4x identity, yaw wrap and Frame-contract tests pass; importing the raw `levelview-1` fixture equals 02's golden byte-for-byte (blocked here until a golden mapper path exists, so the byte test lands finalized in Task 4); 02's test imports the same constant.

## Task 3 — Feature map and gating
What it is / what it means: Decision 3, R2/R4. A new feature becomes a data row, not an importer rewrite.
What changes at a high level: `feature-map.json` with typed loader: rows `{tw, action: map|drop|block}` and the archetype each construct maps to (houses, tower; rocket/selectable/capture-rocket/trolley/flag/boss, `ROBS/Mine/Wall/Sheep/River/Gate/Railway/WOD` as null-archetype rows; `wall` and `cargo` as drop; `AiRM/MinRD/MaxRD` drop). Anything unlisted = parse error. Gating computes `blocked[]` against the loaded catalog (absent archetype, unregistered theme, boss/long/v0); blocked levels write nothing; no `--allow-blocked`.
Done when: gating test passes (catalog without `tower` blocks `levelview-1` with reason, no file written); unlisted construct errors.

## Task 4 — Level mapper
What it is / what it means: R2 core; Decision 4 order rule (B2) and Decision 5.
What changes at a high level: `map-level.ts`: id/name/source slug (duplicate slug = error), `players[]` human-first with ids and colours, neutral seat rule; `buildings[]` in `BD` flatten order per ORIGINAL `P` order with `b<twId>` keys; params only when different from archetype value (resolved from catalog); per-active-child obstacles with box + yaw + variant from `colliders.json`; `objective`, `timeLimitSec`, theme via `ENV`/`ENV_SHIFT`, bounds via Task 2; `source.dropped` ledger (cargo, wall, tutorial-script); `requires` from 02's `computeRequires`. Order handling isolated behind one flag.
Done when: golden byte test (Task 2) passes; invariants test (human first, 1-3 AI, unique ids, bounds contain buildings, `BD` order preserved) passes; conservation ledger accounts for every TW entry as mapped/dropped/blocked.

## Task 5 — Bot script merge
What it is / what it means: R2 `bot` rows; 06's `bot` block shape is the target, so coordinate field names with 06.
What changes at a high level: `script.ts` merges `AiDS/AiCWS/AiSC` by `I` across the lists (gaps/duplicates = error) into `delay`/`line`/`steps` entries, `AD` to `actionDelayMs`, `BT` to `behavior`; ids become `b<id>`, unresolvable refs (`WOD` pile, missing) become `null`.
Done when: scripted levels in the fixtures produce expected `bot` blocks; invariant "every bot ref resolves to a building or `null`" passes.

## Task 6 — CLI, scripts, determinism
What it is / what it means: R5, Decision 10. Entry points and CI-safe behaviour.
What changes at a high level: `cli.ts` with `--range`, `--only`, `--skip-blocked`, `--check`; campaign writer (contiguous prefix by default, blocked ends it and is named in the report; sparse with `--skip-blocked`). Root scripts `import:tw`, `check:import`; one-line registration in 09's `tools/src/cli.ts`. `--check` diffs bytes in memory; skips with exit 0 when `TW_EXTRACT` unset. Prints the `pnpm content:lock` / bump `contentVersion` reminder; never edits `content.json` or the lock.
Done when: determinism tests pass (two runs identical, shuffled input order identical); `check:import` skips without env; `pnpm run ci` is green with the new lines.

## Task 7 — Import the 20 levels
What it is / what it means: The deliverable corpus for 03/06/08/09; Decisions 6, 7.
What changes at a high level: with the extract, run `import:tw --range 4-23` (positions 10, 23 from frozen prefab files). Commit 20 level files and `common.json`; run `pnpm content:lock` and bump `contentVersion` per 02's documented commands. Theme 4-20 green, 21-23 snow (`ENV_SHIFT=0`); wall in `100_ES` and cargo in all 20 logged in `source.dropped`. Registry-blocked levels (if 02/04 archetypes are not yet registered) end the prefix; rerun when they land.
Done when: second run changes nothing; `check:import` clean; all 20 pass `validate:content` (schema, `requires` equality, refs, bounds, `level <= maxLevel`); schema+`requires` test over the 20 passes; `pnpm run ci` green; `--range 24-25` dry run reports `LevelView 101_ES` blocked by `wall` and writes nothing.

## Task 8 — LEVELS_GUIDE
What it is / what it means: Durable how-to so later levels are a data row. 7 sections per PRD Docs.
What changes at a high level: write `docs/LEVELS_GUIDE.md`: pipeline map and committed vs local-only; import more levels; add a feature (tracker "Delta", 02 new-behaviour flow, fill `feature-map.json` row); hand-author an original level (`na-` prefix, `requires` filled manually, `--fix-requires` deferred); tracker section with the static 06 §7.2 snapshot table plus the exact 20-level breakdown and deviations (cargo, wall, tutorial scripts, collider fallback if used); fidelity ledger; gotchas (rotation, human-not-first in `P`, `BD` order, inactive obstacle children, hash-suffix file names, long/v0 dialects). Record deferred items (`--fix-requires`, campaign `loop`) in `docs/FUTURES.md` if 09 has not.
Done when: all 7 sections exist with the table marked "snapshot"; 09's `check:docs` path check (if landed) passes.

Owner steps: none blocking. Optional check of mirror and theme boundary (4-20 green, 21-23 snow) against `BF/ref/tw-yt` frames (adjust `ENV_SHIFT` and re-run if wrong). Before merge (09): run `TW_EXTRACT=... pnpm check:import` locally since CI skips it.
