---
status: draft
summary: Hidden always-unlocked na-kane level in a single-entry `kane` campaign, content 2.0.2 + BOT_VERSION bump + locks, levels gate fix, and a test-build-only ?kane=1 boot that auto-starts it.
date: 2026-10-24
---
# PRD: 01 Kane level and boot

Repo/branch: node-arena, `feat/kane-hackday` · Depends on: none · Blocks: 02 (and transitively 03-05)
Owns: `packages/content/data/levels/na-kane.json`, `packages/content/data/campaigns/kane.json`, `packages/content/content.json`, `packages/content/hashes.lock.json`, `packages/bots/src/version.ts`, regenerated goldens (`packages/sim/test/golden/baseline.json`, `packages/bots/test/golden/bots.json`), `tools/src/levels.ts` (+ `tools/test/levels.test.ts`), `apps/web/src/{main.tsx,app/boot.ts}`, kane parts of `apps/web/src/test-harness/{gate,index}.ts`, one e2e spec
Does not own: speed/panel/tags/camera (02), GAME_RULES/RULES_VERSION (untouched), common campaign, importer

## TL;DR
Add `na-kane`, a COPY of in-game Level 7 (`levelview-182-nb`, untouched) plus one neutral tower and five extra obstacles, with a slow `attackOnly` bot, in its own campaign `kane` so `common` stays 20. `?kane=1` (test builds only) boots campaign `kane` and auto-starts `na-kane` in real time. Adding an AI seat forces content 2.0.1 -> 2.0.2 **and** BOT_VERSION 2.0.0 -> 2.0.1 plus lock/golden regeneration. Kane files are kept out of the production bundle by moving them out of the eager content glob.

## Problem
Kane cannot play a real 20-level campaign; it needs a small, forgiving, always-available level. Existing gates assume data/levels == common campaign and lock every level, so a new level file breaks them [verified: tools/src/levels.ts:79-86 throws on mismatch; apps/web/campaign/campaign.spec.ts:31 expects 20].

## Goals / Non-Goals
Goals: level exists and is winnable by a simple strategy; all gates green; `common` untouched; no production exposure.
Non-goals: speed, panel, tags, camera, Kane driver (02/03); levels:lock coverage of na-kane (owner: excluded); picker UI for kane; rules changes.

## Requirements
1. `?kane=1` on a dev / `VITE_TEST_HOOKS=1` build loads straight into `na-kane` playing in real time (no picker, no `test=1` stepping mode). Without the flag, behaviour is unchanged. On a production build the param is ignored.
2. The level: human (blue) vs one AI (yellow), `captureAll`, no time limit. Idle human must not win; a simple chain "capture neutrals, then enemy" wins against it within a few minutes at 0.25x [verified: 24/24 scripted wins, ~1055 ticks = ~211 s wall at 0.25x, idle human loses at 2578 ticks; probe: probes-20261024.md §P-LEVEL].
3. Some obstacles make a few source/target pairs geometry-impossible (02 hides those) while every neutral and the enemy stay reachable by some route [RESOLVED: 7 blocked directed pairs, winning path b0->b2, b0->b4, b2->b1, b1->b3 [probe: probes-20261024.md §P-LEVEL]].
4. Picker/Hud "back" in Kane mode shows a one-card picker of `kane`; it is unlocked (index 0 rule) [verified: app/state.ts `isLevelUnlocked` returns true for i===0].
5. Game result dialog and command log work as for any level (03 reads them).

## Architecture

