---
status: draft
summary: Close the initiative: final import sweep of Common positions 4-340 (census-driven residual triage), gates re-baselined at ~337 levels (PR subset vs nightly full, locks, goldens, bench), docs consolidated (rules changelog 3.1-3.7, census-generated coverage tracker, deviations ledger, FUTURES cleanup, credits, README/AGENTS), web smoke at scale, and an owner acceptance package.
date: 2026-10-27
---
# PRD: 09 Final import, gates, docs

Repo/branch: node-arena, `feat/tw-full-campaign` (Phase D PR = SP08+09) · Depends on: all (01-08 merged or in the same branch; runs last) · Feeds: release (campaign 4-340)
Owns: `docs/LEVELS_GUIDE.md` (coverage tracker, deviations ledger, dropped data), `docs/FUTURES.md` (cleanup), `docs/CONTENT_GUIDE.md` (cross-links only), `docs/CREDITS.md` (audit; rows are added by 01/02-08), `README.md`, `AGENTS.md` project section, `tools/README.md`, `tools/unsolved-by-proxy.json` (final review), `tools/levels-lock.json` (final refresh), `tools/src/import-tw/level-overrides.json` policy, `.github/workflows/{ci,nightly,balance}.yml` (tuning only), `apps/web/e2e` + `playwright.campaign.config.ts` (campaign smoke scale), `docs/agent_files/feat-tw-full-campaign-20261027-2235/{census.json,owner-pass.md,README.md}`.
Does not own: any rule text or mechanic (02-08 own `GAME_RULES.md` areas; 09 only reviews the consolidated changelog and fixes wording, no behaviour), importer rows (each SP flips its own), `census` script (01), lazy loading and picker (01).

## TL;DR
- Nothing new in the sim. 09 is the sweep: run `pnpm census`, import whatever is still importable in 4-340, and make every leftover block an explicit, documented decision.
- Gates: keep SP01's PR-subset / nightly-full split; final pre-release run is `validate:levels --all` on Node 22 and 24 with identical `levels-lock.json` hashes; unsolved allowlist reviewed row by row.
- Docs: tracker generated from census (not a static snapshot), one deviations ledger, FUTURES pruned, README/AGENTS say 337 levels.
- Web: campaign smoke becomes a deterministic sample plus a nightly full sweep, not 337 x 5 s in PR CI.
- Owner gets `owner-pass.md`: one level per feature introduction + every unsolved-by-proxy level.

## Problem
- Each mechanic SP imports "what it unlocks" against a census that moves under it; nobody owns the end state: leftover blocks, the 12 "prefab-only" ids, a tracker still static [verified: `LEVELS_GUIDE.md` L98-100 "not recomputed"], README/AGENTS "20 levels" [verified: `README.md` L3, `AGENTS.md`].
- `campaign:verify` and `acceptance.spec.ts` hard-code 20 levels [verified: `tools/README.md` L83, `e2e/acceptance.spec.ts` L6].
- FUTURES still lists shipped work (walls/mines, rivers, rockets, fortress, trolley, piles, themes, census, CrossingSource) [verified: `FUTURES.md`].
- The only prefab inputs in the repo are two (positions 10, 23); SP01 says "12 prefab-only ids" [verified: `ls tools/src/import-tw/prefab`; SP01 R4 claim unverified].

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Census over 4-340: 0 blocked except rows documented with a reason in LEVELS_GUIDE | Positions >340, tutorials 1-3, boss, Draw-only levels (OUT) |
| `pnpm run ci` green on Node 22+24; nightly full `validate:levels --all` green or allowlisted | Statistical balance gating (`balance` stays report-only) |
| Docs match code; `check:docs` green | New mechanics or rule changes |
| Owner can accept in one sitting from a short list | Owner sign-off itself (owner-only; `ownerSignOff` stays null) |

