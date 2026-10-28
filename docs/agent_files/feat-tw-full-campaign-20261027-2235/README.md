---
status: draft
summary: Tower War curated campaign — 8 active sub-project PRDs + 1 deferred (design only), shipped 20 + selection from TW Common 24–340 (>=10 levels per new element)
date: 2026-10-27
---
# Tower War full campaign (feat/tw-full-campaign)

## Goal
Port all remaining Tower War campaign components (walls, mines, WT3 artillery, resource piles, rivers/bridges/ROBS, rocket + capture rocket towers, selectable fortress, 4 new themes; trolley + railway deferred by owner D6) and ship a **curated** Common campaign: the existing 20 levels (TW positions 4–23, unchanged) followed by a selection from the TW pool (Common positions 24–340), every new element in >=10 levels, difficulty/newness rising throughout. Estimated ~100–150 levels total (fewer is fine). Not all 4–340 are imported. Design only: PRDs, no code yet.

## Prerequisite
TW extract (`/root/projects/tower-war/_extract`) was deleted and is being rebuilt (UnityPy + Il2CppDumper + Ghidra headless, `decomp.sh` per class). All decode spikes, imports, asset copies and the census depend on it.

## Sub-projects
| # | Name | PRD | Scope | Depends on | Phase/PR | Status |
|---|---|---|---|---|---|---|
| 01 | Themes + campaign scale | [PRD](01-themes-campaign-scale/PRD.md) | Lava/Mine/Jungle/DarkMine themes, lazy level loading + picker worlds, gate timing at curated size, `pnpm census` = candidate-pool tool (features, blocked reasons, difficulty metrics) | none | A | draft |
| 02 | Walls + mines | [PRD](02-walls-mines/PRD.md) | Wall (hp sponge) + mine (0.1 s delayed kill) on a generic element-state/crossing facility; re-import position 23 with wall; select >=10 wall + >=10 mine levels; RULES 3.1.0 | 01 soft | A | draft |
| 03 | Resource piles | [PRD](03-resource-piles/PRD.md) | Neutral depletable pile building; pickup, return channel, reinforce `1 + gold`; AI targets piles (BOT bump); select >=10 pile levels; RULES 3.2.0 | 02, 01 soft | A | draft |
| 04 | Projectile core + artillery | [PRD](04-projectiles-artillery/PRD.md) | Deterministic projectile/blast core + WT3 artillery house/unit; select >=10 WT3 levels; RULES 3.3.0 | 01, 02, 03 | B | draft |
| 05 | Rivers + bridges + ROBS | [PRD](05-rivers-bridges/PRD.md) | Non-blocking rivers, plank ceils, turn-around via return channel, river obstacles; select >=10 river + >=10 ROBS levels; RULES 3.4.0 | 02, 03, 01 | B | draft |
| 06 | Rocket + capture rocket tower | [PRD](06-rocket-towers/PRD.md) | Aim/ClearAim commands, staged volleys, capture-rocket charge; AI rocket targeting; select >=10 rocket + >=10 capture-rocket levels; RULES 3.5.0 | 04, 02, 05, 03 | C | draft |
| 07 | Selectable fortress | [PRD](07-selectable-fortress/PRD.md) | House-like source + 8 guns + parachute cargo cycle, no new command; select >=10 fortress levels; RULES 3.6.0 | 03, 04, 06 soft | C | draft |
| 08 | Trolley + railway | [PRD](08-trolley-railway/PRD.md) | **DEFERRED by owner 2026-10-28 (D6) — not in this initiative; kept for future.** Trolley, railway, AI rail moves (AiRM) dropped for now | - | - | deferred |
| 09 | Final curation, gates, docs | [PRD](09-import-gates-docs/PRD.md) | Per-element >=10 coverage check, order + difficulty-curve check, gap fill, contiguous numbering, selection table, gates at curated size, docs/FUTURES cleanup, owner acceptance package | 02-07 | D | draft |

## Execution order
01 ∥ 02 -> 03 ∥ 04 -> 05 ∥ 06 -> 07 -> 09 (08 deferred, not scheduled). Max 2 concurrent agents. Real data dependencies still serialize merges (see chain below).

