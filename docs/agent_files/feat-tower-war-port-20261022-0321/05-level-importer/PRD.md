---
status: draft
summary: Deterministic TS importer (`TW_EXTRACT` raw TextAssets + 2 frozen prefab files -> level v2 files for campaign positions 4-23 + `campaigns/common.json`), computed gating via the registry, and a durable `docs/LEVELS_GUIDE.md` with a generated feature -> levels coverage tracker so later levels need a data row, not an importer rewrite.
date: 2026-10-22
---
# PRD: Level importer, campaign list and "how to add levels" guide (SP05)

Repo/branch: node-arena · feat/tower-war-port · Depends on: 02 (level/campaign schema, `loadCatalog`/`compileLevel`, golden `levelview-1`, `requires` computation), soft 01 (param glossary), 04 (obstacle element semantics), 06 (bot block), 07 (theme ids), 08 (rotation contract) · Feeds: 03 (20 real `CompiledLevel`s), 06/09 (`validate:levels`), 08 (picker), 07 (theme per level)
Owns: `tools/src/import-tw/**` (new: parser, mapper, rotation, serializer, CLI, `feature-map.json`, frozen prefab inputs incl. `prefab/colliders.json`, tests; census is a separate follow-up, N6); `packages/content/data/levels/*.json` (the 20) and `data/campaigns/common.json` *content*; `docs/LEVELS_GUIDE.md`; root scripts `import:tw`, `check:import` (each SP adds its own script lines; 09 only restructures `typecheck`/`build:prerequisites`/`ci.sh`). `tools/src/cli.ts` is owned by 09: 05 adds a one-line registration only. The golden `bounds` constant (pad 2.0) lives in `rotate.ts`/`defs` and is imported, not duplicated, by 02's test.
Does not own: level/campaign *schema*, `requires` function, golden fixture (02); module/archetype definitions (02/04); bot semantics (06); gate wiring in `scripts/ci.sh` (09); lock/version bump commands (02).

## TL;DR
- Input = **raw TW TextAssets** under `$TW_EXTRACT` (not `converted/ext`: it holds only 14 sample files, [verified: `ls converted/ext | wc -l` = 14]) + campaign order from the remote-config defaults JSON. Python stays out of the loop except for the 2 prefab levels, whose reconstructed data is **committed as frozen inputs** (UnityPy-derived, not reproducible in TS).
- Pure TS, three stages: `parseRaw -> TwLevel` (typed, v1-short only; others refused), `mapLevel` (feature map + rotation + gating), `serialize` (canonical JSON). No `Date`, `Math.random`, locale, or fs-order dependence.
- Gating is data-driven: `feature-map.json` rows name the archetype each TW construct maps to; a row whose archetype is absent from the loaded catalog = level **blocked**, not emitted. New feature = archetype/module (02/04) + fill a row; then re-run.
- Coverage tracker: LEVELS_GUIDE §5 ships the static 06 §7.2 table marked "snapshot" plus the exact 20-level breakdown. `census.ts` / `census.json` / generated tracker / histogram test are cut from the critical path into a separate follow-up task after the 20 levels land (N6).
- Output must reproduce 02's golden `levelview-1` byte-for-byte. Frame (rotation, yaw) = the **Frame contract in 02** (data frame = Unity coords rotated `(x,z)->(z,-x)`, yaw `(Y+90)`; assets RAW; 08 owns the single mirror). 05's `rotate.ts` and its yaw test assert that contract.
- Task 0 (before the mapper): colliders dump (R0) so obstacle/building footprints are data, not guesses (B7).