## Requirements
### R1 Import sweep
- Run `pnpm census` then `pnpm import:tw --range 4-340`; classify every non-imported position as: (a) importable now (miss: fix), (b) blocked by an OUT feature (boosters/boss/Draw-only/cargo-only), (c) parse failure (long/v0 dialect, missing prefab). (a) must be 0.
- **Prefab-only ids**: list them from the extract (`census` should print them); for each <=340 either commit an `*.ext.json` + `colliders.json` rows via UnityPy (`dump_colliders.py`), or record it as blocked-with-reason. [OPEN P1]
- **Residual triage** table in LEVELS_GUIDE §5: position, blocker, class (a/b/c), decision. Blocked positions leave the campaign sparse (`--skip-blocked`) only if the owner accepts gaps [OPEN P2].
- **`level-overrides.json` policy**: file today holds playtest tuning for shipped levels (bot delays, building nudges, with `reason`). Policy: imports 24-340 ship **un-tuned** (faithful TW); overrides only for a level that fails proxy solvability for a *fixable cause* (placement, delay) and require `reason`; unsolvable stays in `unsolved-by-proxy.json` instead of being tuned away. Overrides reviewed in the sweep; none added speculatively.
- Reconcile counts: `common.json` entries == files in `data/levels` (minus `na-*`) == `levels-lock.json` keys == census `imported`.

### R2 Gates at scale
- `validate:levels`: PR = SP01 subset (changed + first-of-world + 10% sample) + seed-1 lock for all levels; nightly = full seeds x delays, 4-way shards. 09 measures wall time on the final tree and tunes the sample rate/shards to keep the PR delta <= +3 min [OPEN G1].
- `levels:lock` refreshed once at the end (single bulk commit, so per-SP `--levels` refreshes never conflict). `check:content --base HEAD` and `validate:content` timed at 337 (target <60 s combined, SP01).
- **Unsolved allowlist review**: each row has reason (stalemate / eliminated / cap-hit), mechanic tag, and `ownerSignOff`. Rows whose reason is "proxy cannot use feature X" (e.g. rockets, rail) are grouped; if >~15% of levels are unsolved, flag as proxy weakness, not level fault [OPEN G2].
- **Goldens/replays**: one `sim:golden` per new mechanic family, small hand-built scenario (wall/mine, pile, artillery, river, rocket, capture rocket, fortress, trolley, rail move) if the owning SP did not already add one; `bots:golden` adds the BOT-changing SPs (03 piles, 06 rockets, 08 AiRM). `replay:verify golden` scans all. Existing 20-level hashes may move only where SP02 re-imported position 23.
- `bench:sim`/`bench:bots`: re-run on the largest level (most units/projectiles) and a rocket-heavy one; budgets unchanged unless a measured regression is explained and accepted [OPEN G3].
- Version chain check (script or `check:docs` assertion): RULES 3.7.0, BOT 2.7.0, content version/hash consistent with locks; no stray bump between SPs.
- Parked scaffold: `PARKED` must be empty; `check:parked --strict` passes.

### R3 Docs
| Doc | Action |
|---|---|
| `GAME_RULES.md` | Review-only: changelog 3.1.0-3.7.0 complete and ordered; phase table rows (6, 7a-7d, 4b, 8) consistent; every new `R-*` has `covers` tests (`check:rules`); no fix to behaviour |
| `LEVELS_GUIDE.md` | §5 tracker replaced by census-generated table (+ link to `census.json`); deviations ledger = one table of every spike "picked value" (SP, quantity, TW source or "not decoded", chosen value, rationale); dropped-data table updated (cargo, sc, tutorial scripts; wall no longer dropped); "Imported levels (20)" wording updated |
| `FUTURES.md` | Remove shipped: walls/mines, rivers/bridges, rockets/fortress, trolley/rail, resource piles (both entries), themes beyond Green/Snow, census, CrossingSource (closed as not built; keep one line in LEVELS_GUIDE/GAME_RULES notes). Keep boosters, tutorials, meta, PvP, cargo, shield/ranged modules, bundle gate (see W3), mobile/portrait, hosting, editor items |
| `CREDITS.md` | Audit only: every file under `apps/web/assets/**` covered (`check:manifest` warning count 0) |
| `README.md`, `AGENTS.md` | "20-level" -> campaign positions 4-340 (337 levels), themes list, mechanics list; script inventory current |
| `tools/README.md` | census, shard/`--all`, nightly, campaign smoke modes |

### R4 Web at scale
- `campaign:verify` gets modes: `--sample` (default PR: first/last of each 20-level world + first level per feature introduction + changed levels, ~40) and `--all` (nightly, sharded). Existing 5 s dwell + browser-error check + screenshot kept; `acceptance.spec.ts` HUD-safe-frame test stays on a sample, not 337.
- Manual check: picker at 337 (world grouping, scroll-to-current, unlock O(1)), save size, boot loads one level (SP01 AC).
- Perf/bundle: record main-chunk gzip size and largest level chunk in the PR; **bundle budget gate decided OUT** (record numbers in tools/README, keep FUTURES entry) unless main chunk regressed >25% vs pre-initiative [OPEN W1].

