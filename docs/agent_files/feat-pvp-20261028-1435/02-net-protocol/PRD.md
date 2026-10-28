---
status: draft
summary: New pure package packages/net - wire protocol, strict validation, lockstep scheduler and log catch-up shared by apps/server and apps/web
date: 2026-10-28
---
# PRD: Net Protocol (packages/net)
Repo/branch: node-arena / feat/pvp · Depends on: 01-seat-rules (outcome/seat types, interface assumption below) · Owns: `packages/net/**`, root `package.json` script/filter entries for net, `docs/agent_files/.../02-net-protocol/`

## TL;DR
`@node-arena/net`: pure TS, no sockets/DOM/Node APIs. Holds (1) message catalogue + versioning + strict runtime validation, (2) `LockstepServer` / `LockstepClient` schedulers, (3) bounded `CommandLog` + catch-up runner built on `sim.create` / `Sim.step`. Server (04) and web (05) only add transport and UI. Fully unit-testable with in-memory fakes.

## Problem
No networking code exists. Server and client must agree byte-for-byte on message shapes, tick numbering, command ordering and hash checkpoints, or lockstep desyncs. One shared tested package prevents drift and keeps untrusted-input validation in a single place.

## Goals / Non-Goals
Goals: one wire contract; server-stamped input delay; never-stall catch-up; command spoof-proofing; mismatched builds refused at handshake; bounded memory.
Non-goals: sockets (04), UI/rendering/jitter smoothing (05), lobby state machine and rooms (04), auth verification (Firebase later), snapshot restore, compression, binary encoding.

## Requirements
| ID | Requirement | MS |
|---|---|---|
| R1 | Message catalogue below, JSON text frames, discriminator `t`, `PROTOCOL_VERSION` int | M1 |
| R2 | `parseClientMessage(raw)` / `parseServerMessage(raw)` return `{ok,msg}` or `{ok:false,code}`; never throw; strict (unknown fields/types rejected for client msgs; server msgs tolerate unknown fields, ignore unknown `t`); size-limited | M1 |
| R3 | Handshake refuses mismatched protocol / rules (major.minor) / schema / content; `hello` ok-path returns `welcome` | M1 |
| R4 | Server stamps cmd tick = `nextTick + inputDelay` (default 3, configurable 1..10); clients never choose ticks | M1 |
| R5 | `player` is server-authored: client `cmd` has no `player` field; server fills the sender's seat player index. Spectators / empty / bot seats cannot send cmds | M1 |
| R6 | Client steps tick N only after receiving tick N, strictly in order; gap or duplicate = protocol error -> resync | M1 |
| R7 | Catch-up: replay log from tick 0 under a per-frame time budget, then continue live without gap | M2 (reconnect/spectator, incl. local-join-late helper, Task 10) |
| R8 | Hash checkpoint every 20 ticks client->server; server compares to referee; mismatch -> `desync` | M1 detect, M3 auto-resync |
| R9 | Per-seat rate limits (cmds/tick, cmds/s), hash and ping limits; abuse -> `error` then disconnect advice | M2 |
| R10 | `end` carries server-decided outcome; clients display it, do not derive it | M1 |
| R11 | Slow socket never delays others: `ticks` batch from log when behind | M2 |

## Architecture
**Layout** `packages/net/src`: `version.ts` (constants), `messages.ts` (types + codes), `validate.ts`, `codec.ts` (encode/size), `log.ts` (CommandLog), `lockstep-server.ts`, `lockstep-client.ts`, `catchup.ts`, `ratelimit.ts`, `outcome.ts` (only file touching SP01 types), `index.ts`.

