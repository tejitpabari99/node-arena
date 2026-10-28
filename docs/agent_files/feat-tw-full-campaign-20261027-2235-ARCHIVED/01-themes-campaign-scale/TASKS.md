---
status: archived
summary: 10 tasks — 4 themes (+river/ROBS slots), lazy level loading, world picker, gate timing at curated size, candidate-pool tool (pnpm census)
date: 2026-10-27
---
# Tasks: 01 Themes + campaign scale
Source of truth: [PRD](PRD.md). Ships Lava/Mine/Jungle/DarkMine themes, makes the client and gates cope with the curated ~100–150-level campaign, and adds `pnpm census` as the candidate-pool tool that drives SP02–SP09 selection. No mechanics; no bulk import. Tasks 1, 2, 3, 8, 9 need the rebuilt TW extract (`TW_EXTRACT`).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Decode spike: EnvironmentData + themeFor + pathID check | none | todo |
| 2 | Theme registry + manifest river slots | 1 | todo |
| 3 | Generate 4 theme asset sets | 2 | todo |
| 4 | Content catalog/on-demand API + load-strategy measurement | none | todo |
| 5 | Client lazy level loading | 4 | todo |
| 6 | World picker, display numbering, theme by display position, save check | 5, 2 | todo |
| 7 | Gate timing at curated size | 4 | todo |
| 8 | Census core (static pool listing) | 1 | todo |
| 9 | Census metrics, check mode, SP map | 8, 7 | todo |
| 10 | Drop-policy note, e2e/campaign:verify at scale | 3, 6, 9 | todo |

## Task 1 — Decode spike: EnvironmentData + themeFor + pathID check
What it is / what it means: PRD R1 + Risks. Exact prefab/material names for the 4 themes, whether river/ROBS materials are per-env or shared, and how TW selects env per position (`envShift` quirks), are not yet known from the rebuilt extract.
What changes at a high level: Time-boxed (~1 h) decomp of `EnvironmentData` and level env selection via `/root/projects/tower-war/_tools/decomp.sh`. Compare rebuilt-extract pathIDs with the verified `env.ts` values; on mismatch re-derive and update `env.ts` (scripts fail loudly).
Spike pointer: start from the pre-decompiled classes in `/root/projects/tower-war/_extract/decomp/MANIFEST.md` (158 classes; on-demand Ghidra via `/root/projects/tower-war/_tools/decomp.sh`): `EnvironmentData`, level env selection (see MANIFEST.md for exact class names).
Done when: findings recorded (names, per-env vs shared river materials, themeFor cross-check). If inconclusive: fallback recorded as a deviation in GAME_RULES and the deviations ledger (green river/ROBS material tinted per theme; existing `themeFor` mapping). pathID check fails loudly on mismatch.
Owner-pending step folded in (TW extract was rebuilt 2026-10-28): regenerate `tools/assets/tw-extract.lock.json` with `pnpm assets:tw` against the rebuilt extract. Today `assets:tw:check` fails only on that lock's input hashes (11/86 inputs re-serialized differently by the rebuild; all 52 outputs are byte-identical), so the lock refresh must change input hashes only; any output diff is a failure to investigate. `assets:tw:check` green after.

## Task 2 — Theme registry + manifest river slots
What it is / what it means: PRD R1, Architecture, Decisions 1–2. Theme ids are hard-coded in two lists; SP05 needs river/ROBS slots from the manifest.
What changes at a high level: Four `ThemeSpec` rows (Lava, Mine, Jungle, DarkMine) from spike results; one shared const feeding both theme lists (`THEME_IDS` derived). Optional `river`/`riverObstacle` slots added to the manifest schema so green/snow stay valid. Obstacle small/big must resolve even if one mesh.
Done when: manifest schema and generator accept 6 themes; existing green/snow output unchanged; typecheck and unit tests green.

## Task 3 — Generate 4 theme asset sets
What it is / what it means: PRD R1 budgets, Goals 1, Acceptance. All 4 art sets ship regardless of final N.
What changes at a high level: Run `assets:tw` to produce ground, obstacle (small/big), river and river-obstacle assets per theme; light/sky derived from mean edge colour; CREDITS rows; measure ground texture sizes and downscale via existing `downscale()` if over budget (deviation recorded). Screenshots of each theme saved to `ref/`.
Done when: manifest has 6 themes; `check:manifest` and `assets:tw:check` (regenerates byte-identically) green; budget target ≤ +1.5 MB gzip met or deviation recorded; credits pass.

