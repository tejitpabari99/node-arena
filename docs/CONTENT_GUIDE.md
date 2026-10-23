# Content authoring and change process

[GAME_RULES.md](GAME_RULES.md) owns mechanics and stable `R-AREA-NN` rule IDs. JSON under `packages/content/data/` owns values, composition and level layouts. A new tower, level or unit that reuses existing behaviour is a data edit, not engine code. New behaviour is a module: rule text first, then a def, a sim binding and tests.

See [LEVELS_GUIDE.md](LEVELS_GUIDE.md) for import/coordinates/coverage and the [tools gate list](../tools/README.md#gates) for verification semantics.

Run all commands from the repository root. Shipped examples: tower `packages/content/data/buildings/tower.json`, house `packages/content/data/buildings/house-wt1.json`, unit `packages/content/data/units/soldier.json`, element `packages/content/data/elements/obstacle.json`, level `packages/content/data/levels/levelview-1.json`, campaign `packages/content/data/campaigns/common.json`, shared numbers `packages/content/data/balance.json`.

## Where things live

| Layer | Path | Role |
|---|---|---|
| defs (pure) | `packages/defs/src/index.ts`, `packages/defs/src/modules/`, `packages/defs/src/bot-kinds.ts`, `packages/defs/src/commands.ts`, `packages/defs/src/objectives.ts` | Registries: modules, bot kinds, commands, objectives, events, phases. One explicit list per registry. |
| content | `packages/content/src/`, `packages/content/schemas/`, `packages/content/data/` | TypeBox schemas built from defs, loader/validator/compiler, hashing; generated JSON schemas; authored data. |
| sim | `packages/sim/src/modules/index.ts` | `IMPLS` binds one implementation per defs module id. |
| gates | `packages/content/hashes.lock.json`, `packages/content/content.json`, `packages/bots/src/version.ts` | Level `simHash` and bot hashes, `contentVersion`/`rulesVersion`, `BOT_VERSION`. |

Dependency direction: defs <- content <- sim <- bots. A level declares `requires` (derived, see below); it is playable iff `requires` is a subset of the build's capabilities (`CAPABILITIES` in `packages/defs/src/index.ts`).

## Extension flows

| Change | Authored files | Then run |
|---|---|---|
| New tower/house of an existing kind (numbers, modules) | 1 file: a building JSON in `packages/content/data/buildings/` | lock + version bump only once a level uses it |
| New level | 2 files: level JSON in `packages/content/data/levels/` and an entry in `packages/content/data/campaigns/common.json` | `pnpm content:lock`, bump versions |
| New unit with existing behaviour | 1 file: a unit JSON in `packages/content/data/units/`, referenced from a building's `spawns.troop` | `pnpm content:lock` |
| New module (wall, mine, rocket tower) | rule text, def file, sim binding, building/element JSON, tests | `pnpm content:schemas`, `pnpm content:lock` |
| New bot kind or command | def entry plus implementation | schema regen / type errors guide the rest |

### Add a tower kind (1 file)

Walkthrough, verified in a scratch copy. Copy `packages/content/data/buildings/tower.json` to a new file `<new-building-file>.json` in the same folder, set `"id": "tower-x"` (must equal the file name), change numbers (for example `shoots.attackDelay`). Nothing else is needed:

- No schema regeneration: `packages/content/schemas/building.schema.json` is built from the module registry, not from building ids. Run `pnpm check:schemas` to confirm.
- While no level references `tower-x`, `pnpm check:content --base HEAD` and `pnpm validate:content --base HEAD` stay green: unused entities are excluded from `simHash`, so no lock change and no version bump.
- Reference it from a level (`"archetype": "tower-x"` in a `buildings` entry). Now `simHash` moves: run `pnpm content:lock` and bump `contentVersion` (below). A new `visual` key also needs an entry in `apps/web/assets/manifest.json`; reusing `building.tower` needs none.

The building `kind` is currently `house` or `tower`. A new kind value is a schema change in `packages/content/src/schemas.ts`, not a data edit. Behaviour comes only from the `modules` bag; params are strict (unknown keys fail) and fx3 numbers are authored in ordinary units.

### Add a level (2 files)

1. Create the level JSON in `packages/content/data/levels/`; `id` must equal the file name. Easiest start: copy `packages/content/data/levels/levelview-1.json`. Key order: `$schema, schemaVersion, id, name, source, theme, bounds, objective, timeLimitSec, players, buildings, elements, requires`.
2. Add `{ "level": "<id>", "position": N }` to `entries` in `packages/content/data/campaigns/common.json`. A level absent from the campaign still validates; the entry is what makes it part of the campaign. An entry naming an unknown level is an error.
3. `requires` is derived, not chosen: it must equal the sorted set of modules used by its archetypes/elements, `bot:<kind>` for each seat kind and `objective:<id>`. A wrong list fails with the exact expected set in the message, so paste it. Example for `levelview-1`: `bot:tw, drawsLines, grows, level, objective:captureAll, shoots, spawns`.
4. Level rules enforced by the validator: exactly one human, first in `players[]`, and 1..`aiMax` AI seats (see `packages/defs/src/objectives.ts`); every AI seat has a `bot` block of a registered kind whose building references exist; building ids unique; positions inside `bounds` and not coincident; `level <= maxLevel`; at least one building without `ignoreForWin`; `theme` and player `colorKey` must exist in the manifest when one is supplied.
5. Run `pnpm content:lock` (adds a `levels` entry and one `bots` entry per AI seat in `packages/content/hashes.lock.json`) and bump versions (below).

Verified: adding a second level from a copy of `levelview-1` changes the lock for both `levels` and `bots`, so it needs a `contentVersion` bump **and** a `BOT_VERSION` bump.

### Add a unit

Create a JSON in `packages/content/data/units/` (see `packages/content/data/units/soldier.json`: `speed`, `hp`, `attack`, `defense`, `visual`). Point a building's `spawns.troop` at its id; an unknown unit id there fails validation. A unit that nothing spawns does not move any hash. Unit-level modules are not supported: unit behaviour is flat data (shield/ranged module extensions are deferred in [FUTURES.md](FUTURES.md)).

### Add a module (new behaviour)

Order matters; the compiler and `tsc` catch a missed step.

1. Rules first, per [GAME_RULES.md](GAME_RULES.md): rule text with new `R-AREA-NN` ids, changelog entry, bump `RULES_VERSION` (see Versions).
2. Def: create `packages/defs/src/modules/<id>.def.ts` with `defineModule({ id, appliesTo: 'building' | 'element', params, ruleIds, phases })` (model on `packages/defs/src/modules/spawns.def.ts`). Use `fx3()`, `count()` and `unitId()` from `packages/defs/src/params.ts`; keep `additionalProperties: false`.
3. Register: import it and add one line to `MODULES` in `packages/defs/src/index.ts`. `ModuleId`, schema bags, `CAPABILITIES` and level `requires` follow automatically.
4. Sim binding: create `packages/sim/src/modules/<id>.ts` exporting a `SimModule` (`state` columns, `phases`, `hooks`; see `packages/sim/src/types.ts`) and add it to `IMPLS` in `packages/sim/src/modules/index.ts`. `IMPLS` is `satisfies Record<ModuleId, SimModule>`: a missing or extra key is a compile error (`pnpm typecheck:sim`). Some existing bindings are stubs owned by later sub-projects (for example `packages/sim/src/modules/blocksLines.ts`).
5. Data: add the module bag to a building or element JSON.
6. Tests with titles containing `covers R-...` for every new rule id (`pnpm check:rules`).
7. `pnpm content:schemas` (commit the regenerated files in `packages/content/schemas/`), then lock + bumps. Levels using the module now list it in `requires`.

### Add a bot kind or command

- Bot kind: add an entry to `BOT_KINDS` in `packages/defs/src/bot-kinds.ts` (`id`, `params` TypeBox schema with a `kind` literal, `buildingRefs(bot)` returning referenced building ids). The level schema's seat union and `requires` (`bot:<kind>`) derive from it. Implement the behaviour in `packages/bots/src/`, bump `BOT_VERSION` in `packages/bots/src/version.ts`, then `pnpm content:schemas` and `pnpm content:lock`.
- Command: add an entry to `COMMANDS` in `packages/defs/src/commands.ts` (`payload` schema, `rejectReasons`, `ruleIds`). `CommandId`, `Command` and `RejectReason` types follow; handle it in the sim and add rule text first.

The authoritative gate parking list is in `scripts/ci.sh`; `pnpm check:parked --strict` verifies that no parked gates or tooling remain.

## Versions and hashes

- `contentVersion` (`packages/content/content.json`): semver; must increase numerically relative to the baseline whenever any level `simHash` in the lock changes, including additions and removals. The gate does not prescribe the segment.
- `simHash` covers canonical resolved simulation inputs (including overrides and inherited params). Names, presentation keys, bots, unused entities and schema metadata are excluded.
- `BOT_VERSION` (`packages/bots/src/version.ts`): must strictly increase when the resolved bot hash map changes, **including adding or removing an AI seat via a new level**, even after regenerating the lock.
- `RULES_VERSION`: major = replay outcomes of existing content change; minor = additive; patch = clarification. The `GAME_RULES.md` header, the export in `packages/content/src/versioning.ts` and `rulesVersion` in `packages/content/content.json` must agree. Never reuse a rule ID; keep removed ones as tombstones.
- `schemaVersion` (each file, exported `SCHEMA_VERSION`): bump when the file-format shape changes, not for balance tuning.
- `pnpm content:lock` writes `packages/content/hashes.lock.json`; it never bumps versions. Commit data, versions, lock and regenerated schemas together.

### Baseline (`VERSION_GUARD_BASE`)

`check:content` and `validate:content` compare against a git baseline, never against the freshly regenerated lock. `scripts/ci.sh` picks the base in this order: `VERSION_GUARD_BASE`, then `CONTENT_BASE` (CI-supplied), then `git merge-base HEAD main` (or origin/main), then `HEAD^`. On a feature branch that means the whole branch is compared with where it left `main`, so one bump per branch covers all commits on it. With `CI_RELEASE=1` (merge to main) `VERSION_GUARD_BASE` is unset and the normal `HEAD`/`HEAD^` guard applies. Outside CI, `--base` defaults to `VERSION_GUARD_BASE`, else `HEAD` (good for uncommitted edits; after committing it compares the change with itself). An explicit base that is not a commit is an error.

## Common changes

| Change | Edit | Version and generated files |
|---|---|---|
| Tune a rate, speed, capacity or position | The relevant building/unit/level JSON or `packages/content/data/balance.json` | Bump `contentVersion`; `pnpm content:lock` |
| Change rule semantics | `docs/GAME_RULES.md` text and changelog, then tests (`covers R-...`), then code | Bump `RULES_VERSION` in the header, `packages/content/src/versioning.ts` and `packages/content/content.json`; bump `contentVersion` if hashes move; lock |
| Change schema shape | TypeBox sources in `packages/content/src/` or defs | `SCHEMA_VERSION` and each file's `schemaVersion`; `pnpm content:schemas`; lock |
| Rename a level or reskin | `name`, `visual`, `theme`, color keys; `apps/web/assets/manifest.json` for assets | Presentation is outside `simHash`; lock hashes stay identical |
| Tune bot behaviour | Level `bot` blocks, or algorithms in `packages/bots/src/` | Bump `BOT_VERSION`; lock |

## Authoring contracts

One entity per JSON file; `$schema` points at the generated editor schema and `schemaVersion` matches the exported version. IDs are lowercase letters, digits and hyphens, and equal the file name. Unknown fields, modules, params and unresolved references fail validation.

Author `fx3` fields in ordinary units with at most three decimals. The loader scales fields tagged `x-unit: fx3` by `FIXED_POINT_SCALE = 1000` (`speed: 5` loads as 5000). Counts (`level`, `maxLevel`, `hp`) stay integers; `timeLimitSec` is integer seconds or `null`. Non-finite values, excess precision and scaled magnitudes beyond `2147483647` are errors. Do not author milli-values or scale loaded data twice.

Coordinates: levels use world units with `x` and `z`; `bounds` must contain every building. Footprints are `box` (`w`, `d`) or `circle` (`radius`). See [LEVELS_GUIDE.md](LEVELS_GUIDE.md) for the coordinate frame, rotation and imported footprint policy.

Elements (such as `obstacle`) carry module bags and optional `variants` (`small`, `big`); a level element may name one variant.

## Load, validate and compile

The browser-safe package API takes a path-keyed file map of JSON strings or objects. `validateContent` returns located errors and warnings (supplying the hosted manifest also checks visual, theme and color keys); `loadContent` validates and converts tagged units, throwing with file/JSON-pointer diagnostics. `compileLevel(...)` produces the `CompiledLevel` simulation boundary (players and buildings sorted by id, owners as indices, `-1` neutral). Loading, validation, compilation and hashing use no Node APIs; Node-only scripts do disk and git access. Generated schemas come from the TypeBox sources: edit those and regenerate, never hand-edit `packages/content/schemas/`.

## Regenerate and verify

```sh
pnpm content:schemas          # after schema, module or bot-kind changes
pnpm content:lock             # after data edits and required bumps
pnpm check:schemas
pnpm check:content --base HEAD
pnpm validate:content --base HEAD
pnpm test
pnpm run ci                   # full gate chain
```

For a committed change compare with a revision preceding it: `pnpm check:content --base <revision>`. The check rejects stale locks, missing version bumps and rules-version disagreement.
