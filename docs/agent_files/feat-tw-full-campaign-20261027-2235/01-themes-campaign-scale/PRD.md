---
status: draft
summary: Add Lava/Mine/Jungle/DarkMine themes, make client boot, picker, save and the level gates scale to ~337 Common levels (positions 4-340), add a generated coverage-census script, and import every level <=340 that needs no new mechanic.
date: 2026-10-27
---
# PRD: 01 Themes + campaign scale

Repo/branch: node-arena, `feat/tw-full-campaign` (Phase A PR = SP01+02+03) · Depends on: none · Feeds: 02-09 (themes, census, lazy loading, gate split)
Owns: `tools/src/assets-tw/{env,manifest-fragment}.ts` (theme lists/specs), `apps/web/assets/{models,textures}/tw/*-{lava,mine,jungle,darkmine}*`, `apps/web/assets/manifest.json` `themes` (generated), `docs/CREDITS.md` rows, `apps/web/src/app/{boot,state}.ts` + `ui/Picker.tsx` + `save/` (campaign scale), `tools/src/levels*.ts` + `cli.ts` (gate scale/sharding), `.github/workflows/*` (nightly), new `tools/src/census/**`, `packages/content/data/{levels,campaigns/common.json}` (imported rows), `tools/levels-lock.json`, `tools/unsolved-by-proxy.json`.
Does not own: mechanics (02-08), `feature-map.json` rows for new features (each SP flips its own), river/ROBS behaviour (05), final docs (09).

## TL;DR
Today the game holds 20 levels and 2 themes. This SP (a) ships the 4 missing themes (incl. river/ROBS materials for SP05), (b) stops the client eagerly bundling + compiling every level JSON, (c) splits `validate:levels` into a PR subset and a nightly full run, (d) adds `pnpm census` (blocked-by-why per position, from `TW_EXTRACT`), (e) imports all positions <=340 that need no new mechanic. Unlocked count is measured by the census, not guessed.

## Problem
- Theme gate: `themeFor` yields lava at 41, mine 61, jungle 81, darkmine 101, then the cycle repeats (all 6 by 120; position 340 = jungle). Only `green`,`snow` are registered, so every level >=41 except snow 21-40 is blocked on theme alone [verified: gate.ts `ENV`; manifest `themes` keys = green,snow].
- Theme ids hard-coded twice: `ENV_THEMES` (assets-tw/env.ts:11) and `THEME_IDS` (manifest-fragment.ts:12). Adding a theme = spec row + both lists.
- Eager boot: `import.meta.glob(.../data/**/*.json, {eager:true, query:'?raw'})` in `app/boot.ts`, then `loadContent` validates + compiles every level before first paint [verified: boot.ts L2; content.ts L21-25]. Levels are ~7.5 KB avg (21 files = 156 KB, max 10 KB) -> ~337 files ≈ 2.5-3 MB raw JS strings in the main chunk plus full compile at boot (estimate; measure in Task 1).
- Picker renders one card per campaign entry, no paging; unlock/complete by level id in `save/` [verified: Picker.tsx L14-19]. 337 cards in one flat grid is unusable on mobile.
- Gate cost: `validate:levels --seeds 4` = 45 s for 21 levels single-threaded [measured: `time pnpm validate:levels --seeds 4`, 45.4 s] ≈ 2.1 s/level. Linear -> ~12 min at 337 levels; later levels are bigger (more buildings/AIs) and stalemates run to the 20000-tick cap, so assume 15-25 min. It runs inside `pnpm run ci` on a 2-node matrix, single process (no worker pool in `levels.ts`; `balance` has `--jobs`).
- Census is a static snapshot in LEVELS_GUIDE §5 and FUTURES ("generated coverage census") [verified: FUTURES.md L37].

## Goals
1. Four themes registered and rendered: ground + small/big obstacle + river + river-obstacle materials, within existing budgets.
2. Cold boot loads catalog + one level, not 337; first paint time not worse than today +10%.
3. Picker + progress usable at 337 levels (grouped by theme "world" of 20).
4. PR CI wall-time increase <= +3 min; full 4x3 matrix runs nightly + on-demand.
5. `pnpm census` prints per-position blocked reasons and a per-SP delta table; deterministic output.
6. Every position <=340 whose blockers are only themes/already-supported features is imported, locked, and solvable-or-allowlisted.

