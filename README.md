# Node Arena

Ad-free browser strategy game (persistent-route tower war) with solo campaign and private multiplayer with friends. Design in progress.

## Contents
- `research/engine-research.md` — engine/stack comparison
- `research/similar-games.md` — survey of existing similar games
- `docs/agent_files/` — design docs (brainstorm, PRDs, tasks)

- `packages/content/` — browser-safe content schemas and validation (TypeBox + Ajv); generated editor schemas, v1 data, sample level and content hash lock.
- `packages/sim/` — deterministic integer-rule engine, component registry, zero-copy views, state hashes, replay helpers, golden parity tests, and performance benchmark.

## Development

Requires Node >=22.13 and pnpm 10.34.6 (`packageManager` pins the version).

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm lint
pnpm content:schemas  # regenerate committed JSON Schema after schema changes
pnpm check:schemas   # fail if generated schemas are stale
pnpm content:lock    # regenerate per-level/per-profile identities
pnpm check:content --base HEAD  # compare to committed manifest and lock
pnpm sim:golden      # verify committed simulation replays
pnpm bench:sim       # enforce strict simulation performance budgets
```

The content package exports TypeBox schemas and inferred types for content versions, balance defaults, troops, archetypes, and levels, plus `SCHEMA_VERSION`, `CoreSchemas`, `createAjv`, `validateTroop`, `FIXED_POINT_SCALE`, `convertFixedPoint`, and `loadContent`. `loadContent(fileMap)` accepts JSON strings or objects keyed by source path and returns cloned core entities under the same paths. Only fields tagged `x-unit: fx3` become milli-unit integers; counts and durations remain in authored units. `ContentLoadError.errors` contains source files, JSON pointers, and messages. Component maps accept flat param bags for registry extensibility; the registry and shared semantic validator reject unknown components, unresolved references, invalid inheritance, reserved non-empty arrays, and unsupported parameter patches. Untagged numeric extension params must be integers. Node file access belongs in external adapters or package scripts; all content source files reject imports of fs, path, and crypto.

Hosted contracts include `BotSchema`/`BotProfile`, `ManifestSchema`/`Manifest`, and plain `BotJsonSchema`/`ManifestJsonSchema` exports. `CoreSchemas` includes bot profiles for file-map loading; `HostedSchemas` adds the web-only manifest for editor generation and freshness checking. Every profile requires `kind`; tiers put `extends` inside `params` and may supply only a `skill` block. Reference resolution, kind consistency and inheritance depth are enforced by semantic validation. `bot-params.ts` is a closed SP04 placeholder: skill plus bounded attack bias and targetValue weight; SP04 owns the full consideration payload and bot data. Bot decimals tagged fx3 load into milli-units (weights/biases at most 10 authored = 10,000 milli). Manifest values stay in presentation units: hex palette/theme colours, xyz vectors for lights/props, string fx/sfx keys. SP03 owns the manifest file and asset interpretation/validation.

`validateContent(fileMap, { manifest }?)` reports all schema, precision and semantic errors plus located warnings without mutating its input. The optional manifest must satisfy the complete hosted schema; content visuals, themes (including the balance fallback) and color keys in every palette are cross-checked. `loadContent` applies the same validation and throws `ContentLoadError` on any error, even when an entire referenced category is missing. For isolated editor/schema fixtures only, `{ partial: true }` explicitly limits loading to schema, numeric and component-registry checks. `parseContent` exposes the schema/numeric stage; `resolveProfiles` and `resolveLevelOverrides` expose cloned loaded-unit resolution for the compiler. Campaign order checks apply to `data/levels/NN-*.json` files: present orders start at 1 and remain contiguous, capped at 20; sample files can exist before the full campaign. Footprints use authored radii and allow touching; a separate clearance margin requires a future rules/data parameter.

`compileLevel(loadContent(fileMap), levelId)` exports the `CompiledLevel` boundary shared by sim, web and bots. Towers and players use lexical id order; owners are player indices (`-1` for neutral), teams default to their player ids, and `generates.troop` is a dense index into the sorted, referenced-only `kinds` array. Coordinates, footprints, generation rates, troop speeds and bot fx3 params remain loaded milli-unit integers without a second conversion. Level patches resolve on independent clones; time limits and theme keys fall back to balance defaults. Tower visuals/footprints, map bounds, globals and fully inherited bot profiles pass through for downstream consumers. `simHash` is SHA-256 of canonical resolved sim inputs and the per-profile `botHash` map identifies resolved bot profiles separately. Presentation keys, names, bots, unused entities and schema metadata are excluded from sim identity. The package exports `RULES_VERSION`, `ReplayHeader`, pure `sha256`/`canonicalJson`, and `generateHashes`. `check:content` verifies fresh locks, the rules header/export/metadata equality, and an increasing `contentVersion` when level hashes differ from the baseline manifest and lock, even after regenerating the lock. Pass `--base <git-revision>` for branch checks; CI supplies its PR/push baseline with full history. Bot hash version enforcement is deferred to SP04's `BOT_VERSION`.

The v1 dataset starts at content/rules/schema version `1.0.0`: `data/balance.json` supplies the default time limit and theme, `data/troops/regular.json` supplies the troop, and `data/archetypes/{standard,small,large}.json` supplies the base and variants. Variant values are placeholders for SP05 tuning. `data/levels/sample.json` demonstrates one human, one bot and a neutral tower with empty overrides; its filename keeps it outside the reserved campaign `01`–`20` order checks. `data/examples/sample-bot.json` is a minimal idle supporting profile so the sample validates and compiles; SP04 owns production profiles under `data/bots/`, and SP05 owns campaign levels. SP03 owns the asset manifest.

Run `pnpm content:lock` and `pnpm check:content --base 656d0ca` to regenerate and check the complete dataset and non-empty lock. The first dataset can start against a revision before content metadata exists; removing an existing dataset cannot use this exception.

The sim package exposes `create`, `TICK_RATE`, simulation/command/event/view/snapshot types, math/PRNG utilities, component registry helpers, and `createReplayRecorder`/`playReplay`. A simulation provides `step`, `canDraw`, `view`, `readTroops`, `snapshot`, and `hash`. Rule computations use integers; Float64 statistics carry exact safe integers and remain excluded from rule-state hashes.
