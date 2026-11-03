# Content pipeline

Authored JSON describes values and composition; definitions describe the supported vocabulary; the compiler produces the simulation boundary. [Content authoring](../implementation/content-authoring.md) gives editing procedures, and [level import](../implementation/level-import.md) covers maps and the editor.

## From source files to a match

1. Definitions in [the pure registries](../../packages/defs/src/index.ts) provide module parameters, commands, bot kinds, objectives and capabilities.
2. [TypeBox schemas](../../packages/content/src/schemas.ts) describe the authored format. Generated [JSON Schemas](../../packages/content/schemas/) support authoring and validation.
3. The [catalog](../../packages/content/src/catalog.ts) and [level loader](../../packages/content/src/level.ts) validate authored data and convert tagged fixed-point fields to integers. They check references, composition and geometry, including the shared minimum building spacing.
4. [Compilation](../../packages/content/src/compile.ts) resolves simulation defaults/overrides and preserves semantic array order in the compiled level.
5. The simulation consumes compiled inputs. Browser and server use the same loader/compiler; filesystem reads remain outside the browser-safe package.

The current `balance.minBuildingDistance` is 3.5 world units center to center, sourced from [balance.json](../../packages/content/data/balance.json). A violating building pair is a content error under [R-ENT-05](../specs/game-rules.md#r-ent-05).

## Identity, locks and versions

The compiler calculates a `simHash` over canonical simulation inputs, including bounds and resolved rules. Names, provenance, theme, colour keys, visuals, presentation-tagged parameters and bot configuration are excluded. Bot configuration has a separate hash per level/seat. [Hash generation and version checks](../../packages/content/src/versioning.ts) compare these identities with the committed lock and selected baseline.

A regenerated lock does not authorize an unchanged version for changed identities. Changed level hashes require an increased content version; changed bot hashes require an increased bot version. Rules text, the exported rules version and content metadata must agree. [ADR 0003](../decisions/0003-content-locks-and-hashes.md) records why these guards are retained.

Presentation has a separate manifest and asset checks. [Owner art](../implementation/owner-art.md) can change without simulation identity changing. Schema sources, authored JSON, generated schemas, locks and golden replay envelopes have distinct jobs; commit the generated artifacts required by the affected gates. The canonical command inventory is [tools/README.md](../../tools/README.md).
