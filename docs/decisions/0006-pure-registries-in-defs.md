# ADR 0006: Pure registries in defs

Status: Accepted

Date: 2026-11-03

## Context

Schema generation, validation and execution need one shared vocabulary for modules, commands, objectives, events and bot kinds. The [registry design record](../agent_files/feat-tower-war-port-20261022-0321/README.md) introduces defs as its own package. Its [entrypoint](../../packages/defs/src/index.ts) contains the explicit registries, and the [simulation binding map](../../packages/sim/src/modules/index.ts) checks implementation coverage.

## Decision

Keep definitions independent of simulation, browser and server execution. Derive types, parameter schemas and capabilities from those registries. Bind engine implementations in the consumer with a typed exhaustive map.

## Consequences

Adding a module requires one definition registration and a matching implementation binding; missing or mismatched bindings fail typechecking. Schemas and capabilities follow the same definition set. Definitions may depend on their schema library, while engine imports stay out of the defs package. Runtime behaviour remains the consumer's responsibility.
