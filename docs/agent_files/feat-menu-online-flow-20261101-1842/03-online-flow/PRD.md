---
status: draft
summary: Play online becomes a guided flow (Create a room / Join a match -> Participant or Spectate), a live host room form (type, map thumbnails, players +/-, teams, seat rows) and a persisted, prefilled nickname.
date: 2026-11-01
---
# PRD: SP03 Online flow (menu, create-room form, join forms, nickname)
Repo/branch: node-arena / `feat/menu-online-flow` · Depends on: SP01 (thumbnail service, `menu-tile` styles), SP02 (variable seats, `maxPlayers`, `room.create` config, PROTOCOL 4)
Owns: `apps/web/src/ui/pvp/{PvpMenu,Lobby,SeatRow,PvpLayer}.tsx` (+ new `OnlineHome`, `JoinForm`, `RoomForm`), `apps/web/src/pvp/controller.ts`, `apps/web/src/net/identity.ts`, `apps/web/src/style.css` (pvp part), web unit tests `apps/web/test/pvp/*`, e2e `apps/web/e2e-pvp/*`.

## TL;DR
- Play online -> Home: two tiles "Create a room" / "Join a match".
- Join -> "Participant" / "Spectate" -> form: Nickname, Room code, Join.
- Create -> `RoomForm`: Nickname, Type (PvP | Team tiles), Map (thumbnail tiles), Players (+/-), Teams (+/-, Team only), seat list; button "Create room". After it succeeds the same form is the live host lobby (code, copy links, Start); joiners fill "Open" rows.
- Nickname: persisted on every change, prefilled in every form.

## Problem
- `PvpMenu` mixes nickname, create, code, Join and Watch on one screen [verified: PvpMenu.tsx]; create sends bare `room.create` and the host edits map/seats afterwards in `Lobby` [verified: controller.ts:413, Lobby.tsx].
- Map picker shows names + `m.seats` text [Lobby.tsx map-list]; seat dropdowns offer Human/Bot/Empty with team dropdown always shown.
- Nickname already persists (`createIdentity.setNick` -> `localStorage['nodearena:pvp']` = `{v:1,nick}` [verified: identity.ts]) and prefills `PvpMenu` via `state.nick`, BUT `sanitizeNick` trims on every keystroke so the controlled input swallows a trailing space (cannot type "a b"), and nothing else asks for a nick yet.

## Goals / Non-Goals
Goals: owner items 3, 4, 6. Non-goals: server/rules changes (SP02); kick/seat assignment; difficulty UX beyond a per-bot select; mobile-specific layout beyond existing 640px min-width.

## Requirements
**Navigation.** Controller menu views: `home | join-role | join-form(role) | create`. Back returns one level (home Back -> main menu = `pvp.close()`). Deep link `?room=CODE&role=` (existing `links.ts`) opens `join-form` with code prefilled; with a stored nick it auto-joins as today [verified: controller.ts:425]. Test ids: `pvp-create-tile`, `pvp-join-tile`, `pvp-role-play`, `pvp-role-watch`, existing `pvp-nick`, `pvp-code-input`, `pvp-join`, `pvp-back`.
**Join form.** Nickname + Room code + Join (last control, Enter submits). Participant -> `join(code,'play')`, Spectate -> `join(code,'watch')` (labelled "Watch" on submit button too). Disabled until nick (1..20 after trim) and code non-empty.
**Create form (`RoomForm`, pre-room).**
1. Nickname.
2. Type: two `menu-tile` tiles PvP / Team (`aria-pressed`), default PvP. PvP = every seat its own team (FFA/duel). Team = team dropdowns.
3. Map: tile grid (same layout as campaign list), each tile = SP01 thumbnail (placeholder fallback), `aria-label` = map name, `title`, `aria-pressed` selected, `data-testid=map-<id>`; shows small `max N` caption (text allowed; name not required visually, but include map name as caption for usability? Owner: thumbnail instead of number; name caption is an addition -> not shown, name in aria-label only).
4. Players: number box with `-`/`+`; default 2, min 2, max = `min(map.maxPlayers, 8)`. Changing map clamps.
5. Teams (Type=Team only): `-`/`+`, default 2, min 2, max `min(4, players)`. Reducing players below teams reduces teams.
6. Seat list: row 0 "Player 1 (you)" fixed human; Team -> team select. Rows 1..players-1: label, kind select Human/Bot (default Human), bot difficulty select (easy/normal/hard, default normal) when Bot, team select when Team. Label: Human unoccupied "Open"; Human occupied nickname; Bot -> "Bot1, Bot2..." numbered by order among bot rows (renumbers when rows change).
7. Team default assignment: round-robin `i % teams`; PvP type: team = i.
8. Button "Create room" disabled until nick valid, connected-capable (`unavailable` flags as today), and (Team) at least 2 distinct teams used.
**Live room.** Press Create -> `room.create{levelId, seats}` (SP02 R5/D7); screen -> existing `lobby` screen rendering the same `RoomForm` with `live` props: nickname read-only, all other fields editable by host (each change sends one `lobby.update{levelId, seats}`), plus room code, copy play/watch links, spectator count, Start (disabled by `startBlocker`: open human rows, not-ready, disconnected, <2 teams). Joiners (Participant) see the same form read-only with their row highlighted and a Ready button; spectators read-only with "Spectating". Open human rows turn into the joiner's nickname + ready state when they join.
**Live constraints.** Players "-" is disabled while the last row is occupied by another human (hint "Seat occupied"); map change that lowers max below current players clamps rows and server moves overflow occupants to spectators (SP02 R5) -> show toast "N player(s) moved to spectators" only when occupants moved (derive from lobby diff). Editing resets ready flags (server behavior unchanged).
**Nickname.** `setNick` persists to localStorage on every input event; form keeps a local draft string (not trimmed) and persists `sanitizeNick(draft)`; validation uses trimmed length 1..20. Prefill: Join form, Create form, any future nick field read `pvp.snapshot().nick`. localStorage failures are swallowed (existing `safe`). Nick edits in a room are not allowed (connection hello binds the nick) -> field disabled.

