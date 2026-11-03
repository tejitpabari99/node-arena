# ADR 0007: Minimum building spacing

Status: Accepted

Date: 2026-11-03

## Context

The [approved input decisions](../agent_files/feat-online-polish-20261103-0028/README.md) pair easier building selection with a formal spacing rule. Current [balance data](../../packages/content/data/balance.json) sets `minBuildingDistance` to 3.5. A 1.5-unit [building footprint](../../packages/content/data/buildings/house-wt1.json), [render radius calculation](../../apps/web/src/render/world.ts) and 0.35 [pick margin](../../apps/web/src/input/geometry.ts) give the standard 1.10-unit pick radius, with a 22 CSS-pixel floor.

## Decision

Enforce the shared minimum as a hard validation error for every building pair, regardless of owner or archetype, under [R-ENT-05](../specs/game-rules.md#r-ent-05). The editor uses the same catalog value for placement/movement. Keep the value tunable in content.

## Consequences

Standard world-space pick areas have a gap at the minimum spacing, preserving empty-ground cut starts. The screen-space floor can overlap at small projections; nearest projected center resolves that selection. Invalid custom layouts fail validation and need author correction. Shipped adjustments and locks preserve the same spacing contract across campaign, custom and PvP content.
