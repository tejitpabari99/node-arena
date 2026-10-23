---
status: draft
summary: Kane CLI (TestMu AI) research — what it is, hack-day goal, Node Arena integration options ranked, live feasibility spikes (verdicts, measured credits), hack-day plan, KaneAI Pro value
date: 2026-10-23
---
# Kane CLI research

Context: owner attending Kane CLI Hack Day (TestMu AI, supported by OpenAI), Sat 2026-10-24, San Francisco. Event: https://luma.com/kane-cli-hack-day. Docs: [introduction](https://www.testmuai.com/docs/kane-cli-introduction), [quickstart](https://www.testmuai.com/docs/kane-cli-quickstart), [assurance](https://www.testmuai.com/docs/kane-cli-assurance), [agent mode](https://www.testmuai.com/docs/kane-cli-agent-mode), [skills](https://www.testmuai.com/docs/kane-cli-skills), [configuration](https://www.testmuai.com/docs/kane-cli-configuration), [Test Manager](https://www.testmuai.com/docs/kane-cli-tms-integration). Index: https://www.testmuai.com/llms.txt.

## Hack day: goal and rules
- Theme: "Build it with an agent. Verify it with Kane." Ship by 6 PM; submissions lock 5 PM; no fixes during demos.
- Kane CLI must verify the app. Minimum: run at demo. Stronger: Kane inside the agent workflow (e.g. hook on every save).
- Pre-existing projects allowed, but Kane integration must be built on the day; judges weight new work. Demo shows state at 10 AM vs after.
- Solo or teams ≤4. App must run and survive a live demo; keep a recorded run/backup if it depends on a third-party service.
- Tracks: Web App, Mobile App (real devices via TestMu device cloud), Wildcard; special prize Most Innovative Use of Kane CLI.
- Prizes: 1st Vision Pro + $3k OpenAI credits; 2nd Mac mini + $2k; 3rd iPad + $1k. Winners: founder 1:1, design-partner status, blog/showcase. Everyone: $250 OpenAI credits, 3 months KaneAI Pro.
- Prep: bring a signed-in AI agent; `npm install -g @testmuai/kane-cli` and run one example flow; OpenAI API account.
- Not published: judging criteria, submission format. Page contradictions (registration closed vs reviewed; ship 6 PM vs lock 5 PM) — confirm with host.

