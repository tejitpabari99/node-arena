---
status: draft
summary: Kane CLI (TestMu AI) research — what it is, hack-day goal, Node Arena integration options ranked, KaneAI Pro value
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
- Not documented: localhost/tunnel support, canvas/WebGL interaction, max steps, pricing per run.

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
- Verify before event (throwaway, don't commit — integration must be built on the day): Kane can reach `localhost`; Kane can click inside the canvas.
- Owner-only: `kane-cli login`, OpenAI account, registration confirmation.

## KaneAI Pro (free 3 months for attendees)
Plan: 12,000 credits/month per agent; Cloud KaneAI Web; 1 concurrent cloud authoring session; local authoring via Kane CLI; 1 Test Manager seat; AI-native test generation; 100 HyperExecute minutes/month (Linux/Windows/macOS); latest Pro features.

Verdict: use it (free, low downside), but as a supplement — Claude Code + Playwright already covers most value.
- Plain terms: write a test in English; an AI drives a real browser/phone; you get pass/fail, screenshots, logs, a share link; optionally Playwright code.
- Credits: each run reports `credits_consumed`; cost per run unknown — measure with `kane-cli balance` after a few runs.
- HyperExecute 100 min/month: enough to try cross-OS, not real CI.
- Strong: resilient selector-free tests; fast smoke tests of any site; evidence reports for non-engineers/clients; requirement-to-test traceability (Assurance); mobile and cross-OS coverage.
- Weak: slower and less deterministic than Playwright (flaky as a strict gate); weak on canvas/WebGL; uploads screenshots to cloud (bad for private/licensed projects); lock-in and credit dependence after trial; overlaps with agent-written Playwright.
- Good uses: normal web UIs (dashboards, SaaS, forms, logins) — post-agent-change smoke checks; author in English then export to Playwright and keep that; occasional mobile/cross-browser checks; client/demo projects needing proof links.
- Less useful: game rendering, backend-only, sensitive data.
- Before relying: check trial auto-renew / card requirement; measure credits per run; export to Playwright so nothing breaks when the trial ends.