### Level `na-kane.json` (draft: [na-kane.draft.json](na-kane.draft.json); screenshots in `ref/`)
[RESOLVED: owner 2026-10-24: na-kane is a COPY of in-game Level 7 (`levelview-182-nb.json`, untouched) with edits (extra neutral tower + middle obstacles), not a hand-authored levelview-1 design.] Key order `$schema, schemaVersion, id, name, theme, bounds, objective, timeLimitSec, players, buildings, elements, requires` [verified: CONTENT_GUIDE:42]. The draft file is design input for tasks; it is not yet in the content dir.
| Item | Value |
|---|---|
| id / name | `na-kane` / `Kane Arena` (id must equal file name; `na-` prefix = hand-authored, importer skips it) [verified: import-tw/campaign.ts:50 `HAND_AUTHORED_PREFIX='na-'`] |
| `source` | dropped (optional in schema; read only by importer tools, which skip `na-` ids; nothing in sim/web reads it) [probe: probes-20261024.md §P-LEVEL] |
| theme / bounds | as Level 7: bounds x -8..8, z -7..6, `captureAll`, `timeLimitSec` null |
| buildings (5) | Level 7 b0-b3 unchanged: b0 house-wt1 (5.17,-4.08) human L15; b1 house-wt2 (-0.07,-0.17) neutral L5; b2 house-wt1 (-5.01,-3.08) neutral L15; b3 house-wt1 (-4.7,3.75) AI L5. NEW b4 `tower` (3.6,3.0) neutral L3 (empty top-right quadrant; towers have no `drawsLines`, so a target only, never a pair source); `requires` gains `shoots` |
| elements | all 32 original decor obstacles kept verbatim in order. NEW `om-*`: middle cluster om-0 big 0.9 (2.4,-2.1) yaw 35, om-1 small 0.43 (1.85,-1.65), om-2 small 0.3 (2.95,-2.55) blocks b0->b1 and b0->b3; left cluster om-3 big 0.9 (-4.85,0.45) yaw 15, om-4 small 0.43 (-4.35,0.95) blocks b2<->b3. All inside bounds |
| bot | `{kind:'tw', actionDelayMs:30000, behavior:'attackOnly', script:[]}` (L7 had delay 8000 + script b3->b2 @6000; the script is dropped). Delay is game-time: 30 s = 120 s wall at 0.25x; first bot action lands ~2/3 into Kane's winning run, wins stay 24/24 down to delay 10000. Optional 20000 if the owner wants one enemy action before the win (still 100% wins, 253 s wall) |
| requires | recomputed by validator; `pnpm validate:content` rejects stale list |

Geometry [verified: sim `blocksLines`, probe: probes-20261024.md §P-LEVEL]: blocked directed pairs b0->b1, b0->b3, b1->b0, b2->b3, b2->b4 (blocked by building b1), b3->b0 (building b1), b3->b2. Winning path b0->b2, b0->b4, b2->b1, b1->b3 (b0 cannot reach b1/b3 directly, so Kane must chain). Pair-button count: 2 at start, 4 after b2, 7 max (owning b0,b1,b2) - input for 02. Sim: 24/24 wins (delay 30000/20000/10000 x attackOnly/full x 4 seeds); ~1055 ticks / ~211 s wall at 0.25x; idle human loses; HUMAN_PROXY wins seeds 1-8.

Tuning knob [DEFERRED: tune in rehearsal; optionally lower b2 from L15 to ~L8, untested]: b2 L15 dominates match time (capture ~21 s game = ~84 s wall).

Render [verified: ref/kane-1600-start.png, ref/kane-1600-30s.png; probe: probes-20261024.md §P-RENDER]: middle obstacle clusters read as natural tree clumps (fine); map is small, centred, with ample bottom space for the 02 panel. [DEFERRED: optionally a bigger/more visible obstacle].

### Campaign `kane.json`
`{$schema:'../../schemas/campaign.schema.json', schemaVersion:'2.0.0', id:'kane', entries:[{level:'na-kane', position:4}]}` [verified: schema: id pattern, entries minItems 1, position int >=1]. Draft: [kane-campaign.draft.json](kane-campaign.draft.json). Position 4 gives name `Level 1` (state.ts `position-3`) [verified: loads, schema ok]; never user-visible because the picker is skipped; Kane Arena title comes from level `name` if 02 wants it. HUD title shows `Level N` from position, so boot would show `Level 1` for position 4 [DEFERRED: confirm in rehearsal that boot shows a sensible name; picker is skipped; a Kane-mode title override is optional].

