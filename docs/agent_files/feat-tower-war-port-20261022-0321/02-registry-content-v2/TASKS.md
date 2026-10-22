---
status: draft
summary: 8 tasks for SP02 - defs registry, additive content v2 stack, manifest v2, fixtures/parity, shared CUT with 03 T1, CONTENT_GUIDE, post-05 fit review.
date: 2026-10-22
---
# Tasks: Registry + content v2 (SP02)
Source of truth: [PRD](PRD.md). Tasks 1-5 are additive (migration steps 1-3) and keep the repo green; Task 6 is the single destructive CUT, one commit shared with 03 Task 1. All gates are the live set; parked gates are owned by 09 Phase A.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | `packages/defs` registry | 09#0, 01 | done |
| 2 | Content v2 schemas + data (`next/`) | 1 | done |
| 3 | Loader, compiler, hash, validator (`next/`) | 2 | done |
| 4 | Manifest v2 schema + cross-checks | 2 | done |
| 5 | Parity tests + golden/synthetic fixtures | 1, 3, 4, 01 | done |
| 6 | CUT: delete old content, promote `next/`, 2.0.0 | 5, 03#1 | done |
| 7 | CONTENT_GUIDE rewrite | 6 | done |
| 8 | Post-05 format-fit review + lock regen | 6, 05 | done |

## Task 1 — `packages/defs` registry
What it is / what it means: one pure, browser-safe TypeBox package holding one explicit list per concept, so content, sim, bots, web and tools read a single definition (PRD R2, Decisions 1, 2, 9).
What changes at a high level: new package exporting MODULES (level, drawsLines, spawns, grows, shoots, blocksLines, with x-unit-tagged param builders), COMMANDS (DrawLine, CutLine), EVENTS (initial list; 03 T1 finalizes), OBJECTIVES (captureAll), BOT_KINDS (tw), VISUAL id sets, PHASES (01 R5 tuple), and derived types/CAPABILITIES. No codegen, no sim imports. Root-script wiring (`build:prerequisites`/`typecheck`) stays with 09 Phase A.
Done when: defs builds, lints and has unit tests; no consumer yet; removing a module def would be a compile error once bindings exist.

## Task 2 — Content v2 schemas + data (`content/src/next/`, `data-next/`)
What it is / what it means: the new data model beside the old one so the old game stays untouched (R3, R4 schema, Decisions 3, 4, 5, 11).
What changes at a high level: schemas for unit, building (circle/box footprint, `special`), element, level v2 (`source`/`position` optional), campaign, balance; fx3 handled so params never sit under `oneOf`; seat `bot` validated via BOT_KINDS. Data: balance.json (thresholds 10/30, no boosters), soldier/tank, house-wt1/house-wt2 (`special` true)/tower, obstacle, with placeholder footprints for 04. Includes the test that Type.Partial overrides scale like archetype values.
Done when: schemas generate; data validates; override-scaling test passes; all live gates green.

## Task 3 — Loader, compiler, hash, validator (`next/`)
What it is / what it means: the runtime API and level semantics SP03-08 code against (R4 validation, R5, R6, R8 hashing, Decisions 4, 6, 7, 8).
What changes at a high level: `loadCatalog`, `loadLevel`, `compileLevel`, `computeRequires`, `loadContent` (tools/tests); `CompiledLevel` per R5; `simHash` (excludes presentation, bots) and per-`level#player` `botHash`; validator rules (refs, maxLevel, buildings in bounds, elements outside only logged, at least one non-ignored building, coincident error, overlap warning, requires equality, bot cross-refs); the single exported bounds-pad constant; array order treated as semantic. Browser-safety test covers the loaders.
Done when: each failure case reports file plus pointer; hashes are stable across runs; loaders run without Node APIs and without reading other levels.

## Task 4 — Manifest v2 schema + cross-checks
What it is / what it means: the contract SP07 needs (R7), `MANIFEST_SCHEMA_VERSION` 2.0.0.
What changes at a high level: `next/manifest.schema.ts` using VISUAL sets and EVENTS: kinds, budgets, stage-indexed `stages[]` (length = thresholds + 1), textureSwap team, node-tracks anim, themes, fx, palettes with gray, camera; tint/bob/stacked/levelVisuals/colorblind removed. Cross-checks: archetype/unit/element visuals exist with matching kind, theme exists, every colorKey has a texture, event keys known. No manifest data (07's).
Done when: every row of 07's contract table is satisfied and a fixture manifest validates against content cross-checks.

## Task 5 — Parity tests + golden and synthetic fixtures
What it is / what it means: guards against drift from 01 and the frame/format contract that 05's importer must reproduce (R4 Frame contract, R3, migration step 3).
What changes at a high level: glossary-parity test (diff 01 §7 / R10 key table against module schemas); `ruleIds`-parity test against GAME_RULES headings; hand-rotated golden `levelview-1` (bounds x -9..6, z -7..8, 05 R5 key order, `JSON.stringify(...,null,2)+"\n"`); one synthetic obstacle+tower fixture; bounds-rule test importing the shared pad constant.
Done when: parity tests pass against the merged 01 doc; golden loads, compiles and hashes stably; obstacle-outside-bounds passes (logged) and no-non-ignored-building fails.

## Task 6 — CUT (shared with 03 Task 1)
What it is / what it means: the one planned destructive commit; happens only when 03 T1 is ready (R1, R8, migration step 4, Decision 10). 03 T1 supplies the sim half and the final EVENTS list in defs; this task supplies the content half in the same commit.
What changes at a high level: `git rm` R1 delete list and old `data/`; promote `next/*` and `data-next/*` and fix imports; set schema/manifest/content versions to 2.0.0 and `BOT_VERSION` 2.0.0; regenerate schemas and the lock (`{levels, bots}` with `level#player` keys); port `tools/src/content.ts` and content-lock script; tools consume manifest validation from content, not web; no v2 manifest shipped. Parked gates come from 09 Phase A's runner, not hand edits.
Done when: no grep hits for COMPONENT_REGISTRY, assertParity, botProfile, band, data/bots; check:content passes under `VERSION_GUARD_BASE`; live set (defs, content, sim, tools minus parked) builds, lints, typechecks and tests green.

## Task 7 — CONTENT_GUIDE rewrite
What it is / what it means: documents the R9 extension flows against the real tree.
What changes at a high level: rewrite `docs/CONTENT_GUIDE.md` for add-a-tower-kind (1 file), add-a-level (2 files), add-a-unit, add-a-module, add-a-bot-kind/command.
Done when: each of the three required walkthroughs matches the actual tree.

## Task 8 — Post-05 format-fit review + lock regen
What it is / what it means: migration step 6; confirms the 20 imported levels and campaign fit the schema.
What changes at a high level: after 05 lands levels and `campaigns/common.json`, regenerate `hashes.lock.json`, confirm `requires` checks pass, review format fit and raise any schema gaps back as fixes. No level authoring here.
Done when: `validate:content`, `check:content`, `check:schemas` green with all 20 levels; lock committed.

## Owner steps
None (PRD "Manual steps": none). Deferred to docs/FUTURES.md via 09: `--fix-requires`, campaign `loop`, module versions/phase partial order, unit modules, `extends`, packs.
