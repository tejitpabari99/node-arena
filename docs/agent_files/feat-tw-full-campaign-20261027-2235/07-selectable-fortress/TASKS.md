---
status: draft
summary: 14 tasks — decode spike, rules text, defs/content, multi-gun shoots, cargo schedule, landings, bot check, importer, web, editor, curated selection and import of >=10 fortress levels, perf/ci gate, phase C validate:levels --all
date: 2026-10-27
---
# Tasks: 07 Selectable fortress
Source of truth: [PRD](PRD.md). Adds the selectable fortress (house-like line source, 8 instant guns, periodic parachute reinforcement dropped at the fortress; no new command) and a provisional >=10 fortress level selection. Mechanics order: rule text + changelog + version bump, then tests, then code. Tasks 1, 8, 9, 11, 12 need the rebuilt TW extract (`TW_EXTRACT`); Task 11 also needs SP01's `pnpm census`. Phase C PR = 06 + 07: 07 rebases onto 06 (which owns phase row 7d, `parse()` key table, input gestures); Task 14 runs `validate:levels --all` before the phase PR. Version numbers are indicative (RULES 3.6.0, BOT bump only if bot output changes). Parachute landing follows TW: drop at fortress spawn points, round-robin lane, else add level (owner decision).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Decode spike: wave repeat, gun geometry, gun gating, alive cap, AI hook, no-line bonus | none | todo |
| 2 | Rules text: R-FRT, phase rows 4b / 7b, RULES_VERSION | 1 | todo |
| 3 | Defs, events, building JSON, schema, content version | 2, SP02 T2a | todo |
| 4 | Multi-gun extension of shoots + gunCd column | 3 | todo |
| 5 | Cargo module: cycle, pending ring, phase 4b scheduling | 3 | todo |
| 6 | Landings: lane round-robin, level bonus, alive cap, cancellation | 5 | todo |
| 7 | Bots: fortress source / special hook check, conditional BOT_VERSION | 1, 6 | todo |
| 8 | Importer: selectable row flip | 3 | todo |
| 9 | Web: model, guns, parachute fx, HUD, assets | 4, 6 | todo |
| 10 | Editor palette entry | 9 | todo |
| 11 | Curated selection from pool tool | 8 | todo |
| 12 | Import selected levels, solvability, locks | 6, 7, 8, 11 | todo |
| 13 | Perf, e2e, campaign:verify sample, calibration, CI | 9, 10, 12 | todo |
| 14 | Phase C gate: validate:levels --all | 13 | todo |

## Task 1 — Decode spike: wave repeat, gun geometry, gun gating, alive cap, AI hook, no-line bonus
What it is / what it means: PRD Q1, Q2, Q3, Q6, Q7, Q8 (all RESOLVED as "spike first, else fallback"). Next-wave rule, gun offsets, gun level gating and damage, alive-cap timing for airborne troops, the TW AI `special` level-scaling hook for the fortress, and the per-soldier level bonus with no lines are undecoded.
What changes at a high level: Time-boxed (~1 h each) decomp via `/root/projects/tower-war/_tools/decomp.sh` of `_SpawnFlyWarriors_d__28`, `SelectableFortess` (prefab gun transforms via UnityPy; gun logic; landing `AddLevel`) and `AiPlayerController`. No product code.
Done when: findings recorded per item. Each inconclusive item records its fallback as a deviation in GAME_RULES and the deviations ledger: next wave after the previous wave's troops are gone plus `dtsc` (else one wave per owner epoch); one disc at fortress centre r 3.0; all 8 guns active, instakill; alive cap checked at landing; mirror `drawsLines` and include fortress in `special` scaling (BOT bump only if calibration changes output); +1 level per soldier. Needs `TW_EXTRACT`.

## Task 2 — Rules text: R-FRT, phase rows 4b / 7b, RULES_VERSION
What it is / what it means: PRD R1, Decisions 1–7. Rules authority comes first.
What changes at a high level: `docs/GAME_RULES.md` gains area FRT (`FRT-01..05`: identity, 8 guns, cargo cycle, landing, capture). Phase table gains row 4b (landings, after spawn departures, before movement) and a 7b amendment (fortress guns with towers, ascending building index), rebasing onto 06's row 7d. Spike results and deviations written in; changelog; `RULES_VERSION` bumped to the next minor (indicative 3.6.0).
Done when: `pnpm check:rules` accepts the new IDs as untested stubs per repo convention; changelog and version present.

