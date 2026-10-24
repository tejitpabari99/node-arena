---
status: draft
summary: Kane CLI hack-day integration — design index: approved brief plus 5 sub-project PRDs (Kane level, play controls, Kane driver, workflow integrations, hosted stream), cross-SP contracts, consolidated risks, owner steps
date: 2026-10-24
---
# Kane CLI hack-day integration (feat/kane-hackday)

## Goal
Make Node Arena a game an AI tester (Kane CLI) plays live on a hidden Kane level via a test-build-only DOM control panel, and put Kane in the dev workflow (Stop-hook replay loop, assurance, non-blocking CI replay). Design only today; code is built on hack day 2026-10-24.

## Contents
- [brainstorm.md](brainstorm.md) — approved brief, decision log (locked), risks
- Research: [../../research/kane-cli.md](../../research/kane-cli.md)

| # | Sub-project | Scope | Depends on | Phase |
|---|---|---|---|---|
| 01 | [Kane level and boot](01-kane-level/PRD.md) | `na-kane` level + `kane` campaign, content 2.0.2 + BOT_VERSION 2.0.1 + locks/goldens, `tools/src/levels.ts` gate fix, `?kane=1` boot, prod-bundle exclusion | none | 1 foundation |
| 02 | [Play controls](02-play-controls/PRD.md) | Speed 0.25/0.5/1/2, pair-button panel, banner, DOM tags, camera room, `kane-result`, `summary()`, remove original-game name | 01 | 1 foundation |
| 03 | [Kane driver + saved tests](03-kane-driver/PRD.md) | `tools/kane/drive.mjs` loop on persistent Chrome via CDP, NDJSON v1, credit floor, fallback; `replay.mjs`; 2 saved smoke tests | 02 (01) | 2 driver |
| 04 | [Workflow integrations](04-workflow-integrations/PRD.md) | Opt-in Stop hook (replay, 0 credits), assurance pipeline to `cover`, non-blocking CI replay | 03 | 3 workflow |
| 05 | [Hosted live stream](05-hosted-stream/PRD.md) | Public Start page: CDP screencast over WS, filtered NDJSON over SSE, single-run lock, credit floor, loopback-only game | 03 | 3 showcase (first cut) |

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
| Driver CLI | `tools/kane/drive.mjs` flags per 03 R1 (`--url --serve --mode --port --chrome --headless --software-gl --moves --max-steps --run-timeout --max-runs --stall-runs --idle-max --min-credits --log --dry-run --credits-only`); exit codes `0 won, 10 lost, 11 time up, 20 stalled, 21 credit/auth, 22 Chrome/CDP, 23 not ready/paused, 30 max-runs, 1 internal`; `driver_end` always first | 03 |
| NDJSON | v1, `v/ts/seq/type`, frozen type names (`driver_start, chrome_ready, page_ready, credits, state, idle, run_start, kane, run_end, verify, stall, warn, fallback, game_over, driver_end`); consumers ignore unknown fields | 03 |
| Replay | `tools/kane/replay.mjs [--serve] [tests...]`, exit `0` pass / `1` fail / `2` infra; saved tests `tools/kane/tests/*_test.md` (+ `*.expect.json`) | 03 |
| Scripts | `pnpm kane:play`, `kane:replay`, `kane:credits` (03); `kane:stream` (05); optional `kane:assure` (04) | 03/04/05 |
| Versions | `contentVersion` 2.0.1 -> 2.0.2; `BOT_VERSION` 2.0.0 -> 2.0.1; no `RULES_VERSION` bump; na-kane excluded from `levels:lock` (owner) | 01 |
| Bot pacing | `na-kane` bot `{kind:'tw', actionDelayMs:30000, behavior:'attackOnly'}`; delay is game-time | 01 |
| Licensing | No "Tower War" text anywhere in UI/page (`style.css:4` reworded) | 02, 05 |
| Exposure | Only frames + allowlisted log are public; preview 4173, CDP 9222 loopback; hosted build is a test build | 05 |

