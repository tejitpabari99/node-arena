---
status: draft
summary: Branch index for feat-game-design — Node Arena v1 split into 5 sub-project PRDs (rules/content model, sim, web client, bots/tools, campaign/art), locked decisions, consolidated open questions
date: 2026-10-07
---
# feat-game-design — Node Arena v1 (branch index)

Persistent-route tower-war browser game; v1 = rules spec + deterministic engine + 20-level solo campaign vs data-driven bots, local only. Everything tunable or visual is data.

## Sub-projects
| # | Folder | Title | Phase | Depends on | Owns (packages/files) | Status |
|---|---|---|---|---|---|---|
| 01 | [01-rules-and-content-model](01-rules-and-content-model/PRD.md) | Rules + data-driven content model | P0 foundation | none | `docs/GAME_RULES.md`, `docs/CONTENT_GUIDE.md`, `packages/content/**` (schemas, registry, loader/compiler, hashing, validator; data `balance`, `troops`, `archetypes/{standard,small,large}`; hosts bot + manifest schemas) | done (review PASS) |
| 02 | [02-sim-engine](02-sim-engine/PRD.md) | Deterministic sim engine | P1 engine | 01 | `packages/sim/**`, golden replays, `eslint.determinism.cjs`, `bench:sim` | done (review PASS) |
| 03 | [03-web-client](03-web-client/PRD.md) | Web client | P2 greybox playable | 01, 02 | `apps/web/**`, `apps/web/assets/manifest.json` (file) + loader, `validateManifest()` | done (review PASS) |
| 04 | [04-bots-and-tools](04-bots-and-tools/PRD.md) | Bots + tools | P2 (parallel with 03) | 01, 02 | `packages/bots/**`, `packages/content/src/bot-params.ts` + `data/bots/*.json`, `tools/**` (CLIs, CI workflow) | done (review PASS) |
| 05 | [05-campaign-and-art](05-campaign-and-art/PRD.md) | Campaign + art | P3 slice then full | 01-04 | `packages/content/data/levels/01..20-*.json`, `small`/`large` values, `tools/balance-targets.json` values, `tools/layout/`, manifest art entries, `apps/web/assets/{models,audio}/`, `docs/CREDITS.md` | done (review PASS; owner playtest pending) |

## Dependency graph
```
01 rules + content model
  |
  v
02 sim engine
  |------------------+
  v                  v
03 web client     04 bots + tools
  |                  |
  +--------+---------+
           v
05 campaign + art   (greybox L1-5 + L10 can start once 03 + 04 run)
```

## Locked decisions (initiative-wide)
Brief (see [brainstorm.md](brainstorm.md) decision log):
- Laptop browser, TypeScript + Three.js, monorepo `sim / content / web / tools` (+ `bots`), local only, no ads/payments, free CC0 assets (Kenney family), low-poly modern city.
- Rules: persistent lines, send = generation, slots 1 (>10 = 2, >30 = 3), capacity cap, neutrals garrison only, 1-for-1 combat, capture at 0, head-on clash only, win/lose + 5 min default limit.
- Fixed 20 Hz tick, seeded PRNG, no Math.random/Date or fractional rule computations in sim; player and bots use identical commands.
- 20 authored levels, 4 bands, all selectable, completed/not only; bots utility-AI with difficulty via `skill` only; pause + 1x/2x.
- `GAME_RULES.md` = mechanics (rule IDs `R-AREA-NN`, every ID tested); JSON = numbers; code does nothing rules do not state. v2 archer/tank only documented in v1.

