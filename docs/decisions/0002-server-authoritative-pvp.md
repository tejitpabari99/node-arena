# ADR 0002: Server-authoritative PvP

Status: Accepted

Date: 2026-11-03

## Context

Private live matches need a shared clock and an authority for legal inputs and results. The [PvP decision record](../agent_files/feat-pvp-20261028-1435/README.md) selects lockstep plus a server referee to reuse the deterministic engine with command-sized network traffic. [Server match handling](../../apps/server/src/match.ts) and [lockstep scheduling](../../packages/net/src/lockstep-server.ts) implement that boundary.

## Decision

The server assigns seats and ticks, validates incoming commands, runs bots, closes each tick and steps a referee simulation. Clients send intents and simulate the server's command batches. Server results and checkpoint comparisons are authoritative.

## Consequences

Clients cannot choose another player's seat or advance the shared clock. Spectators and reconnecting players replay the retained log. The configured input delay adds latency; hash disagreement triggers resync. Server scheduling and room lifecycle become required services for online play.
