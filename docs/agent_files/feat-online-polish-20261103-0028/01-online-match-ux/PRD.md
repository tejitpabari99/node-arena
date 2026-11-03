---
status: approved
summary: Online pause popup gains Leave (confirm, then forfeit) and the match timer; end screen becomes a rank-less aligned table; online "hard" bot preset softened from 700 ms to 1000 ms action delay. No rules change.
date: 2026-11-03
---
# PRD: SP01 Online match UX
Repo/branch: node-arena / `feat/online-polish` · Depends on: none · Consumed by: SP04 (runs after 01+02; resets all versions), SP03 (doc deltas only). Execution order: 01 ∥ 02 -> 04 -> 03.
Owns: `apps/web/src/ui/pvp/PvpHud.tsx`, `apps/web/src/ui/pvp/PvpLayer.tsx`, `apps/web/src/ui/pvp/PvpResult.tsx`, PvP block of `apps/web/src/style.css`, `packages/bots/src/difficulty.ts`, web unit tests `apps/web/test/pvp/{hud,result,controller}.test.ts`, PvP e2e `apps/web/e2e-pvp/{pause-forfeit,spectator-rematch}.spec.ts`. Shared with SP02: `apps/web/src/style.css` only (disjoint rule blocks; no other overlap).

## TL;DR
- Pause popup (online) gets a **Leave** button -> existing "Quit match?" confirm -> existing server forfeit. Works for bot and human rooms.
- Pause popup shows **Time left m:ss** when the level has a time limit.
- End screen: real `<table>`, one row per team, no rank numbers: `Team 1 (tejit) | 13 buildings | 684 troops`; eliminated teams show `Eliminated` instead of counts, dimmed.
- Online `hard` bot: `actionDelayMs` 700 -> **1000**. Campaign unaffected.
- No `RULES_VERSION` bump, no sim/net/server protocol change. `BOT_VERSION` bump not required (see D5/D6). If any gate nonetheless demands a bump, take the normal bump per repo rules so the commit passes gates; SP04 later resets everything to 1.0.0.

## Problem
- Pause popup lists holds + Resume only; Leave exists only in the separate Esc "Menu" popup [verified: PvpHud.tsx Paused `BattlePopup` has no leave; `pvp-leave` only in `Menu` popup].
- Timer only on the HUD bar (`data-testid="match-timer"`), hidden behind the popup's backdrop context [verified: PvpHud.tsx `formatTimer(ticksLeft)` in `.battle-level`].
- End screen prints rank + nick + `Team N` + counts + ` out` as unaligned spans in an `<ol>` [verified: PvpResult.tsx `result-placements`; no table CSS in style.css].
- `hard` bot acts every 700 ms vs normal 1500 ms (2.1x action rate) [verified: difficulty.ts `preset(700)`].

## Goals / Non-Goals
Goals: owner decisions 1-4 for online play; reuse existing forfeit path; keep testids stable where possible.
Non-goals: Credits removal (SP02); campaign pause/bots; rules/sim changes; new difficulty tiers or lobby UI changes; docs restructure (SP03).

## Requirements
| # | Requirement |
|---|---|
| R1 | Pause popup renders **Leave** (`data-testid="pvp-pause-leave"`) for any seated, non-eliminated player (`seat!==null && !eliminated`), whether or not they own the hold. Spectators/eliminated: no button. |
| R2 | Leave -> same confirm as today (`Quit match?` / "Leaving forfeits the match."; Yes, forfeit / No). While confirm is open the Paused popup is not rendered; **No** returns to the Paused popup (still paused); **Yes** sends `{t:'quit'}`. |
| R3 | Quit works while paused: server `control()` has no paused guard on `quit`; `pause.quit` drops the seat's hold and adds a pending Forfeit [verified: match.ts:230-255, pause.ts:240-249]. A paused game with a quitting last-human-holder therefore unfreezes only if other holds remain; otherwise terminal forfeit closes the frozen tick immediately. |
| R4 | Pause popup shows `Time left <m:ss>` (`data-testid="pause-timer"`) iff `timeLimitTicks>0`; value = existing `formatTimer(ticksLeft)`; frozen while paused (tick is frozen). Omitted otherwise. |
| R5 | Result list is a `<table class="result-table">` with columns: Team (label), Buildings, Troops. No rank column/number. Row order = existing ranking order (rank 1 first). Label = `Team N (nick1 & nick2)`. |
| R6 | Eliminated team row (`eliminatedAt!==null`): counts cells replaced by one cell `Eliminated` (colspan 2), row dimmed. Counts for survivors: `13 buildings`, `684 troops` (singular `1 building`/`1 troop`). Winners' rows bold; rows keep `data-testid="result-placement-{i}"`. |
| R7 | `BOT_PRESETS.hard.actionDelayMs` = 1000 (easy 3000, normal 1500 unchanged). |

## Architecture
- **Pause Leave.** `PvpHud` gets prop `canLeave` and reuses `onLeave`, which `PvpLayer` already maps to `leaveNeedsConfirm -> setConfirm(true)`. Render `pvp-pause-leave` inside the Paused `BattlePopup`; gate the Paused popup with `!confirmQuit`. No new net messages; `pvp.quit()` unchanged [verified: controller.ts:417 `quit()` only needs screen playing/countdown + seat].
- **Pause timer.** `PvpHud` already receives `ticksLeft`; pass a `hasLimit` boolean from `PvpLayer` (`s.start.timeLimitTicks>0`) -> no new data plumbing.
- **Multi-seat semantics ("opponent wins").** Server: forfeited seat is eliminated; `terminalNow = aliveTeams()<=1` over ALL seats incl. bots [verified: pause.ts:102]. Result:
  - 1v1 human vs bot/human, or 2 teams total: leaver's team out -> terminal -> `victory` for the other team; both clients get `end`.
  - FFA/3+ teams: match **continues** among the rest (sim elimination per R-FFT-03); leaver sees "leave directly" semantics afterward (`leaveNeedsConfirm` false once eliminated). Teammates of a leaver stay in; leaver's team does not lose until all its seats are out (R-FFT-03).
  - Last human leaves an FFA with 2+ bot teams: bots keep playing a match nobody watches until time limit/hard cap (existing behavior; see Open Questions).
