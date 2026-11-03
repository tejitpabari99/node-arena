# PvP match lifecycle

Private rooms coordinate seats, teams, bots and spectators around an authoritative command log. [Room state](../../apps/server/src/room.ts) progresses through lobby, countdown, running, ended and closed. [Network messages](../../packages/net/src/messages.ts) are the shared wire contract.

## Lobby and start

The host chooses a map and seat configuration. Occupied seats are human or bot, with per-seat teams and bot difficulty; spectators watch without submitting gameplay commands. Maps support 2–4 seats within their authored limit. All seated humans must be ready before the host starts; the host is ready automatically. A rematch returns the room to its lobby and creates a new match seed when started.

The server chooses the seed, team setup and start boundary. [Lockstep scheduling](../../packages/net/src/lockstep-server.ts) stamps human inputs with the server seat and a default delay of three ticks. Clients receive complete tick commands and step the same engine; they do not predict their own commands. Server bots run the same command interface. The hard preset has `actionDelayMs: 1000`, from [BOT_PRESETS](../../packages/bots/src/difficulty.ts).

## Pause, disconnect and leaving

The [pause module](../../apps/server/src/pause.ts) gives each human a cumulative 30 s pause/disconnect budget. Holds freeze the board and match clock; resuming preserves unused budget. Each disconnect can open a hold, and the match resumes when every hold ends. A single surviving human has unlimited holds; bots and spectators cannot request a player pause.

Confirmed Leave during a match sends quit. Quit or budget expiry becomes the server's logged Forfeit command: that seat is eliminated, its buildings become neutral and its troops disappear. Remaining seats continue, with victory determined by the team/outcome rules in the [mechanics contract](../specs/game-rules.md#3-rules-by-area). Simultaneous away-human expiry can resolve the match as a draw. During a countdown a dropped player cancels the start; disconnected lobby seats have a separate reservation policy.

## Reconnect, resync and results

Per-tab identity allows a returning connection to reclaim its seat. The server sends match start information and chunked command history; the browser rebuilds its simulation and drains catch-up before normal play. Spectators can attach mid-match through the same history path.

A hash mismatch or tick-queue disagreement requests resync, rebuilding from the retained log. Limits and retry behaviour belong to the [server match controller](../../apps/server/src/match.ts) and [client PvP controller](../../apps/web/src/pvp/controller.ts); a reconnect does not restore a room lost to server restart. End messages deliver the authoritative result. Rematch returns participants to the lobby; server drain closes matches without a result. See [operations](../operations/pvp-server.md) for deployment and health checks. Production friend play-testing and final M2 approval remain pending.