## Architecture
- `PvpLayer` switches on `s.screen` then `s.menuView`. New controller fields: `menuView`, `createDraft` (type, mapId, players, teams, rows) kept in controller state so Back/forth and reconnect keep it; `createRoom()` builds seats from draft. Pure helper `draftToSeats(draft, mapInfo): SeatConfig[]` and `seatsToDraft(lobby)` (live round-trip) with unit tests; one source of truth in live mode is `lobby.state` (draft is only used pre-create).
- `SeatRow` refactor: props `label`, `kind`, `team?`, `difficulty?`, `locked`, `occupant`; Empty option removed from UI.
- Map tiles call `thumbs.request(id)` (SP01). `PvpMapInfo.maxPlayers` from SP02.
- `Lobby.tsx` keeps results/ready/leave/conn banners; its map-list and old seat dropdown markup are replaced by `RoomForm`. `startBlocker` unchanged (still correct) plus team-distinct check.
- `identity.ts`: unchanged storage format (`nodearena:pvp` `{v:1,nick}`); no migration.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | When the room is created | On pressing "Create room" (form first, room second) | Create on entering the screen; edit via `lobby.update` | Entering would spawn a server room (code, TTL, rate limits) for every browse/Back; owner wording "create/start action". Joiners cannot join before it exists anyway. Cost: after press, same form continues live. |
| D2 | Live form | Same `RoomForm` component for pre-room, host-live, joiner/spectator read-only | Separate Lobby seat UI | One mental model; joiners see Type/Map/Teams exactly as host set. |
| D3 | Type semantics | UI-only: PvP = identity teams, Team = explicit teams; wire carries only per-seat `team` | New `mode` field in protocol | Server already derives everything from `team`; no extra wire. Type is re-derived in joiner view: Team iff any two seats share a team. |
| D4 | Seat/row mapping | Row i == seat i; Player 1 = seat 0 host | Free ordering | Matches server (`host: 0` on create). |
| D5 | Bot difficulty | Keep a per-bot select (default normal) | Drop (always normal) | Existing server/BOT_PRESETS support; dropping regresses. Owner brief silent. |
| D6 | Decrement with occupant | Disable "-" | Kick occupant to spectators | No kick UX specified; avoids surprising ejection. |
| D7 | Nick input state | Local untrimmed draft + persisted sanitized value | Persist raw | Fixes space-swallowing; storage stays sanitized. |
| D8 | Join without nick from deep link | Show Join form with code prefilled (as before) | Auto-prompt modal | Reuses form. |
| D9 | Removing old controls | Old PvpMenu single-screen & map list/“Empty” option removed; e2e updated | Keep alongside | Single flow per brief. |

## Manual steps
- Owner visual approval of tiles/thumbnails at the end (screenshots per repo testing guidance).

## Risks / Open Questions
- e2e-pvp specs (`smoke`, `duel`, `bot-cross`, `open-match`, `version-mismatch`) drive old test ids (`pvp-create`, `pvp-watch`, lobby map ids, seat selects) [verified: grep]. [RESOLVED: rewrite via shared helper in `open-match.ts`; keep ids `lobby-start`, `lobby-ready`, `lobby-code`, `lobby-seat-N`, `seat-kind-N`, `seat-team-N`, `seat-difficulty-N` stable on new rows to limit churn]
- `ui.test.ts` covers old components. [RESOLVED: update + add draft<->seats tests]
- Thumbnails slow in the map tile grid (3 maps today). [RESOLVED: sequential service, placeholder]
- Lowering Players while Teams > players etc. combinatorics. [RESOLVED: derive clamp function, unit-tested table]
- Max players cap 8 but all maps <=4 today. [RESOLVED: cap formula in code; no 5+ map exists]
- Server restarts/drain mid-form. [RESOLVED: existing banners and `restarted` screen unchanged]

## Acceptance Criteria
- Online home shows exactly two tiles; Join path: Participant/Spectate each reach a form with Nickname, Room code, Join (Join last in DOM order).
- Create form defaults: Type PvP, first map, Players 2, rows: "Player 1 (you)" + one "Open" Human row; Team type reveals Teams box (2) + team selects; bot row labels Bot1, Bot2 in order; Players max equals map max (duel 2 -> `+` disabled; cross 4).
- Create sends one `room.create{levelId, seats}`; result lobby shows code + Start; second browser joins -> row shows its nick; Start enabled after Ready; match starts with 2, 3 (incl. bot) and 4 seats on cross.
- Nick typed with internal spaces survives; reload prefills it in Join and Create; localStorage key `nodearena:pvp` updated on each keystroke.
- Spectate joins with `role:'watch'`; Participant with `role:'play'`.
- Map tiles show thumbnails with aria-label names; no numbers.
- `pnpm test:web:all`, `pnpm test:pvp:e2e`, lint, typecheck green.
