---
status: in-progress
summary: SP09 tasks — Phase A parked-CI scaffold first, incremental gate rewires/deletions per SP, Phase D docs + check:docs, Phase C final acceptance
date: 2026-10-23
---
# Tasks: Gates, tooling, docs (SP09)
Source of truth: [PRD.md](PRD.md). Canonical program lineage: [original SP09 plan](../../feat-tower-war-port-20261022-0321/09-gates-tooling-docs/PRD.md). Task 0 runs first in the whole program (before SP01). Tasks 1-7 are incremental follow-ups that ride alongside other SPs; 8-9 are Phase D (docs); 10-11 are Phase C (final acceptance). Every rewritten gate ships with a failing-fixture test (PRD req 3).

| # | Task | Depends on | Status |
|---|---|---|---|
| 0 | Phase A: parked-step CI runner, per-package scripts, VERSION_GUARD_BASE, check:parked | none (runs before SP01) | done |
| 1 | Delete v1 tools-owned tooling (layout, v1 solutions, balance-targets) | 0, 02 CUT / 03#1 | done |
| 2 | Adapt replay.ts to v2 header; restore tools:replay | 0, 03 | done |
| 3 | Rewrite validate:levels + levels-lock + unsolved-by-proxy | 0, 03, 05, 06 (R6 follow-up) | in-progress |
| 4 | Rewrite balance (report-only) | 3, 06 | done |
| 5 | Delete bots:churn, visual harness, slice:verify | 06, 08 | partial |
| 6 | campaign:verify | 08, 5 | todo |
| 7 | CI workflow updates + env-skip surfacing | 0, 05, 07, 3, 4 | todo |
| 8 | check:docs gate | 0, 5 | todo |
| 9 | Docs refresh (README, tools/README, FUTURES, AGENTS, CREDITS check, research index, web README) | 8, 07, 08, 5 | todo |
| 10 | Final acceptance: full CI on Node 22 + 24, strict parked, perf | 1-9, all SPs | todo |
| 11 | Campaign + owner pass hand-off | 10 | todo |

## Task 0 — Phase A: parked-step CI runner
What it is / what it means: The scaffold that makes a long red window explicit instead of silent (Decisions 1, 2, 2b). Runs before SP01 so `pnpm run ci` is green at every later commit.
What changes at a high level: `scripts/ci.sh` becomes a named-step runner with a `PARKED` list (gate -> owner SP; parked step prints `PARKED(SPnn) <gate>` and is skipped). Root `typecheck`/`build` split per package so a parked package is skipped, not broken. `VERSION_GUARD_BASE` env (default unchanged) honoured by sim and bots golden scripts and content lock / `check:content`; ci.sh sets it to the branch merge-base, release runs without it. `check:parked` tool: lists, `--strict` fails if non-empty, enforced last only when `CI_RELEASE=1`. Document the initial SP01 and CUT park lists for those SPs to apply.
Done when: `ci` is green on the pre-SP01 tree with an empty list; guard base env demonstrably changes version-bump comparison; `check:parked` has a test for both modes.

## Task 1 — Delete v1 tools-owned tooling
What it is / what it means: Removes tooling with no TW meaning (Decisions 3, 6); per-band targets and hand-mirrored layouts do not exist in v2.
What changes at a high level: Delete `tools/layout`, `layout` script and test, v1 solution replays (keep dir + README), `balance-targets.*` and its code/tests. Parked files stay under `_parked/` where still needed by later tasks.
Done when: those paths are gone, `ci` green with the CUT park list, grep for the names finds nothing outside excluded paths.
Status note (2026-10-22): done by 06 Task 8 (c16aa54); remaining: none (tools/layout, balance-targets.*, v1 solutions removed; solutions/README.md kept).


## Task 2 — Adapt replay.ts to v2
What it is / what it means: `replay:verify` must understand the v2 replay header and scan sim + bots goldens (inventory row, SP03 window).
What changes at a high level: Update `tools/src/replay.ts` and tests to v2 header; restore from `_parked`; wire the `golden` alias. Bots goldens join once 06 lands.
Done when: `replay:verify golden` green over sim goldens; corrupted-fixture test fails; `tools:replay` and `replay:verify` removed from PARKED in the same window as 03.

## Task 3 — validate:levels, levels-lock, unsolved-by-proxy
What it is / what it means: Level gate redefined per PRD req 4-5: TW AI as human proxy; no bands, no `requiredWins`. Lands in the same follow-up as SP06 (R6).
What changes at a high level: Rewire `levels.ts` per level over seeds (default 4): proxy run ends with 0 rejects and a stable seed-1 rerun hash; idle never wins; solvable = any win over proxy AD 500/1000/2000, else listed in `tools/unsolved-by-proxy.json` (id, reason, owner sign-off) and printed as a warning. Assert `common.json` lists exactly the files in `data/levels`. Add `levels:lock` and `tools/levels-lock.json` (outcome, final tick, hash per level, seed 1). Measure CI time after SP06; drop to 2 seeds if over budget.
Done when: all 20 levels pass; failing-fixture tests (nonterminating, rejects, idle win, lock mismatch); `validate:levels` unparked.
Status note (2026-10-22): done by 06 Task 8 (c16aa54); remaining: failing-fixture tests for nonterminating, rejected-commands and idle-win cases absent in tools/test/levels.test.ts (lock-mismatch and unsolvable fixtures exist); decide/record that capped (20000-tick) runs count as Capped, not failures, so termination is not enforced; levels-lock equality on Node 22 and 24 (Task 10).


