---
status: draft
summary: tools/kane driver that loops Kane runs (2-3 moves each) on one persistent headed Chrome until CDP ground truth shows a result, with a stable NDJSON event schema, credit floor, stall/fallback handling, plus two saved Kane smoke tests and their replay command.
date: 2026-10-24
---
# PRD: 03 Kane driver and saved smoke tests

Repo/branch: node-arena, `feat/kane-hackday` · Depends on: 02-play-controls (and 01) · Blocks: 04 (replay), 05 (play loop, NDJSON, credits) · Brief: [brainstorm.md](../brainstorm.md) (locked)
Owns: `tools/kane/**` (new: `drive.mjs`, `replay.mjs`, `lib/*.mjs`, `chrome-wrapper.sh`, `tests/*_test.md`, `tests/*.expect.json`, `README.md`), root `package.json` scripts `kane:play`, `kane:replay`, `kane:credits`, `.gitignore` lines
Does not own: game DOM/hooks (02), level/bot (01), Stop hook / CI / assurance (04), server/stream (05)

## TL;DR
`node tools/kane/drive.mjs` owns one Chrome (`--remote-debugging-port=9222`), loads `/?kane=1`, then loops: read `window.__na.kane.summary()` over raw CDP -> stop if `result` set -> else one sequential `kane-cli run --cdp-endpoint ... --allow-missing-url --agent --max-steps 8` with a 2-3 move objective -> re-read summary and compute which moves the sim really accepted. Kane's PASS is logged, never trusted. Everything is emitted as versioned NDJSON (05 relays it). Fallback = Kane-launched Chrome per run (long runs) then recorded video. Two Kane smoke tests are authored once (~60-100 credits) and replayed at 0 credits via `pnpm kane:replay`.

## Problem
- Kane needs ~10 s per LLM step and cannot read `window.__na` or drag [verified: research kane-cli.md spikes]; it can only click DOM text. Ground truth must come from outside Kane, and Kane can silently false-PASS [verified: A2a/A2c].
- A run that is too long drifts (>~15 steps), one that is too short wastes launch cost; attach to a persistent Chrome is the highest-value lever [verified Probe 2 2026-10-23: `--cdp-endpoint` attach works, reuses existing tab, keeps state].
- 04 and 05 need a stable interface (command, events, exit codes, credits, replay) before the driver exists.

## Goals / Non-Goals
Goals: win na-kane unattended in one command; machine-readable log; bounded credit and wall cost; one documented fallback; saved tests that replay in CI/hook without credits.
Non-goals: parallel Kane sessions (1 concurrent per plan), game-side changes, streaming/server (05), hook/CI wiring (04), deterministic replay of a live match.

## Requirements

### R1 Command line (stable; 04/05 call this)
`node tools/kane/drive.mjs [flags]` (alias `pnpm kane:play -- [flags]`), plain Node >=22.13 ESM, zero npm deps (Node 22 global `WebSocket`/`fetch` for CDP; `child_process` for Chrome/kane-cli).

| Flag | Default | Meaning |
|---|---|---|
| `--url` | `http://127.0.0.1:4173/?kane=1` | game URL (test build, `preview:test`); `--seed N`/`--speed S` append `&seed=`/`&speed=` |
| `--serve` | off | spawn `pnpm --filter @node-arena/web preview:test` if the URL port is down |
| `--mode` | `attach` | `attach` (own Chrome + `--cdp-endpoint`) or `launch` (R6 fallback); auto-switches on attach failure unless `--no-fallback` |
| `--port` | 9222 | Chrome remote-debugging port (bound 127.0.0.1) |
| `--chrome` | `$KANE_CLI_CHROME_PATH` or Playwright chromium | binary; `--headless` off by default (headed; needs DISPLAY on Linux); `--software-gl` adds SwiftShader flags |
| `--moves` | 3 | moves per run (2-3 recommended) |
| `--max-steps` | 8 | passed to Kane |
| `--run-timeout` | 150 | s, `kane-cli --timeout`; never lower than ~120 (killed runs are still billed) |
| `--max-runs` | 20 | hard cap |
| `--stall-runs` | 3 | consecutive runs with zero accepted moves -> stall |
| `--idle-max` | 240 | s of local (free) waiting when no `ready` button exists |
| `--min-credits` | 200 | credit floor (R5) |
| `--log` | `kane-runs/<ts>/driver.ndjson` | file; same lines also on stdout |
| `--dry-run` | off | build objective, read state, never call `kane-cli` |
| `--credits-only` / `pnpm kane:credits` | - | print `{"credits":N}` and exit |