## What Kane CLI is
- AI end-to-end testing from the terminal: natural-language objectives, no selectors/scripts. Drives local Chrome (default) or Android Emulator / iOS Simulator (macOS Apple Silicon) / real devices.
- Example: `kane-cli run "Click the 'More information' link and verify the page loads" --url https://example.com`
- Modes: `kane-cli --tui` (interactive, slash commands), `kane-cli run "..." --agent --headless` (CI/agents).
- Auth: `kane-cli login` (OAuth; profiles in `~/.testmuai/kaneai/profiles/`), or `--username/--access-key` (`LT_USERNAME`/`LT_ACCESS_KEY` in CI). `kane-cli whoami`.
- Output: stderr progress; stdout JSON. Exit codes 0 pass, 1 fail, 2 error (auth/Chrome), 3 timeout/cancel.
- Agent mode (`--agent`): NDJSON stream (`v`, `ts`; `stream_start`, step lines, `run_end`). `run_end` has `status`, `summary`, `one_liner`, `reason`, `duration`, `credits_consumed`, `final_state` ("store ... as" values), `test_url`, `session_dir`. Also written to `events.ndjson` in the session folder.
- Evidence pack: sealed `.evidence` zip per run (screenshots, console/network logs, run logs); view with `kane-cli evidence serve`.
- Test Manager (cloud): uploads each run; share links (no project access needed, expire after 7 days), step screenshots, dashboard/history, Playwright code export (Python/JS, `--code-export`).
- Config: `config set-window WxH`, `config chrome-profile`, `set-mode action|testing`, `set-bug-detection`, `set-assertion-mode dom|visual` (default dom, falls back to vision), `set-final-validation`, `--url` / `set-url`, `--allow-missing-url`, mobile target/device flags, `KANE_CLI_CHROME_PATH`, `KANE_CLI_CDP_TIMEOUT_MS`.
- Claude Code skill: `npx @testmuai/kane-cli-skill` (or `kane-cli install skill`) -> `~/.claude/skills/kane-cli/`; detects browser tasks, runs `kane-cli run --agent`, parses NDJSON, inspects failures, parallel runs via sub-agents. Optional live status strip in Claude Code status bar (`npx @testmuai/kane-cli-skill strip enable`; edits `~/.claude/settings.json`).
- Measured (0.9.0, see [spikes](#live-feasibility-spikes-2026-10-23)): `localhost` works (no tunnel; local Chrome); WebGL renders headless; canvas drag does NOT work; ~3 credits per authored step, replay free. Still undocumented: max steps (`--max` did not bind in design), official per-run pricing.

### Assurance (v0.6.1+)
Requirements docs -> traceable tests -> measured coverage.
1. `context ingest` — hashed snapshot of requirement docs in local `.context/` (append-only; auto-gitignored).
2. `context extract` — agent proposes use-cases citing source lines.
3. `context review` — promote to trusted / edit / reject.
4. `design tests` — acceptance criteria, scenarios, one `*_test.md` per scenario tagged with ACs.
5. Review design (derived -> trusted).
6. `testmd run` / `testrun run` — execute; seal evidence.
7. `cover` — proven vs owed, ranked gaps.
8. `maintain` — reconcile when sources change (fresh / stale / orphaned).
9. `context sync|push|pull|clone` — share via GitHub, S3, or folder.
Credits: extract, design, maintain cost credits (`kane-cli balance`); list/review/cover/fsck/sync free. `kane-cli generate` = quick ideas without traceability.

## Node Arena fit
- Web track (or Most Innovative). Mobile track does not fit (touch layout out of scope).
- Assets: `docs/GAME_RULES.md` rule contract with `R-...` ids and `pnpm check:rules`; `docs/LEVELS_GUIDE.md`; dev/test URL hooks `?test=1&level=..&seed=..&speed=2&fixture=win|loss` (`apps/web/src/test-harness/gate.ts`; enabled in dev or `VITE_TEST_HOOKS=1`); DOM HUD/screens over a Three.js canvas.
- Roadmap (`docs/agent_files/feat-game-design-20261006-0617/brainstorm.md`): v2 tower types/power-ups/custom builder; v3 4-player FFA private rooms (Colyseus); v4 teams; v5 co-op; v6 matchmaking.

## Integration options (ranked by presentation/demo value)
1. **Kane in the Claude Code loop** — Stop/PostToolUse hook runs `kane-cli run --agent` against `pnpm dev`; live status strip shows steps. Demo: ask Claude for a change (HUD tweak / new level) -> Kane verifies in visible Chrome -> on failure Claude reads evidence and fixes -> pass. Matches the "stronger entry" rule directly.
2. **Assurance on GAME_RULES.md** — ingest rules + LEVELS_GUIDE -> extract -> design -> `kane-cli cover` shows proven / owed / gaps. Pitch: rules spec becomes browser-verified proof; `maintain` flags stale tests when rules change. Strong for Most Innovative; pairs with #1.
3. **Kane as AI playtester** — objectives like "on level 1 send troops from blue to the neutral tower, verify HUD count rises, win the level", using test hooks (`speed=2`, `fixture`). Most eye-catching, highest risk: canvas tower clicks unproven (Kane is DOM-first, vision fallback).
4. **CI gate + Playwright export** — headless Kane job in GitHub Actions, Test Manager link on PRs; exported Playwright code into `apps/web/e2e/`. Solid, dull demo; supporting slide.
5. **Future PvP (v3)** — two parallel Kane sessions as two friends in a private room verifying sync. Roadmap slide only; multiplayer not built.

Recommendation: #1 + #2, with one #3 flow as the showcase run.

### Risks / checks before the event
- Licensing: Tower War-derived data is private (README). Kane uploads screenshots to TestMu cloud; share links open without project access. Prefer demoing on original/non-TW content (e.g. `sample.json` level).
- Verified in spikes: Kane reaches `localhost`; Kane can NOT drag inside the canvas (see spikes). Integration itself still built on the day.
- Owner-only: `kane-cli login`, OpenAI account, registration confirmation.

## Live feasibility spikes (2026-10-23)
Artifacts: [kane-cli/](kane-cli/README.md) (hook, tests, assurance outputs, DOM-control probe, screenshots). Not wired into repo tooling.

### Setup facts
- kane-cli 0.9.0; auth via basic login (`kane-cli login` / `whoami`); start balance 1200 credits.
- Install with `npm i -g @testmuai/kane-cli`; pnpm global install unsupported.
- Chrome = Playwright chromium: `KANE_CLI_CHROME_PATH=~/.cache/ms-playwright/chromium-<build>/chrome-linux64/chrome` worked first try. Headless WebGL (Three.js) renders; no Xvfb needed.
- App served from `apps/web` with `build:test` + `preview:test` on 4173 (test hooks on: `?test=1`, `window.__na`). Server must be started separately; Kane does not start it.
- Each LLM step ~10s; real game keeps ticking between steps (AI opponent acts at ticks 240, 481, ...).

### Verdicts
| Option | Verdict | Why / workaround |
|---|---|---|
| 1 Stop-hook verify loop | Doable | Author tests once, replay in hook (0 credits, ~24s per 2-step test). DOM/HUD assertions only. `--no-adaptive-heal`, server up first, exit 0 on infra errors. |
| 2 Assurance on rules | Doable with workaround | Pipeline works headless and is cheap/faithful. DOM/HUD use-cases give runnable tests; mechanic use-cases (draw line, win/lose) give tests Kane cannot execute. Workaround: DOM-control panel / `fixture=win\|loss` hooks; `cover` needs a completed run. |
| 3 AI playtester | Not doable on canvas; doable via DOM controls | Canvas drag falls back to viewport centre and reports false PASS. Workaround: test-build DOM buttons (select source, send to target) calling `__na.submit`; verify with `__na` ground truth. |

### Option 1: Stop-hook loop
- Script: [kane-cli/hook/kane-verify.sh](kane-cli/hook/kane-verify.sh); wiring: [settings.example.json](kane-cli/hook/settings.example.json) (Stop, timeout 180).
- Test: [nav_test.md](kane-cli/tests/nav_test.md), authored (A5) 31 credits / 81s, 2 steps, uploaded to Test Manager; replay PASS 0 credits, 24s wall.
- Hook cases (all replay, no LLM): healthy exit 0 (24s); `stop_hook_active=true` exit 0 (0s); server down exit 0 + stderr skip note; broken app (CSS hid the button) exit 2 in 28s, stderr `nav_test.md: exit=1 status=failed reason=action_failed: click @ step 1 session=<id>`, cost 1.3 credits.
- End-to-end: `claude -p "ok" --settings hook/settings.example.json` fired the hook once, 29s total. Block path (exit 2 -> Claude fixes -> retry) exercised only by running the script directly, not end-to-end.
- Docs (code.claude.com hooks): Stop exit 2 blocks stop and feeds stderr to Claude; alt exit 0 + JSON `{"decision":"block","reason":...}`; Stop has no matcher; timeout in seconds. `stop_hook_active` guard kept defensively (not confirmed in docs excerpt).
- Gotchas: `--no-adaptive-heal` stops silent credit-burning re-authoring; `--url` override did NOT break replay (recorded navigate wins) so it is not a failure injection; replay speed scales with step count; UI changes need test maintenance (heal costs credits); live status strip (`strip enable`) is docs-only, unverified for hook-launched runs.

### Option 2: Assurance on rules
- Input: [rules-excerpt.md](kane-cli/assure/rules-excerpt.md) (R-LIN-01, R-WIN-01..03 + UI-facts appendix, 72 lines). Outputs: [kane-cli/assure/](kane-cli/assure/).
- Pipeline (all headless via `--mode agent`, `< /dev/null`): `context ingest` 0 credits 2s; `extract` 7.4 / 44s -> 5 use-cases (high quality, no hallucinated rules); `context review --approve` 0 (works without TTY); `design tests` per use-case 13-21 credits / 47-110s; `cover gaps` free.
- `cover gaps` after design (no runs): designed 55% (11/20 ACs verified by a test), proven none; UC-1 and UC-4 100% designed, UC-2 36%, UC-3/UC-5 0%.
- Test quality: open-dialog test (t-1) good and runnable; draw-line / reject-no-slot / win / lose tests need canvas drag, baseline state capture or a full playthrough = not executable by Kane. Unmeasurable ACs correctly put in gaps; no hallucinated UI names.
- Gotchas: `--max N` did not bind in design; tight `--timeout` on an authoring run wasted ~18 credits (killed mid-step, still billed); `cover` errors "no evidence pack" until a test run completes; `maintain` not tried (costs credits; unverified); designed tests verify still-derived ACs (warning only).

### Option 3: AI playtester
- Canvas drag (A2a/A2b/A2c): Kane drag = vision grounding with fallback to viewport centre; log shows `click_drag (960,540)->(960,540)`. Coordinates in prompt ignored; invisible DOM hit-proxies ignored for drag. Kane still reported success (A2a, A2c): silent false-PASS. Only the pixel-coords + `--assertion-mode visual` run failed honestly. See [A2a](kane-cli/img/A2a_false_positive_drag.jpg), [A2c](kane-cli/img/A2c_proxy_drag_false_positive.jpg).
- Canvas read (A3): number read from canvas via vision works but drifts in real time (stored 21, frame showed 27); use `?test=1` frozen mode.
- Headless WebGL renders: [A1](kane-cli/img/A1_webgl_battle_headless.jpg) (DOM nav through real 3D battle, PASS 26 credits).
- DOM-control playtester (D): [na-ctl-inject.js](kane-cli/harness/na-ctl-inject.js) panel with "Select b0" / "Send to b3" buttons. Playwright ground truth ([D0](kane-cli/img/D0_playwright_groundtruth_lane.jpg)): `__na.commandLog` has `DrawLine player 0 from 0 to 3`. Kane run D1 (6 steps: navigate, 2 clicks, visual check, 2 asserts) PASS genuine, 15.8 credits / 76s; CDP watcher confirmed the human command reached the sim. [D1](kane-cli/img/D1_dom_click_playtester_final.jpg).
- Gotchas: `__na.submit` needs NUMERIC building ids (`from:0,to:3`); string ids give `CommandRejected reason=malformed` yet `submit()` still returns non-null, so read accept/reject from `__na.events` after the next tick (~600ms); Kane cannot read `__na` (no JS eval) so ground truth must come from outside; label ambiguity (asked for "labelled 2", clicked b2 not b3); AI acted before the human command (10s/step latency) so use frozen/fast mode; DOM control panel must exist only in test builds.
- Never trust a Kane PASS on game actions without ground truth.

### Credits (measured)
| Run | Credits (`run_end`) | Wall |
|---|---|---|
| A0 picker sanity | 13.2 | 35s |
| A1 DOM nav, 10 steps | 26.3 | 142s |
| A2a/b/c canvas drag attempts | 18.8 / 19.7 / 17.7 | 74-100s |
| A2d click via proxy | 14.8 | 67s |
| A3 read canvas number | 12.0 | 53s |
| A5 authoring nav_test (2 steps) | 31.0 | 81s |
| A5 replay | 0 | 24s |
| Failing replay | ~1.3 | 28s |
| Assurance extract | 7.4 | 44s |
| Assurance design per use-case | 13.0 / 21.1 / 19.0 | 47-110s |
| Assurance run t-1 (killed by timeout) | 29.0 billed (10.6 step 1 + ~18 for unfinished step 2) | - |
| D1 DOM-click playtest | 15.8 (17.5 balance delta) | 76s |

- Total spent ~283 of 1200; balance 917.04. Balance delta ~1-2 above `run_end` per run.
- Rules of thumb: authoring ~3 credits/step (15-30 per short test); replay free; design ~15-20 per use-case.
- 1K credits tomorrow ~ 40 short authored tests, or ~10 use-cases designed + ~15 authored tests; replays unlimited. Pro trial quota (12,000/month) is far above this; hack-day credit allotment unverified.

## Hack-day plan (2026-10-24)
Recommended demo combo (derived from verdicts): **Stop-hook replay loop (1) + Assurance cover on rules excerpt (2) + DOM-control playtester via test-only accessible tower controls (3 workaround)**. Demo arc: Claude changes HUD/level -> Stop hook replays Kane tests -> fail -> Claude fixes -> pass -> `kane-cli cover` shows proven vs owed.

### Pre-flight checklist (tonight / 9 AM)
- `npm i -g @testmuai/kane-cli`; `kane-cli login`; `whoami`; `kane-cli balance` (expect 900+; confirm hack-day credits).
- `KANE_CLI_CHROME_PATH` set to Playwright chromium; `kane-cli run` one example headless.
- `pnpm install && pnpm build:prerequisites`; `pnpm --filter ./apps/web build:test`; `preview:test` serving 4173 (curl check).
- Re-check `kane-cli --version`; retest canvas drag once if a newer version ships (cheap: ~18 credits).
- Backup: record a full successful run (screen recording + evidence pack) before the demo.

### Build checklist (ordered; estimates are guesses)
1. Pick hack-day branch; copy [kane-cli/hook/](kane-cli/hook/) into real tooling (e.g. `tools/`), fix paths; no spike file is imported as-is (~20 min).
2. Test-only DOM control panel behind `VITE_TEST_HOOKS` (accessible buttons per building, numeric ids, accept/reject read from `__na.events`); based on [na-ctl-inject.js](kane-cli/harness/na-ctl-inject.js) (~45 min).
3. Author 3-5 short Kane tests (nav, dialog, select+send, `fixture=win` -> "Victory!", `fixture=loss` -> "Defeat") with `?test=1` frozen mode; ~30 credits each (~60 min).
4. Wire Stop hook in `.claude/settings.json`; test pass, fail, skip paths; end-to-end block path with Claude fixing a deliberate break (~30 min).
5. Assurance: ingest real `GAME_RULES.md` slice (+UI-facts appendix), extract, review, design only DOM-observable use-cases, run, `cover` / `cover gaps` (~45 min, ~100 credits).
6. Cross-check: Playwright/`__na` ground-truth assertion alongside each Kane game-action test (~20 min).
7. Rehearse the demo 10 AM vs after; record backup run (~30 min).

### Risks / fallbacks
- Silent false-PASS on game actions: only assert DOM/HUD or ground-truthed outcomes; say so in the demo.
- Real-time drift and 10s/step latency: use `?test=1`, frozen speed, `fixture=` hooks.
- Credits: do not kill authoring runs with tight timeouts; keep tests short; `--no-adaptive-heal`.
- Licensing: screenshots upload to TestMu cloud and share links open without project access; avoid TW-derived art; use original/`sample.json` content and never commit share links.
- Venue wifi / third-party outage: keep the recorded backup run and replay evidence offline (`kane-cli evidence serve`).
- Block path of the Stop hook not proven end-to-end; test it early.

### Not possible
- Canvas drag / free-form canvas clicks by Kane (as of 0.9.0).
- Reading `window.__na` / JS eval from Kane; deterministic real-time play.
- Trusting Kane assertions on gameplay without ground truth.
- Mobile track (out of scope) and PvP two-session demo (multiplayer not built).
- Installing kane-cli with pnpm.

## KaneAI Pro (free 3 months for attendees)
Plan: 12,000 credits/month per agent; Cloud KaneAI Web; 1 concurrent cloud authoring session; local authoring via Kane CLI; 1 Test Manager seat; AI-native test generation; 100 HyperExecute minutes/month (Linux/Windows/macOS); latest Pro features.

Verdict: use it (free, low downside), but as a supplement — Claude Code + Playwright already covers most value.
- Plain terms: write a test in English; an AI drives a real browser/phone; you get pass/fail, screenshots, logs, a share link; optionally Playwright code.
- Credits: each run reports `credits_consumed`; measured ~13-31 per authored run (~3/step), replay 0, failing replay ~1.3 (details in spikes credits table). Balance delta is ~1-2 above `run_end` per run.
- HyperExecute 100 min/month: enough to try cross-OS, not real CI.
- Strong: resilient selector-free tests; fast smoke tests of any site; evidence reports for non-engineers/clients; requirement-to-test traceability (Assurance); mobile and cross-OS coverage.
- Weak: slower (~10s per LLM step) and less deterministic than Playwright (flaky as a strict gate); canvas/WebGL input broken (drag) and assertions can false-PASS; uploads screenshots to cloud (bad for private/licensed projects); lock-in and credit dependence after trial; overlaps with agent-written Playwright.
- Good uses: normal web UIs (dashboards, SaaS, forms, logins) — post-agent-change smoke checks; author in English then export to Playwright and keep that; occasional mobile/cross-browser checks; client/demo projects needing proof links.
- Less useful: game rendering, backend-only, sensitive data.
- Before relying: check trial auto-renew / card requirement; measure credits per run; export to Playwright so nothing breaks when the trial ends.
