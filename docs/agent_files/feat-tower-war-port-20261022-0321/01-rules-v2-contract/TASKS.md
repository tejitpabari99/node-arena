---
status: draft
summary: 10 tasks to rewrite GAME_RULES.md as the Tower War v2.0.0 contract (38 ids, 5 tombstones) and bump the two version strings once for the branch.
date: 2026-10-22
---
# Tasks: Rules v2 contract (SP01)
Source of truth: [PRD.md](PRD.md). Doc-only sub-project: full rewrite of `docs/GAME_RULES.md` plus the two version strings (`RULES_VERSION`, content `rulesVersion`). No sim, content-schema, bot or test edits. Runs after 09 Phase A (task 0).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Doc skeleton, header, terms, id policy | 09#0 | done |
| 2 | Tick/determinism rules, phase table, commands, hash surface | 1 | done |
| 3 | Entity, spawn, growth rules | 2 | done |
| 4 | Line, capture, win rules | 3 | done |
| 5 | Combat, tower, obstacle rules | 4 | done |
| 6 | Reserved-module table and deferred boosters | 5 | done |
| 7 | Param glossary (section 7) | 5 | done |
| 8 | Worked examples, contradiction table, changelog | 6, 7 | done |
| 9 | Bump version strings to 2.0.0 | 1, 09#0 | done |
| 10 | Verify against check:rules and acceptance list | 8, 9 | done |

## Task 1 — Doc skeleton, header, terms, id policy
What it is / what it means: Replace v1 `GAME_RULES.md` with the v2 shape so `tools/src/rules.ts` parses it unchanged (PRD R1, R2, Decisions 1, 4).
What changes at a high level: Header with exact `RULES_VERSION: 2.0.0` line; sections 1-8 in order; heading pattern `### R-AREA-NN`; per-rule fields (statement, `Params:`, `Examples:`, `Since: 2.0.0`, optional `Supersedes:`); terms (building, building level, line, troop, stage with thresholds 10/30); id policy (rewritten topic keeps id, dead topic tombstoned, never reused); tombstones GEN-01, GEN-02, SND-01, SND-02, CAP-02. "Rules own structure and formulas; numbers live in content" stated up front.
Done when: skeleton parses with the right header and tombstone list; no v1 profile or compat language remains.

## Task 2 — Tick/determinism rules, phase table, commands, hash surface
What it is / what it means: The TCK area and the cross-cutting contracts every sim phase relies on (R3, R4 TCK rows, R5, R6, R7).
What changes at a high level: TCK-01..06 including the milli-tick translation (timer += 1000, fire at >= current period, remainder carried, at most one fire per tick, period clamped >= 1000, floor division, range checks below 2^53) and the tower-cooldown exemption; named-stream and iteration-order rules (TCK-03); section 4 phase table (nine phases, slot 2 unused, no slot enforcement, capture/removal timing); closed command set DrawLine/CutLine; hash surface list.
Done when: a reader can derive, per phase, which ids run and the tie order; no booster command or stream appears.

## Task 3 — Entity, spawn, growth rules
What it is / what it means: Production core of the game (R4 ENT, SPN, GRW rows; Decisions 4, 13).
What changes at a high level: ENT-01..04; SPN-01..03 (per-line period formula with line penalty, free spawn, alive cap skip, new-line timer 0, neutrals never spawn); GRW-01 (zero-line growth, timer persistence and reset rules) and GRW-02 (stage function used by slots, tower radius, art). Each rule names content params and decomp/analysis cites.
Done when: formulas are integer-exact with rounding and tie order stated, and contain no tunable literals beyond the allowed structural constants.