Exit codes: `0` won · `10` lost · `11` time up · `20` stalled (caller should fall back to recorded video) · `21` credit floor or auth failure · `22` Chrome/CDP failure (both modes) · `23` page/game not ready or stuck paused · `30` max-runs hit · `1` internal error. Always emits `driver_end` first.

### R2 Loop (sequential, one `kane-cli` at a time)
1. Start/attach Chrome; `Target.getTargets`, pick page whose URL matches; close extra page targets; `Page.navigate` to the URL; wait until `__na.screen==='playing'`, `__na.kane===true`, `__na.state().levelId==='na-kane'` (else exit 23).
2. Apply visibility mitigation (R4).
3. Credit check (R5). Read `summary()` (CDP `Runtime.evaluate`, returnByValue). `result` non-null -> `game_over`, exit by result.
4. If `pairs` has no `ready` and no `active`: local wait (poll 2 s, free) up to `--idle-max`, emit `idle`.
5. Build objective (R3), run `kane-cli run "<obj>" --cdp-endpoint http://127.0.0.1:<port> --allow-missing-url --agent --max-steps 8 --timeout 150 --mode action --assertion-mode dom --final-validation off --bug-detection off` with `stdin=/dev/null`. Flag values come from research/`--help` [verified `kane-cli run --help` 0.9.0]; latency effect of mode flags is [OPEN] (measure on rehearsal 1; drop `--mode action` if it hard-stops on benign banner).
6. Pass through each Kane NDJSON line as `kane` events. After exit re-read `summary()`; compute delta vs step 3: accepted = new human `DrawLine`/`CutLine` rows in `human.commands` whose pair has no matching `rejected` entry; also `drawn`/`cut` counters. Emit `verify`.
7. `accepted==0` -> `stall.noProgress++` else reset. Loop to 3. Win/loss is decided only by `summary().result` (02: `won|lost|timeout`), never `run_end.status`, never dialog text.

### R3 Objective (Kane chooses each move from button text)
Template built per run from a 3-line state hint (`phase`: `capture` if any neutral target is not yet ours, `attack` after; `cut` only when `ready==0` and `active>0`). The driver does NOT name buttons or letters; it only gives strategy and semantics. Example (draw phase), kept <120 words so one step reads it:

> A game page is already open; do not navigate or reload. Make up to {moves} moves, then stop. A move = one single click on one green button in the bottom panel whose text contains "ready". Green "ready" works; red "active" is already running, do not click it; grey is unavailable, do not click it. Never click "Speed", the canvas, or anything outside the bottom panel. {phase-hint}. Each move must use a different button. If a red banner appears at the top, read it, do not retry that button, pick another green one. Stop after {moves} clicks or if no green button exists. Do not wait. Reply with the exact text of each button you clicked.

`phase-hint`: capture -> "Prefer buttons whose target is grey (neutral) with the lowest level"; attack -> "Prefer buttons whose target is red-owned"; cut -> "Double-click one red 'active' button instead to free a route; that is the only move". Rationale: steps ~ {moves} clicks + 1 read + 1 final = <=8 [OPEN: confirm Kane does not re-observe extra steps; measure steps per run].

