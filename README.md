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

The content package exports `TroopSchema`, its inferred `Troop` type, `SCHEMA_VERSION`, `createAjv`, `validateTroop`, `FIXED_POINT_SCALE`, `convertFixedPoint`, and `loadContent`. `loadContent(fileMap)` accepts JSON strings or objects keyed by source path and returns new objects under the same paths; its current schema dispatch supports troops. Only fields tagged `x-unit: fx3` become milli-unit integers; troop counts remain integers in authored units. `ContentLoadError.errors` contains source files, JSON pointers, and messages. Other entity schemas and semantic checks are added in the following content tasks. Node file access belongs in external adapters or package scripts; all content source files reject imports of fs, path, and crypto.
