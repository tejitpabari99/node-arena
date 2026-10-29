---
status: draft
summary: Web client for PvP - NetDriver (server-paced lockstep), WS connection layer, PvP menu/lobby/result screens, deep links, multi-seat HUD and test hooks, with the campaign driver and save untouched.
date: 2026-10-28
---
# PRD: Web Netplay (apps/web)
Repo/branch: node-arena / `feat/pvp` · Depends on: 01-seat-rules (outcome/`team` view), 02-net-protocol (messages, `LockstepClient`, catch-up), 04-game-server (behavior), 03-pvp-maps (`listPvpMaps`) · Consumed by: 06-deploy-e2e (hooks, server URL)
Owns: `apps/web/src/{net/**,pvp/**,ui/pvp/**}`, small edits to `apps/web/src/{main.tsx,app/state.ts (types only),driver/index.ts (interface export),input/index.ts,ui/{App,Picker,ownership}.tsx,test-harness/index.ts,style.css}`, `apps/web/{package.json,vite.config.ts}` (net dep + alias, env typing), tests under `apps/web/test/pvp/`.

## M2 amendment (2026-10-29)
M1 remains a non-pausing Esc/Leave menu. SP07 (settled) supersedes blanket no-pause and bot-takeover UX in M2: Pause/Resume/Quit buttons with Yes/No Quit confirmation (countdown keeps running), synchronized pause overlay with owner, reason and per-seat remaining budget from `pause.state` (display only), forfeited/away seat chips (optional; `pause.state` + lobby reserve are the source of truth), countdown -> lobby on `start.cancel{matchId}` / `lobby.state` (discard created sim/runtime), `lastEpoch` reset on every `start`, app `ping` every 3 s while connected, and `room.leave` mid-match sent only after confirmation (server treats it as `quit`). Minimum reconnect moves from M3 to M2: on a repeated `start` for the same `matchId` recreate sim + `LockstepClient(0)` + runtime, show the catch-up overlay, auto-send `resume` for disconnect holds, show the stored result after `end`. Hidden tabs never auto-pause. M3 keeps resync, checkpoint resume and polish. New error strings for `paused`, `no-match`. Authoritative scope: [SP07 Pause, Quit and window-close forfeit](../07-pause-forfeit/PRD.md).

## TL;DR
- Separate `NetDriver` (not a GameDriver mode): ticks advance only from server `tick`s via `LockstepClient`; M1 has no pause/speed/auto-pause; M2 server-controlled pause follows SP07. Both drivers satisfy a small `MatchDriver` interface that runtime + input consume, so campaign code paths stay byte-for-byte.
- A separate `PvpController` (own state, subscribe/events API like `AppController`) owns connection, lobby, match, result. `App.tsx` renders its screens when active; `AppController` is not extended.
- Identity: nickname in localStorage key `nodearena:pvp`; player token in `sessionStorage` (per tab, survives reload in the same tab -> reconnect; two tabs in one profile = two players). `nodearena:save` is untouched, so no schema bump/migration.
- Deep links `?room=ABCD` / `&watch`, server URL via `VITE_PVP_SERVER_URL`, `window.__na.pvp` + `data-testid`s for SP06.
- No local prediction in v1 (150 ms input delay is server-side).

## Problem
Client is single-human and self-clocked: `GameDriver` owns rAF clock, bots, pause/speed, hidden auto-pause; input/HUD/save find "the human" via `kind==='human'`; one URL param (`?view=custom`); no network code [verified: driver/index.ts, input/index.ts:32, ui/Hud.tsx, save/index.ts MatchResult, main.tsx:22]. PvP seats are all `kind:'human'` placeholders (SP01 D3), so every `findIndex(kind==='human')` is wrong in PvP.

## Goals / Non-Goals
Goals: create/join/watch by code or link; lobby; lockstep play with 2-4 seats; catch-up/reconnect UX; N-seat/draw results; zero campaign regression.
Non-goals: prediction, chat, accounts/Firebase (hello `auth` slot only), mobile layout, in-world team rings and per-seat camera rotation [DEFERRED], server deploy (06), Playwright e2e (06).

