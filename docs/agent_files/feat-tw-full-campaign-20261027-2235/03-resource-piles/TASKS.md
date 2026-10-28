---
status: draft
summary: 12 tasks — decode spike, R-PIL rules 3.2.0, defs/content, ring carry + return channels, pickup/return sim, AI pile targeting (BOT 2.5.0), importer, web, editor, >=10 pile levels, Phase A closing run
date: 2026-10-27
---
# Tasks: 03 Resource piles
Source of truth: [PRD](PRD.md). Neutral depletable pile building; troops pick up gold, turn around on a companion return channel, reinforce home by `defense + gold`. Depends on SP02 (element-state facility, crossing helper, `RULES_VERSION` 3.1.0) and softly on SP01 (`pnpm census`, themes). Siblings referenced only. Tasks 1, 7 (prefab ids), 8 (assets), 10, 11 need the rebuilt TW extract (`TW_EXTRACT`). Task 12 closes Phase A (01+02+03).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Decode spike: pile lifecycle, footprint, tie order, surplus, models | none | todo |
| 2 | Rules text: R-PIL-01..05, cross-refs, RULES_VERSION | 1, SP02 T2 | todo |
| 3 | Defs, events, pile JSON, schema, content version | 2, SP02 T2a | todo |
| 4 | Ring carry column + return channels + hash | 3, SP02 T4 | todo |
| 5 | Depletes + carries modules, arrival dispatch | 4 | todo |
| 6 | Bots: pile targets, script THId, BOT_VERSION | 5 | todo |
| 7 | Importer: WOD mapping, gate token, pile ids | 3 | todo |
| 8 | Web render + asset rows | 3, 5 | todo |
| 9 | Editor library item | 8 | todo |
| 10 | Curated selection from pool tool | 7, SP01 census | todo |
| 11 | Import selected levels, solvability, locks | 5, 6, 7, 10 | todo |
| 12 | Perf, campaign:verify sample, FUTURES cleanup, Phase A full run | 8, 9, 11 | todo |

## Task 1 — Decode spike: pile lifecycle, footprint, tie order, surplus, models
What it is / what it means: PRD risks S1, S2, S3, O3, O4. Disable time, `DestroyWayToResource`, empty-pile arrival, hostile pickup, footprint, AI tie order, surplus-gold handling and per-amount models are undecoded. Needs `TW_EXTRACT`.
What changes at a high level: One ~1 h time-boxed decomp per item via `/root/projects/tower-war/_tools/decomp.sh` (Resource classes, collider, AI pile list, returner surplus, Resources prefabs). Record each finding.
Done when: each of S1/S2/S3/O3/O4 has a recorded result, or its fallback is adopted and logged as a deviation in GAME_RULES and the deviations ledger (4 s disable ignored, DestroyWayToResource off, empty arrival returns without pickup, hostile pickup allowed; circle r = 0.5 x house, non-blocking; list-order ties; gold dropped on surplus; one prefab scaled by amount band). O2 (returner counts toward spawn limit) stays as resolved unless contradicted.

## Task 2 — Rules text: R-PIL-01..05, cross-refs, RULES_VERSION
What it is / what it means: PRD R1. Rules authority first (AGENTS.md order).
What changes at a high level: New `PIL` area in `docs/GAME_RULES.md` (pile, pickup, return, depletion, cut lifecycle) using spike results; R-ENT-01 gains `pile`, R-LIN-01/R-CAP-01/R-WIN-01/R-OBS-01 cross-refs, phase 8 row, changelog, `RULES_VERSION` next minor (indicative 3.2.0). Test stubs/titles `covers R-PIL-NN` reserved.
Done when: `check:rules` green with stable IDs; version bumped as minor (additive; non-pile replays unchanged); spike deviations reflected in text.

## Task 3 — Defs, events, pile JSON, schema, content version
What it is / what it means: PRD R2. Pile is data plus two modules.
What changes at a high level: `depletes` and `carries` module defs; events `PileHit`, `PileDepleted`, `TroopReturned`; `resource-pile.json` building (no grows/lines/spawns/shoots, footprint per S2); unit `carry` (soldier 1, tank 2, artillery 1); `balance.json` `pile.addResourceBonus: 0`; level `requires` gains both modules; schemas regenerated; content version/hash bumped. Base derivation (D7). `resource-pile` archetype `extends` `building-base` (level, owner, capture, footprint; created here, first building-kind base) plus `depletes`/`carries`; `carries` rides the base unit (`unit-base` hp/attack/defense/speed) unchanged. Uses `extends` from SP02 Task 2a.
Done when: `content:schemas`/`check:schemas`, `validate:content --base HEAD`, `check:content` green; shipped-20 level hashes unchanged apart from SP02's position 23.

## Task 4 — Ring carry column + return channels + hash
What it is / what it means: PRD R3. Return trip = same troop `seq` moved to a companion channel; ring stays FIFO.
What changes at a high level: `carry` int column in ring (shifted by `removeAt`, zeroed in `clear`, hashed); compile creates static `pile -> source` companion channels for every line ending at a pile, ascending `(pile, source)`, in stable key order; pile `amount` and return channels hashed; `read.ts` exposes `carry` and pile flag.
Done when: unit tests for column shift/clear, channel creation order, hash round-trip and determinism; `replay:verify golden` unchanged on non-pile levels.

