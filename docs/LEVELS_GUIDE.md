# Levels guide (Tower War port)

How Tower War (TW) levels become Node Arena level files, and how to add more. Goal: a later level is a data row, not an importer rewrite. Companion: [CONTENT_GUIDE.md](CONTENT_GUIDE.md) (lock, versions, schemas), [GAME_RULES.md](GAME_RULES.md) (mechanics), [FUTURES.md](FUTURES.md) (deferred work).

Run everything from the repository root.

## 1. Pipeline map

```
$TW_EXTRACT raw TextAssets --parse-raw.ts--> TwLevel <--parse-prefab.ts-- tools/src/import-tw/prefab/*.ext.json (frozen)
remote-config defaults JSON --campaign.ts--> [{id, position}]
tools/src/import-tw/prefab/colliders.json (frozen) --> obstacle footprints (box + yaw per child)
TwLevel + tools/src/import-tw/feature-map.json + registry --map-level.ts / gate.ts--> level | blocked[]
level --computeRequires--> serialize.ts --> packages/content/data/levels/*.json + packages/content/data/campaigns/common.json
```

| Piece | Path | Committed? |
|---|---|---|
| Importer (parser, mapper, rotation, gate, script merge, serializer, CLI) | `tools/src/import-tw/` | yes |
| Drop/block policy per TW construct | `tools/src/import-tw/feature-map.json` | yes |
| Frozen prefab inputs (2 prefab levels) | `tools/src/import-tw/prefab/levelview-100-es.ext.json`, `tools/src/import-tw/prefab/levelview-182-nb.ext.json` | yes |
| Frozen collider dump (UnityPy, not reproducible in TS) | `tools/src/import-tw/prefab/colliders.json`, script `tools/src/import-tw/prefab/dump_colliders.py` | yes |
| Importer tests | `tools/src/import-tw/test/` | yes |
| Imported levels (20) and campaign | `packages/content/data/levels/`, `packages/content/data/campaigns/common.json` | yes |
| Version + lock (importer never edits) | `packages/content/content.json`, `packages/content/hashes.lock.json` | yes |
| TW extract (raw TextAssets, remote config) | `$TW_EXTRACT` (here `/root/projects/tower-war/_extract`) | **local-only** |

CI has no extract: `pnpm check:import` prints `check:import skipped (TW_EXTRACT unset)` and exits 0. Tests that need the extract skip. Without `TW_EXTRACT`, `pnpm import:tw` exits 2 with a one-line message.

Scripts: `pnpm import:tw [--range A-B] [--only id[,id]] [--skip-blocked] [--check]`, `pnpm check:import` (= `--check`: re-runs in memory, diffs bytes against the tree).

## 2. Import more levels

1. `export TW_EXTRACT=/path/to/_extract` (the dir containing the assets and converted folders).
2. Dry-look first. `import:tw` writes files for importable levels, so for a pure preview use a range with no importable level, or run in a clean tree and `git diff`. Real run on positions 24-25 (both blocked, nothing written):

   ```
   $ TW_EXTRACT=/root/projects/tower-war/_extract pnpm import:tw --range 24-25
   levels: 2 considered, 0 importable, 2 blocked
   BLOCKED LevelView 101_ES (position 24): Wall: drop policy covers only levelview-100-es
   BLOCKED LevelView 109_ES (position 25): Wall: drop policy covers only levelview-100-es
   campaign common: 0 entries (not written)
   wrote 0 file(s), 0 unchanged
   ```
3. Read the blocked report: each line is `position, id, reasons`. A reason names the feature row (`Wall`, `Mine`, `River`, ...) with `archetype: null`, an unregistered theme, or a refused dialect. Blocked levels write nothing (no `--allow-blocked`; an unplayable level fails `validate:content`).
4. Default writes a contiguous prefix of the campaign; a blocked level ends it. `--skip-blocked` writes a sparse list (keeps `position`). Positions 1-3 are tutorials and absent.
5. For importable levels: `pnpm content:lock`, bump `contentVersion` in `packages/content/content.json` and `BOT_VERSION` (new AI seats), see [CONTENT_GUIDE.md](CONTENT_GUIDE.md) "Versions and hashes". The importer prints this reminder; it never edits either file.
6. Verify: `pnpm check:import`, `pnpm validate:content --base HEAD`, `pnpm check:content --base HEAD`.