## Requirements
| # | Requirement | M |
|---|---|---|
| R1 | Main menu gains "Play online" (hidden when no server URL configured in a prod build). Opens PvP menu: nickname field (1-20, persisted), Create room, Join by 4-char code, Watch by code. | M1 (create/join), M2 (watch) |
| R2 | Lobby shows code, share link (copy button; play link and `&watch` link), map cards from `listPvpMaps`, seat rows, spectator count, connection state. Host: choose map, seat kind human/bot(easy/normal/hard)/empty, team per seat, Start. Non-host: Ready toggle only. Start disabled with reason text until server rules pass (unready/empty seat). | M1 (2 seats, Duel S, start+ready), M2 (all) |
| R3 | Match start: show "Get ready" countdown (`countdownMs`), create sim from `start` (`levelId`, `seed`, `teams`), step only on ticks. HUD: ownership bar (N colors), seat legend (color dot, nick, team badge, "you", eliminated/bot/disconnected status), time remaining from `timeLimitTicks`. M1: no pause button; Esc opens a non-pausing menu with Leave only. M2 pause/Resume/Quit follows SP07. | M1 (bar+timer), M2 (legend) |
| R4 | Input: drawing starts only from own buildings; targets may be any building incl. allies (sim canDraw is authority; reason text shown as today). Spectators: input disabled, "Spectating" badge. | M1 |
| R5 | Catch-up: join/reconnect/spectate/background-return show "Catching up N%" overlay; the frame budget never blocks input or paint for more than ~8 ms of stepping. Live play resumes with no gap. | M2 |
| R6 | Result popup from the server `end` outcome (not locally derived): Victory / Defeat / Draw (you among winners) / team-win / spectator "X won"; placement table for N seats/teams with nick, team, buildings, troops; buttons Rematch (players) and Leave. Shown after local sim reaches `finalTick` (or 3 s after `end`), then presentation delay as today. | M1 (win/lose), M2 (N-seat, draw, rematch) |
| R7 | Rematch: `rematch` message; on `lobby.state` the UI returns to the lobby with same setup. | M2 |
| R8 | Connection UI: states connecting / connected / reconnecting (backoff) / lost / refused. Reconnect re-handshakes with same token, rebuilds sim via catch-up. Seat in grace shows status chip for others. Superseded (close 4000) and `version-mismatch` show terminal messages ("Opened in another tab", "New version: reload"). | M2 (basic + minimum mid-match reconnect per SP07), M3 (polish) |
| R9 | `desync` message: toast "Out of sync with server" (log tick + hashes to console). M3: auto-resync = rebuild sim from full catch-up. | M1 toast, M3 resync |
| R10 | Deep links: `?room=ABCD` opens join flow for that room (nick prompt if none), `&watch` joins as spectator; invalid code shows error and falls back to menu; params cleaned after leave. | M2 |
| R11 | Server URL: `VITE_PVP_SERVER_URL` (ws/wss). Dev default `ws://127.0.0.1:8080` (SP04 `PORT`). Test/dev builds also honor `?server=`. | M1 |
| R12 | Campaign untouched: `pnpm test`, `test:web:e2e`, `campaign:verify` unchanged; `nodearena:save` format unchanged. | M1 |