```
01 ─┐
    ├─> 03 ─┐
02 ─┘       ├─> 05 ─┐
        04 ─┘       ├─> 07 ──> 09
            06 ─────┘
```

Phase PRs to main:
| Phase | SPs | Pre-merge full run |
|---|---|---|
| A | 01 + 02 + 03 | SP03 |
| B | 04 + 05 | later of 04/05 |
| C | 06 + 07 | SP07 |
| D | 09 | SP09 |

## Curation (owner decisions D1, D2)
Rules (binding on all PRDs):
- **Scope.** Ship the existing 20 levels (positions 4–23, unchanged; 23 re-imported with its wall by SP02) followed by a selection from TW Common 24–340. No bulk import. Target size = whatever satisfies coverage + curve (~100–150 estimated; fewer is fine). All mechanics, themes, assets stay in scope; only the level count shrinks.
- **Coverage.** Each new element appears in >=10 shipped levels, spread through the campaign after its introduction: walls, mines, artillery house WT3, resource piles, capture rocket tower, rivers (+bridges), river obstacles (ROBS), selectable fortress, rocket tower; also AI behaviours Random (BT2) and Defense (BT1) where levels use them.
- **Newness + difficulty.** An element's first level introduces it (ideally the only new thing). Order by TW position (inherits TW's introduction curve), then check difficulty with proxy/balance metrics (proxy win rate, median win time, AI/player start-level ratio, number of AIs) as a windowed non-decreasing trend per ~10 levels (local dips allowed); fix by reordering within the constraint "first-introduction order preserved". Concrete metric and thresholds: SP09 R1.
- **Prefer proxy-solvable candidates**; avoid levels needing allowlisting when an alternative with the same feature exists.
- **Numbering (D2).** Display numbering is contiguous (Level 1..N). TW source position is metadata (`source.position`). Unselected/unimportable positions are simply not imported (D5); LEVELS_GUIDE lists the selection and why. Themes rotate by display position every 20 levels (all 6 appear if N >= 101; all 4 new theme art sets ship regardless, LEVELS_GUIDE notes which appear).

Who does what:
| Who | Does |
|---|---|
| SP01 | Candidate-pool tool (`pnpm census`): TW 24–340 features, blocked reasons, difficulty metrics; themes; client/gate scale at ~150 |
| SP02–SP07 | Each selects >=10 pool levels featuring its element(s) per these rules, imports them, prints the coverage line (`element: n levels, first at display N`). Self-contained; selection is provisional |
| SP09 | Final curation + assembly: coverage confirm, order + difficulty-curve check, gap fill, contiguous numbering, LEVELS_GUIDE selection table; then gates, docs, owner-pass (one level per element intro + every allowlisted level) |

## Locked decisions (owner)
- IN: artillery (WT3); capture rocket tower, selectable fortress, rocket tower; walls, mines, resource piles, rivers + bridges, river obstacles; AI as TW uses it; Lava/Mine/Jungle/DarkMine themes; TW assets copied, copyright cleared by owner, non-commercial, inspiration credit.
- DEFERRED (D6, owner 2026-10-28): trolley, railway, AI rail moves (AiRM) "for now". SP08 PRD/TASKS kept, status deferred. TW positions using trolley/railway/AiRM are excluded from the candidate pool (importer keeps them blocked; AiRM stays dropped); curation never selects them.
- OUT: boosters (bomb/speed/trooper), rage skills, artefacts/research/meta/currencies/gacha/payments/ads, skins/colour patterns, PvP, tutorials, Boss/Draw-only content (boss tower, flag, plain fortress, gates, sheep, speed tower). Cargo stays dropped.
- Fidelity: exact TW where decoded; else time-boxed decode spike; else pick a sensible value and record the deviation in GAME_RULES + PRD (no YouTube matching).
- Acceptance: proxy-unsolvable level -> `tools/unsolved-by-proxy.json`, `ownerSignOff: null`, owner spot-checks later; CI green.
- Scope (D1/D2): curated campaign, not all 4–340 (see Curation). Display numbering contiguous; TW position is metadata.
- Delivery: one PR per phase.

