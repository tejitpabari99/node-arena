---
status: draft
summary: SP03 implemented and reviewed; Kane CLI hack-day integration — design index: approved brief plus 5 sub-project PRDs (Kane level, play controls, Kane driver, workflow integrations, hosted stream), cross-SP contracts, consolidated risks, owner steps
date: 2026-10-24
---
# Kane CLI hack-day integration (feat/kane-hackday)

## Goal
Make Node Arena a game an AI tester (Kane CLI) plays live on a hidden Kane level via a test-build-only DOM control panel, and put Kane in the dev workflow (Stop-hook replay loop, assurance, non-blocking CI replay). Design only today; code is built on hack day 2026-10-24.

## Contents
- [SP04 runtime follow-up review](04-workflow-integrations/review-2026-10-24-2338.md) — PASS for code; three personas; runtime proof remains partial.
- [SP04 runtime follow-up](04-workflow-integrations/code-2026-10-24-2303.md) — all tasks complete with partial runtime proof; final T3/T5 saved replay passed, T2 unproven; 362.7878/500 credits.
- [SP04 code review](04-workflow-integrations/review-2026-10-24-2213.md) — PASS for code; three personas; Task 5 has nine generated tests; second human checkpoint pending.
- [SP04 implementation and verification](04-workflow-integrations/code-2026-10-24-2213.md) — five tasks implemented; nine generated assurance tests, zero proven coverage; second checkpoint pending; affected CI rerun/remaining gates green after initial timeout.
- [SP03 final review](03-kane-driver/review-2026-10-24-2149.md) — PASS; all three personas, no unresolved must-fix.
- [SP03 implementation and verification](03-kane-driver/code-2026-10-24-2149.md) — seven tasks complete; actual attach win, cached replay, full CI; launch limitation documented.
- [SP02 final review](02-play-controls/review-2026-10-24-2032.md) — PASS; three personas, startup race resolved.
- [SP02 implementation and verification](02-play-controls/code-2026-10-24-2025.md) — nine tasks complete; verified and reviewed.
- [SP01 final validation](01-kane-level/validation-2026-10-24-1926.md) — full CI, browser, campaign, bundle and actual Kane smoke passed.
- [SP01 follow-up review](01-kane-level/review-2026-10-24-1903.md) — PASS; both prior findings resolved.
- [SP01 review fix run](01-kane-level/code-2026-10-24-1903.md) — picker isolation, owned preview, CI gate, regression evidence.
- [SP01 target integration](01-kane-level/code-2026-10-24-1856.md) — merge origin/kane-cli, combined version chain, targeted verification.
- [brainstorm.md](brainstorm.md) — approved brief, decision log (locked), risks
- [probes-20261024.md](probes-20261024.md) — 2026-10-24 probe evidence (infra, Kane CLI, replay, level, render); PRDs cite it as `[probe: ... §<id>]`
- Research: [../../research/kane-cli.md](../../research/kane-cli.md)