## Architecture
**Layout** (all new unless noted)
- `src/net/connection.ts`: `PvpConnection` over injectable `WebSocketLike` factory. States above; backoff 0.5/1/2/4/8 s (cap 8 s, +-20% jitter via injected `rand`), give up after ~60 s -> `lost` (manual Retry). Frames pass through net `parseServerMessage`; sends via net `encode`. Sends `hello{pv,versions,nick,token}` on every open. No reconnect on close 4000 or `version-mismatch`.
- `src/net/identity.ts`: nick persisted in localStorage `nodearena:pvp` = `{v:1, nick}`; token (32 hex from `crypto.getRandomValues`) persisted in `sessionStorage` (key `nodearena:pvp:token`), so each tab is a distinct player and a reload in the same tab reconnects as the same player (required for the M1 2-tab play-test in one browser profile); all access try/catch (blocked storage -> in-memory token). Invalid blob -> regenerate token, keep nick if string.
- `src/net/links.ts`: `parseRoomLink(search)` -> `{code, role}|null` (`/^[A-Za-z0-9]{4}$/`, uppercased, `watch` flag presence); `shareLinks(origin, path, code)`.
- `src/driver/net-driver.ts`: `NetDriver implements MatchDriver`.
- `src/pvp/controller.ts`: `PvpController` — `snapshot()/subscribe()/subscribeEvents()` shape matching `AppController`, plus actions (`create, join, watch, updateLobby, ready, start, rematch, leave, retry`). Owns connection, `NetDriver`, runtime lifecycle (same generation-token pattern as `startLevel`). Takes `files`/`manifest`/`createRuntime` from the app so content+assets are shared.
- `src/ui/pvp/`: `PvpMenu`, `Lobby`, `SeatRow`, `PvpHud` (bar + legend + conn chip + catch-up), `PvpResult`, `ConnBanner`, `Toast`. Same panel/button classes and sprite assets as `Picker`/`BattlePopup`; colors from manifest palettes by `players[i].colorKey` (no new hard-coded seat colors).