Output is idempotent and deterministic (`JSON.stringify(obj, null, 2) + "\n"`, schema key order, authored array order).

## 3. Add a feature to unlock levels

1. Pick the next feature by its "Delta" in the section 5 snapshot table (or by the blocked report).
2. Define the module/archetype using the new-behaviour flow in [CONTENT_GUIDE.md](CONTENT_GUIDE.md) ("Add a module (new behaviour)"): rule text in `docs/GAME_RULES.md` + changelog + `RULES_VERSION`, def, sim binding, data file, `covers R-...` tests, `pnpm content:schemas`.
3. Fill the row in `tools/src/import-tw/feature-map.json`. Row shape: `{ "tw": <TW list/construct>, "action": "map" | "drop" | "block", "kind": "building" | "element" | "param" | "bot", "archetype": <id or null> }`.
   - `map` + `archetype: null` = construct recognised, no archetype yet: levels carrying it are blocked. Setting `archetype` to the new id unblocks them.
   - `archetypeBy: { param, map }` picks the archetype by a building param (houses by `warriorType`).
   - `drop` omits the construct and records its `tw` token in `source.dropped`. Optional `onlyLevels: [ids]` restricts the drop to those levels; any other level with the construct is blocked (used for `Wall`).
   - A construct with no row is a parse error (no silent loss).
   - Param mapping for a new archetype lives in `tools/src/import-tw/map-level.ts`; add a test in `tools/src/import-tw/test/`.
4. Re-run `pnpm import:tw --range ...`, then lock + bump + verify as in section 2.
5. Update the tracker snapshot (section 5) by hand.

## 4. Hand-author an original level

1. Copy `packages/content/data/levels/levelview-1.json` (the golden) to `packages/content/data/levels/na-<name>.json`; `id` must equal the file name and carry the `na-` prefix (importer ids are `levelview-*`).
2. Omit `source` (optional; `campaignPosition`/`dialect` only describe TW origin). Set `theme`, `bounds`, `objective`, `timeLimitSec`.
3. `players`: exactly one human, first; 1..`aiMax` AI seats, each with a `bot` block (kind `tw` with `actionDelayMs`, `behavior`, optional `script`).
4. `buildings` / `elements`: archetypes from `packages/content/data/buildings/` and `packages/content/data/elements/`.
5. `requires` is filled **manually** (sorted set of modules used, `bot:<kind>` per seat kind, `objective:<id>`). A wrong list fails validation with the expected set; paste it. Automatic fill (`validate:content --fix-requires`) is deferred, see [FUTURES.md](FUTURES.md).
6. Add `{ "level": "na-<name>", "position": N }` to `packages/content/data/campaigns/common.json` (optional `loop` field is deferred, see FUTURES).
7. `pnpm content:lock`, bump versions, `pnpm validate:content --base HEAD`.

## 5. Coverage tracker

### Snapshot (static, from the 06 research section 7.2 / 02 seed; not recomputed)

"Delta" = additional campaign levels (of 1,012 JSON levels) fully supported once the feature exists; obstacles, cargo and scripted AI count as decor in the base row. Order of middle rows is a choice. A recomputed/generated table needs the follow-up census task (`census.ts`, not built).

| Feature (to register) | First pos | Cumulative levels | Delta | Owner SP |
|---|---|---|---|---|
| Houses WT1/WT2 + default AI (base) | 4 | 38 | 38 | 02/03 |
| walls, mines | 24 / 36 | 60 | +22 | 04 |
| resource piles | 67 | 138 | +78 | 04 |
| tower (`shoots`) | 4 | 312 | +174 | 03/04 |
| artillery house WT3 | 45 | 386 | +74 | 01/03 |
| rivers (+river obstacles) | 103 / 140 | 446 | +60 | 04 |
| rocket tower, capture rocket tower | 216 / 89 | 731 | +285 | 04 |
| selectable fortress | 182 | 899 | +168 | 04 |
| trolley, railway, AI rail moves | 267 / 330 | 1,012 | +113 | 04 |

### Our 20 (positions 4-23), exact, recounted from the committed files

Features excluding houses WT1/WT2 and cargo (dropped everywhere):

