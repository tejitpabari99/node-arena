---
status: draft
summary: Contract for all other sub-projects — GAME_RULES.md structure + fully data-driven, schema-validated, hashed content model (archetype components, troops, balance, levels, bots, visual keys) with fixed-point numerics
date: 2026-10-07
---
# PRD: Rules + Data-Driven Content Model (SP01)

Repo/branch: node-arena · feat/game-design · Depends on: nothing
Owns: `docs/GAME_RULES.md`, `packages/content/**` (schemas, component registry, loader/compiler, hashing, validator, data files except campaign levels 01-20 and bot-profile inner params), `packages/content/data/{balance,troops,archetypes}`, `docs/CONTENT_GUIDE.md` (change process)

## TL;DR
- GAME_RULES.md owns **mechanics** (rule IDs `R-AREA-NN`); JSON files own **numbers + composition**. The engine is a generic interpreter: changing a rate, troop power, or tower position is a data edit only.
- Towers are **archetypes composed of components** with params (`garrison`, `generates`, `drawsLines`, `capturable`); troops are typed param bags. Unknown component/kind/field = validation error, never ignored.
- Schemas in **TypeBox** (JSON Schema + TS types from one source). Raw JSON → validate → **compile** to an all-integer `CompiledContent` that sim consumes. No floats reach sim.
- Content is versioned (`CONTENT_VERSION`, `RULES_VERSION`, `SCHEMA_VERSION`) and hashed (`simHash`) for replays and the v3 handshake.

## Problem
Brief locked "mechanics in rules, numbers in balance.json". New requirement: *everything* (tower kinds, troop kinds, stats, maps, obstacles, bots, visuals) is data. Without a defined contract, sim/web/bots/levels will each invent shapes, and v2 (archer, tank, power-ups, obstacles) and v3/v4 (server, teams) would force schema redesign.

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Rule-ID scheme + GAME_RULES.md outline other SPs cite | Writing the sim, renderer, bots, or the 20 levels |
| Complete v1 schemas: archetype, troop, balance, level, bot-profile envelope, visual manifest | Engine support for obstacles, map power-ups, shoots, tank (schema slots/registry hooks only) |
| Deterministic numeric representation | Full JSON Schema text (this doc shows shape only) |
| Validation (schema + semantic), versioning, hashing, overrides, change process | Bot decision parameters (SP04), asset choice (SP05) |

## Requirements
1. **GAME_RULES.md** (details under Architecture): stable IDs, params referenced by name, changelog, `RULES_VERSION`, "Planned v2" section phrased as future components.
2. **Content files**: one entity per JSON file; every file has `$schema` and `schemaVersion`.
3. **Components**: registry of v1 components (below); each lists params, v1-supported ranges, rule IDs. Registry entry exists iff the sim has an implementation (sim asserts parity at startup).
4. **Fixed-point numerics**: authored decimals ≤3 places; loader converts to integers; reject more precision, NaN, or values outside int32 after scaling.
5. **Validation** (`validateContent`, shared by tools, web dev panel, server): schema pass then semantic pass; all errors reported with file + JSON pointer; CI fails on any error.
6. **Versioning/hash**: `content.json` holds `contentVersion`, `rulesVersion`, `schemaVersion`; `hashes.lock.json` holds per-level `simHash`; CI fails if a hash changed without `contentVersion` bump.
7. **Overrides**: level-local param patches (restricted, below) resolved at compile time.
8. **Compiled output typed**: `compileLevel(content, levelId): CompiledLevel` is the only thing sim accepts.
9. **v3/v4 readiness**: players array unbounded, `team` field present, no global singletons in schema (server loads same files via Node `fs`; web via Vite glob; both call the same pure `loadContent(fileMap)`).

## Architecture

