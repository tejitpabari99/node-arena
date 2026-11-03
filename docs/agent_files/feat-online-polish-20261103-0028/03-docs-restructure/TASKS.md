---
status: draft
summary: 4 tasks: move/split docs + repoint refs, extend check:docs, write new top-level/concept/ADR docs, write reference/testing/implementation pages + AGENTS pointer table.
date: 2026-11-03
---
# Tasks: SP03 Docs restructure
Source of truth: docs/agent_files/feat-online-polish-20261103-0028/03-docs-restructure/PRD.md. Runs last, after SP01/02/04; new content documents the 1.0.0 end state only. Each task commits with `check:docs` passing.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Relocate and split existing docs, repoint all refs | SP01, SP02, SP04 | todo |
| 2 | Extend check:docs (links, folder indexes) | 1 | todo |
| 3 | Mission, architecture, concepts, ADRs | 1, 2 | todo |
| 4 | Reference, testing, implementation pages, AGENTS pointers | 3 | todo |

## Task 1 — Relocate and split existing docs, repoint all refs
What it is / what it means: Lossless move of the six flat docs into the target tree (R1, R3, R5, R6; D1–D5, D8).
What changes at a high level: `git mv` per the old-to-new map; split CONTENT_GUIDE (authoring vs owner-art) and LEVELS_GUIDE (import vs coverage ledger), original kept as first part. Update every hard-coded path (docs-check pathDocs, cli rules/credits defaults, content.ts, content-lock, tests and fixtures, READMEs, `.agents/skills`). Verify SP02 removed the Credits UI; if not, stop and flag SP02. Add stub folder READMEs so the tree is valid.
Done when: old-filename grep is clean outside agent_files and the mapping table; `check:rules`, `check:manifest`, `check:docs`, test, lint, typecheck pass; agent_files untouched.

## Task 2 — Extend check:docs (links, folder indexes)
What it is / what it means: Gate hardening so moves cannot silently rot (R4, D10).
What changes at a high level: Required files and pathDocs cover implementation/reference/operations/testing; add relative `[text](path#anchor)` resolution (incl. heading anchors) for `docs/**` and root/tools READMEs; add each-folder-README-lists-siblings check. Update docs-check test fixtures; add tests that a broken link or missing index fails.
Done when: gate passes on the tree; both deliberate-break tests fail as expected.

## Task 3 — Mission, architecture, concepts, ADRs
What it is / what it means: The "why" layer (R2, R7; mission wins over other docs).
What changes at a high level: Write `mission.md`, `architecture.md` (package diagram, data flow campaign vs PvP), three concepts, ADRs 0001–0008 (Status/Date/Context/Decision/Consequences), `decisions/README.md` index. Dates and rationale only from agent_files READMEs and code; unverifiable claims cut. Numbers cited from `balance.json`/`difficulty.ts` at write time. No legacy/tombstone language.
Done when: all ADRs linked from decisions index; `check:docs` passes; grep for legacy/tombstone/pre-1.0 language clean.

## Task 4 — Reference, testing, implementation pages, AGENTS pointers
What it is / what it means: Lookup and how-to pages plus entry-point updates (R2, R7, R8; D6, D7).
What changes at a high level: Write reference/{bot-difficulties, balance-values, versions}, testing/{gates-and-ci, e2e-and-campaign-verify, pre-release-checklist} (linking, not duplicating, `tools/README.md`), implementation/{web-client, pvp-server}, `contracts/README`, final `docs/README.md` index (links research/). Add a futures entry for generated balance-values. Add AGENTS.md "Where docs go" table and "ADR required for" rule; fix remaining AGENTS/CLAUDE doc pointers.
Done when: every folder index lists all siblings; spacing 3.5, pick radius 1.10, hard 1000 ms appear with source keys; full gate set passes.
