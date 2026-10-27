---
status: draft
summary: Rocket tower (player/AI-aimed persistent point, staged volleys, 1.15 area blast, disabled timer) and capture rocket tower (charge meter, then level-zeroing projectile + 3.0 warrior blast) on SP04's projectile core; new Aim/ClearAim commands, drag-to-aim UX, TW AI rocket targeting (proxy included).
date: 2026-10-27
---
# PRD: 06 Rocket tower + capture rocket tower

Repo/branch: node-arena, `feat/tw-full-campaign` (Phase C PR = SP06+07) · Depends on: 04 (projectile core `launch()`/`resolveImpacts()`, aim modes point/entity, phase 7a/7b/7c, `RULES_VERSION` 3.3.0), 02 (elements: mines/walls blastable), 05 (bridge ceils blastable, `RULES_VERSION` 3.4.0), 03 (BOT 2.5.0 chain) · Feeds: 07 (shares phase table/commands/input; fortress is a capture-rocket target), 08 (trolley is a blast + capture-rocket target), 09 (gates)
Owns: `docs/GAME_RULES.md` (areas `RKT`, `CRK`, command section 4.1, phase row 7d, changelog), `packages/content/src/versioning.ts` (`RULES_VERSION` 3.4.0 -> **3.5.0**; SP07 then 3.6.0), `packages/bots/src/version.ts` (BOT minor bump), `packages/defs/src/commands.ts` (+`Aim`, `ClearAim`), `packages/defs/src/modules/{rocketTower,captureRocket}.def.ts` + events, `packages/content/data/{buildings/rocket-tower.json,buildings/capture-rocket-tower.json,projectiles/rocket.json,projectiles/capture-rocket.json}` + schemas, `packages/sim/src/{commands.ts,modules/rocketTower.ts,modules/captureRocket.ts,state.ts,hash.ts,snapshot}`, small additive edit to `packages/sim/src/projectiles.ts` (see Architecture), `packages/bots/src/{tw-ai.ts,script.ts,seat.ts}`, `apps/web/src/{input,render,ui,editor}/*`, `tools/src/import-tw/{feature-map.json,map-level.ts}`, `tools/src/assets-tw/*`, imported levels, `tools/levels-lock.json`, `tools/unsolved-by-proxy.json`.
Does not own: projectile core semantics (04), fortress/turrets/parachutes (07), trolley (08), booster Armageddon (OUT), `RocketTowerSpeed/Radius` upgrades (OUT; no in-match consumer anyway).

## TL;DR
- **Rocket tower** (`rt`, 856 uses; position 216+): owner sets a persistent **aim point**; tower fires a stage-sized volley (1/2/3 rockets by level <10 / <30 / else) every `480000/(level+120)` ms; each rocket lands `rocketMoveTime` 1.0 s after launch (fixed time, not distance), blast radius 1.15, kills enemy troops, `level -= 3/4/5` on enemy buildings (never flips), destroys mines/ceils, damages walls. [decomp 03 §5.7]
- **Capture rocket** (`c_rt`, 251 uses; position 89+): charges `scp -> mcp` while owned by a non-neutral and level > 0; when full fires one projectile at the highest-level enemy building: target level -> 0, blast 3.0 kills enemy troops only. Ownership never changes in the shot. [decomp 03 §5.8]
- New commands `Aim{player,from,x,z}` and `ClearAim{player,from}`; capture rocket is automatic (no command).
- Human UX: drag from owned rocket tower to ground (or tap tower, tap ground), reticle at radius 1.15, reload ring on tower. AI/proxy use the decoded `coefficientByRocketTowerAttack x level` argmax.
- Minor bump 3.5.0: no shipped level has rt/c_rt, 20 existing replays bit-identical.

