# Levels guide (Tower War port)

How Tower War (TW) levels become Node Arena level files, and how to add more. Goal: a later level is a data row, not an importer rewrite. Companion: [CONTENT_GUIDE.md](CONTENT_GUIDE.md) (lock, versions, schemas), [GAME_RULES.md](GAME_RULES.md) (mechanics), [FUTURES.md](FUTURES.md) (deferred work).

> **Licensing notice.** Tower War (TW) derived data in this repository (imported levels, test fixtures, collider dump, frozen prefab files) is private. The repository must stay private; no public deploy of anything built from it.

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
| TW extract (raw TextAssets, remote config) | `$TW_EXTRACT` | **local-only** |

CI has no extract: `pnpm check:import` prints `check:import skipped (TW_EXTRACT unset)` and exits 0. Tests that need the extract skip. Without `TW_EXTRACT`, `pnpm import:tw` exits 2 with a one-line message.

Scripts: `pnpm import:tw [--range A-B] [--only id[,id]] [--skip-blocked] [--check]`, `pnpm check:import` (= `--check`: re-runs in memory, diffs bytes against the tree). Without `--range`, `import:tw` uses 4-23 and `check:import` covers every importer-owned position already in the committed campaign (so it grows when the campaign does) and also flags orphan files in the levels folder: level files the importer did not produce and that are not hand-authored (`na-` prefix).

## 2. Import more levels

1. `export TW_EXTRACT=/path/to/_extract` (the dir containing the assets and converted folders).
2. Preview first with `--check`: it re-runs the import in memory and reports what would change without writing. A real run on positions 24-25 (both blocked, nothing written; the committed campaign is merged, not replaced):

   ```
   $ pnpm import:tw --range 24-25
   levels: 2 considered, 0 importable, 2 blocked
   BLOCKED "LevelView 101_ES" (position 24): "Wall: drop policy covers only levelview-100-es"
   BLOCKED "LevelView 109_ES" (position 25): "Wall: drop policy covers only levelview-100-es"
   campaign common: 20 entries
   wrote 0 file(s), 1 unchanged
   ```

   The report also lists, per written level, the dropped tokens, inactive obstacle children (count and ids) and elements outside the bounds (count and ids).
3. Read the blocked report: each line is `position, id, reasons`. A reason names the feature row (`Wall`, `Mine`, `River`, ...) with `archetype: null`, an unregistered theme, or a refused dialect. Registered themes are explicit: the `themes` ids of the v2 asset manifest (`apps/web/assets/manifest.json`, currently `green`, `snow`); the importer fails if that manifest is missing or not v2. A level whose position needs another theme (e.g. `lava` from position 41) is blocked until the art pipeline adds that theme to the manifest. Blocked levels write nothing (no `--allow-blocked`; an unplayable level fails `validate:content`).
4. The campaign file is **merged by position** into the committed one, never rebuilt from the requested range: entries at other positions and hand-authored (`na-`) entries are kept. A blocked level (or a row that would leave a gap) ends the contiguous prefix relative to the merged campaign; later rows are not touched. `--skip-blocked` writes a sparse list (keeps `position`) and removes blocked positions. A level that fails to parse (long, v0 or boss dialect, or a prefab level whose committed ext file is missing) is reported as blocked for that level and does not abort the batch; for a missing prefab file copy its ext file from the extract's converted/ext-prefab folder into the importer's prefab folder. Positions 1-3 are tutorials and absent.
5. For importable levels: `pnpm content:lock`, bump `contentVersion` in `packages/content/content.json` and `BOT_VERSION` (new AI seats), see [CONTENT_GUIDE.md](CONTENT_GUIDE.md) "Versions and hashes". The importer prints this reminder; it never edits either file.
6. Verify: `pnpm check:import`, `pnpm validate:content --base HEAD`, `pnpm check:content --base HEAD`.

Output is idempotent and deterministic (`JSON.stringify(obj, null, 2) + "\n"`, schema key order, authored array order).

## 3. Add a feature to unlock levels

