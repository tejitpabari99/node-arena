---
status: archived
summary: 14 tasks (capture rocket = owner redesign 2026-10-28: level is charge) — decode spike, rules text, defs/content, projectile-core extension, Aim/ClearAim commands + state, rocket tower module, capture rocket module, bots, importer, web input + render, editor, curated selection and import of >=10 rocket + >=10 capture-rocket levels, perf/ci gate
date: 2026-10-27
---
# Tasks: 06 Rocket tower + capture rocket tower
Source of truth: [PRD](PRD.md). Adds the rocket tower (aimed persistent point, staged volleys, area blast, disable timer) and capture rocket tower (level-as-charge, windup, then level-zeroing projectile) on SP04's projectile core (`launch` / `resolveImpacts`), new `Aim` / `ClearAim` commands, TW-AI rocket targeting, and a provisional >=10 rocket + >=10 capture-rocket level selection. Mechanics order: rule text + changelog + version bump, then tests, then code. Tasks 1, 9, 10, 12, 13 need the rebuilt TW extract (`TW_EXTRACT`); Task 12 also needs SP01's `pnpm census`. Phase C PR = 06 + 07 (06 merges first; 07 rebases onto it; 06 owns phase row 7d, command parse, input gestures). Version numbers are indicative (RULES 3.5.0, BOT next minor at merge time). Human aim persists until `ClearAim` (owner decision; revisit after playtest). Capture rocket follows the owner redesign (2026-10-28): level is the charge, maxLevel 100, +1 per own troop, +1/s while owned, 3 s windup, reset to 10 (PRD CRK-01..06); decoded TW `scp/mcp/cc` model is reference only.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Decode spike: spacing, disable, blast, range, weight (capture targeting/speed decoded; charge = owner redesign) | none | todo |
| 2 | Rules text: R-RKT / R-CRK, commands, phase 7d, RULES_VERSION | 1 | todo |
| 3 | Defs, events, building/projectile JSON, schema, content version | 2, SP02 T2a | todo |
| 4 | Projectile core extension (additive, agreed with SP04) | 3 | todo |
| 5 | Aim / ClearAim commands + rocket state columns | 3 | todo |
| 6 | Rocket tower module + phase 7d launches | 4, 5 | todo |
| 7 | Capture rocket module | 4, 6 | todo |
| 8 | Bots: rocket weight, Aim / ClearAim, scripts, BOT_VERSION | 5, 6 | todo |
| 9 | Importer: rocket / capture-rocket rows | 3 | todo |
| 10 | Web: aim input, reticle, HUD, models, fx | 6, 7 | todo |
| 11 | Editor palette entries | 10 | todo |
| 12 | Curated selection from pool tool | 9 | todo |
| 13 | Import selected levels, solvability, locks | 7, 8, 9, 12 | todo |
| 14 | Perf, e2e, campaign:verify sample, calibration, CI | 10, 11, 13 | todo |

## Task 1 — Decode spike: spacing, disable, blast, range, weight
What it is / what it means: PRD Risks 2, 4, 7–9 (RESOLVED as "spike first, else fallback"). In-volley rocket spacing, disabled semantics, blast friendly fire, aim range clamp and tower `rocketWeight` are undecoded. Capture charge rate, targeting predicate and projectile speed (Risks 1, 3, 5) are already [decoded] (CRK-01..04) and need no spike. Also record any `RocketTower.WayPath*` finding as input to the post-playtest aim-persistence revisit.
What changes at a high level: Time-boxed (~1 h each) decomp via `/root/projects/tower-war/_tools/decomp.sh` of RocketTower `AttackCoroutine`, disable path, blast class, `TryCreateWayPath` and AI weight constants. No product code.
Spike pointer: start from the pre-decompiled classes indexed in `/root/projects/tower-war/_extract/decomp/MANIFEST.md` (RocketTower, WayRocket, RocketPathDraw, CaptureRocketTower, CaptureRocketTowerUiView, AiPlayerController/DefaultBehavior); human aim = drag a path (`WayRocket`/`RocketPathDraw`), persists until `ClearAim`.
Done when: findings recorded per item. Each inconclusive item records its fallback as a deviation in GAME_RULES and the deviations ledger: 150 ms spacing; only level 0 by rocket-type projectile disables for 5.0 s; no friendly fire; clamp to playfield only; `rocketWeight` 1.0. Needs `TW_EXTRACT`.

