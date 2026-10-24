---
status: draft
summary: Kane inside the dev workflow three ways - opt-in Claude Code Stop hook that replays saved Kane tests (0 credits), an assurance pipeline (rules excerpt + panel facts -> cover), and a non-blocking GitHub Actions replay job.
date: 2026-10-24
---
# PRD: 04 Workflow integrations (Stop hook, assurance, CI)

Repo/branch: node-arena, `feat/kane-hackday` · Depends on: 03-kane-driver (saved tests, `replay.mjs`, `kane:credits`), transitively 01/02 · Parallel with: 05 · Brief: [brainstorm.md](../brainstorm.md) (locked)
Owns: `tools/kane/hooks/**` (`kane-verify.sh`, `settings.example.json`, `README.md` incl. demo script), `tools/kane/assure/**` (`build-excerpt.mjs`, `ui-facts.md`, `run.sh`, committed outputs), `.github/workflows/kane-replay.yml`, `.gitignore` lines for assure scratch
Does not own: `tools/kane/{drive,replay}.mjs`, `tools/kane/tests/**`, `tools/kane/README.md` (03); game DOM/hooks (02); GAME_RULES (not touched, no `RULES_VERSION` change)

## TL;DR
(1) `tools/kane/hooks/kane-verify.sh` is a Stop hook, installed by owner only: if `apps/web` changed it rebuilds the test bundle, runs `node tools/kane/replay.mjs --serve`, and exits 2 with Kane's failure on stderr so Claude fixes it; skips on infra problems, loop guard honoured. (2) `tools/kane/assure/` builds an excerpt of R-LIN + R-WIN rules plus panel UI facts and runs ingest -> extract -> review -> design -> testrun -> `cover`; ~150 credits, cuttable after `design`. (3) `kane-replay.yml` replays the saved tests on PRs touching `apps/web/**`, `continue-on-error`, owner supplies `LT_*` secrets.

## Problem
Kane is only a demo toy unless it sits in the loop where code is written. Spikes proved the pieces (hook, assure pipeline, replay at 0 credits) against the old UI; they live in `docs/research/kane-cli/` and are explicitly "not wired" [verified: research README]. They must be rebuilt against the real panel (02) and tests (03), without slowing other agents' sessions or gating merges on a slow, nondeterministic tool.

## Goals / Non-Goals
Goals: demo arc "Claude changes UI -> hook fails -> Claude fixes"; a `cover` ribbon traceable to `R-LIN-*`/`R-WIN-*`; a CI job that proves replay works on a clean runner.
Non-goals: always-on project hook; required CI check; Playwright export (`testmd export` exists, [DEFERRED]); changing rules or panel; hosted stream (05).

## Requirements

### R1 Stop hook (`tools/kane/hooks/kane-verify.sh`)
Flow (all steps exit 0 unless noted), derived from the spike hook [verified: read `docs/research/kane-cli/hook/kane-verify.sh`]:
1. Read stdin JSON; `stop_hook_active==true` -> exit 0 (loop guard).
2. Dependencies (`jq`, `kane-cli`, `node`) missing -> stderr note, exit 0.
3. Fast path: `git status --porcelain -- apps/web` empty (tracked + untracked; `KANE_WATCH` overrides the pathspec) -> exit 0. Skip also if the sha1 of `git diff HEAD -- apps/web` equals the last PASSED state (cache file in `${TMPDIR}/kane-hook-<repo-hash>`), so repeated Stops on an unchanged tree cost nothing.
4. Build: if `apps/web/dist-test` is older than any file in `apps/web/src` (or missing) run `pnpm --filter @node-arena/web build:test` (includes `tsc --noEmit`). Build failure -> exit 2, stderr = last 30 lines (a type error is a legitimate failure to feed back).
5. `node tools/kane/replay.mjs --serve` (starts `preview:test` on 4173 itself, stops it after). Exit map: `0` -> record state, exit 0; `1` -> exit 2, stderr = replay's failure lines (test, status, reason, session dir) + hint `kane-cli evidence serve <session_dir>/evidence/*.evidence`; `2` (infra: server/kane/auth) -> stderr "skipped", exit 0.
6. Time budget: `KANE_TIMEOUT` per test (default 120, passed through; never lower, killed runs are billed), settings `timeout: 360`. Hook never calls `kane-cli run`/authoring flags: 0 credits (a failing replay ~1.3 credits [verified: research]).
Env: `KANE_HOOK_LOG` (fire log, as spike), `KANE_HOOK_FORCE=1` (skip fast path/cache; used by demo and tests), `KANE_HOOK_NOBUILD=1`.

