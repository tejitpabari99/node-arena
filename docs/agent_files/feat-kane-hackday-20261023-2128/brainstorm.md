---
status: approved
summary: Kane CLI hack-day integration — playtester mode (DOM panel, slow game, hidden Kane level, hosted live stream), Stop-hook verify loop, assurance on rules, CI replay
date: 2026-10-23
---
# Brainstorm: Kane CLI hack-day integration

## TL;DR
For Kane CLI Hack Day (2026-10-24) Node Arena becomes a game an AI tester plays live: Kane drives a test-build-only DOM control panel (one-click pair buttons grouped by source building, red error banner, double-click cut) on a hidden, always-unlocked Kane level against a slow, easy bot, at 0.25x game speed, streamed to a public "Start" page. Around it, Kane sits in the dev workflow three ways: a Claude Code Stop-hook replay loop, assurance (rules → tests → `cover`), and a non-blocking CI replay job. All integration code is built on the day; today produces design only.

## Problem
Hack-day rule: Kane CLI must verify the app, judged higher when Kane is inside the agent workflow; integration must be built on the day. Spikes (see [research](../../research/kane-cli.md)) showed Kane cannot drag on the Three.js canvas (silent false PASS) but clicks DOM buttons reliably, and runs ~10 s per authored step. The game is real-time and drag-only, so Kane cannot play it as-is. Audience: hack-day judges and attendees; secondarily the owner's dev workflow.
Probe 2 (2026-10-23, 121 credits): `--cdp-endpoint` attach works and keeps game state across runs; double-click → CutLine and red-banner reading verified; results folded into the decision log below.

## Asset acknowledgment
Assets based on / motivated by Tower War.

