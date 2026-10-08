# Content authoring and change process

[GAME_RULES.md](GAME_RULES.md) owns mechanics and stable `R-AREA-NN` rule IDs. JSON in `packages/content/` owns values, composition and level layouts. Rules cite parameter names; changing a supported rate, capacity, speed or tower position needs a data edit, not engine code. The simulation must implement only documented rules.

## What to change

Paths below are relative to `packages/content/`, except `docs/` and `apps/` paths. Run commands from the repository root.

| Change | Edit | Version and generated files | Verification |
|---|---|---|---|
| Tune a rate, capacity, troop speed, position or starting garrison | Relevant `data/archetypes/`, `data/troops/` or `data/levels/` JSON; shared defaults in `data/balance.json` | Increase `content.json` → `contentVersion` when level simulation hashes change; run `pnpm content:lock` | Content validation/hash check and content tests; balance runner when SP04 supplies it |
| Add an archetype, troop or level using supported behaviour | Entity JSON and references; an archetype variant can use `extends` | Increase `contentVersion`; regenerate the lock | Validation, inheritance/reference/compiler tests; inspect the resulting level |
| Change rule semantics | `docs/GAME_RULES.md` text and changelog, rule tests, then simulation code | Update the rules header, exported `RULES_VERSION` in `src/versioning.ts` and `content.json.rulesVersion` together; increase `contentVersion` if level hashes move; regenerate the lock | Rule-ID tests and deliberately updated golden replays when their tooling exists, plus all available checks |
| Add a component, troop kind with new behaviour, or widen a supported range | Schema contract, `src/component-registry.ts`, permanent rule IDs, simulation implementation and tests **together** | Additive rules normally increase rules minor; existing replay outcome changes require rules major. Change `schemaVersion` if the shape changes; increase `contentVersion` for changed level hashes; regenerate schemas and lock | All checks, including registry/simulation parity and rule coverage once SP02/SP04 implement them |
| Change schema shape | TypeBox sources in `src/`, loaders/validators/compiler and affected data | Update exported `SCHEMA_VERSION` and each file's `schemaVersion`; regenerate committed `schemas/*.schema.json` with `pnpm content:schemas`; regenerate the lock | `pnpm check:schemas`, schema/loader/validator/compiler tests, build and lint |
| Rename a level or reskin content | `name`, visual/theme/color keys; SP03's `apps/web/assets/manifest.json` for assets | Presentation alone does not require a simulation content bump; lock hashes should stay identical | Validate with the manifest supplied, then inspect presentation; check hashes |
| Tune bot behaviour or difficulty | SP04-owned `src/bot-params.ts` and production `data/bots/` profiles | Regenerate separate `botHash` entries. SP04's `BOT_VERSION` bump/gate is deferred; SP01 does not enforce it | Hosted bot schemas, profile resolution and hash tests; bot/balance tests when SP04 supplies them |

`contentVersion` is semver and must increase numerically relative to the baseline whenever the level hash map changes, including additions or removals. The gate does not prescribe which semver segment to use; select one appropriate to the release. `schemaVersion` identifies the file-format contract, not balance tuning.

`RULES_VERSION` means: **major** changes the replay outcome of existing content; **minor** adds a rule/component; **patch** clarifies text without changing behaviour. Replay compatibility requires an exact major.minor match. Never reuse a rule ID; retain removed rules as tombstones. The rules header is authoritative, and the current checker requires exact agreement between header, TypeScript export and content metadata. Include a changelog entry for each rules change.

## Authoring contracts

Use one entity per JSON file, with `$schema` pointing to its generated editor schema and `schemaVersion` matching the exported version. IDs use lowercase letters, digits and hyphens. Unknown fields, components, parameters and unresolved references fail validation rather than being ignored.

Author `fx3` fields in ordinary units with at most three decimal places. The loader scales only fields tagged `x-unit: fx3` by `FIXED_POINT_SCALE = 1000`: `speed: 3.001` becomes `speedMilli: 3001`, and `ratePerSec: 0.6` becomes loaded `ratePerSec: 600`. Positions, bounds, footprint radii and tagged bot parameters also become milli-units. Non-finite values, excess precision and scaled magnitudes beyond `2147483647` are errors. Coordinates are bounded by absolute `500` world units; troop speed must be positive and at most `100` world units/second.

Counts remain unscaled integers: `garrison`, `garrison.cap`, troop `value`, `extraSlotAbove` thresholds and `actionsPerDecision`. `timeLimitSec` remains integer seconds; IDs and compiled indices do not scale. Bot `decisionIntervalSec` is tagged fx3, so it becomes milli-seconds; weights, bias and noise use their tagged scale too. Untagged numeric extension parameters must be integers; add an explicit schema tag before introducing a decimal parameter. Do not author milli-values or scale loaded data a second time.

V1 supports `garrison`, `generates`, `drawsLines` and `capturable`, and troop `value: 1`. Slot thresholds must be strictly ascending. Starting garrison must fit resolved capacity. `obstacles` and `mapObjects` must be empty arrays. Tower footprints use their resolved authored radii: overlap fails, touching is allowed, and there is no configurable clearance margin. Each player needs a starting tower; levels need at least two owners. Shared teams are reserved for a later playable mode.

