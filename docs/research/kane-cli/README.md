# Kane CLI spike artifacts (2026-10-23)

Throwaway artifacts from the live feasibility spikes in [../kane-cli.md](../kane-cli.md#live-feasibility-spikes-2026-10-23). Reference/starting material only.

**Not wired into repo tooling or CI.** Hack-day rule: Kane integration must be built on the day (2026-10-24); nothing here is imported by `package.json`, `tools/` or workflows. Secrets (username, access key, share links, session ids) were stripped; paths are placeholders.

- [hook/kane-verify.sh](hook/kane-verify.sh) — Claude Code Stop hook: replays saved `*_test.md` with `kane-cli testmd run --headless --agent --no-adaptive-heal`; exit 2 + stderr on fail; `stop_hook_active` guard; skips (exit 0) if no server on 4173/5173.
- [hook/settings.example.json](hook/settings.example.json) — Stop-hook wiring (replace the `/ABS/PATH`).
- [tests/nav_test.md](tests/nav_test.md) — authored 2-step nav smoke test (level 1 -> back dialog), replays free.
- [assure/](assure/) — Assurance spike: `rules-excerpt.md` (R-LIN-01, R-WIN-01..03 + UI-facts appendix) and the 5 generated `*_test.md` (only the open-dialog test is runnable as written).
- [harness/na-ctl-inject.js](harness/na-ctl-inject.js) — probe: injects a DOM control panel ("Select b0", "Send to bN") calling `__na.submit`; was injected into a COPY of `dist-test/index.html`. Proves Kane can play via DOM buttons. Building ids must be numeric.
- [run-kane.sh](run-kane.sh) — wrapper: one headless agent run, balance before/after, `run_end` summary. Sets `KANE_CLI_CHROME_PATH` to Playwright chromium.
- [img/](img/) — evidence screenshots (A1 headless WebGL, A2a/A2c false-PASS drags, D0 Playwright ground truth, D1 DOM-click playtester).

Prereqs: `npm i -g @testmuai/kane-cli` (0.9.0), `kane-cli login`, `jq`, app served via `pnpm --filter ./apps/web build:test` + `preview:test` on 4173.
