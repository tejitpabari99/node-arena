---
status: draft
summary: tools/kane driver that loops Kane runs (2-3 moves each) on one persistent headed Chrome until CDP ground truth shows a result, with a stable NDJSON event schema, credit floor, stall/fallback handling, plus ONE saved Kane smoke test (DOM-text assertions only) and its replay command.
date: 2026-10-24
---
# PRD: 03 Kane driver and saved smoke tests

Repo/branch: node-arena, `feat/kane-hackday` · Depends on: 02-play-controls (and 01) · Blocks: 04 (replay), 05 (play loop, NDJSON, credits) · Brief: [brainstorm.md](../brainstorm.md) (locked)
Owns: `tools/kane/**` (new: `drive.mjs`, `replay.mjs`, `lib/*.mjs`, `chrome-wrapper.sh`, `tests/*_test.md`, `tests/*.expect.json`, `README.md`), root `package.json` scripts `kane:play`, `kane:replay`, `kane:credits`, `.gitignore` lines
Does not own: game DOM/hooks (02), level/bot (01), Stop hook / CI / assurance (04), server/stream (05)

## TL;DR
`node tools/kane/drive.mjs` owns one Chrome (`--remote-debugging-port=9222`), loads `/?kane=1`, then loops: read `window.__na.kane.summary()` over raw CDP -> stop if `result` set -> else one sequential `kane-cli run --cdp-endpoint ... --allow-missing-url --agent --max-steps 8` with a 2-3 move objective -> re-read summary and compute which moves the sim really accepted. Kane's PASS is logged, never trusted (`run_end.status` is LLM-judged) [probe: probes-20261024.md §P-KANE-P1]. Kane does NOT batch: 1 action per step (~5 s/step), so 3 actions = 4 steps (trailing wait), ~26 s run / ~42 s wall, ~9-13 credits/run [P-KANE-P1]. Everything is emitted as versioned NDJSON (05 relays it). Fallback = Kane-launched Chrome per run (long runs) then recorded video. One Kane smoke test (<=2-3 steps) is authored once (~16 credits/step observed; 2-step authoring cost 32.8) and replayed via `pnpm kane:replay` at ~0.65-2.7 credits per replay (NOT free; needs Kane login) [P-REPLAY, P-KANE-P4].

## Problem
- Kane needs ~5 s per LLM step (1 action per step, no batching) [P-KANE-P1] and cannot read `window.__na` or drag [verified: research kane-cli.md spikes]; it can only click DOM text. Ground truth must come from outside Kane, and Kane can silently false-PASS [verified: A2a/A2c].
- A run that is too long drifts (>~15 steps), one that is too short wastes launch cost; attach to a persistent Chrome is the highest-value lever [verified Probe 2 2026-10-23: `--cdp-endpoint` attach works, reuses existing tab, keeps state].
- 04 and 05 need a stable interface (command, events, exit codes, credits, replay) before the driver exists.

## Goals / Non-Goals
Goals: win na-kane unattended in one command; machine-readable log; bounded credit and wall cost; one documented fallback; a saved test that replays in CI/hook at low, documented credit cost.
Non-goals: parallel Kane sessions (1 concurrent per plan), game-side changes, streaming/server (05), hook/CI wiring (04), deterministic replay of a live match.

## Requirements

### R1 Command line (stable; 04/05 call this)
`node tools/kane/drive.mjs [flags]` (alias `pnpm kane:play -- [flags]`), plain Node >=22.13 ESM, zero npm deps (Node 22 global `WebSocket`/`fetch` for CDP; `child_process` for Chrome/kane-cli).