### Version/lock chain
- `contentVersion` 2.0.1 -> 2.0.2 (new level `simHash`) [verified: CONTENT_GUIDE:75]. `rulesVersion` unchanged.
- **BOT_VERSION must also bump** 2.0.0 -> 2.0.1: new AI seat adds a `bots` hash entry [verified: CONTENT_GUIDE:48,77; bot-version.test]. `schemaVersion` unchanged.
- `pnpm content:lock` rewrites `hashes.lock.json` (adds `levels.na-kane`, `bots.na-kane#p2`); never bumps itself.
- Goldens embed versions (`sim/test/golden/baseline.json` contentVersion, `bots/test/golden/bots.json` contentVersion+botVersion): `pnpm sim:golden --update`, `pnpm bots:golden` (update flag per script) require the bump first [verified: sim scripts/golden.cjs:23; bots golden.test R6]. Replay goldens under `tools/test` (replay-golden.test) also read versions: run and regenerate if red.
- Not hashed: `levels-lock.json` (per-level; na-kane intentionally absent), `unsolved-by-proxy.json`.
- Unit tests that hardcode "2.0.1" are fixtures (content/versioning/hashing), not content.json [verified: grep]; expect no edit.

### Gate fix `tools/src/levels.ts campaignLevels()`
Keep returning common entries only. Mismatch check: `files` minus levels referenced by any non-common campaign (`Object.entries(catalog.campaigns)` where id !== 'common'); still throw on truly orphan files and on common entries without files. Message keeps `data/campaigns/common.json`. `validateLevels`/`buildLock` then never see na-kane. Add test in `tools/test/levels.test.ts`: kane-listed file tolerated; unlisted extra file still throws. `check:import` unaffected (orphan rule exempts `na-` files; it only reads common.json) [verified: import-tw/run.ts:131]. `campaign.spec.ts` reads common.json only, still 20. Importer `CAMPAIGN_FILE` is common.json only.

### Boot `?kane=1` (production exclusion)
Problem: `app/boot.ts` eagerly globs `packages/content/data/**/*.json`, so na-kane and kane.json would ship in production, hidden but present, violating "no production change" in spirit (bytes, not behaviour).
Design:
- `boot.ts`: add FULL relative-path negations to the glob: `'!../../../../packages/content/data/levels/na-kane.json'` and `'!../../../../packages/content/data/campaigns/kane.json'`. `'!**/na-kane.json'`-style negation does NOT work (markers stayed in dist) [RESOLVED: full relative negation works in build and dev [probe: probes-20261024.md §P-INFRA-Q1]].
- Test-only module (e.g. `test-harness/kane-files.ts`, imported inside the existing gated block; `test-harness/index.ts` may re-export): second eager glob for exactly those two files, exported `kaneContentFiles()`. Normal build tree-shakes it (0 markers); `VITE_TEST_HOOKS=1` build includes it [verified: probe: probes-20261024.md §P-INFRA-Q1].
- `main.tsx`: after harness creation merge `kaneContentFiles()` into `files` (test builds only; `loadContent` stays valid because the campaign references a present level), then `createAppController({files, campaignId: harness?.options.campaignId, ...})`.
- `gate.ts TestHookRequest` gains `kane: boolean` (`q.get('kane')==='1'`, false when `enabled` false).
- harness `options.campaignId = request.kane ? 'kane' : undefined` (AppOptions.campaignId exists, state.ts:46). `isolated` includes `request.kane` so the real localStorage save isn't touched. `autoLoad`: `if(request.kane) await app.startLevel('na-kane', request.seed)`; `autoStart` stays true because Kane URL has no `test=1`. `resolve()`/common `entries` untouched; unknown-campaign state.ts throws `Campaign not found` if kane.json missing from files, so the merge is mandatory.
- Verify exclusion (acceptance gate): `pnpm build` then grep production `dist` for a kane marker (`na-kane`, `Kane Arena`) = 0; `VITE_TEST_HOOKS=1 pnpm build` contains it.