## Non-Goals
New mechanics (02-08). Cargo/Wall `onlyLevels` re-opening beyond review (see D9). Level thumbnails per card. Cloud save. Skins/boosters. Positions >340 (wrapping is TW's `skip + loop`; not needed).

## Requirements

### R1 Themes (art)
- Add 4 `ThemeSpec` rows in `assets-tw/env.ts` (prefab names from `EnviromentSettings` order Lava, Mine, Jungle, DarkMine; `EnvironmentData` = ground prefab + small/big obstacle mesh + obstacle/river-obstacle/river materials, 02-levels §4.4). Extend both theme lists from one shared const.
- Output per theme: `ground-<t>.glb/png`, `obstacle-<t>.glb/png` (small+big), and **river + river-obstacle** textures/materials as manifest `themes.<t>.river`/`riverObstacle` slots (schema addition in `manifest.schema.ts`, optional so green/snow stay valid). SP01 ships assets+slots; SP05 consumes them.
- Per-theme `light`/`sky` from the existing derivation (mean edge colour). Obstacle mesh is env-driven, not per-id (PRD 07).
- Budgets: green+snow ground+obstacle are small (ground 200 tris, obstacle 66); target <= +1.5 MB gzip for 4 themes; `check:manifest` enforces. Credits rows added; `assets:tw:check` regenerates byte-identically.
- Obstacle `#small`/`#big` may be the same mesh (snow is); a theme with one mesh must still resolve both.

### R2 Client scale
- Split content: eager = `balance`, `buildings`, `units`, `elements`, `campaigns`; **lazy** = `levels/*.json` via `import.meta.glob(..., {eager:false})` -> one dynamic chunk per level (or per 20-level world). Load + `compileLevel` on select; cache.
- `@node-arena/content` gains `loadCatalog(files)` + `loadLevelOnDemand(catalog, source)`; `loadContent` stays (tools/tests use it). Unknown-level checks in campaign validation move to tools (`validate:content`), client trusts catalog.
- `state.ts` takes `levels` list from campaign entries only (already so); level display name/number from campaign, not from loaded level. Custom levels (`na-*`) stay eager (few).
- Picker: campaign view grouped by 20-level world (theme name + colour chip), collapsed/paged, scroll-to-current; `data-level-id` selectors preserved for e2e.
- Save: keyed by level id, so 337 entries is 337 keys in one JSON; verify size < 20 KB and that unlock rule (`isLevelUnlocked`) is O(1) via campaign order index. Existing saves stay valid (ids unchanged).

### R3 Gates at scale
- `validate:levels`: add `--shard i/n` and `--jobs k` (worker pool, as `balance` does); PR default = subset; `--all` = full.
- Subset rule (proposal): all levels changed in the PR (git diff vs base) + the first level of each 20-world + a deterministic 10% sample (hash of id) at 4 seeds x 3 delays; seed-1 determinism lock (`levels-lock.json`, hash-only, 1 run/level ≈ 0.4 s) checked for **all** levels on every PR (≈ 2-3 min at 337, 1 worker; less with jobs).
- Nightly workflow (new `nightly.yml`, modelled on `balance.yml`): full 4 seeds x 3 delays, sharded 4-way, uploads report; failure opens an issue, does not block PRs. Phase PRs run a manual full run before merge (Manual steps).
- `check:content --base` and `validate:content`: measure at 337; target < 60 s combined; fix hot spots only if over.
- Lock + unsolved files: stay one JSON each, sorted keys (diff-friendly); `levels:lock` supports `--levels <ids>` so SPs refresh only their own.

### R4 Census (`pnpm census`)
- `tools/src/census/` reads `TW_EXTRACT` level list + the importer's `featuresOf`/`computeBlocked` (reuse `gate.ts`; no second source of truth) for campaign positions 4-340 (incl. the 9 prefab-only ids <=340 {10, 23, 35, 66, 137, 215, 221, 266, 329}, 10 and 23 already shipped, via `parse-prefab.ts`).
- Output: `docs/agent_files/.../census.json` + markdown table: per position `{id, theme, features[], blockedBy[], status: imported|blocked}`; summary by blocker (first-blocker and any-blocker counts) and **cumulative unlock by SP** (SP-> feature map, taken from a small `census-sp-map.json`).
- Without `TW_EXTRACT`: exits 0 with notice (same convention as `check:import`); `--check` compares to committed `census.json` only when env set.
- Replaces the static snapshot in LEVELS_GUIDE §5 (09 does the doc edit; SP01 provides the file + a docs link).

### R5 Import (<=340, no new mechanic)
- Run `pnpm import:tw --range 4-340` after R1; accept levels whose blocked list is empty; blocked ones remain in the census with reasons.
- Drop-policy review recorded in LEVELS_GUIDE (or census notes): cargo stays dropped; `wall` `onlyLevels` (position 23 only) is left unchanged until SP02 flips the wall row; theme-only blockers disappear; `sc`,`MinRD/MaxRD` stay dropped.
- For each imported level: `validate:levels` solvable or an `unsolved-by-proxy.json` entry with reason, `ownerSignOff: null`. Bump content version/hash; refresh `levels-lock.json`.
- Expected count: census-derived. The static tracker puts base-only (houses+tower+obstacles+scripts) at <=312 of 1,012 TW levels; of positions <=340 only the fraction with no wall/mine/WT3/WOD/BT2/river/rocket/... blocks (census answers; [RESOLVED: measured by `pnpm census` in task 1 and recorded in the SP01 PR delta table]).

## Architecture (high level)
- Theme pipeline stays generator-owned: `assets-tw` (spec rows) -> `manifest.fragment` -> `manifest.json#themes`; `ThemeSpec` list is the single source, `THEME_IDS` derived. The gate's `registeredThemes` reads the manifest, so registering a theme automatically unblocks levels - no gate code change.
- Content API: catalog (rules data) vs level (per-file) split; compile cost moves from boot to select (< 50 ms/level expected; measure). Vite emits per-level chunks; service worker/prefetch of the next level is optional (DEFERRED).
- Gate runner: pure `validateLevel` unchanged; add outer sharding/pool and subset selection; nightly invokes the same CLI with `--all`.
- Census imports gate functions; no sim dependency.
- Coordination: SP05 reads `themes.<t>.river*` slots (schema owned here); SP02-08 each flip their `feature-map.json` rows and run `pnpm census --check` to show delta; sharded `levels:lock --levels` avoids lock-file merge conflicts (same file, different keys).

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Theme count now | all 4 | lava only (needed first at 41) | assets pipeline is one-time work; 41-120 all blocked otherwise |
| 2 | River/ROBS materials | SP01 ships assets + manifest slots | SP05 does it | one extraction pass per theme; avoids re-touching env.ts |
| 3 | Level loading | lazy per-level chunks | eager (status quo); one chunk per world | 3 MB + 337 compiles at boot; per-level chunk is simplest and cacheable |
| 4 | Picker | grouped by world (20) | pagination; infinite scroll | matches theme cycle, tiny UI change |
| 5 | PR gate | subset + full seed-1 lock | full every PR; lock only | keeps CI ~+3 min; determinism still total |
| 6 | Full matrix | nightly sharded + manual pre-merge per phase | every PR | 15-25 min single-process |
| 7 | Census | reuse `gate.ts` | independent script | one definition of "blocked" |
| 8 | Unsolved levels | allowlist with reason, `ownerSignOff: null` | block import | locked decision (owner spot-checks later) |
| 9 | Wall `onlyLevels` | unchanged | drop walls earlier | SP02 owns wall row; avoid double change |
| 10 | Theme repeat >120 | `themeFor` unchanged (no envShift) | per-level override | matches TW `(i/20)%6` |

## Manual steps
- Owner: spot-check themes visually (screenshots in `ref/`), and later the unsolved list.
- Run full `validate:levels --all` locally/nightly before Phase A merge; set `TW_EXTRACT` for census/import/assets.

## Risks / Open Questions
- [RESOLVED: decode spike first (task: decomp EnvironmentData via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use reuse green's river/ROBS material tinted per theme and record it as a deviation in GAME_RULES + the deviations ledger] Exact `EnvironmentData` prefab/material names for Lava/Mine/Jungle/DarkMine, and whether river/ROBS materials are per-env or shared.
- [RESOLVED: census/assets scripts compare rebuilt-extract pathIDs against `env.ts` verified values and fail loudly on mismatch; on mismatch re-derive values in the rebuilt extract and update `env.ts` in the same task] Rebuilt extract may differ in pathIDs.
- [RESOLVED: census answers the count in task 1; if <30 levels the PR stays small, acceptable] Level count actually unlocked by SP01.
- [RESOLVED: start at 10% sample / +3 min budget; measure 337-level timing in the gate-split task and adjust; record result in tools/README] Subset sample rate and budget; per-level time may exceed the 2.1 s estimate.
- [RESOLVED: lock ~34 KB is fine; measure `validate:content --base` / `check:content` git-diff cost at 337 levels in the gate-split task and adjust (e.g. shard); record result] `check:content` / lock-file diff cost.
- [RESOLVED: measure per-theme ground texture sizes in the assets task; if over budget downscale via existing `downscale()` and record as a deviation in the ledger] Ground texture size per theme.
- [RESOLVED: decode spike first (task: decomp EnvironmentData / level env selection via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use existing `themeFor` mapping and record it as a deviation in GAME_RULES + the deviations ledger] `themeFor` vs TW for levels with `envShift` quirks (prefab-only ids, position mapping); census lists themes per position as a cross-check.

## Acceptance Criteria
- Manifest has 6 themes; `check:manifest`, `assets:tw:check` green; budgets and CREDITS pass; screenshot of each theme ground+obstacles in `ref/`.
- Production bundle contains no level JSON in the main chunk; boot loads 1 level; Playwright e2e (`test:web:e2e`) green; `campaign:verify` extended to the imported set (smoke, sharded).
- Picker shows worlds; unlock/complete works at 337; old saves load.
- `pnpm census` outputs table for 4-340; `--check` stable; each blocked position has >=1 reason.
- `validate:levels` subset on PR within +3 min; nightly full run green or allowlisted; `levels-lock.json` covers all imported levels; `pnpm run ci` green.
- Every imported level solvable by proxy or in `unsolved-by-proxy.json` (reason, `ownerSignOff: null`).
