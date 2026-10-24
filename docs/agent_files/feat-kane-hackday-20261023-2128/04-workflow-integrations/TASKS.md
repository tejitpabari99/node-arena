---
status: draft
summary: 6 tasks - Stop hook, hook install/demo docs, assurance excerpt, assurance pipeline script, assurance run + cover snapshot, non-blocking CI replay workflow.
date: 2026-10-24
---
# Tasks: 04 Workflow integrations (Stop hook, assurance, CI)
Source of truth: docs/agent_files/feat-kane-hackday-20261023-2128/04-workflow-integrations/PRD.md. Builds on 03 (replay.mjs, saved tests with committed output dirs, kane:credits) and 02's final panel strings. No GAME_RULES or RULES_VERSION change; no `.claude/` files added.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Stop hook script | 03 | todo |
| 2 | Hook install example + README/demo | 1 | todo |
| 3 | Assurance excerpt + UI facts | 02 (final strings) | todo |
| 4 | Assurance pipeline script | 3, 03 (kane:credits) | todo |
| 5 | Assurance run + cover snapshot | 4, 03 (saved tests) | todo |
| 6 | Non-blocking CI replay workflow | 03 | todo |

## Task 1 — Stop hook script
What it is: opt-in hook that feeds Kane replay failures back to Claude (R1; Decisions 1-4).
What changes: new `kane-verify.sh` under `tools/kane/hooks/`. Flow in order: loop guard (`stop_hook_active` true -> exit 0); missing jq/kane-cli/node -> note, exit 0; MANDATORY fast path (empty `git status` on `apps/web`, `KANE_WATCH` override, or diff hash equal to last PASSED state cached in TMPDIR); rebuild `build:test` if `dist-test` stale/missing (failure -> exit 2, last 30 lines); `replay.mjs --serve` with exit map 0 record+exit 0 / 1 exit 2 with test, status, reason, session dir and evidence-serve hint / 2 "skipped" exit 0. Env: `KANE_HOOK_LOG`, `KANE_HOOK_FORCE`, `KANE_HOOK_NOBUILD`; `KANE_TIMEOUT` passed through (default 120, never lowered). Never calls authoring commands.
Done when: PRD hook acceptance cases pass (forced run exits 0 under 180 s, balance delta <= ~3 credits; guard exits 0 under 1 s; no web changes -> no kane-cli call; changed button word -> exit 2 with named failure; preview/auth failure -> exit 0 "skipped"; tree left clean).

## Task 2 — Hook install example + README/demo
What it is: owner-facing install and demo material (R1 Install, Decision 5).
What changes: `settings.example.json` (Stop entry, command via `$CLAUDE_PROJECT_DIR`, `timeout: 360`) and `hooks/README.md`: install steps, env vars, per-session credit cost formula (Stops with changed `apps/web` diff x ~1-3 credits), why 4173/preview not 5173, and the demo script (ready -> go edit, fail, fix, pass). Demo file/word taken from what 02 actually shipped (O5). Rehearse the demo once.
Done when: `jq .` validates the example; README matches shipped strings; `git status` shows no `.claude/settings*` change; one rehearsal confirms fail-then-pass arc (~1-2 min per hook run).

## Task 3 — Assurance excerpt + UI facts
What it is: generated rules input plus hand-written panel facts (R2 input; Decision 6; A-1).
What changes: `build-excerpt.mjs` extracting verbatim `### R-LIN-01..05` and `### R-WIN-01..03` blocks from GAME_RULES by heading regex, appending `ui-facts.md`. `ui-facts.md` rewritten from 02's SHIPPED strings (`/?kane=1`, group header, three button states, alert banner, Victory/Defeat dialog, Game over banner, WebGL not DOM). Add .gitignore lines for assure scratch (`.context/`, `output-*/` under assure, as needed).
Done when: `run.sh excerpt`-equivalent output has `grep -c '^### R-'` = 8 plus the appendix; appendix strings verified against 02's code; GAME_RULES unchanged.

## Task 4 — Assurance pipeline script
What it is: staged driver for the Kane assure flow (R2 pipeline table).
What changes: `run.sh <stage>` with stages excerpt, ingest, extract, review (refs from `context list --json`), design (per use-case, `--max 3`), testrun (`--agent --no-adaptive-heal`, needs preview on 4173 `--serve`-style), cover (`cover gaps` then `cover`). Runs with cwd `tools/kane/assure/`, all calls `</dev/null`, `--mode agent`. Credit floor: abort when balance < 200 via `pnpm kane:credits`. Optional `kane:assure` root script, added only after 03's script edits land.
Done when: stages invoke the verified CLI forms; floor check blocks a simulated low balance; excerpt/ingest (0 credits) run clean.

## Task 5 — Assurance run + cover snapshot
What it is: execute pipeline through `cover` and commit evidence (R2 demo result; O3).
What changes: run stages in order (~150 credits target, <= 200 total); confirm where `design tests` writes files and the `context list --json` ref format (deferred checks); run `cover gaps`; commit snapshot `cover-<date>.txt` and designed tests/context export. If budget tight, cut per brief: drop testrun, keep `cover gaps` from designed tests. "Owed" win/lose use-cases acceptable.
Done when: `cover gaps` shows designed > 0; snapshot committed; credits spent <= 200 and floor respected.

## Task 6 — Non-blocking CI replay workflow
What it is: `kane-replay.yml` proving replay on a clean runner (R3; Decisions 7, 8).
What changes: new workflow following ci.yml/balance.yml conventions (pinned SHAs, Node 22, frozen install, `build:prerequisites`, `contents: read`, Playwright Chromium + `KANE_CLI_CHROME_PATH`). Triggers: dispatch + PR path filter; per-ref concurrency cancel. Job `continue-on-error`, 20 min. Steps: `npm i -g @testmuai/kane-cli@0.9.0`; creds gate (empty `LT_*` -> summary "skipped", green); login via flags, secrets only via `env:`; `build:test`; `pnpm kane:replay -- --serve`; replay exit 2 -> "infra", green; always upload `kane-artifacts` (7 days) and write pass/fail table. Verify `.testmuai/` is gitignored and `output-<stem>/` committed (03 owns).
Done when: `actionlint` clean; dispatch run uploads artifacts and is non-red without secrets; with secrets, replay exit 0 (confirms login non-TTY and fresh-checkout replay, O4); not set as required.

## Owner-only steps
(a) `npm i -g @testmuai/kane-cli` + `kane-cli login` on hook/assurance machines; (b) add repo secrets `LT_USERNAME`, `LT_ACCESS_KEY`; (c) merge `settings.example.json` into `.claude/settings.local.json`; (d) keep `Kane replay` out of required checks; (e) confirm/top up credits for assurance (~150).
