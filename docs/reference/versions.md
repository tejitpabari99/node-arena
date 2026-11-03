# Versions

Current identities use the 1.0.0 baseline. Exact sources and responsibilities:

| Identity | Current | Authoritative source | Change policy |
|---|---|---|---|
| `RULES_VERSION` | 1.0.0 | [Rules export](../../packages/content/src/versioning.ts), mirrored in the [rules header](../specs/game-rules.md) and [content metadata](../../packages/content/content.json) | Major: existing replay outcomes change; minor: additive mechanics; patch: clarification |
| `contentVersion` | 1.0.0 | [Content metadata](../../packages/content/content.json) | Increase whenever committed level simulation hashes change, including additions/removals |
| `SCHEMA_VERSION` | 1.0.0 | [Content schemas](../../packages/content/src/schemas.ts) | Change for authored format changes, not ordinary balance tuning |
| `MANIFEST_SCHEMA_VERSION` | 1.0.0 | [Manifest schema](../../packages/content/src/manifest.schema.ts), mirrored by the [runtime manifest](../../apps/web/assets/manifest.json) | Change with the presentation manifest format |
| `BOT_VERSION` | 1.0.0 | [Bot version](../../packages/bots/src/version.ts) | Bump algorithms; increase when the resolved bot-hash map changes |
| `PROTOCOL_VERSION` | 1 | [Protocol constants](../../packages/net/src/version.ts) | Integer bump for a wire break; exact handshake match |
| Save `v` | 1 | [Save store](../../apps/web/src/save/index.ts) | Current format is strict; mismatched/invalid data resets, with a backup when possible |
| Workspace package versions | 1.0.0 | Each workspace package manifest | Release/package identity; the root private manifest has no version field |

The editor's [save counter](../../tools/src/editor-ops.ts), `editorVersion`, starts at 1.0.0 per authored level and increments its patch component when saved content changes. It is presentation metadata, not a global simulation version. Source-game provenance such as `source.gameVersion` identifies external input and is not a Node Arena product version.

## Compatibility checks

The [hello handshake](../../packages/net/src/handshake.ts) requires exact protocol/schema/content matches and matching rules major/minor; rules patch differences are accepted. Bot-version differences are logged without rejecting the connection. [Replay playback](../../packages/sim/src/replay.ts) checks rules major/minor, exact schema/content identity, level ID/hash and optional team setup; recorded bot commands play without executing bot code.

[Content guards](../../packages/content/src/versioning.ts) and [bot guards](../../packages/content/scripts/bot-version.ts) compare with a committed baseline. Freshly writing a lock does not satisfy a missing version increase. Rules text, export and metadata must agree. Follow [rules-first order](../decisions/0005-rules-first-change-order.md) and [authoring procedures](../implementation/content-authoring.md).

## Baseline reset and owner follow-up

[ADR 0008](../decisions/0008-versions-reset-to-1-0-0.md) records the baseline decision. The explicit `--base none` option, `VERSION_GUARD_BASE=none`, or CI's `CONTENT_BASE=none` omits historical baseline comparisons while retaining metadata validation and lock/golden freshness checks. Invalid explicit revisions still fail.

The reset branch's [CI workflow](../../.github/workflows/ci.yml) currently selects that one-time override. **Owner follow-up: restore normal baseline selection after the reset merges into main.** Keep the override until that merge; use ordinary monotonic guards for subsequent changes. [CI baseline precedence](../../tools/README.md#ci-and-version-baselines) remains the canonical command detail.