## Cross-cutting resolutions (orchestrator; binding over individual PRDs on conflict)
1. **Version chain.** Merge order 02 -> 03 -> 04 -> 05 -> 06 -> 07. `RULES_VERSION` = next minor at merge time (indicative 3.1.0 … 3.6.0; ends at SP07, no SP08 bump). `BOT_VERSION` bumps only when bot identity changes, next minor at merge time. Numbers in PRDs are indicative, not pinned.
2. **Position 23** (`levelview-100-es`): SP02 re-imports it with its wall — the only expected change to shipped-20 locks/hashes. All later SPs assert "shipped 20 unchanged except 23 per SP02".
3. **Phase-table amendments** land in order 06 (7d) -> 07 (4b, 7b guns); each rebases on the previous.
4. **Candidate-pool tool (`pnpm census`).** SP01 owns the tool, output format and `census-sp-map.json`; each SP selects its element's levels from it and publishes its coverage line in its own PR; SP09 owns the coverage/curve emitters.
5. **Shared data files** (`levels-lock.json`, `unsolved-by-proxy.json`, CREDITS rows, `feature-map.json`): each SP appends/edits only its own entries; merges are serialized.
6. **FUTURES.** Each SP removes its own shipped entries (SP03 piles entries); SP09 does the final sweep only, and records trolley, railway, AiRM and CrossingSource in one "Deferred by owner" FUTURES entry.
7. **campaign:verify.** SP09 owns sample/all modes; each SP adds its element-introduction level to the sample set.
8. **`validate:levels --all`** before each phase PR, run by the phase's last task (A: SP03, B: later of 04/05, C: SP07, D: SP09). At curated size (~150 levels, ~5–8 min at 2.1 s/level) no sharding/nightly split is planned; SP01 measures, `--jobs` only if the PR delta exceeds +6 min.
9. **Existing unsolved-by-proxy entries** (positions 5, 14, 16, 17, 18, 19) are re-validated by each phase's `--all` run; stale entries pruned in SP09. Newly selected levels prefer proxy-solvable candidates over allowlisting.
10. **Prefab-only ids** {35, 66, 137, 215, 221, 266, 329} (10, 23 shipped) matter only if selected; a selected id that fails `parse-prefab` is swapped for an equal-feature alternative.
11. **Selection ownership.** SP02–SP07 selections are provisional; only SP09 sets final order and display numbers. Intermediate PRs may use provisional ids; no SP renumbers shipped levels 1–20.
12. **Base types + derivation (owner D7).** Every game type derives from an explicit base, expressed as data: base **Building** (level, owner, capture, footprint), base **Troop/unit** (hp/attack/defense/speed, ring membership), base **Element** (map element: footprint, layer, per-element state; walls, mines, rivers, ROBS, obstacles derive), base **Path/line** (lines, rocket aim path; a sim-level shared type with no content file), base **Projectile** (SP04 core; artillery shell, rocket, capture shot derive). New content declares an archetype with `extends` plus behaviour modules (never a fork of the base). Examples: `house-wt3` extends the house base; `rocket-tower` and `capture-rocket-tower` extend a base tower; `selectable-fortress` = house base + shoots-style guns + parachute (cargo) module; `wall`/`mine` extend the element base. Implementation stays data-driven (archetypes + modules); **no TS class hierarchy in the sim**. State of the repo (verified by grep in `packages/content`): no `extends` mechanism exists, archetypes are flat module bags and only level entries override params, so **SP02 Task 2a generalises `extends` to all content kinds** (building/unit/element, projectile kind registered by SP04; same-kind chain, cycle/unknown-parent errors, flattened before `simHash`, existing archetypes need not migrate). SP02 creates `element-base`, SP03 `building-base`, SP04 `projectile-base`; SP03-07 Task 3 use `extends`.
13. **Trolley/railway deferred (owner D6).** No SP08 dependencies remain: SP06 capture-rocket target set is buildings only, SP07 guns shoot warriors only, SP05 `CrossingSource` stays a FUTURES seam, SP04 projectile `hits` has no trolley kind.