| Flag | Default | Meaning |
|---|---|---|
| `--url` | `http://127.0.0.1:4173/?kane=1` | game URL (test build, `preview:test`); `--seed N`/`--speed S` append `&seed=`/`&speed=` |
| `--serve` | off | spawn `pnpm --filter @node-arena/web preview:test` if the URL port is down; the child is killed (process group, SIGTERM then SIGKILL) on every driver exit path incl. signals (05 relies on this) |
| `--mode` | `attach` | `attach` (own Chrome + `--cdp-endpoint`) or `launch` (R6 fallback); auto-switches on attach failure unless `--no-fallback` |
| `--port` | 9222 | Chrome remote-debugging port (bound 127.0.0.1) |
| `--chrome` | `$KANE_CLI_CHROME_PATH` or Playwright chromium | binary |
| `--headless` | off | headless=new; use on servers (05 passes it). Headed only on an owner laptop: headed Chrome under Xvfb did not expose the CDP port [P-INFRA-Q3] |
| `--software-gl` | off | adds `--use-angle=swiftshader --enable-unsafe-swiftshader`; headless=new + these flags renders WebGL2 correctly [P-INFRA-Q3, P-RENDER]; implied by `--headless` |
| `--moves` | 3 | moves per run (2-3 recommended; N moves = N+1 Kane steps) |
| `--max-steps` | 8 | passed to Kane |
| `--run-timeout` | 150 | s, `kane-cli --timeout`; never lower than ~120 (killed runs are still billed); typical run is ~26 s, ~42 s wall [P-KANE-P1] |
| `--max-runs` | 20 | hard cap |
| `--stall-runs` | 3 | consecutive runs with zero accepted moves -> stall |
| `--idle-max` | 240 | s of local (free) waiting when no `ready` button exists |
| `--min-credits` | 200 | credit floor (R5) |
| `--log` | `kane-runs/<ts>/driver.ndjson` | file; same lines also on stdout |
| `--dry-run` | off | build objective, read state, never call `kane-cli` |
| `--credits-only` / `pnpm kane:credits` | - | print `{"credits":N}` and exit |

Library interface for 05 (`lib/cdp.mjs`): generic `send(method, params, sessionId?)` over the raw WS client (plus `getTargets`, `evaluate` helpers built on it). 03 does not allowlist; 05 wraps `send` with its own method allowlist. `chrome_ready.port` and `--headless` are stable contract.

Exit codes: `0` won · `10` lost · `11` time up · `20` stalled (caller should fall back to recorded video) · `21` credit floor or auth failure · `22` Chrome/CDP failure (both modes) · `23` page/game not ready or stuck paused · `30` max-runs hit · `1` internal error. Always emits `driver_end` first.

### R2 Loop (sequential, one `kane-cli` at a time)
1. Start/attach Chrome. Chrome is launched with `about:blank` (NEVER with the game URL as an argument: that produced a phantom second page target, Kane stalled, a 510 screenshot timeout and a false "completed" summary [P-KANE-P1]); `Target.getTargets` must show exactly one page target: close extras (warn `extra_tab`), then `Page.navigate` that single target to the URL via CDP; wait until `__na.screen==='playing'`, `__na.kane===true`, `__na.state().levelId==='na-kane'` (else exit 23).
2. Apply visibility mitigation (R4): `bringToFront` + `window.__na.resume()` before every run.
3. Credit check (R5). Read `summary()` (CDP `Runtime.evaluate`, returnByValue). `result` non-null -> `game_over`, exit by result.
4. If `pairs` has no `ready` and no `active`: local wait (poll 2 s, free) up to `--idle-max`, emit `idle`.
5. Build objective (R3), run `kane-cli run "<obj>" --cdp-endpoint http://127.0.0.1:<port> --allow-missing-url --agent --max-steps 8 --timeout 150 --mode action --assertion-mode dom --final-validation off --bug-detection off` with `stdin=/dev/null`. Flag values come from research/`--help` [verified `kane-cli run --help` 0.9.0]. The runner prints `multi_action`/`queue_actions` as ADVERTISED but there is no CLI flag to enable them: 1 action per step [P-KANE-P1]. Latency effect of mode flags is [DEFERRED: measure in rehearsal; drop `--mode action` if it hard-stops on benign banner].
6. Pass through each Kane NDJSON line as a `kane` event, wrapped as-is without assuming a `type` field: `kane-cli run --agent` step lines have NO `type` ({step, status: running|done, remark}); other lines are `stream_start`, `recording_state`, `bifurcation`, `run_end {status, summary, reason, duration, credits_consumed, result_code, reason_code, session_dir, test_url}` [P-KANE-P3]. After exit re-read `summary()`; compute delta vs step 3: accepted = new human `DrawLine`/`CutLine` rows in `human.commands` whose pair has no matching `rejected` entry; also `drawn`/`cut` counters. Emit `verify`.
7. `accepted==0` -> `stall.noProgress++` else reset. Loop to 3. Win/loss is decided only by `summary().result` (02: `won|lost|timeout`), never `run_end.status` (LLM-judged), never dialog text. Expected volume: na-kane winning path is 4 clicks (b0->b2, b0->b4, b2->b1, b1->b3) so ~2-4 runs/match [P-LEVEL].