## Task 5 — Depletes + carries modules, arrival dispatch
What it is / what it means: PRD R3, R-PIL-02..05. Behaviour in phase 8.
What changes at a high level: Arrival dispatch by target archetype: pickup `min(amount, carry)`, move troop to return channel at `p0 = overshoot`; empty pile per S1 result; depletion cuts lines and rejects `DrawLine`; return arrival adds `defense + carry` with cap/surplus per S-result; home captured mid-return kills returner; returners clash and cross like ordinary troops (SP02 crossings); events emitted.
Done when: tests titled `covers R-PIL-NN` cover soldier 1 / tank 2 / amount < carry clamp, depletion + cut, reinforce incl. cap/surplus, home captured, crossing-lane clash, same-tick multi-arrival order, determinism; `check:rules` green.

## Task 6 — Bots: pile targets, script THId, BOT_VERSION
What it is / what it means: PRD R4. AI targets piles weakest-first as TW does; target set changes on pile levels.
What changes at a high level: Piles enter `sortedTargets` with key = amount, filtered to `amount > 0`, tie order per S3; script steps with pile `THId` resolve via building ids; `BOT_VERSION` bumped to next minor (indicative 2.5.0); `bots:golden` entries for 1–2 pile levels added.
Done when: bot goldens for shipped 20 byte-identical (any diff is a bug); tests for filter, tie order, script resolution; version bumped.

## Task 7 — Importer: WOD mapping, gate token, pile ids
What it is / what it means: PRD R6. `WOD` is parsed but currently element/null, blocking every pile level.
What changes at a high level: `feature-map.json` `WOD` -> building `resource-pile`; clear the gate's `resource` blocker token; `map-level.ts` emits piles after buildings in order per S3, `level = c`, `owner: null`, pile ids kept in the id map. Census reflects cleared blocker.
Done when: importer unit tests with a WOD fixture (no extract needed); `check:import` green; no change to existing shipped-level output.

## Task 8 — Web render + asset rows
What it is / what it means: PRD R5. Piles and carried gold must be visible. Needs `TW_EXTRACT`.
What changes at a high level: `assets:tw` rows for Resources prefabs (per S-result: per-amount or scaled one) and Gold token; manifest ids, credits rows; renderer swaps/scales pile by amount band, shrinks on `PileHit`, fades on `PileDepleted`, shows gold bag when `carry > 0`, reuses reinforce pop with `+N` on `TroopReturned`. No HUD.
Done when: `assets:tw:check` (byte-identical regen) and `check:manifest` green; screenshots of pile and returner saved to `ref/`; web unit tests and e2e green.

## Task 9 — Editor library item
What it is / what it means: PRD R5 editor.
What changes at a high level: `resource pile` palette item with amount select snapped to the 10 TW values; owner fixed neutral; export emits `owner: null`; round-trips through import.
Done when: editor tests cover place/export/import; existing editor e2e green.

## Task 10 — Curated selection from pool tool
What it is / what it means: README Curation; cross-cutting resolution 4. Provisional selection of >=10 pile levels from TW Common 24–340. Needs `TW_EXTRACT`.
What changes at a high level: Use `pnpm census` (SP01) filtered by `WOD` to choose >=10 levels: first one introduces piles alone (no other new element, e.g. first at TW 67 if clean), spread across later positions, prefer proxy-solvable, prefer no prefab-only ids (else swap for an equal-feature alternative). Record list with reasons and metrics in the sub-project folder; note which also carry elements from other SPs.
Done when: >=10 ids chosen with per-level feature/difficulty notes; every blocker cleared by Task 7 or substituted; list marked provisional (SP09 finalizes).

## Task 11 — Import selected levels, solvability, locks
What it is / what it means: PRD R6 + acceptance. Import only the selection.
What changes at a high level: Import via the pipeline; run proxy solvability; unsolved levels go to `unsolved-by-proxy.json` (reason, `ownerSignOff: null`) only if no equal-feature alternative; content version bump, `content:lock`, `levels:lock` (use `--levels` from SP01 for own entries); LEVELS_GUIDE "resource piles" row updated; coverage line printed (`resource piles: n levels, first at display N`).
Done when: >=10 pile levels load and play; shipped-20 hashes unchanged (position 23 per SP02 only); bot goldens for them recorded; locks/unsolved edited only for own entries.

## Task 12 — Perf, campaign:verify sample, FUTURES cleanup, Phase A full run
What it is / what it means: PRD acceptance + resolutions 6–8. Phase A's closing task.
What changes at a high level: `bench:sim` on a pile-heavy level within budget; add the pile-introduction level to the `campaign:verify` sample set; remove the two pile "dropped" FUTURES entries; run `pnpm run ci`, `replay:verify golden` (churn limited to new levels) and `validate:levels --all` (re-validates existing unsolved entries) before the Phase A PR.
Done when: all green; timing delta noted against the +6 min PR budget; stale or failing items recorded, not silently pruned.

## Owner manual steps
- Provide rebuilt `TW_EXTRACT` (blocks tasks 1, 8, 10, 11).
- Spot-check new `unsolved-by-proxy.json` rows (`ownerSignOff: null`) and pile screenshots in `ref/`.
- Approve the Phase A PR (01+02+03) after the full `validate:levels --all` run (task 12).