### Interface for 02 (and 03)
| Surface | Contract |
|---|---|
| `TestHookRequest.kane` (gate.ts) | true only in test builds with `?kane=1`; 02 sets default speed 0.25 here (`speed` parse: `q.get('speed')` else kane ? 0.25 : 1) |
| `window.__na.kane: boolean` | add to harness api (`kane: request.kane`); 02 mounts panel/tags only when true |
| `window.__na.state().levelId === 'na-kane'` | CDP-readable proof of level for 03 |
| URL | `http://127.0.0.1:<port>/?kane=1` (optionally `&seed=N`, `&speed=`) |
| Shared files with 02 | `test-harness/gate.ts`, `test-harness/index.ts`, `main.tsx` (01 lands first; 02 rebases) |

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Level file name | `na-kane` | `kane-arena` | `na-` prefix is the importer's hand-authored marker |
| 2 | Bot easiness | delay 30000 + attackOnly, script [], keep `kind:'tw'` | new bot kind / code difficulty | content knob only; brief locked; 24/24 sim wins |
| 8 | Level source | Copy of Level 7 + tower + 5 obstacles | hand-authored levelview-1 6-building design | owner 2026-10-24; real in-game map |
| 3 | Version bumps | content 2.0.2 + BOT_VERSION 2.0.1 | content only | gate rejects new seat without BOT_VERSION bump |
| 4 | Gate fix | exclude files listed in non-common campaigns | allowlist id in tools; move level out of data/levels | brief locked; keeps orphan detection |
| 5 | Prod exclusion | full-relative glob negation + test-only glob (verified) | accept bundled-but-unreachable | zero prod bytes; small cost |
| 6 | Campaign position | 4 | 1 | name `Level 1` instead of `Level -2`; unseen |
| 7 | Save | isolated in-memory save in Kane mode | real localStorage | demo reruns identical; no pollution |

## Risks / Open Questions
- [RESOLVED: 24/24 scripted wins, idle human loses, every building reachable by some route [probe: probes-20261024.md §P-LEVEL]] Winnability. Level stays outside `levels:lock`, so this is manual evidence, not a gate.
- [RESOLVED: full relative-path negation works in dev and build; `!**/` form fails; test-only second glob tree-shaken from normal build [probe: probes-20261024.md §P-INFRA-Q1]] Glob negation behaviour.
- [DEFERRED: resolve during implementation — run pnpm sim:golden, pnpm bots:golden, pnpm replay:verify golden after version bumps; follow tools/README.md] `bots:golden` update CLI flag/behaviour (golden.mjs) and whether replay goldens need regeneration; discover when running gates.
- [RESOLVED: owner] na-kane excluded from `levels:lock`/`validate:levels`.
- [DEFERRED: verify at runtime in rehearsal] HUD title for position 4 shows `Level 1`; confirm boot shows a sensible name.
- [DEFERRED: tune in rehearsal] b2 level 15 dominates match time (~84 s wall of ~211 s); optionally lower to ~L8 (untested).
- [DEFERRED] Bigger obstacle for visibility (middle cluster reads as tree clumps, acceptable); Picker label/title for the Kane campaign; Kane-specific result screen.
- Note: `?level=` resolves only campaign ids, so `?kane=1` boot must go through `app.startLevel('na-kane')` as designed; no `test=1` [probe: probes-20261024.md §P-INFRA-Q3].

## Acceptance Criteria
- `pnpm validate:content --base HEAD`, `pnpm check:content --base HEAD`, `pnpm check:schemas`, `pnpm check:rules` green; content.json 2.0.2, BOT_VERSION 2.0.1, rulesVersion 2.0.0.
- `pnpm validate:levels` and `pnpm levels:lock` unchanged (`git diff tools/levels-lock.json` empty); still 20 levels; new tools test passes; orphan file still errors.
- `pnpm sim:golden`, `pnpm bots:golden`, `pnpm replay:verify golden`, `pnpm check:import`, `pnpm test` green.
- `pnpm campaign:verify` still 20 levels; `common.json` byte-identical.
- New e2e (test build): `/?kane=1` -> `__na.screen==='playing'`, `__na.state().levelId==='na-kane'`, `__na.kane===true`; `/` without flag and `?kane=1` on a production build load picker with 20 cards.
- Production-build gate: `grep -r` for kane markers (`na-kane`, `Kane Arena`) over production `apps/web/dist` = 0; same grep over a `VITE_TEST_HOOKS=1` build > 0 (script or e2e step).
- Proxy run evidence re-run against the final committed level: HUMAN_PROXY wins >=1, idle human wins 0 (prior evidence: probes-20261024.md §P-LEVEL).
