# Kane driver

Node Arena demo tooling. Assets based on / motivated by Tower War.
Node >=22.13, pnpm 10.34.6, authenticated `kane-cli`, and Chrome/Playwright Chromium
are required. No npm runtime dependencies.
Use the **test build**, which supplies `window.__na`; production omits these hooks.
All invocations identify themselves with `KANE_CLI_USER_AGENT=codex`.

```sh
pnpm build:prerequisites                         # fresh checkout
pnpm --filter @node-arena/web build:test
pnpm --silent kane:credits
pnpm --silent kane:play -- --serve --headless --dry-run
pnpm --silent kane:play -- --serve --headless --seed 1 --speed 0.25
pnpm kane:replay -- --serve
```

`--serve` starts a private `preview:test` only when the URL is unavailable. Existing
servers are reused and remain running. The driver owns its Chrome/profile and any
preview it starts; it cleans them up on success, failure, SIGINT and SIGTERM.
Run one paid Kane invocation at a time. Keep timeouts >=120 s; cancelling a paid
run does not avoid its charge. Logs and screenshots belong in ignored `kane-runs/`.

## Frozen CLI

`node tools/kane/drive.mjs [flags]` / `pnpm kane:play -- [flags]`:

| Flag | Default | Meaning |
|---|---|---|
| `--url URL` | `http://127.0.0.1:4173/?kane=1` | HTTP(S) loopback only; no credentials |
| `--serve` | off | Start preview on URL port if unavailable |
| `--seed N` | URL/game default | Replace URL seed; nonnegative integer |
| `--speed S` | URL/game default (0.25) | Replace URL speed; positive number, game validates supported speeds |
| `--mode attach\|launch` | `attach` | Persistent owned Chrome / fresh Kane Chrome per run |
| `--port N` | 9222 | Attach Chrome CDP; 0 chooses free port; launch uses fixed 9223 |
| `--chrome PATH` | `$KANE_CLI_CHROME_PATH`, then Playwright/system discovery | Executable override |
| `--headless` | off | New headless Chrome; implies software GL |
| `--software-gl` | off | SwiftShader WebGL flags |
| `--no-fallback` | off | End on attach connection failure instead of launch fallback |
| `--moves N` | 3 | Positive integer clicks/objective; recommend 2–3 |
| `--max-steps N` | 8 | Positive Kane reasoning-step cap; launch always 20 |
| `--run-timeout S` | 150 | Kane timeout, integer >=120 s |
| `--max-runs N` | 20 | Positive integer paid-call cap, includes fallback calls |
| `--stall-runs N` | 3 | Consecutive zero-accepted runs before stopping |
| `--idle-max S` | 240 | Free idle bound; neutral-capture settling also capped at30 s |
| `--min-credits N` | 200 | Credit floor, checked before paid calls |
| `--log PATH` | `kane-runs/<ISO timestamp>/driver.ndjson` | Append NDJSON; also stdout |
| `--dry-run` | off | Read credits/state and construct objective; no paid Kane call |
| `--credits-only` | off | Print only `{"credits":N}`; alias `pnpm kane:credits` |
| `--help` | off | Print usage |

Flags accept separated or `--name=value` values. Boolean flags take no value.
Use `pnpm --silent` when consuming stdout as NDJSON. Dry-run ends `stalled`/20
with zero runs: this means the state/objective probe completed without playing.

| Exit | `driver_end.outcome` | Meaning |
|---|---|---|
| 0 | `won` | CDP summary says won |
| 10 | `lost` | CDP summary says lost |
| 11 | `timeout` | Game time limit reached |
| 20 | `stalled` | No accepted progress or local idle expired |
| 21 | `credit_floor` | Floor, 150-credit budget, authentication or balance failure |
| 22 | `chrome` | Chrome/CDP failed |
| 23 | `not_ready` | Preview/game unavailable or remains paused |
| 30 | `max_runs` | Call cap reached |
| 1 | `error` | Invalid arguments, internal/output/cleanup failure |

The driver emits `driver_end` before exiting when the output stream is writable.
Kane PASS is only a claim. **Only `summary().result` decides a match win.**

## NDJSON v1 contract (SP04 / SP05)

Every line has `v:1`, ISO `ts`, increasing `seq`, and `type`. Ignore unknown fields
and event types. `chrome_ready.port` is the actual CDP port. No game actions are
performed through CDP: only setup/navigation, visibility/resume and observations.

