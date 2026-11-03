---
status: draft
summary: 3 tasks: soften online hard bot, pause popup Leave + timer, aligned rank-less result table
date: 2026-11-03
---
# Tasks: SP01 Online match UX
Source of truth: docs/agent_files/feat-online-polish-20261103-0028/01-online-match-ux/PRD.md. No [OPEN] items. No rules, sim, net or server protocol change; no RULES_VERSION/BOT_VERSION bump expected.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Soften online hard bot preset | none | todo |
| 2 | Pause popup: Leave + match timer | none | todo |
| 3 | Result screen as aligned table | none | todo |

## Task 1 — Soften online hard bot preset
What it is / what it means: Online `hard` bot acts every 700 ms (2.1x normal rate); owner wants it gentler. Covers D5, D6, R7.
What changes at a high level: `BOT_PRESETS.hard.actionDelayMs` goes 700 to 1000 in the bots difficulty module. Easy/normal and campaign per-level bot blocks untouched. Add one unit test asserting the value.
Done when: unit test passes; `pnpm bots:golden` and `pnpm check:content --base HEAD` unchanged/green; no RULES_VERSION/BOT_VERSION diff (if a gate demands a bump, take the normal bump).

## Task 2 — Pause popup: Leave + match timer
What it is / what it means: Online pause popup gains a Leave button feeding the existing "Quit match?" confirm and server forfeit, plus a frozen "Time left m:ss". Covers D1, D2, R1–R4.
What changes at a high level: PvpHud/PvpLayer pass `canLeave` (seated, non-eliminated) and `hasLimit` (time limit > 0) into the Paused popup. Popup renders `pvp-pause-leave` and `pause-timer`, and is hidden while the confirm is open; No returns to Paused, Yes sends the existing quit. Esc Menu popup and `pvp-leave`/`pvp-quit-*` ids kept. Update hud tests (button present/absent for spectator and eliminated, timer present/absent, hidden under confirm). Add e2e: pause, Leave, Yes, both see result (leaver Defeat); keep existing quit test.
Done when: lint, typecheck, test, `pnpm test:pvp:e2e` green; acceptance criteria for pause behavior hold in bot and human rooms.

## Task 3 — Result screen as aligned table
What it is / what it means: End screen becomes a real table, one row per team, no rank numbers, eliminated teams shown dimmed as "Eliminated". Covers D3, D4, R5, R6.
What changes at a high level: PvpResult renders `<table class="result-table">` with Team label ("Team N (nick & nick)"), Buildings, Troops in existing ranking order; singular/plural counts; eliminated rows use one colspan-2 "Eliminated" cell; winners bold; `result-placement-{i}` testids on rows. Add result-table CSS in the PvP block (right-aligned tabular numerals, dim class) that fits at 360 px. Update result tests (rows, no rank text, Eliminated row, pluralization); `spectator-rematch` e2e still finds `result-placement-0`.
Done when: lint, typecheck, test, `pnpm test:pvp:e2e` green; columns align at 360 px and desktop (screenshot check).