New (this design pass):
- **Data-driven content model**: towers = archetypes of components + params (`garrison`, `generates`, `drawsLines`, `capturable`); troops = typed param bags; unknown component/kind/field = hard error. Variants via `extends` (depth 1, param changes only).
- **Fixed-point int data**: decimals <= 3 places authored, int32 after load; integer accumulators; progress unit milli x tickRate; all rule math is integer. Float64 statistics store exact safe integers and are excluded from rule state/hash.
- **TypeBox + Ajv** schemas, committed generated JSON Schemas; `loadContent`/`validateContent`/`compileLevel` browser-safe (`fileMap` in, no fs).
- **Compiled `CompiledLevel`** (dense sorted indices, team per player, resolved bots) is the only sim input; `simHash` over resolved sim-relevant content (presentation excluded), `botHash` separate, `hashes.lock.json`, versioned `rules/schema/contentVersion`.
- **Visual keys + web manifest**: content holds keys only; `apps/web/assets/manifest.json` maps keys to models/materials/palettes/themes/fx/sfx; schema lives in content, `check:manifest` in tools; reskin = manifest edit.
- **Bot profiles as data**: personalities x tier (`easy|normal|hard|expert`) as 3-line `extends` files; tooling profiles `reference`, `human-proxy`, `idle`; bots live in `packages/bots`, see only what the player sees.
- **`obstacles[]` / `mapObjects[]` reserved**: schema accepts, v1 validator rejects non-empty. **v2 archer/tank = new component/system + data**, no schema redesign.
- Lazy analytic troop movement in sim; renderer extrapolates; manifest-driven generic renderer (no archetype ids in code).

## Risks / Open Questions (consolidated; all items resolved/deferred 2026-10-08, see in-PRD markers)
### Owner-only: needs user decision or playtest
- SP01/SP02: confirm R-CAP semantics (at cap with a drawn line the tower keeps sending; no banked accumulator) vs brief wording, at greybox. RESOLVED (user): at cap with a line keeps sending at generation rate; no line stops.
- SP02: capture at exactly 0 count flips to hitter with 0 garrison; playtest if punishing. RESOLVED (user): flips to hitter with 0 garrison.
- SP01: map unit scale (120x80, tower radius ~3) tune in greybox. DEFERRED: start 120x80, radius ~3; tune at greybox.
- SP04: balance bands and tier values are guesses until SP05 playtests. DEFERRED: tune at SP05 playtest.
- SP04: can generic `reference` bot meet per-band rule (bands 1-3 all K, band 4 >= K-1 else solution replay)? Decide after greybox; incl. how solution replays are recorded. RESOLVED (user): bands 1-3 all K, band 4 >= K-1 else agent-scripted command list replayed via runMatch in CI; no owner replays.
- SP03: real-GPU laptop check of 2,000 bobbing troops at 60 fps; label readability on dense levels; fixed camera vs large levels (add zoom?). RESOLVED: run spike first (fallbacks listed); DEFERRED: label readability + camera, check at greybox, zoom only if L18 unreadable.
- SP05: all numbers (tower variants, tier skill, thresholds) are guesses until playtest; FFA 3-bot balance; 120x80 + 18 u spacing on L18. DEFERRED: all to greybox playtest.
- SP05: pick music track and clash/capture SFX; licence verification at download. RESOLVED: agents pick CC0 audio, verify licence, record in docs/CREDITS.md; user may swap at slice sign-off.
- SP05 manual: greybox, slice (L1, L10, L18) and per-band/final sign-offs.

### Technical (agents can resolve via spike/measurement)
- SP01: TypeBox vs zod (spike on first schema file; default TypeBox). RESOLVED: TypeBox, switch only if spike fails.
- SP01: fixed-point scale 1000 sufficient? (SP02 says yes; spike confirms; may widen internal factor only). RESOLVED: keep scale 1000; SP02 spike may widen internal factor only.
- SP01: per-tower send-rate param possibly wanted in v2 (v1 omits). DEFERRED: v2.
- SP02: friendly/mixed front pass-through during head-on clash simplified; revisit for v4. DEFERRED: v4.
- SP02: fixed-point spike result may change internal factor (low risk). RESOLVED: follows SP01 spike.
- SP02: event volume at 2x and `events:false` bypass for balance runner; measure. RESOLVED: measure in SP02 bench; balance runner uses events:false.
- SP03: instanced troop spike (fallback static-bob/no-bob or VAT). RESOLVED: run as first renderer task.
- SP03: GLB team recolour via `teamMask` with chosen pack (fallback atlas/base plate). RESOLVED: base plate + roof marker default; teamMask only if split works.
- SP03: Playwright software-GL screenshot stability (fallback structural asserts). RESOLVED: try screenshots, fall back if flaky.
- SP03: extrapolated front may overshoot clash point < 1 tick; clamp if visible. DEFERRED: clamp only if visible at greybox.
- SP04: consideration set sufficiency (`clashPotential` maybe). DEFERRED: add via data+registry after greybox if needed.
- SP04: per-decision cost at v6 scale; re-bench. DEFERRED: v6; maxTargetsPerSource pruning.
- SP05: Kenney building tris <= 5k and splittable team material (fallback base plate). RESOLVED: check on import.
- SP05: Mini Characters tris vs 300 budget (fallback decimate, capsule, Quaternius). RESOLVED: check on import; fallback order decimate, capsule, Quaternius.

