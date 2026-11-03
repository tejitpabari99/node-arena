# PvP server implementation

Authoritative Node + ws server for private rooms. [Lifecycle concepts](../concepts/pvp-match-lifecycle.md) describe player-visible behaviour; the [operations runbook](../operations/pvp-server.md) owns deployment commands, close codes, version-skew handling and measured capacity.

| Source | Responsibility |
|---|---|
| [main.ts](../../apps/server/src/main.ts) | HTTP/WebSocket listener, origin policy, health, shared services and drain |
| [hub.ts](../../apps/server/src/hub.ts), [conn.ts](../../apps/server/src/conn.ts) | Connection/handshake routing, heartbeat and bounded sends |
| [room.ts](../../apps/server/src/room.ts) | Private codes, seats, teams, readiness, spectators, start/rematch and reservations |
| [clock.ts](../../apps/server/src/clock.ts) | Server-paced fixed tick scheduling |
| [match.ts](../../apps/server/src/match.ts) | Referee simulation, bots, command log, checkpoints and catch-up/resync |
| [pause.ts](../../apps/server/src/pause.ts) | Pause/disconnect holds, cumulative budgets and pending forfeits |
| [content.ts](../../apps/server/src/content.ts) | Shared compiled content and handshake versions |
| [net entrypoint](../../packages/net/src/index.ts) | Transport-free messages, validation, handshake and lockstep helpers |

## Authority and recovery

Connections submit command intents without trusted player/tick fields. The server resolves the seat, applies scheduling/limits, appends system forfeits and bot commands, then broadcasts the same tick commands it applies to its referee. Clients compare checkpoints to the authoritative hash. Reconnect and resync rebuild from seed, setup and retained command history; rooms and logs are in memory.

[Configuration](../../apps/server/src/config.ts) defaults to input delay 3 ticks, 40 rooms, 200 connections and a 30000 ms drain window. These are validated server settings; [capacity evidence](../operations/pvp-server.md#capacity) informs tuning rather than guaranteeing those limits are safe on every host.

## Shutdown and versions

On SIGTERM/SIGINT, the server announces drain, refuses new room/join/start/rematch actions and keeps running matches/reconnects during the window. It exits early after no active match remains, respecting a 3000 ms minimum notice. At the deadline rooms close without results, followed by a 2000 ms socket close grace; the hard-exit bound adds another 1000 ms. Defaults therefore give a 33 s hard bound. [Fly configuration](../../apps/server/fly.toml) sets `kill_timeout` to 40 s. The Fly edge can stop routing before process drain ends; follow the [recorded drain caveat](../operations/pvp-server.md#drain-on-sigterm).

Protocol is integer 1; current rules/schema/content/bot identities are 1.0.0. The [handshake](../../packages/net/src/handshake.ts) requires exact protocol/schema/content and matching rules major/minor, logging bot differences. See [versions](../reference/versions.md) before changing identity, and the [version-skew runbook](../operations/pvp-server.md#version-skew) for deploy/rollback effects. Production friend play-testing and final M2 owner approval remain pending.
