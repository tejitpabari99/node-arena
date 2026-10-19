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

## Task 3 — Bot enforcement of commitment

Params: PRD defaults as committed in Task 2 (personalities `{8, 0.7, 0.15, 10, 0.05, 3, 1}`, reference/human-proxy `{4, 0.7, 0.08, 6, 0.03, 2, 1}`); BOT_VERSION 1.1.0 -> 1.2.0. Baseline (v1): cuts 17.175, draws 25.176, cut-redraw 14.19, slot-cuts 0.364, flips 15.622 /min. No-commitment check (final code): with `commitment` stripped from every profile, all 160 baseline matches reproduce exactly (finalHash + ticks, `runChurnMatch`, frozen seed set). Comparison point for each iter = last green state (iter 1).

| iter | date | commit | change | cuts/min | draws/min | cut-redraw/min total (vs base); player/slots/captured/replaced | slot-cuts/min | flips/min | top gaps | decision |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-10-19 | Task 3 commit (final state) | enforcement: line age (first-seen per drawSeq), lifetime lock + danger override, cut margin vs keepScore = max(noise-free attack, reinforce), redraw block (own cut, own reverse replacement, detected slot-cut), tie hysteresis, slot guard, slot pre-empt; a reverse draw obeys the replaced line's lifetime lock | 1.233 (-92.8%) | 7.611 | 2.532 (-82.2%); 0 / 0.002 / 1.421 / 1.109 | 0.122 (-66.5%) | 3.149 (-79.8%) | `replaced` direction flips (turtle-normal 6.22/min); `captured` 1.42; seat-minutes 478 -> 631 (longer matches) | green (bots 87/87, tools 47/47, content 260/260); keep; try replacement margin |
| 2 | 2026-10-19 | none (reverted) | reverse replacement also needs noise-free draw - keepScore(reverse) >= `cutMargin` | 1.805 | 8.618 | 2.681 (-81.1%); 0 / 0 / 2.56 / 0.121 | 0.101 | 3.9 | replaced fixed but captured up | cuts and total worse -> revert |
| 3 | 2026-10-19 | none (reverted) | replacement margin = `tieHysteresis` | 0.929 | 6.911 | 2.297 (-83.8%); 0 / 0.002 / 2.13 / 0.165 | 0.112 | 2.785 | metrics all better than iter 1, **but tools test `CLI runs content validation...` red**: reference (human seat) wins 0/4 on `sample` (all timeouts). Confirmed cause: disabling only the replacement margin restores 4/4 | red -> revert |
| 4 | 2026-10-19 | none (reverted) | approach switch: keepScore = line's own purpose (reinforce if target own team, else attack) + iter-3 replacement margin | 4.933 | 10.727 | 2.202 (-84.5%); 0 / 0 / 1.931 / 0.272 | 0.086 | 3.55 | sample 4/4 again; seat-minutes 475 (≈ v1 match length); cuts/min 4x iter 1 | cuts/min worse than iter 1 -> revert (keepScore = best of attack/reinforce is the PRD RESOLVED definition) |
| 5 | 2026-10-19 | none (reverted) | keepScore back to max; replacement margin compares reinforce(s,t) - reinforce(t,s) >= `tieHysteresis` | 1.217 | 7.642 | 2.581 (-81.8%); 0 / 0.003 / 2.279 / 0.299 | 0.108 | 3.218 | sample 4/4; replaced 1.109 -> 0.299 but total +0.05 (captured noise) | total worse -> revert. Stuck rule: iters 2-5 failed to beat iter 1 -> stop; Task 3 targets met at iter 1 -> exit |

Task 3 exit (iter 1 code): all Task 3 targets below baseline (total cut-redraw -82.2%, slot-cuts -66.5%, bot cuts -92.8%); no-commitment path identical to v1; sim and GAME_RULES diff empty; typecheck, lint, `replay:verify golden` (14/14), `sim:golden` (11), `check:content --base HEAD` pass; tests bots 87/87, tools 47/47, content 260/260. Golden: `bots:golden --update` at BOT_VERSION 1.2.0 (command logs shrink 40/8/11 -> 7/5/7 commands; final hashes change).

Hand-off to Task 5 (not Task 3 gates, measured on iter 1 code):
- `pnpm balance`: PASS (exit 0), 63 rows, 43 flagged (reference 12, human-proxy 15, idle 16; v1 flag count not measured here). Reference win rates drop in 3-4 player levels (e.g. 11-triple-threat 13.5%, 18-free-for-all 34%).
- `pnpm validate:levels`: FAIL, 7 errors: reference wins short on 11, 13, 14, 15, 18, 19; 18-free-for-all solution replay has 1 rejected command at tick 515.
- Hypotheses: (a) commitment on reference/human-proxy weakens the human-seat proxy (drift rule: lower its `minLineLifetimeSec`/`cutMargin` first); (b) keepScore = max(attack, reinforce) makes cuts nearly impossible (attack bias > cut bias), lengthening matches (iter 4: purpose keepScore restored v1 match length); (c) remaining churn is ~56% `captured` and ~44% `replaced`; replacement margin (iters 3/5) removes most `replaced` flips but iter 3 broke `sample` for reference.

## Task 4 — Commitment unit tests

New file `packages/bots/test/commitment.test.cjs` (12 tests; R1, R1b, R2, R3 x3, R4, R5 x2, R8/R6, R12, R13). Each test pairs the committed behaviour with a control where only that rule's param is neutral. Sensitivity was also checked by mutating `dist/utility.js` (16 mutants, one rule disabled at a time; dist restored and verified byte-identical afterwards).

| iter | date | commit | tests added / passing | gaps | decision |
|---|---|---|---|---|---|
| 1 | 2026-10-19 | none (draft) | 12 added; commitment 12/12, bots 99/99 | mutants 15/16 killed. Survivor: removing the reverse-replacement redraw stamp (R3), because the replacement test only checked the lifetime lock | extend the test |
| 2 | 2026-10-19 | Task 4 commit | R3 replacement test now also checks that flip-back t1->t0 is blocked until LIFE+BLOCK (neutral control: flip-back right after the new line's lock ends); commitment 12/12; bots 99/99 on two consecutive runs (deterministic) | mutants 16/16 killed: lifetime, dangerOverride off, dangerOverride global (not per source), cutMargin, redraw block, slot-cut detection, capture-no-block, slot guard, pre-empt, pre-empt lowest-keepScore, tie hysteresis, age cleanup, per-match reset, reverse-line lock, own-cut stamp, replacement stamp. R8 v1-equivalence (160 baseline matches with commitment stripped) asserts its own sensitivity (`differs > 0`) | done. Exit |
