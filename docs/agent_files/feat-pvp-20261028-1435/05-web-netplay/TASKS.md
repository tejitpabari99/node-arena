---
status: draft
summary: 18 tasks (10 M1, 5 M2, 3 M3) for apps/web netplay - MatchDriver seam, identity/links, connection, NetDriver, PvpController, PvP screens, HUD, result, test hooks, catch-up, watch, deep links, reconnect, resync.
date: 2026-10-28
---
# Tasks: Web Netplay (apps/web)
Source of truth: [PRD.md](PRD.md). Client for online PvP: separate NetDriver and PvpController beside the untouched campaign driver/AppController/save. Cross-SP refs `SPxx#N` point at sibling TASKS.md numbers. SP07 (2026-10-29) ownership: all pause/quit/forfeit/heartbeat/reconnect-hold work is tracked in ../07-pause-forfeit/TASKS.md, not here; entries below carry only amended decisions. SP07-owned web work: Pause/Resume/Quit buttons + Yes/No confirm, pause overlay from `pause.state`, `lastEpoch` reset on `start`, app `ping` every 3 s, countdown -> lobby on `start.cancel`, `room.leave` only after confirm, new error strings, auto-`resume` after reconnect catch-up, and the minimum mid-match reconnect (moved from task 16 to M2). Bot-takeover UX is superseded.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | [M1] MatchDriver seam + seat-aware input + net dep | SP02#1 | done |
| 2 | [M1] Identity, room links, server URL | none | done |
| 3 | [M1] PvpConnection | SP02#2, SP02#3, SP02#4 | done |
| 4 | [M1] NetDriver (live stepping) | 1, SP02#7, SP01#4 | done |
| 5 | [M1] PvpController: connection, lobby, start | 2, 3, SP04#5 | done |
| 6 | [M1] PvpController: match lifecycle + end | 1, 4, 5, SP04#6, SP03#2 | done |
| 7 | [M1] PvP menu, 2-seat lobby, App/main wiring | 5, 6 | done |
| 8 | [M1] PvpHud (ownership bar, timer, Esc leave) + toast | 6, 7 | done |
| 9 | [M1] PvpResult (win/lose) | 6, 8, SP01#8, SP02#8 | done |
| 10 | [M1] Test hooks + two-tab acceptance + campaign regression | 7, 8, 9, SP04#8 | done |
| 11 | [M2] Full lobby (maps, seats, teams, share links) | 7, SP03#8, SP04#11 | done |
| 12 | [M2] Seat legend + team-grouped bar | 8, 11 | done |
| 13 | [M2] Catch-up budget + overlay | 4, 6, SP02#10, SP04#13 | done |
| 14 | [M2] Watch mode + deep links | 7, 13, SP04#13 | done |
| 15 | [M2] N-seat/draw result, rematch, connection banners | 9, 11, SP01#11, SP04#14 | todo |
| 16 | [M3] Reconnect resume + seat reclaim UX | 3, 13, 15, SP04#19 | todo |
| 17 | [M3] Desync auto-resync (runtime recreation) | 6, 13, SP02#13, SP04#20 | todo |
| 18 | [M3] M2/M3 acceptance tests sweep + doc notes | 14, 15, 16, 17 | todo |