## Cross-cutting risks / open questions
| Tag | Item | Owner PRD |
|---|---|---|
| [OPEN] cross-SP gap | 05 depends on 03 exposing `--headless`, `--credits-only`, stable `chrome_ready.port`, `lib/cdp.mjs`. 03 defines `--credits-only` (own row), `chrome_ready.port`, and `lib/cdp.mjs`, but `--headless` exists only inside the `--chrome` row (no own row, no exit/Xvfb semantics) and 05 also needs: `--serve` child cleaned up on driver end, and `lib/cdp.mjs` exporting a generic `send` (03 lists only evaluate/getTargets/emulation) so 05 can wrap it. 03 must promote/freeze these. (05 O4 is stale: 03 marks `--cdp-endpoint` attach RESOLVED by Probe 2.) | 03 (05 consumer) |
| [OPEN] cross-SP | Bot delay: brief said >=20000; 01 chose 30000 + attackOnly. Delay is game-time, so at 0.25x 20000 = 80 s wall, 30000 = 120 s per enemy action. Tune in first rehearsal (03 R9). | 01, 02, 03 |
| [OPEN] cross-SP | File collisions: 01 and 02 both edit `test-harness/gate.ts`, `test-harness/index.ts`, `main.tsx` (01 lands first, 02 rebases); 03, 04, 05 all touch root `package.json` scripts (03 first; 04/05 add lines after), 05 also `tools/package.json`. | 01/02; 03/04/05 |
| [RESOLVED: 02 `kane-result` + 03 keys off `summary().result`] | Win on single-level campaign shows "All levels complete!", not "Victory!"; dialog text is never used. | 02, 03 |
| [OPEN] cross-SP | Backgrounded/hidden tab pauses the game and opens restart popup. 02 O1 (fallback: Kane-mode `isHidden=()=>false`), 03 R4 mitigations (Chrome flags, focus emulation, `bringToFront`), 05 headless/Xvfb (O2). Verify unfocused in rehearsal. | 02, 03, 05 |
| [OPEN] cross-SP | Fresh-checkout replay of saved tests: are steps in `output-<stem>/` (commit) or Test Manager cloud (`LT_*`)? Blocks CI acceptance. | 03, 04 (O1) |
| [OPEN] | Vite `import.meta.glob` negation behaves same in dev and build; fallback = accept bundled-but-unreachable. Verify first. | 01 |
| [OPEN] | `dev-security-review` required on 05 before the link is shared; no unresolved High. Also `ws` dependency pin. | 05 |
| [OPEN] | Level winnability and layout: target <= ~8 moves, all buildings reachable; proxy wins >=1, idle human 0. | 01 |
| [OPEN] | Panel overflow on real na-kane (1600x900, 1366x768); hidden-pair memo (O3); tag vs number sprite overlap (O4). | 02 |
| [OPEN] | Kane objective: steps per 3-move run (<=8?), `--mode action` flags effect, `run_end` credit/session field names, `--cdp-endpoint` launch-fallback via `chrome-wrapper.sh` unverified. | 03 |
| [OPEN] | Kane step-line field names for 05 allowlist; capture from one real run; screencast with 2nd CDP client; daily start cap value. | 05 (O1-O3, O5) |
| [OPEN] | Assurance: `cover` for win/lose (likely "owed"), appendix strings drift if 02 text changes (A-1), `build:test` wall time, CI `kane-cli login` non-TTY. | 04 |
| [OPEN] | `bots:golden` update flag / replay goldens regeneration. | 01 |
| [OPEN] | Credit burn per match (est. ~45-150) and Kane falling behind at 0.25x; measure on rehearsal 1. | 03 |
| [DEFERRED] | Kane picker label/result screen; keyboard shortcuts; panel on common levels; CDP-verified replays default; Playwright export; `maintain`; spectator mirror; run history. | 01, 02, 03, 04, 05 |

## Owner-only manual steps
- `kane-cli login` on any new machine (valid on this box); `npm i -g @testmuai/kane-cli`.
- Credit top-up; set Kane portal credit/spend cap; confirm hack-day allotment (assurance ~150, match <=150).
- Add repo secrets `LT_USERNAME`, `LT_ACCESS_KEY` (CI self-skips green without).
- Opt-in Stop hook: merge `tools/kane/hooks/settings.example.json` into `.claude/settings.local.json`.
- Leave `Kane replay` CI check non-required.
- Record backup full-win video (outside git; `tools/kane/stream/public/backup.mp4` git-ignored); Kane evidence pack.
- Pick exposure: cloudflared quick tunnel (installed) or nginx (TLS/DNS); confirm daily start cap.
- Run `dev-security-review` gate / approve before sharing link; decide headed laptop vs server demo.

## Cut order (from brief)
hosted link -> log relay -> assurance runs (keep `cover` from designed tests) -> floating building tags. Fallback at demo: recorded win video (driver exits 20/22/23 or stall > ~3 min).

## Next
Owner reviews PRDs, triages every [OPEN] in each PRD (`[RESOLVED: …]` / `[DEFERRED]`), then dev-tasks.