- **Quit-yes UX.** After `pvp.quit()` the leaver stays on the battle view until `end` (terminal) or elimination appears in the next tick; on non-terminal, popup closes and normal "eliminated" HUD shows with Leave available. Not changed by this SP.
- **Result table.** `PvpResult` maps `Placement` (`team, seats, rank, buildings, troops, eliminatedAt` [verified: sim/types.ts:11]) to table rows; `rank` ignored by UI but kept in data. CSS: `.result-table{border-collapse:collapse;width:100%}`, `td:first-child` left-aligned label, numeric cells right-aligned with `font-variant-numeric:tabular-nums`, `.result-table .out{opacity:.55}`. Remove unused `.rank/.out` span rules if any (none exist in style.css today [verified: grep]).
- **Bot preset.** One-line change in `difficulty.ts`; consumed only by `match.ts:111` via `BOT_PRESETS[difficulty]` [verified: grep BOT_PRESETS -> match.ts, index.ts]. Campaign bots use inline per-level `bot` blocks, not presets. Phase-randomization and tie shuffle (2.6.0) are untouched.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Pause Leave gating | all seated non-eliminated players | only hold owner | Owner asked "like campaign pause has Levels/leave"; a bystander in a human-pause should still be able to bail. |
| D2 | Quit while paused | reuse existing `quit` | new `leave-paused` message | Server already supports it; zero protocol churn. |
| D3 | Eliminated display | `Eliminated` text replaces counts, dimmed | `0 buildings 0 troops out`; strike-through | Counts are meaningless (0/0); one explicit word is cleaner and screen-reader friendly. |
| D4 | Result markup | semantic `<table>` | CSS grid on `<ol>` | Real tabular data, alignment for free; testids preserved on `<tr>`. |
| D5 | Bot softening | `hard` 700 -> 1000 ms in shared preset | add separate "online" preset; change aggression/targeting in tw-ai.ts; remove hard | Presets are online-only already, so no new tier needed. Delay is the only knob; `decideDefault` is a timer gate (tw-ai.ts:132), so 1000 ms keeps hard clearly > normal (1500, 1.5x) yet < 2.1x human proxy pressure. Algorithm edits would need golden regen + BOT_VERSION and risk the PvP balance gate. |
| D6 | Version bumps | none expected; normal bump per repo rules if a gate requires one (SP04 resets all to 1.0.0 later) | patch `BOT_VERSION` | `BOT_VERSION` gates the resolved *level* bot hash map; presets are not in it and not in `bots.json` golden [verified: grep actionDelayMs in golden -> only level blocks]. Confirm via `pnpm check:content --base HEAD` (no lock change expected). |

## Risks / Open Questions
- Last human leaves FFA with 2+ bot teams -> unwatched bot match runs to time limit. [DEFERRED: rooms already tolerate this; consider server "no surviving humans -> end" in FUTURES]
- 1000 ms may still feel hard (or too easy). [RESOLVED: owner accepted hard `actionDelayMs` 1000; retune later after playtest (single constant)]
- Pause popup and Esc "Menu" popup can coexist (Esc while paused). [RESOLVED: Esc handler unchanged; confirm hides both; Menu popup kept]
- Existing e2e `Quit asks to confirm` uses `pvp-leave` via Esc menu [verified: pause-forfeit.spec.ts:50,58]. [RESOLVED: keep `pvp-leave` + `pvp-quit-*` ids; add a new test via `pvp-pause-leave`]
- `hud.test.ts` asserts "Esc menu offers Leave only" and the Paused structure; `result.test.ts` asserts row spans. [RESOLVED: update both; listed under tests below]
- Doc deltas for SP03: `docs/PVP_OPS.md`/player docs: pause Leave, end table; `docs/LEVELS_GUIDE.md` note `hard`=1000 ms (it mentions BOT_VERSION 2.6.0 only). `GAME_RULES.md`: none.

## Tests to update/add
- `apps/web/test/pvp/hud.test.ts`: add pause-Leave present/absent (spectator, eliminated), timer present/absent, popup hidden under confirm.
- `apps/web/test/pvp/result.test.ts`: table rows, no rank text, `Eliminated` row, pluralization.
- `apps/web/e2e-pvp/pause-forfeit.spec.ts`: new case pause -> Leave -> Yes -> both see result (leaver Defeat); `spectator-rematch.spec.ts` keeps `result-placement-0`.
- `packages/bots`/server: add one unit asserting `BOT_PRESETS.hard.actionDelayMs===1000`.

## Acceptance Criteria
- Paused (human or bot room): Leave visible to seated player; No returns to Paused; Yes ends the 1v1 for both sides (leaver Defeat, other Victory).
- Time-limited level: pause popup shows frozen `Time left`; unlimited level: absent.
- Result screen has no rank numbers; columns align at 360 px and desktop; eliminated team shows `Eliminated`.
- `BOT_PRESETS.hard.actionDelayMs===1000`; `pnpm bots:golden`, `pnpm check:content --base HEAD` unchanged/green; no `RULES_VERSION`/`BOT_VERSION` diff.
- `pnpm lint typecheck test`, `pnpm test:server`, `pnpm test:pvp:e2e` green.
