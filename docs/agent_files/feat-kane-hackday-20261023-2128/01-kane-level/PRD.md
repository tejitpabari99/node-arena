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
Add one hand-authored 5-6 building level with obstacles and a slow `attackOnly` bot, in its own campaign `kane` so `common` stays 20. `?kane=1` (test builds only) boots campaign `kane` and auto-starts `na-kane` in real time. Adding an AI seat forces content 2.0.1 -> 2.0.2 **and** BOT_VERSION 2.0.0 -> 2.0.1 plus lock/golden regeneration. Kane files are kept out of the production bundle by moving them out of the eager content glob.

## Problem
Kane cannot play a real 20-level campaign; it needs a small, forgiving, always-available level. Existing gates assume data/levels == common campaign and lock every level, so a new level file breaks them [verified: tools/src/levels.ts:79-86 throws on mismatch; apps/web/campaign/campaign.spec.ts:31 expects 20].

## Goals / Non-Goals
Goals: level exists and is winnable by a simple strategy; all gates green; `common` untouched; no production exposure.
Non-goals: speed, panel, tags, camera, Kane driver (02/03); levels:lock coverage of na-kane (owner: excluded); picker UI for kane; rules changes.

## Requirements
1. `?kane=1` on a dev / `VITE_TEST_HOOKS=1` build loads straight into `na-kane` playing in real time (no picker, no `test=1` stepping mode). Without the flag, behaviour is unchanged. On a production build the param is ignored.
2. The level: human (blue) vs one AI (red), `captureAll`, no time limit. Idle human must not win; a simple chain "capture neutrals, then enemy" wins against it within a few minutes at 0.25x.
3. Some obstacles make a few source/target pairs geometry-impossible (02 hides those) while every neutral and the enemy stay reachable by some route [OPEN-lite: verify with `sim.canDraw`, see Architecture].
4. Picker/Hud "back" in Kane mode shows a one-card picker of `kane`; it is unlocked (index 0 rule) [verified: app/state.ts `isLevelUnlocked` returns true for i===0].
5. Game result dialog and command log work as for any level (03 reads them).

## Architecture

### Level `na-kane.json` (proposal; tune by playtest)
Copy `levelview-1.json` shape; key order `$schema, schemaVersion, id, name, theme, bounds, objective, timeLimitSec, players, buildings, elements, requires` [verified: CONTENT_GUIDE:42].
| Item | Value |
|---|---|
| id / name | `na-kane` / `Kane Arena` (id must equal file name; `na-` prefix = hand-authored, importer skips it) [verified: import-tw/campaign.ts:50 `HAND_AUTHORED_PREFIX='na-'`] |
| `source` | omitted (optional in schema) [verified: level.schema.json required list lacks source] |
| theme / bounds | `green` / ~L1 bounds (-9..6, -7..8); shrink if camera framing needs |
| buildings (6) | b0 house-wt1 human lvl 20 (left); b1 house-wt1 AI lvl 6 (far right, behind obstacles); b2-b5 neutrals: 3 houses lvl 2-5 + 1 `tower` lvl 3 in between |
| elements | 3-4 `obstacle` (copy footprint shape from levelview-10: box, yawDeg, variant small/big), placed to block b0->b1 direct line and one b0->neutral line; `requires` gains `blocksLines` |
| bot | `{kind:'tw', actionDelayMs:30000, behavior:'attackOnly', script:[]}` (L1 = 12000/full). `attackOnly` skips the defense step only; enemy still attacks, so delay is the main knob [verified: bots/src/tw-ai.ts:98-102]. Delay is game-time, so at 0.25x one enemy action ~2 real minutes |
| requires | recomputed by validator; `pnpm validate:content` rejects stale list |