Folded this pass: SP05 asks accepted (SP01 hosts `small`/`large`, `extends` may change any component param incl. `extraSlotAbove`, no adding/removing components; campaign uses no `overrides`; SP04 `human-proxy` + tier names; band-4 rule).

## Links
- [SP03 independent re-review](03-web-client/review-2026-10-09-2000.md) — PASS; CI + full web e2e re-run green, AC6 real-GPU check owner-deferred.
- [SP04 independent re-review](04-bots-and-tools/review-2026-10-09-2000.md) — PASS; 15/15 gates, 656 tests re-run green, remote CI owner-deferred.
- [SP04 final code run](04-bots-and-tools/code-2026-10-09-1759.md) — all 14 tasks accepted; 656 tests/15 CI gates, strict bot performance, durable browser failure/retry and local nightly reports.
- [SP04 latest PASS review](04-bots-and-tools/review-2026-10-09-1759.md) — three independent personas; disabled-suite coverage finding resolved and CI configuration unchanged.
- [SP04 original NEEDS_CHANGES review](04-bots-and-tools/review-2026-10-09-1752.md) — retained history; confirmed skipped-suite finding corrected.
- [SP03 correction validation](03-web-client/code-2026-10-09-1627.md) — 518 units, final preview/dev PASS; preserved CPU-load failures and owner GPU check.
- [SP03 latest PASS review](03-web-client/review-2026-10-09-1628.md) — all three personas pass the four corrections and pose-cache follow-up.
- [SP03 original NEEDS_CHANGES review](03-web-client/review-2026-10-08-2250.md) — retained history; all four findings resolved.
- [SP02 implementation run](02-sim-engine/code-2026-10-08-1349.md) — all 13 tasks done; final review PASS.
- [SP02 performance report](02-sim-engine/code-2026-10-08-1516.md) — sustained workload and event-volume measurements.
- [SP02 original BLOCK review](02-sim-engine/review-2026-10-08-1529.md) — historical numeric boundary findings, both resolved.
- [SP02 latest PASS review](02-sim-engine/review-2026-10-08-1539.md) — PASS across all three personas.
- [SP01 implementation run](01-rules-and-content-model/code-2026-10-08-0528.md) — original 12-task run, retained as history.
- [SP01 review-fix run](01-rules-and-content-model/code-2026-10-08-0539.md) — Task 3 fix complete; 222 tests passed; all 12 tasks done.
- [SP01 original review](01-rules-and-content-model/review-2026-10-08-0533.md) — historical NEEDS_CHANGES: fixed-point underflow.
- [SP01 latest review](01-rules-and-content-model/review-2026-10-08-0539.md) — PASS across all three personas; original finding resolved.
- [brainstorm.md](brainstorm.md)
- Research (relative to repo root): `docs/research/initial_research/engine-research.md`, `docs/research/initial_research/similar-games.md`, `docs/research/initial_research/mechanics-research.md`, `docs/research/initial_research/gamedev-best-practices.md`
- PRDs: [01](01-rules-and-content-model/PRD.md), [02](02-sim-engine/PRD.md), [03](03-web-client/PRD.md), [04](04-bots-and-tools/PRD.md), [05](05-campaign-and-art/PRD.md)

## Next step
Authorized SP03 and SP04 software work and independent reviews are complete with PASS. Stop this implementation run here: SP05 is implemented and reviewed (PASS); no push was performed. Remaining items are owner-only: final playtest of the 20 levels, `pnpm slice:verify` on a real GPU, browser e2e suites, first GitHub Actions run, music licence page re-check. Owner-only real-GPU laptop 60 fps/readability checks and observation of remote GitHub Actions remain pending. Browser coverage limitations and preserved failures are recorded in the SP04 final code run; automated SwiftShader checks do not establish laptop GPU performance.
- [Final whole-branch review](review-2026-10-15-final.md) — PASS (SP01–SP05, re-review of fixes + CI green).
