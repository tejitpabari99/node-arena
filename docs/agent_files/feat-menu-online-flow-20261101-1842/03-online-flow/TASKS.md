---
status: draft
summary: 6 tasks - nickname fix, controller nav/draft state + helpers, join flow, RoomForm pre-room, live room, e2e-pvp rewrite and final gates.
date: 2026-11-01
---
# Tasks: SP03 Online flow
Source of truth: docs/agent_files/feat-menu-online-flow-20261101-1842/03-online-flow/PRD.md. No OPEN items. Needs SP01 (thumbs, `menu-tile`) and SP02 (maxPlayers, `room.create{levelId,seats}`, PROTOCOL 4) merged on the branch first. Owner visual approval of screenshots at the end (owner-only).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Nickname draft/persistence fix | none | todo |
| 2 | Controller nav, draft state, pure helpers | 1 | todo |
| 3 | Online home + join flow (Participant/Spectate) | 2 | todo |
| 4 | RoomForm pre-room (create) | 2, 3 | todo |
| 5 | Live host/joiner/spectator room | 4 | todo |
| 6 | e2e-pvp rewrite, cleanup, final gates | 3, 4, 5 | todo |

## Task 1 — Nickname draft/persistence fix
What it is: fix swallowed trailing space; persist on every keystroke.
What changes: `identity.ts`/forms keep a local untrimmed draft string, persist `sanitizeNick(draft)` each input event, validation by trimmed length 1..20; storage key/format `nodearena:pvp` `{v:1,nick}` unchanged; localStorage failures swallowed.
Done when: unit test types "a b" and keeps it; storage updated per keystroke; `pnpm test lint typecheck` green.

## Task 2 — Controller nav, draft state, pure helpers
What it is: state machine and logic without UI.
What changes: controller `menuView` (`home | join-role | join-form(role) | create`) with Back one level (home Back -> `pvp.close()`); `createDraft` (type, mapId, players, teams, rows) in controller state; pure `draftToSeats(draft, mapInfo)`, `seatsToDraft(lobby)`, clamp function (players max `min(maxPlayers,8)`, teams `min(4,players)`, round-robin teams, PvP identity teams, Bot1.. numbering), type re-derivation (Team iff two seats share a team); `createRoom()` sends `room.create{levelId, seats}`; deep link `?room=&role=` opens join-form with code prefilled, auto-join with stored nick as today.
Done when: unit tests for helpers incl. clamp table and draft<->seats round trip; `pnpm test lint typecheck` green.

## Task 3 — Online home + join flow
What it is: `OnlineHome` (two tiles: Create a room / Join a match), role chooser, `JoinForm`.
What changes: `PvpLayer`/`PvpMenu` replaced by screens per `menuView`; test ids `pvp-create-tile`, `pvp-join-tile`, `pvp-role-play`, `pvp-role-watch`, `pvp-nick`, `pvp-code-input`, `pvp-join` (Join last in DOM), `pvp-back`; Participant -> `join(code,'play')`, Spectate -> `'watch'`; submit disabled until nick and code valid; Enter submits; nick prefilled; menu-tile styles from SP01.
Done when: component tests show exactly two home tiles and form field order; `pnpm test lint typecheck test:web:e2e` green.

## Task 4 — RoomForm pre-room (create)
What it is: `RoomForm` in pre-room mode, with `SeatRow` refactor.
What changes: Nickname; Type tiles (PvP/Team, `aria-pressed`); Map thumbnail tiles (`data-testid=map-<id>`, aria-label name, no visible name/number, `thumbs.request`); Players +/-; Teams +/- (Team only); seat rows (row 0 "Player 1 (you)", Human/Bot select, difficulty select when Bot, team select when Team; Empty option removed; stable ids `lobby-seat-N`, `seat-kind-N`, `seat-team-N`, `seat-difficulty-N`); "Create room" disabled until nick valid, not unavailable, and (Team) >=2 distinct teams.
Done when: defaults match PRD acceptance (PvP, first map, 2 players, Open human row; duel `+` disabled, cross max 4); `ui.test.ts` updated; `pnpm test lint typecheck` green.

## Task 5 — Live host/joiner/spectator room
What it is: after Create, same `RoomForm` with `live` props rendered inside `Lobby`.
What changes: nick read-only; host edits send one `lobby.update{levelId, seats}` each; room code, copy play/watch links, spectator count, Start (via `startBlocker` + distinct-team check); joiners see read-only form with own row highlighted and Ready; spectators "Spectating"; Open rows show joiner nick/ready; "-" disabled with hint while last row held by another human; toast "N player(s) moved to spectators" from lobby diff; old map list/seat dropdown markup removed; results/ready/leave/banners kept.
Done when: unit tests for diff toast and "-" lock; `pnpm test lint typecheck test:web:all` green.

## Task 6 — e2e-pvp rewrite, cleanup, final gates
What it is: update Playwright PvP suite to the new flow.
What changes: shared helper in `open-match.ts` drives home -> create/join; rewrite `smoke`, `duel`, `bot-cross`, `open-match`, `version-mismatch` for new test ids; cover matches with 2, 3 (incl. bot) and 4 seats on cross, nick with spaces surviving reload, `role:'play'`/`'watch'`; remove dead PvpMenu/Empty code (D9).
Done when: `pnpm test:pvp:e2e`, `pnpm test:web:all`, `pnpm test:server`, `pnpm test:net`, `pnpm lint typecheck test` green; screenshots captured for owner approval.
