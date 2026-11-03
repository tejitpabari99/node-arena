# Contracts

Source contracts for content authors and protocol consumers. Generated schemas and TypeScript definitions stay canonical at their implementation locations.

| Source | Contract |
|---|---|
| [Content JSON Schemas](../../packages/content/schemas/) | Generated authored content and manifest formats; regenerate from source with content:schemas |
| [Schema sources](../../packages/content/src/schemas.ts) | TypeBox authored envelopes and level/balance shapes |
| [Definition registries](../../packages/defs/src/index.ts) | Modules, commands, events, objectives, bot kinds and capabilities |
| [Network messages](../../packages/net/src/messages.ts) | Client/server wire message types |
| [Wire validation](../../packages/net/src/validate.ts) | Accepted message shapes and limits |
| [Handshake](../../packages/net/src/handshake.ts) | Version admission policy |

See [game rules](../specs/game-rules.md) for normative mechanics, [versions](../reference/versions.md) for identity rules and [content authoring](../implementation/content-authoring.md) for generation procedures. Schema copies do not live in this folder.
