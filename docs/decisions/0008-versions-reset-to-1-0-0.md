# ADR 0008: Versions reset to 1.0.0

Status: Accepted

Date: 2026-11-03

## Context

The [approved branch decisions](../agent_files/feat-online-polish-20261103-0028/README.md) establish a single 1.0.0 product baseline. Current [content metadata](../../packages/content/content.json), [rules export](../../packages/content/src/versioning.ts), [bot version](../../packages/bots/src/version.ts), [protocol](../../packages/net/src/version.ts) and [save format](../../apps/web/src/save/index.ts) define the resulting identities.

## Decision

Use 1.0.0 for rules, content, schemas, bot and workspace package versions; protocol and save-format identifiers are integer 1. The rules changelog contains one baseline entry. Keep normal version guards; land this baseline using the explicit `--base none` mechanism and the one-time `CONTENT_BASE=none` [CI selection](../../.github/workflows/ci.yml).

## Consequences

The no-baseline option skips baseline comparisons while retaining validation and lock freshness checks. Normal baseline selection must be restored after this reset merges into main; the temporary override remains in place until then. Subsequent changes follow the established monotonic version policy. Client/server versions must pass the handshake, so deployment coordinates server and web; mismatched saved data is discarded by the current save decoder.
