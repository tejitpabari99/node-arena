# Mission

Node Arena is a browser tower-strategy game about drawing persistent routes, capturing buildings and choosing where to commit pressure. It offers a solo campaign, a local level editor and private online matches with friends. Assets are based on / motivated by Tower War; provenance and licence copies are recorded in [credits](reference/credits.md).

## Scope and audience

| Experience | Current scope |
|---|---|
| Campaign | 20 Common levels, displayed as 1–20, drawn from source positions 4–23; Green and Snow themes |
| Editor | Local development authoring, validation, play-testing and explicit Save/Finalize of custom and PvP maps |
| Online PvP | Private rooms for 2–4 occupied human/bot seats, teams, spectators, pause, reconnect and rematch |

The [Common campaign list](../packages/content/data/campaigns/common.json), [seat objectives](../packages/defs/src/objectives.ts) and [level authoring workflow](implementation/level-import.md) define those concrete boundaries. Campaign progress and audio preferences are stored locally. The client uses a landscape presentation.

The game should stay understandable to players and reproducible for contributors: the same content, seed and command sequence produce the same simulation. Authored data supplies tunable values; shared rules govern humans and bots. New maps should reuse existing behaviour where possible.

## Product boundaries

Public matchmaking, accounts/cloud progression, currencies, permanent stat upgrades, boosters, source tutorials and campaign positions beyond the shipped set are deferred. See [future decisions](decisions/futures.md). Imported fidelity limits, including dropped cargo and the position-23 wall, are explicit in [level coverage](reference/level-coverage.md).

Production play-testing with a friend and final M2 owner approval remain pending. Deployment, heartbeat and drain evidence is recorded in the [operations runbook](operations/pvp-server.md); those records do not establish final play-test approval.

## Documentation authority

This mission takes priority when other documentation disagrees about product scope. The [game rules](specs/game-rules.md) specify mechanics and stable rule IDs; authored content supplies values. [Architecture](architecture.md) explains implementation boundaries, [ADRs](decisions/README.md) explain deliberate tradeoffs, and [authoring procedures](implementation/README.md) describe changes. A scope change updates this mission and the affected contracts before implementation.