### R3 Objective (Kane chooses each move from button text)
Template built per run from a 3-line state hint (`phase`: `capture` if any neutral target is not yet ours, `attack` after; `cut` only when `ready==0` and `active>0`). The driver does NOT name buttons or letters; it only gives strategy and semantics. Example (draw phase), kept <120 words so one step reads it:

> A game page is already open; do not navigate or reload. Make up to {moves} moves, then stop. A move = one single click on one green button in the bottom panel whose text contains "ready". Green "ready" works; red "active" is already running, do not click it; grey is unavailable, do not click it. Never click "Speed", the canvas, or anything outside the bottom panel. {phase-hint}. Each move must use a different button. If a red banner appears at the top, read it, do not retry that button, pick another green one. Stop after {moves} clicks or if no green button exists. Do not wait. Reply with the exact text of each button you clicked.

`phase-hint`: capture -> "Prefer buttons whose target is grey (neutral) with the lowest level"; attack -> "Prefer buttons whose target is red-owned"; cut -> "Double-click one red 'active' button instead to free a route; that is the only move". Rationale: steps = {moves} clicks + 1 trailing wait (3 actions = 4 steps, measured) so `--max-steps 8` has headroom [P-KANE-P1]; false-stop behaviour when a banner appears [DEFERRED: verify at runtime in rehearsal 1].

### R4 Tab visibility (02 O1) [RESOLVED: P-INFRA-Q3]
`document.hidden` pauses the driver and opens the restart popup [verified: driver/index.ts:52,90,94]. Probe result: focus emulation alone gives only ~5 ticks/s (NOT acceptable) [P-INFRA-Q3]. Final approach, all driver-side:
1. ONE tab only. Never open other tabs in Kane's browser (R2.1 closes extras).
2. Before EVERY Kane run: `Page.bringToFront` then `Runtime.evaluate("window.__na.resume()")`. 02 adds `kaneMode` auto-resume as the in-game backstop.
3. Chrome flags: `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling`, window 1600x900 (matches 02 screenshots); `Emulation.setFocusEmulationEnabled{enabled:true}` kept as an extra (insufficient alone).
4. If summary still shows paused-hidden: `bringToFront` + `resume()` once more, else exit 23.
Display: `--headless` (headless=new + SwiftShader flags) on servers; headed only on an owner laptop. Xvfb headed Chrome did not expose the CDP port, so Xvfb is not used [P-INFRA-Q3, P-RENDER]. A concurrent second CDP client (05 screencast) does not interfere with Kane [P-KANE-P2, P-INFRA-Q4].

### R5 Credits
- Read: `kane-cli balance` prints plain text `Available credits: 762.8408` (no `--agent`, free, ~2 s) [verified: ran it, balance 762.84, whoami valid]. Parse `/Available credits:\s*([\d.]+)/`; ignore other lines (update banner). `pnpm kane:credits` wraps it.
- Per run: Kane `run_end.credits_consumed` (field confirmed [P-KANE-P3]; balance delta runs 1-2 higher).  Driver logs both `creditsRun` and balance delta.
- Floor: check before start and before every run; `balance < --min-credits` (200) -> `driver_end` exit 21 (05 enforces the same floor server-side before launching; it calls `kane:credits`).
- Estimate: measured ~9-13 credits/run, ~26 s run / ~42 s wall [P-KANE-P1]. na-kane winning path is 4 clicks, so expected ~2-4 runs/match, ~25-50 credits [DEFERRED: measure in rehearsal]; keep the 150-credit per-match cap (`--max-runs`/floor). Remaining after probes: 695 credits (owner tracks budget).

### R6 Fallback when attach fails
Trigger: Kane stderr/`run_end.reason` matches `/cdp|endpoint|connect|ECONN/i` on the first run, or two such failures. Then (unless `--no-fallback`): emit `fallback{reason}`; switch to `--mode launch`: run without `--cdp-endpoint`, with `--url`, objective asks for up to 8 moves and `--max-steps 20` (no state survives between runs, so fewer longer runs; game restarts from the URL). Ground truth still needed: set `KANE_CLI_CHROME_PATH=tools/kane/chrome-wrapper.sh`, which `exec`s the real binary with `--remote-debugging-port=9223 --user-data-dir=...` appended, and the driver read-only attaches to 9223 for `summary()` [DEFERRED: fallback-only; verify only if attach fails in rehearsal — unverified that kane-cli uses the env binary without stripping args]. If that also fails: exit 22/20; manual fallback = pre-recorded win video.

