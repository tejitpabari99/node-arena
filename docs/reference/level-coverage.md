# Imported level coverage

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
- **Building collider yaw deviation.** Buildings use the rules-contract AABB, 1.5 × 1.5 (half-size 750 milli); the dumped `Building` trigger has local yaw ≈15°. That prefab yaw is intentionally not applied: buildings have no authored rotation, and game-rules E-TOWER fixes the axis-aligned reach example.
- **Obstacle archetype default.** Hand-authored obstacles without an instance footprint use child 0's dumped box, rounded to 0.713 × 0.713. Imported children retain their own rounded boxes and world `yawDeg`; no importer regeneration is needed.
- **collider fallback: not used.** The real collider dump `tools/src/import-tw/prefab/colliders.json` exists; obstacle footprints are one box + yaw per child.
- `sc` (building param) dropped everywhere; `AiRM` (AI rail moves) dropped if present and recorded as `ai-rail-move`. `MinRD` / `MaxRD` are AI reaction delays: dropped and **not recorded** (`record: false`).

## 6. Fidelity ledger

Computed from `source.dropped` in the imported `levelview-*` files under `packages/content/data/levels/`. Custom `na-*` copies omit `source`; they do not extend this imported-fidelity ledger.

| Dropped token | Levels | Notes |
|---|---|---|
| `cargo` | all 20 | TW cargo pickups not modelled |
| `sc` | all 20 | building param, no equivalent |
| `tutorial-script` | `levelview-182-nb` (10), `levelview-100-es` (23) | prefab levels, scripted components |
| `wall` | `levelview-100-es` (23) | one wall; level plays without it |

No imported campaign level drops anything else. Inactive obstacle children are not in `source.dropped` (they are logged by the importer only).
