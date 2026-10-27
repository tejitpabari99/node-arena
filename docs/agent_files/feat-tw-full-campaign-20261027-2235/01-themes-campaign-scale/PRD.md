---
status: draft
summary: Add Lava/Mine/Jungle/DarkMine themes, make client boot, picker and save handle the curated campaign (~100-150 levels; 20 shipped + selection from TW Common 24-340), keep gates cheap at that size, and add the candidate-pool tool (`pnpm census`: per TW position 24-340 features, blocked reasons, difficulty metrics) that drives level selection.
date: 2026-10-27
---
# PRD: 01 Themes + campaign scale

Repo/branch: node-arena, `feat/tw-full-campaign` (Phase A PR = SP01+02+03) · Depends on: none · Feeds: 02-09 (themes, candidate-pool tool, lazy loading)
Owns: `tools/src/assets-tw/{env,manifest-fragment}.ts` (theme lists/specs), `apps/web/assets/{models,textures}/tw/*-{lava,mine,jungle,darkmine}*`, `apps/web/assets/manifest.json` `themes` (generated), `docs/CREDITS.md` rows, `apps/web/src/app/{boot,state}.ts` + `ui/Picker.tsx` + `save/` (campaign scale), `tools/src/levels*.ts` + `cli.ts` (gate timing only), new `tools/src/census/**` (candidate-pool tool), `packages/content/data/{levels,campaigns/common.json}` (imported rows), `tools/levels-lock.json`, `tools/unsolved-by-proxy.json`.
Does not own: mechanics (02-08), `feature-map.json` rows for new features (each SP flips its own), river/ROBS behaviour (05), final docs (09).

## TL;DR
Today the game holds 20 levels and 2 themes. Owner decision D1: the campaign is curated, not all of 4-340 (README Curation). This SP (a) ships the 4 missing themes (incl. river/ROBS materials for SP05), (b) keeps client boot cheap at ~150 levels (lazy per-level loading kept, see Decisions 3), (c) measures the gate cost at the curated size and decides sharding is unneeded unless measured otherwise, (d) turns `pnpm census` into the CANDIDATE-POOL tool (per TW Common position 24-340: features, blocked reasons, difficulty metrics; used for selection), (e) imports nothing by itself except what curation selects with no new mechanic. Final N is set by SP09.

## Problem
- Theme gate: `themeFor` yields lava at 41, mine 61, jungle 81, darkmine 101, then the cycle repeats (all 6 by 120 TW position; under D2 themes rotate by display position instead). Only `green`,`snow` are registered, so every pool level >=41 except snow 21-40 is blocked on theme alone [verified: gate.ts `ENV`; manifest `themes` keys = green,snow].
- Theme ids hard-coded twice: `ENV_THEMES` (assets-tw/env.ts:11) and `THEME_IDS` (manifest-fragment.ts:12). Adding a theme = spec row + both lists.
- Eager boot: `import.meta.glob(.../data/**/*.json, {eager:true, query:'?raw'})` in `app/boot.ts`, then `loadContent` validates + compiles every level before first paint [verified: boot.ts L2; content.ts L21-25]. Levels are ~7.5 KB avg (21 files = 156 KB, max 10 KB) -> ~150 files ≈ 1.1-1.5 MB raw JS strings in the main chunk plus 150 compiles at boot (estimate; measure in Task 1).
- Picker renders one card per campaign entry, no paging; unlock/complete by level id in `save/` [verified: Picker.tsx L14-19]. ~150 cards in one flat grid is still too long on mobile.
- Gate cost: `validate:levels --seeds 4` = 45 s for 21 levels single-threaded [measured: `time pnpm validate:levels --seeds 4`, 45.4 s] ≈ 2.1 s/level. Linear -> ~5 min at 150 levels; later levels are bigger and stalemates run to the 20000-tick cap, so assume 5-8 min single process. It runs inside `pnpm run ci` on a 2-node matrix (no worker pool in `levels.ts`; `balance` has `--jobs`). At that size sharding and a nightly split are not justified; measure first.
- Census is a static snapshot in LEVELS_GUIDE §5 and FUTURES ("generated coverage census") [verified: FUTURES.md L37]; curation needs a live per-position pool listing with difficulty metrics instead.

