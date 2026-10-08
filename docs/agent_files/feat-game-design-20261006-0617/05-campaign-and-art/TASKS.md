---
status: draft
summary: 14 tasks: tower variants, targets, greybox L1-5+L10, art/audio/CREDITS, slice L1/L10/L18, then bands 1-4 tuned, final acceptance
date: 2026-10-08
---
# Tasks: Campaign + Art (SP05)
Source of truth: docs/agent_files/feat-game-design-20261006-0617/05-campaign-and-art/PRD.md. Data and asset work only (JSON levels, archetype variants, balance targets, manifest content, models/audio, CREDITS.md); no new mechanics, no `overrides`. Follows PRD phasing: greybox, owner playtest, slice, remaining 17 in band order. Depends on SP01-SP04 (e.g. "SP03 T3" = SP03 Task 3).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | `small` / `large` archetype variants | SP01 T5, SP01 T10 | todo |
| 2 | Balance targets + `human-proxy` values | SP04 T5, SP04 T12 | todo |
| 3 | Optional symmetry layout helper | SP01 T7 | todo |
| 4 | Greybox L1-L5 + L10 draft | T1, T2, SP01 T10, SP02 T6, SP03 T3, SP03 T4, SP04 T11 | todo |
| 5 | Greybox tuning pass | T4, owner: greybox playtest + sign-off | todo |
| 6 | Art import: buildings, characters, team colour | T5, SP03 T3, SP03 T6, SP03 T8, SP03 T9 | todo |
| 7 | Palettes + 4 themes in manifest | T6, SP03 T7, SP03 T14 | todo |
| 8 | Audio (CC0) + `docs/CREDITS.md` | T6, SP03 T13, SP04 T9 | todo |
| 9 | Slice levels L1, L10, L18 | T5, T6, T7, T8 | todo |
| 10 | Slice verification (labels, colourblind, 60 fps) | T9, SP03 T14, SP03 T15 | todo |
| 11 | Band 1 (L2-L5 final) | T10, owner: slice sign-off | todo |
| 12 | Band 2 (L6-L9, L10 re-check) | T11, owner: band 1 playtest | todo |
| 13 | Band 3 (L11-L15) | T12, owner: band 2 playtest | todo |
| 14 | Band 4 (L16, L17, L19, L20) + acceptance sweep | T13, owner: band 3 playtest | todo |

## Task 1 — `small` / `large` archetype variants
What it is / what it means: Decision 1: tower variety via data variants of the one tower, no new components. SP01 hosts the files; SP05 owns values.
What changes at a high level: Author `small` (cap 20, rate 0.6, thresholds [10], up to 2 slots) and `large` (cap 80, rate 1.5, thresholds [10,30], 3 slots) as `extends standard` with param changes only, including `drawsLines.extraSlotAbove` per the accepted SP01 ask; footprint radius scales with size. Numbers are starting guesses (DEFERRED to greybox tuning). Visual keys map to low shop / skyscraper.
Done when: Both archetypes pass `validate:content`; `extends` changes no component set; `content:lock` updated.

## Task 2 — Balance targets + `human-proxy` values
What it is / what it means: Requirement 5, Decision 7: per-band numeric targets so out-of-range levels are flagged by the runner.
What changes at a high level: Fill `tools/balance-targets.json` (SP04 schema) with the acceptance table per band (reference wins, human-proxy wins, timeout %, idle wins; 200 seeds). Set the `human-proxy` skill block values on the SP04 profile (reference plus slower skill). Tier ids `easy|normal|hard|expert`. Values are guesses until greybox.
Done when: Targets file validates against SP04 schema; `balance` reads it and reports per-band pass/fail on a sample level.

## Task 3 — Optional symmetry layout helper
What it is / what it means: Decision 3: hand JSON stays source of truth; helper only saves time on 3-4 seat maps.
What changes at a high level: Small `tools/layout` script taking half a map plus symmetry (`mirror|rot3|rot4`) and emitting level JSON that is committed. No runtime or schema coupling.
Done when: Emitted mirror/rot3/rot4 output validates via `validate:content`; skippable if levels are hand-written (no downstream task requires it).

## Task 4 — Greybox L1-L5 + L10 draft
What it is / what it means: Phase 1: real rules, primitives, 1 bot, to judge feel and numbers before art.
What changes at a high level: Hand-author `01..05-*.json` and a draft `10-*.json` per the campaign table (towers, bot profile `<personality>-<tier>`, limit, map shape; bounds 120x80; no `overrides`; only archetypes from their intro level). Follow layout guidelines (>=18 u spacing, 20-90 u lines, no collinear triples, garrisons <= cap/2, neutral 8-25). Use greybox manifest primitives.
Done when: Each passes `validate:content`, `validate:levels --seeds 4`, `check:manifest`; playable in the web client for the owner.

## Task 5 — Greybox tuning pass
What it is / what it means: Phase 2: apply owner playtest feedback; resolves DEFERRED guesses (variant stats, tier values, thresholds, 120x80 and 18 u sufficiency, FFA bot aggression).
What changes at a high level: Adjust garrisons, positions, archetype params, tiers, targets in data only; run `balance --proxy reference,human-proxy --seeds 200` on L1-L5, L10; log changes in the campaign tuning note; `content:lock`; commit per level or small batch. Test L18 spacing/label legibility early with a draft layout and note findings.
Done when: Greybox levels in band targets or waived with a logged reason; owner has signed off feel and numbers (gate to slice).