**Message catalogue** (`t`):
| Dir | `t` | Fields (key) |
|---|---|---|
| C>S | `hello` | `pv`, `versions{rules,schema,content,bot}`, `nick` (1-20, trimmed printable), `token` (32 hex), `auth?` (string <=2048, future Firebase ID token, ignored now) |
| C>S | `room.create` / `room.join{code,role:'play'\|'watch'}` / `room.leave` | code `^[A-Z0-9]{4}$` |
| C>S | `lobby.update` (host) | `levelId`, `seats[{kind:'human'\|'bot'\|'empty', difficulty?, team}]` (no time limit field: read from map) |
| C>S | `lobby.ready{ready}`, `lobby.start`, `rematch` | |
| C>S | `cmd` | `c:{type:'DrawLine'\|'CutLine', from, to}`, `cid?` |
| C>S | `hash` | `tick` (multiple of 20), `h` (16 hex) |
| C>S | `resync{}` / `ping{id}` | |
| S>C | `welcome` | `pv`, `playerId`, `resume?{code,seat}`, `serverVersions` |
| S>C | `room.joined` / `lobby.state` / `room.closed` | `room.joined`: code, you{seat\|null,host}. `lobby.state`: `levelId`, `timeLimitSec` (read from map), `host`, `seats[{kind,difficulty?,team,occupant?{nick,ready,status:'connected'\|'grace'\|'bot'}}]`, `spectators` (count). `room.closed{reason}` (e.g. `shutdown`, `server-restart`, `internal`, `idle`) |
| S>C | `start` | `matchId`, `levelId`, `simHash`, `seed` u32, `seats[{player,kind,team,nick,difficulty?}]`, `youPlayer\|null` (also sent to spectators, with `null`), `inputDelay`, `countdownMs`, `timeLimitTicks`, `hashInterval:20` |
| S>C | `tick` | `n`, `c:[Command...]` (omit `c` when empty) |
| S>C | `catchup` | `from`, `to`, `cmds:[{tick,cmd}]` sparse, `done:boolean` (chunks of <=2000 ticks) |
| S>C | `ticks` | batch `{from,to,cmds}` for lagging live clients (same shape as catchup chunk) |
| S>C | `desync` | `tick`, `serverHash` |
| S>C | `seat.status` | `player`, `status:'connected'\|'grace'\|'bot'`, `graceMs?` (also emitted during lobby, for lobby disconnects) |
| S>C | `end` | outcome (see assumption), `finalTick`, `finalHash` |
| S>C | `pong` | `id`, `tick` |
| S>C | `error` | `code`, `detail?` |

Error codes: `bad-json, too-large, bad-message, unknown-type, version-mismatch, not-authed, not-in-room, not-host, not-your-seat, rate-limited, room-full, room-not-found, spectators-full, bad-lobby, not-ready, match-in-progress, desync, internal`.

**Tick cadence.** Server emits exactly one `tick` per 20 Hz tick, empty ticks included (`{"t":"tick","n":123}` ~20 B). It doubles as heartbeat and clock; no separate keepalive logic. 12 clients x 20 msg/s x <=60 B is trivial. Batching 2 ticks would save nothing and add 50 ms latency. Exception: a lagging socket gets `ticks` batches instead (R11).

**LockstepServer** (pure, no timers; 04 owns `setInterval`/drift-correct clock):
- `submit(player, cmd) -> {accepted, tick} | {rejected: code}`: validates, stamps `player`, target `= nextTick + inputDelay`, appends to `buffer[target]`. Because the server stamps on receipt there are no late commands; latency just shifts which tick a click lands on.
- `closeTick(botCmds?) -> {n, cmds, dropped, firstDrop?}` (`cmds` = logged only; `dropped` > 0 means the log refused cmds, e.g. bot cmd-cap, and SP04 should abort the room): pops buffer for `nextTick`, appends bot commands (bots decide from referee state after tick n-1, so they land on tick n directly, no delay), appends to `CommandLog`, increments. Caller steps referee with the same array and broadcasts the same JSON string to everyone (identical bytes).
- `onHash(player, tick, h)`: compares against stored referee checkpoint `-> ok | desync`. Checkpoints stored via `recordCheckpoint(tick, hash)` (<=480 entries for 8 min).
- Canonical order: arrival order within a tick. Sim itself sorts by (player, submission index) (`sim/src/commands.ts`), so server and clients, receiving the identical array, agree.

