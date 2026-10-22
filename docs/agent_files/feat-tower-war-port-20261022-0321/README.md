---
status: draft
summary: Tower War port — 9 sub-project PRDs (design only)
date: 2026-10-22
---
# Tower War port (feat/tower-war-port)

## Goal
Copy Tower War 1.29.3 into Node Arena as a simplified browser game that replaces ours. Ship the first 20 campaign levels (positions 4–23) and a base that later levels/features can extend. Design only: PRDs, no code yet.

## Sub-projects
| # | Name | PRD | Scope | Depends on | Status |
|---|---|---|---|---|---|
| 01 | Rules v2 contract | [PRD](01-rules-v2-contract/PRD.md) | GAME_RULES v2.0.0: 38 rule ids, integer 20 Hz milli-tick formulas | none | draft |
| 02 | Registry + content v2 | [PRD](02-registry-content-v2/PRD.md) | `packages/defs` registry, content model, CUT of old content, 2.0.0 versions | 01 | draft |
| 03 | Sim core | [PRD](03-sim-core/PRD.md) | Rewrite `packages/sim` as TW engine, streams, hash/replay v2, seams for 04 | 01, 02 | draft |
| 04 | Geometry + shooters | [PRD](04-geometry-shooters/PRD.md) | Blocking, lane crossing combat, shooting tower, lane-interval seam | 03, 02 | draft |
| 05 | Level importer | [PRD](05-level-importer/PRD.md) | `TW_EXTRACT` -> level v2 for positions 4–23, gating, LEVELS_GUIDE | 02 (soft 01, 04) | draft |
| 06 | AI port | [PRD](06-ai-port/PRD.md) | Delete our bots; exact TW AI copy; TW-AI-as-proxy level validation | 03, 05 (soft 02, 04) | draft |
| 07 | Art pipeline | [PRD](07-art-pipeline/PRD.md) | TW art -> committed GLB/textures, instanced team-texture renderers | 02 (soft) | draft |
| 08 | Web client | [PRD](08-web-client/PRD.md) | Camera, HUD, input, screens, save v2; delete legacy UI | 03, 07 (soft 04, 05, 02) | draft |
| 09 | Gates, tooling, docs | [PRD](09-gates-tooling-docs/PRD.md) | Gate inventory/redefinition, parked CI scaffold, docs, final acceptance | all (Phase A first) | draft |

## Execution order
09 Phase A (task 0: PARKED runner + VERSION_GUARD_BASE) -> 01 -> 02 (steps 1–3 additive; step 4 CUT shared with 03 T1) -> 03 + 05 + 07 in parallel -> 04 -> 06 -> 08 -> 09 rest.
Max 2 concurrent agents.

## Locked decisions (owner)
- Replace, not extend: RULES_VERSION 2.0.0, BOT_VERSION 2.0.0, no compat; old content/bots/visuals deleted.
- Exact TW numbers; flat unit stats; 20 Hz deterministic + seeded streams; stage thresholds 10/30.
- Repo private; TW assets committed.
- Levels = positions 4–23 (incl. prefab 182_NB, 100_ES); no tutorials.
- Drop wall in 100_ES and cargo (recorded in `source.dropped`).
- No meta/PvP/currencies/upgrades.
- BOOSTERS deferred (FUTURES).
- Their AI copied exactly; our bots deleted.
- Landscape via importer-time rotation (x,z)->(z,-x), single mirror at worldRoot (Frame contract in 02).
- Neutral towers FIRE (`neutralFires=true`).
- Unwinnable-by-proxy levels -> `tools/unsolved-by-proxy.json` allowlist + owner playtest.
- Local only, no deploy.
- Trust decomp on contradictions.
- LEVELS_GUIDE + coverage snapshot for future levels.

## Critique
[critique-2026-10-22-0500.md](critique-2026-10-22-0500.md): 9 blocking / 10 non-blocking / 4 suggestions — all applied to PRDs.

## Remaining [OPEN] items
| PRD | Item |
|---|---|
| 01 | Blocking footprints (OBS-01): which collider `CheckBlock` tests for buildings; obstacle child sizes (proposal: `Building` 1.5 box) |
| 02 | Footprint sizes from 05 Task 0 `colliders.json`; 04 writes values (single commit + content bump) |
| 02 | Owner accepts parked window at CUT (alt: hold CUT until 06/08 ready) |
| 03 | `fwd` draw semantics vs TW (cap vs lane-pick order) unverifiable; behaviour-neutral |
| 03 | `check:rules` red until SP04 tags CMB-04/TWR/OBS (accepted by 01); tower cooldown set at fire |
| 04 | Obstacle collider size per child (not exported) |
| 04 | Shooter detection range upper bound (trigger sphere reach; medium confidence) |
| 04 | Tower vs neutral houses (`hitsNeutralHouses`; lambda not decompiled; default no) |
| 04 | Endpoint-contact fidelity; arrival at centre vs `Hit` box (shared with 03) |
| 05 | 02: optional `source`/`position` for hand-authored levels; `--fix-requires`; optional campaign `loop` |
| 05 | Whether `source.dropped` needs counts (strings today) |
| 06 | Timer order in Delay/CreateWay behaviors and capture-poll first check (read decomp first) |
| 06 | 03 must expose `streams.fork(name, index).below(n)` (API name) |
| 06 | Resource-pile targets dropped: shifts weakest-first order on 412 levels; accepted |
| 07 | Default skin = skin id 1 per type? verify pids 2404/2394/2415 |
| 07 | Env 0 prefab/mesh/material mapping (Addressables GUIDs, catalog.bin unparsed); time-boxed one task, fallback defined |
| 07 | Which Obstacle.prefab children small/big, local scale, inactive flags |
| 07 | Unity colour space (gamma vs linear) |
| 07 | Level-number font/outline, stage-transition ring colour, WayBaseStandard lane texture |
| 07 | Tank turret part rotating vs static in `1_BaseAttackSkin` |
| 08 | Mouse drag delay (0.2 s touch; mouse instant) + eraser enter/exit UX after feel test |
| 08 | Ownership bar: level sum vs troops incl. units; neutral shown? |
| 08 | HUD slot positions/sizes and sprites (not exported) |
| 08 | TW UI font (fallback: bundled OFL font) |
| 08 | Keep `quality` setting (per 07 perf result) |
| 09 | CI time budget and seeds for `validate:levels` (default 4, fallback 2) |
| 09 | Repo private permanently? if public, TW art excluded/replaced (owner) |
| 09 | Git LFS for GLB/textures? measure at 07 end |
| 09 | Web bundle/size budget gate beyond per-model budgets |

## Owner manual steps
- 04 (optional): on a real-device TW, check whether towers shoot neutral houses.
- 05: optional TW screenshots for mirror check and theme boundary.
- 07: optional 4–6 real screenshots (levels 4, 8, 15, 21–23; snow) to `BF/ref/real/`; confirm committing extracted art (<3 MB est.) is OK.
- 08: final visual approval of HUD vs refs; optional real HUD screenshots.
- 09: run `TW_EXTRACT=... pnpm check:import && pnpm assets:tw:check` locally before merge (CI cannot).
- 09: play levels 1–20 (positions 4–23); fill `09-gates-tooling-docs/owner-pass.md`; visual approval.
- 09: accept parked window at CUT; decide repo visibility vs TW art.
- 01, 02, 03, 06: none.