| Type | Fields beyond the common envelope |
|---|---|
| `driver_start` | `args, mode, url, credits` |
| `chrome_ready` | `mode, port, pid` (attach), `headless` |
| `page_ready` | `levelId, speed, letters` |
| `credits` | `balance, floor, ok, balanceDelta` |
| `state` | `iter, tick, result, ready, active, unavailable, humanDrawn, humanCut` |
| `idle` | `iter, waitedS` |
| `run_start` | `iter, phase, objective, maxSteps` |
| `kane` | `iter, event` (unaltered Kane object) |
| `run_end` | `iter, kaneExit, kaneStatus, creditsRun, durationMs, sessionDir` |
| `verify` | `iter, accepted, rejected, drawn, cut, acceptedCount, ambiguous, claimMatches` |
| `stall` | `iter, noProgress` |
| `warn` | `code, msg` |
| `fallback` | `reason, to` |
| `game_over` | `result, winner, tick, humanCommands, drawn, cut` |
| `driver_end` | `outcome, exitCode, runs, creditsUsed, wallMs` |

Kane step objects often have only `{step,status,remark}`, **no `type`**; other
objects include `stream_start` and `run_end`. Inspect `kane.event.type` only when
present. Outer `run_end` is the driver's measured call; inner Kane `run_end` is
its reported claim/charge. `claimMatches` compares a successful Kane claim with
at least one accepted move; it does not mean Kane verified victory.

`accepted` rows contain `{tick,type,from,to}` (numeric simulation building indices; map through `letters[].index` to `letters[].id`); rejected rows contain
`{reason}`. The shipped game does not attach pair/tick identity to rejections.
Use **`acceptedCount`**, derived from authoritative drawn/cut counters, for progress;
`accepted.length` can be smaller when mixed submissions make attribution ambiguous.
Counters are commands, not units/troops. `drawn` and `cut` in `verify` are deltas;
state/game-over counters are match totals. `durationMs`/`wallMs` are milliseconds;
`idle.waitedS` and timeout flags are seconds; tick is simulation ticks.

SP05 can import `lib/cdp.mjs`: `connectCdp(url)` returns a raw client with
`send(method, params, sessionId?)`, `getTargets()`, `evaluate(expression, sessionId)`
and `close()`. SP05 must impose its own method allowlist. Use the emitted port
and keep exactly one game page; another CDP observer does not require another tab.
This module supplies no server, relay, hook or CI integration.

## Spend, fallback and replay

Before each call the driver reads free `kane-cli balance`. It logs both Kane's
`creditsRun` and observed `balanceDelta`; billing can lag and these can differ.
`driver_end.creditsUsed` is the greater of cumulative reported charge and observed
balance decrease. A fixed **150-credit match budget** stops further calls once that
amount is reached (`warn.code=credit_budget`, exit21). An already-running call can
cross 150 because billing arrives afterward. A generous balance alone does not
remove this guard. Prefer `--max-runs 6` during rehearsal; 20 is only the hard default.

Attach reuses one private Chrome and observes its current state every run. Before each call the
driver keeps one page, brings it forward, resumes and enables focus emulation;
Chrome disables background throttling. Server use requires `--headless` (SwiftShader).
When no ready choice exists and an active route still targets a neutral building,
the attach loop polls locally every2 s for at most `min(--idle-max,30)` seconds.
It reads fresh state and credits before spending. A newly captured source can open
new choices; after the bound the existing cut objective remains available. This
small R2 extension was approved after observing premature cuts; it selects no move.
A physical desktop focus rehearsal still requires an owner's headed laptop.

On first attach connection failure, or two connection failures, fallback emits
`fallback` and uses `--mode launch` unless `--no-fallback`. Launch asks for up to
8 clicks/20 steps and uses `chrome-wrapper.sh` through `KANE_CLI_CHROME_PATH`,
a private profile and fixed CDP9223. Its observer is read-only. Each launch resets
the match; accepted deltas never compare different matches. Port9223 is locked
against another driver. If no summary can be observed, exit22; use backup video.