## Goals
1. Four themes registered and rendered: ground + small/big obstacle + river + river-obstacle materials, within existing budgets. All 4 new art sets ship even if the curated N < 101 (note which appear in LEVELS_GUIDE).
2. Cold boot loads catalog + one level; first paint not worse than today +10%.
3. Picker + progress usable at ~150 levels (grouped by theme "world" of 20; display numbering contiguous 1..N, D2).
4. PR CI wall-time increase <= +6 min (measured; full `validate:levels` at curated size fits without sharding), else add `--jobs`.
5. `pnpm census` (candidate-pool tool) prints per TW position 24-340: features, blocked reasons, difficulty metrics; deterministic output.
6. The 20 shipped levels unchanged by this SP; any curated level needing only themes/already-supported features can be imported on SP09 request.

## Non-Goals
New mechanics (02-08). Cargo/Wall `onlyLevels` re-opening beyond review (see D9). Level thumbnails per card. Cloud save. Skins/boosters. Positions >340 (wrapping is TW's `skip + loop`; not needed). Importing every TW level (D1: curated only).

## Requirements

### R1 Themes (art)
- Add 4 `ThemeSpec` rows in `assets-tw/env.ts` (prefab names from `EnviromentSettings` order Lava, Mine, Jungle, DarkMine; `EnvironmentData` = ground prefab + small/big obstacle mesh + obstacle/river-obstacle/river materials, 02-levels §4.4). Extend both theme lists from one shared const.
- Output per theme: `ground-<t>.glb/png`, `obstacle-<t>.glb/png` (small+big), and **river + river-obstacle** textures/materials as manifest `themes.<t>.river`/`riverObstacle` slots (schema addition in `manifest.schema.ts`, optional so green/snow stay valid). SP01 ships assets+slots; SP05 consumes them.
- Per-theme `light`/`sky` from the existing derivation (mean edge colour). Obstacle mesh is env-driven, not per-id (PRD 07).
- Budgets: green+snow ground+obstacle are small (ground 200 tris, obstacle 66); target <= +1.5 MB gzip for 4 themes; `check:manifest` enforces. Credits rows added; `assets:tw:check` regenerates byte-identically.
- Obstacle `#small`/`#big` may be the same mesh (snow is); a theme with one mesh must still resolve both.

### R2 Client scale
- Split content: eager = `balance`, `buildings`, `units`, `elements`, `campaigns`; **lazy** = `levels/*.json` via `import.meta.glob(..., {eager:false})` -> one dynamic chunk per level. Load + `compileLevel` on select; cache. Kept at ~150 levels: main chunk would otherwise carry ~1.1-1.5 MB raw JSON + 150 compiles before first paint, and per-level chunks are a small, cacheable change. [RESOLVED: Task 1 measures eager-at-150 vs lazy; if eager costs <10% first paint and <300 KB gzip, drop lazy and record as a deviation; default is lazy]
- `@node-arena/content` gains `loadCatalog(files)` + `loadLevelOnDemand(catalog, source)`; `loadContent` stays (tools/tests use it). Unknown-level checks in campaign validation move to tools (`validate:content`), client trusts catalog.
- `state.ts` takes `levels` list from campaign entries only; level display name/number from campaign (contiguous 1..N, `source.position` is metadata only), not from loaded level. Custom levels (`na-*`) stay eager.
- Picker: **20-level world picker kept** (theme name + colour chip), collapsed/paged, scroll-to-current; `data-level-id` selectors preserved for e2e.
- Save: keyed by level id; verify size < 10 KB at ~150 entries and `isLevelUnlocked` is O(1) via campaign order index. Existing saves stay valid (shipped ids unchanged).

### R3 Gates at curated size
- [RESOLVED: Task measures `validate:levels --seeds 4` on the full curated set (2.1 s/level baseline => ~5-8 min). Decision: no `--shard`, no nightly workflow, no 10% subset by default; PR runs full `validate:levels` for changed levels + the seed-1 determinism lock for all levels (~0.4 s/level => ~1 min). If measured PR delta > +6 min, add `--jobs k` (worker pool as `balance`) before any sharding; record result in tools/README]
- `check:content --base` and `validate:content`: measure at curated size; target < 30 s combined; fix hot spots only if over.
- Lock + unsolved files: stay one JSON each, sorted keys; `levels:lock` supports `--levels <ids>` so SPs refresh only their own.

### R4 Candidate-pool tool (`pnpm census`)
- `tools/src/census/` reads `TW_EXTRACT` level list + the importer's `featuresOf`/`computeBlocked` (reuse `gate.ts`; no second source of truth) for TW Common positions **24-340** (incl. prefab-only ids {35, 66, 137, 215, 221, 266, 329} via `parse-prefab.ts`; positions 4-23 are the shipped 20).
- Per position output (`census.json` + markdown table): `{position, theme, features[], aiBehaviours[], blockedBy[], status: importable|blocked|imported, difficulty: {numAIs, aiStartLevelSum, playerStartLevelSum, ratio, proxyWinRate?, medianWinTick?}}` plus `first-position-per-feature`. Static metrics (numAIs, start levels, ratio) come from level data; proxy metrics (win rate, median win time over 4 seeds x 3 delays) are filled by `pnpm census --metrics` for candidates whose blockers are cleared (run per SP on its own candidates, merged into `census.json`).
- Summary by blocker and per-SP candidate counts (SP -> feature map in `census-sp-map.json`) so each SP sees how many pool levels it can select from.
- Without `TW_EXTRACT`: exits 0 with notice (same convention as `check:import`); `--check` compares to committed `census.json` only when env set.
- Replaces the static snapshot in LEVELS_GUIDE §5 (SP09 does the doc edit: selection table + why).

### R5 Import (curated only)
- No bulk import. `pnpm import:tw` is run only for positions chosen by curation (each SP for its element, SP09 for gaps). SP01 itself imports only levels that need no new mechanic **and** are chosen by SP09 curation later (no import in this SP beyond what its own tests need).
- Drop-policy review recorded in LEVELS_GUIDE: cargo stays dropped; `wall` `onlyLevels` (position 23 only) unchanged until SP02 flips the wall row; `sc`,`MinRD/MaxRD` stay dropped.
- For each imported level: `validate:levels` solvable or an `unsolved-by-proxy.json` entry with reason, `ownerSignOff: null`. Bump content version/hash; refresh `levels-lock.json`.

## Architecture (high level)
- Theme pipeline stays generator-owned: `assets-tw` (spec rows) -> `manifest.fragment` -> `manifest.json#themes`; `ThemeSpec` list is the single source, `THEME_IDS` derived. The gate's `registeredThemes` reads the manifest, so registering a theme automatically unblocks levels - no gate code change.
- Content API: catalog (rules data) vs level (per-file) split; compile cost moves from boot to select (< 50 ms/level expected; measure). Vite emits per-level chunks; service worker/prefetch of the next level is optional (DEFERRED).
- Gate runner: pure `validateLevel` unchanged; optional `--jobs` pool only if measurement demands it.
- Candidate-pool tool imports gate functions; proxy metrics call the existing validate runner; no sim change.
- Coordination: SP05 reads `themes.<t>.river*` slots (schema owned here); SP02-08 each flip their `feature-map.json` rows and use the pool tool to select candidates; `levels:lock --levels` avoids lock-file merge conflicts (same file, different keys).

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Theme count now | all 4 | lava only (needed first at 41) | assets pipeline is one-time work; 41-120 all blocked otherwise |
| 2 | River/ROBS materials | SP01 ships assets + manifest slots | SP05 does it | one extraction pass per theme; avoids re-touching env.ts |
| 3 | Level loading | lazy per-level chunks (re-checked at ~150) | eager (status quo); one chunk per world | ~1.1-1.5 MB + 150 compiles at boot; per-level chunk is simplest and cacheable; Task 1 may flip to eager if cheap |
| 4 | Picker | grouped by world (20) | pagination; infinite scroll | matches theme cycle, tiny UI change |
| 5 | PR gate | full validate (changed) + full seed-1 lock, no sharding | subset sampling; shard/nightly | ~150 levels is ~5-8 min; split not worth it; `--jobs` is the fallback |
| 6 | Full matrix | on-demand `validate:levels --all` pre-merge per phase | nightly sharded | ~5-8 min at curated size |
| 7 | Census = pool tool | reuse `gate.ts`, add difficulty metrics | independent script | one definition of "blocked"; selection needs metrics |
| 8 | Unsolved levels | allowlist with reason, `ownerSignOff: null` | block import | locked decision (owner spot-checks later) |
| 9 | Wall `onlyLevels` | unchanged | drop walls earlier | SP02 owns wall row; avoid double change |
| 10 | Themes by display position | rotate every 20 display levels (D2) | TW source position | contiguous numbering; all 6 appear only if N >= 101, all 4 new art sets ship regardless |

## Manual steps
- Owner: spot-check themes visually (screenshots in `ref/`), and later the unsolved list.
- Run full `validate:levels --all` locally before Phase A merge; set `TW_EXTRACT` for pool tool/import/assets.

## Risks / Open Questions
- [RESOLVED: decode spike first (task: decomp EnvironmentData via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use reuse green's river/ROBS material tinted per theme and record it as a deviation in GAME_RULES + the deviations ledger] Exact `EnvironmentData` prefab/material names for Lava/Mine/Jungle/DarkMine, and whether river/ROBS materials are per-env or shared.
- [RESOLVED: census/assets scripts compare rebuilt-extract pathIDs against `env.ts` verified values and fail loudly on mismatch; on mismatch re-derive values in the rebuilt extract and update `env.ts` in the same task] Rebuilt extract may differ in pathIDs.
- [RESOLVED: N/A under D1; pool tool reports per-SP candidate counts in task 1] Level count unlocked by SP01.
- [RESOLVED: no subset/shard; budget +6 min PR delta; measure curated-size timing in the gate task, add `--jobs` only if over; record result in tools/README] Gate cost at curated size; per-level time may exceed 2.1 s.
- [RESOLVED: lock is small at ~150 levels; measure `validate:content --base` / `check:content` cost in the gate task and adjust only if over 30 s; record result] `check:content` / lock-file diff cost.
- [RESOLVED: measure per-theme ground texture sizes in the assets task; if over budget downscale via existing `downscale()` and record as a deviation in the ledger] Ground texture size per theme.
- [RESOLVED: decode spike first (task: decomp EnvironmentData / level env selection via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use existing `themeFor` mapping and record it as a deviation in GAME_RULES + the deviations ledger] `themeFor` vs TW for levels with `envShift` quirks (prefab-only ids, position mapping); pool tool lists themes per TW position as a cross-check (display-position theme is what ships, D2).

## Acceptance Criteria
- Manifest has 6 themes; `check:manifest`, `assets:tw:check` green; budgets and CREDITS pass; screenshot of each theme ground+obstacles in `ref/`.
- Production bundle contains no level JSON in the main chunk; boot loads 1 level; Playwright e2e (`test:web:e2e`) green; `campaign:verify` handles the curated set (smoke, sample mode per SP09).
- Picker shows worlds; unlock/complete works at ~150 (contiguous display numbering); old saves load.
- `pnpm census` outputs the pool table for 24-340 with features, blocked reasons, difficulty metrics; `--check` stable; each blocked position has >=1 reason.
- `validate:levels` PR delta <= +6 min (or `--jobs` added and documented); `pnpm run ci` green.
- Any level imported here is solvable by proxy or in `unsolved-by-proxy.json` (reason, `ownerSignOff: null`).