## Task 2 — Rules text: R-RKT / R-CRK, commands, phase 7d, RULES_VERSION
What it is / what it means: PRD R1, R3, Decisions 1–5, 7. Rules authority comes first.
What changes at a high level: `docs/GAME_RULES.md` gains areas RKT (aim persistence, cadence `ceil(480000/(level+120))` ms with 250 ms first volley, stage by level, closed-disc 1.15 blast, level delta without flip, disable, no soldier lines) and CRK (owner redesign 2026-10-28: level is the charge, `maxLevel` 100, +`chargePerTroop` 1 per own troop, `growthPerSecond` 1.0 while owned and none when neutral, fire at `fireLevel` 100 after `windupMs` 3000 (60 ticks) windup then level -> `resetLevel` 10, windup cancel on damage below fireLevel, hold at 100 with no target, all per-map overridable, expected fill times as rationale; decoded TW `scp/mcp/cc` model kept as "TW reference (decoded)"; decoded target score own -1 / neutral level+1 / other level+100, first with level >= 1 and not own, ties by index; entity-aim projectile 40 ticks, level to 0 at impact, 3.0 troop-only blast; deviations: owner charge-model redesign (dated 2026-10-28, intentional, listed for the SP09 ledger), impact-time zeroing). Command section 4.1 gains `Aim`/`ClearAim` with reject reasons; phase row 7d added; spike results and deviations written in; changelog; `RULES_VERSION` bumped to the next minor (indicative 3.5.0; rebase onto SP05's 3.4.0).
Done when: `pnpm check:rules` accepts the new IDs as untested stubs per repo convention; changelog and version present.

## Task 3 — Defs, events, building/projectile JSON, schema, content version
What it is / what it means: PRD R2. Both towers are content-driven modules on the SP04 `projectile` registry.
What changes at a high level: `rocketTower` and `captureRocket` module defs (params per PRD R2) with events; `Aim`/`ClearAim` added to the command defs; `buildings/rocket-tower.json`, `capture-rocket-tower.json`, `projectiles/rocket.json`, `capture-rocket.json`; shared `rocketWeight` building param (x10 int); per-level overrides `ds, lup` (rocket) and the capture params `fireLevel, resetLevel, chargePerTroop, growthPerSecond, windupMs` (capture rocket) in the level schema; per-archetype `maxLevel` 100 for the capture tower (others 64). Content version/hash bump and `content:lock`. Base derivation (D7). `rocket-tower` and `capture-rocket-tower` `extend` a shared base tower archetype (`tower`/`building-base`: level, owner, capture, footprint, `shoots`-free) and add `rocketTower` / `captureRocket` modules; rocket and capture shot `extend` SP04's `projectile-base` (aim path = base Path/line type used by `Aim`). Uses `extends` from SP02 Task 2a.
Done when: schemas regenerated, `check:schemas`, `validate:content`, typecheck green; shipped level hashes unchanged.

## Task 4 — Projectile core extension (additive, agreed with SP04)
What it is / what it means: PRD Architecture "Projectile core extension". Rockets are fixed-time, not speed-based. If SP04 already ships a superset, this task only adds defs and records that.
What changes at a high level: tiny additive edit to `projectiles.ts`: `launch()` spec gains `travelTicks` override and `spawnType`; per-hit-kind effect table (troop kill/damage, building level delta or set-zero, element destroy/damage); an `onImpactBuilding` hook for the disable rule. SP04's stable surface (`launch` + `resolveImpacts`) and artillery behaviour unchanged.
Done when: tests `covers R-PRJ-..` for the fixed-travel impact tick and effect table; SP04 artillery tests and `sim:golden` unchanged; levels without projectiles replay bit-identically.

## Task 5 — Aim / ClearAim commands + rocket state columns
What it is / what it means: PRD R3, Architecture (commands). `parse()` today accepts a fixed four-key shape; the new commands carry a point.
What changes at a high level: `parse()` becomes a per-command key table; `Aim{player,from,x,z}` and `ClearAim{player,from}` with the reject reasons in the PRD; per-building columns (`rocketAimX/Z`, `rocketCd`, `rocketDisabledUntil`, `rocketFiredFlag`, plus `windupTicks`, `growMilli`) hashed and snapshotted with a schema version bump; exported `canAim(player, from, x, z)` for the UI.
Done when: tests for every reject reason, aim replace, clear, out-of-bounds in milli ints; snapshot/hash round-trip; a replay containing `Aim`/`ClearAim` verifies; existing replays bit-identical.

## Task 6 — Rocket tower module + phase 7d launches
What it is / what it means: PRD R-RKT-01..06, Decisions 2, 3, 5. Turns the aim point into volleys.
What changes at a high level: `rocketTower` module in new sub-step 7d (after 7c): first volley 250 ms after aim and ready, cadence from level at fire time, 1/2/3 rockets per volley with spacing per Task 1, fixed 20-tick travel, `level -= 3/4/5` clamped at 0 with no flip, mines and ceils destroyed and walls damaged via the 02/05 element hooks, disable 5.0 s on level 0 by rocket-type projectile (aim cleared, `Aim` rejected `disabled`), aim cleared on owner change, no soldier lines. Early-out with no rocket towers.
Done when: tests `covers R-RKT-01..06`: cadence at L=1, 10, 30, 64; stage thresholds; blast boundary r and r+1 milli; level clamp; disable window; replay hash determinism.

## Task 7 — Capture rocket module
What it is / what it means: PRD R-CRK-01..06, Decisions 4, 9, 10 (owner redesign 2026-10-28).
What changes at a high level: `captureRocket` module: archetype `maxLevel` 100; each arriving own troop adds `chargePerTroop` (1) level (clamped), enemy troops damage as normal; `growthPerSecond` 1.0 via a dedicated fixed-rate accumulator (`growMilli`, +50 milli/tick, +1 level per 20 ticks) while owned, none when neutral; at level `>= fireLevel` 100 a 60-tick windup (`windupTicks`; web shows an "armed" pulse, no new meter UI), then one shot and level -> `resetLevel` 10, no extra cooldown; windup cancels if level drops below fireLevel or owner changes; no valid target: hold at 100 and fire when one appears; decoded target score (own -1, neutral level+1, other owner level+100) descending, first with level >= 1 and not own, ties by index; entity-aim projectile 40 ticks that still hits a building recaptured in flight; target level set to 0 at impact (deviation from TW tween recorded); 3.0 blast kills enemy troops only; ownership never changes. All five params per-map overridable.
Done when: tests `covers R-CRK-01..06`: owned tower at level 10, no feeding -> level 100 at tick 1800, windup, fires at tick 1860, level 10 after; with N own troops arriving at tick 0 (N=45 -> level 55, reaches 100 at tick 900, fires 960); troops during windup clamp at 100; enemy hit during windup cancels it; neutral: no growth, no fire; no-target hold then fire when a target appears; owner change cancels windup; enemy beats higher-level neutral, never own, tie by index; recapture in flight; blast owner filter; houses keep maxLevel 64; param overrides honoured; `check:rules` fully green for RKT and CRK.

## Task 8 — Bots: rocket weight, Aim / ClearAim, scripts, BOT_VERSION
What it is / what it means: PRD R4, Decision 6. The proxy shares the TW AI, so it aims rocket levels automatically.
What changes at a high level: TW AI Attack step for rocket-tower sources: skip if aim `used`, target argmax `rocketWeight x level` over non-own buildings (strict `<`, resource winner consumes the action without firing), emit `Aim` at building centre; per-tick `ClearAim` for towers whose aim has launched. `CreateWayBehavior` scripts fire rather than draw from a rocket source; fallback excludes rocket towers. No logic for the capture rocket. `BOT_VERSION` next minor; bot goldens refreshed.
Done when: bot tests for argmax weight, resource skip, `ClearAim` retract, proxy aiming on a rocket level; shipped-20 `bots:golden` unchanged (asserted); version bumped.

## Task 9 — Importer: rocket / capture-rocket rows
What it is / what it means: PRD R6. Both rows are `archetype: null` (blocked), gating many positions 89–340. Needs `TW_EXTRACT`.
What changes at a high level: `feature-map.json` rows `rocket` and `capture-rocket` become `map`; `map-level.ts` emits archetype, level and the rocket `ds, lup` overrides; TW capture `scp/mcp/cc` are ignored (recorded in `source.dropped` / deviation, new-model defaults applied; levels may override); no levels imported yet.
Done when: `check:import` green; shipped 1–20 hashes unchanged (except 23 per SP02).

## Task 10 — Web: aim input, reticle, HUD, models, fx
What it is / what it means: PRD R5, Architecture (web input). The `own()` gesture gate requires `drawsLines` today. Needs `TW_EXTRACT` for models; placeholders and a recorded note if missing.
What changes at a high level: rocket branch in the gesture machine (drag from own rocket tower to ground, or tap tower then tap ground; drag back or tap while aimed sends `ClearAim`; cutting strokes skip aim paths); reticle ring r = 1.15 and dashed path; reload ring, stage pips, disabled grey-out with countdown, capture "armed" pulse during windup (no new meter UI; level number is the meter); rejection text in `reasons.ts`. `assets-tw` rows, manifest visual ids and credits for `MissileLauncher` and `CaptureRocketTower`; pooled rocket and blast fx reusing SP04's renderer, interpolated from `(launch, impact)`.
Done when: `assets:tw:check` and `check:manifest` green; drag-aim and tap-aim e2e (desktop and touch) pass in `test:web:e2e`; fx fire from events; screenshots vs refs.

## Task 11 — Editor palette entries
What it is / what it means: PRD R5, Architecture (editor).
What changes at a high level: palette entries for rocket tower and capture rocket tower with `ds, lup, level` (rocket) and `fireLevel, resetLevel, chargePerTroop, growthPerSecond, windupMs, level` (capture rocket); no default aim; validation mirrors the importer (warn that a neutral capture rocket never fires).
Done when: editor places both and exports valid level JSON that passes content validation; editor tests green.

## Task 12 — Curated selection from pool tool
What it is / what it means: README Curation + PRD R6; resolution 4 (SP01 owns census). Needs `TW_EXTRACT` and `pnpm census`.
What changes at a high level: from census output select >=10 rocket-tower and, separately, >=10 capture-rocket levels from Common 24–340. Each element's first level introduces it with no other new element; spread across later positions; prefer proxy-solvable, allowlist only when no equal-feature alternative; prefab-only ids swapped if `parse-prefab` fails. Selection list kept in the SP06 docs folder.
Done when: provisional selection recorded with source positions, features and metrics; both coverage lines (`rocket tower: n levels, first at display N`; `capture rocket tower: n levels, first at display N`) drafted.

## Task 13 — Import selected levels, solvability, locks
What it is / what it means: PRD R6, Acceptance. Selection is provisional; only SP09 sets final order and numbers (resolution 11). Needs `TW_EXTRACT`.
What changes at a high level: import only the selected levels with provisional display ids after earlier SPs' levels; run `validate:levels` on them using the aiming proxy; proxy-unsolvable go to `tools/unsolved-by-proxy.json` (reason, `ownerSignOff: null`); refresh only own entries via `levels:lock --levels`, content lock, CREDITS rows.
Done when: >=10 rocket and >=10 capture-rocket levels imported, coverage lines printed; shipped 1–20 unchanged except 23; `validate:content --base HEAD`, `check:content`, `check:import` green.

## Task 14 — Perf, e2e, campaign:verify sample, calibration, CI
What it is / what it means: PRD Acceptance, resolution 7. Phase C's `validate:levels --all` is run pre-merge by SP07's last task.
What changes at a high level: `bench:sim` on a rocket-heavy level within budget; add the rocket and capture-rocket introduction levels to the `campaign:verify` sample set; calibrate against TW playthrough refs (positions 89 and 216 equivalents) and record deviations if fallbacks hold; refresh golden/replay refs only if calibration moves outcomes; full `pnpm run ci`.
Done when: bench within budget; sample verify passes; `sim:golden`, `replay:verify golden`, `bots:golden` green; `pnpm run ci` green.

## Owner manual steps
- Provide rebuilt `TW_EXTRACT` for Tasks 1, 9, 10, 12, 13 (rebuilt 2026-10-28 at `/root/projects/tower-war/_extract`).
- Compare rocket and capture-rocket behaviour against TW playthrough refs of positions 89 and 216 (calibration approval).
- Revisit human aim persistence after playtest (currently persists until `ClearAim`).
- Spot-check rows added to `tools/unsolved-by-proxy.json` here (`ownerSignOff` stays null).
- Approve the Phase C PR.