### R7 NDJSON event schema (v1; 05 depends on it)
One JSON object per line, UTF-8, `\n`-terminated, written to stdout and `--log`. Common fields: `v:1`, `ts` (ISO), `seq` (monotonic), `type`. Unknown fields must be ignored by consumers; type names are frozen.

| `type` | Extra fields |
|---|---|
| `driver_start` | `args`, `mode`, `url`, `credits` |
| `chrome_ready` | `mode`, `port`, `pid`, `headless` |
| `page_ready` | `levelId`, `speed`, `letters` (from `summary().letters`) |
| `credits` | `balance`, `floor`, `ok` |
| `state` | `iter`, `tick`, `result`, `ready`, `active`, `unavailable`, `humanDrawn`, `humanCut` |
| `idle` | `iter`, `waitedS` |
| `run_start` | `iter`, `phase`, `objective`, `maxSteps` |
| `kane` | `iter`, `event` (raw Kane NDJSON object, passthrough, `type` NOT guaranteed: step lines have only `{step,status,remark}`; also `stream_start`/`recording_state`/`bifurcation`/`run_end`) [P-KANE-P3] |
| `run_end` | `iter`, `kaneExit`, `kaneStatus` (claim only), `creditsRun`, `durationMs`, `sessionDir` |
| `verify` | `iter`, `accepted:[{tick,type,from,to}]`, `rejected:[{reason}]`, `claimMatches` (bool) |
| `stall` | `iter`, `noProgress` |
| `warn` | `code` (`claim_mismatch`,`paused_hidden`,`extra_tab`,`credit_parse`,...), `msg` |
| `fallback` | `reason`, `to` |
| `game_over` | `result`, `winner`, `tick`, `humanCommands`, `drawn`, `cut` |
| `driver_end` | `outcome` (`won|lost|timeout|stalled|credit_floor|chrome|not_ready|max_runs|error`), `exitCode`, `runs`, `creditsUsed`, `wallMs` |

### R8 Saved Kane smoke test (for 04 Stop hook and CI)
- Scope: author exactly ONE smoke test, <=2-3 steps, DOM-text assertions only. Authoring a 2-step testmd cost 32.8 credits (verify checkpoints, ~16 cr/step) and the visual-analyzer assertion false-failed twice on replay [P-REPLAY, P-KANE-P4]. Exit code 1 means test fail for both a real regression and a visual false-fail, so DOM-text assertions are the only way to keep failures meaningful.
- Location: `tools/kane/tests/<stem>_test.md` (frontmatter as research `nav_test.md`: `mode: testing`, `url: http://localhost:4173/?kane=1&seed=1`, `headless: true`, tags). Candidate (after 01/02 freeze strings): `panel_draw_cut_test.md`: click the green button whose text starts `A →` and contains `ready`; verify (DOM text) that button now contains `active`; optionally double-click it and verify `ready` again (keep <=3 steps). The grey-banner test is [DEFERRED] (authoring cost). Optional sidecar `<stem>.expect.json` only for `--verify-cdp`.
- Authoring (owner or agent; needs local kane-cli auth, already logged in here): `kane-cli testmd run tools/kane/tests/<stem>_test.md --headless --agent --timeout 240` with `KANE_CLI_CHROME_PATH` = Playwright chromium (`--headless` without it exits 2) [P-REPLAY]. First run of a never-authored test authors it; `--author` re-authors. Budget ~35-50 credits. Never kill with a tight timeout (billed anyway). Commit the test AND its `output-<stem>/` dir (required for replay; contains tenant/user IDs but no tokens: acceptable in this private repo, recorded here) [P-REPLAY]. Add `.testmuai/` to `.gitignore` (replay writes `.testmuai/evidence/`).
- Replay: `pnpm kane:replay [-- tests...]` = `node tools/kane/replay.mjs`. Verified behaviour [P-REPLAY]: replay from a fresh dir works if `output-<stem>/` is present (replays recorded actions, author_decisions 0, ~1 s/step) but is NOT free: 0.65-2.66 credits per replay (extra likely triage on failure) and needs Kane login (uploads evidence). Regression detection verified: a label change gives `action_failed`, no self-heal. Because replay appends to `output-<stem>/.internal/meta.json` (dirty tree), `replay.mjs` copies the test + `output-<stem>/` to a temp dir and replays there. Per test it runs `kane-cli testmd run <t> --headless --agent --no-adaptive-heal --timeout 120` with `KANE_CLI_CHROME_PATH` defaulting to Playwright chromium (set by the script if unset). Requires the preview server on `--port 4173` (`--serve` spawns it, cleaned up on exit). Exit codes of replay.mjs: `0` all passed, `1` a test failed (stderr: test, status, reason, session dir), `2` infra (server/kane missing, unauth, or Chrome launch failure). kane-cli itself exits 0 pass / 1 test fail / 2 Chrome launch / 3 infra: replay maps kane 2 and 3 to its own `2`. Hook calls exactly: `node tools/kane/replay.mjs`.
- R8.3 Ground-truth guard (optional, `--verify-cdp`): replay against our own headless Chrome via `testmd run ... --cdp-endpoint` [DEFERRED: untested for testmd], then assert `summary()` against `expect.json`. Default off.

