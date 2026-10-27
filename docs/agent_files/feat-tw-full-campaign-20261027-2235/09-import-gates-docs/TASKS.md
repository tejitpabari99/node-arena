---
status: draft
summary: 11 tasks — census coverage/curve emitters, coverage + gap fill, order + curve check, numbering + overrides policy, selection table, gates at curated size, goldens/benches/version chain, docs sweep, campaign smoke modes, final lock refresh + Node 22/24 run, owner-pass.md
date: 2026-10-27
---
# Tasks: 09 Final curation, gates, docs
Source of truth: [PRD](PRD.md). Final curation and assembly of the Common campaign (20 shipped + selection from TW 24-340): confirm >=10 levels per element, order by TW position, run the difficulty-curve check, fill gaps, number contiguously 1..N, then re-baseline gates, consolidate docs, and package the owner pass. No new mechanics or rule text; GAME_RULES is review-only. Tasks 1-4 need the rebuilt TW extract (`TW_EXTRACT`) and SP01's `pnpm census`. Phase D PR = 08 + 09; 09 runs last, after all rebases, and owns the phase `validate:levels --all`. Siblings referenced only. Version numbers indicative (RULES 3.7.0, BOT 2.7.0).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Census coverage + curve emitters (`--coverage`, curve check) | none | todo |
| 2 | Coverage audit, spread rule, gap filling | 1 | todo |
| 3 | Order, introduction rule, difficulty-curve check + fix loop | 2 | todo |
| 4 | Contiguous numbering, overrides policy, count reconciliation | 3 | todo |
| 5 | Selection table + deviations ledger in LEVELS_GUIDE | 4 | todo |
| 6 | Gates at curated size: unsolved allowlist review, timing | 4 | todo |
| 7 | Goldens, benches, version chain, parked check | 6 | todo |
| 8 | Docs sweep: GAME_RULES review, FUTURES, CREDITS, README/AGENTS/tools README | 5, 7 | todo |
| 9 | campaign:verify sample/all modes, picker/save/bundle check | 4 | todo |
| 10 | Final lock refresh, pre-release Node 22 + 24 run | 6, 7, 8, 9 | todo |
| 11 | owner-pass.md and census.json | 10 | todo |

## Task 1 — Census coverage + curve emitters
What it is / what it means: PRD Architecture, R1.2, R1.6, R1.7. The pool tool stays the single source of truth for selection, curve check, selection table and owner pass. SP01 owns `pnpm census`; 09 adds emitters once it has merged.
What changes at a high level: small `tools/src/census` additions: `--coverage` (element, n, first/last display level, largest gap, from `common.json` plus level features) and a curve emitter (composite D per level, windows of 10, trailing window <5 merged, checks a/b/c). Generator output for the selection table with markers. Metrics use the 12-run proxy set.
Done when: both emitters run on the current provisional tree; unit tests cover D formula, windowing and the three curve conditions; `tools/README.md` entry drafted.

## Task 2 — Coverage audit, spread rule, gap filling
What it is / what it means: PRD R1.2, R1.3, R1.9; README Curation. SP02-08 selections are provisional; this task confirms the whole.
What changes at a high level: run `--coverage` with metrics filled for every pick and gap candidate. Each element (walls, mines, WT3, piles, capture rocket, rivers+bridges, ROBS, fortress, rocket tower, trolley, railway; AI Random/Defense where used) needs >=10, spread rule max(15, 15% of N), last use in final 30 unless introduced late. Gap candidates: proxy-solvable, nearest TW position after introduction, D within trend. Fewer than 10 usable: ship the maximum, record it. Import added levels through the importer.
Done when: coverage table shows >=10 per element or a documented shortfall; spread rule met or exception recorded; shipped 1-20 unchanged except 23.

## Task 3 — Order, introduction rule, difficulty-curve check + fix loop
What it is / what it means: PRD R1.4-R1.8, Decision 3. Order by `source.position`; each element's first level introduces it alone (themes may coincide).
What changes at a high level: check the introduction rule and swap double-introductions for equal-feature alternatives. Run the curve check (dips <=3 between windows, last window >= first NEW window + 10, introductions <= previous window + 10). Fix loop: reorder inside segments between introductions, swap offenders, add fill levels, else record exception rows. Never drop an element below 10; prefer solvable alternatives.
Done when: curve passes or exceptions listed; final constants measured and noted for the ledger; prefab-only ids selected either convert or are swapped.

## Task 4 — Contiguous numbering, overrides policy, count reconciliation
What it is / what it means: PRD R1.4, overrides policy, Decisions 2, 5; D2/D5.
What changes at a high level: `common.json` final order; display numbers contiguous 1..N (shipped 1-20 keep their numbers, new from 21); `source.position` on every level; theme rotation by display position. Review `level-overrides.json`: selected levels un-tuned, overrides only for a fixable cause with `reason`. Prune stale `unsolved-by-proxy.json` rows and re-check positions 5, 14, 16-19.
Done when: `common.json` entries == level files (minus `na-*`) == `levels-lock.json` keys; `validate:content --base HEAD` and `check:import` green.