## Decision log
| Decision | Alternative rejected | Why |
|---|---|---|
| Build all three integrations minimally first, then polish playtester | Strict priority order | Protects "Kane in workflow" judging angle by ~1 PM; afternoon for showcase |
| Demo on owner's laptop, headed Chrome + terminal side by side | This Linux box via screen share | Visible real browser; Linux box hosts the public stream |
| Game pacing: slow-motion, default 0.25x | Turn-based stepping; both | Looks alive; Kane latency absorbed by slow game + slow bot |
| Speed button in top bar cycles 0.25x → 0.5x → 1x → 2x | Fixed slow speed | Owner can play the same level faster; Kane instructed never to click it. Driver allows only 1\|2 today → extend |
| Kane vs one easy bot | Kane vs Kane teaser | Credits/timing risk; PvP stays a roadmap slide |
| Log: Kane terminal beside browser; in-page log relay is stretch | Relay first | Zero code first |
| Kane must visibly win | Show "dumb but fun" Kane | Win is the story; slow game + easy bot + simple strategy in objective |
| New hidden, always-unlocked Kane level, separate `kane` campaign, reached via `?kane=1`, not in the regular picker | Add to common campaign | `common` must stay 20 levels (campaign.spec asserts 20); a single-entry campaign is always unlocked |
| Easy bot = large `actionDelayMs` (e.g. ≥20000, current L1 = 12000) and possibly `behavior: attackOnly` | Code-level difficulty | Pure content knob; bot delay is game-time so it scales with speed |
| Control panel (Kane mode) | Canvas drag, coordinates | Kane drag falls back to viewport centre; DOM clicks work (Spike D) |
| Button states (colour + state word, since Kane reads text): green `ready` (drawable now; click draws, becomes active), red `active` (line exists; double-click cuts), grey temporarily-unavailable with reason word (e.g. `no free route` = source out of slots / level cap; other transient reject reasons). Grey is clickable → red top error banner with the reason. Text e.g. `A → C · ready · C: grey 5`, `A → C · active`, `A → B · no free route` | Disabled grey; colour-only | Shows the error path; Kane reads words not colours |
| Errors: red banner at top with sim reject reason (blocked-obstacle, no-slot, duplicate, …) | Silent failure | Kane reads DOM text; reasons already exist in sim |
| Double-click a red/active pair button cancels the line (CutLine) | Separate cancel button | Owner request; DrawLine + CutLine = every player command; probe verified double-click → CutLine |
| Pairs generated at runtime from the sim: sources = buildings Kane (human player 0) currently owns (updates as it captures); targets = any other building (enemy/neutral/own). Pairs permanently impossible (blocked by obstacle/building, i.e. geometry) not shown at all | Show all pairs | Owner: just give Kane the possible paths |
| Visible press feedback (~400 ms press + ripple; button changes colour/state on accept), same for human and Kane | Native :active only | Kane clicks are instantaneous; audience must see presses |
| Same `?kane=1` level/panel for owner play; canvas drag still works | Separate human mode | No extra mode to build |
| Layout: shift the battlefield up into the free top space; bottom reserved for the panel card; zoom out only if still not fitting | Overlay / shrink canvas / zoom out first | Owner: plenty of space at top; map must stay visible |
| Panel = single bottom row of pair buttons, grouped by source building (header per group, e.g. `A (blue 20)`); one click = one move | Two-click select→target + separate lines column | Halves Kane steps per move (~5–6 s/step); simpler to follow |
| Building tags (A, B, …) as DOM overlay over buildings, not the canvas number sprite | Modify `building-label.ts` texture | DOM readable by Kane; label textures cached by level:stage |
| Kane mode test-build only (dev / `VITE_TEST_HOOKS`, `?kane=1`) | Production feature | No production change for now |
| Hosted demo: public link (no password), Start button, live CDP screencast of Kane's browser + Kane NDJSON log via SSE, hosted on this Linux box behind cloudflared or owner's nginx | LambdaTest cloud browser; HyperExecute remote; noVNC; spectator mirror | Screencast ~15–30 fps is fine at 0.25x; cloud options lack public live view / need tunnel; spectator mirror deferred |
| Abuse guard: single run at a time (viewers join same stream), Start disabled while running, server-side credit floor 200; owner also caps in Kane portal | Password | Owner wants no password |
| Kane credentials server-side only, never exposed to client | — | Owner requirement |
| Stop hook replays saved tests (0 credits); example settings committed, opt-in install | Always-on project hook | Doesn't slow other agents' sessions |
| Hook demo: live Claude Code session — change → hook → failure → fix | Script-only demo | Shows "Kane inside agent workflow" |
| Assurance input: LIN (draw/cut/reject) + WIN rules + panel UI-facts appendix | Whole GAME_RULES.md | Panel makes these observable; internal rules (ticks, math) excluded |
| CI: GitHub Actions on this branch, build:test + preview + Kane replays, workflow_dispatch + PRs touching apps/web, non-blocking; secrets LT_USERNAME/LT_ACCESS_KEY added by owner | No CI | Third "Kane in dev workflow" proof; not production |
| Cut order if late: hosted link → log relay → assurance runs (keep cover from designed tests) → floating building tags | — | Owner agreed |
| Failure plan: owner records a full Kane win video beforehand; Test Manager share link as proof; switch to recording if live match stalls > ~3 min | — | Owner agreed |
| Match driver: real-time slow-motion (0.25x) only; Kane chooses every move itself by reading panel labels; driver script runs short Kane objectives of 1–3 moves each on one persistent browser attached via `--cdp-endpoint http://127.0.0.1:9222 --allow-missing-url`; stops on Victory/Defeat dialog | Pause-while-Kane-decides; script picks moves and Kane only clicks; one long play-until-victory objective | Owner: 0.25x should be enough; Kane must be the player. Probe: long objective drifted and failed (34 cr); `--ws-endpoint` hangs, `--cdp-endpoint` attaches to existing tab and keeps game state across runs |
| Speed levers: unambiguous button text; persistent browser via `--cdp-endpoint`; one-click pair buttons ('A → C'); batch 2–3 moves per objective (1 click each; amortise ~20 s fixed run overhead) with `--max-steps` ≤8; Probe 3 (2026-10-23): TUI chaining gives no gain (per-objective upload ~10 s still happens; TUI stalls on a 'Rate this session' prompt; its own Chrome lacks WebGL without SwiftShader flags). Overlap not tested; with 1 concurrent session on the plan, runs are sequential: one `kane-cli run --cdp-endpoint` per 2–3-move batch. | Minimal-checking flags (`--mode action`, `--bug-detection off`, …) | Probe P4: flags gave no measurable gain (41 s vs 39 s; noise larger). Measured per run: ~8 s startup + ~5–6 s per step + ~10–13 s finalize/upload; old 2-click move ≈ 40 s, 5–13 credits |
| Panel locks on game over (buttons disabled, banner 'Game over') | Leave enabled | Probe: Kane 'passed' clicks after loss; panel log said accepted after game over |
| Ground truth for win/loss and moves = game command log / result dialog read by the driver over CDP, never Kane's claim | Trust Kane run_end | False PASS seen in spikes A and probe P1 |
| Saved Kane smoke tests are an explicit deliverable: author panel smoke test(s) once with Kane (costs credits), save them, then Stop hook and CI replay them (0 credits) | Assume saved tests exist | Stop hook and CI both depend on them; nothing else creates them |
| Speed 0.25x/0.5x implemented in the web driver as fractional tick accumulation (fewer sim ticks per wall-clock second); sim tick logic, determinism and RULES_VERSION untouched. Widen `1 \| 2` type in `apps/web/src/driver/index.ts` and `TestHookRequest.speed` in `apps/web/src/test-harness/gate.ts` | Change sim tick length | Keeps replays/goldens valid; no rules bump |
| Hosted demo serves a test build (`VITE_TEST_HOOKS`) publicly, since Kane mode is test-build-only; this exposes test hooks on the public link → run dev-security-review on the hosted-stream part | Production build with Kane mode | Kane mode must stay out of production bundle |
| na-kane excluded from `levels:lock` / `validate:levels` determinism lock (only common campaign is locked) | Separate lock for kane campaign | Owner: keep excluded; demo-only level |

