---
status: draft
summary: 12 tasks — decode spike, rules text, defs/content, projectile store, impact/blast core (stable consumer API), ranged module + ring column, bot check, importer, web render, curated selection and import of >=10 WT3 levels, perf/ci gate
date: 2026-10-27
---
# Tasks: 04 Projectile core + artillery
Source of truth: [PRD](PRD.md). Adds a deterministic projectile/blast core (consumed by SP06/SP07 through `launch` / `resolveImpacts` only) and TW artillery (WT3 house + ranged unit), and imports a provisional >=10 WT3 level selection. Mechanics order: rule text + changelog + version bump, then tests, then code. Tasks 1, 8, 9, 10 need the rebuilt TW extract (`TW_EXTRACT`); Task 10 also needs SP01's `pnpm census`. Phase B PR = 04 + 05 (05 runs in parallel; 04 merges first). Version numbers are indicative (RULES 3.3.0 = next minor at merge time).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Decode spike: artillery behaviour, WT3 params, AI scoring, ordering | none | todo |
| 2 | Rules text: R-PRJ / R-ART, phase 7 sub-steps, RULES_VERSION | 1 | todo |
| 3 | Defs, events, projectile/unit/house JSON, schema, content version | 2 | todo |
| 4 | Projectile store: launch API, hash, snapshot, overflow | 3 | todo |
| 5 | Impact resolution + blast + phase 7a (core consumer contract frozen) | 4 | todo |
| 6 | Ring rangedCd column + ranged module + phase 7c launches | 5 | todo |
| 7 | Bots: WT3 scoring check, conditional BOT_VERSION | 1, 6 | todo |
| 8 | Importer: WT3 house row flip | 3 | todo |
| 9 | Web render + asset rows (shell, blast fx, models) | 5, 6 | todo |
| 10 | Curated selection from pool tool | 8, SP01 census | todo |
| 11 | Import selected levels, solvability, locks | 6, 7, 8, 10 | todo |
| 12 | Perf, campaign:verify sample, ordering calibration, CI | 9, 11 | todo |

## Task 1 — Decode spike: artillery behaviour, WT3 params, AI scoring, ordering
What it is / what it means: PRD Risks 1–7 (all RESOLVED as "spike first, else fallback"). Artillery stop-vs-walk, speed, WT3 `ws/cwc/sc/gl`, whether TW AI treats WT3 differently, impact-vs-arrival ordering, building shell targets/damage, and "every target per volley" are undecoded.
What changes at a high level: Time-boxed (~1 h each) decomp via `/root/projects/tower-war/_tools/decomp.sh` of `WarriorArtilleryController`, house/level WT3 params and the AI target-scoring class. No product code.
Done when: findings recorded per item. Each inconclusive item records its fallback as a deviation in GAME_RULES and the deviations ledger: keeps walking; speed 5 = soldier; WT3 params from imported level data (clone wt1 if uniform); no AI difference (BOT stays); ordering 7a -> 7b -> 7c -> 8; troops only with `hits` building/tower default off (damage = level - 1 if enabled); `volleyAll=true`. Needs `TW_EXTRACT`.

## Task 2 — Rules text: R-PRJ / R-ART, phase 7 sub-steps, RULES_VERSION
What it is / what it means: PRD Requirements (Rules), Decisions 1–5, 8. Rules authority comes first.
What changes at a high level: `docs/GAME_RULES.md` gains areas PRJ (lifecycle, aim modes point/troop/entity, closed-disc blast, owner filter, damage order) and ART (cadence, targeting, effect). Phase 7 row split into 7a impacts / 7b tower shots / 7c ranged launches, phase numbers unchanged; spike results and deviations written in; changelog; `RULES_VERSION` bumped to the next minor (indicative 3.3.0).
Done when: `pnpm check:rules` accepts the new IDs as untested stubs per repo convention; changelog and version present.

## Task 3 — Defs, events, projectile/unit/house JSON, schema, content version
What it is / what it means: PRD Content/defs. Artillery and shells are content-driven; the registry is what SP06/SP07 extend.
What changes at a high level: new `projectile` registry (aim, speed, blast radius, damage mode, `hits`, visual) with `artillery-shell`; `ranged` module def and optional unit `modules.ranged` schema; `units/artillery.json`; `house-wt3.json` (wt1 clone with `spawns.unit = artillery`, params per Task 1); events `ProjectileLaunched`, `ProjectileImpact`; `KillCause` gains `blast`. Content version/hash bump, `content:lock`.
Done when: schemas regenerated, `check:schemas`, `validate:content`, typecheck green; shipped level hashes unchanged.

## Task 4 — Projectile store: launch API, hash, snapshot, overflow
What it is / what it means: PRD Architecture (projectile store), Decisions 1, 7. First half of the core SP06/SP07 build on.
What changes at a high level: struct-of-arrays store in `projectiles.ts` with the fixed-capacity column set, `launch(state, spec)` computing an integer impact tick (`>= launch+1`) via checked integer math, deterministic launch-drop with `projDropped` counter on overflow, store added to hash and snapshot after elements. Empty store early-outs.
Done when: tests `covers R-PRJ-01` for impact-tick math and overflow drop; snapshot/hash round-trip; levels without projectiles replay bit-identically.

