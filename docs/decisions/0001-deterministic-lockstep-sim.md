# ADR 0001: Deterministic lockstep simulation

Status: Accepted

Date: 2026-11-03

## Context

Campaigns, replay verification and online clients need reproducible outcomes from the same inputs. The [port decision record](../agent_files/feat-tower-war-port-20261022-0321/README.md) fixes integer 20 Hz simulation and seeded streams; the [PvP decisions](../agent_files/feat-pvp-20261028-1435/README.md) reuse it for network play. [Simulation math](../../packages/sim/src/math.ts) and [replay](../../packages/sim/src/replay.ts) implement the current contract.

## Decision

Keep one pure, fixed-tick integer simulation for local matches, replay playback and PvP referee/client execution. Feed it compiled content, a seed, team setup where applicable, and explicit commands. Keep rendering, transport and wall-clock scheduling in adapters.

## Consequences

Recorded commands can reproduce a match without running bots. State hashes expose divergence and allow log-based catch-up. Outcome changes require a deliberate rules/version change and regenerated verification artifacts; renderer timing cannot become a hidden simulation input.
