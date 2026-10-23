---
status: approved
summary: Inventory every script/tool/gate/workflow (keep/rewrite/delete), redefine each gate for Tower War, land a "parking" scaffold in ci.sh before SP02's CUT so the red window is explicit and shrinking, then close it SP by SP; docs refresh; final 20-level acceptance (proxy playthrough, perf, Node 22/24 determinism, owner pass).
date: 2026-10-23
---
# PRD: Gates, tooling, docs (SP09)

Repo/branch: node-arena · feat/tower-war-port · Depends on: all (Phase 5 + incremental; **Phase A is task 0 of the whole program, before SP01**) · Feeds: release of 2.0.0
Owns: `scripts/ci.sh`, `.github/workflows/{ci,balance}.yml`, root `package.json` `typecheck`/`build:prerequisites`/`ci.sh` structure (single owner of that restructuring; each SP adds its own script lines, e.g. `defs`, `import:tw`, `check:import`, `assets:tw`), `tools/src/{levels,levels-output,balance*,replay,cli,output}.ts` (**`cli.ts` is 09's**; 02/05/07 add one-line branch registrations only; manifest validation is consumed from `@node-arena/content` (02), not `apps/web/src/manifest`) + `tools/test/**` (rewire, not new semantics), new `tools/src/{parked,docs-check}.ts`, `tools/levels-lock.json`, `tools/solutions/**`, `tools/unsolved-by-proxy.json`, `README.md`, `tools/README.md`, `docs/FUTURES.md`, `AGENTS.md` project section, `docs/research/README.md`, final `campaign:verify` spec.
Does not own: rule text (01), defs/content/lock/version commands (02), sim (03/04), importer + `LEVELS_GUIDE.md` (05), bot semantics + goldens (06), assets/manifest data/`CREDITS.md` content (07), web src/e2e (08). Edits `CONTENT_GUIDE.md` (02's) only for cross-links. Does not deploy [owner brief: local only].

## TL;DR
- SP01 (version 2.0.0) and 02's CUT leave goldens/bots/web/levels/balance/replay red on purpose. Fix: 09 **Phase A** (task 0 of the program, before SP01) turns `ci.sh` + root scripts into a named-step runner with a `PARKED` list (gate -> owner SP). `pnpm run ci` is green at every commit; "red" = explicitly parked, never silent.
- Each SP's last task deletes its own PARKED entries (one-line edit). `check:parked --strict` fails while any remain; it runs last in `ci` and is the closing gate.
- Obsolete v1 tooling deleted: `tools/layout`, v1 `tools/solutions/*`, `balance-targets.*`, `bots:churn`, `visual:*` harness, `slice:verify` (replaced by `campaign:verify`). `validate:levels`/`balance`/`replay:verify` rewired to SP03/06 semantics.
- CI: unchanged shape (Node 22+24 matrix, Chromium, separate Playwright job). Importer/asset-regeneration checks **skip** when `TW_EXTRACT` is absent; committed outputs are still hash-checked.
- Final acceptance = proxy plays all 20 headless on Node 22 and 24 with identical hashes (new `tools/levels-lock.json`), browser smoke of 20, perf budgets, owner manual pass.

## Problem
- Gates today are shaped by v1 [verified: `scripts/ci.sh`, `tools/src/levels.ts` bands + `reference` profile, `balance-targets.json` per band, `packages/bots/scripts/churn.mjs`, `apps/web/visual/*` v1.1 harness, `slice.spec.ts`].
- SP02 CUT parks packages and says "park list written into `scripts/ci.sh` as TODO owned by 09" [verified: 02 PRD step 4] but nothing yet defines the mechanism, order, or closure.
- Docs are v1: README "Look"/imgs, tools/README (bands, layout, balance-targets), FUTURES points at TW as "v2 reference" [verified: file reads]. SP04-geometry-shooters PRD absent at time of writing [verified: `ls BF`]; its gate expectations are stated from SP03/01 seams only.

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Every kept gate checks a TW property; none passes vacuously | Making CI download `TW_EXTRACT` (local-only) |
| Red window = a written list that only shrinks | Statistical balance gating (balance stays report-only) |
| `pnpm run ci` green on clean clone, Node 22 + 24, before merge | Hosting/deploy [owner brief] |
| Docs match code; stale-path drift caught by a gate | Rewriting 01-08-owned docs |

## Inventory (grep-backed: `package.json`, `tools/package.json`, `packages/*/package.json`, `apps/web/package.json`, workflows)
| Item | Verdict | Owner | Note |
|---|---|---|---|
| `lint`, `build`, `build:prerequisites`, `typecheck`, `test` | keep, restructure | 09 | add `@node-arena/defs`; `typecheck` and `build` split per package (`typecheck:<pkg>`, `build:<pkg>`) so parking can skip one; 09 is the single owner of this restructuring (02 step 1 defers all root-script edits here) |
| `content:schemas`/`check:schemas`, `content:lock`/`check:content`, `validate:content` | keep (rewritten by 02) | 02 | version-bump guard stays; base = PR base |
| `check:manifest` | keep | 02 (schema), 07 (data, budgets; **PARKED owner SP07**) | parked from CUT (CUT ships no v2 manifest; v1 manifest/credits cannot validate against schema v2) until SP07 |
| `check:rules` | keep (generic) | 01/03/04 | red until 04 tags CMB-04/TWR/OBS [verified: 03 PRD] |
| `sim:golden`, `bench:sim` | keep, regenerated | 03 | `sim-state-v2` hash |
| `replay:verify` | keep, adapt `tools/src/replay.ts` to v2 header | 03 + 09 | `golden` alias scans sim+bots goldens |
| `bots:golden`, `bench:bots` | keep, rewritten for `tw` | 06 | 3 scenarios (pos 4, 6, 11) |
| `bots:churn` + `churn.mjs`, `churn-baseline-v1.json` | **delete** | 06 | no utility bot |
| `validate:levels` | **rewrite** | 09 on 06 R6 | TW AI = human proxy; solvable = any win over proxy `AD in {500,1000,2000}`; unsolved -> `tools/unsolved-by-proxy.json` warnings |
| `balance` | **rewrite**, report-only | 09 on 06 R6 | proxy AD {1000,2000,4000} + idle; `arena` all-`tw` (moved to `tools/src/_parked/` until SP06/09 restores it) |
| `tools/balance-targets.json` + `.schema.json` + `balance-targets.ts` | **delete** | 09 | targets were per v1 band; no band field in v2 |
| `tools/layout/**`, `layout` script, `tools/test/layout.test.ts` | **delete** | 09 | levels are imported, not hand-mirrored (hand-authored original levels use JSON directly) |
| `tools/solutions/{18,20}-*.replay.json` | **delete**, keep dir + README | 09 | no producer for recorded solutions; unsolved levels go to `tools/unsolved-by-proxy.json` (warnings) + owner pass instead (06 R6) |
| `tools/assets/{import-art,build-troop-chibi}` | delete | 07 | replaced by `assets:tw` |
| `assets:tw`, `assets:tw:check` | add | 07 | skip without env |
| `import:tw`, `check:import` | add | 05 | skip without env |
| `slice:verify` + `e2e/slice.spec.ts` | **delete**, replaced by `campaign:verify` | 09/08 | v1 owner-run slice |
| `visual:*` (capture/compose/check/score-*), `apps/web/visual/**` | **delete** | 08 | v1.1 metrics/refs (M-ids) not TW; 07's capture loop (`ref/out`) replaces |
| `test:web:e2e`, `test:web:all`, `dev` | keep | 08 | e2e rewritten by 08 |
| New: `check:parked`, `check:docs`, `levels:lock` | add | 09 | below |
| `VERSION_GUARD_BASE` env | add | 09 (Phase A) | read by `packages/sim/scripts/golden.cjs`, `packages/bots/scripts/golden.mjs`, content lock / `check:content`; default HEAD/HEAD^ (unchanged behaviour); see req. 1 |
| `balance.yml` (nightly report) | keep, update proxy flags | 09 | informational |
| `ci.yml` | keep, small edits | 09 | see CI |

## Requirements
1. **Phase A (task 0 of the whole program, BEFORE SP01; unblocks 01/02/03).**
   - `scripts/ci.sh` = `step <name> <cmd>` runner; `PARKED=( "<gate>:<SPnn>" ... )` array; a parked step prints `PARKED(SPnn) <gate>` and is skipped (exit 0); everything else runs. Root `typecheck` and `build:prerequisites`/`build` become per-package scripts (`typecheck:content|defs|sim|bots|tools|web`, `build:bots|web`) so a parked package is skipped, not broken. 09 is the single owner of this restructuring (02 step 1 defers all root-script edits here).
   - **Version-guard base (B8):** Phase A adds env `VERSION_GUARD_BASE` (default unchanged: HEAD / HEAD^) honoured by `packages/sim/scripts/golden.cjs`, `packages/bots/scripts/golden.mjs` and content lock / `check:content`. `scripts/ci.sh` and dev-code set it to `git merge-base HEAD main` for the whole branch, so 2.0.0 is the single bump across ~60 commits and goldens/locks can be regenerated per SP without per-commit version churn. **Release (merge to main) runs without the env** (normal HEAD / HEAD^ guard).
   - **Initial PARKED (set from the SP01 commit, which is the first red):** `sim:golden`, `replay:verify`, `bots:golden`, `validate:levels` (owners SP03 / SP06; v1 goldens/replays carry 1.0.0 while SP01 bumps `RULES_VERSION` + `content.json` to 2.0.0, so `tools/src/replay.ts:50`, `packages/sim/src/replay.ts:107` and the goldens fail immediately), plus `check:rules` (SP04).
   - **CUT additions (B9):** `typecheck:bots`, `typecheck:web`, `test:bots`, `test:web`, `build:bots`, `build:web`, `tools:levels`, `tools:balance`, `tools:replay` (the three tools files and their tests move under `tools/src/_parked/`, excluded from tsconfig, restored by SP06/09), `check:manifest` (owner SP07; CUT ships no v2 manifest), `balance`, `bench:sim`, `bench:bots`, `test:web:e2e`. CUT bumps `BOT_VERSION` to 2.0.0 (`version.ts` only) or documents, after verifying, that `checkBotVersion` tolerates removed hashes. `tools/src/cli.ts` (09's) consumes manifest validation from `@node-arena/content` so `tools` no longer depends on `apps/web`.
   - Acceptance: `pnpm run ci` green on the pre-SP01 tree with an empty list, green post-SP01 with the SP01 list, and green post-CUT with the CUT list.
2. **`check:parked`** (`tools/src/parked.ts`): parses `PARKED` from `ci.sh`; default prints list, exit 0; `--strict` exit 1 if non-empty. Last step of `ci` runs `--strict` only when env `CI_RELEASE=1` (set by 09 final task / release workflow input).
3. **Gate redefinition** per table below. Each rewritten gate gets a test proving it **fails** on a corrupted fixture (no vacuous green).
4. **`validate:levels`** (rewire of `levels.ts`): per level, seeds 1..N: (a) proxy (`tw`, AD 2000) as human vs authored AIs ends or hits the `maxTicks` cap (20000; reported as Capped, not a failure), 0 rejected commands, no invariant throw, seed-1 rerun hash equal; (b) idle human never wins; (c) solvable = any win in N seeds over proxy `AD in {500, 1000, 2000}` with behavior `full` (06 R6). Unsolved levels are listed in `tools/unsolved-by-proxy.json` (id + reason + owner sign-off) and printed as **warnings**, not failures; the owner manual pass is the real solvability check (Q4 [RESOLVED: owner]: allowlist + owner playtest); `levels-lock.json` still guards determinism. Report prints win rate per level; no `requiredWins`/band. Also asserts the 20 listed in `common.json` are exactly the files in `data/levels`.
5. **`tools/levels-lock.json`** (`pnpm levels:lock` writes, `validate:levels` checks): per level, seed 1: outcome, final tick, final hash. Guards cross-Node and cross-commit determinism on real levels. Any change requires `RULES_VERSION`/`contentVersion`/`BOT_VERSION` bump per existing guards. CI default `--seeds 4` (OPEN: time budget).
6. **`balance`**: report-only (exit 0 on stats); rows per level x proxy AD + idle; header carries rules/content/BOT versions; byte-identical `--jobs 1|2` kept. Delete targets code/tests.
7. **`check:docs`** (`tools/src/docs-check.ts`): every root `pnpm` script appears in `tools/README.md` or `AGENTS.md`; every backticked repo path in `README.md`, `tools/README.md`, `docs/{CONTENT_GUIDE,LEVELS_GUIDE,CREDITS}.md` exists; no doc links to deleted v1 names (`bots:churn`, `layout`, `balance-targets`, `slice:verify`, `visual:`). Cheap, no network.
8. **CI workflow**: (a) keep Node 22+24 matrix `pnpm run ci` (determinism across versions is the matrix itself); (b) Chromium install for web/content/sim stays (sim browser-parity golden) [verified: ci.yml]; add `@node-arena/defs` only if it adds browser tests; (c) `check:import` and `assets:tw:check` print `skipped (TW_EXTRACT unset)` and exit 0; in `ci.sh` surface as `::notice::`; **never** make them required in CI; (d) `check:manifest` validates committed asset hashes against `tw-extract.lock.json` without the extract [07]; (e) Playwright job keeps `test:web:all`; add `timeout-minutes`; (f) `balance.yml` args updated to new proxy flag names; (g) private-repo asset checkout needs no LFS [RESOLVED: owner — no LFS, plain git].
9. **Docs**: see Docs table.
10. **Final acceptance** (Phase C), below.

## Gate redefinition
| Gate | Checks now | Owner | Green when |
|---|---|---|---|
| `lint` / `build` / `typecheck` | live packages; parked skipped | 09 | CUT (live set); fully after 08 |
| `test` | per-package tests of live set | each SP | per SP |
| `check:schemas` / `check:content` / `validate:content` | v2 schemas, lock (sim+bot hash), rules/content/BOT_VERSION bump, 20 levels, `requires` equality, refs | 02 | CUT; 20 levels after 05 |
| `check:manifest` | visuals/themes refs, named budgets (unit 1100/building 1200/obstacle 300/ground 500 tris, 256px), asset hash vs lock, CREDITS coverage | 02+07 | PARKED(SP07) from CUT; full after 07 |
| `check:rules` | every active R-id has `covers`; no unknown tags | 01/03/04 | after 04 |
| `check:import` | re-import diff vs committed levels (needs env) | 05 | after 05; skip in CI |
| `assets:tw:check` | regenerate to temp, byte-diff (needs env) | 07 | after 07; skip in CI |
| `validate:levels` | req. 4 + req. 5 | 09 | after 03+05+06 (PARKED from the SP01 commit, owner SP06) |
| `replay:verify golden` | all sim+bots goldens replay to same hash/outcome | 03/06 + 09 | after 03 (+06 for bots goldens); PARKED from the SP01 commit |
| `sim:golden` / `bench:sim` | v2 hashes; 0.3/1/0.5 ms at 720 troops (x5 CI) | 03 | after 03 |
| `bots:golden` / `bench:bots` | 3 TW scenarios, version-bump rule; per-decision cost on largest level | 06 | after 06 |
| `balance` | report only | 09 | after 06 |
| `test:web:e2e` / `test:web:all` | rewritten 08 specs + 07 render/perf specs | 08/07 | after 08 |
| `campaign:verify` (new, replaces `slice:verify`) | opt-in: Playwright loads each of 20 levels via `?level=`, runs 5 s, zero console errors, captures grid to `test-results/campaign/`; owner-run | 09 + 08 harness | after 08 |
| `check:docs`, `check:parked` | req. 2, 7 | 09 | A (docs: after Phase D) |

## Red window plan (what may be red, per SP landing)
| After | Allowed red / PARKED | Must be green | Un-park (SP deletes entries in its last task) |
|---|---|---|---|
| 09 Phase A (task 0, before SP01) | none (empty list) | whole ci; `VERSION_GUARD_BASE` honoured by sim/bots goldens and content lock | n/a |
| SP01 | `check:rules` (SP04), `sim:golden`, `replay:verify`, `bots:golden`, `validate:levels` (v1 goldens/replays carry 1.0.0 vs new 2.0.0; owners SP03/SP06). Parked in the SP01 commit itself | everything else; version guards measure against `git merge-base HEAD main` so 2.0.0 is the single bump | n/a |
| SP02 steps 1-3 | `check:rules` | all incl. new `defs` build/typecheck | n/a |
| **CUT** (02 step 4 = 03 T1) | SP01 list + `typecheck:bots|web`, `test:bots|web`, `build:bots|web`, `tools:levels|balance|replay` (files under `tools/src/_parked/`), `check:manifest` (SP07), `balance`, `bench:*`, e2e | lint, build/typecheck/test of content+defs+sim skeleton+tools(live; manifest validation from `@node-arena/content`), schemas, content gates | |
| SP03 done | bots, web, `validate:levels`, `balance`, `check:rules`, `bots:golden`, e2e | + `sim:golden`, `bench:sim`, `replay:verify` (09 adapts replay.ts in same window; `tools:replay` restored) | `sim:golden`, `bench:sim`, `replay:verify` |
| SP05 done | as above | + 20 levels in `validate:content`, `check:import` (skips w/o env) | |
| SP04 done | bots, web, `validate:levels`, `balance`, e2e | + `check:rules` | `check:rules` |
| SP06 done | web, e2e | + bots build/test/golden/bench; 09 rewires `validate:levels`/`balance` in the **same SP06 follow-up task** | `typecheck:bots`, `test:bots`, `bots:golden`, `bench:bots`, `validate:levels`, `balance` |
| SP07 done | web (shell), e2e | + `check:manifest` full, `assets:tw:check`; render unit tests run via 07's own vitest | `check:manifest` |
| SP08 done | none | + web typecheck/test/e2e, `test:web:*` | `typecheck:web`, `test:web`, `test:web:e2e` |
| SP09 Phase C | none | all, `CI_RELEASE=1 check:parked --strict`, Node 22+24 | list empty |
Rule for dev-code agents: before each commit run `pnpm run ci`; it may only fail on nothing. A commit that needs to park a new gate edits `PARKED` with an SP owner **in that commit** and notes it in its code-run artifact. Never `--no-verify`.

## Docs
| Doc | Action |
|---|---|
| `README.md` | rewrite Contents (add `packages/defs`, TW scope, 20 levels, local-only), replace "Look" with TW screenshots from `BF/ref/out` copied to `docs/img/` (delete v1 imgs), dev commands table, `TW_EXTRACT` note |
| `docs/CONTENT_GUIDE.md` | 02 rewrites; 09 adds links to `LEVELS_GUIDE.md` and this gate list; `check:docs` verifies paths |
| `tools/README.md` | full rewrite: new contents, gate semantics (req. 4-8), env-skip behaviour, `levels:lock`, parked list pointer; remove bands/layout/targets |
| `docs/FUTURES.md` | **append/merge, never replace** earlier SP entries (04/06 append before this task): replace only the stale v1.1 section; add deferred TW features (incl. the dropped `CrossingSource` seam note from 04 S1) (each with TW evidence pointer to `docs/research/tower-wars/*`): walls, mines, rivers/water, rocket towers, fortress, trolley, railway, shield/ranged unit modules (schema room exists), **Boosters (bomb + speed)** ([RESOLVED: owner — boosters deferred]; research facts to record: bomb = 3 aims per use, speed = 1.3x unit speed / 1.7x spawn rate, 15 s delay, 20 s cooldown, TW gate = first available at level 4; evidence pointer `docs/research/tower-wars/*`), tutorials, meta (coins/skins/shop), PvP/multiplayer, skins, cargo, hosting/deploy, levels 24+ (see LEVELS_GUIDE tracker snapshot; generated census tracker is a 05 follow-up), portrait/mobile, original-level editor, new themes beyond Green/Snow |
| `docs/CREDITS.md` | 07 owns rows; 09 verifies header states TW art is Vaveda's, extracted, repo private, not redistributable, and the audio/Kenney CC0 rows still match files; `check:manifest` enforces coverage |
| `AGENTS.md` project section | package list (+`packages/defs`), scripts list (drop churn/slice/layout; add `import:tw`, `check:import`, `assets:tw`, `levels:lock`, `check:parked`, `check:docs`, `campaign:verify`), "Rules authority" (R-ids, v2), docs pointers (`LEVELS_GUIDE`), state `TW_EXTRACT` is local-only. No change to Style/Orchestrator sections |
| `docs/research/README.md` | add index lines for each `tower-wars/*.md`, plus pointer to `BF/` PRDs; note `06a` describes pre-port v1 (historical, not edited) |
| `apps/web/README.md` | trim to current commands (check) |

## Architecture
```
ci.sh: lint -> build:prerequisites -> typecheck:* -> test -> check:schemas -> check:content -> validate:content
       -> check:manifest -> check:rules -> check:import(skip) -> assets:tw:check(skip) -> validate:levels
       -> replay:verify golden -> sim:golden -> bots:golden -> bench:sim -> bench:bots --ci -> check:docs -> check:parked
each step wrapped: step <name> <cmd>   (PARKED -> skip + print owner)
```
Final acceptance flow (Phase C): `pnpm run ci` (22, 24) -> `campaign:verify` -> perf -> owner pass.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| 1 | Red-window mechanism | `PARKED` list in ci.sh + `check:parked --strict` | comment-only TODO; red branch; keep CUT late | Visible, shrinks, enforceable; CI stays meaningful |
| 2 | Phase A before SP01 | yes, task 0 of the program | before CUT only; write at close | SP01's 2.0.0 bump already breaks goldens/replays; CUT needs somewhere to park (02 step 4) |
| 2b | Version guards on a long branch | `VERSION_GUARD_BASE` = `git merge-base HEAD main` | bump per commit | 2.0.0 is the single bump; release run without env |
| 3 | `balance-targets` | delete, report-only | re-author per profile | No bands; 06 defers statistical targets |
| 4 | v1 visual harness | delete | adapt M-ids to TW | Thresholds calibrated to v1.1 refs; 07 loop + owner approval |
| 5 | Level determinism lock | `tools/levels-lock.json` (seed 1 hash per level) | rely on unit goldens only | Covers all 20 real levels on both Node versions |
| 6 | Unsolvable level | `tools/unsolved-by-proxy.json` allowlist (warnings) + owner pass | recorded solution replays (no producer); relax gate | Agents cannot play; honest warning list, owner pass is the real check |
| 7 | CI extract | skip, never require | store extract in CI | Private licensed data, local-only |
| 8 | `slice:verify` | replace with `campaign:verify` | keep | v1 slice meaningless |
| 9 | Doc drift | `check:docs` | convention only | Prior READMEs went stale [verified] |
| 10 | Perf in CI | draw-call/tri budgets only | fps gate | Software GL in CI; fps owner-measured |

## Manual steps (owner)
- Run `TW_EXTRACT=... pnpm check:import && pnpm assets:tw:check` locally before merge (CI cannot).
- Play levels 1-20 (positions 4-23) in browser; fill the checklist in `BF/09-gates-tooling-docs/owner-pass.md` (mechanics feel, readability, level order/difficulty, results flow). Visual approval vs refs.
- [RESOLVED: owner accepts parked window; all gates green before merge]
- [RESOLVED: owner — repo stays private; TW art committed]
- [RESOLVED: owner — no LFS, plain git]

## Risks
| Risk | Mitigation |
|---|---|
| Window long if SP03 slips | CUT only when 03 T1 ready (02); Phase A independent and first |
| Agents silently add parked entries | entry needs SP owner; reviewers check diff of `PARKED` |
| `validate:levels` cost: 20 levels x 4 seeds x full match | est. 20x4x~5 s on Node 22 [ASSUMED from 0.3 ms/tick, 20 Hz]; cut CI seeds to 2 if > budget |
| Proxy cannot win hard levels | any-of-3-`AD` rule, `tools/unsolved-by-proxy.json` warnings, owner pass; 06 spike first [06 OPEN 3] |
| Cross-Node float/ordering drift | levels-lock + sim goldens already integer; matrix 22/24 |
| 07 render specs have no host until 08 | 07 uses vitest + its capture script; Playwright render specs wait for 08 (agree in 07/08 tasks) |
| TW art in repo vs future public release | CREDITS block; repo private [RESOLVED: owner]; assets are not redistributable |
| SP04 gate expectations | resolved: gate rows for CMB-04/TWR/OBS follow 04 (see Open Questions) |

## Open Questions
- [RESOLVED: default 4 seeds, measure after SP06, drop to 2 if over CI budget] CI time budget and seeds for `validate:levels` (measure after SP06; default 4, fallback 2).
- [RESOLVED: owner — repo stays private; committing TW art is OK]
- [RESOLVED: SP04 PRD exists; gates are `check:rules` tags CMB-04/TWR/OBS, `scenarios-geometry.ts` golden appended to 03's `run.ts` scenario array, bench scenario (720 troops, 40 hostile crossings, 3 towers)]
- [RESOLVED: owner — no LFS, plain git] TW art (~3 MB) and reference frames committed as plain git.
- [DEFERRED: docs/FUTURES.md] Web bundle/size budget gate beyond per-model budgets (not specified by 07/08).
- [RESOLVED: S4 picker shows 1..20 (`position - 3`); saves keyed by `levelId`; `campaign:verify` names by `levelId`]
- [RESOLVED: balance targets] report-only, delete targets.
- [RESOLVED: owner] Q4: proxy cannot win some of the 20 levels -> allowlist `tools/unsolved-by-proxy.json` + owner manual pass (no hand-recorded replays).
- [DEFERRED] Nightly balance regression thresholds; Windows/macOS CI; visual regression snapshots as a gate (owner approves visually).

## Acceptance Criteria
1. Phase A merged as task 0, before SP01; `PARKED` list matches the SP01 and CUT lists above; `pnpm run ci` green at CUT and at every later SP commit.
2. Deleted: `tools/layout`, v1 `tools/solutions/*`, `balance-targets.*`, `bots:churn`, `apps/web/visual`, `slice:verify`; grep for those names in repo (excl. `agent_files`, `docs/research/tower-wars/06a`) returns nothing.
3. Each rewritten gate has a failing-fixture test; `check:parked --strict` passes with empty list.
4. Clean clone, Node 22 and 24: `pnpm install --frozen-lockfile && pnpm run ci` green with `TW_EXTRACT` unset and Chromium installed; `check:import`/`assets:tw:check` report `skipped`.
5. With `TW_EXTRACT` set locally: `check:import`, `assets:tw:check` clean.
6. `validate:levels`: all 20 levels terminate, 0 rejects, idle never wins, each solvable by the proxy rule (any win over `AD in {500,1000,2000}`) or listed in `tools/unsolved-by-proxy.json` with owner sign-off; `levels-lock.json` equal on Node 22 and 24.
7. Perf: `bench:sim` within budget at 720 troops; `bench:bots` reported; 07 perf scene (720 troops + 20 buildings) draw/tri budgets pass; owner-measured fps recorded.
8. `campaign:verify`: 20/20 levels load and run without console errors; screenshot grid saved.
9. Docs in Docs table updated; `check:docs` green; FUTURES lists all deferred TW features; CREDITS/AGENTS/research index current.
10. Owner pass checklist completed (manual).
