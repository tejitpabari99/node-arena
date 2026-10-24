---
status: draft
summary: 5 tasks - levels gate fix, na-kane content + version/lock/golden chain, ?kane=1 boot with prod exclusion, e2e + exclusion gate, final evidence run
date: 2026-10-24
---
# Tasks: 01 Kane level and boot
Source of truth: docs/agent_files/feat-kane-hackday-20261023-2128/01-kane-level/PRD.md. No [OPEN] items; [RESOLVED] items are binding, [DEFERRED] items appear only as rehearsal checks. Order follows AGENTS.md: gate fix first so content can land green, content/version/lock/golden chain in one task, then web boot.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Levels gate tolerates non-common campaign levels | none | todo |
| 2 | na-kane level, kane campaign, version bumps, locks, goldens | 1 | todo |
| 3 | `?kane=1` boot with production exclusion | 2 | todo |
| 4 | E2E specs and production-bundle exclusion gate | 3 | todo |
| 5 | Final evidence run and rehearsal checks | 4 | todo |

## Task 1 — Levels gate fix
What it is: `campaignLevels()` in the levels tooling currently throws when `data/levels` differs from the common campaign, so any new level file breaks `validate:levels`/`levels:lock` (PRD Decision 4, Gate fix).
What changes at a high level: keep returning common entries only; the mismatch check ignores files listed by any non-common campaign; truly orphan files and common entries without files still throw. Add a tools test: kane-listed file tolerated, unlisted extra file still throws. No level file is added yet.
Done when: new test passes, existing levels tests pass, `validate:levels` and `levels:lock` leave `tools/levels-lock.json` unchanged, 20 levels.

## Task 2 — na-kane content and version chain
What it is: the hidden level and its campaign, plus the mandatory identity bumps (Requirements 2-3, Decisions 1-3, 6, 8; Version/lock chain).
What changes at a high level: add `na-kane` from the approved draft (Level 7 copy, neutral tower b4, `om-*` obstacles, slow `attackOnly` bot, no `source`, key order per CONTENT_GUIDE) and `kane` campaign (single entry, position 4). Bump content 2.0.1 to 2.0.2 and BOT_VERSION 2.0.0 to 2.0.1 (rulesVersion untouched). Run `content:lock`, regenerate sim, bots and replay goldens in this same task, following tools/README.md; resolve the DEFERRED golden-flag question by running the gates.
Done when: `validate:content --base HEAD`, `check:content --base HEAD`, `check:schemas`, `check:rules`, `sim:golden`, `bots:golden`, `replay:verify golden`, `check:import`, `test` green; `common.json` and `levels-lock.json` byte-identical.

## Task 3 — `?kane=1` boot
What it is: test-build-only boot straight into na-kane in real time, no kane bytes in production (Requirement 1, Decisions 5, 7; Boot and Interface sections).
What changes at a high level: add full-relative glob negations for the two kane files in the eager content glob; add a test-only module with a second glob exposing `kaneContentFiles()`, merged into `files` in `main.tsx` for test builds; extend the test-hook request with `kane`; harness sets campaignId `kane`, isolated in-memory save, auto-starts `na-kane` with `autoStart` true; expose `__na.kane` boolean. These are the shared surfaces 02 consumes.
Done when: dev and `VITE_TEST_HOOKS=1` builds load `/?kane=1` into the playing screen on `na-kane`; no flag leaves behavior unchanged; web unit tests, lint, typecheck green.

## Task 4 — E2E and exclusion gate
What it is: the acceptance checks for Requirements 1, 4, 5 and the prod-exclusion criterion.
What changes at a high level: one e2e spec (test build): `/?kane=1` gives `screen==='playing'`, `levelId==='na-kane'`, `kane===true`; back from the level shows a one-card `kane` picker with the card unlocked; result dialog and command log work. Same spec or build check: `/` and `?kane=1` on a production build show a 20-card picker. Add a script or e2e step that greps production `dist` for `na-kane`/`Kane Arena` (expect 0) and a `VITE_TEST_HOOKS=1` build (expect >0).
Done when: spec passes via `test:web:e2e`; `campaign:verify` still 20 levels; exclusion check passes both directions.

## Task 5 — Final evidence run
What it is: re-prove winnability against the final committed level (Acceptance Criteria; level is outside `levels:lock`, so evidence is manual).
What changes at a high level: no source change unless a check fails. Re-run proxy evidence: HUMAN_PROXY wins at least once, idle human wins zero. Rehearsal checks from DEFERRED items: confirm boot HUD title is sensible for position 4; note b2 level and obstacle visibility only if tuning is wanted (tuning would loop back to Task 2).
Done when: evidence recorded in the run summary; full `pnpm run ci` chain green.

## Owner-only steps
- None in the PRD beyond decisions already recorded (na-kane excluded from `levels:lock`). Optional rehearsal tuning calls (b2 level, bot delay 20000, bigger obstacle, Kane-mode title) are owner decisions.