## Problem
- `rocket`, `capture-rocket` rows are `archetype: null` (blocked) [verified: `feature-map.json`]; rt appears in 856 level uses, c_rt in 251, so these gate a large share of positions 89-340 [research 01 §3.1; 02 §5].
- Sim has no command that is not a line between two buildings: `parse()` accepts only `type, player, from, to` [verified: `packages/sim/src/commands.ts`]. The rocket aim is a point.
- Bots emit only `DrawLine` [verified: `tw-ai.ts`]; TW AI rocket logic (04 §3.4) and the validate:levels proxy have no hook, so rocket levels are unplayable by proxy.
- Charge accounting of the capture rocket lives in undecompiled `CaptureRocketTowerUiView` [research 03 §5.8].

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Decoded numbers exact; undecoded ones as content params with defaults + spike | Armageddon/speed boosters, rage, upgrade talents |
| Human, TW AI, scripted AI, and proxy can all use rocket towers | Bridging rocket aim over tutorials or Boss modes |
| Replay-compatible: old replays unchanged; new commands in the closed set | Rewriting tower shots; trolley behaviour (08) |
| Editor can place/tune rt and c_rt | Sheep, gates, cargo (no consumers in scope) |

## Requirements
**R1 Rules (GAME_RULES first)**
- `RKT-01` aim: `Aim` sets/replaces the tower's aim point (milli ints, inside playfield bounds); persists until `ClearAim`, owner change, or disable. `RKT-02` volley cadence: first volley `defaultDelay*0.5` = 250 ms after the tower first has an aim and is ready; then `ceil(480000/(level+120))` ms, level sampled at fire time. `RKT-03` stage = 1/2/3 by level; one volley launches `stage` rockets (spacing (Risk 2)). `RKT-04` effect: closed-disc 1.15 blast at the aim point; enemy troops die; enemy buildings `level = max(0, level - [3,4,5][stage-1])`, no ownership change (R-ENT-05-style, level 0 still needs a soldier hit); mines destroyed, walls damaged, ceils destroyed (via 02/05 element hooks); trolley hit hook reserved for 08. `RKT-05` disable: a rocket tower brought to level 0 by a rocket-type projectile (rocket or capture rocket) is disabled 5.0 s: no volleys, `Aim` rejected, aim cleared (Risk 4). `RKT-06` rocket tower has no soldier lines (`DrawLine` -> `not-drawer`); grows/captured like a house.
- `CRK-01` charging: active iff level state started, owner not neutral, level > 0. `CRK-02` charge points `startChargingPoints -> maxChargingPoints`, rate per (Risk 1); resets to `scp` after firing, `chargingCooldown` 3.0 s idle gap. `CRK-03` target: all owned buildings (neutral-owned count; ready trolleys count), sort by level descending, tie lowest index; second predicate assumed "enemy of tower owner" (Risk 3). `CRK-04` projectile: `entity` aim, fixed travel (Risk 5); on impact target level -> 0 (TW tweens over 1.0 s; we set at impact, recorded deviation), 3.0 blast kills enemy troops only. `CRK-05` tower is capturable and keeps firing at any level > 0.
- Tombstones for none; every rule needs `covers R-RKT-..`/`R-CRK-..` tests.
**R2 Content/defs**: archetypes `rocket-tower`, `capture-rocket-tower` with modules `rocketTower{moveTicks 20, defaultDelayMs 500, lup 4.0, disabledMs 5000, attackByStage [3,4,5], aimBlast 1150}`, `captureRocket{scp, mcp, cc, blast 3000, hits:['troop']}`; per-level overrides `ds, lup, scp, mcp, cc` from importer. Shared `rocketWeight` building param (house 1.0, attack/artillery house 3.0, rocket 2.0, fortress 3.0, capture rocket 3.0, flag/trolley/resource 0.0), stored x10 as int.
**R3 Commands**: `Aim` reasons `gameover, malformed, unknown-id, not-owner, not-rocket, disabled, out-of-bounds`; `ClearAim` reasons `gameover, malformed, unknown-id, not-owner, not-rocket, no-aim`. `parse()` becomes a per-command key table (not a fixed 4-key shape).
**R4 Bots**: TW AI Attack step, for a rocket-tower source: skip if aim "used" flag set; target = argmax `rocketWeight x level` over non-own buildings (strict `<`, resources never best; resource winner -> no fire but action consumed); emit `Aim` at building centre. Per-tick free action: for own rocket towers whose aim has launched a volley, emit `ClearAim` (04 §3.4). `CreateWayBehavior` scripts: rocket source fires rather than drawing; fallback excludes rocket towers. Proxy shares the TW AI, so it aims automatically; harness gains no rule of its own. Capture rocket needs no bot logic.
**R5 Web**: models `MissileLauncher` (rt) and `CaptureRocketTower`, rocket + blast fx (pooled, interpolated from `(launch, impact)`), HUD ring states. See Architecture.
**R6 Importer**: rows `rocket`/`capture-rocket` -> `map`. select >=10 TW-pool levels (Common 24-340) featuring rocket tower and, separately, capture rocket tower (>=10 each) per README Curation rules (candidates and metrics from SP01 pool tool; the first selected level introduces rocket tower and, separately, capture rocket tower (>=10 each) with no other new element; spread across later positions; prefer proxy-solvable, allowlist only if no equal-feature alternative); import only those; show the coverage line in the PR (`rocket tower and, separately, capture rocket tower (>=10 each): n levels, first at display N`). Selection is provisional; SP09 finalizes order and numbering. Unsolvable-by-proxy -> `tools/unsolved-by-proxy.json`.