### GAME_RULES.md
Outline: 1 Conventions (units, tick, integer math, deterministic iteration order = sorted id) · 2 Entities (tower, troop, line, player/team) · 3 Rules by area · 4 **Tick phase order** (the determinism spine: apply commands → lines/slot enforcement → generation → departures → movement → clash → arrivals/combat → capture → win/lose check) · 5 Worked examples/edge cases · 6 Planned v2/v4 · 7 Changelog.
- **ID scheme**: `R-<AREA>-<NN>`; areas `GEN` generation, `SND` sending, `LIN` lines/slots/cut, `CAP` capacity, `CMB` combat/clash, `CPT` capture, `WIN` win/lose/time, `TCK` tick/determinism, `ENT` entity model. IDs never reused; removed rules stay as tombstones.
- **Rule entry** = heading `### R-GEN-01`, statement, *Params* line, *Examples*, *Since*. Statements cite parameters as `` `generates.ratePerSec` `` — never literals. Params are the only numbers allowed in rule text except in labelled examples (which state the data values they assume).
- `RULES_VERSION` semver: major = changes replay outcome of existing content; minor = additive rule/component; patch = clarification. Replays require exact major.minor match. Header in GAME_RULES.md is the source; `content.json` mirrors; CI checks equality.
- CI (SP04) parses rule IDs by regex; component registry lists its rule IDs; every ID must have a test tagged `covers R-…`.
- **Planned v2** section is written as component specs: `shoots{ratePerSec, radius, targeting: nearestHostile|randomHostile}` (+ archetype `archer` = `garrison`+`capturable`+`shoots`, no `generates`/`drawsLines`); troop param `value` 2 for `tank` (combat in value units); `mapObjects` kinds `gate{delta}`, `hazard{delta}`, `wall{hp}`; obstacle kinds. Each marked *not implemented; validator rejects*.

### packages/content layout
```
content.json            contentVersion, rulesVersion, schemaVersion
hashes.lock.json        levelId -> simHash (generated: pnpm content:lock)
schemas/*.schema.json   generated from TypeBox, committed (editor $schema autocomplete); CI checks fresh
src/                    typebox schemas, component registry, loadContent, validate, compile, hash, index.ts
data/
  balance.json          globals
  troops/regular.json
  archetypes/standard.json
  levels/01-first-steps.json … 20-*.json
  bots/<profile>.json
```
Visual manifest lives **web-side** (`apps/web/assets/manifest.json`, schema/types exported from content): server never needs it, and reskin = manifest edit. Content only holds visual **keys**. A tools check (`validate:content --manifest`) verifies every key referenced exists in the manifest.

### Component model (v1)
Archetype = `{id, extends?, visual, footprintRadius, components:{name:params}}`. `components` is a map (unique per archetype, easy to patch). `extends` is single-level inheritance with per-component param merge; no `extends` chains deeper than 1.
| Component | Params | v1 rules |
|---|---|---|
| `garrison` | `cap` | count, cap, 1-for-1 hits (CAP, CMB) |
| `generates` | `troop` (troop id), `ratePerSec` | generation only when owned and below cap (GEN) |
| `drawsLines` | `extraSlotAbove: [10,30]` | slots = 1 + #thresholds < count; newest auto-cut on drop (LIN); send rate = generation rate, so no separate send param in v1 (SND) |
| `capturable` | — | capture at 0, line cancel/re-eval (CPT) |
Per-instance values (owner, starting garrison) are in the level, not the archetype. Neutral = `owner: null`; absence of generation for neutrals is a rule (GEN), not data.
```json
{ "$schema":"../../schemas/archetype.schema.json", "id":"standard", "visual":"tower.standard",
  "footprintRadius":3, "components":{ "garrison":{"cap":50}, "generates":{"troop":"regular","ratePerSec":1.0},
  "drawsLines":{"extraSlotAbove":[10,30]}, "capturable":{} } }
```
Troop type: `{id, visual, value, speed}`; v1 registry range `value == 1` (widening it + combat-in-value-units is the v2 tank change: data + one combat behaviour).
**Extension rule**: new behaviour = one new schema entry + one sim implementation + rule IDs + tests, shipped together; a component absent from registry or with a param outside its declared v1 range is an error. Archer = new component `shoots` + data; no change to existing schemas.

