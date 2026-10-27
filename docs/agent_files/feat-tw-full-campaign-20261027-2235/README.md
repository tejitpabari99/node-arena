---
status: draft
summary: Tower War full campaign — 9 sub-project PRDs (design only), positions 4–340
date: 2026-10-27
---
# Tower War full campaign (feat/tw-full-campaign)

## Goal
Port all remaining Tower War campaign components. Common campaign 4–23 -> 4–340 (railway at 330 is the last new feature, +10). Design only: PRDs, no code yet.

## Prerequisite
TW extract (`/root/projects/tower-war/_extract`) was deleted and is being rebuilt (UnityPy + Il2CppDumper + Ghidra headless, `decomp.sh` per class). All decode spikes, imports, asset copies and the census depend on it.

## Sub-projects
| # | Name | PRD | Scope | Depends on | Phase/PR | Status |
|---|---|---|---|---|---|---|
| 01 | Themes + campaign scale | [PRD](01-themes-campaign-scale/PRD.md) | Lava/Mine/Jungle/DarkMine themes, lazy level loading + picker worlds, gate subset/nightly split, `pnpm census`, import of no-new-mechanic levels | none | A | draft |
| 02 | Walls + mines | [PRD](02-walls-mines/PRD.md) | Wall (hp sponge) + mine (0.1 s delayed kill) on a generic element-state/crossing facility; re-import position 23 with wall; RULES 3.1.0 | 01 soft | A | draft |
| 03 | Resource piles | [PRD](03-resource-piles/PRD.md) | Neutral depletable pile building; pickup, return channel, reinforce `1 + gold`; AI targets piles (BOT bump); RULES 3.2.0 | 02, 01 soft | A | draft |
| 04 | Projectile core + artillery | [PRD](04-projectiles-artillery/PRD.md) | Deterministic projectile/blast core + WT3 artillery house/unit; RULES 3.3.0 | 01, 02, 03 | B | draft |
| 05 | Rivers + bridges + ROBS | [PRD](05-rivers-bridges/PRD.md) | Non-blocking rivers, plank ceils, turn-around via return channel, river obstacles; RULES 3.4.0 | 02, 03, 01 | B | draft |
| 06 | Rocket + capture rocket tower | [PRD](06-rocket-towers/PRD.md) | Aim/ClearAim commands, staged volleys, capture-rocket charge; AI rocket targeting; RULES 3.5.0 | 04, 02, 05, 03 | C | draft |
| 07 | Selectable fortress | [PRD](07-selectable-fortress/PRD.md) | House-like source + 8 guns + parachute cargo cycle, no new command; RULES 3.6.0 | 03, 04, 06 soft | C | draft |
| 08 | Trolley + railway | [PRD](08-trolley-railway/PRD.md) | Ready-gated cart that deletes target building; rails with `RailMove` + AI AiRM; RULES 3.7.0, BOT minor | 02–07 | D | draft |
| 09 | Final import, gates, docs | [PRD](09-import-gates-docs/PRD.md) | Residual import triage, gates at ~337 levels, docs/FUTURES cleanup, owner acceptance package | all | D | draft |

## Execution order
01 ∥ 02 -> 03 ∥ 04 -> 05 ∥ 06 -> 07 ∥ 08 -> 09. Max 2 concurrent agents. Real data dependencies still serialize merges (see chain below).

```
01 ─┐
    ├─> 03 ─┐
02 ─┘       ├─> 05 ─┐
        04 ─┘       ├─> 07 ─┐
            06 ─────┘       ├─> 09
                    08 ─────┘
```

Phase PRs to main:
| Phase | SPs | Pre-merge full run |
|---|---|---|
| A | 01 + 02 + 03 | SP03 |
| B | 04 + 05 | later of 04/05 |
| C | 06 + 07 | SP07 |
| D | 08 + 09 | SP09 |

## Locked decisions (owner)
- IN: artillery (WT3); capture rocket tower, selectable fortress, rocket tower, trolley; walls, mines, resource piles, rivers + bridges, river obstacles, railway; AI as TW uses it; Lava/Mine/Jungle/DarkMine themes; TW assets copied, copyright cleared by owner, non-commercial, inspiration credit.
- OUT: boosters (bomb/speed/trooper), rage skills, artefacts/research/meta/currencies/gacha/payments/ads, skins/colour patterns, PvP, tutorials, Boss/Draw-only content (boss tower, flag, plain fortress, gates, sheep, speed tower). Cargo stays dropped.
- Fidelity: exact TW where decoded; else time-boxed decode spike; else pick a sensible value and record the deviation in GAME_RULES + PRD (no YouTube matching).
- Acceptance: proxy-unsolvable level -> `tools/unsolved-by-proxy.json`, `ownerSignOff: null`, owner spot-checks later; CI green.
- Delivery: one PR per phase.