## Task 5 — Selection table + deviations ledger in LEVELS_GUIDE
What it is / what it means: PRD R1.11, R3. LEVELS_GUIDE section 5 is currently a static tracker.
What changes at a high level: replace with generated selection table between markers (display number, TW position, theme, features incl. AI behaviours, D, proxy status, reason, exceptions), coverage table, skipped-positions note, which themes appear (all 6 only if N >= 101), link to `census.json`. One deviations ledger collecting every spike "picked value" (SP, quantity, TW source or "not decoded", chosen value, rationale) plus final curve and spread constants. Update dropped-data table (cargo, sc, tutorial scripts; wall no longer dropped) and the "Imported levels (20)" wording. `CONTENT_GUIDE.md` cross-links only.
Done when: `check:docs` verifies the marker block; ledger covers every SP deviation.

## Task 6 — Gates at curated size: unsolved allowlist review, timing
What it is / what it means: PRD R2, G1, G2.
What changes at a high level: re-measure `validate:levels` and `validate:content`/`check:content` at final size (PR delta budget +6 min, `--jobs` only if exceeded; combined content checks target <30 s). Review `unsolved-by-proxy.json` row by row: reason (stalemate/eliminated/cap-hit), mechanic tag, `ownerSignOff: null`. Group "proxy cannot use feature X" rows; if >~10% of shipped levels are unsolved, flag proxy weakness. Tune `ci.yml`/`balance.yml` only if needed.
Done when: `validate:levels --all` green or only allowlisted; timing and unsolved ratio recorded in `tools/README.md`.

## Task 7 — Goldens, benches, version chain, parked check
What it is / what it means: PRD R2 goldens/bench/version bullets, G3.
What changes at a high level: add a `sim:golden` per mechanic family still lacking one (wall/mine, pile, artillery, river, rocket, capture rocket, fortress, trolley, rail move); `bots:golden` for BOT-changing SPs (03, 06, 08). `replay:verify golden` scans all; shipped-20 hashes move only for position 23. Re-run `bench:sim`/`bench:bots` on the largest selected level and a rocket-heavy one (+20% headroom for projectile levels, explained regressions recorded). Version-chain assertion: RULES 3.7.0, BOT 2.7.0 (or documented renumber), content hash matches lock. `PARKED` empty, `check:parked --strict` passes.
Done when: all goldens/replays green; bench within budget; chain check green.

## Task 8 — Docs sweep: GAME_RULES review, FUTURES, CREDITS, README/AGENTS/tools README
What it is / what it means: PRD R3. Review-only for rules; SP02-08 already removed their own FUTURES entries.
What changes at a high level: GAME_RULES: changelog 3.1.0-3.7.0 complete and ordered, phase table rows consistent, every new `R-*` has `covers` tests (`check:rules`); wording fixes only. FUTURES: final sweep of leftovers, keep boosters/tutorials/meta/PvP/cargo/modules/bundle gate/mobile/hosting/editor items, add "import more of TW 24-340". CREDITS audit: all `apps/web/assets/**` covered, `check:manifest` warnings 0. README and AGENTS.md project section: replace "20 Common campaign positions 4-23" with curated campaign of N levels, themes and mechanics lists, script inventory. `tools/README.md`: census flags, gate timing, smoke modes.
Done when: `check:docs`, `check:rules`, `check:manifest` green; no "20 levels" wording left except historical.

## Task 9 — campaign:verify sample/all modes, picker/save/bundle check
What it is / what it means: PRD R4, resolution 7, Decisions 6, 7. `campaign:verify` and `acceptance.spec.ts` hard-code 20 levels.
What changes at a high level: `--sample` default (first/last of each 20-level world, each element's introduction level incl. those added by SP02-08, changed levels, ~25-30) and `--all` (manual, ~N x 5 s). Keep 5 s dwell, browser-error check, screenshot; HUD-safe-frame test on a sample. Manual check of picker at N (world grouping, scroll-to-current, O(1) unlock), save size, boot loading one level. Record main-chunk gzip and largest level chunk; flag only a >25% main-chunk regression, no gate.
Done when: `campaign:verify --sample` and e2e green; numbers recorded in the PR.

## Task 10 — Final lock refresh, pre-release Node 22 + 24 run
What it is / what it means: PRD R2 pre-release, Decision 8. Single bulk lock commit avoids merge conflicts; needs Chromium.
What changes at a high level: one `levels:lock` refresh on the final tree (only lock files change). One-off full run on Node 22 and 24 (locally or `workflow_dispatch`): `pnpm run ci`, `validate:levels --all`, `campaign:verify --all`. Compare `levels-lock.json` hashes across Nodes; investigate any drift on new mechanics.
Done when: CI green on both Nodes, hashes identical, `campaign:verify --all` green, `PARKED` empty.

## Task 11 — owner-pass.md and census.json
What it is / what it means: PRD R5. Positions come from the generated table, not memory.
What changes at a high level: write `census.json` snapshot and `owner-pass.md` in the agent_files folder: header (commit, versions, N, coverage table); A one level per element introduction (base, towers, wall, mine, WT3, pile, river, ROBS, capture rocket, fortress, rocket tower, trolley, rail, BT1/BT2 where used, each theme at first appearance); B every allowlisted level with checkboxes (winnable / too hard / broken / sign-off); C theme screenshots vs `ref/`; D picker/save/mobile-touch drag-aim; E sign-off line. Update the folder README status. `ownerSignOff` stays null.
Done when: every section has concrete display numbers and TW positions; all unsolved rows listed.

## Owner manual steps
- Provide rebuilt `TW_EXTRACT` for Tasks 1-4.
- Run `owner-pass.md`; sign off unsolved rows (`ownerSignOff`).
- Approve the Phase D PR (with 08) and release.