**LockstepClient**: `push(msg)` queues contiguous tick/ticks/catchup entries; `drain(maxSteps) -> {n,cmds}[]` (caller calls `sim.step(cmds)` then `after(n)`); `after(n)` returns a `hash` message when `(n+1) % 20 === 0` (hash taken post-step, tick = `sim.view.tick`, same semantics as replay checkpoints). Exposes `queued()` for HUD/jitter policy. **LockstepClient only queues ticks; it does not own or step the `Sim`** (the caller, SP05 NetDriver, owns the sim, steps it, and rebuilds it on resync). Never steps ahead of received ticks. Outgoing `cmd` has no tick; the client does not predict.

**CommandLog**: flat `{tick, cmd}[]` identical to `ReplayRecord.commands`, so a server log feeds `playReplay` unchanged (golden-style determinism test). Bounded: hard cap `timeLimitTicks + 200` ticks and `cmdCap` (~20k) entries; rate limits keep real matches < ~5k entries (<300 KB). `range(from,to,maxTicks)` yields chunks.

**Catch-up** (`catchup.ts`): `createCatchup(level, seed)` -> `{sim, feed(chunk), run(budgetMs, now)}`; `now` injected (net has no clock), steps with `{events:false}`, stops when it reaches `to` of the final chunk; hands back to live queue. Progress `{tick, target}` for a "Catching up" UI. Server uses the same helper to rebuild bots/referee in tests. Level lookup is caller-supplied (`resolveLevel`); `simHash` mismatch with `start.simHash` throws `version-mismatch`.

**Catch-up without stalling others**: server never waits on a client. Live clock continues; per-socket `bufferedAmount` above 256 KB marks it behind, pauses its tick writes, and on drain sends one `ticks` batch from `CommandLog` then resumes live. Rejoin: send `catchup` chunks from `range(0, nextTick)` (chunk `to` is exclusive, so they cover ticks `0..nextTick-1`), then subscribe to live from `nextTick`, all in the same event-loop turn (ws is ordered, so no gap). Chunks are also split at 10000 entries so each stays under the client's 1 MiB cap.

**Versioning / handshake.** `PROTOCOL_VERSION` = single int, bumped on any wire break, exact match required. Rules compared major.minor (same rule as `playReplay`), schema and content exact. `versions.bot` is sent and logged but NOT a refusal: bots run only server-side and clients only receive their commands. Stronger per-match guard: `start.simHash` vs client's compiled level. Refusal = `error{version-mismatch}` with server versions so web shows "reload to update".

**Determinism.** All sim inputs are integers already validated (`0..2^31-1`); no floats, no Date/Math.random in net src. Package inherits `eslint.determinism.cjs` preset (like bots) so this is enforced. Tick message contains full `Command` objects, passed untouched to `sim.step`; the only translation (server adding `player`) happens before logging.

**Dependency graph.** No import-boundary gate script exists in `tools/`; boundaries are per-package eslint `no-restricted-imports` (pattern: `packages/bots/eslint.config.js`) [verified: grep tools/package.json]. net: may import `@node-arena/defs` (Command, COMMANDS), `@node-arena/sim` (public exports only), `@node-arena/content` (types + `RULES_VERSION`-style constants passed in, type-only), relative files. Forbidden: `ws`, `node:*`, DOM, `@node-arena/bots`, apps. Graph: `defs <- content <- sim <- bots`; `net -> defs, sim, content(type)`; `apps/server -> net, sim, bots`; `apps/web -> net, sim`. Setup mirrors defs/bots: `package.json` (exports `dist/`), `tsconfig.json` (`lib ES2022`, `types []`), `tsconfig.check.json`, `tsx --test test/*.test.ts`; add to root `test` filter list, `typecheck:net`, lint, `build:prerequisites`.

