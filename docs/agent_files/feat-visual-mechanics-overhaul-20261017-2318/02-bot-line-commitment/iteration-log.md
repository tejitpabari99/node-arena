---
status: in-progress
summary: SP02 iteration log - churn metric rows (baseline first), per-task iteration rows
date: 2026-10-18
---
# Iteration log: Bot Line Commitment (SP02)

Metric: `pnpm bots:churn` (`packages/bots/scripts/churn.mjs`), 20 campaign levels x fixed seeds `[1,2,3,5,8,13,37,704]`; human seat played by `human-proxy`; headline = `totals.bots` (authored level bot seats), rates per seat-minute of match time. cut-redraw = same seat redraws the same unordered pair <= 10 s after its line was removed (any LineCut reason, split by reason); flips = same, <= 20 s. `replaced` removals are own reverse-line replacements (R-LIN-03), i.e. same-tick direction flips. Baseline: `packages/bots/churn-baseline-v1.json` (BOT_VERSION 1.0.7, content 1.1.5, rules 1.0.0).

## Task 1 — Churn tool + committed v1 baseline

| iter | date | commit | params | cuts/min | draws/min | cut-redraw/min (total; player/slots/captured/replaced) | flips/min | notes |
|---|---|---|---|---|---|---|---|---|
| 0 | 2026-10-18 | bot code f009317 (unmodified); tool in Task 1 commit | none (v1) | 17.175 | 25.176 | 14.19 (9.504 / 0.125 / 1.609 / 2.951) | 15.622 | **Baseline.** slot-cuts/min 0.364. LineCut/min by reason: player 17.175, slots 0.364, captured 3.57, replaced 2.951. allSeats (incl. human-proxy): cuts 14.88, draws 22.966, cut-redraw 10.596, flips 11.853. Worst: 16-fortress (cut-redraw 45.6/min), turtle-expert profile (39.3/min). |
| 1 | 2026-10-18 | Task 1 commit | none | 17.175 | 25.176 | 14.19 | 15.622 | Self-check: root `pnpm bots:churn --out A` and `pnpm --filter @node-arena/bots bots:churn --out B` byte-identical (`cmp` OK); third fresh run written as baseline, identical to A. Pair direction (a->b vs b->a = one pair), per-seat attribution, one-redraw-per-removal, 10 s/20 s windows and per-minute normalisation covered by `test/churn.test.cjs`; churn loop finalHash/ticks equal `runMatch` (events on do not alter the match). Consistency: LineCut player/min == bot CutLine cmds/min (17.175). Tool fix during build: relative `--out` resolved against `INIT_CWD` (pnpm --filter runs in package dir). No metric bugs found; exit. |

## Task 2 — Commitment params: schema, profiles, versions

| iter | date | commit | params | check results | churn vs baseline | notes |
|---|---|---|---|---|---|---|
| 1 | 2026-10-19 | Task 2 commit | rusher/turtle/economist/opportunist: `{minLineLifetimeSec 8, dangerOverride 0.7, cutMargin 0.15, redrawBlockSec 10, tieHysteresis 0.05, slotGuardMargin 3, slotPreemptMargin 1}`; reference (milder; human-proxy inherits): `{4, 0.7, 0.08, 6, 0.03, 2, 1}`; idle/sample-bot: none | `content:schemas` + `content:lock` regenerated (stable on rerun); `check:schemas`, `check:content --base HEAD`, `validate:content --base HEAD`, `typecheck`, `lint`, `replay:verify golden` (14/14) pass; tests content 260/260, bots 87/87, tools 47/47; `bots:golden` verified at BOT_VERSION 1.1.0 | identical (only `botVersion` header differs): cuts 17.175, draws 25.176, cut-redraw 14.19, flips 15.622 /min | Params not yet consumed. Variants carrying `commitment` rejected by JSON schema and semantic resolution (tests). BOT_VERSION 1.0.7 -> 1.1.0. contentVersion **not** bumped: level sim hashes unchanged (only bot hashes), and CONTENT_GUIDE/`checkContentVersion` tie contentVersion to level hashes; a bump would stale sim golden + tools/solutions replay metadata (out of scope). Bot golden diff = botVersion, botHash, embedded profile `commitment`; command logs/final hashes unchanged. Exit after 1 iter. |
