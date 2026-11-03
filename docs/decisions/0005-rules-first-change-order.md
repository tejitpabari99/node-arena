# ADR 0005: Rules-first change order

Status: Accepted

Date: 2026-11-03

## Context

Shared mechanics must remain reviewable across simulation, bots, editor and network play. [Repository policy](../../AGENTS.md) and the [rules conventions](../specs/game-rules.md#1-conventions) establish stable rule IDs and version meaning; the [rule coverage gate](../../tools/src/rules.ts) checks real test titles.

## Decision

Change mechanics in this order: rule text and changelog, rules-version bump, tests whose titles contain the affected `covers R-...` tags, then implementation. Major versions change existing replay outcomes; minor versions add mechanics; patches clarify the contract. Put tunable values in authored content and follow content/hash guards when identities change.

## Consequences

Tests connect implementation to explicit rules rather than prose references hidden in test bodies. Rule IDs are never reused; deleting a rule also removes its tests, with history retained in git. A value-only content edit does not need invented rule semantics. New rules must pass coverage before the change is complete.