1. Pick the next feature by its "Delta" in the section 5 snapshot table (or by the blocked report).
2. Define the module/archetype using the new-behaviour flow in [CONTENT_GUIDE.md](CONTENT_GUIDE.md) ("Add a module (new behaviour)"): rule text in `docs/GAME_RULES.md` + changelog + `RULES_VERSION`, def, sim binding, data file, `covers R-...` tests, `pnpm content:schemas`.
3. A new element/building kind is **a feature-map row + an emitter (+ a param table) + an archetype/module**. The feature-map row is the only archetype resolver: gate and mapper both read it.
   - Row shape: `{ "tw": <TW list/construct>, "action": "map" | "drop" | "block", "kind": "building" | "element" | "param" | "bot", "archetype": <id or null> }`.
   - `map` + `archetype: null` = construct recognised, no archetype yet: levels carrying it are blocked. Setting `archetype` to the new id unblocks the gate, but the mapper then needs an **emitter** registered under the same `tw` token (building emitters carry the param table that turns TW params into module overrides; element emitters turn a TW list into elements). A map row with an archetype and no emitter is a `MapError`, never a silent loss.
   - `archetypeBy: { param, map, default }` picks the archetype by a building param (houses by `warriorType`).
   - `drop` omits the construct and records it in `source.dropped` under `token` (default: the `tw` name; `Wall` records `wall`, `AiRM` records `ai-rail-move`). `record: false` drops without recording (MinRD/MaxRD). Optional `onlyLevels: [ids]` restricts the drop to those levels; any other level with the construct is blocked (used for `Wall`).
   - A construct with no row is a parse error (no silent loss); unknown building kinds need a `block` row (`fortess`, `speed_tower` have one).
   - Emitters and param tables live in the importer's mapper module; add a test in the importer test folder. The mapper's ledger counts what it emitted and fails when a list does not conserve (total = mapped + dropped + blocked + inactive).
4. Re-run `pnpm import:tw --range ...`, then lock + bump + verify as in section 2. If an archetype's default module values change (retuning), re-import: param overrides are stored only when they differ from the archetype defaults, so they depend on them. `check:import` is local-only (needs the extract), so CI does not catch a forgotten re-import.
5. Update the tracker snapshot (section 5) by hand.

## 4. Hand-author an original level

1. Copy `packages/content/data/levels/levelview-1.json` (the golden) to a new file in the same folder named `na-` plus your level name and `.json`; `id` must equal the file name and carry the `na-` prefix (importer ids are `levelview-*`).
2. Omit `source` (optional; `campaignPosition`/`dialect` only describe TW origin). Set `theme`, `bounds`, `objective`, `timeLimitSec`.
3. `players`: exactly one human, first; 1..`aiMax` AI seats, each with a `bot` block (kind `tw` with `actionDelayMs`, `behavior`, optional `script`).
4. `buildings` / `elements`: archetypes from `packages/content/data/buildings/` and `packages/content/data/elements/`.
5. `requires` is filled **manually** (sorted set of modules used, `bot:<kind>` per seat kind, `objective:<id>`). A wrong list fails validation with the expected set; paste it. Automatic fill (`validate:content --fix-requires`) is deferred, see [FUTURES.md](FUTURES.md).
6. Add `{ "level": "<your na- id>", "position": N }` to `packages/content/data/campaigns/common.json` (optional `loop` field is deferred, see FUTURES). The importer preserves non-imported (`na-`) campaign entries and level files: it merges its entries by position around them, never reports `na-` files as orphans, and refuses (error) to import a TW level onto a position they hold. Pick a position the import range will not reach, or an unused one.
7. `pnpm content:lock`, bump versions, `pnpm validate:content --base HEAD`.

## 5. Coverage tracker

### Snapshot (static, from the 06 research section 7.2 / 02 seed; not recomputed)

"Delta" = additional campaign levels (of 1,012 JSON levels) fully supported once the feature exists; obstacles, cargo and scripted AI count as decor in the base row. Order of middle rows is a choice. A recomputed/generated table needs the follow-up census task (a census script, not built).

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

Totals: 13 obstacle levels (5, 6, 7, 10, 11, 12, 13, 16, 17, 19, 20, 22, 23), 10 tower levels (4, 6, 7, 9, 14, 16, 18, 19, 21, 22), 9 scripted levels. Themes: positions 4-20 `green`, 21-23 `snow` (`DEFAULT_ENV_SHIFT = 0` in the gate module).

### Deviations from TW (shipped 20)