### R5 Owner acceptance package
- `owner-pass.md` (template, model on previous port's): header (commit, versions, census summary), section A feature-introduction levels (one per: base, towers, wall, mine, WT3 artillery, pile, river, ROBS, capture rocket, fortress, rocket tower, trolley, rail, each new theme), section B every unsolved-by-proxy row (checkbox: winnable / too hard / broken / sign-off), section C visual (theme screenshots vs `ref/`), D picker/save/mobile-touch drag-aim, E sign-off line.
- Positions chosen from the census `first-position-per-feature` field, not memory (known first positions: 24 wall, 36 mine, 45 WT3, 67 pile, 89 c_rt, 103 river, 140 ROBS, 182 fortress, 216 rt, 267 trolley, 330 rail [verified: LEVELS_GUIDE §5]).

## Architecture
No code architecture beyond: census as single source of truth feeding (1) import classification, (2) LEVELS_GUIDE tracker (generator output pasted between markers, checked by `check:docs`), (3) owner-pass section A. Workflow sharding reuses SP01 `--shard i/n`. A small `tools/src/census` addition may emit `first-position-per-feature` and a markdown tracker block (extension to 01's script, owned by 09 once SP01 merged).

## Decisions
| # | Topic | Chosen | Alternative | Why |
|---|---|---|---|---|
| 1 | Tuning imported levels | Un-tuned; allowlist instead | Per-level override sweep | Fidelity; owner decides difficulty later |
| 2 | Campaign smoke | Sample in PR, full nightly | All 337 in PR | 337 x 5 s ≈ 28 min + screenshots |
| 3 | Bundle budget gate | OUT, record numbers | Add gate | Lazy levels already remove the main risk |
| 4 | Tracker | Generated block | Hand-edited | Census drift was the original problem |
| 5 | Golden per mechanic | One small scenario each | Rely on level locks | Locks fail opaquely; goldens localise |
| 6 | Final lock refresh | One bulk commit | Per SP | Avoids lock merge conflicts |

## Manual steps (owner)
- Provide `TW_EXTRACT` (rebuilt) for census/import/assets; run `owner-pass.md`; decide P2 gaps; sign off unsolved rows (`ownerSignOff`).

## Risks / Open Questions
- [OPEN P1] Which of the 12 prefab-only ids are <=340, and can their ext files be reconstructed (UnityPy needed on the machine)? Only 2 exist today.
- [OPEN P2] Accept a sparse campaign (gaps) vs insist on contiguous prefix? Importer today ends the prefix at a blocked row unless `--skip-blocked`.
- [OPEN G1] PR subset sample rate and nightly shard count after real timing.
- [OPEN G2] Unsolved fraction threshold that triggers "improve proxy" instead of allowlisting.
- [OPEN G3] Bench budgets for projectile/rocket-heavy levels.
- [OPEN W1] Bundle regression threshold; gate stays OUT.
- [DEFERRED] Boosters, rage, tutorials 1-3, boss/Draw-only levels, cargo, PvP, meta, skins.
- [RESOLVED: locked] Unsolved levels allowed with reason; `ownerSignOff: null`; owner spot-checks sample.
- Risk: later SPs change versions/locks after 09 starts; 09 final sweep runs after all rebases, version-chain check catches drift.
- Risk: cross-Node hash drift on new mechanics; nightly runs Node 22 and 24.

## Acceptance Criteria
- Census 4-340: every position imported, or listed in LEVELS_GUIDE with class and reason; class (a) = 0.
- `pnpm run ci` green on Node 22 and 24; `validate:levels --all` green or only allowlisted; `levels-lock.json` hashes identical across Node versions; `PARKED` empty; `check:docs`, `check:rules`, `check:manifest` green.
- `RULES_VERSION` 3.7.0, `BOT_VERSION` 2.7.0 (or documented renumber), content hash matches lock.
- `campaign:verify --sample` green; nightly `--all` green; picker/save at 337 verified.
- Docs: tracker generated, deviations ledger complete, FUTURES pruned, README/AGENTS/tools README current, CREDITS audit 0 warnings.
- `owner-pass.md` written with concrete positions; unsolved rows all listed.