## Task 5 — Impact resolution + blast + phase 7a (core consumer contract frozen)
What it is / what it means: PRD R-PRJ-01..03, Decisions 2, 4, 5. Completes the core; its API is the stable contract for SP06/SP07.
What changes at a high level: `resolveImpacts(state)` as phase 7a, ascending `(impactTick, id)`; aim modes point/troop (position at impact tick)/entity (fizzles if gone); closed-disc integer blast with owner filter (neutrals hostile), order troops by `(channelKey, seq)`, then buildings, then elements; damage frozen at launch, `killTroop(cause:'blast')`. Public surface is only `launch` + `resolveImpacts`, written into the rules text and a short contract note for SP06/07.
Done when: tests `covers R-PRJ-02` and `R-PRJ-03`: blast boundary (r and r+1 milli), owner filter, entity fizzle, mid-ring kill with `alive` consistency, overkill, tank survives 1-hp shell; sim golden unchanged for existing levels.

## Task 6 — Ring rangedCd column + ranged module + phase 7c launches
What it is / what it means: PRD R-ART-01..03, Decision 6, Artillery fire. Turns the core into artillery.
What changes at a high level: `rangedCd` ring column hashed in the channel digest; per-channel `rangedCount` kept on spawn/removal; `ranged` module launching a shell per qualifying enemy troop within detect radius (closest first, ties `(owner, seq)`), first shot 0.4 s, cooldown 1.2 s reset only when a shell launched; walk/stop and volley rule per Task 1. Early-out when no ranged units.
Done when: tests `covers R-ART-01..03`: cadence 0.4/1.2 s, detect boundary, volley ordering, no-target stays ready, mid-ring removal of the shooter; replay hash determinism; `check:rules` fully green.

## Task 7 — Bots: WT3 scoring check, conditional BOT_VERSION
What it is / what it means: PRD Bots, Risk 4 resolution.
What changes at a high level: confirm WT3 houses score like WT1 in bot target selection. Only if Task 1 shows a TW difference: implement it, bump `BOT_VERSION` to the next minor, and refresh bot goldens; otherwise no change and the "no difference" deviation stays recorded.
Done when: `bots:golden` unchanged (or refreshed with the version bump); decision recorded.

## Task 8 — Importer: WT3 house row flip
What it is / what it means: PRD Importer, Problem. `house` `warriorType 3` points at a nonexistent file, blocking every WT3 level. Needs `TW_EXTRACT`.
What changes at a high level: `feature-map.json` WT3 row becomes `map` to `house-wt3`; archetype handling in `map-level.ts` if needed. No levels imported yet.
Done when: `check:import` green; shipped 1–20 hashes unchanged (except 23 per SP02).

## Task 9 — Web render + asset rows (shell, blast fx, models)
What it is / what it means: PRD Web. Visuals are cosmetic and interpolated from `(launch, impact)`, not sim state. Needs `TW_EXTRACT`.
What changes at a high level: `assets-tw` rows, manifest visual ids and credits for artillery and house-wt3 models; pooled instanced shell mesh in `fx-pool` interpolated per frame; blast ring fx on `ProjectileImpact`. Renderer registered by visual id so SP06/07 can reuse it. Record if the extract is missing.
Done when: `assets:tw:check` and `check:manifest` green; artillery, shells and blasts render in-game; 60 fps with 100 live shells noted.

## Task 10 — Curated selection from pool tool
What it is / what it means: README Curation + PRD Importer; resolution 4 (SP01 owns census). Needs `TW_EXTRACT` and `pnpm census`.
What changes at a high level: from census output select >=10 levels featuring artillery house WT3 from Common 24–340. First selected level introduces WT3 with no other new element; spread across later positions; prefer proxy-solvable over allowlisting; prefab-only ids swapped if `parse-prefab` fails. Selection list kept in the SP04 docs folder.
Done when: provisional selection recorded with source positions, features and metrics; coverage line (`artillery house WT3: n levels, first at display N`) drafted.

## Task 11 — Import selected levels, solvability, locks
What it is / what it means: PRD Importer, Acceptance. Selection is provisional; only SP09 sets final order and numbers (resolution 11).
What changes at a high level: import only the selected levels with provisional display ids after earlier SPs' levels; run `validate:levels` on them; proxy-unsolvable go to `tools/unsolved-by-proxy.json` (reason, `ownerSignOff: null`); refresh only own entries via `levels:lock --levels`, content lock, CREDITS rows.
Done when: >=10 WT3 levels imported, coverage line printed; shipped 1–20 unchanged except 23; `validate:content --base HEAD`, `check:content`, `check:import` green.

## Task 12 — Perf, campaign:verify sample, ordering calibration, CI
What it is / what it means: PRD Acceptance, Risk 5 resolution, resolution 7. Phase B's `validate:levels --all` is run pre-merge by the later of 04/05.
What changes at a high level: `bench:sim` with a synthetic 40-artillery level, <5% tick-time regression on the existing 20 levels; add the WT3 introduction level to the `campaign:verify` sample set and check artillery/shell/blast visible; calibrate impact-vs-arrival ordering against a TW playthrough ref, recording a deviation if the fallback holds; full `pnpm run ci`; run `validate:levels --all` if 04 is the later PR.
Done when: bench within budget; sample verify passes; `sim:golden`, `replay:verify golden`, `bots:golden` green; `pnpm run ci` green.

## Owner manual steps
- Provide rebuilt `TW_EXTRACT` for Tasks 1, 8, 9, 10.
- Compare artillery behaviour against a TW playthrough ref of the first WT3 level (calibration approval).
- Spot-check rows added to `tools/unsolved-by-proxy.json` here (`ownerSignOff` stays null).
- Approve the Phase B PR.