### R4 Tab visibility (02 [OPEN] O1)
`document.hidden` pauses the driver and opens the restart popup [verified: driver/index.ts:52,90,94]. Layers, cheapest first, all driver-side (no game change):
1. Chrome flags: `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling`, window 1600x900 (matches 02 screenshots).
2. Own CDP session held open for the whole match: `Emulation.setFocusEmulationEnabled{enabled:true}`, `Page.bringToFront` before every run, and `Page.addScriptToEvaluateOnNewDocument` + one `Runtime.evaluate` that defines `document.hidden=false`, `visibilityState='visible'` (kept alive only while our session stays attached; never detach until driver end).
3. One game tab only (R2.1 closes extras). 4. If summary shows paused-hidden anyway: `bringToFront`, retry once, else exit 23 and ask 02 for the `environment.isHidden=()=>false` Kane-mode override. Verify-in-rehearsal: run once with Chrome minimised/another window focused.

### R5 Credits
- Read: `kane-cli balance` prints plain text `Available credits: 762.8408` (no `--agent`, free, ~2 s) [verified: ran it, balance 762.84, whoami valid]. Parse `/Available credits:\s*([\d.]+)/`; ignore other lines (update banner). `pnpm kane:credits` wraps it.
- Per run: Kane `run_end.credits_consumed` (research field; balance delta runs 1-2 higher) [verified in research; field name re-check on first run]. Driver logs both `creditsRun` and balance delta.
- Floor: check before start and before every run; `balance < --min-credits` (200) -> `driver_end` exit 21 (05 enforces the same floor server-side before launching; it calls `kane:credits`).
- Estimate: run ~5-6 steps x ~3 = ~13-18 credits (research D1 15.8; per-move 13+). Match of ~8 moves = 3 productive runs ~45; with wasted/rejected runs x1.5 ~70; budget cap 150 per match. A 4-5 min wall match (step ~10 s, 6 steps/run, 3-4 runs).

### R6 Fallback when attach fails
Trigger: Kane stderr/`run_end.reason` matches `/cdp|endpoint|connect|ECONN/i` on the first run, or two such failures. Then (unless `--no-fallback`): emit `fallback{reason}`; switch to `--mode launch`: run without `--cdp-endpoint`, with `--url`, objective asks for up to 8 moves and `--max-steps 20` (no state survives between runs, so fewer longer runs; game restarts from the URL). Ground truth still needed: set `KANE_CLI_CHROME_PATH=tools/kane/chrome-wrapper.sh`, which `exec`s the real binary with `--remote-debugging-port=9223 --user-data-dir=...` appended, and the driver read-only attaches to 9223 for `summary()` [OPEN: unverified that kane-cli uses the env binary without stripping args]. If that also fails: exit 22/20; manual fallback = pre-recorded win video.

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
| `kane` | `iter`, `event` (raw Kane NDJSON object, passthrough; `stream_start`/step/`run_end`) |
| `run_end` | `iter`, `kaneExit`, `kaneStatus` (claim only), `creditsRun`, `durationMs`, `sessionDir` |
| `verify` | `iter`, `accepted:[{tick,type,from,to}]`, `rejected:[{reason}]`, `claimMatches` (bool) |
| `stall` | `iter`, `noProgress` |
| `warn` | `code` (`claim_mismatch`,`paused_hidden`,`extra_tab`,`credit_parse`,...), `msg` |
| `fallback` | `reason`, `to` |
| `game_over` | `result`, `winner`, `tick`, `humanCommands`, `drawn`, `cut` |
| `driver_end` | `outcome` (`won|lost|timeout|stalled|credit_floor|chrome|not_ready|max_runs|error`), `exitCode`, `runs`, `creditsUsed`, `wallMs` |

### R8 Saved Kane smoke tests (for 04 Stop hook and CI)
- Location: `tools/kane/tests/*_test.md` (frontmatter as research `nav_test.md`: `mode: testing`, `url: http://localhost:4173/?kane=1&seed=1`, `headless: true`, tags). Sidecar `<stem>.expect.json` with expected ground truth (R8.3).
- Tests (author after 01 freezes letters; each step names the visible button text, no canvas):
  1. `panel_draw_cut_test.md` (~4 steps): click the green button whose text starts `A →` and contains `ready`; verify that button now contains `active`; double-click it; verify it contains `ready` again.
  2. `panel_grey_banner_test.md` (~6 steps): click green buttons from source A one at a time until a button reads `no free route` (fixed count after rehearsal); click that grey button; verify a red alert banner with text mentioning no free route is visible [OPEN: slot count of the na-kane human source decides the click count].