## Architecture
- **Commands**: `Aim` pushes `{aimX,aimZ,aimSet}` into per-building columns (`rocketAimX/Z`, `rocketCd`, `rocketDisabledUntil`, `rocketFiredFlag`) hashed with buildings; capture rocket adds `chargePts`, `chargeIdle`. `canAim(player, from, x, z)` exported like `canDraw` for UI. Replays: commands are a closed union validated by the same schema, so new commands are additive; ruleset version in replay metadata gates old replays.
- **Phases**: new sub-step `7d rocket launches` after `7c`; impacts remain `7a`, so rockets launched at tick T land at T+20 in `7a`. Disable/charge timers decrement in 7d. Merge order with 07: 06 owns 7d and the row text; 07 adds `7e` if needed.
- **Projectile core extension (agree with 04, tiny, additive)**: `launch()` spec gains `travelTicks` override (rocket/capture rocket are fixed-time, not speed-based), `spawnType: 'tower'|'rocket'`, per-hit-kind effect table `{troop:'kill'|dmg, building:{levelDelta}|'setZero', element:'destroy'|'damage'}`, and an `onImpactBuilding` hook consumed by 06 for disable. If 04 already ships a superset, 06 only adds defs.
- **Aim storage**: point mode (`PRJ-02`); capture rocket uses `entity` mode so a building recaptured mid-flight still takes the hit; fizzles only if it no longer exists (never).
- **Determinism**: all integer; delay formula integer divide; no RNG; capture target selection is a stable sort by `(level desc, index asc)`.
- **Bots/identity**: rocket weight and `Aim` emission change TW AI output on rocket levels only; `BOT_VERSION` minor bump (expected 2.6.0; renumber to chain). Existing-20 `bots:golden` unchanged (asserted) since none has rt.
- **Web input**: gesture machine `own()` gate currently requires `drawsLines`; add a rocket branch: pointer-down on own rocket tower enters aim mode, preview shows aim reticle (ring r=1.15) and dashed path, release on ground -> `Aim`. Tap tower then tap ground also works (touch). Drag back onto tower, or tap tower while aimed -> `ClearAim`. Cutting strokes still skip aim paths. Feedback: reload ring (from `rocketCd`), stage pips, disabled state greyed with countdown, capture charge meter (`chargePts/mcp`), rejection text via `reasons.ts` (`disabled`, `out-of-bounds`).
- **Editor**: palette entries for rt/c_rt with `ds, lup, scp, mcp, cc, level`; rt shows default aim none; validation mirrors importer (c_rt not neutral-chargeable; warn neutral c_rt never fires).

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Aim command | Point `Aim` + `ClearAim` | Reuse `DrawLine` with building target | TW aims at ground points; AI/clear semantics differ |
| 2 | Aim persistence | Persists until cleared | One-shot | `used` flag + AI retract implies persistent for humans (Risk 6) |
| 3 | Travel time | Fixed 20 ticks | Distance/speed | `rocketMoveTime 1.0` [decomp] |
| 4 | Capture | Level -> 0, not flip | Flip ownership | Decomp: no ownership change |
| 5 | Delay formula | Integer `480000/(L+120)` ms | Float | Exactly equals decoded formula, deterministic |
| 6 | AI weight | Content `rocketWeight` x10 int | Hard-coded by type | Decoded per-prefab constants |
| 7 | Blast ownership | Enemy-of-owner only (04 PRJ-03) | Hit friends | Research silent; see RESOLVED 7 |
| 8 | Version | RULES 3.5.0 minor, BOT minor | Major | Additive, old levels unaffected |

