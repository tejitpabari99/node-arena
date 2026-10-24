---
status: done
summary: All 7 tasks complete; driver, cached smoke, guarded rehearsals, full CI and final review passed.
date: 2026-10-24
---
# Tasks: 03 Kane driver and saved smoke tests
Source of truth: [PRD.md](PRD.md). Plain Node ESM, zero npm deps, under `tools/kane/`. Cross-SP: needs 02 (and 01) for `summary()`/DOM strings, and for authoring the smoke test; 04 and 05 consume the frozen CLI, NDJSON v1, exit codes, `lib/cdp.mjs send()`, and `replay.mjs`.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Pure libs + unit tests | none | done |
| 2 | CDP client and Chrome management | none | done |
| 3 | Driver loop, CLI, scripts | 1, 2, 02 | done |
| 4 | Attach-failure fallback | 3 | done |
| 5 | Replay wrapper | none (needs 02 only to run a real test) | done |
| 6 | Author and commit the smoke test | 5, 01, 02 | done |
| 7 | README and rehearsal | 4, 6 | done |

## Task 1 — Pure libs + unit tests
What it is: the side-effect-free pieces (PRD R2, R3, R5, R7, Arch unit tests; Decisions 3, 4, 8).
What changes at a high level: objective builder (phase capture/attack/cut from summary, hint wording, under 120 words, no button names), balance parser, v1 NDJSON event encoder (`v/ts/seq/type`, frozen type names), Kane line wrapper tolerant of absent `type`, accepted-move delta from two `summary()` fixtures (ignoring rejected), exit-code mapping. Plus `node:test` suite on fixtures. No Kane, Chrome, or network.
Done when: `node --test tools/kane/test` green and covers each unit above.

## Task 2 — CDP client and Chrome management
What it is: raw-WS CDP client and Chrome lifecycle (R1 flags, R2.1, R4; Decisions 1, 2, 6).
What changes at a high level: `lib/cdp.mjs` with generic `send(method, params, sessionId?)`, `getTargets`, `evaluate`, emulation; `lib/chrome.mjs` spawns Chrome on `about:blank` (never the game URL), 127.0.0.1 debug port, anti-throttle flags, 1600x900, `--headless`/`--software-gl`, `--chrome`/env binary; closes extra page targets (warn `extra_tab`), navigates the single target via CDP, waits for `__na` ready (screen, kane, levelId), applies bringToFront + `resume()` + focus emulation, and makes cleanup safe on all exit paths.
Done when: against a running test build, Chrome ends with exactly one page target, game reaches playing with `levelId` `na-kane`, and Chrome is killed on exit and on SIGINT/SIGTERM.

## Task 3 — Driver loop, CLI, scripts
What it is: `drive.mjs` implementing R1 flags and R2 loop (Decisions 2-5, 8).
What changes at a high level: full flag table with defaults; `--serve` spawns `preview:test` and kills the child process group on every exit path; sequential loop (credit check, summary read, game_over on `result`, local idle polling, one `kane-cli run` with the PRD flags and stdin null, passthrough as `kane` events, verify delta, stall counter, max-runs); `--dry-run`, `--credits-only`; exit codes with `driver_end` always emitted first; log to file and stdout. Root `package.json` gets `kane:play`, `kane:credits`; `.gitignore` gets `kane-runs/`. Win/loss keyed only to `summary().result`; Kane PASS logged, never trusted.
Done when: `pnpm kane:credits` prints `{"credits":N}`; `--dry-run` emits the PRD-listed events with zero `kane-cli run` processes; `--min-credits 99999` exits 21 before any Kane call; `--serve` leaves no orphan.

## Task 4 — Attach-failure fallback
What it is: R6 fallback.
What changes at a high level: detect cdp/endpoint/connect/ECONN on first run or two failures; emit `fallback`; switch to launch mode (no `--cdp-endpoint`, `--url`, up to 8 moves, max-steps 20); add `chrome-wrapper.sh` appending debug port 9223 and user-data-dir, with the driver attaching read-only for `summary()`; `--no-fallback` honoured; otherwise exit 22/20. Wrapper behaviour is [DEFERRED] fallback-only: verify only if attach fails in rehearsal.
Done when: forcing a port mismatch yields `fallback` or exit 22 without hanging.

## Task 5 — Replay wrapper
What it is: `replay.mjs` and `pnpm kane:replay` (R8 Replay; Decision 7).
What changes at a high level: per test, copy test plus `output-<stem>/` into a temp dir, run `kane-cli testmd run --headless --agent --no-adaptive-heal --timeout 120` with `KANE_CLI_CHROME_PATH` defaulting to Playwright chromium; `--serve` support; map exits (0 pass, 1 test fail with test/status/reason/session dir on stderr, 2 infra incl. kane 2 and 3); `.testmuai/` added to `.gitignore`. Optional `--verify-cdp` is [DEFERRED], default off.
Done when: server-down run exits 2; the working tree stays clean after a run; exit mapping unit-tested.

## Task 6 — Author and commit the smoke test
What it is: ONE smoke test, 2-3 steps, DOM-text assertions only (R8; [DEFERRED: sequencing] until 01+02 strings are frozen).
What changes at a high level: write `tests/panel_draw_cut_test.md` using 02's shipped strings (click the ready button, verify it now says `active`, optionally double-click and verify `ready`); author it with `testmd run` (headless, Playwright chromium, timeout 240, never a tight timeout); commit the test AND `output-<stem>/`. Costs about 35-50 credits (needs Kane login; owner or agent). Skip the grey-banner test.
Done when: `pnpm kane:replay` exits 0 in under 90 s, spends 3 credits or fewer (balance delta recorded), tree stays clean; a deliberately broken button text exits 1 with `action_failed`.

## Task 7 — README and rehearsal
What it is: contract docs and R9 rehearsal measurements.
What changes at a high level: `tools/kane/README.md` covering CLI, exit codes, NDJSON types, credits, replay cost, fallback, backup. Run rehearsal: build:test then dry-run; one `--max-runs 1` run compared to the screen; a full match; an unfocused-Chrome repeat and a `--mode launch` repeat. Record steps/run, credits/run, wall/match, accepted/run, which close the [DEFERRED] items (banner false-stop, `--mode action` drop if it hard-stops, steps per objective).
Done when: one real `pnpm kane:play` ends `driver_end.outcome` `won` with `game_over.result==='won'` and `__na.commandLog` showing at least one human `DrawLine`; `verify.claimMatches` logged each run; measurements written to the README.

## Owner-only steps
- `kane-cli login` on any new machine; top up credits, confirm hack-day allotment, track budget.
- Record the backup winning video (outside git), used on exit 20/22/23.
- CI only (04): set `LT_USERNAME`/`LT_ACCESS_KEY` secrets.
- Never make the repo public while `output-<stem>/` (tenant/user IDs) is committed.