| # | Sub-project | Scope | Depends on | Phase |
|---|---|---|---|---|
| 01 | [Kane level and boot](01-kane-level/PRD.md) | `na-kane` = COPY of Level 7 (`levelview-182-nb`, untouched) + neutral tower b4 + middle/left obstacles (drafts: `01-kane-level/na-kane.draft.json`, `kane-campaign.draft.json`; screenshots `01-kane-level/ref/`) + `kane` campaign, content 2.0.2 + BOT_VERSION 2.0.1 + locks/goldens, `tools/src/levels.ts` gate fix, `?kane=1` boot, prod-bundle exclusion | none | 1 foundation |
| 02 | [Play controls](02-play-controls/PRD.md) | Speed 0.25/0.5/1/2, pair-button panel, banner, DOM tags, camera room, `kane-result`, `summary()`, asset acknowledgment | 01 | 1 foundation |
| 03 | [Kane driver + saved tests](03-kane-driver/PRD.md) | `tools/kane/drive.mjs` loop on persistent Chrome via CDP, NDJSON v1, credit floor, fallback; `replay.mjs`; one saved smoke test | 02 (01) | complete |
| 04 | [Workflow integrations](04-workflow-integrations/PRD.md) | Opt-in Stop hook (replay, ~0.65-2.7 credits each, needs Kane login), assurance pipeline to `cover`, non-blocking CI replay | 03 | Complete; T3/T5 saved replay passed; T2 unproven; weighted project proof 8.03921568627451% |
| 05 | [Hosted live stream](05-hosted-stream/PRD.md) | Public Start page: CDP screencast over WS, filtered NDJSON over SSE, single-run lock, credit floor, loopback-only game | 03 | All 10 tasks done; [configured ngrok URL](https://helene-unreconnoitred-overslowly.ngrok-free.dev), intentionally stopped after verification; [deployment + real win](05-hosted-stream/code-2026-10-24-2309.md), [operations security PASS + runtime proof](05-hosted-stream/security-review-2026-10-24-2256.md) |

## Dependency graph
```
01 kane-level -> 02 play-controls -> 03 kane-driver -> 04 workflow-integrations
                                                   \-> 05 hosted-stream        (04 || 05)
```

## Locked decisions
Brief decision log in [brainstorm.md](brainstorm.md) is authoritative. Interface contracts fixed by the PRDs:

| Area | Contract | Owner |
|---|---|---|
| Boot / hooks | `?kane=1` (test builds only; optional `&seed=`, `&speed=`); `TestHookRequest.kane`; `window.__na.kane` (boolean in 01; 02 adds `.summary()`); `__na.state().levelId==='na-kane'` | 01, 02 |
| Ground truth | `window.__na.kane.summary()` -> `{tick, speed, over, result:'won'\|'lost'\|'timeout'\|null, letters, human{commands,drawn,cut,rejected}, banner, pairs[{from,to,state,reason,text}]}`; driver keys off `result` only | 02 |
| DOM testids | `kane-overlay`, `kane-speed`, `kane-panel`, `kane-group`, `kane-pair`, `kane-banner`, `kane-result`, `kane-tag`; attrs `data-from`, `data-to`, `data-state` (`ready\|active\|unavailable`), `data-reason`, plus `data-speed/phase/locked/source/kind/outcome/winner/letter/index` | 02 |
| Button text | `A → C · ready · C: grey 5` / `A → C · active` / `A → B · no free route`; group header `A (blue 20)`; letters = index in `view.ids.buildings` | 02 |
| Driver CLI | `tools/kane/drive.mjs` flags per 03 R1 (`--url --serve --mode --port --chrome --headless --software-gl --moves --max-steps --run-timeout --max-runs --stall-runs --idle-max --min-credits --log --dry-run --credits-only`); `--headless` and `--software-gl` (headless=new + SwiftShader) are own rows; `--serve` child killed on every exit path; `lib/cdp.mjs` exports generic `send(method, params, sessionId?)` (05 wraps it with an allowlist); `chrome_ready.port` stable; exit codes `0 won, 10 lost, 11 time up, 20 stalled, 21 credit/auth, 22 Chrome/CDP, 23 not ready/paused, 30 max-runs, 1 internal`; `driver_end` always first | 03 |
| NDJSON | v1, `v/ts/seq/type`, frozen type names (`driver_start, chrome_ready, page_ready, credits, state, idle, run_start, kane, run_end, verify, stall, warn, fallback, game_over, driver_end`); consumers ignore unknown fields | 03 |
| Replay | `tools/kane/replay.mjs [--serve] [tests...]`, exit `0` pass / `1` fail / `2` infra; saved tests `tools/kane/tests/*_test.md` (+ `*.expect.json`); replay costs 0.65-2.7 credits per test and needs Kane login (NOT free); runs in a temp copy; `KANE_CLI_CHROME_PATH` (Playwright chromium) required for `--headless`; commit `output-<stem>/`, gitignore `.testmuai/` | 03 |
| Kane NDJSON | `kane-cli run --agent` step lines have NO `type` (`{step,status,remark}`); consumers/driver passthrough must tolerate; public log = allowlist only (type, step/index, status, remark/summary/detail, overall_status, duration); never `test_url`/`share_url`/paths/ids/`context`/`verdict` | 03, 05 |
| Scripts | `pnpm kane:play`, `kane:replay`, `kane:credits` (03); `kane:stream` (05); optional `kane:assure` (04) | 03/04/05 |
| Versions | `contentVersion` 2.0.1 -> 2.0.2; `BOT_VERSION` 2.0.0 -> 2.0.1; no `RULES_VERSION` bump; na-kane excluded from `levels:lock` (owner) | 01 |
| Bot pacing | `na-kane` bot `{kind:'tw', actionDelayMs:30000, behavior:'attackOnly'}`; delay is game-time | 01 |
| Asset acknowledgment | Assets based on / motivated by Tower War. | 02, 05 |
| Exposure | Only frames + allowlisted log are public; preview 4173, CDP 9222 loopback; hosted build is a test build. Hosting = nginx on this box behind Cloudflare-proxied DNS (ufw allows :80 from Cloudflare IPv4 only, no 443). Abuse guards: daily start cap 6 (`KANE_DAILY_CAP`), per-IP 1 Start/10 min (`KANE_IP_COOLDOWN_S`), credit floor 200 | 05 |
| Credits ledger | Probe budget 100: 67.49 spent, balance 695.35 (start 762.84); see probes-20261024.md | owner |

## Cross-cutting risks
No `[OPEN]` left in any PRD. Resolved items carry `[RESOLVED: ...]` in their PRD; the 03<->05 contract gap (`--headless`, `send`, `--serve` cleanup) is now frozen in 03 R1 / Architecture.

| Tag | Item | Owner PRD |
|---|---|---|
| [RESOLVED] | 03 exposes `--headless`, `--software-gl`, `--credits-only`, `chrome_ready.port`, `--serve` child cleanup, `lib/cdp.mjs send()`; 05 `--cdp-endpoint` attach confirmed | 03, 05 |
| [RESOLVED] | Vite glob negation: full relative-path negation works; `!**/x` fails [probes §P-INFRA-Q1] | 01 |
| [RESOLVED] | Replay portability: commit `output-<stem>/`; replay in temp copy; costs 0.65-2.7 credits, needs login [probes §P-REPLAY] | 03, 04 |
| [RESOLVED] | Tab visibility: single tab + `bringToFront` + `__na.resume()`; headless=new + SwiftShader; Xvfb unusable [probes §P-INFRA-Q3] | 02, 03, 05 |
| [RESOLVED] | Kane NDJSON field names, allowlist, second CDP client, na-kane winnable (24/24 scripted) [probes §P-KANE-P3, P2, §P-LEVEL] | 03, 05, 01 |
| [RESOLVED] | Daily start cap 6 + per-IP 1/10 min, env-configurable (orchestrator default; owner may change) | 05 |
| [RESOLVED] | Win on single-level campaign shows "All levels complete!": 02 `kane-result` + 03 keys off `summary().result` | 02, 03 |
| [DEFERRED: rehearsal] | Bot delay tuning (30000 game-ms = 120 s wall at 0.25x), steps/credits per match (est. ~25-50, cap 150), Kane falling behind, banner false-stop, `--mode action` flags, unfocused-tab check | 01, 02, 03 |
| [DEFERRED: rehearsal/fallback] | `chrome-wrapper.sh` env-binary behaviour (fallback only) | 03 |
| [DEFERRED: implementation] | `bots:golden` / `sim:golden` / `replay:verify golden` after version bumps (follow tools/README.md) | 01 |
| [DEFERRED: sequencing] | Smoke test authored after 01+02 land with 02's shipped strings; assurance appendix regenerated from 02's final strings; panel overflow / tag overlap on real na-kane | 02, 03, 04 |
| [DEFERRED: runtime] | `cover` win/lose likely "owed" (acceptable); CI `kane-cli login` non-TTY / `LT_*` confirmed by first CI run (use `--username/--access-key`); hook demo path/word = whatever 02 ships | 04 |
| Gate | `dev-security-review` required on 05 before the link is shared; no unresolved High; pin `ws` | 05 |
| Collisions | 01 and 02 both edit `test-harness/gate.ts`, `test-harness/index.ts`, `main.tsx` (01 first, 02 rebases); 03, 04, 05 touch root `package.json` scripts (03 first), 05 also `tools/package.json` | 01/02; 03/04/05 |
| Correction | Earlier claim "Stop hook / CI replay = 0 credits" was wrong: replay costs 0.65-2.7 credits per test and needs Kane login [probes §P-REPLAY] | 03, 04 |
| [DEFERRED] | Kane picker label/result screen; keyboard shortcuts; panel on common levels; CDP-verified replays default; Playwright export; `maintain`; spectator mirror; run history | 01-05 |

## Owner-only manual steps
- DNS: create Cloudflare-proxied (orange-cloud) record; pick Cloudflare SSL mode (Flexible, no 443 rule); `apt install nginx` + apply 05 snippet (or cloudflared fallback).
- Repo secrets `LT_USERNAME`, `LT_ACCESS_KEY` (CI self-skips green without).
- Record backup full-win video (outside git; `tools/kane/stream/public/backup.mp4` git-ignored).
- `kane-cli login` on any new host (valid here); `npm i -g @testmuai/kane-cli`.
- Kane portal credit/spend cap; credit top-up (balance 695.35 after probes; assurance ~150, match <=150).
- Opt-in Stop hook: merge `tools/kane/hooks/settings.example.json` into `.claude/settings.local.json`.
- Leave `Kane replay` CI check non-required; `dev-security-review` gate before sharing link; headed laptop vs server demo.

## Cut order (from brief)
hosted link -> log relay -> assurance runs (keep `cover` from designed tests) -> floating building tags. Fallback at demo: recorded win video (driver exits 20/22/23 or stall > ~3 min).

## Next
Owner reviews PRDs, then `dev-tasks` -> TASKS.md per sub-project (01-05), then `dev-code`.
