---
status: draft
summary: One pure `packages/defs` registry (modules, commands, events, objective, bot kind, visual kinds) plus the v2 content model (units, building/element archetypes, level v2, campaign list, balance, manifest contract); old Node Arena content deleted at a single planned cutover; hashes/locks/versions regenerated at 2.0.0.
date: 2026-10-22
---
# PRD: Registry + content model v2 (SP02)

Repo/branch: node-arena · feat/tower-war-port · Depends on: 01 (rule ids, §7 param glossary) · Feeds: 03 (CompiledLevel, binding map), 04 (elements, `canDraw` reasons), 05 (level + campaign schema), 06 (bot-kind slot), 07 (manifest schema), 08 (catalog/campaign loader), 09 (lock/version gates)
Owns: `packages/defs/**` (new); `packages/content/**` (src, data, schemas, `content.json`, `hashes.lock.json`, scripts, tests); `tools/src/content.ts`; one-line content/manifest branch registrations in `tools/src/cli.ts` (the file itself and root `package.json` structure/`typecheck`/`build:prerequisites`/`ci.sh` are 09's: SP02 adds only its own script lines); `docs/CONTENT_GUIDE.md`. Footprint **values**: SP02 ships schema + placeholder values; SP04's single commit edits the values and bumps content.
Does not own: rule text (01); sim code/tests and sim `modules/` impls (03/04); the 20 level files + real campaign list (05; SP02 ships schema + one golden fixture); `tw` bot params semantics and `packages/bots` (06); manifest *data* + web manifest code (07); `tools/src/{levels,balance*,replay}.ts`, CI wiring (09); web (08).

## TL;DR
- New pure package `@node-arena/defs`: **one explicit list per concept**. Content, sim, bots, web, tools import it. Sim/web bind implementations with `Record<ModuleId, Impl>`: a missing impl is a compile error. No codegen, no runtime parity assert, no second hand-written list.
- Behaviour unit = **module** (`level`, `drawsLines`, `spawns`, `grows`, `shoots`, `blocksLines`). Buildings and elements are **data archetypes** composing modules; units are flat data (hp/attack/defense/speed). New tower of an existing kind = 1 file.
- Level v2: `buildings[]` (authored order = semantic index), `elements[]`, per-seat inline `bot`, landscape `bounds`, `theme`, `source` provenance, computed `requires`. Coordinates `{x,z}`.
- Campaign = `data/campaigns/common.json` (explicit entries); catalog and per-level loading are separate calls, so ~1,000 levels can lazy-load.
- Old content is deleted at **one planned cutover** (shared with SP03 T1). Everything before it is additive and green.
- Versions reset: `schemaVersion`/`contentVersion`/`rulesVersion` 2.0.0, lock regenerated, `RULES_VERSION` set by 01.

## Problem
Verified in this worktree:
- Component list is duplicated (`packages/content/src/component-registry.ts` literal, sim `createComponentRegistry` in `packages/sim/src/registry.ts`) and reconciled by runtime `assertParity` (`sim/src/state.ts:137`).
- Closed unions block TW: `Command`/`RejectReason`/`SimEvent`/`Outcome` (`sim/src/commands.ts:4-19`), `BOT_CONSIDERATIONS`/`BOT_ACTIONS` (`content/src/bot-params.ts`), bot `kind` utility|idle, manifest `visuals.kind` tower|troop and `anim` none|bob (`manifest.schema.ts`), `BUILTIN_FX` (`web/src/manifest/resolve.ts:16`), troop `value` pinned 1..1.
- Level schema has `order`, `band`, `botProfile`, `towers[].garrison`, `team`, reserved `obstacles`/`mapObjects` that the validator rejects; validator pins 1 human + 1-3 bots and campaign order <= 20 (`validate-content.ts`); web globs every JSON eagerly (`app/boot.ts`).
- `convertFixedPoint` walks only `properties`/`patternProperties`/`items`/`additionalProperties`, so fx3 params cannot sit under `oneOf` [verified: `fixed-point.ts`]. Constrains schema design below.

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| One definition registry read by content, sim, bots, web, tools | Module versions in replay header, phase partial order, codegen barrel (deferred; trigger >15 modules) |
| Exact TW numbers for the 20 levels as content, keyed by 01's glossary | Importer (05), AI logic (06), sim behaviour (03/04), art (07) |
| Level v2 / campaign / manifest schemas SP03-08 can code against | v1 compat, `extends` inheritance, level `overrides`, rules profiles, packs |
| Old content deleted without leaving a red repo mid-way | Unit modules (shield/ranged), walls, mines, rivers: *schema room only* |

## Requirements

### R1 Inventory (grep-backed)
| Area | Verdict |
|---|---|
| `content/src`: `component-registry`, `resolve-archetypes`, `resolve-overrides`, `resolve-profiles`, `bot-params`, `bot.schema`, `troop.schema`, `core.schema` | delete (replaced by `defs` + new schemas) |
| `parse-content`, `loader`, `compile`, `validate-content`, `versioning`, `manifest.schema`, `index` | rewrite (same roles) |
| `fixed-point`, `hash` (`sha256`, `canonicalJson`), `validate` (Ajv), `credits` | keep (hash input list rewritten) |
| `content/data`: 20 levels + `sample.json`, 3 archetypes, `troops/regular`, 24 bot profiles + README, `examples/sample-bot.json`, `balance.json` | delete / rewrite `balance.json` |
| `content/test` (20 test files + fixtures) | keep & adapt: `browser-safety`, `credits`, `content-lock-cli`, `versioning`, `hashing`; rest rewritten or deleted with the code they cover |
| `content/scripts`: `content-lock`, `generate-schemas`, `bot-version` | keep, adapt (levels detected by shape; schema list from defs) |
| sim `registry.ts` | deleted by 03; replaced by binding map (R2) |
| `tools/src/content.ts` (baseline/lock check), content branch of `cli.ts` | rewrite; `levels.ts` (`band`), `balance*`, `replay` are 09's |
| `docs/CONTENT_GUIDE.md` | rewrite |

### R2 `packages/defs` (pure TS, TypeBox only, browser-safe, no I/O)
| Export | Shape | Consumers |
|---|---|---|
| `MODULES` (`src/modules/<id>.def.ts`) | `{ id, appliesTo: 'building'\|'element', params: TObject, ruleIds[], feature }`; param builders `fx3()`, `count()` embed the `x-unit` tags the loader needs | content (schema, validation), sim/bots (types), web (labels) |
| `COMMANDS` | `{ id, payload: TObject, rejectReasons: string[], ruleIds }`: `DrawLine`, `CutLine` (no `UseBooster`: boosters deferred, 01 R11) | sim, bots, web, replay validation |
| `EVENTS` | `{ id, payload }`; manifest `events` keys validated against it | sim, web fx/audio |
| `OBJECTIVES` | `{ id, ruleIds, seats: {human:1, aiMax:3} }`: `captureAll` only | content validator, sim |
| `BOT_KINDS` | `{ id, params: TObject, buildingRefs(params) -> ids }`: `tw` (schema from 06 R5) | content (validates seat `bot`, cross-refs), bots |
| `VISUAL` | closed-by-registry id sets: `RENDER_KINDS` (unit, building, element, ground, lane, fx), `ANIM_MODES`, `TEAM_MODES`, `FX_KINDS`, `BUDGET_CLASSES` | manifest schema, 07/08 |
| `PHASES` | the 9-name tuple from 01 R5 | sim, modules (`phases[]` per def) |
| derived | `ModuleId`, `Command`, `EventOf<..>` types via `Static`; `CAPABILITIES` = module ids + `bot:<kind>` + `objective:<id>` | everywhere |

Binding (compile-time): `sim/src/modules/index.ts` exports `const IMPLS = { level, drawsLines, spawns, grows, shoots, blocksLines } satisfies Record<ModuleId, SimModule>`; web does the same for overlay/label hooks only when a module needs one. Adding a module = one line in `defs/src/index.ts` + one in each binding map; tsc names the missing side. Stray impl = excess-property error. `defs` has no sim imports; sim imports defs, never reverse. `ruleIds` are cross-checked against `GAME_RULES.md` headings by a content test (replaces component `ruleIds`).

### R3 Data model (`packages/content/data/`)
| File | Content |
|---|---|
| `balance.json` (singleton) | `stageThresholds [10,30]`, `spawn.aliveCap 30`, `growth.base 0.9`, `contactDistance 0.7`, `laneHalfWidth 0.19`, no boosters block [RESOLVED: owner Q3 - boosters deferred; see docs/FUTURES.md via SP09]; `timeLimitSec` is a level field; remaining values verbatim from 01 §7 (R10 key table) |
| `units/{soldier,tank}.json` | `visual`, `speed 5`, `hp/attack/defense` 1/1/1 and 2/1/2 |
| `buildings/{house-wt1,house-wt2,tower}.json` | `kind`, `visual`, `footprint` (`{shape:'circle',radius}` or `{shape:'box',w,d}`, fx3; both archetype kinds accept both; shipped values are placeholders, 04 edits them), `special` (bool; **`house-wt2.special = true`; `house-wt1` and `tower` = false**), `modules {...}` |
| `elements/obstacle.json` | `visual`, `footprint` (circle or box), `modules {blocksLines:{}}`, `variants?: ['small','big']` |
| `campaigns/common.json` | R6 |
| `levels/<id>.json` | R4 |

Module params and TW keys (long names from the tw-level-ext schema; 01 §7 / R10 table wins on conflict, a test diffs its key table against these schemas):
| Module | Params | TW | Instance override |
|---|---|---|---|
| `level` | `maxLevel` | ml | yes (30 on some houses) |
| `drawsLines` | none (slots = stage, 01 LIN-02) | - | - |
| `spawns` | `troop` (unit id), `spawnSpeed 0.5`, `lineSpawnPenalty 0.3` | WT, ws, cwc | yes |
| `grows` | `growTime` (1.7 WT1, 2.0 WT2) | gl | yes |
| `shoots` | `attackDelay 2.0`, `attackRadius 1.6`, `speedUpByLevel 1.75`, `radiusUpByLevel 0.9`, `radiusUnit 2.4`, `minRadius 1.0`, `neutralFires true` (bool; [RESOLVED: owner Q1 - neutral towers fire]), `troopPad 0.35` (fx3 -> 350 milli; decomp-trusted reach), `hitsNeutralHouses true` (bool; [RESOLVED: owner — towers hit neutral houses]), `bulletSpeed 12` (`x-presentation`, not hashed) | ad, ar, supl, rupl, bs (flags have no TW key) | yes (rare ar 1.2-1.5) |
| `blocksLines` | none (corridor = `laneHalfWidth`) | OBS | - |
Start level and `cbi` are instance fields (`level`, `ignoreForWin`), not module params.

### R4 Level v2 (`schemaVersion 2.0.0`)
```jsonc
{ "$schema": ".../level.schema.json", "schemaVersion": "2.0.0", "id": "levelview-1", "name": "LevelView 1",
  "source": { "game": "tower-war", "gameVersion": "1.29.3", "asset": "LevelView 1", "campaignPosition": 4, "dialect": "v1-short", "dropped": ["cargo"] },
  "theme": "green", "bounds": { "minX": -9, "maxX": 6, "minZ": -7, "maxZ": 8 },   // landscape frame, fx3: building AABB + 2.0 pad, floor/ceil outward (05 R3)
  "objective": "captureAll", "timeLimitSec": null,                                // both optional
  "players": [ { "id": "p1", "kind": "human", "colorKey": "blue" },
               { "id": "p2", "kind": "ai", "colorKey": "red", "bot": { "kind": "tw", "actionDelayMs": 12000, "behavior": "full", "script": [] } } ],
  "buildings": [ { "id": "b0", "archetype": "house-wt1", "pos": { "x": -6.79, "z": 0.1 }, "owner": "p1", "level": 20, "ignoreForWin": false, "params": { } } ],
  "elements":  [ { "id": "e0", "archetype": "obstacle", "pos": { "x": 0, "z": 0 }, "yawDeg": 30, "variant": "big" } ],
  "requires": ["bot:tw", "drawsLines", "grows", "level", "shoots", "spawns"] }       // computed
```
- Owner `null` = neutral (no neutral seat). `team`, `order`, `band`, `botProfile`, `overrides`, `garrison`, `towers` removed. Human present, 1 <= AI <= `objective.seats.aiMax`.
- **Array order is semantic**: dense indices for players/buildings/elements follow authored order. `buildings[]` order = TW `BD` flatten order: buildings concatenated per `P` entry in the **ORIGINAL `P` order**; ids are `b<twId>` and are keys only (never sorted, never used for order); `players[]` is re-ordered human-first independently of that. 01 TCK-03 tie orders and 06's "building index" depend on it. Ids unique.
- `params` = partial module bags, validated by the owning def (`Type.Partial`), merged over the archetype, resolved values hashed. `requires` is derived (module ids used + `bot:<kind>` + `objective:<id>`) and validated equal to the recomputed set; campaign entries are playable iff `requires` is a subset of `CAPABILITIES`.
- Validation: refs (archetype, owner, theme, colorKey), `level <= effective maxLevel`, **`buildings` positions inside `bounds`** (check applies to buildings only; `elements` outside `bounds` are allowed and only logged, since obstacle parents reach +-28), **>= 1 non-ignored building** (win/loss never vacuous), coincident buildings = error, footprint overlap = **warning** until the footprint [OPEN] settles, bot cross-refs via `BOT_KINDS.buildingRefs`.
- **Bounds rule and constant**: bounds = AABB of building positions (post-rotation) + 2.0 pad, floor/ceil outward to integers (05 R3). The pad constant is exported from one place (`defs` or content; 05's `rotate.ts` and 02's test both import it, no duplicate literal).
- **Frame contract** (golden fixture, 05/07/08 cite this paragraph): data frame = Unity coordinates rotated `(x,z) -> (z,-x)`, yaw `(Y+90)`. Assets are imported RAW (no x-negate, no winding fix; 07 drops those steps). SP08 owns exactly one mirror at the scene root (`worldRoot.scale.z = -1` or equivalent so screen-right = +x, screen-up = +z; three.js flips face winding for negative-determinant objects). Label/text sprites live outside the mirrored root. 05 `rotate.ts` and its yaw test assert this contract; 07 Task 1 validates the turntable under this root; one rendered L4 vs ref in 08 Task 1 verifies.

### R5 `CompiledLevel` contract (SP03/04/06/08 code against)
`{ id, objective, timeLimitSec|null, bounds, theme, rules {timeLimitSec, stageThresholds, aliveCap, growth{base}, contactDistance, laneHalfWidth} (resolved balance subset used by sim; fx3 values milli-ints), players[{id,kind,colorKey}], units[] (referenced, sorted by id, dense index), buildings[{id,archetype,x,z,owner (-1 neutral),level,ignoreForWin,special,footprint,visual,modules:{[ModuleId]:params}}], elements[{id,archetype,x,z,yawMilliDeg,footprint,visual,variant?,modules}], bots[{player,bot}], requires, simHash, botHash:{[levelId#playerId]} }`. fx3 values are milli-ints. `simHash` covers everything except `name`, `source`, `theme`, `visual`, `variant`, `x-presentation` params and bots; `bounds` is hashed (sim view exposes it, 08).

### R6 Campaign list and loading
- `data/campaigns/common.json`: `{ id, entries: [{ "level": "levelview-1", "position": 4 }, ...] }`. Array order = play order; `position` is TW provenance (08 decides display numbering). No loop/skip/env rules: theme is stored in each level.
- API (browser-safe): `loadCatalog(files)` validates everything except levels (balance, units, buildings, elements, campaigns) once; `loadLevel(catalog, json)` parses + validates one level; `compileLevel(catalog, level)`. `loadContent(all)` stays for tools/tests. Also exported: `computeRequires(catalog, level)` (the derived `requires` set; 05 calls it, validator compares against it). Level path is `data/levels/<id>.json` (flat; ids are slugs), so web uses non-eager `import.meta.glob` and fetches on demand. 20 levels may stay eager; nothing else changes at 1,000.

### R7 Manifest contract for SP07 (`MANIFEST_SCHEMA_VERSION 2.0.0`; satisfies 07 "Contract SP02 must provide")
`visuals.<id>.kind` in `RENDER_KINDS`; `model {parts, budget}` with `budget` in `BUDGET_CLASSES` (`unit 1100`, `building 1200`, `obstacle 300`, `ground 500` tris, texture <=256); `stages[]` of `{mesh|enable[]}` indexed by **stage, not level** (length must equal `stageThresholds.length + 1`; thresholds stay in content only); `team {mode:'textureSwap', textures{blue,green,red,yellow,gray}}`; `anim {mode:'none'|'node-tracks', clips{run,death}}`; `themes.<id> {ground{mesh,texture}, obstacle{small,big,texture}, light, fog?, sky, fx?}`; `fx.<id> {texture, kind in FX_KINDS, params}`; `events` keys in `EVENTS`; `palettes` single set incl. `gray`; `camera`. Removed: `tint`, `bob`, `build:'stacked'`, `levelVisuals`, `colorblind`. Cross-checks: archetype/unit/element `visual` exists with matching kind; `level.theme` exists; every `colorKey` has a texture; `events` known.

### R8 Versions, hash, lock
`SCHEMA_VERSION`, `MANIFEST_SCHEMA_VERSION`, `contentVersion` all 2.0.0 (> baseline 1.1.6): a **single bump against the branch merge-base**; `check:content` honours `VERSION_GUARD_BASE` (owned by 09 Phase A, task 0 before SP01) so later hash moves on the branch do not need re-bumps. Release runs without the env. `hashes.lock.json` shape `{levels:{id:simHash}, bots:{"<levelId>#<playerId>":botHash}}`, regenerated from scratch; `BOT_VERSION` is bumped to 2.0.0 **inside CUT** (`version.ts` only; the lock's `bots` keys change to `level#player` there), 06 keeps semantics. `contentVersion` rule unchanged: bump when any `simHash` moves. A balance edit moves every level hash because resolved rules are hashed. Schemas regenerated (`unit`, `building`, `element`, `campaign`, `level`, `balance`, `content`, `manifest`); `bot` schema deleted (seat `bot` validated by `BOT_KINDS`).

### R9 Extension flows (CONTENT_GUIDE rewrite)
| Change | Authored files | Generated |
|---|---|---|
| New tower of existing kind / numbers | `data/buildings/<id>.json` (+ manifest visual if new art) | schema, lock, bump |
| New level | `data/levels/<id>.json`, entry in campaign | lock, `requires` check |
| New unit with existing behaviour | `data/units/<id>.json` (+ building archetype) | lock |
| New behaviour (wall, mine, rocket tower) | rule text (01 flow), `defs/modules/<id>.def.ts`, `sim/modules/<id>.ts`, element/building JSON, tests | schema, `ModuleId`, `requires`, compile errors for missing bindings |
| New bot kind / command | def file + impl file | schema union / union type |
Today this is ~12-14 files across 6 places [06 §3.15].

## Architecture
```
defs (pure) <- content (schemas, loadCatalog/loadLevel/compile, hash, lock) <- sim <- bots
        ^------------------ tools (gates) ------------------- web (non-eager level glob)
```
**Migration sequence (repo stays green until the marked cut)**
| Step | Change | Gate state |
|---|---|---|
| 1 | `packages/defs` + tests (root-script edits `build:prerequisites`/`typecheck` are deferred to 09 Phase A, single owner) | all green, no consumer |
| 2 | sim stays additive too (03 stages `packages/sim/src/next/` through step 3). `content/src/next/` (schemas, loaders, compiler, hash, validator) + `content/data-next/` (balance, units, buildings, obstacle) + `test/next/`; shared files imported from `../` | all green; old game untouched |
| 3 | `next/manifest.schema.ts`; glossary-parity and `ruleIds`-parity tests; **golden fixture** `levelview-1` hand-rotated per the Frame contract (R4; e.g. b0 `(-0.1,-6.79)` -> `(-6.79, 0.1)`), with bounds recomputed by the 05 R3 rule (x -9..6, z -7..8), key order per 05 R5 (`$schema, schemaVersion, id, name, source, theme, bounds, objective, timeLimitSec, players, buildings, elements, requires`), serialized `JSON.stringify(...,null,2)+"\n"`; 05's importer must reproduce it byte-identically; one synthetic obstacle+tower fixture | all green |
| 4 **CUT** (one commit, = SP03 T1) | content: `git rm` R1 delete list and `data/`, move `next/*` and `data-next/*` up, fix `../` imports, set 2.0.0 versions, regenerate schemas + lock, port `tools/src/content.ts` + `scripts/content-lock.ts`. sim: mechanical `git mv`/delete only (03 staged the new engine in `sim/src/next/`; it removes `registry/economy/combat` and old tests). **PARKED list** (09 Phase A runner, owner SP in brackets): `typecheck:bots|web`, `test:bots|web`, `build:bots|web` [06/08], `tools:levels|balance|replay` (those three files and their tests move under `tools/src/_parked/`, excluded from tsconfig, restored by SP06/09), `check:manifest` [SP07; CUT ships **no v2 manifest**], plus (already parked from the SP01 commit) `sim:golden`, `replay:verify`, `bots:golden`, `validate:levels`, `bench:*`, web e2e; `check:rules` red until 03/04. `BOT_VERSION` = 2.0.0 in `version.ts` (bots otherwise untouched). `tools/src/cli.ts` consumes manifest validation from `@node-arena/content` (not `apps/web/src/manifest`), so tools no longer depend on web. Live and green: `build`/`lint`/`typecheck` of the live set (defs, content, sim, tools minus parked), content gates, live tests | live set green; PARKED list lives in 09's runner (Phase A), not hand-edited here |
| 5 | CONTENT_GUIDE rewrite | green |
| 6 | 05 lands 20 levels + campaign; lock regenerated; SP02 reviews format fit | green |
No migration of v1 data and no shims: the only temporary duplication is the `next/` directory in steps 2-3, deleted by step 4.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| 1 | Registry registration | Explicit list in `defs/index.ts` + `Record<ModuleId,…>` in each consumer | Generated barrel (`modules:index`), runtime parity | Fewer tools; tsc is the check; 6 modules |
| 2 | Behaviour unit | Module bag on archetypes; units flat | Per-kind classes; unit components | Rocket tower = new module + 1 JSON; unit modules wait for a user |
| 3 | `extends`, `overrides`, profiles, packs | Dropped | Keep depth-1 `extends` | 3 buildings; WT2 is a 10-line copy; no consumer |
| 4 | Coordinates + order | `{x,z}` plane; array order = TW `BD` flatten order (buildings concatenated per `P` entry in ORIGINAL `P` order); ids `b<twId>` are keys only; `players[]` human-first, reordered independently | `{x,y}` as today; sorted ids (numeric or lexical) | Matches rotation formula and three.js ground; sorting differs from TW tie-breaks (numeric differs from `BD` order in 14 of 18 JSON levels) and lexical sort breaks numeric ids (`b10<b2`) |
| 5 | Stage thresholds | Content only; manifest indexes by stage | Manifest `minLevel` | One source; sim needs it for slots |
| 6 | Bot block | Inline on seat, validated by `BOT_KINDS`, ints in ms (06) | Profile ids; fx3 params | Avoids walker `oneOf` gap; recursion handled by Ajv |
| 7 | Hash split | `simHash` w/o bots/presentation; `botHash` per `level#player` | Bots in simHash | Replay checks commands; BOT_VERSION gate keeps working |
| 8 | Loading | `loadCatalog` + `loadLevel` | Whole-pack `loadContent` | Lazy path with no later API break |
| 9 | Phases | Fixed tuple from 01 | Partial-order assembler | Deferred; one phase list in 01 |
| 10 | Cutover | One shared commit with SP03 T1; additive before | Parallel stacks to the end; red branch | Bounds the red window to parked packages |
| 11 | Neutral | `owner: null`, no seat | Gray player (TW) | Same as today; bots/sim ignore |

## Manual steps
None.

## Risks
| Risk | Mitigation |
|---|---|
| Parked window (bots/web/tools) is long if 03 slips | CUT happens only when 03 T1 is ready; steps 1-3 independent of it |
| Glossary names drift from 01 §7 | Parity test fails build until aligned |
| Footprint values wrong (blocking) | Schema holds shape union; values are data (05/04) |
| Hash churn from resolved-rules hashing | Intended; one 2.0.0 reset |
| `Type.Partial` loses `x-unit` tags | Test: override value scales identically to archetype value |

## Open Questions
- [OPEN] Blocking footprint sizes (01 OPEN): `footprint` supports circle/box; obstacle child sizes come from 05 Task 0 collider dump (`colliders.json`); 04 writes values (single commit + content bump). Unblocks overlap warning -> error.
- [RESOLVED: `special` = archetype boolean; `house-wt2.special=true`, `house-wt1`/`tower` false; 06 reads `buildingStatic.special` only (N9)]
- [RESOLVED: defined by 03 CUT] Final `EVENTS` list and complete payload types are written by 03 T1 (CUT) in `defs` EVENTS; 04 only emits.
- [RESOLVED: 01 R10 lists the exact content keys (`maxLevel, spawnSpeed, lineSpawnPenalty, growTime, attackDelay, attackRadius, speedUpByLevel, radiusUpByLevel, radiusUnit, minRadius, neutralFires, troopPad, hitsNeutralHouses`); parity test diffs against them]
- [RESOLVED: owner accepts parked window; all gates green before merge]
- [RESOLVED: `{x,z}`; 03 R7 (`view.buildings/buildingStatic{x,z}`) is the contract and 08 is rewritten to it]
- [RESOLVED: owner Q2] Level 23 (`100_ES`) wall and `cargo` in all 20 levels are dropped (logged in `source.dropped`, flagged in LEVELS_GUIDE; wall revisit via 04 seam in FUTURES).
- [RESOLVED: owner Q1] `shoots.neutralFires` ships **true** (neutral towers fire; content flag kept). [RESOLVED: owner Q3 - boosters deferred; see docs/FUTURES.md via SP09] No booster content, schema, `CompiledLevel.rules.boosters`, or booster commands/events.
- [RESOLVED: dropped, `source.dropped`] cargo (present in several of the 20 levels); AiRM ops dropped by 05/06.
- [DEFERRED] Module versions / replay header map, phase partial order, reserved-module status, unit modules, `extends`, packs, `unplayable-listed` picker.

## Acceptance Criteria
- `pnpm build:prerequisites`, `lint`, `typecheck` (live set), `check:schemas`, `check:content --base "$VERSION_GUARD_BASE"`, `validate:content` green after every step (parked gates per step 4 excluded); after CUT no file in R1 delete list remains (grep: `COMPONENT_REGISTRY`, `assertParity`, `botProfile`, `band`, `data/bots`).
- Removing a `defs` module or its sim binding fails `tsc` naming the module; no runtime parity code exists.
- Golden fixture `levelview-1` (bounds x -9..6, z -7..8, 05 R5 key order, `JSON.stringify(...,null,2)+"\n"`) loads, compiles, hashes stably across runs; `requires` mismatch, unknown archetype, bad owner, out-of-bounds, over-`maxLevel` and unknown bot ref each fail with file+pointer; a level with an obstacle element outside `bounds` validates (logged only), a level with no non-ignored building fails.
- Glossary parity and `ruleIds` parity tests pass against merged 01 doc; `Type.Partial` override scales like archetype values.
- `loadCatalog` + `loadLevel` work without Node APIs (`browser-safety` test) and without reading other levels.
- Manifest v2 schema satisfies every row of 07's contract table; a fixture manifest validates against content cross-checks.
- CONTENT_GUIDE walks "add a tower kind" (1 file) and "add a level" (2 files) and "add a module" against the real tree.