## Open questions (consolidated)
O = owner decision, S = spike-resolvable (needs rebuilt extract), D = design default, confirm at review.

**01**
- S: exact `EnvironmentData` prefab/material names for 4 themes; river/ROBS materials per-env vs shared (fallback: tinted green).
- S: rebuilt extract pathIDs vs `env.ts` values (fail loudly).
- D: PR budget +6 min (`--jobs` fallback); `check:content` cost at curated size; ground texture size.
- S: `themeFor` vs TW for pool positions (pool tool lists themes; shipped theme follows display position, D2).
- D: lazy loading kept at ~150 (Task 1 may flip to eager if cheap); gate sharding dropped (measure).

**02**
- S: S1 wall/mine trigger size + wall length vs Hp; S2 layer (blocks lines?); S3 owner gate/tank/AI trigger; S4 per-theme materials.
- D: O4 snapshot/hash schema bump (confirm no persisted sim snapshots); element pass ordering vs clash (calibrate).

**03**
- S: S1 `RESOURCE_DISABLE_TIME`, `DestroyWayToResource`, empty-pile arrival, hostile pickup; S2 footprint/blocking; S3 AI tie order.
- D: O1 channels per line vs per pair (companion static vs lazy); O2 returner vs alive cap; O3 gold on surplus; O4 model per amount vs scale.

**04**
- S: 1 artillery stops or walks; 2 artillery speed; 3 WT3 `ws/cwc/sc/gl`; 4 TW AI treats WT3 differently (BOT bump?); 6 building/tower shell targets and damage; 7 "every target per volley".
- D: 5 impact vs arrival/clash ordering (calibrate).

**05**
- S: S1 planks per troop/kind, pause, `CheckRightWay`, `W`/`D`; S2 river collider shapes (18); S3 bridge lifetime/shared use; S4 ROBS layer (could force BOT bump); S5 AI never reads river state.
- D: 6 ceil damage hook (SP06); 7 turn-back when source captured (follow SP03); playability of long rivers.

**06**
- S: 1 capture charge rate; 2 rocket spacing; 3 capture second predicate; 4 disabled semantics; 5 capture projectile speed; 8 aim range clamp; 9 tower `rocketWeight`.
- [RESOLVED: persists until `ClearAim` (owner delegated; revisit after playtest)] Human aim persistence.
- D: 7 blast friendly fire.

**07**
- [RESOLVED: owner — copy TW] Parachutes drop at fortress spawn points, walk a fortress lane chosen round-robin, else add level; no command.
- S: 1 wave repeat rule; 2 gun offsets; 3 gun gating/damage; 4 guns vs houses; 7 TW AI fortress details; 8 no-line bonus per soldier.
- D: 5 random vs round-robin lane; 6 alive cap vs airborne.

**08 (deferred by owner, not in scope)**
- (SP08 deferred; items below kept for future) S: 1 enemy capture of loaded trolley; 2 human drag cuts lines?; 3 trolley target set; 4 wall/mine vs cart; 5 AI trolley targeting; 6 cart hp; 8 `TryFindAttackPositionForTower` geometry; 9 rail point coordinate convention.
- D: 7 trolley-only player loss rule.

**09**
- S: P1 prefab-only ids matter only if selected (needs UnityPy only then).
- [RESOLVED: owner — skip, contiguous display numbering (D2)] Unimportable positions.
- D: G1 gate timing (no shards); G2 unsolved fraction threshold (10%); curve constants (SP09 R1.7); G3 bench budgets; W1 bundle threshold (gate stays OUT).

## Owner manual steps
- Review/approve PRDs.
- Triage done: no `[OPEN]` items remain (owner items D3–D5 resolved).
- Provide rebuilt `TW_EXTRACT`.
- Spot-check levels at the end (`owner-pass.md` from SP09: one level per element intro + every allowlisted level); sign off unsolved rows.
- Approve each phase PR.
- Trolley/railway: deferred (D6); revisit via FUTURES when wanted.

## Next
`dev-tasks` per approved PRD, then `dev-code`.