## Design
| Part | Does | Depends on |
|---|---|---|
| Kane level content | `packages/content/data/levels/na-kane.json` (from `levelview-1.json`; ≤10 buildings, obstacles, several neutrals, easy bot) + `campaigns/kane.json` (single entry); content version bump 2.0.1 → 2.0.2 + locks | — |
| Level gate fix | `tools/src/levels.ts` mismatch check excludes levels in non-common campaigns | content |
| Kane boot | `?kane=1` → `campaignId: 'kane'` (`apps/web/src/main.tsx`), auto-start `na-kane`; test-build only | content |
| Speed control | Driver speed set {0.25, 0.5, 1, 2}; top-bar cycle button; default 0.25 in Kane mode; fractional tick accumulation in driver, sim untouched | driver |
| Control panel | Bottom row of pair buttons grouped by source building; pairs built at runtime from sim (owned sources → other-building targets, geometry-impossible pairs hidden); states ready/active/unavailable-with-reason (colour + word); click ready = DrawLine, dblclick active = CutLine, click grey → red banner (from `CommandRejected` events / `legality`); press animations | harness/app controller |
| Building tags | DOM tags positioned over buildings each frame via scene projection | renderer inspection |
| Layout | Camera framing: bottom margin = panel height, map shifted up under top bar | camera fit |
| Kane driver | Script: persistent Chrome attached via `--cdp-endpoint`; short `kane-cli run` objectives of 2–3 moves, 1 click each (`--max-steps` ≤8), Kane picks every move from pair-button text; runs sequential (1 concurrent session; probe 3: no overlap); stops on Victory/Defeat dialog; objective text forbids speed button | probe result |
| Kane smoke tests | Author 1–2 panel smoke tests with Kane (draw via ready button, cut via double-click, grey click → banner), save for replay | panel |
| Stop hook | `kane-verify.sh` replays saved Kane smoke tests; exit 2 feeds failure to Claude; `stop_hook_active` guard | Kane smoke tests |
| Assurance | ingest excerpt → extract → review → design → testrun → `cover` | panel |
| CI | Actions workflow replaying saved tests | Kane smoke tests, owner secrets |
| Hosted stream | Node server: Start → spawn Chrome + Kane; CDP `Page.startScreencast` frames over WebSocket; NDJSON via SSE; single-run lock; credit floor; keys server-side; exposed via cloudflared/nginx; serves test build (security review required) | Kane driver |

Failure handling: Kane false PASS → verify via Victory dialog / panel log (never Kane's claim alone); Kane stalls → recording; credits low → server refuses Start; `--cdp-endpoint` attach fails → fresh Kane-launched browser per run (game restarts from URL) and fewer, longer runs.

## Non-goals
- No production-bundle changes; Kane mode only in test builds.
- No changes to regular campaign levels or GAME_RULES (no RULES_VERSION bump).
- No mobile; no multiplayer; no Kane-vs-Kane.
- Assets based on / motivated by Tower War.
- Spectator mirror (deterministic replay in viewer's browser) deferred to FUTURES (PvP groundwork).
- Not merged to main during the hack unless owner chooses.

## Open risks
| Risk | Cheapest test |
|---|---|
| Kane falls behind at 0.25x (bot outpaces ~40 s/move) | First rehearsal match on na-kane; tune bot `actionDelayMs`, map, moves-per-run |
| Kane picks bad pairs and never wins | One rehearsal match at 0.25x on na-kane; tune bot delay/map |
| Screencast too laggy for viewers | 10-min local screencast check on hack day |
| Credit burn per match higher than ~100–200 | Measure first rehearsal; cap via floor |
| Hack-day time (≈7 h) too short for everything | Cut order above |
| content/bot hash gates force extra version bumps | `pnpm check:content --base HEAD` early |