## Manual steps
- Owner-only: none. Needs `TW_EXTRACT` for model copies (`MissileLauncher`, `CaptureRocketTower`) and the decomp spike; if missing, record and use placeholders.
- Calibrate against a TW playthrough of positions 89 and 216 (owner approval at end).

## Risks / Open Questions
- [RESOLVED 1: decode spike first (task: decomp CaptureRocketTowerUiView via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: 1 pt per tick (20/s), idle gap `cc` after firing and record it as a deviation in GAME_RULES + the deviations ledger] Capture charge rate (points per `cc` 3.0 s tick). Spike: `CaptureRocketTowerUiView`.
- [RESOLVED 2: decode spike first (task: decomp RocketTower AttackCoroutine via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: 150 ms apart and record it as a deviation in GAME_RULES + the deviations ledger] Rocket spacing within a volley (`AttackCoroutine` loop delay).
- [RESOLVED 3: decode spike first (task: decomp capture-rocket targeting class via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: enemy-of-owner incl. neutral and record it as a deviation in GAME_RULES + the deviations ledger] Capture second targeting predicate.
- [RESOLVED 4: decode spike first (task: decomp RocketTower disable path via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: only level-0 by rocket-type projectile disables (5.0 s); can be aimed again after and record it as a deviation in GAME_RULES + the deviations ledger] Disabled semantics: capture also disables vs only level-0 by rocket projectile.
- [RESOLVED 5: decode spike first (task: decomp capture-rocket projectile class via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: fixed 1.0 s travel and record it as a deviation in GAME_RULES + the deviations ledger] Capture projectile `projectileSpeed 0.5` unit.
- [RESOLVED: persists until `ClearAim` (owner delegated; revisit after playtest)] Human rocket aim persistence after a volley. AI emits `ClearAim`. Spike `RocketTower.WayPath*` result, if any, is recorded as input to the post-playtest revisit.
- [RESOLVED 7: decode spike first (task: decomp RocketTower blast class via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: no friendly fire, enemy-of-owner only and record it as a deviation in GAME_RULES + the deviations ledger] Blast friendly fire / rockets hitting own buildings.
- [RESOLVED 8: decode spike first (task: decomp TryCreateWayPath via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: clamp to playfield bounds only (`out-of-bounds`), no range limit and record it as a deviation in GAME_RULES + the deviations ledger] Max aim range / playfield clamp. Spike `TryCreateWayPath`.
- [RESOLVED 9: decode spike first (task: decomp AI weight constants for Tower via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use fallback: `rocketWeight` 1.0 and record it as a deviation in GAME_RULES + the deviations ledger] Tower archetype weight `rocketWeight`.
- [RESOLVED 10: owned by SP08] Capture rocket vs defense-less target bridge/trolley states; needs SP08 ready flag.
- [RESOLVED: locked decision] Armageddon/boosters, upgrades, rage out of scope.
- [DEFERRED] Rocket-vs-sheep, multi-aim, rocket tower AI "useless attack" retarget.
- Risk: rt-heavy levels unwinnable by proxy -> list in `unsolved-by-proxy.json`. Risk: 07 and 06 both edit phase table, commands parse, input gestures: merge 06 first; rebase 07.

## Acceptance Criteria
- GAME_RULES `RKT-*`, `CRK-*` + command section with `covers R-...` tests; changelog 3.5.0; `RULES_VERSION` bumped; `BOT_VERSION` bumped; `check:rules` green.
- Unit tests: cadence formula at L=1,10,30,64; stage thresholds; blast boundary r and r+1 milli; level clamp at 0, no flip; disable 5.0 s; reject reasons; capture charge/reset; target sort and tie; snapshot/hash roundtrip; replay with Aim/ClearAim.
- Bot tests: argmax weight, resource skip, ClearAim retract; proxy aims on a rocket level.
- Existing 20 locks, `sim:golden`, `replay:verify`, `bots:golden` unchanged (asserted).
- `rocket`/`capture-rocket` rows `map`; >=10 selected levels each imported, locks refreshed, coverage lines in PR; `validate:levels` green.
- Web: drag-aim works desktop + touch in `test:web:e2e`; position 89 and 216 pass `campaign:verify`; screenshots vs refs.
- `pnpm run ci` green.