## Task 4 — Rewrite balance (report-only)
What it is / what it means: Report-only balance table, no targets (Decision 3, req 6).
What changes at a high level: Rows per level x proxy AD 1000/2000/4000 + idle; header carries rules/content/BOT versions; exit 0 on stats; `--jobs 1|2` output stays byte-identical; `arena` all-`tw` restored from `_parked`.
Done when: `balance` runs, byte-identical jobs test passes, entry removed from PARKED.
Status note (2026-10-22): done by 06 Task 8 (c16aa54); remaining: none (proxy AD 1000/2000/4000 + idle, arena mode, byte-identical --jobs test, PARKED entry removed).


## Task 5 — Delete bots:churn, visual harness, slice:verify
What it is / what it means: Remove v1-only gates (Decisions 4, 8) once the owning SPs have replaced them.
What changes at a high level: Delete `bots:churn`, `churn.mjs`, baseline; `visual:*` scripts and `apps/web/visual/**`; `slice:verify` and `slice.spec.ts`. Coordinate with 06/08 so nothing live references them.
Done when: grep for `bots:churn`, `visual:`, `slice:verify` (excl. `agent_files`, research 06a) returns nothing; ci green.
Status note (2026-10-23): partial. SP06 removed bots:churn; SP08 merge c41e415 deleted apps/web/visual/** and its scripts. Remaining: root and web slice:verify scripts, apps/web/e2e/slice.spec.ts, and live README/AGENTS references. Keep partial until those paths/references are removed.


## Task 6 — campaign:verify
What it is / what it means: Opt-in owner-run replacement for the v1 slice (Decision 8).
What changes at a high level: Using 08's harness, Playwright loads each of 20 levels via `?level=` by `levelId`, runs 5 s, fails on any console error, writes a screenshot grid to `test-results/campaign/`.
Done when: 20/20 load and run clean; grid saved; negative fixture (injected console error) fails.

## Task 7 — CI workflow updates
What it is / what it means: Keep CI shape; make private/local-only checks non-blocking (req 8, Decision 7).
What changes at a high level: `ci.yml` keeps Node 22+24 matrix and Chromium; `check:import` / `assets:tw:check` print `skipped (TW_EXTRACT unset)`, exit 0, surfaced as `::notice::` in ci.sh, never required; `check:manifest` validates committed asset hashes against the lock without extract; Playwright job keeps `test:web:all` with `timeout-minutes`; `balance.yml` uses new proxy flags. Plain git, no LFS.
Done when: workflow files updated and lint-clean; ci with `TW_EXTRACT` unset shows skips and passes.
Status note (2026-10-22): balance.yml part done by 06 Task 8 (c16aa54; new proxy flags); remaining: ci.yml/env-skip surfacing (::notice::), check:manifest without extract (SP07), Playwright job timeout.


## Task 8 — check:docs gate
What it is / what it means: Doc-drift gate (Decision 9, req 7); cheap, no network.
What changes at a high level: `tools/src/docs-check.ts`: every root script is mentioned in `tools/README.md` or `AGENTS.md`; backticked repo paths in README, tools/README, CONTENT_GUIDE, LEVELS_GUIDE, CREDITS exist; no links to deleted names. Add to ci.sh as a late step (parked until Phase D docs land).
Done when: passes on the refreshed docs; fixtures with a stale path / deleted name fail.

## Task 9 — Docs refresh
What it is / what it means: Phase D; docs match code.
What changes at a high level: Rewrite README (contents, TW scope, 20 levels, local-only, `TW_EXTRACT`, TW screenshots copied to `docs/img/`, delete v1 images); rewrite `tools/README.md` (gate semantics, env skips, `levels:lock`, parked pointer); merge into FUTURES (never replace 04/06 entries): walls, mines, water, rocket towers, fortress, trolley, railway, unit modules, boosters (facts recorded), tutorials, meta, PvP, skins, cargo, deploy, levels 24+, portrait/mobile, level editor, new themes, `CrossingSource` note, bundle-size gate; update AGENTS project section only; research index; trim `apps/web/README.md`; cross-links in CONTENT_GUIDE; verify CREDITS header (Vaveda art, private, non-redistributable, CC0 rows).
Done when: `check:docs` green; no edits to Style/Orchestrator sections.

## Task 10 — Final acceptance (automated)
What it is / what it means: Phase C proof the whole program is releasable.
What changes at a high level: Remove remaining PARKED entries; run `pnpm install --frozen-lockfile && pnpm run ci` on clean clone with Node 22 and 24, Chromium, `TW_EXTRACT` unset, `CI_RELEASE=1` (strict parked) and without `VERSION_GUARD_BASE`; confirm `levels-lock.json` equal on both Nodes; `bench:sim` in budget at 720 troops, `bench:bots` reported, 07 perf scene budgets pass.
Done when: all green on both versions; PARKED empty; results recorded in code-run artifact.

## Task 11 — Campaign run and owner pass hand-off
What it is / what it means: Last agent-side step; the real solvability and feel check is the owner's.
What changes at a high level: Run `campaign:verify`; create `owner-pass.md` checklist (mechanics feel, readability, level order/difficulty, results flow, visual approval, fps measured, unsolved-by-proxy sign-offs).
Done when: 20/20 campaign levels clean, grid saved, checklist file ready.

## Owner steps (not agent tasks)
- Locally run `TW_EXTRACT=... pnpm check:import && pnpm assets:tw:check` before merge.
- Play levels 1-20 (positions 4-23) in browser; fill `owner-pass.md`; visual approval vs refs; record fps; sign off any `unsolved-by-proxy.json` entries.