### Level schema
```json
{ "$schema":"../../schemas/level.schema.json", "id":"03-crossroads", "name":"Crossroads", "order":3, "band":1,
  "timeLimitSec":300, "bounds":{"w":120,"h":80},
  "players":[{"id":"p1","kind":"human","colorKey":"player.1","team":"p1"},
             {"id":"b1","kind":"bot","botProfile":"rusher-easy","colorKey":"player.2","team":"b1"}],
  "towers":[{"id":"t1","archetype":"standard","pos":{"x":-40,"y":0},"owner":"p1","garrison":10},
            {"id":"t2","archetype":"standard","pos":{"x":0,"y":10},"owner":null,"garrison":15}],
  "obstacles":[], "mapObjects":[],
  "overrides":{} }
```
- Coordinates: 2D ground plane, origin at map centre, units = world units (renderer maps y→z), ≤3 decimals. Edge-case: `bounds` is advisory for camera and in-bounds check.
- `players` unbounded (>4 for v6); `team` optional (default = own id); v1 semantic rule: teams all distinct, exactly one `human`, 1–3 `bot`s. v4 relaxes the semantic rule only; schema unchanged. `botProfile` refs `data/bots/*.json` (envelope `{id, kind, params}`; inner `params` schema owned by SP04).
- `obstacles[]` (`{kind,…}`) and `mapObjects[]` (`{kind,…}`) are reserved: schema accepts the array, v1 semantic pass rejects non-empty/unknown kinds. Power-ups slot in as `mapObjects` kinds with their own pos/footprint, so overlap checks already cover them.
- `timeLimitSec` omitted → `balance.defaults.timeLimitSec`.
- **Overrides**: `overrides.{globals|troops.<id>|archetypes.<id>.components.<name>}.<param>` — param patches only; cannot add/remove components or entities (use a new archetype with `extends` instead). Resolved at compile; hashed as resolved. The balance runner lists every level using overrides.

### Balance / globals (`balance.json`)
`defaults.timeLimitSec`, `defaults.clashPolicy`-style knobs only if a rule names them; kept small. `tickRate=20` is an engine/rules constant (R-TCK), not content, and is recorded in replays.

### Numeric representation
- Data authored as decimals; schema field tagged with unit scale (`fx3` = ×1000). Loader: `n = round(x*1000)`, error if `|x*1000 − n| > 1e-9` or `|n| > 2^31−1`. Everything past the loader is `int32`.
- **Generation** uses an integer accumulator: `acc += ratePerSecMilli` each tick; 1 troop per `1000 × tickRate` units. Exact for any 3-decimal rate (1.5/s = 1500 → one troop per ~13.3 ticks, no drift).
- **Distance/speed**: positions in milli-units; line length by integer `isqrt` at compile; speed per tick via same accumulator approach (SP02 owns the exact scheme, must satisfy: no floats, no trig, identical across Node versions). 
- Integer conventions (rounding = floor toward zero, division order) are fixed in R-TCK so server/client agree.

### Validation
- **Schema pass** (Ajv strict, `additionalProperties:false` everywhere): shapes, ranges, id regex `^[a-z0-9][a-z0-9-]*$`, unknown component/kind rejected.
- **Semantic pass**: unique ids; all refs resolve (archetype, troop, botProfile, owner, team, visual keys when manifest given); component params in registry v1 range; `extraSlotAbove` strictly ascending; `0 ≤ garrison ≤ cap` (warn if highest threshold ≥ cap); towers in bounds; footprints non-overlapping (+margin) incl. future mapObjects; every player owns ≥1 tower; ≥2 owners; rates/speeds > 0; `order` unique and contiguous 1–20 across campaign; obstacles/mapObjects empty; `extends` depth ≤1, no cycles; overrides reference existing params. Reachability is trivially true in v1 (straight lines, no obstacles); hook reserved for line-of-sight once obstacles exist. Playability (reference bot wins, idle loses) is SP04.
- API: `validateContent(fileMap) → {errors[], warnings[]}`; `loadContent` throws on errors.

### Hashing & versioning
- `simHash` = SHA-256 over canonical JSON (sorted keys, numbers already fixed-point) of the **resolved, sim-relevant** content for a level: level (minus `name`, `visual`, `colorKey`), referenced archetypes/troops/globals after overrides/extends. Presentation-only fields (schema-tagged `x-presentation`) are excluded, so reskins don't invalidate replays.
- Replay/handshake header: `{rulesVersion, schemaVersion, contentVersion, levelId, simHash, seed}`. Mismatch → refuse (server) / warn+refuse (replay runner).
- Dev-panel live edits mutate in memory → recompile → `simHash` differs → UI marks session "tuned" and saves no records.