`pnpm kane:replay -- [--serve] [tools/kane/tests/name_test.md ...]` runs the saved
smoke(s), with default discovery in `tools/kane/tests/`. It validates the recording
cache before spending, copies test and `output-<stem>/` to a temporary folder,
uses `--headless --agent --no-adaptive-heal --timeout 120`, and removes the copy.
Keep the committed test/cache together. Edited/stale/missing recordings are infra
failures; explicit re-authoring is a separate paid operation. No `--verify-cdp`
option is implemented. Replay exits **0 all passed / 1 test failed / 2 infra** and
checks file-level `test_md_done`, not embedded step verdicts. Failure stderr gives
test, status, reason and session location. Chrome comes from the env override or
Playwright cache. Authentication is required, including evidence upload.

Budget replay at the probed **0.65–2.7 credits**, never promise free replay. Task6
positive replay: 2 steps, zero authored, 30.33s wall, immediate balance delta0;
negative renamed-label replay: exit1 `assertion_failed`, 80.71s, **5.6102 credits**
including failure investigation. Generated coordinate fallback prevented the
requested literal `action_failed`; the final DOM assertion caught the regression.
See [saved-test evidence](tests/README.md) for authoring, cache hashes and limitations.

## Real rehearsal — 2026-10-24

CLI 0.10.0-rc.3; Node22.23.3; Playwright Chromium1248; Linux server,
headless + SwiftShader; seed1. `build:test` passed before all samples.
Commands below ran through `pnpm --silent kane:play --` with
`KANE_CLI_USER_AGENT=codex`. Independent raw CDP observed the original
`window.__na.commandLog`; it never clicked or submitted commands.

Common flags: `--serve --headless --seed 1 --port 9247 --no-fallback`.
The dry probe used `--speed 0.25 --dry-run`. Single sample added
`--speed 0.25 --max-runs 1`; original full attempt used
`--speed 0.25 --max-runs 6`; tuned attempt uses `--speed 0.5 --max-runs 6`.
Every invocation wrote a separate `--log kane-runs/rehearsal-task7/<name>.ndjson`.

| Sample | Terminal / calls | Wall | Balance before → after | Observed credits |
|---|---|---|---|---|
| Dry | stalled20 / 0 | 31.271s | 100533.5361 → 100533.5361 | 0 |
| Single | max_runs30 / 1 | 119.575s | 100533.5361 → 100497.2174 | 36.3187 |
| Original full | interrupted chrome22 / 5 | 499.027s | 100497.2174 → 100347.4568 | 149.7606 |

| Original call | Completed steps | Reported credits | Call wall | Accepted | claimMatches |
|---|---|---|---|---|---|
| Single1 | 6 | 29.9035775 | 86.325s | 2 | true |
| Full1 | 5 | 22.1183025 | 83.381s | 2 | false |
| Full2 | 4 | 22.6258850 | 62.244s | 1 cut | true |
| Full3 | 7 | 30.4954250 | 107.758s | 4 | true |
| Full4 | 7 | 22.3579775 | 111.248s | 3 | true |
| Full5 | 6 | 24.6539925 | 92.929s | 3 | true |

Steps count completed `done`/`failed` Kane progress objects, including child
contexts; repeated indices are not distinct-counted away. These are not click
counts: banner analysis, extraction and waits add steps. The single sample's
independent log showed player0 DrawLine `0→4` tick110 and `0→2` tick142,
`human.drawn=2`, no rejection; a viewed screenshot showed both blue routes and
A→C/A→E active buttons, matching `verify`. Runtime proof:
`kane-runs/rehearsal-task7/single.observer.ndjson` and `single-current.png`.

Original full1 falsely judged a red banner and failed while CDP showed
`banner=null`, two accepted routes and no rejection. Its `claimMatches=false`
was correctly logged. The original strict `--mode action` was dropped per R2;
the CLI help specifies testing as its default. Banner wording no longer uses
an explicit if/else subflow. Actual enemy labels are **yellow**, so attack
strategy now recognizes yellow/red. Final hints are deliberately generic:
"Prefer enemy-owned yellow or red targets and keep attacks supplied" and
"Prefer a less useful route; keep attacks supplied." Kane chooses every move from
the visible page. No level-specific buttons, letters, routes or winning sequence
appear in the objective. Capture/cut phase selection is unchanged. Exact-text
reporting remains and adds measurable extraction cost.

The original attempt was intentionally stopped after its fifth paid call **and
balance lookup fully returned**, before a sixth call; no in-flight paid call was
cancelled. SIGINT during subsequent CDP preparation produced `warn interrupted`
and chrome22. It did not win. This is a rehearsal stop, not evidence of a Chrome
connection defect. Observed149.7606 credits was already near the150 budget.