**Interface assumptions about 01** (isolated in `outcome.ts` + `start.seats`):
- Sim player index = `player`; each seat has `{player, team}`; neutral excluded from seats.
- Sim exposes `view.over: { result: 'win'|'draw', winnerTeam: number|null, reason: 'elimination'|'timeout', ranking: {team, buildings, troops}[] } | null` (SP01 names TBD). Net's `EndOutcome` mirrors it with a `toWireOutcome(over)` adapter; any rename touches only that file.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Tick cadence | 1 msg/tick, empty included | batch 2-4 ticks; send only non-empty | heartbeat for free, no added latency, bytes negligible |
| 2 | Who stamps tick | server on receipt (`next+delay`) | client-proposed tick, bump if late | no late-cmd class, no client clock trust |
| 3 | `player` field | omitted from client cmd; server fills | client sends, server checks | cannot be spoofed by construction |
| 4 | Validation | hand-written strict validators, copy known fields | typebox | tiny web bundle, no `__proto__` leakage, exact error codes |
| 5 | Encoding | JSON text | binary, msgpack | debuggable, volume small |
| 6 | BOT_VERSION in handshake | informational only | refuse on mismatch | clients never run bots [verified: bots driver server-only in PvP] |
| 7 | `startTick` | always 0 + `countdownMs` | arbitrary startTick | rejoin uses log; simpler |
| 8 | Log format | `ReplayRecord.commands` shape | custom | reuse `playReplay` for tests/debug dumps |
| 9 | Clock injection | caller passes `now` | net reads clock | determinism lint, testability |
| 10 | Lobby msg naming | `lobby.update` (c>s host), `lobby.state` (s>c) | same name both | unambiguous |
| 11 | Seat/player/team ids | sim player index == lobby seat index; team ids 0..n-1 | mapping layer | no translation bugs [RESOLVED: orchestrator] |
| 12 | Lobby time limit | none on wire; read from map | `timeLimitSec` in `lobby.update` | per-map only (rejected: SP01 `SeatSetup.timeLimitTicks`) [RESOLVED: orchestrator] |

## Risks / Open Questions
- [RESOLVED: net owns `toWireOutcome` adapter and assumes the shape above; 01's PRD wins on names — agent recommendation]
- [RESOLVED: orchestrator - sim player index == lobby seat index; `team` ids are 0..n-1 (n = seat count); no mapping layer]
- [RESOLVED: orchestrator - SP04 asks accepted and folded into the catalogue: `room.closed{reason}`, richer `lobby.state`, `start` to spectators with `youPlayer:null`, `seat.status` in lobby]
- [RESOLVED: jitter/playout buffer policy belongs to 05; net only exposes `queued()` — agent recommendation]
- [RESOLVED: auto-resync on desync is M3; M1 client logs + toasts on `desync` — agent recommendation]
- [DEFERRED] Compression, binary frames, `auth` verification, dedupe via `cid` acks.
- Risk: hash string format. Mitigation: validator reuses replay's `/^[0-9a-f]{16}$/`.
- Risk: spoofed oversized indices. Mitigation: server also bounds `from/to < buildings.n` (referee rejects anyway; counted toward rate limit).

## Acceptance Criteria
- M1: Unit tests (no sockets): every message type round-trips; malformed/oversized/unknown-field/proto-pollution inputs return codes, never throw.
- M1: Cmd with injected `player` is rejected; accepted cmd is logged with sender's player.
- M1: Two `LockstepClient`s fed from one `LockstepServer` with scripted cmds produce equal `sim.hash()` at every 20th tick and equal final hash; log passes `playReplay`.
- M1: Client never steps tick N before `tick N`; gap/duplicate flagged; input delay stamping asserted (`next+3`).
- M1: Handshake refuses each of protocol/rules major.minor/schema/content mismatch; accepts patch-only rules diff and any bot version.
- M1: `pnpm lint`, `typecheck`, `test`, `build` include net and pass; determinism lint active; campaign goldens untouched.
- M2: Catch-up from tick 0 under a 6 ms budget reaches server hash; joined-late client resumes live with no gap; lagging socket batch path leaves other clients' tick timing unchanged; rate limits trigger `rate-limited`.
- M3: forced hash mismatch yields `desync` then full-resync convergence.
