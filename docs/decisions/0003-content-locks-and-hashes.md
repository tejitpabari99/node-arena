# ADR 0003: Content locks and hashes

Status: Accepted

Date: 2026-11-03

## Context

A level's effective simulation data includes inherited archetypes, resolved balance and authored composition. Reviewing one edited JSON file cannot show all affected identities. The [content design record](../agent_files/feat-tower-war-port-20261022-0321/README.md) establishes locks and versioned content; [compilation](../../packages/content/src/compile.ts) and [version checks](../../packages/content/src/versioning.ts) define the current inputs and guards.

## Decision

Commit level simulation hashes and per-seat bot hashes. Compare freshly generated identities against the lock, and compare version changes against a committed baseline. Require an increased content version when level hashes move and an increased bot version when bot hashes move, even after regenerating locks.

## Consequences

Indirect changes remain visible, and stale generated files fail validation. Presentation-only data stays outside the simulation hash. Authors must update the appropriate versions and generated artifacts; bot algorithm changes also follow the explicit bot-version policy in [the authoring guide](../implementation/content-authoring.md#versions-and-hashes).