- **cargo** dropped in all 20 (owner decision).
- **wall** dropped in `levelview-100-es` (position 23) only, via `onlyLevels` in `tools/src/import-tw/feature-map.json` (recorded token `wall`). Other wall levels (24, 25, ...) stay blocked.
- **tutorial scripts** (`BaseTutorial`, `TutorLevelBase`) on the two prefab levels (`levelview-182-nb` pos 10, `levelview-100-es` pos 23) are not data: `tutorial-script` in `source.dropped`.
- **Building collider yaw deviation.** Buildings use the rules-contract AABB, 1.5 × 1.5 (half-size 750 milli); the dumped `Building` trigger has local yaw ≈15°. That prefab yaw is intentionally not applied: buildings have no authored rotation, and GAME_RULES E-TOWER fixes the axis-aligned reach example.
- **Obstacle archetype default.** Hand-authored obstacles without an instance footprint use child 0's dumped box, rounded to 0.713 × 0.713. Imported children retain their own rounded boxes and world `yawDeg`; no importer regeneration is needed.
- **collider fallback: not used.** The real collider dump `tools/src/import-tw/prefab/colliders.json` exists; obstacle footprints are one box + yaw per child.
- `sc` (building param) dropped everywhere; `AiRM` (AI rail moves) dropped if present and recorded as `ai-rail-move`. `MinRD` / `MaxRD` are AI reaction delays: dropped and **not recorded** (`record: false`).

## 6. Fidelity ledger

Computed from `source.dropped` in `packages/content/data/levels/*.json`.

| Dropped token | Levels | Notes |
|---|---|---|
| `cargo` | all 20 | TW cargo pickups not modelled |
| `sc` | all 20 | building param, no equivalent |
| `tutorial-script` | `levelview-182-nb` (10), `levelview-100-es` (23) | prefab levels, scripted components |
| `wall` | `levelview-100-es` (23) | one wall; level plays without it |

No level drops anything else. Inactive obstacle children are not in `source.dropped` (they are logged by the importer only).

## 7. Gotchas

- **Rotation.** Data frame = Unity coords rotated `(x, z) -> (z, -x)`; `yawDeg = (Y + 90) mod 360`, 2 dp; `-0` normalised to `0`. Assets are imported raw; the web client mirrors once at `worldRoot`. See the importer's rotate module. `bounds` = AABB of building positions, padded by `BOUNDS_PAD` (2.0), integer outward; elements outside bounds are allowed (logged only).
- **Human not first in `P`.** TW's `P` list may put the human anywhere. `players[]` is re-ordered human-first (validator requires it); AI seats keep `P` order. Neutral (type 2) has no seat.
- **`BD` order.** `buildings[]` order = TW `BD` flatten order, concatenated per `P` entry in the ORIGINAL `P` order. Ids `b<twId>` are stable keys only. Bot tie-breaks and building indices depend on this order, so do not sort.
- **Inactive obstacle children.** Each `OBS` cluster has child slots `S[i]`; only active children become `obstacle` elements (ids `o<cluster>-<child>`). Inactive ones are dropped and logged (count and ids), not blocked. Child 0 sits at the parent position. `yawDeg` is the child's `OCR.Y` after the frame rotation only (OCR is already a world rotation; the collider dump's yaw is not added).
- **Hash-suffix file names.** Raw extract files are `LevelView 1_<digits>.json` (numeric, sometimes negative id suffix). Lookup is anchored `^<asset>_-?\d+\.json$` because `LevelView 1_` is also a prefix of `LevelView 1_AB_<id>.json`. 0 or >1 matches is an error.
- **Long / v0 dialects.** Only the v1-short dialect (and the two frozen prefab levels) is supported. Long-key (C# property names), v0 (`Player`/`AI`) and boss levels (`LevelViewBoss`) are refused explicitly.
- **Bot scripts.** `AiDS`/`AiCWS`/`AiSC` merge into one `bot.script` by `I` across the three lists; gaps or duplicates are an error. Unresolvable refs become `null`.
- **Param overrides depend on archetype defaults.** `params` on a building are written only when the TW value differs from the archetype's value in the catalog. Retuning an archetype changes which overrides are needed: re-import (`check:import` is local-only, so CI will not notice).
- **Never hand-edit imported levels.** `pnpm check:import` diffs bytes against the importer output; change the importer or `tools/src/import-tw/feature-map.json` instead. Deliberate balance edits (bot `startDelayMs`/`actionDelayMs`, building positions/levels) go in `tools/src/import-tw/level-overrides.json`, applied after mapping (currently `levelview-14`, `-15`, `-16`, `-17`, `-49`, `-19`, `-20`, `-100-es`).