## Task 4 — Line, capture, win rules
What it is / what it means: Line management, ownership change and end conditions with the decomp-backed settlements (R4 LIN, CAP, CPT, WIN rows; Decisions 2, 3, 10, 11).
What changes at a high level: LIN-01..05 (draw validity, slots = stage, no auto-cut, same-owner reverse replace, cut stops departures only); CAP-01 and CAP-03 (level clamp, overflow forwarded on one `fwd` draw, lost when no line or capped); CPT-01/02 (capture kills source building's troops, resets timer, incoming lines persist); WIN-01..03 (human-owns-all, loss, optional time limit, no draw outcome).
Done when: surplus-line, capture-kills-troops, overshoot-discarded and overflow-forwarded settlements are each stated in exactly one rule with citation.

## Task 5 — Combat, tower, obstacle rules
What it is / what it means: Contact, shooting and blocking rules that SP03/SP04 implement and test (R4 CMB, TWR, OBS rows; Decisions 8, 9; resolved footprint and neutral-tower items).
What changes at a high level: CMB-01..05 (head-on threshold, arrival order, attack-vs-level capture, crossing via interaction window with pinned resolution order, two-round exchange); TWR-01..04 (radius by stage, delay by level, targeting priority troops then houses, never towers, instant kill, house level -1, cooldown persistence, `neutralFires`, `hitsNeutralHouses`); OBS-01/02 (lane blocking with strict boundary, `Building` 1.5 box and endpoint rule, static obstacles).
Done when: all 38 active ids exist exactly once across Tasks 2-5, each with `Since: 2.0.0` and a `Params:` line.

## Task 6 — Reserved-module table and deferred boosters
What it is / what it means: Extension convention plus the boosters-deferred record (R8, R11, Decision 5).
What changes at a high level: Section 6 table with one row per future element (walls, mines, rivers, rockets, fortress, trolley, railway, cargo, flags, WT3 artillery, double-unit, shield): intended behaviour, TW cite, hook points (validation, phase anchor, win participation, hash). No `R-` headings in section 6. Short note that bomb/speed boosters are deferred with revival path (new BST area, minor bump); no BST ids, command, stream or content keys.
Done when: no heading in section 6 matches the active-rule pattern; ship procedure (new area, ids, minor bump, registry entry, tests together) is written.

## Task 7 — Param glossary (section 7)
What it is / what it means: The authoritative rule-param to content-key table that 02's parity test diffs against (R10).
What changes at a high level: One row per key, no values: the 13 listed keys (`maxLevel` through `hitsNeutralHouses`) with TW source name and rule ids, plus other balance/unit keys from the R4 Param-home column with their TW default noted.
Done when: every param named in rules appears once in the glossary and the 13 R10 keys match the PRD names exactly.

## Task 8 — Worked examples, contradiction table, changelog
What it is / what it means: The evidence and migration record (Architecture, Acceptance Criteria).
What changes at a high level: Section 5 `E-...` examples reproducing by hand the pinned numbers (house L=10 one line 18461 mt, two lines 24000, L=64 three lines 20869, growth L=0 64600 and L=60 45560, tower delay L=1 33870 and L=64 11170); the six-contradiction settlement table with citations; 2.0.0 changelog entry (replay outcomes change, v1 replays/goldens invalid, retired ids listed).
Done when: each example is hand-derivable from the stated formulas and all six settlements are cited.

## Task 9 — Bump version strings to 2.0.0
What it is / what it means: Single branch-wide bump so `checkRulesVersion` stays green (Decision 14; Owns line).
What changes at a high level: Set `RULES_VERSION` in `packages/content/src/versioning.ts` and `rulesVersion` in content metadata to 2.0.0 to equal the doc header. Nothing else in content or code. Relies on `VERSION_GUARD_BASE` from 09 Phase A so guards compare to the merge-base and no later per-SP re-bump is needed.
Done when: `checkRulesVersion` passes; no other source file changes.

## Task 10 — Verify against check:rules and acceptance list
What it is / what it means: Close-out gate for the PRD Acceptance Criteria (R9).
What changes at a high level: Run rules parsing: 38 active ids, 5 tombstones, no duplicate headings, no `R-` heading in section 6. Confirm expected CI state at the SP01 commit: `check:rules` red (accepted until SP03/SP04 land); `sim:golden`, `replay:verify`, `bots:golden`, `validate:levels` PARKED via 09#0. Confirm test-tag ownership table (SP03, SP04, SP02, deletion by owning SP, SP09 verifies) is written into the doc or its notes.
Done when: every Acceptance Criteria line is checked off and the SP01 commit is made per commit convention.

## Owner steps
None (PRD "Manual steps": none). All open items are RESOLVED or DEFERRED; no blocking [OPEN].