## Task 4 — Content catalog/on-demand API + load-strategy measurement
What it is / what it means: PRD R2, Decision 3. Eager loading validates and compiles every level before first paint.
What changes at a high level: `@node-arena/content` gains `loadCatalog(files)` and `loadLevelOnDemand(catalog, source)`; `loadContent` stays for tools/tests. Unknown-level campaign checks move to `validate:content`. Measure eager-at-~150 (synthetic scale set) vs lazy: first paint, gzip size, compile ms/level.
Done when: API covered by tests; measurement recorded. If eager costs <10% first paint and <300 KB gzip, lazy is dropped and recorded as a deviation; otherwise lazy is the default.

## Task 5 — Client lazy level loading
What it is / what it means: PRD R2, Goal 2. Only the catalog is eager; levels load on select.
What changes at a high level: Boot uses `import.meta.glob` non-eager for level JSON (one chunk per level), loads and compiles on select with caching; `state.ts` takes the level list from campaign entries only; custom levels (`na-*`) stay eager. Skipped (eager kept) if Task 4 flipped the decision.
Done when: production bundle has no level JSON in the main chunk; boot loads one level; first paint not worse than today +10%; `test:web:e2e` green.

## Task 6 — World picker, display numbering, theme by display position, save check
What it is / what it means: PRD R2, Goal 3, Decisions 4 and 10 (D2). ~150 flat cards is too long; display numbering is contiguous and `source.position` is metadata.
What changes at a high level: Picker grouped into 20-level worlds (theme name + colour chip), collapsed/paged, scroll-to-current, `data-level-id` selectors kept. Level number/name come from the campaign order; theme rotates by display position every 20 levels. Verify save size <10 KB at ~150 entries and O(1) `isLevelUnlocked` via campaign order index.
Done when: unlock/complete works at scale (tested with a synthetic ~150 campaign); old saves load; shipped ids unchanged; e2e selectors still pass.

## Task 7 — Gate timing at curated size
What it is / what it means: PRD R3, Decisions 5–6, resolved risks. Baseline 2.1 s/level for `validate:levels --seeds 4`.
What changes at a high level: Measure `validate:levels --seeds 4`, seed-1 determinism lock, and `validate:content`/`check:content --base` on a ~150-level set. Add `levels:lock --levels <ids>` so SPs refresh only their entries. No sharding or nightly by default; add `--jobs k` (pool as in `balance`) only if the PR delta exceeds +6 min; hot-spot fix only if content checks exceed 30 s.
Done when: numbers and decision recorded in `tools/README`; `--levels` flag tested; lock/unsolved files stay single sorted JSON.

## Task 8 — Census core (static pool listing)
What it is / what it means: PRD R4, Decision 7; cross-cutting resolution 4. `pnpm census` becomes the candidate-pool tool for TW Common positions 24–340 (including prefab-only ids via `parse-prefab.ts`). Needs `TW_EXTRACT`.
What changes at a high level: New `tools/src/census/` reusing `gate.ts` `featuresOf`/`computeBlocked`. Per position: theme, features, AI behaviours (BT1/BT2 as coverage attributes; already implemented), blockedBy, status, static difficulty (numAIs, start-level sums, ratio). Outputs `census.json` plus markdown table, first-position-per-feature, blocker summary. Without `TW_EXTRACT`: exit 0 with notice.
Done when: deterministic output; every blocked position has ≥1 reason; unit tests with fixtures run without the extract.

## Task 9 — Census metrics, check mode, SP map
What it is / what it means: PRD R4 metrics, `--check`, `census-sp-map.json`; resolution 4. Each SP selects from the pool and prints its coverage line.
What changes at a high level: `pnpm census --metrics` fills proxy win rate and median win tick (4 seeds × 3 delays) for candidates with cleared blockers, merged into `census.json`, reusing the validate runner. `--check` compares to committed `census.json` only when env is set. `census-sp-map.json` maps SP to features; summary lists per-SP candidate counts.
Done when: metrics merge is idempotent; `--check` stable; per-SP counts printed; README/tools docs updated with usage (final LEVELS_GUIDE table is SP09's).

## Task 10 — Drop-policy note, e2e/campaign:verify at scale
What it is / what it means: PRD R5, Decision 9, Acceptance. SP01 imports nothing beyond what its own tests need.
What changes at a high level: Record drop-policy review in LEVELS_GUIDE (cargo, `sc`, `MinRD/MaxRD` stay dropped; wall `onlyLevels` unchanged until SP02) and which new themes appear at what N. Confirm `campaign:verify` and Playwright run on a curated-size set. Phase A pre-merge full run belongs to SP03.
Done when: `pnpm run ci` green; any level imported here is proxy-solvable or in `unsolved-by-proxy.json` (reason, `ownerSignOff: null`); content version/lock refreshed only if levels were added.

## Owner manual steps
- Provide rebuilt `TW_EXTRACT` (blocks tasks 1, 3, 8, 9).
- Spot-check theme screenshots in `ref/`; later the unsolved list.
- Run full `validate:levels --all` locally before the Phase A merge (SP03 task); approve the PR.
