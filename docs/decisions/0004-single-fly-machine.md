# ADR 0004: Single Fly machine

Status: Accepted

Date: 2026-11-03

## Context

The [PvP decision record](../agent_files/feat-pvp-20261028-1435/README.md) chooses one always-on Fly instance with in-memory rooms for private matches. [Fly configuration](../../apps/server/fly.toml) and the [operations runbook](../operations/pvp-server.md) make the single-machine deployment constraint explicit.

## Decision

Keep rooms, match simulations and command logs in one server process on one Fly machine. Host the static browser client on Firebase. Drain the server before restart and deploy the server with version health checks before deploying the client.

## Consequences

No shared room store or cross-machine routing is needed. Deploy/restart discards every room, and horizontal scaling requires a new persistence/routing design. Drain gives notice and ends matches without results; it does not persist them. Capacity must be measured for this machine, and final production friend play-test approval remains pending.