An archetype may extend a base archetype at **one depth only**. Component parameter bags merge onto the base; arrays such as `extraSlotAbove` replace the entire array. Variants may change existing component parameters, `visual` and `footprintRadius`, but cannot add or remove components. Do not create chains or cycles. The supplied `small` and `large` values are placeholders; SP05 owns their tuning.

Bot inheritance is different: every profile needs `kind`, and the parent reference is `params.extends`, never a top-level `extends`. A utility tier may patch only `params.skill`, with inherited personality parameters preserved; it cannot patch bias or weights, change kind or extend more than one depth. Idle profiles use empty `params`. The hosted utility payload is currently a closed placeholder (skill, attack bias and targetValue weight); SP04 owns full bot behaviour and production profiles. Levels cannot select tooling profiles `reference` or `human-proxy`.

Campaign files belong in `data/levels/NN-*.json`; present orders start at 1, remain unique/contiguous and are capped at 20. Campaign authoring uses **no level overrides**: keep the required `overrides` object empty (`{}`), and introduce a named archetype variant instead. The override mechanism remains for dev-panel tuning and future custom games: it patches existing globals, troop parameters or archetype component parameters on isolated clones, never missing targets or new components. Resolved patches affect the level hash.

The current pack contains `data/balance.json`, `data/troops/regular.json`, the three archetypes and `data/levels/sample.json`. The sample demonstrates a human, a bot and a neutral tower; its filename excludes it from campaign ordering. Its supporting idle profile is `data/examples/sample-bot.json`, outside SP04's production `data/bots/`. This sample proves content can validate and compile; it does not establish campaign AI or playability.

## Load, validate and compile

The browser-safe package API accepts a path-keyed `ContentFileMap` of JSON strings or objects. `validateContent(fileMap, { manifest }?)` returns located errors and warnings; supplying the complete hosted manifest also checks visual, theme and palette color keys. `loadContent(fileMap)` clones, validates and converts tagged units, and throws `ContentLoadError` with file/JSON-pointer diagnostics on errors. Full validation requires the referenced dataset. `{ partial: true }` is only for isolated editor/schema fixtures, not a production validation shortcut.

`compileLevel(loadContent(fileMap), levelId)` produces the `CompiledLevel` simulation boundary. Towers and players sort lexically by ID; owners become player indices, or `-1` for neutral. Teams default to player IDs. `generates.troop` becomes a dense index into `kinds`, which contains only referenced troop kinds sorted by ID. Counts and durations retain their units; loaded coordinates, footprints, rates, speeds and bot fx3 parameters retain milli-units. Visual keys, bounds, resolved defaults and bot profiles pass through. Hashes are fully computed, not placeholders.

Loading, validation, compilation and pure TypeScript hashing import no Node filesystem/path/crypto APIs. A Node adapter reads files; a web adapter supplies the same map (for example via Vite glob). Node-only scripts perform disk access and Git baseline checks. Generated schemas include the hosted bot and manifest contracts; edit TypeBox sources and regenerate instead of hand-editing generated JSON.

## Regenerate and verify

After data edits and any required version bump:

```sh
pnpm content:lock
pnpm check:content --base HEAD
pnpm check:schemas
pnpm test
pnpm build
pnpm lint
```

After schema edits, run `pnpm content:schemas` before checking freshness. `content:lock` validates the pack and writes `packages/content/hashes.lock.json`; it does not bump versions. Commit metadata, data and regenerated artifacts together.

For a branch or committed change, compare with a revision preceding the change:

```sh
pnpm check:content --base <revision>
```

Replace `<revision>` with the PR base or relevant pre-change commit. Omitting `--base` defaults to `HEAD`: useful for uncommitted edits, but after committing it compares the change with itself. CI fetches full history and supplies the PR base SHA or push-before SHA (falling back to the pre-content revision `656d0ca`). Missing baseline history is an error. The check compares against **both baseline metadata and baseline hashes**, so regenerating the lock cannot hide a missing version bump. It also rejects stale locks and rules-version disagreement. A baseline predating metadata allows the first dataset; removing an existing dataset does not qualify.

Normal production commands need no `--allow-bootstrap`. That flag is only for tooling setup **before pack authoring**, with no metadata and at most troop fixtures; it produces/checks an empty lock and explicitly defers production validation. The current CI invocation retains the flag, but an authored dataset still undergoes full validation and baseline checks. Never use it to bypass a broken production pack.

`simHash` covers canonical resolved simulation inputs, including relevant overrides and inherited parameters. Names, presentation keys, bots, unused entities and schema metadata are excluded. Each resolved bot profile has a separate `botHash`; lock generation includes all profiles, while a compiled level exposes hashes for its referenced profiles. Bot-only changes do not require a simulation content bump through the current gate. The future SP04 `BOT_VERSION` enforcement must handle bot reproducibility separately.

Only the commands shown above are implemented in SP01. Balance runners, golden replay regeneration and rule-ID coverage checks (including planned `check:rules`) are follow-on SP02/SP04 tooling, not runnable SP01 scripts. Until they land, use the available content checks and record any validation that still depends on those sub-projects.