| Layer | Levels (position) | Count |
|---|---|---|
| base only (no obstacle, no tower, no script) | 8 | 1 |
| + obstacles (`blocksLines`), no tower, no script | 5, 12, 17, 23 | 4 (cum. 5) |
| + tower, no script | 4, 7, 9, 14, 16, 19 | 6 (cum. 11) |
| + scripted AI (`bot.script` non-empty) | 6, 10, 11, 13, 15, 18, 20, 21, 22 | 9 (cum. 20) |

Totals: 13 obstacle levels (5, 6, 7, 10, 11, 12, 13, 16, 17, 19, 20, 22, 23), 10 tower levels (4, 6, 7, 9, 14, 16, 18, 19, 21, 22), 9 scripted levels. Themes: positions 4-20 `green`, 21-23 `snow` (`ENV_SHIFT = 0` in `tools/src/import-tw/gate.ts`).

### Deviations from TW (shipped 20)

- **cargo** dropped in all 20 (owner decision).
- **wall** dropped in `levelview-100-es` (position 23) only, via `onlyLevels` in `feature-map.json`. Other wall levels (24, 25, ...) stay blocked.
- **tutorial scripts** (`BaseTutorial`, `TutorLevelBase`) on the two prefab levels (`levelview-182-nb` pos 10, `levelview-100-es` pos 23) are not data: `tutorial-script` in `source.dropped`.
- **collider fallback: not used.** The real collider dump `tools/src/import-tw/prefab/colliders.json` exists; obstacle footprints are one box + yaw per child.
- `sc` (building param) dropped everywhere; `AiRM`, `MinRD`, `MaxRD` (AI rail moves) dropped if present (`ai-rail-move`).

## 6. Fidelity ledger

Computed from `source.dropped` in `packages/content/data/levels/*.json`.

| Dropped token | Levels | Notes |
|---|---|---|
| `cargo` | all 20 | TW cargo pickups not modelled |
| `sc` | all 20 | building param, no equivalent |
| `tutorial-script` | `levelview-182-nb` (10), `levelview-100-es` (23) | prefab levels, scripted components |
| `Wall` | `levelview-100-es` (23) | one wall; level plays without it |

No level drops anything else. Inactive obstacle children are not in `source.dropped` (they are logged by the importer only).

## 7. Gotchas

- **Rotation.** Data frame = Unity coords rotated `(x, z) -> (z, -x)`; `yawDeg = (Y + 90) mod 360`, 2 dp; `-0` normalised to `0`. Assets are imported raw; the web client mirrors once at `worldRoot`. See `tools/src/import-tw/rotate.ts`. `bounds` = AABB of building positions, padded by `BOUNDS_PAD` (2.0), integer outward; elements outside bounds are allowed (logged only).
- **Human not first in `P`.** TW's `P` list may put the human anywhere. `players[]` is re-ordered human-first (validator requires it); AI seats keep `P` order. Neutral (type 2) has no seat.
- **`BD` order.** `buildings[]` order = TW `BD` flatten order, concatenated per `P` entry in the ORIGINAL `P` order. Ids `b<twId>` are stable keys only. Bot tie-breaks and building indices depend on this order, so do not sort.
- **Inactive obstacle children.** Each `OBS` cluster has child slots `S[i]`; only active children become `obstacle` elements (ids `o<cluster>-<child>`). Inactive ones are dropped and logged, not blocked. Child 0 sits at the parent position.
- **Hash-suffix file names.** Raw extract files are `LevelView 1_<digits>.json` (numeric, sometimes negative id suffix). Lookup is anchored `^<asset>_-?\d+\.json$` because `LevelView 1_` is also a prefix of `LevelView 1_AB_<id>.json`. 0 or >1 matches is an error.
- **Long / v0 dialects.** Only the v1-short dialect (and the two frozen prefab levels) is supported. Long-key (C# property names), v0 (`Player`/`AI`) and boss levels (`LevelViewBoss`) are refused explicitly.
- **Bot scripts.** `AiDS`/`AiCWS`/`AiSC` merge into one `bot.script` by `I` across the three lists; gaps or duplicates are an error. Unresolvable refs become `null`.
- **Never hand-edit imported levels.** `pnpm check:import` diffs bytes against the importer output; change the importer or `feature-map.json` instead.