## Task 3 — Defs, events, building JSON, schema, content version
What it is / what it means: PRD R2. The fortress is a content-driven archetype composed of existing and two new module shapes.
What changes at a high level: `guns` (or `shoots` extension) and `cargo` module defs with events for gun shots, cargo launch and landing; `buildings/selectable-fortress.json` (`drawsLines, grows, spawns`, guns, cargo with the PRD defaults); per-level overrides `l, ml, cbi, ws, cwc, sc, ac, bs, swc, wcpr, dtsc, wt` in the level schema; rocket weight 3.0 on the building. Content version/hash bump and `content:lock`. Base derivation (D7). `selectable-fortress` = house base (`extends` the house archetype: level, owner, capture, footprint, `drawsLines`, `grows`, `spawns`) + multi-gun `shoots` style + `cargo` (parachute) module. Uses `extends` from SP02 Task 2a.
Done when: schemas regenerated, `check:schemas`, `validate:content`, typecheck green; shipped level hashes unchanged.

## Task 4 — Multi-gun extension of shoots + gunCd column
What it is / what it means: PRD R-FRT-02, Decisions 3, 4. Tower code path must stay untouched.
What changes at a high level: `shoots` gains an optional gun count; flattened `gunCd` column (count x buildings), hashed and snapshotted; per-gun cooldown `ac`, first shot one `ac` after level start, nearest-enemy-troop pick with tower tie order, instakill via `killTroop`, fires at level >= 1 and when neutral, no building targets; reach per Task 1; reuse of tower lane-interval precompute. Early-out when no fortress.
Done when: tests `covers R-FRT-02`: cadence, first shot, reach boundary r and r+1 milli, 8 independent cooldowns, neutral fires, tie order; tower tests and `sim:golden` bit-identical.

## Task 5 — Cargo module: cycle, pending ring, phase 4b scheduling
What it is / what it means: PRD R-FRT-03, Architecture (cargo). Pure integer scheduling, no RNG.
What changes at a high level: `modules/cargo.ts` with per-building columns `cargoRemaining`, `cargoNextMt`, fixed-capacity pending ring of `{landTick, count, epoch}`, hashed and snapshotted (schema version bump); per owner epoch `drops = trunc(swc/wcpr)`, each drop `min(remaining, wcpr)`, 60-tick fall, wait `dtsc` between drops (next-wave rule from Task 1, isolated in one function); neutral stops the cycle. Registered in phase 4b.
Done when: tests `covers R-FRT-03`: drop timing, remainder drop, drop count, neutral pause, snapshot/hash round-trip; levels without a fortress replay bit-identically.

## Task 6 — Landings: lane round-robin, level bonus, alive cap, cancellation
What it is / what it means: PRD R-FRT-04, R-FRT-05, Decision 2, Q6/Q8 results. Landing reuses SP03's `spawnTroop`.
What changes at a high level: at landing, with >= 1 outgoing line spawn troops at progress 0 on lines chosen by a persistent per-fortress round-robin pointer over ascending target index; with no lines add +1 level per soldier (R-ENT-02 style, per Task 1); alive cap per Task 1 (skip + counter like R-SPN-03). Owner change or capture clears pending drops, resets the cycle for the new owner. No RNG stream.
Done when: tests `covers R-FRT-04` and `R-FRT-05`: round-robin pointer and wrap, line removed mid-cycle, no-line bonus, alive cap, owner change cancels airborne, capture restart; `check:rules` green for FRT.

## Task 7 — Bots: fortress source / special hook check, conditional BOT_VERSION
What it is / what it means: PRD R4, Q7 result. TW AI source set already mirrors `drawsLines`.
What changes at a high level: bot test that proxy and TW AI draw lines from a fortress and treat it like a house in `targetKey`/counter branches; per Task 1 include the fortress in the `special` level-scaling hook. Only if a calibration run changes bot output: bump `BOT_VERSION` to the next minor and refresh bot goldens; otherwise record "no change".
Done when: bot tests green; shipped-20 `bots:golden` unchanged (asserted) or refreshed with the version bump; decision recorded.