- Authoring (owner or agent; both need local kane-cli auth, already logged in here, 762.84 credits [verified]): `kane-cli testmd run tools/kane/tests/<stem>_test.md --headless --agent --timeout 240` (first run of a never-authored test authors it [verified `testmd run --help`]; `--author` re-authors). Cost ~3 credits/step: ~15-30 per test, <=100 incl. one retry. Never kill with a tight timeout (billed anyway).
- Replay (0 credits): `pnpm kane:replay [-- tests...]` = `node tools/kane/replay.mjs`, which per test runs `kane-cli testmd run <t> --headless --agent --no-adaptive-heal --timeout 120` (flags verified in `--help`; pattern proven by research hook, 24 s for 2 steps), requires the preview server on `--port 4173` (`--serve` option spawns it), exit `0` all passed, `1` a test failed (stderr: test, status, reason, session dir, same format as research hook), `2` infra (server/kane missing or unauth; 04 hook maps to exit 0 skip). Hook calls exactly: `node tools/kane/replay.mjs`.
- R8.3 Ground-truth guard (optional, `--verify-cdp`): replay against our own headless Chrome via `testmd run ... --cdp-endpoint` [OPEN: untested for testmd], then assert `summary()` against `expect.json` (e.g. test 1: human `drawn>=1`, `cut>=1`; test 2: `rejected` empty, banner seen). Default off; research hook already treats replay PASS as sufficient for DOM-only assertions.

### R9 Rehearsal, knobs, backup
Procedure (owner/agent, before 5 PM; each ~10 min): (1) `pnpm --filter @node-arena/web build:test` + `pnpm kane:play --dry-run` (objective + state read, 0 credits); (2) `kane:play --max-runs 1` and compare `verify` against screen; (3) full match; (4) repeat once with Chrome unfocused (R4) and once with `--mode launch`. Record: steps/run, credits/run, wall/match, accepted/run.
Knobs: `--moves` 2-3, `--speed` (0.25-0.5; game faster than Kane risks bot lead), bot `actionDelayMs` in `na-kane.json` (01: 30000 game-ms), `--run-timeout`, `--stall-runs`, `--min-credits`, `--software-gl`.
Backup (owner-only manual): screen-record one full winning rehearsal (`kane-runs/<ts>/driver.ndjson` + Kane evidence pack via `kane-cli evidence serve`) and keep it outside git; used when exit is 20/22/23 at demo.

## Architecture
```
tools/kane/drive.mjs  -> lib/chrome.mjs (spawn/attach, flags, visibility)
                      -> lib/cdp.mjs   (raw WS client: evaluate, getTargets, emulation)
                      -> lib/objective.mjs (phase + template, pure/unit-testable)
                      -> lib/kane.mjs  (spawn kane-cli, parse NDJSON, balance)
                      -> lib/events.mjs (emit v1 NDJSON)
tools/kane/replay.mjs -> kane-cli testmd run ... (0 credits)
```
Data flow per iteration: CDP `summary()` -> objective -> `kane-cli` (child, same Chrome via CDP) -> NDJSON passthrough -> CDP `summary()` -> `verify` -> loop. Two CDP clients (driver + Kane) attach to one Chrome; driver is read-only except visibility emulation, never clicks.
Consumes (02 contract): `window.__na.kane.summary()` fields `result, letters, pairs[{from,to,state,reason,text}], human{commands,drawn,cut,rejected}`; `__na.screen`, `__na.state().levelId`, `data-testid` selectors only for the Kane objective text. Consumes (01): URL `?kane=1`, levelId `na-kane`.
Unit tests (`tools/kane/test`, node:test, no Kane): objective builder, balance parser, NDJSON line encoder, accepted-delta computation on fixture summaries, exit-code mapping.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Location/lang | `tools/kane/*.mjs`, no deps | TS in `tools/src`; Playwright connectOverCDP | no build step, runs from clean checkout, reachable by hook/05 |
| 2 | Ground truth | Raw CDP `summary()` | Kane assertions; Playwright | Kane false-PASSes; summary is the 02 contract |
| 3 | Moves/run | 2-3 clicks, `--max-steps 8` | one long objective | drift >15 steps; bounded credits (brief) |
| 4 | Phase hint | driver passes strategy, not button names | driver picks moves | brief: Kane picks from button text |
| 5 | Idle wait | free local polling | Kane "wait" run | credits |
| 6 | Visibility | flags + focus emulation + hidden override via own session | ask game to ignore hidden | no game change; fallback exists |
| 7 | Replay entry | wrapper `replay.mjs` over `testmd run` | raw command in hook | uniform exit codes, `--serve`, optional CDP guard |
| 8 | Credits | `balance` text parse | `run_end` only | need floor before spend |