### R9 Rehearsal, knobs, backup
Procedure (owner/agent, before 5 PM; each ~10 min): (1) `pnpm --filter @node-arena/web build:test` + `pnpm kane:play --dry-run` (objective + state read, 0 credits); (2) `kane:play --max-runs 1` and compare `verify` against screen; (3) full match; (4) repeat once with Chrome unfocused (R4; single tab, `resume()` before each run) and once with `--mode launch`. Record: steps/run, credits/run, wall/match, accepted/run (these fill the [DEFERRED] estimates).
Knobs: `--moves` 2-3, `--speed` (0.25-0.5; game faster than Kane risks bot lead), bot `actionDelayMs` in `na-kane.json` (01: 30000 game-ms), `--run-timeout`, `--stall-runs`, `--min-credits`, `--software-gl`.
Backup (owner-only manual): screen-record one full winning rehearsal (`kane-runs/<ts>/driver.ndjson` + Kane evidence pack via `kane-cli evidence serve`) and keep it outside git; used when exit is 20/22/23 at demo.

## Architecture
```
tools/kane/drive.mjs  -> lib/chrome.mjs (spawn/attach, flags, visibility)
                      -> lib/cdp.mjs   (raw WS client: generic send(method, params), evaluate, getTargets, emulation; 05 wraps send with an allowlist)
                      -> lib/objective.mjs (phase + template, pure/unit-testable)
                      -> lib/kane.mjs  (spawn kane-cli, parse NDJSON, balance)
                      -> lib/events.mjs (emit v1 NDJSON)
tools/kane/replay.mjs -> temp copy of test + output-<stem>/ -> kane-cli testmd run ... (~0.65-2.7 credits/test)
```
Data flow per iteration: CDP `summary()` -> objective -> `kane-cli` (child, same Chrome via CDP) -> NDJSON passthrough -> CDP `summary()` -> `verify` -> loop. Two CDP clients (driver + Kane), plus 05's screencast as a third, attach to one Chrome without interfering [P-KANE-P2, P-INFRA-Q4]; driver is read-only except `bringToFront`/`resume()`/emulation, never clicks.
Consumes (02 contract): `window.__na.kane.summary()` fields `result, letters, pairs[{from,to,state,reason,text}], human{commands,drawn,cut,rejected}`; `__na.screen`, `__na.state().levelId`, `data-testid` selectors only for the Kane objective text. Consumes (01): URL `?kane=1`, levelId `na-kane`.
Unit tests (`tools/kane/test`, node:test, no Kane): objective builder, balance parser, NDJSON line encoder, accepted-delta computation on fixture summaries, exit-code mapping.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Location/lang | `tools/kane/*.mjs`, no deps | TS in `tools/src`; Playwright connectOverCDP | no build step, runs from clean checkout, reachable by hook/05 |
| 2 | Ground truth | Raw CDP `summary()` | Kane assertions; Playwright | Kane false-PASSes; summary is the 02 contract |
| 3 | Moves/run | 2-3 clicks, `--max-steps 8` | one long objective | drift >15 steps; bounded credits (brief); no batching, 1 action/step [P-KANE-P1] |
| 4 | Phase hint | driver passes strategy, not button names | driver picks moves | brief: Kane picks from button text |
| 5 | Idle wait | free local polling | Kane "wait" run | credits |
| 6 | Visibility | single tab, `bringToFront` + `__na.resume()` before each run; 02 kaneMode auto-resume backstop | focus emulation alone (~5 ticks/s) | measured [P-INFRA-Q3] |
| 7 | Replay entry | wrapper `replay.mjs` over `testmd run`, in a temp copy | raw command in hook | uniform exit codes, `--serve`, meta.json stays clean, optional CDP guard |
| 8 | Credits | `balance` text parse | `run_end` only | need floor before spend |