## Problem
- 20 real levels are the gate for SP03/06/08/09 (all need a playable corpus), and the owner wants the other ~1,000 to be addable later [owner brief].
- TW levels are not directly usable: 11 flat lists, 1-3 letter keys, Unity coordinates (portrait), no bounds/theme/time, cargo and tutorial scripts that have no data model, `P[]` order with the human NOT always first (`LevelView 21` = `[neutral, ai, player]`) [verified over positions 4-23: `PT` lists].
- `BD` order is not numeric-id order in 14 of the 18 JSON levels among 4-23 [verified script], so 02's "sorted by TW id numerically" and 06's "tower index = TW BD order" disagree (D4).
- Position 23 (`100_ES`, prefab) contains a **wall**; position 10 (`182_NB`) is a prefab with tutorial components [verified: `ext-prefab`, `prefab_levels_report.txt`].

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Reproducible `pnpm import:tw --range 4-23` -> 20 level files + campaign list, byte-stable | Tutorials 1-3, cargo, `MinRD/MaxRD`, `AiRM`, long-dialect/v0 levels, non-campaign families |
| Refuse/flag levels whose features are not registered; never emit a level the build cannot play | Importing levels 24+ now (CLI + guide ready, data not committed) |
| Guide: add levels, add a feature, hand-author an original level, tracker | Playability/balance validation (09 + 06 harness) |
| Provenance + dropped-construct ledger per level | Lossless `ext -> v2 -> ext` (research target for all 2,195; archived Python proof stays, 02#9) |

## Requirements

### R0 Task 0: colliders dump (before the mapper; B7)
A UnityPy script (Python allowed; output frozen like the prefab files, not reproducible in TS) dumps `BoxCollider.m_Size/m_Center` plus child local scale/yaw for the `Obstacle.prefab` children and the `Building` collider into `tools/src/import-tw/prefab/colliders.json`. 05 reads it to emit per-child obstacle footprints (box + yaw) and `variant`; 04 reads the values from there for content (footprint values, building box). If the dump proves impossible within a day: fallback = 04's circle 450 + calibration against ref screenshots, recorded as a known deviation in LEVELS_GUIDE.

### R1 Inputs and environment
| Input | Path under `$TW_EXTRACT` | Notes |
|---|---|---|
| Campaign order | `assets/data_unity3d/TextAsset/saykit_mlltrna_1.29.3_98@resourcesassets.json` -> `game_settings.levels[]` (`{id,isTutor?}`) | 1,024 ids; position = 1-based index [verified: tutorials at 1-3, `LevelView 1` at 4] |
| Level JSON | `assets/defaultlocalgroup_assets/TextAsset/<asset>_<signed int>.json` | asset -> file by regex `^<escaped asset>_-?\d+\.json$`; 0 or >1 match = error (`LevelView 1_` also prefixes `LevelView 1_AB_...`, so the regex anchors on digits) |
| Prefab levels | committed `tools/src/import-tw/prefab/<slug>.ext.json` (tw-level-ext, copied from `converted/ext-prefab`) | positions 10 and 23 now; copy more as needed; flagged hand-data |
- `TW_EXTRACT` unset: `import:tw` exits 2 with a one-line message; `check:import` **skips** (exit 0, "skipped") so CI without the extract stays green; committed level files are validated by `validate:content` regardless.
- Fixtures committed for tests without the extract: raw `LevelView 1` (+ 2 more with scripts/obstacles) under `tools/src/import-tw/test/fixtures/` (private repo, allowed).

### R2 Mapping: TW -> level v2
| TW | Level v2 | Rule |
|---|---|---|
| asset name | `id`, `name`, `source.asset` | `id` = lowercase, non-alnum runs -> `-` (`LevelView 182_NB` -> `levelview-182-nb`); duplicate slug = error |
| (position in list) | `source.campaignPosition` | 1-based; `source.game/gameVersion` = `tower-war`/`1.29.3`; `source.dialect` = `v1-short` or `prefab` |
| `P[]` entries | `players[]` | `players[]` is re-ordered **human-first independently** of building order (see ordering sentence below). `p`->`human`, `ai_p`->`ai`; ids `p1..pn`: human first, AIs in `P` order; `PC` 0/1/2/3 -> `blue/green/red/yellow`; `n_p` (PT 2, gray) -> no seat, its buildings `owner:null`; `b_p` (boss) -> blocked |
| `BD[]` house `bt 0` | `buildings[]` archetype `house-wt1` (`WT 1`) / `house-wt2` (`WT 2`); `WT 3` -> `house-wt3` (blocked until registered) | |
| `bt 1` tower | `tower` | rocket 3, selectable 7, capture-rocket 8, trolley 10, flag 5, boss 9 -> blocked (rows exist, archetype null) |
| `id` | building `id` `b<twId>` | ids are keys only (never sort keys); keeps cross-refs (`AiCWS`, `AiSA`) stable; unique |
| `p {X,Y,Z}` | `pos {x,z}` after rotation (R3) | `Y` dropped (0.0/0.1 noise) |
| `l`, `cbi` | `level`, `ignoreForWin` | |
| `ml, ws, cwc, gl, ad, ar, supl, rupl, bs` | `params.<module>.<param>` **only when != archetype value** (resolved from catalog) | (`sc` speed-up spawn factor is booster-only: not mapped, recorded in `source.dropped`) e.g. `ml 35` -> `params.level.maxLevel`; `gl 2.0` is the WT2 archetype default, no override. Observed overrides in 4-23: `ml` 34/35/65/99 only [verified] |
| `OBS[]` clusters | one `obstacle` element per **active** child (`S[i]`), ids `o<cluster>-<child>`, authored order; footprint = per-child **box + yaw** from `prefab/colliders.json` (R0) and `variant` (small/big) | `OCP` taken as world positions (child 0 == parent pos [verified]); `yawDeg` = `OCR.Y` after R3; inactive children dropped (logged in report, not in `dropped`) |
| `ROBS, Mine, Wall, Sheep, River, Gate, Railway, WOD` | element rows in `feature-map.json`, archetype null today | non-empty -> blocked, except explicit policy below |
| `Cargo[]` | **dropped**, `source.dropped += "cargo"` | present in all 20 levels |
| `AD` | `bot.actionDelayMs = round(AD*1000)` | ints; 06 requires >= 50 |
| `BT` | `bot.behavior`: 0 -> `full`; 1, 2 -> `attackOnly` | per 06 R5 |
| `AiDS/AiCWS/AiSC` | `bot.script[]` merged **by `I` across the 3 lists** (TW queue is indexed by `I` over all 4 lists, research 04-ai-bots.md); gaps/duplicates = error | `AiDS{D}`->`delay`; `AiCWS{OHId,THId,AD}`->`line{own,target,afterMs}`; `AiSC{AiSA}`->`steps{root}` (`GT` 0 none / 1 line / 2 capture; `OS` -> `then`); ids -> `b<id>`; unresolvable (`WOD` pile, missing) -> `null` |
| `AiRM`, `MinRD`, `MaxRD` | dropped (`ai-rail-move` in `dropped` if present) | 06 R5 |
| (none in TW) | `objective:"captureAll"`, `timeLimitSec:null`, `theme`, `bounds` | R3, R4 |
**Order rule (B2, same sentence as 02 R4 / Decision 4):** `buildings[]` array order = TW `BD` flatten order, buildings concatenated per `P` entry in the ORIGINAL `P` order; ids `b<twId>` are keys only; `players[]` is re-ordered human-first independently. 06 tie-breaks and "building index" depend on this order.

Dropped-construct policy lives in `feature-map.json` as `{tw, action: "map"|"drop"|"block"}`; **anything not listed = parse error** (no silent loss). A conservation test counts every TW list entry as mapped, dropped (in `source.dropped` or logged inactive) or blocked.

**Prefab levels** (pos 10, 23): same mapper from `ext` input. Their `scriptedComponents` (`BaseTutorial`, `TutorLevelBase`) are not data: recorded as `source.dropped += "tutorial-script"`. `100_ES` has 1 wall: **policy for the 20 only**: `wall` is `drop` (`source.dropped += "wall"`), level ships, flagged "deviates from TW" in the guide. [RESOLVED: owner] Q2: drop the wall in `100_ES` and `cargo` in all 20, both logged in `source.dropped` and flagged in LEVELS_GUIDE.

### R3 Rotation, rounding, bounds
- Frame contract (02): data frame = Unity coords rotated `(x,z)->(z,-x)`, yaw `(Y+90)`; assets are imported RAW (07); 08 owns the one mirror at `worldRoot`. This section implements the contract; `rotate.ts` and the yaw test assert it.
- Position: `(x, z) -> (z, -x)` (90 deg clockwise, 08 D1). Exact: no arithmetic beyond negation; `-0` normalised to `0`. Check vs 02 golden: input `(-0.1, -6.79)` -> `(-6.79, 0.1)`.
- Yaw: `yawDeg = (Y + 90) mod 360`, rounded to 2 dp via `Math.round(v*100)/100` (Unity yaw is clockwise from above, same sense as the position rotation; the yaw test asserts the 02 Frame contract; sign confirmed by one rendered L4 vs ref in 08 Task 1).
- Output numbers: positions keep TW's 2 dp; no scaling (native units). `fx3` conversion is the loader's.
- `bounds`: AABB of **building** positions (post-rotation), padded 2.0, floor/ceil to integers. Elements outside are allowed (TW dresses outside the camera; obstacle parents reach +-28) and only logged. Padding is one constant in `rotate.ts` (exported via `defs`); **this rule (R3) and the key order/formatting in R5 are the single source for the fixture**: 02 step 3 writes `levelview-1` with bounds recomputed by this rule (levelview-1 = x -9..6, z -7..8) and its test imports the same constant rather than duplicating it. [RESOLVED: N3]

### R4 `requires`, gating, theme
- `requires` is **not** computed here: importer calls 02's `computeRequires(catalog, level)` and writes the result; the schema validator then re-checks equality.
- Pipeline per level: map -> `blocked[]` (feature rows with absent archetype, unregistered theme, boss/long/v0 dialect) -> if blocked: report `pos, id, reasons`, write nothing. `--allow-blocked` is **not** offered (an unplayable level in `data/levels` fails `validate:content`; 02 defers the `unplayable-listed` picker).
- Theme: `ENV = [green, snow, lava, mine, jungle, darkmine]`; `theme = ENV[floor((position - 1 + ENV_SHIFT)/20) % 6]` (02#4.4), `ENV_SHIFT = 0` default -> positions 4-20 green, 21-23 snow (07 now agrees). [RESOLVED: N1; `ENV_SHIFT` is the only knob, owner screenshots may change it and re-run].
- Campaign list: default writes the **contiguous prefix** `--range 4-N`; a blocked level ends the prefix (report names it). `--skip-blocked` writes a sparse list (retains `position`, TW order preserved). Positions 1-3 and TW's `skip_levels_count`/loop rule are not encoded now (R6).

### R5 Output format and determinism
- `JSON.stringify(obj, null, 2) + "\n"`; objects built in schema key order (`$schema, schemaVersion, id, name, source, theme, bounds, objective, timeLimitSec, players, buildings, elements, requires`); arrays in authored order. Level order in `common.json` = position order. 02's fixture is written with the same convention (R5 owns it; see R3 note).
- Files: `packages/content/data/levels/<id>.json`, `data/campaigns/common.json`. Importer never edits `content.json` or `hashes.lock.json`; it prints "run `pnpm content:lock`, bump `contentVersion`" (02 R8).
- `import:tw` is idempotent; `--check` (= `check:import`) re-runs in memory and diffs bytes against the working tree (needs `TW_EXTRACT`).

### R6 Campaign structure for the full list
`common.json` = `{ id, entries: [{ level, position }] }` (02 R6). For 1,024: entries sorted by `position`; tutorials (1-3) are simply absent; unimported/blocked positions are absent (gaps visible in `position`). TW loop rule (`skip_levels_count` 49 + 3 tutorials = 52, then replay 53..1024) is app policy: propose an **optional** `loop: { fromPosition: 53 }` field to 02 (additive) and keep it unset until >52 levels exist [DEFERRED].

### R7 Tests (`tools/src/import-tw/test/`)
| Test | Needs extract |
|---|---|
| Golden: import raw `levelview-1` fixture == 02's golden **bytes** | no |
| Rotation: unit values; 4 applications = identity; yaw wrap | no |
| Determinism: two runs identical; shuffled input order identical | no |
| Raw -> `TwLevel` parity with Python ext for the 14 files in `converted/ext` | yes (skips) |
| Conservation ledger over all 20 (every TW entry mapped/dropped/blocked) | yes for raw; prefab always |
| Schema + `requires` equality via 02 `loadLevel` for the 20 committed files | no |
| Invariants: human first; 1 <= AI <= 3; every bot ref resolves to a building or `null`; bounds contain all buildings; ids unique; position order = list order; `BD` flatten order preserved (per ORIGINAL `P` order) | no |
| Frame contract: yaw `(Y+90)` and position `(x,z)->(z,-x)` match 02's contract on fixture values | no |
| Colliders: `colliders.json` present, every obstacle child footprint has box size + yaw | no |
| Gating: catalog without `tower` -> `levelview-1` blocked with reason; no file written | no |

## Architecture
```
$TW_EXTRACT raw TextAssets --parseRaw--> TwLevel <--parsePrefab-- prefab/*.ext.json (frozen)
RC defaults JSON --campaign order--> [{id, position}]
prefab/colliders.json (R0, frozen) --> obstacle/building footprints
TwLevel + feature-map.json + catalog(02 loadCatalog) --mapLevel--> LevelV2 | Blocked[]
LevelV2 --computeRequires(02)--> --serialize--> data/levels/*.json ; common.json
(follow-up, off critical path: all 1,024 rows --census--> census.json --report--> generated tracker; N6)
```
Files: `parse-raw.ts`, `parse-prefab.ts`, `feature-map.json` (+ typed loader), `map-level.ts`, `rotate.ts`, `script.ts` (AI queue merge), `serialize.ts`, `cli.ts` (`import:tw [--range a-b] [--only id] [--skip-blocked] [--check]`). Follow-up task (after the 20 levels): `census.ts`, `census.json`, `report.ts`, `--census/--report`, histogram test.

### Coverage tracker (static snapshot in SP05; generation is a follow-up; seeds = 06 §7.2 / 02 §5)
"Unlocks" = additional campaign levels (of 1,012 JSON levels) fully supported once the feature exists; obstacles/cargo/scripted AI counted as decor in 06's base row. First position from 02 §5.
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
Order of middle rows is a choice (06 §7.2 caveat). LEVELS_GUIDE §5 ships this table marked "snapshot" plus the 20-level breakdown below; a recomputed table needs the follow-up census task.

**Our 20 (positions 4-23), exact [verified by my scan of raw + prefab ext]:** feature sets excluding WT1/WT2 houses (WT2 is the same modules) and cargo (dropped): base only = 1 level (pos 8); + obstacles (`blocksLines`) = 5 (+12, 17, 5, 23*); + tower = 11 (+4, 9, 14, 7, 16, 19); + scripted AI (`bot:tw` script) = 20. (*pos 23 also has a dropped wall.) All 20 contain cargo (dropped); 13 obstacle levels, 9 scripted, 10 tower levels.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| 1 | Input | Raw TextAssets + frozen prefab ext | `converted/ext` (only 14 files); keep Python as prerequisite | `pnpm` reproduces given `TW_EXTRACT`; 06 §3.11 recommended TS; prefab needs UnityPy so it is frozen data |
| 2 | Parser scope | v1-short only; long/v0/boss refused | Port all dialects | Positions 4-23 are v1-short or prefab [verified]; 02#3.1 counts only 76 long + 30 v0 files, none in RC lists; refusal is explicit |
| 3 | Gating | `feature-map.json` rows + catalog presence | Hardcoded `if`s; emit unplayable levels | Adding a feature is a data row; no dead levels on disk |
| 4 | Entity order | `BD` flatten order, concatenated per `P` entry in ORIGINAL `P` order; ids `b<twId>` keys only; `players[]` human-first independently | Numeric TW id | 06 tie-break needs TW order; ids are only stable keys; 02 R4/D4 carries the same sentence (applied) |
| 5 | `requires` | Call 02's function | Re-implement | One definition |
| 6 | Campaign gaps | Contiguous prefix default, `--skip-blocked` opt-in | Always sparse | Keeps TW's difficulty ramp unless owner opts out |
| 7 | Cargo / wall (pos 23) / tutorial scripts | drop + ledger | Block level 23; model cargo | Scope says cargo skipped; 20 levels needed |
| 8 | Bounds | building AABB + 2.0 pad, integer outward | Fixed 18x12; include obstacles | Obstacle parents far outside camera; camera dollies (08) |
| 9 | Tracker | Static snapshot table now; generated-from-census is a post-20-levels follow-up | Generate now | Census needs long/v0/boss dialect parsing (non-goal); nothing in the gates or the 20 levels needs it (N6) |
| 10 | CI | `check:import` skips without extract | Require extract in CI | Extract is local-only |

## Manual steps
- Owner (Q2 [RESOLVED: owner]: cargo and wall(23) drops confirmed); optionally provide TW screenshots for mirror check (07 manual step) and theme boundary.
- Whoever lands levels runs `pnpm content:lock`, bumps `contentVersion` (CONTENT_GUIDE), updates the tracker snapshot (generated tracker is the post-20-levels follow-up).

## Docs: `docs/LEVELS_GUIDE.md` (outline, owned here)
1. Pipeline map and what is committed vs local-only. 2. **Import more levels**: set `TW_EXTRACT`; `pnpm import:tw --range 24-43`; read blocked report; lock, bump, `check:import`, `validate:levels`. 3. **Add a feature to unlock levels**: pick next row by "Delta" in the tracker snapshot; define module/archetype (02 R9 "new behaviour" flow); add/fill `feature-map.json` row (`tw` field -> param mapping); re-run import. 4. **Hand-author an original level**: copy the golden, `id` prefix `na-`, omit `source`, set `theme`/`bounds`, owners, `bot` block, campaign entry; `requires` filled by tool [RESOLVED: `requires` filled manually until `--fix-requires` exists (DEFERRED, docs/FUTURES.md); LEVELS_GUIDE section 4 states this; optional `source`/`position` made available by 02]. 5. Tracker (static snapshot + 20-level breakdown; also records deviations, e.g. collider fallback). 6. Fidelity ledger: dropped constructs per level, cargo, tutorial scripts. 7. Gotchas: rotation, human-not-first in `P`, `BD` order, inactive obstacle children, file-name hash suffix, long/v0 dialects.

## Risks
| Risk | Mitigation |
|---|---|
| Golden bytes differ (bounds rule, key order, number formatting) | R5/R3 own the rule; 02 step 3 writes the fixture from it and imports the one constant; golden test is Task 1 |
| Obstacle semantics wrong (`OCP` local vs world, sizes, big/small) | `OCP` world confirmed on 2 samples; sizes/variant from R0 `colliders.json`; fallback circle 450 + calibration recorded as deviation; render check vs reference (07/08) |
| `BD` vs id order wrong for TW's real tie-break | TW introsort is unstable anyway (06 D5); ordering is a single flag in `map-level.ts` |
| Mirror from Unity left-handedness | Frame contract (02): data is pure rotation, 08 owns the single mirror at `worldRoot`; yaw test asserts it |
| Frozen prefab data drifts from game | Provenance in `source`; only 2 files now |

## Open Questions
- [RESOLVED: Frame contract in 02 (pure rotation in data, single mirror in 08); confirmed by one rendered L4 vs ref in 08 Task 1]
- [RESOLVED: N1 env boundary: 4-20 green, 21-23 snow; `ENV_SHIFT` is the only knob]
- [RESOLVED: N3 golden `bounds`/serializer rule owned here (R3/R5), 02 imports the constant; B2 order sentence applied in 02 R4]
- [RESOLVED: B7 obstacle `variant` and footprint sizes come from R0 `colliders.json` (fallback circle 450 + calibration); child index kept in id]
- [RESOLVED: owner] Q2: drop wall in `100_ES` + cargo in all 20, logged in `source.dropped`.
- [RESOLVED: 02 makes `source`/`position` optional now; `--fix-requires` and campaign `loop` DEFERRED to docs/FUTURES.md] 02: optional `source`/`position` for hand-authored levels; `--fix-requires`; optional campaign `loop`.
- [RESOLVED: string list, no counts] Whether `source.dropped` needs counts (strings today).
- [DEFERRED] Levels 24+, long-dialect/v0, other families, packs, lazy loading beyond 02 R6.
- [RESOLVED: D1] Importer input.

## Acceptance Criteria
- `TW_EXTRACT=... pnpm import:tw --range 4-23` writes 20 level files + `common.json`; second run changes nothing; `pnpm check:import` clean; without the extract it skips.
- Imported `levelview-1` equals 02's golden byte-for-byte; all 20 pass `validate:content` (schema, `requires` equality, refs, bounds, `level <= maxLevel`).
- Positions 10 and 23 come from committed prefab files; each of the 20 lists `cargo` (and `wall`, `tutorial-script` where applicable) in `source.dropped`. [RESOLVED: review 2026-10-22 — booster-only keys like `sc` (spawn factor, not mapped, R2) are also listed in `source.dropped` using the TW key as the token; the `levelview-1` golden ships `["cargo", "sc"]`, sorted]
- Conservation, rotation/yaw (Frame contract), determinism, gating and colliders tests pass.
- `docs/LEVELS_GUIDE.md` exists with all 7 sections; §5 = static 06 §7.2 table marked "snapshot" plus the 20-level breakdown (generated tracker is the follow-up); a dry run of section 2 on `--range 24-25` reports `LevelView 101_ES` blocked by `wall`, writing nothing.
- No change to files outside Owns except root scripts and `content.json`/lock via the documented commands.