## Task 6 — Art import: buildings, characters, team colour
What it is / what it means: Decision 5, Art section: Kenney City Kit (Commercial, Roads) and Mini Characters, all [RESOLVED] import-time checks.
What changes at a high level: Download packs, re-verify CC0 on each pack page at download time. Process via gltf-transform (meshopt, dedupe, texture resize) within budgets (troop <= 300 tris, tower <= 5k, texture <= 1024^2). Check building tris and whether the colormap material is splittable; primary team colour is the tinted base plate + roof marker, `teamMaterial` only if a split works. Characters: `bob` anim; shirt via `teamMaterial`/`tint`. Character fallback order if over budget: decimate, capsule primitive troop, Quaternius UAL. Map to standard/small/large keys in manifest content.
Done when: Models under `apps/web/assets/models/` pass `check:manifest` budgets; team colour readable; fallback choices (if any) recorded.

## Task 7 — Palettes + 4 themes in manifest
What it is / what it means: Requirement 7, Decision 6: variety through themes, not assets.
What changes at a high level: Add default and Okabe-Ito colourblind palettes (every key in both) and `teamMarkers` (circle/triangle/square/diamond). Define `city.day|dusk|overcast|night` (ground tint, light, fog, props from Roads kit) with the shared palette material; set `level.visual` per band when levels are finalised.
Done when: Manifest validates; both palettes complete; all four themes render the same models; swapping models via manifest only (back to primitives) works with zero code change.

## Task 8 — Audio (CC0) + `docs/CREDITS.md`
What it is / what it means: [RESOLVED]: agents pick CC0 audio; owner may swap at slice sign-off.
What changes at a high level: Select Kenney UI Audio plus Impact/Interface Sounds SFX (clash, capture, cut, UI) and one looping CC0 music track (Kenney Jingles or CC0-filtered OpenGameArt). Verify licence at download; keep licence text under `assets/licenses/`. Create `docs/CREDITS.md` with a row per shipped file (file, pack, author, URL, licence, date, modifications), including models from T6. Music lazy-loaded; wire into manifest audio keys.
Done when: `check:manifest` fails on a missing CREDITS row and passes now; no non-CC0 asset in repo; initial load <= ~10 MB.

## Task 9 — Slice levels L1, L10, L18
What it is / what it means: Phase 3, Decision 8: slice spans easy/open, mid 2-bot, densest 3-bot (label and perf stress).
What changes at a high level: Finalise L1 and L10 with Kenney art, themes, audio; author L18 (14 towers, 3 mixed-expert bots, 4-fold rotational via helper or by hand, limit 360, `city.night`). Tune with `balance`; L18 band-4 rule is >= K-1 seeds or a committed agent-authored winning command list replayed via `runMatch` in CI.
Done when: All three validate and pass runner targets or logged waivers; FFA bot-kill-speed checked and bot aggression tuned if needed.

## Task 10 — Slice verification (labels, colourblind, 60 fps)
What it is / what it means: Acceptance 7: evidence for the owner's slice approval.
What changes at a high level: Capture screenshots of L1, L10, L18 (default and colourblind palettes); check count-label chips >= 14 px at 1080p laptop, glyph/palette distinctness; record SP03 perf HUD on L18.
Done when: Screenshots and 60 fps result attached to the tuning note, ready for owner review.

## Task 11 — Band 1 (L2-L5 final)
What it is / what it means: Phase 4, band 1 (Rookie, day).
What changes at a high level: Convert greybox L2-L5 to final art/theme `city.day`; tune with `balance` to band-1 targets (reference 100%, human-proxy >= 90%, idle 0); bands 1-3 must win all K seeds in `validate:levels`; `content:lock`; commit per level or batch.
Done when: L1-L5 validate and meet targets or have logged waivers; ready for owner band playtest (B1 first try).

## Task 12 — Band 2 (L6-L9, L10 re-check)
What it is / what it means: Band 2 (Skirmish, dusk): first `small` towers (L6), first `large` + 3rd slot (L7), fork, chain, two-bot.
What changes at a high level: Author L6-L9 per the table and re-check L10 against band-2 targets (reference >= 98%, human-proxy 65-85%, timeout <= 5%); no variant before its intro level.
Done when: Validators green; runner within targets or waived; ready for owner playtest.

## Task 13 — Band 3 (L11-L15)
What it is / what it means: Band 3 (Rivals, overcast): 3-fold rotational L11, asymmetric underdog L12, crossing lanes, clock, contested `large` hub.
What changes at a high level: Author L11-L15; bot start-garrison sums within +-10%; targets reference >= 90%, human-proxy 40-65%, timeout <= 8%.
Done when: Validators green (all K seeds); runner within targets or waived; ready for owner playtest.

## Task 14 — Band 4 (L16, L17, L19, L20) + acceptance sweep
What it is / what it means: Band 4 (Warlords, night) plus the PRD acceptance criteria 1-6.
What changes at a high level: Author L16, L17, L19, L20 (L20 irregular near-symmetric, 3 mixed-expert bots, limit 360) to targets reference >= 80%, human-proxy 20-45%, timeout <= 10%; commit agent-authored solution replays where a level fails K-1. Then sweep: table vs files (towers, bots, limit, focus), contiguous `order` 1-20 as 4x5, no `overrides`, only the three archetypes, balance report with all waivers logged, CREDITS complete, manifest-only reskin check.
Done when: All 20 pass the three checks and the sweep; ready for owner final sign-off.

## Manual steps (owner)
1. Greybox playtest: sign off feel and rule/balance numbers (gates T6 onward; T5 consumes feedback).
2. Slice approval: look, prominence, colourblind palette; may swap music/SFX picks (gates T11).
3. Per-band playtest sign-off (<= 3 attempts median; B1 first try, B4 ~5; none unwinnable/autopilot) after T11, T12, T13, T14 respectively; each gates the next band.
4. Final campaign sign-off: all 20 completable, difficulty ramp.