## Manual steps
- Owner: `kane-cli login` on any new machine (token valid here, 762.84 credits [verified]); top up credits; confirm hack-day allotment.
- Owner/agent: author 2 tests once (credits) after 02/01 freeze letters; commit the test files and, if needed, their `output-<stem>/` replay artefacts (R-O1).
- Owner: record backup win video; decide whether to run headed on laptop vs server (05).
- Owner (CI only, 04): `LT_USERNAME`/`LT_ACCESS_KEY` secrets.

## Risks / Open Questions
- [RESOLVED: Probe 2 2026-10-23 — attach works, reuses existing tab, keeps state; ws-endpoint hangs] `--cdp-endpoint` attach. Probe 2 also verified double-click -> CutLine and red-banner reading. Fallback R6 kept.
- [RESOLVED: Probe 2 2026-10-23 — attach works, reuses existing tab, keeps state; ws-endpoint hangs] Kane reuses the existing tab on attach (single-tab assumption holds). Driver still finds the game target by URL and warns `extra_tab`.
- [OPEN] Replay portability: authored test steps may live in `output-<stem>/` and/or Test Manager cloud; a fresh CI checkout may need them committed or `LT_*` creds. Inspect with `kane-cli testmd status`; test by replaying from a clean clone.
- [OPEN] Steps actually used per 3-move objective (<=8?) and false-stop behaviour when banner appears; tune wording on rehearsal 1.
- [OPEN] Tab-hidden pause on headed Chrome (R4) and on a Linux server (needs Xvfb/DISPLAY) for 05.
- [OPEN] Slot count / button text final after 01+02 (tests, objective semantic words).
- [OPEN] Kane `run_end` field names for credits/session (research: `credits_consumed`, `session_dir`) re-verify on first run; spend <=1 run.
- [DEFERRED] CDP-verified replays on by default; Kane log pane; parallel runs.

## Acceptance Criteria
- `node --test tools/kane/test` green (objective, balance parse, delta, exit codes, schema keys).
- `pnpm kane:credits` prints `{"credits":<number>}`; `pnpm kane:play -- --dry-run` against a `preview:test` server emits `driver_start`, `chrome_ready`, `page_ready`, `state`, `run_start`, `driver_end`, zero `kane-cli run` processes, exit 20/0 documented.
- Rehearsal: one real `pnpm kane:play` ends with `driver_end.outcome` `won` and `game_over.result==='won'` while `__na.commandLog` independently shows >=1 human `DrawLine`; `verify.claimMatches` logged each run.
- Forcing attach failure (`--port` mismatch for Kane) triggers `fallback` or exit 22 without hanging.
- `pnpm kane:replay` on a green build exits 0 in <90 s for both tests, 0 credits (`kane-cli balance` unchanged +-0.01); with a deliberately broken button text it exits 1 with reason line; with server down exits 2.
- Min-credits: `--min-credits 99999` exits 21 before any Kane call.