## Cross-cutting resolutions (orchestrator; binding over individual PRDs on conflict)
1. **Version chain.** Merge order 02 -> 03 -> 04 -> 05 -> 06 -> 07 -> 08. `RULES_VERSION` = next minor at merge time (indicative 3.1.0 … 3.7.0). `BOT_VERSION` bumps only when bot identity changes, next minor at merge time. Numbers in PRDs are indicative, not pinned.
2. **Position 23** (`levelview-100-es`): SP02 re-imports it with its wall — the only expected change to shipped-20 locks/hashes. All later SPs assert "shipped 20 unchanged except 23 per SP02".
3. **Phase-table amendments** land in order 06 (7d) -> 07 (4b, 7b guns) -> 08; each rebases on the previous.
4. **Census.** SP01 owns the tool, output format and `census-sp-map.json`; each SP updates its own row and publishes its delta table in its own PR (SP08 included).
5. **Shared data files** (`levels-lock.json`, `unsolved-by-proxy.json`, CREDITS rows, `feature-map.json`): each SP appends/edits only its own entries; merges are serialized.
6. **FUTURES.** Each SP removes its own shipped entries (SP03 piles entries; SP08 closes CrossingSource seam); SP09 does the final sweep only.
7. **campaign:verify.** SP01 owns scaling (sample/all modes); each SP adds its feature-introduction positions to the sample set.
8. **`validate:levels --all`** before each phase PR, run by the phase's last task (A: SP03, B: later of 04/05, C: SP07, D: SP09).
9. **Existing unsolved-by-proxy entries** (positions 5, 14, 16, 17, 18, 19) are re-validated by each phase's `--all` run; stale entries pruned in SP09.
10. **Prefab-only campaign ids**: count <=340 unverified (repo has 2 prefab ext files: positions 10, 23; SP01 text says 12). SP01 census determines it after the extract rebuild.

## Open questions (consolidated)
O = owner decision, S = spike-resolvable (needs rebuilt extract), D = design default, confirm at review.

**01**
- S: exact `EnvironmentData` prefab/material names for 4 themes; river/ROBS materials per-env vs shared (fallback: tinted green).
- S: rebuilt extract pathIDs vs `env.ts` values (fail loudly).
- D: PR subset sample rate/budget (10%, +3 min); `check:content` cost at 337; ground texture size.
- S: `themeFor` vs TW for all positions (census lists themes for eyeballing).
- D: how many levels SP01 alone unlocks (census answers).

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
- S: 1 capture charge rate; 2 rocket spacing; 3 capture second predicate; 4 disabled semantics; 5 capture projectile speed; 8 aim range clamp; 9 tower `rocketWeight`; 10 capture vs trolley ready flag.
- **O: 6 human aim persistence UX** (persist until `ClearAim` vs retract after one volley).
- D: 7 blast friendly fire.

**07**
- **O: no player-chosen fly target** — decomp says parachutes drop at fortress spawn points; confirm no new command/UX.
- S: 1 wave repeat rule; 2 gun offsets; 3 gun gating/damage; 4 guns vs trolleys/houses; 7 TW AI fortress details; 8 no-line bonus per soldier.
- D: 5 random vs round-robin lane; 6 alive cap vs airborne.

**08**
- S: 1 enemy capture of loaded trolley; 2 human drag cuts lines?; 3 trolley target set; 4 wall/mine vs cart; 5 AI trolley targeting; 6 cart hp; 8 `TryFindAttackPositionForTower` geometry; 9 rail point coordinate convention.
- D: 7 trolley-only player loss rule.

**09**
- S: P1 prefab-only ids <=340 and reconstructing ext files (needs UnityPy).
- **O: P2 accept a sparse campaign with gaps if some positions remain unimportable?** (vs contiguous prefix).
- D: G1 sample rate/shards; G2 unsolved fraction threshold; G3 bench budgets; W1 bundle threshold (gate stays OUT).

## Owner manual steps
- Review/approve PRDs.
- Triage `[OPEN]` items in each PRD (`[RESOLVED: …]` / `[DEFERRED]`), starting with the O items above.
- Provide rebuilt `TW_EXTRACT`.
- Spot-check levels at the end (`owner-pass.md` from SP09); sign off unsolved rows.
- Approve each phase PR.

## Next
`dev-tasks` per approved PRD, then `dev-code`.