### Change process (in CONTENT_GUIDE.md)
| Change | Edit | Bumps | Tests |
|---|---|---|---|
| Number (rate, cap, speed, pos, garrison) | data file | `contentVersion`; `pnpm content:lock` | validate + balance runner |
| New archetype/troop/level from existing components | data file(s) | `contentVersion` | validate |
| Rule semantics change | GAME_RULES.md (text + changelog) → tests → code | `rulesVersion` (major/minor), `contentVersion` if hashes move | rule-ID tests, golden replays regenerated deliberately |
| New component/kind | schema + registry + rule IDs + sim impl + tests together | `rulesVersion` minor, `schemaVersion` if shape changes | all |
Code must never do anything the rules don't state; param meaning lives in rules, value in data.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| 1 | Schema tech | TypeBox + Ajv; committed generated `.schema.json` | zod (4 has JSON Schema export), hand JSON Schema + codegen | Schema *is* JSON Schema, TS types free, editor autocomplete, discriminated unions for components; zod transforms not needed (compile step is separate) |
| 2 | Numerics | Decimals ≤3 places in files → int32 fixed-point at load; integer accumulators | floats in sim; authoring only integers (milli) | Cross-platform determinism for v3; authoring stays readable |
| 3 | Component container | Map `name→params` | Array of `{type,…}` | Unique-by-construction, trivial `extends`/override patching |
| 4 | Variants | `extends` depth 1 | Deep inheritance; per-instance overrides | Per-tower differences become named archetypes; stays simple |
| 5 | Level overrides | Allowed, param patches only, resolved + hashed | None; arbitrary deep merge | Flexibility for tuning one level without forking archetype, bounded blast radius |
| 6 | Visual manifest location | Web-side, content holds keys only | In content | Server stays asset-free; reskin = data edit; cross-check by tool |
| 7 | Unknown things | Hard error in schema+semantic | Warn/ignore | Engine never silently ignores |
| 8 | Reserved slots | `obstacles[]`, `mapObjects[]` in schema; v1 semantic rejects non-empty | Add later with schema bump | v2 additive, no migration |
| 9 | v1-supported ranges in registry | e.g. troop `value==1` | Schema allows anything | Data can't express what engine can't do; widening = deliberate v2 change |
| 10 | Rule/data split | Rules cite param names; data holds values | Literals in rules | No drift on tuning |
| 11 | Hash scope | Sim-relevant resolved content only + lockfile | Hash whole files | Reskins don't break replays; CI catches silent balance drift |
| 12 | tickRate | Engine constant in rules | In balance.json | Changing it rewrites semantics, not balance |

## Risks / Open Questions
- [OPEN] TypeBox vs zod: spike on first schema file; switch cost is low before SP02 starts. Default TypeBox.
- [OPEN] Fixed-point scale 1000 sufficient for speed/progress along long lines at 20 Hz (rounding bias)? SP02 spike; may need a finer internal scale while keeping authored 3 decimals.
- [OPEN] Do campaign levels actually use `overrides`, or ban them once the 20 levels exist? Revisit after SP05 greybox.
- [OPEN] Map unit scale (bounds ~120×80, tower radius ~3) — tune in greybox; cheap data edit.
- [OPEN] Bot params as floats: affect only commands, not sim state, but balance-runner reproducibility wants same fixed-point rule. SP04 to decide.
- [OPEN] Per-tower send-rate param may be wanted in v2 (archer-like variants); v1 omits since send = generation.
- [RESOLVED: schema accepts team field now; v4 only relaxes a semantic rule] team-readiness.
- [RESOLVED: reserved arrays + registry mechanism] v2 expressible without schema redesign.
- [DEFERRED] Team semantics (v4), power-up/obstacle rules (v2), localisation of names, content-pack/mod loading.

## Acceptance Criteria
1. GAME_RULES.md exists with outline above, ≥ all brief section-5 rules as `R-…` IDs, tick phase order, changelog, `RULES_VERSION`; no literal tunable numbers in rule text.
2. `packages/content` ships TypeBox schemas, generated JSON Schemas, component registry (4 components), `loadContent`, `validateContent`, `compileLevel`, `simHash`, `hashes.lock.json`, `balance.json`, `regular` troop, `standard` archetype, and one sample level.
3. Editing `generates.ratePerSec`, troop `speed`, or a tower `pos` requires no code change and changes `simHash`; editing a `visual` key or `name` does not.
4. Fixtures prove rejection of: unknown component, unknown field, 4-decimal number, dangling ref, overlapping towers, non-empty `obstacles`/`mapObjects`, troop `value: 2`, override of a missing param.
5. A fixture archetype `archer` (`garrison`,`capturable`,`shoots`) and troop `tank` are rejected only because the registry lacks `shoots` / range excludes `value 2` — adding those registry entries makes them pass with no schema redesign.
6. Same files load identically via Node `fs` and Vite glob (same `simHash`).
7. CONTENT_GUIDE.md documents the change-process table.
