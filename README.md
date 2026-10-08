# Node Arena

Ad-free browser strategy game (persistent-route tower war) with solo campaign and private multiplayer with friends. Design in progress.

## Contents
- `research/engine-research.md` — engine/stack comparison
- `research/similar-games.md` — survey of existing similar games
- `docs/agent_files/` — design docs (brainstorm, PRDs, tasks)

- `packages/content/` — browser-safe content schemas and validation (TypeBox + Ajv); generated editor schemas and authored troop data.

## Development

Requires Node >=22.13 and pnpm 10.34.6 (`packageManager` pins the version).

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm lint
pnpm content:schemas  # regenerate committed JSON Schema after schema changes
pnpm check:schemas   # fail if generated schemas are stale
```

The content package exports TypeBox schemas and inferred types for content versions, balance defaults, troops, archetypes, and levels, plus `SCHEMA_VERSION`, `CoreSchemas`, `createAjv`, `validateTroop`, `FIXED_POINT_SCALE`, `convertFixedPoint`, and `loadContent`. `loadContent(fileMap)` accepts JSON strings or objects keyed by source path and returns cloned core entities under the same paths. Only fields tagged `x-unit: fx3` become milli-unit integers; counts and durations remain in authored units. `ContentLoadError.errors` contains source files, JSON pointers, and messages. Component maps accept flat param bags for registry extensibility; the registry and shared semantic validator reject unknown components, unresolved references, invalid inheritance, reserved non-empty arrays, and unsupported parameter patches. Untagged numeric extension params must be integers. Node file access belongs in external adapters or package scripts; all content source files reject imports of fs, path, and crypto.

Hosted contracts include `BotSchema`/`BotProfile`, `ManifestSchema`/`Manifest`, and plain `BotJsonSchema`/`ManifestJsonSchema` exports. `CoreSchemas` includes bot profiles for file-map loading; `HostedSchemas` adds the web-only manifest for editor generation and freshness checking. Every profile requires `kind`; tiers put `extends` inside `params` and may supply only a `skill` block. Reference resolution, kind consistency and inheritance depth are enforced by semantic validation. `bot-params.ts` is a closed SP04 placeholder: skill plus bounded attack bias and targetValue weight; SP04 owns the full consideration payload and bot data. Bot decimals tagged fx3 load into milli-units (weights/biases at most 10 authored = 10,000 milli). Manifest values stay in presentation units: hex palette/theme colours, xyz vectors for lights/props, string fx/sfx keys. SP03 owns the manifest file and asset interpretation/validation.

`validateContent(fileMap, { manifest }?)` reports all schema, precision and semantic errors plus located warnings without mutating its input. The optional manifest must satisfy the complete hosted schema; content visuals, themes (including the balance fallback) and color keys in every palette are cross-checked. `loadContent` applies the same validation and throws `ContentLoadError` on any error, even when an entire referenced category is missing. For isolated editor/schema fixtures only, `{ partial: true }` explicitly limits loading to schema, numeric and component-registry checks. `parseContent` exposes the schema/numeric stage; `resolveProfiles` and `resolveLevelOverrides` expose cloned loaded-unit resolution for the compiler. Campaign order checks apply to `data/levels/NN-*.json` files: present orders start at 1 and remain contiguous, capped at 20; sample files can exist before the full campaign. Footprints use authored radii and allow touching; a separate clearance margin requires a future rules/data parameter.

`compileLevel(loadContent(fileMap), levelId)` exports the `CompiledLevel` boundary shared by sim, web and bots. Towers and players use lexical id order; owners are player indices (`-1` for neutral), teams default to their player ids, and `generates.troop` is a dense index into the sorted, referenced-only `kinds` array. Coordinates, footprints, generation rates, troop speeds and bot fx3 params remain loaded milli-unit integers without a second conversion. Level patches resolve on independent clones; time limits and theme keys fall back to balance defaults. Tower visuals/footprints, map bounds, globals and fully inherited bot profiles pass through for downstream consumers. `simHash` and the per-profile `botHash` map are explicitly `null` until the following hashing task provides real identities.