## Task 1 — [M1] MatchDriver seam + seat-aware input + net dep
What it is: the interface (PRD D1, D7, R12) letting runtime/input consume either driver without touching campaign behavior.
What changes: export `MatchDriver` from the driver index, implemented by existing `GameDriver` as-is; widen `RuntimeContext.driver` and add optional `seat`; input controller takes `seat` (default = today's human lookup, `null` = read-only). Add `net` workspace dep, Vite alias, env typing for `VITE_PVP_SERVER_URL`. Tests: input with explicit seat, null seat blocks drawing, default seat unchanged.
Done when: existing web tests, `typecheck`, `lint` green and `GameDriver` tests unchanged.

## Task 2 — [M1] Identity, room links, server URL
What it is: R11, Decision 3, Decision 8 plumbing.
What changes: nick persisted in localStorage `nodearena:pvp`; 32-hex token in sessionStorage (per tab, reload keeps it); all storage try/catch with in-memory fallback; invalid blob regenerates token, keeps string nick. `parseRoomLink` / `shareLinks`. Server URL resolution: env var, dev default `ws://127.0.0.1:8080`, `?server=` in test/dev builds, "no URL in prod" flag for hiding entry. Tests: link table tests, blocked storage, per-tab token, `nodearena:save` byte-unchanged.
Done when: those unit tests pass.

## Task 3 — [M1] PvpConnection
What it is: WS layer (R8 basic, R11) over an injectable `WebSocketLike`.
What changes: states connecting/connected/reconnecting/lost/refused; hello on every open; backoff 0.5-8 s with +-20% injected jitter, give up ~60 s to `lost` with manual Retry; no reconnect on close 4000 or `version-mismatch`; frames via net `parseServerMessage`, sends via net `encode`; malformed frames ignored. Tests with fake socket and fake timers.
Done when: hello, backoff schedule, no-reconnect and malformed-frame tests pass.

## Task 4 — [M1] NetDriver (live stepping)
What it is: server-paced `MatchDriver` (D1, D4, D5, D6).
What changes: owns the sim; `LockstepClient` fed from the socket handler, not rAF; per-frame drain of 1-2 live steps; `client.after` hash message sent (every 20th tick); `alpha` clamped, held at 1 when queue empty; `submit` sends `cmd` without `player`/tick; ignores `document.hidden`; no pause/speed. Tests with fake client/clock: steps only on pushed ticks, never pauses hidden, hash cadence, submit shape, alpha clamp. No determinism leaks (no Date/random into sim).
Done when: NetDriver unit tests pass.

## Task 5 — [M1] PvpController: connection, lobby, start
What it is: separate state owner (D2) with `snapshot/subscribe/subscribeEvents` shape matching AppController.
What changes: state machine idle -> menu -> connecting -> lobby -> countdown; actions create/join/ready/start/leave/retry; maps `welcome`, `room.joined`, `lobby.state`, `error{code}` (code -> user string table); holds nick/token; `ready` toggle for non-host. Tests with fake connection: transitions, error strings, leave resets.
Done when: controller lobby-flow tests pass.

## Task 6 — [M1] PvpController: match lifecycle + end
What it is: R3 match start and R6 server-sourced result plumbing (D9, D10).
What changes: on `start` build sim from client content by `levelId`, `seed`, `teams` (check `simHash`), create NetDriver and runtime with generation-token pattern, "Get ready" countdown from `countdownMs`; handle `seat.status`, `end`, `desync` (toast event, console log of tick+hashes, R9), `room.closed`; result emitted after local `finalTick` or 3 s after `end`; console error if local `view.over` disagrees with `end`. Audio event source via `subscribeEvents` (verify `audio/app.ts` accepts it, else widen). Tests: playing -> result, 3 s fallback, desync event.
Done when: lifecycle tests pass with fake NetDriver/runtime.

## Task 7 — [M1] PvP menu, 2-seat lobby, App/main wiring
What it is: R1 (create/join) and R2 (2 seats, Duel S, ready + start).
What changes: main-menu "Play online" (hidden when no server URL in prod), `PvpMenu` (nick 1-20, create, code input, join), `Lobby` with `SeatRow`, code, ready, start with disabled-reason text, connection state chip; `PvpLayer` in `App.tsx` when screen != idle, `arena.hidden` considers pvp, construct controller in `main.tsx`; reuse Picker panel styles and testids `pvp-play`, `pvp-nick`, `pvp-create`, `pvp-code-input`, `pvp-join`, `lobby-code`, `lobby-seat-<i>`, `lobby-ready`, `lobby-start`, `conn-state`. Component tests (sp08 pattern).
Done when: menu-to-lobby flow renders and solo picker still returns on Leave.

## Task 8 — [M1] PvpHud (ownership bar, timer, Esc leave) + toast
What it is: R3 bar+timer, R4 input rules, R9 toast.
What changes: `PvpHud` with N-color ownership bar (colors from `colorKey`), `match-timer` from `timeLimitTicks`, no pause button, Esc opens non-pausing menu with Leave only; Toast with `toast-desync`; runtime gets `seat` (spectator `null` shows "Spectating" badge). Tests: timer, no pause control, Esc menu, toast.
Done when: component tests pass.

## Task 9 — [M1] PvpResult (win/lose)
What it is: R6 M1 slice.
What changes: result popup from server `end` outcome (Victory/Defeat per seat), same panel style as BattlePopup, Leave button, `pvp-result` testid, presentation delay as today. N-seat/draw/rematch deferred to Task 15.
Done when: tests render winner vs loser from `end` and Leave returns to the menu.

## Task 10 — [M1] Test hooks + two-tab acceptance + campaign regression
What it is: SP06 contract and R12.
What changes: `window.__na.screen`, `view/submit/hash` re-pointed to active NetDriver in netplay, `window.__na.pvp` API (state, actions, tick, hash, queued, submit, connection, setServer), `?nick=` and `?server=` in test builds, remaining stable testids for M1 screens; tests for hook gating. Run the two-tab play against the local server (equal `__na.hash()` at tick 200, per-seat result) and the campaign gates.
Done when: `pnpm test`, `test:web:e2e`, `campaign:verify`, `typecheck`, `lint` green and two-tab hash matches.

## Task 11 — [M2] Full lobby (maps, seats, teams, share links)
What it is: R2 complete.
What changes: map cards from `listPvpMaps` (`lobby-map-<levelId>`), host controls for seat kind human/bot/empty, bot difficulty, team (`seat-kind/-difficulty/-team-<i>`), non-host read-only + Ready, share play/watch links with copy buttons, spectator count; render `lobby.state` as sent. Amended 2026-10-29: Start-disabled reasons include a human seat not connected / reserved; reserved seats show not-connected from `lobby.state`.
Done when: component tests for host vs non-host controls, Start disabled reasons, link copy pass.

## Task 12 — [M2] Seat legend + team-grouped bar
What it is: R3 legend, multi-seat visuals, Decision 11 (legend only).
What changes: `seat-legend-<i>` with color dot, nick, team badge (not color-only), "you", eliminated/bot/disconnected status (source: `pause.state` holds + lobby occupant state + sim elimination; `seat.status away/forfeit` chips only if SP07 adds them); ownership bar groups same-team adjacent segments with thin gap.
Done when: 4-seat team legend test passes.

## Task 13 — [M2] Catch-up budget + overlay
What it is: R5.
What changes: NetDriver catch-up mode when queued > 6: time-boxed ~8 ms stepping with `events:false` (events for last 2 steps), progress `tick/(tick+queued)`; "Catching up N%" overlay (`catchup-progress`) for join, reconnect, background-return; handles `catchup` messages via net helper or same loop. Amended 2026-10-29: the overlay is also the reconnect catch-up UI (SP07 recreates sim + `LockstepClient(0)` + runtime on repeated `start` for the same `matchId`). Tests with fake clock: budget respected, resumes live without gap.
Done when: budget and progress tests pass.

## Task 14 — [M2] Watch mode + deep links
What it is: R1 watch, R10.
What changes: `watch` action, spectator seat `null` with input disabled and badge; `openLink` after `app.boot()` using `parseRoomLink` (nick prompt if missing, `&watch`), invalid code error then menu, params cleaned on leave; `pvp-watch` testid.
Done when: tests for deep-link flow incl. invalid code pass; spectator hash equals players' in two-client run.

## Task 15 — [M2] N-seat/draw result, rematch, connection banners
What it is: R6 full, R7, R8 basic.
What changes: placement table (`result-placement-<i>`, nick, team, buildings, troops), Draw and team-win and spectator "X won" variants, Rematch (`pvp-rematch`) returning to lobby on `lobby.state`; `ConnBanner` for reconnecting/lost (Retry)/refused, terminal messages for close 4000 ("Opened in another tab") and `version-mismatch` ("New version: reload"). Amended 2026-10-29: "A bot took your seat" banner dropped (bot takeover superseded by SP07); rematch resets pause budgets (server, SP07).
Done when: component tests for N-seat, draw, rematch new seed, banners pass.

## Task 16 — [M3] Reconnect resume + seat reclaim UX
Superseded in part by SP07 (2026-10-29): minimum mid-match reconnect (same token, catch-up rebuild, runtime recreation, auto-resume of disconnect holds, stored result after `end`) moved to M2 under SP07; seat-in-grace chip, bot reclaim flow and seat-reclaim-after-bot are void. Remaining M3: polished reconnect UX/status chips beyond the basic banner. SP04#19 dependency is superseded (no server work to wait on).
What it is: R8 M3 (polish only).
What changes (remaining): reconnect status polish on top of the SP07 basic flow (shown state, richer chips for other seats' away state); original text (re-handshake, rebuild via catch-up, runtime recreation) is delivered by SP07 in M2.
Done when: polish items per PRD M3 pass; basic kill-socket resume with equal hash is covered by SP07.

## Task 17 — [M3] Desync auto-resync (runtime recreation)
What it is: R9 M3.
What changes: on `desync`, toast then dispose client+sim, fresh `create(level, seed, {teams})`, new client, full catch-up, recreate runtime (controller owns it).
Done when: forced desync converges to server hash in a test.

## Task 18 — [M3] Acceptance sweep + doc notes
What it is: closes M2/M3 acceptance criteria (pause/quit/reconnect acceptance is SP07's).
What changes: fill gaps in tests against PRD acceptance list; short web netplay notes in existing docs where the doc gate requires. No new features.
Done when: all gates green.