Tests live at `4173` because saved tests carry `url: http://localhost:4173/?kane=1...` and a CLI `--url` override did NOT change replay (recorded navigate wins) [verified: research hook gotchas]. So the dev server (5173) cannot be the verification target; hence build + preview.

Install (opt-in, never active in this repo): `tools/kane/hooks/settings.example.json` (Stop hook entry, `command` = `"$CLAUDE_PROJECT_DIR"/tools/kane/hooks/kane-verify.sh`, `timeout: 360`). Owner merges it into `.claude/settings.local.json`, which is globally git-ignored here [verified: `git check-ignore` -> `~/.config/git/ignore`]. Nothing is added under `.claude/` in the repo.

Demo script (`tools/kane/hooks/README.md`, rehearse once): start Claude Code in the repo with the hook installed; prompt "In `apps/web/src/kane/Overlay.tsx` change the ready-state button word from 'ready' to 'go'" -> Claude edits, tries to stop -> hook builds, replay fails (test clicks button containing `ready`) -> stderr shows failing step -> Claude reverts/fixes -> next Stop (or presenter's follow-up message, since `stop_hook_active` is false again on a new turn) passes. Expect ~1-2 min per hook run.

### R2 Assurance (`tools/kane/assure/`)
Input excerpt (generated, committed): verbatim `### R-LIN-01..05` and `### R-WIN-01..03` blocks from `docs/GAME_RULES.md` (extracted by heading regex so it cannot drift [verified: grep '^### R-(LIN|WIN)-' -> LIN-01..05 at lines 237-291, WIN-01..03 at 497-525]) + hand-written `ui-facts.md` appendix in the same spirit as the spike [verified: `docs/research/kane-cli/assure/rules-excerpt.md`], rewritten for 02's panel: URL `/?kane=1` opens the Kane level; bottom panel groups by source letter header `A (blue 20)`; button text `A → C · ready · C: grey 5` (green), `A → C · active` (red; double-click cuts), `A → B · no free route` (grey; clicking shows a red alert banner); after a match a result dialog shows `Victory!` / `Defeat`; panel disabled with banner `Game over`; buildings/lines are WebGL, not DOM. Facts quote 02's R2 text contract; if 02 changes strings the appendix must follow (A-1).

Pipeline (`tools/kane/assure/run.sh <stage>`; cwd = `tools/kane/assure/`, so `.context/` and `output-*/` stay there; all calls `</dev/null`, `--mode agent` per spike):
| Stage | Command (CLI verified via `--help`) | Credits (measured in spike) |
|---|---|---|
| excerpt | `node build-excerpt.mjs > excerpt.md` | 0 |
| ingest | `kane-cli context ingest excerpt.md --mode ci` | 0 |
| extract | `kane-cli context extract --mode agent` | ~7 |
| review | `kane-cli context review --approve <refs>` (refs from `context list --json`) | 0 |
| design | `kane-cli design tests --use-case <uc> --mode agent --max 3` per use-case | 13-21 each |
| testrun | `kane-cli testrun run <designed *_test.md> --agent --no-adaptive-heal` (authors first run, ~3/step) | ~60-90 |
| cover | `kane-cli cover gaps` then `kane-cli cover --mode agent` | 0 |
Total target ~150, hard stop at balance < 200 (reuses 03's `pnpm kane:credits`). Server on 4173 required for testrun (same `--serve`-style preview).

What the demo shows: `kane-cli cover gaps` ribbon "designed x proven" per use-case. Expected honest result: draw / cut / reject use-cases designed AND proven (panel makes them DOM-observable); win/lose use-cases designed but "owed" (need a full playthrough; the live Kane demo is the proof, not an evidence pack) [OPEN O3]. Snapshot of the final output committed as `tools/kane/assure/cover-<date>.txt`.
Cut order (brief): drop testrun/design runs, keep `cover gaps` from whatever is designed (spike: designed 55%, proven none, `cover` needs a completed run for "proven" [verified: research]). Committed designed tests/`.context` export reused for the ribbon.

### R3 CI (`.github/workflows/kane-replay.yml`)
Conventions copied from `ci.yml`/`balance.yml`: pinned action SHAs, Node 22, `pnpm install --frozen-lockfile`, `pnpm build:prerequisites`, `permissions: contents: read`, Chromium via `pnpm --filter @node-arena/web exec playwright install --with-deps chromium` [verified: read ci.yml, balance.yml].
- Triggers: `workflow_dispatch`; `pull_request` with `paths: [apps/web/**, tools/kane/**, packages/content/data/{levels/na-kane.json,campaigns/kane.json}, .github/workflows/kane-replay.yml]`. `concurrency` group per ref, cancel-in-progress (1 concurrent Kane session per plan).
- Job: `continue-on-error: true`, `timeout-minutes: 20`. Never listed as a required check (owner step).
- Steps: checkout -> pnpm/node setup -> install -> `build:prerequisites` -> Chromium install + export `KANE_CLI_CHROME_PATH` = Playwright chromium executable path -> `npm i -g @testmuai/kane-cli@0.9.0` (npm only; pnpm global unsupported [verified: research]) -> **gate**: if `LT_USERNAME`/`LT_ACCESS_KEY` empty (forks, secrets not yet added) write a step-summary "skipped: no Kane credentials" and end green -> `kane-cli login --username "$LT_USERNAME" --access-key "$LT_ACCESS_KEY"` (flags verified `login --help`; secrets only via `env:`, never echoed) -> `pnpm --filter @node-arena/web build:test` -> `pnpm kane:replay -- --serve` -> always: upload `kane-artifacts` (session dirs under `~/.testmuai/kaneai/sessions`, replay stderr, `tools/kane/tests/output-*`), 7-day retention, and write pass/fail table to `$GITHUB_STEP_SUMMARY`.
- Replay exit `2` (infra) -> summary "infra, not a test failure", job green; exit `1` -> job red but non-blocking.
- Fresh-checkout replay [OPEN O1]: assumption = replay needs the recorded steps in `output-<stem>/` next to the test (`testmd status` reads local `meta.json`; `testmd delete` removes `output-<stem>/` with the test [verified: `testmd --help`]), so those dirs are committed with the tests (03 manual step already says "if needed"). Unverified; no `output-*` dir exists locally to inspect [verified: find -> none]. Fallback if replay on a clean clone tries to re-author: `--no-adaptive-heal` makes it fail instead of spend, and CI documents it as "needs `testmd sync`/commit of outputs".

## Architecture
```
Claude Stop ──> hooks/kane-verify.sh ──(apps/web changed?)──> pnpm build:test ──> tools/kane/replay.mjs --serve ──> kane-cli testmd run (0 cr)
                      └ exit 0 pass/skip · exit 2 stderr -> Claude                         ▲ saved tests + output-*/ (03)
Actions ───────> kane-replay.yml ──> same build + replay.mjs ──> artifacts/summary
assure/run.sh ─> GAME_RULES.md + ui-facts.md ─> kane-cli context/design/testrun/cover ─> cover ribbon (+ committed snapshot)
```
Interfaces consumed (03): `node tools/kane/replay.mjs [--serve] [tests...]`, exit `0/1/2`, failure stderr format; `pnpm kane:credits` -> `{"credits":N}`; `tools/kane/tests/*_test.md`. (02): panel text/state contract only via the appendix. No new `package.json` scripts owned by 04 beyond optionally `kane:assure` -> `tools/kane/assure/run.sh` (root `package.json` is shared with 03; add the line after 03 lands).

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Hook verification target | rebuild `dist-test` + preview 4173 | verify against dev server 5173 | recorded test URL is 4173 and `--url` does not override replay |
| 2 | Fast path | `git status`/diff-hash on `apps/web`, cache last pass | session-transcript parsing | cheap, deterministic, no transcript format dependence |
| 3 | Loop guard | honour `stop_hook_active` strictly (exit 0) | allow N retries | brief + spike-proven; fix is re-verified on next turn/CI |
| 4 | Infra problems | exit 0 with stderr note | block | must not trap the model (spike behaviour) |
| 5 | Settings install | example file under `tools/kane/hooks/`, owner merges into `settings.local.json` | commit `.claude/settings.json` | opt-in, other agents' sessions unaffected |
| 6 | Excerpt source | generated from GAME_RULES by heading regex + hand appendix | copy/paste excerpt | no drift, GAME_RULES untouched |
| 7 | CI strictness | `continue-on-error`, not required, skip without creds | required gate | Kane ~10 s/step, nondeterministic |
| 8 | Kane install in CI | `npm i -g @testmuai/kane-cli@0.9.0` | latest, pnpm | pinned to measured version; pnpm unsupported |

## Manual steps
Owner-only: (a) `npm i -g @testmuai/kane-cli`, `kane-cli login` on any machine running the hook/assurance (token valid here); (b) add repo secrets `LT_USERNAME`, `LT_ACCESS_KEY` (without them CI job self-skips green); (c) merge `settings.example.json` into `.claude/settings.local.json` to enable the hook; (d) leave `Kane replay` out of required checks; (e) confirm credits for assurance (~150) and top up if needed.

## Risks / Open Questions
- [OPEN] O1 Replay portability: are authored steps in `output-<stem>/` (committed) or Test Manager cloud? Decides whether CI needs commit-outputs, `LT_*` only, or `testmd sync pull`. Resolve by `testmd status` + replay from a clean clone right after 03 authors tests; blocks the CI acceptance run.
- [OPEN] O2 `build:test` wall time (tsc + vite) on this machine/CI; if >60 s the hook budget needs raising or build skipped when `dist-test` is fresh (already in R1.4). Measure once.
- [OPEN] O3 Whether `cover` can credit a win/lose use-case from the live playtester run (`cover --from <pack>`); else they stay "owed" (acceptable and honest). Also where `design tests` writes `*_test.md` (assume cwd) and exact `context list --json` ref format for headless review.
- [OPEN] O4 Does `kane-cli login --username --access-key` accept non-TTY CI use as documented (`LT_*` env auto-pickup unverified); confirmed only by first CI run.
- [OPEN] O5 Is the hook demo's "Overlay.tsx" path/button word final in 02? Use whatever 02 ships; README names it.
- [OPEN] A-1 Appendix strings are copied from 02's contract; 02/03 string changes silently stale the assurance tests (`maintain` untried).
- [RESOLVED: 03's `--cdp-endpoint` attach OPEN] brief Probe 2 verified attach works; irrelevant to replay/hook, which use plain `testmd run`.
- [DEFERRED] Retry-once on hook, Playwright export for CI parity, `maintain` run, Test Manager link in PR comments.

## Acceptance Criteria
- Hook: with 03's tests and a green build, `echo '{"stop_hook_active":false}' | KANE_HOOK_FORCE=1 tools/kane/hooks/kane-verify.sh` exits 0 in <180 s and balance unchanged (`pnpm kane:credits`, +-0.01); with `stop_hook_active:true` exits 0 in <1 s; with no `apps/web` changes exits 0 without invoking `kane-cli`; with a button word changed exits 2 and stderr names test, status, reason, session dir; with `preview:test` unable to start / kane-cli unauthenticated exits 0 with "skipped".
- `jq . tools/kane/hooks/settings.example.json` valid; repo has no `.claude/settings*.json` change (`git status`).
- Assurance: `tools/kane/assure/run.sh excerpt` output contains `R-LIN-01..05`, `R-WIN-01..03` and the appendix (`grep -c '^### R-'` = 8); through `cover` the pipeline finishes with `kane-cli cover gaps` showing designed >0 and a committed snapshot; credits spent <= 200 and floor respected.
- CI: `actionlint` clean; `workflow_dispatch` run on the branch uploads `kane-artifacts` and ends non-red when secrets are absent (summary says skipped) and, with secrets set, `kane:replay` exit 0 on a clean runner (confirms O1); job marked `continue-on-error` and not required.
- `git diff` shows no change to `docs/GAME_RULES.md` or `RULES_VERSION`.