### Campaign `kane.json`
`{$schema:'../../schemas/campaign.schema.json', schemaVersion:'2.0.0', id:'kane', entries:[{level:'na-kane', position:4}]}` [verified: schema: id pattern, entries minItems 1, position int >=1]. Position 4 gives name `Level 1` (state.ts `position-3`), never user-visible because the picker is skipped; Kane Arena title comes from level `name` if 02 wants it.

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
- `boot.ts`: add negation to glob `'!../../../../packages/content/data/{levels/na-kane,campaigns/kane}.json'`.
- `test-harness/index.ts` (dynamic import already gated by `import.meta.env.DEV||VITE_TEST_HOOKS==='1'`, main.tsx:14): second eager glob for exactly those two files, exported `kaneContentFiles()`. Prod build never includes the module [verified: main.tsx comment "Rollup remove both dynamic imports"].
- `main.tsx`: after harness creation merge `kaneContentFiles()` into `files` (test builds only; `loadContent` stays valid because the campaign references a present level), then `createAppController({files, campaignId: harness?.options.campaignId, ...})`.
- `gate.ts TestHookRequest` gains `kane: boolean` (`q.get('kane')==='1'`, false when `enabled` false).
- harness `options.campaignId = request.kane ? 'kane' : undefined` (AppOptions.campaignId exists, state.ts:46). `isolated` includes `request.kane` so the real localStorage save isn't touched. `autoLoad`: `if(request.kane) await app.startLevel('na-kane', request.seed)`; `autoStart` stays true because Kane URL has no `test=1`. `resolve()`/common `entries` untouched; unknown-campaign state.ts throws `Campaign not found` if kane.json missing from files, so the merge is mandatory.
- Verify exclusion: `pnpm build` then `grep -c na-kane apps/web/dist/**` = 0; `VITE_TEST_HOOKS=1 pnpm build` contains it.

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
| 2 | Bot easiness | delay 30000 + attackOnly, keep `kind:'tw'` | new bot kind / code difficulty | content knob only; brief locked |
| 3 | Version bumps | content 2.0.2 + BOT_VERSION 2.0.1 | content only | gate rejects new seat without BOT_VERSION bump |
| 4 | Gate fix | exclude files listed in non-common campaigns | allowlist id in tools; move level out of data/levels | brief locked; keeps orphan detection |
| 5 | Prod exclusion | glob negation + test-only glob | accept bundled-but-unreachable | zero prod bytes; small cost |
| 6 | Campaign position | 4 | 1 | name `Level 1` instead of `Level -2`; unseen |
| 7 | Save | isolated in-memory save in Kane mode | real localStorage | demo reruns identical; no pollution |

## Risks / Open Questions
- [OPEN] Winnability: tune obstacle/neutral layout so the pair set offers a short win (target <= ~8 moves) and every building is reachable; validate by a throwaway script using `validateLevel` on na-kane (proxy wins >=1, idle human never wins). Level stays outside `levels:lock` so this is manual evidence, not a gate.
- [OPEN] Does `import.meta.glob` negation behave identically under Vite dev and build for this pattern? Verify first task; fallback = accept bundled-but-unreachable (Decision 5 alt) and record the tradeoff.
- [OPEN] `bots:golden` update CLI flag/behaviour (golden.mjs) and whether replay goldens need regeneration; discover when running gates.
- [RESOLVED: owner] na-kane excluded from `levels:lock`/`validate:levels`.
- [DEFERRED] Picker label/title for the Kane campaign; Kane-specific result screen.

## Acceptance Criteria
- `pnpm validate:content --base HEAD`, `pnpm check:content --base HEAD`, `pnpm check:schemas`, `pnpm check:rules` green; content.json 2.0.2, BOT_VERSION 2.0.1, rulesVersion 2.0.0.
- `pnpm validate:levels` and `pnpm levels:lock` unchanged (`git diff tools/levels-lock.json` empty); still 20 levels; new tools test passes; orphan file still errors.
- `pnpm sim:golden`, `pnpm bots:golden`, `pnpm replay:verify golden`, `pnpm check:import`, `pnpm test` green.
- `pnpm campaign:verify` still 20 levels; `common.json` byte-identical.
- New e2e (test build): `/?kane=1` -> `__na.screen==='playing'`, `__na.state().levelId==='na-kane'`, `__na.kane===true`; `/` without flag and `?kane=1` on a production build load picker with 20 cards.
- `grep -r na-kane apps/web/dist` = 0 in production build.
- Throwaway proxy run evidence: na-kane proxy wins >=1, idle human wins 0.
