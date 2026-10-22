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
| 04 | Geometry + shooters | [PRD](04-geometry-shooters/PRD.md) | Blocking, lane crossing combat, shooting tower, lane-interval seam | 03, 02 | done |
| 05 | Level importer | [PRD](05-level-importer/PRD.md) | `TW_EXTRACT` -> level v2 for positions 4–23, gating, LEVELS_GUIDE | 02 (soft 01, 04) | draft |
| 06 | AI port | [PRD](06-ai-port/PRD.md) | Delete our bots; exact TW AI copy; TW-AI-as-proxy level validation | 03, 05 (soft 02, 04) | done |
| 07 | Art pipeline | [PRD](07-art-pipeline/PRD.md) | TW art -> committed GLB/textures, instanced team-texture renderers | 02 (soft) | draft |
| 08 | Web client | [PRD](08-web-client/PRD.md) | Camera, HUD, input, screens, save v2; delete legacy UI | 03, 07 (soft 04, 05, 02) | draft |
| 09 | Gates, tooling, docs | [PRD](09-gates-tooling-docs/PRD.md) | Gate inventory/redefinition, parked CI scaffold, docs, final acceptance | all (Phase A first) | draft |

## Execution order
09 Phase A (task 0: PARKED runner + VERSION_GUARD_BASE) -> 01 -> 02 (steps 1–3 additive; step 4 CUT shared with 03 T1) -> 03 + 05 + 07 in parallel -> 04 -> 06 -> 08 -> 09 rest.
Max 2 concurrent agents.

## Locked decisions (owner)
- Replace, not extend: RULES_VERSION 2.0.0, BOT_VERSION 2.0.0, no compat; old content/bots/visuals deleted.
- Exact TW numbers; flat unit stats; 20 Hz deterministic + seeded streams; stage thresholds 10/30.
- Repo private; TW assets committed (owner).
- Red/parked window during rebuild accepted; all gates green before merge (owner).
- Towers shoot neutral houses (`hitsNeutralHouses=true`) (owner).
- Reference images = frames from owner's YouTube level walkthrough playlist, `BF/ref/tw-yt/` (INDEX.md maps files to levels) (owner).
- Levels = positions 4–23 (incl. prefab 182_NB, 100_ES); no tutorials.
- Drop wall in 100_ES and cargo (recorded in `source.dropped`).
- No meta/PvP/currencies/upgrades.
- BOOSTERS deferred (FUTURES).
- Their AI copied exactly; our bots deleted.
- Landscape via importer-time rotation (x,z)->(z,-x), single mirror at worldRoot (Frame contract in 02).
- Refs portrait; adapt to landscape (owner).
- Neutral towers FIRE (`neutralFires=true`).
- Unwinnable-by-proxy levels -> `tools/unsolved-by-proxy.json` allowlist + owner playtest.
- Local only, no deploy.
- Trust decomp on contradictions.
- LEVELS_GUIDE + coverage snapshot for future levels.
- No Git LFS: plain git for TW art (~3 MB) and reference frames.

## Critique
[critique-2026-10-22-0500.md](critique-2026-10-22-0500.md): 9 blocking / 10 non-blocking / 4 suggestions — all applied to PRDs.

## Resolved open items (2026-10-22)
- 01/02/04: buildings block via `Building` 1.5 box; obstacle sizes from 05 Task 0 collider dump, 04 writes to content; fallback circle 450 + calibration.
- 04: shooter reach = 2.4 x scale + 0.35, no upper bound; contacts/arrival at target `Hit` box (0.6), also attacker-vs-spawn (shared with 03).
- 03: `fwd` draw order accepted (unverifiable, neutral); `check:rules` red until SP04 tags accepted.
- 06: timer order pinned to decomp; `streams.fork(name, index).below(n)` exposed by 03; resource piles dropped (FUTURES).
- 02/05: `source`/`position` optional now; `--fix-requires`, campaign `loop` deferred (FUTURES); `source.dropped` = strings.
- 07: default skin verified (fallback id 1); Env 0 time-boxed; obstacle children from prefab dump; colour space/fonts/ring/lane/turret verified vs refs in task 1.
- 08: ownership = building-level sum, no neutral; HUD/font from refs (fallback OFL); drag delay touch 0.2 s/mouse instant; `quality` dropped unless 07 perf needs.
- 09: `validate:levels` 4 seeds (drop to 2 if over budget); bundle size gate deferred (FUTURES).

## Owner manual steps
- 05: mirror check and theme boundary: verify against `BF/ref/tw-yt` frames (no owner screenshots needed).
- 08: final visual approval of HUD vs refs.
- Resolved: parked window accepted; neutral-house targeting; video refs; repo private + TW art committed.
- 09: run `TW_EXTRACT=... pnpm check:import && pnpm assets:tw:check` locally before merge (CI cannot).
- 09: play levels 1–20 (positions 4–23); fill `09-gates-tooling-docs/owner-pass.md`; visual approval.
- 01, 02, 03, 06: none.

## SP04 completion (2026-10-22, PR #9)
- Tasks 0–6 done.
- Reviews: [Tasks 0–4 PASS](04-geometry-shooters/review-2026-10-22-1841.md), [Task 5 PASS](04-geometry-shooters/review-2026-10-22-1915.md).
- Final acceptance: [04-geometry-shooters/code-2026-10-22-1926.md](04-geometry-shooters/code-2026-10-22-1926.md): full CI exit 0; 419 passed, 6 extract skips, 0 failed; 38/38 rules; 19/19 replays; strict benchmarks within limits.
- 10 parked gates remain (7 SP06 bot/level, 2 SP08 web, 1 SP07 manifest); SP05 re-review explicitly skipped.
- Next: SP06 AI port.

## SP06 completion (2026-10-22)
- Tasks 0–8 done; seat bots, scripts, goldens, proxy spike, un-parked bots gates; full CI green.
- Run: [06-ai-port/code-2026-10-22-2116.md](06-ai-port/code-2026-10-22-2116.md); review: [06-ai-port/review-2026-10-22-2116.md](06-ai-port/review-2026-10-22-2116.md) (1 docs must-fix, fixed).
- Refs: [proxy-spike-2026-10-22.md](06-ai-port/proxy-spike-2026-10-22.md), [timer-order-pin.md](06-ai-port/timer-order-pin.md).
- 3 parked gates left: typecheck:web, test:web (SP08), check:manifest (SP07).
- Next per execution order: SP07 art pipeline (still todo; was meant to run parallel with 03/05), then SP08, then 09 rest.