**MatchDriver** (exported from `driver/index.ts`, implemented by both):
```ts
interface MatchDriver {
  readonly sim: Sim; readonly alpha: number; readonly paused: boolean;
  readonly ownership: OwnershipSegment[]; readonly lastStepMs: number;
  submit(cmd: Command): unknown;            // Net: drops `player`, sends {t:'cmd'}
  start(): void; stop(): void; dispose(): void; step?(n:number):number; setSpeed?(s:1|2):void;
}
```
`RuntimeContext.driver` widens to `MatchDriver`; adds optional `seat?: number|null`. `createInputController` takes `seat` (default: today's `findIndex(kind==='human')`, so campaign unchanged); `null` = read-only. Input `driver.submit` payload keeps `player` for campaign; NetDriver ignores it.

**NetDriver loop.** `LockstepClient` fed in the WS `onmessage` handler (not rAF), so background tabs keep receiving. Per rAF frame:
1. `n = client.queued()`; budget = live ? 1-2 steps : catch-up (time-boxed 8 ms via `performance.now`, uses `events:false`; events only for the final 2 steps of a drain so fx do not flood).
2. Each drained `{n,cmds}` -> `sim.step(cmds,{events})`, `onTick`, and `client.after(n)` -> if it returns a `hash` message, send it.
3. `alpha` = `clamp((now - lastStepAt)/STEP_MS, 0, 1)`; queue empty = hold alpha 1 (no extrapolation). No jitter buffer: server already delays input 150 ms; stepping on arrival keeps latency minimal. Large burst (`queued > 6`) switches to catch-up stepping; progress = `tick / (tick + queued)` shown when `queued > 40` or during `catchup` messages.
4. `canStep` ignores `document.hidden`; visibility change never pauses. On return, backlog drains via step 1.
Game over locally is informational: result UI waits on server `end`; mismatch between local `sim.view.over` and `end.outcome` logs a console error (hash check is the real guard).
Resync/reconnect: dispose client+sim, create fresh `create(level, seed, {teams})` + `LockstepClient`, feed `catchup` chunks (net `createCatchup` if it owns the sim; else same loop), runtime keeps the scene and re-binds `frame.view` [verify: `createBrowserRuntime` captures `driver.sim.view` once, so M3 either recreates the runtime or `NetDriver` rebuilds the sim in place via `Sim`-level reset -> treat as recreate runtime, scene cost is small].

**Controller state machine**: `idle -> menu -> connecting -> lobby -> countdown -> playing -> result -> lobby (rematch) | menu (leave)`; spectator uses same with `seat:null`. Server messages map 1:1: `welcome`, `room.joined`, `lobby.state`, `start`, `tick/ticks/catchup`, `seat.status`, `end`, `desync`, `room.closed{reason}`, `error{code}` (error codes -> user strings table; `room-not-found`, `room-full`, `spectators-full`, `not-host`... ).

**App wiring.** `main.tsx`: construct `PvpController` after `app`; render `<PvpLayer/>` from `App.tsx` when `pvp.snapshot().screen !== 'idle'` (Picker/Hud hidden; solo `AppController` stays on picker underneath so Leave returns to it). `arena.hidden` also considers pvp screen. Deep link: after `app.boot()`, `parseRoomLink(location.search)` -> `pvp.openLink`. Audio: `connectAppAudio` consumes an event source; PvpController exposes `subscribeEvents` with the same `TickUpdate` [verify audio/app.ts accepts it, else widen to a minimal interface].

**Multi-seat visuals.** `ownership()` is already N-player [verified: ui/ownership.ts]; PvP bar adds team grouping (adjacent segments of one team separated by a thin gap). Seat legend marks "you" and allies (team badge letter/number + color ring; not color alone). World-space team rings/you-marker [DEFERRED]; "you" is conveyed by legend + own-building draw affordance (existing hover/select feedback). Seat colors from level `colorKey` (blue, red, green, yellow per SP03).

**Test hooks (for SP06).** Existing gate: `window.__na` only when DEV or `VITE_TEST_HOOKS=1` [verified: main.tsx, test-harness/gate.ts]. Add `window.__na.screen` (pvp screen name, e.g. `menu|lobby|countdown|playing|result`), and in netplay mode `window.__na.view` / `window.__na.submit(cmd)` / `window.__na.hash()` point at the active `NetDriver` (SP06 relies on these exact names). Also `window.__na.pvp = { state(), actions: {create,join,watch,start,ready,rematch,leave}, tick, hash(), queued, submit(cmd), connection(), setServer(url) }` plus stable `data-testid`s: `pvp-play`, `pvp-nick`, `pvp-create`, `pvp-code-input`, `pvp-join`, `pvp-watch`, `lobby-code`, `lobby-share-play`, `lobby-share-watch`, `lobby-map-<levelId>`, `lobby-seat-<i>`, `seat-kind-<i>`, `seat-difficulty-<i>`, `seat-team-<i>`, `lobby-ready`, `lobby-start`, `lobby-spectators`, `conn-state`, `catchup-progress`, `match-timer`, `seat-legend-<i>`, `pvp-result`, `result-placement-<i>`, `pvp-rematch`, `pvp-leave`, `toast-desync`. Test builds honor `?server=ws://...` and `?nick=`. Existing `window.__na.hash()/view/submit` keep working by pointing `app.driver` hooks at the active `MatchDriver` when pvp is playing (`__na.hash()` falls back to `pvp` driver). Names SP06 uses (verbatim): `pvp-create`, `pvp-code-input`, `pvp-join`, `lobby-code`, `lobby-seat-<i>`, `lobby-ready`, `lobby-start`, `lobby-map-<levelId>`, `pvp-result`, `pvp-rematch`, `conn-state`.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Driver | Separate `NetDriver` + `MatchDriver` interface | `GameDriver` with tick-source flag | GameDriver is pause/speed/bot/hidden-pause-centric; flag-ifying risks campaign regressions [RESOLVED: agent recommendation] |
| 2 | State owner | Separate `PvpController` | Extend `AppController` | state.ts is dense, single-human, 150 lines of invariants; isolation = zero campaign risk [RESOLVED] |
| 3 | Persistence | Nick in localStorage `nodearena:pvp`; token in `sessionStorage` | Add nick to `nodearena:save` (v3 + migration); token in localStorage | Save validator is exact-field and discards unknown shapes; per-tab token lets two tabs in one profile be two players [RESOLVED: orchestrator] |
| 4 | Prediction | None | Local ghost line until echoed | Server-side delay 150 ms is consistent and simple; revisit after M1 play-test [RESOLVED] |
| 5 | Jitter buffer | Step on arrival, hold alpha | Fixed 100 ms playout buffer | Server delay already hides jitter; buffer would add latency [RESOLVED] |
| 6 | Hidden tab | Never pause; catch up on return | Auto-pause | Visibility alone never auto-pauses; M2 explicit/detected-disconnect pause follows SP07 |
| 7 | Seat identity in input | `seat` option, `null` = spectator | Infer from `kind` | All PvP seats are `human` placeholders |
| 8 | Server URL | `VITE_PVP_SERVER_URL`; dev default `ws://127.0.0.1:8080`; hide entry if unset in prod | Hard-coded; runtime config fetch | Static hosting; SP06 sets it per channel |
| 9 | Result source | Server `end` | Local `sim.view.over` | Locked: server decides outcome |
| 10 | Level resolution | Use client's own compiled content by `start.levelId`, check `simHash` | Server ships level | Net handshake already enforces equal content |
| 11 | Team/you markers in world | Legend only in v1 | World rings | Renderer change; defer until M1 play-test shows need |

## Risks / Open Questions
- [RESOLVED: SP05 renders `lobby.state` as sent; map list = client `listPvpMaps(catalog)`, selection validated by server — agent recommendation]
- [RESOLVED: takeover superseded by SP07 for all humans (settled 2026-10-29); M2 reconnect recovers the same pause budget before its deadline.]
- Risk: `createBrowserRuntime` binds `driver.sim.view` once; sim rebuild (resync/reconnect) needs runtime recreation. Mitigation: controller recreates runtime on rebuild (M3). [verify at impl]
- Risk: catch-up of an 8 min match at 6-8 ms/frame budget: 9600 ticks x ~0.25 ms = ~2.4 s CPU -> 5-6 s overlay on mid-range hardware. Acceptable; SP02 `createCatchup` same budget.
- Risk: background-throttled tab sends hash late -> false desync? Server compares per checkpoint when received; late hash for old tick is still valid. [RESOLVED: SP04 compares by tick]
- Risk: `Math.random`/`Date` in web code is fine (determinism lint covers sim/net/bots only) but nothing in NetDriver may feed them into the sim.
- [RESOLVED: orchestrator - SP02 `LockstepClient` only queues ticks (`push/drain/after/queued`); it does not own the `Sim`. Web (NetDriver) owns the sim; resync = rebuild sim + new client]
- [DEFERRED] Ghost line for pending command; world team rings; per-seat camera orientation; sound cues for elimination; hidden-tab background stepping.

## Acceptance Criteria
- M1: `NetDriver` unit tests with fake `LockstepClient`/environment: steps only on pushed ticks; never pauses when hidden; hash message emitted at every 20th tick; `submit` emits `cmd` without `player`/tick; `alpha` clamps; catch-up respects time budget.
- M1: connection tests with fake WebSocket: hello on open, backoff schedule, no reconnect on 4000/version-mismatch, malformed frame ignored not thrown.
- M1: two browser tabs vs local server: create room, join by code, both Ready, host Start, play Duel S; both show same `__na.hash()` at tick 200; result popup per seat shows Victory/Defeat from `end`.
- M1: `parseRoomLink` table tests; identity storage survives blocked localStorage/sessionStorage; token is per-tab (second tab gets a different token, reload keeps it); `nodearena:save` byte-unchanged by PvP actions.
- M1: campaign regression: `pnpm test`, `test:web:e2e`, `campaign:verify`, `typecheck`, `lint` green; `GameDriver` tests unchanged.
- M2: component tests (existing `test/sp08` pattern): lobby host vs non-host controls, disabled Start reasons, share-link copy, 4-seat legend with teams, N-seat + draw result rendering, deep-link flow incl. invalid code.
- M2: spectator via `&watch` sees catch-up progress then live hash equal to players'; input disabled; rematch returns to lobby and starts with new seed.
- M3: kill socket mid-match -> "Reconnecting" -> resumes with equal hash; forced desync -> toast then rebuild converges.