## Manual steps
- Owner: `kane-cli login` on any new machine (token valid here, 695 credits after probes); top up credits; confirm hack-day allotment; tracks credit budget.
- Owner/agent: author ONE test once (~35-50 credits) after 02/01 freeze strings; commit the test file AND `output-<stem>/` (required for replay).
- Owner: record backup win video (owner-confirmed 2026-10-24); Kane runs headless on this box for now, headed only on owner laptop (05).
- Owner (CI only, 04): `LT_USERNAME`/`LT_ACCESS_KEY` secrets.

## Risks / Open Questions
- [RESOLVED: Probe 2 2026-10-23 — attach works, reuses existing tab, keeps state; ws-endpoint hangs] `--cdp-endpoint` attach. Probe 2 also verified double-click -> CutLine and red-banner reading. Fallback R6 kept.
- [RESOLVED: Probe 2 2026-10-23 — attach works, reuses existing tab, keeps state; ws-endpoint hangs] Kane reuses the existing tab on attach (single-tab assumption holds). Driver still finds the game target by URL and warns `extra_tab`.
- [RESOLVED: replay works from a fresh dir when `output-<stem>/` is present; commit it; replay in a temp copy; costs 0.65-2.66 credits and needs Kane login [probe: probes-20261024.md §P-REPLAY]] Replay portability.
- [DEFERRED: verify at runtime in rehearsal] Steps actually used per 3-move objective (measured 4 steps for 3 actions) and false-stop behaviour when a banner appears; tune wording on rehearsal 1.
- [RESOLVED: single tab + `bringToFront` + `__na.resume()` before each run; 02 kaneMode auto-resume; headless=new + SwiftShader; Xvfb not usable [probe: probes-20261024.md §P-INFRA-Q3, §P-RENDER]] Tab-hidden pause (R4) and Linux server display.
- [DEFERRED: sequencing — smoke test authored after 01+02 land, using 02's shipped strings] Slot count / button text final after 01+02 (test strings, objective semantic words). Blocks authoring the smoke test.
- [RESOLVED: `run_end` fields `credits_consumed`, `session_dir`, etc. confirmed; step lines have no `type` [probe: probes-20261024.md §P-KANE-P3]] Kane NDJSON field names.
- [RESOLVED: [probe: probes-20261024.md §P-KANE-P2, §P-INFRA-Q4]] A concurrent second CDP client (screencast) does not interfere with Kane.
- [DEFERRED: verify at runtime in rehearsal] Credits and steps per match (expected ~2-4 runs, ~25-50 credits; cap 150 kept).
- [NEW RISK, mitigated in R2.1] Chrome launched with a URL arg creates a phantom second page target (Kane stalls, 510 screenshot timeout, false "completed") [P-KANE-P1]. Requirement: launch `about:blank`, navigate via CDP, close extras.
- [NEW RISK] `run_end.status` and PASS are LLM-judged and can be wrong in both directions; ground truth only via `summary()` (page state).
- [NEW RISK] Replay is not free and uploads evidence to the Kane cloud; `output-<stem>/` holds tenant/user IDs (no tokens): acceptable in this private repo; never make the repo public with them.
- [DEFERRED] CDP-verified replays on by default; Kane log pane; parallel runs.

## Acceptance Criteria
- `node --test tools/kane/test` green (objective, balance parse, delta, exit codes, schema keys).
- `pnpm kane:credits` prints `{"credits":<number>}`; `pnpm kane:play -- --dry-run` against a `preview:test` server emits `driver_start`, `chrome_ready`, `page_ready`, `state`, `run_start`, `driver_end`, zero `kane-cli run` processes, exit 20/0 documented.
- Chrome has exactly one page target after start (no phantom second target).
- Rehearsal: one real `pnpm kane:play` ends with `driver_end.outcome` `won` and `game_over.result==='won'` while `__na.commandLog` independently shows >=1 human `DrawLine`; `verify.claimMatches` logged each run.
- Forcing attach failure (`--port` mismatch for Kane) triggers `fallback` or exit 22 without hanging.
- `pnpm kane:replay` on a green build exits 0 in <90 s for the smoke test, spending <=3 credits (`kane-cli balance` delta recorded, documented 0.65-2.7); working tree stays clean afterwards (temp copy; `.testmuai/` ignored); with a deliberately broken button text it exits 1 with reason line (`action_failed`); with server down exits 2.
- Min-credits: `--min-credits 99999` exits 21 before any Kane call.