| Intermediate tuned call | Completed steps | Reported credits | Call wall | Accepted |
|---|---|---|---|---|
| 1 | 4 | 19.2819075 | 61.789s | 2 |
| 2 | 3 | 16.9355900 | 51.035s | 1 cut |
| 3 | 3 | 17.8781475 | 61.942s | 1 |
| 4 | 2 | 13.0477925 | 46.973s | 0 |

The intermediate tuned attempt (no settling yet) completed4 calls, accepted
`[2,1,1,0]`, claims`[true,true,true,false]`; balance100347.4568→100272.7597,
**74.6971 credits**,260.592s. It was stopped between calls after the zero-progress
PASS: an unnecessary cut had removed supply. SIGINT during the next balance read
produced interrupted credit_floor21; the balance was healthy. This is a controlled
rehearsal interruption, not an authentication/floor failure.

The settled attempt **won**, exit0, in3 calls /262.785s; balance
100272.7597→100206.8056, **65.9541 credits** observed (59.0094575 reported).
A4-second free settling wait opened a new source, so no paid cut was needed.
Each call logged `verify.claimMatches=true`; accepted counts were `[2,1,2]`.

| Winning call | Completed steps | Reported credits | Call wall | Accepted |
|---|---|---|---|---|
| 1 | 4 | 15.5580500 | 66.652s | 2 |
| 2 | 3 | 17.5359200 | 57.600s | 1 |
| 3 | 6 | 25.9154875 | 96.743s | 2 |

`game_over.result=won`, winner0, tick1566; `driver_end.outcome=won`.
Independent original `__na.commandLog` recorded player0 DrawLine at ticks209,
278,927,1416,1526; summary counted5 drawn,0 cuts,0 rejections. A separately
captured and viewed screenshot showed Victory. Runtime proof remains outside git:
`kane-runs/rehearsal-task7/{settled.observer.ndjson,win-proof.json,settled-win.png}`.
These logged actions are measurements, never a scripted route in the driver.
The winning process had imported the earlier expanded supply hints; the final
user-requested simplification to generic hints occurred while it ran. The free
settling logic is identical. No extra paid attach match was run solely for wording.

Unfocused desktop repeat: **not performed here**. This SSH server has no DISPLAY;
new-headless Chrome remained `document.hidden=false` / visible in independent
observations, with one page. That proves headless operation and concurrent CDP
observation, not physical laptop focus. The headed/unfocused repeat remains an
owner check. Backup video likewise remains owner-only.

Launch command used the common flags with `--port 9223 --speed 0.5
--mode launch --max-runs 1`. It completed once with **chrome22**, Kane exit2,
no inner terminal,0 completed steps and0 accepted commands; `claimMatches=true`
(failed claim / no progress). Wall97.809s, call92.978s; balance
100206.8056→100206.8056,0 observed credits, no reported charge. A final independent
free balance read remained100206.8056. The wrapper really exposed CDP9223 and its
read-only observer saw the playing game through tick268, but Kane never executed
a move. No session directory/evidence pack was created; the driver log does not
retain the exact CLI stderr. Early launch `page_ready.letters` was empty while the
page loaded; the observer now ignores empty-building loading snapshots, covered
by a no-spend regression that also preserves a populated terminal result. No paid
retry followed this guard fix. **Launch fallback
is not usable on this tested CLI/server configuration**; use the backup recording
when attach fails. No retry was made.

Total Task7 observed balance decrease: **326.7305 credits** across all samples;
winning match65.9541, each attempt below150. All paid invocations were sequential;
no in-flight paid call was killed. Saved smoke/replay authoring was not repeated.

Validation: test build passed; Kane Node suite85 passed /6 opt-in integration
skips; focused changed objective/driver suite43 passed; targeted ESLint passed;
`pnpm check:docs` passed after adding the three commands to the tools index.

## Owner backup

On a headed laptop, repeat one winning attach match with Chrome unfocused and
exactly one game tab. Check final `game_over.result=won`, `driver_end.outcome=won`,
and at least one player0 `DrawLine` in `window.__na.commandLog`; inspect every
`verify.claimMatches`. Screen-record the full winning match. Retain the video,
NDJSON and Kane evidence packs outside git; open a pack with
`kane-cli evidence serve <pack-path>` when needed. Keep a local playable copy
ready for exits20/22/23 at demo time. Assets based on / motivated by Tower War.
Physical focus and owner video capture remain owner steps.