## Task 8 — Importer: selectable row flip
What it is / what it means: PRD R6. The `selectable` row is `archetype: null` (blocked), gating many positions 182–340. Needs `TW_EXTRACT`.
What changes at a high level: `feature-map.json` row `selectable` becomes `map`; `map-level.ts` emits archetype, level and the `l, ml, cbi, ws, cwc, sc, ac, bs, swc, wcpr, dtsc, wt` overrides (absent means prefab default); footprint from the prefab collider dump (`Building` 4.7, `Hit` 3.3); plain `fortess` stays `block`. No levels imported yet.
Done when: `check:import` green; shipped 1–20 hashes unchanged (except 23 per SP02).

## Task 9 — Web: model, guns, parachute fx, HUD, assets
What it is / what it means: PRD R5. Input is unchanged (house gesture). Needs `TW_EXTRACT` for `SelectableFortess`; placeholders and a recorded note if missing.
What changes at a high level: fortress model with 8 gun meshes rotating toward target, pooled muzzle and bullet fx at `bs` (cosmetic, tower precedent); pooled parachute canopy descending 1.0 s + 2.0 s from spawn points in `fx-pool`, driven by launch and landing events; HUD cargo countdown ring and drops-left pips. `assets-tw` rows, manifest visual ids, credits.
Done when: `assets:tw:check` and `check:manifest` green; fx fire from events; fortress, guns and parachute visible in e2e; screenshots vs refs.

## Task 10 — Editor palette entry
What it is / what it means: PRD R5 Editor.
What changes at a high level: palette entry with `l, ml, ac, swc, wcpr, dtsc`; validation `swc >= 0`, `wcpr >= 1`; neutral fortress shows guns but no cargo; mirrors the importer.
Done when: editor places the fortress and exports valid level JSON that passes content validation; editor tests green.

## Task 11 — Curated selection from pool tool
What it is / what it means: README Curation + PRD R6; resolution 4 (SP01 owns census). Needs `TW_EXTRACT` and `pnpm census`.
What changes at a high level: from census output select >=10 selectable-fortress levels from Common 24–340. The first selected level introduces the fortress with no other new element; spread across later positions; prefer proxy-solvable, allowlist only when no equal-feature alternative; prefab-only ids swapped if `parse-prefab` fails. Selection list kept in the SP06 docs folder.
Done when: provisional selection recorded with source positions, features and metrics; coverage line (`selectable fortress: n levels, first at display N`) drafted.

## Task 12 — Import selected levels, solvability, locks
What it is / what it means: PRD R6, Acceptance. Selection is provisional; only SP09 sets final order and numbers (resolution 11). Needs `TW_EXTRACT`.
What changes at a high level: import only the selected levels with provisional display ids after 06's; run `validate:levels` on them; proxy-unsolvable go to `tools/unsolved-by-proxy.json` (reason, `ownerSignOff: null`); refresh only own entries via `levels:lock --levels`, content lock, CREDITS rows.
Done when: >=10 fortress levels imported, coverage line printed; shipped 1–20 unchanged except 23; `validate:content --base HEAD`, `check:content`, `check:import` green.

## Task 13 — Perf, e2e, campaign:verify sample, calibration, CI
What it is / what it means: PRD Acceptance. Calibrates against the TW position 182 equivalent.
What changes at a high level: `bench:sim` on a fortress-heavy level within budget; add the fortress introduction level to the `campaign:verify` sample set (position 182 equivalent passes); calibrate against the TW playthrough ref and record deviations if fallbacks hold; refresh golden/replay refs only if calibration moves outcomes; full `pnpm run ci`.
Done when: bench within budget; sample verify passes; `sim:golden`, `replay:verify golden`, `bots:golden` green; `pnpm run ci` green.

## Task 14 — Phase C gate: validate:levels --all
What it is / what it means: README resolution 8. Phase C's last task; run after 06's work is rebased in.
What changes at a high level: run `pnpm validate:levels --all` on the combined 06 + 07 branch; re-validate the existing unsolved-by-proxy entries; record any new failures in `tools/unsolved-by-proxy.json` (`ownerSignOff: null`) or fix the cause; note wall time against the +6 min PR budget.
Done when: `validate:levels --all` green; delta time recorded; PR ready for the Phase C review.

## Owner manual steps
- Provide rebuilt `TW_EXTRACT` for Tasks 1, 8, 9, 11, 12.
- Compare fortress behaviour against the TW playthrough of position 182 (calibration approval).
- Spot-check rows added to `tools/unsolved-by-proxy.json` here (`ownerSignOff` stays null).
- Approve the Phase C PR.
