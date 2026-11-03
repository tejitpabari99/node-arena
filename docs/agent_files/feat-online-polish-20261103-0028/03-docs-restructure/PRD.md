---
status: approved
summary: Restructure docs/ into the iaudit-style layout (mission, architecture, concepts, implementation, reference, decisions, testing, specs, contracts) with a lossless old-to-new mapping, seed ADRs, new concept/reference/testing docs, and every path reference and the check:docs gate updated. Runs last and documents the 1.0.0 end state.
date: 2026-11-03
---
# PRD: SP03 Docs restructure
Repo/branch: node-arena / `feat/online-polish` · Depends on: SP01, SP02, SP04 (must land first; docs describe final state). Execution order: 01 ∥ 02 -> 04 -> 03 · Consumed by: none
Owns: everything under `docs/` except `docs/agent_files/`; `README.md`, `AGENTS.md`, `CLAUDE.md` (doc-pointer lines only), `tools/README.md`, `apps/web/README.md`, `apps/server/README.md` (links only), `.agents/skills/*` doc-path lines, `tools/src/docs-check.ts`, `tools/src/cli.ts` (credits + rules defaults), `tools/src/content.ts`, `packages/content/scripts/content-lock.ts`, tests that read `docs/GAME_RULES.md` or `docs/CREDITS.md`.

## TL;DR
- Replace 6 flat docs with the iaudit tree; every old doc is moved or split, none dropped.
- `GAME_RULES.md` becomes `specs/game-rules.md`; guides go to `implementation/` and `reference/`; PVP_OPS gets an `operations/` folder (variation: iaudit has none); FUTURES becomes `decisions/futures.md`.
- ~30 new docs: mission, architecture (package diagram), 3 concepts, 8 seed ADRs, reference/testing pages, folder indexes.
- Content describes the post-SP01/02/04 state: all versions 1.0.0, no legacy/tombstones, single `1.0.0` changelog entry, spacing rule `R-ENT-05` (3.5), 1000 ms hard bot, no Credits UI.
- `check:docs` keeps passing; extended to verify relative Markdown links and folder indexes.

## Problem
- `docs/` is flat; rules, how-to, ops runbook and backlog mix audiences [verified: `ls docs`: CONTENT_GUIDE, CREDITS, FUTURES, GAME_RULES (~9.9k words), LEVELS_GUIDE, PVP_OPS, research/, img/].
- No mission, architecture overview, decision record, or testing guide; the "why" lives only in `docs/agent_files/*` READMEs.
- Hard-coded doc paths in 12+ places: `tools/src/docs-check.ts` (`pathDocs`), `tools/src/cli.ts` (rules + credits defaults), `tools/src/content.ts`, `packages/content/scripts/content-lock.ts`, `packages/{content,defs}/test/*`, `tools/test/{bot-version,docs-check}.test.ts`, READMEs, `.agents/skills`.
- `check:docs` only validates inline-code repo paths in `pathDocs`; Markdown link targets are unchecked, so moves can silently break links.

## Goals / Non-Goals
Goals: findable-by-question layout; lossless relocation; seeded "why" record; zero stale paths; gate passes.
Non-goals: rewriting rule text or changing any rule/ID (pure move; SP04 owns the 1.0.0 wipe); touching `docs/agent_files/**` (incl. frozen paths in `tools/assets/**` scripts and `hud-browser.test.ts` that point into it); changing `research/` or `img/` content; code behavior changes beyond path constants.

## Requirements
| # | Requirement |
|---|---|
| R1 | Create tree and old-to-new mapping below via `git mv` (history preserved); split files keep the original as the first part. |
| R2 | Every folder has `README.md` (one-line purpose, audience, table of files); `docs/README.md` indexes all folders in the iaudit table form. |
| R3 | Update all path refs: grep `docs/` (excluding node_modules/dist/agent_files/.git) before and after; zero hits for old filenames (`CONTENT_GUIDE`, `LEVELS_GUIDE`, `GAME_RULES`, `CREDITS`, `FUTURES`, `PVP_OPS`) outside the mapping table and agent_files. |
| R4 | `docs-check.ts`: required files and `pathDocs` use new paths and cover every file under `docs/{implementation,reference,operations,testing}`; add (a) relative `[text](path#anchor)` link resolution for all `docs/**` and root/tools READMEs, (b) each folder has a README listing each sibling file. Update `docs-check.test.ts` fixtures. |
| R5 | Rules tooling reads `docs/specs/game-rules.md` (`checkRules`, `checkRulesVersion`, content lock, parity/defs tests); `covers R-...` test-title contract and `RULES_VERSION` header line unchanged. |
| R6 | Credits: `docs/reference/credits.md` is the default for `check:manifest` `--credits`; `uncreditedAssets` unchanged. Verify SP02 removed `apps/web/src/ui/Credits.tsx` (it imports `docs/CREDITS.md?raw`); if still present, SP03 stops and flags SP02. |
| R7 | New docs state only 1.0.0-era facts; no "legacy", "since 2.x", "tombstone" language; numbers (spacing 3.5, pick radius 1.10, hard delay 1000) are cited from `balance.json`/`difficulty.ts` at write time, not from memory. |
| R8 | `AGENTS.md` gains a "Where docs go" table (mirrors the index) and an "ADR required for" rule; its existing `docs/GAME_RULES.md` / guide lines and `.agents/skills/*` pointers updated; `docs/agent_files/` convention untouched. |

## Architecture
Target tree:
```
docs/
  README.md  mission.md  architecture.md
  concepts/        determinism-and-replays, pvp-match-lifecycle, content-pipeline
  implementation/  content-authoring, owner-art, level-import, web-client, pvp-server
  reference/       bot-difficulties, balance-values, versions, level-coverage, credits
  decisions/       0001..0008 ADRs, futures
  testing/         gates-and-ci, e2e-and-campaign-verify, pre-release-checklist
  specs/           game-rules
  operations/      pvp-server (Fly runbook)
  contracts/       README only (pointers to JSON Schemas + net message types)
  research/  img/  agent_files/   (unchanged)
```
`examples/` dropped (no public API). `tools/README.md` stays in place as the script/gate inventory (`check:docs` requires it; tools-adjacent) and is linked from `testing/gates-and-ci.md`; not duplicated.

Old to new:
| Old | New |
|---|---|
| `docs/GAME_RULES.md` | `docs/specs/game-rules.md` |
| `docs/CONTENT_GUIDE.md` (sections up to "Owner art overrides" + Load/validate/Regenerate) | `docs/implementation/content-authoring.md` |
| `docs/CONTENT_GUIDE.md#owner-art-overrides` (incl. patch format, textures, preview inventory) | `docs/implementation/owner-art.md` |
| `docs/LEVELS_GUIDE.md` §1-5a, §7 (pipeline, import, features, authoring, PvP maps, gotchas) | `docs/implementation/level-import.md` |
| `docs/LEVELS_GUIDE.md` §5 coverage tracker + §6 fidelity ledger | `docs/reference/level-coverage.md` |
| `docs/CREDITS.md` | `docs/reference/credits.md` |
| `docs/FUTURES.md` | `docs/decisions/futures.md` |
| `docs/PVP_OPS.md` | `docs/operations/pvp-server.md` (close codes, version skew, capacity facts also linked from `implementation/pvp-server.md`) |
| `docs/research/**`, `docs/img/**` | unchanged |
| `README.md` Play-online / Deploy prose | stays; links to concepts + operations |

New docs (one-line purpose each):
| Doc | Purpose |
|---|---|
| `README.md` | Folder/audience index |
| `mission.md` | What Node Arena is (campaign, editor, online PvP), scope, non-goals, Tower War attribution; wins over other docs |
| `architecture.md` | Package diagram (defs, content, sim, bots, net, server, web, tools), dependency direction, data flow campaign vs PvP |
| `concepts/determinism-and-replays` | Fixed ticks, integer math, seeds, command log, golden replays |
| `concepts/pvp-match-lifecycle` | Seats, teams, bots, spectators, pause budget, forfeit, reconnect, resync |
| `concepts/content-pipeline` | JSON content, schemas, compile, locks, version/hash guards |
| `implementation/web-client` | Render/input/gesture layers, pick radius, cut ribbon, HUD, editor |
| `implementation/pvp-server` | ws server, rooms, lockstep, protocol modules, drain |
| `reference/bot-difficulties` | Presets and `actionDelayMs` per tier; `BOT_VERSION` rule |
| `reference/balance-values` | Key `balance.json` values (min spacing 3.5, caps, thresholds), each with source key |
| `reference/versions` | `RULES_VERSION`, `BOT_VERSION`, content version, protocol version: meaning, bump rules, where stored |
| `decisions/0001-deterministic-lockstep-sim` | Pure integer sim; PvP and replays share it |
| `decisions/0002-server-authoritative-pvp` | Server owns the clock/validation; clients send commands |
| `decisions/0003-content-locks-and-hashes` | Hash-locked content; identity moves force version bumps |
| `decisions/0004-single-fly-machine` | In-memory rooms, one machine, deploys drop matches |
| `decisions/0005-rules-first-change-order` | Rule text, version, tests (`covers R-...`), then code |
| `decisions/0006-pure-registries-in-defs` | Modules/bots/commands as registries, no engine imports |
| `decisions/0007-minimum-building-spacing` | 3.5 hard error vs warn; why pick radius 1.10 depends on it |
| `decisions/0008-versions-reset-to-1-0-0` | Single clean baseline, no legacy paths |
| `testing/gates-and-ci` | What each gate checks, CI order, link to `tools/README.md` |
| `testing/e2e-and-campaign-verify` | Web e2e, PvP e2e, `campaign:verify`, Chromium needs |
| `testing/pre-release-checklist` | Gate run, PvP smoke, deploy order, health/version check |
| 8 folder `README.md` indexes | One per new folder (`contracts/` lists `packages/content/schemas` and `packages/net/src/messages.ts`) |

Only dates and rationale in ADRs come from existing `agent_files` READMEs and code; unverifiable claims are cut, not guessed.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| D1 | Rules file | `specs/game-rules.md`, same content | Split per area; keep top-level | Normative contract with acceptance (`covers R-...`) fits `specs/`; splitting breaks `checkRules` parsing and rule ID locality. |
| D2 | Guides | Split by question (how-to vs lookup) | Move whole files | CONTENT_GUIDE/LEVELS_GUIDE mix procedures with ledgers; owner-art is large and independently linked from tools/README. |
| D3 | Ops runbook | New `operations/` folder | `testing/`, `implementation/` | Owner runbook, not test or internals; iaudit has no equivalent, variation approved. |
| D4 | Credits | `reference/credits.md` | Keep `docs/CREDITS.md` top-level | Lookup fact; one constant changes in `cli.ts`; SP02 only says docs stay, not where. |
| D5 | FUTURES | `decisions/futures.md` | Top-level; delete | Backlog is deferred decisions; AGENTS.md pointer updated. |
| D6 | `tools/README.md` | Stays, canonical script inventory | Move to `reference/` | `check:docs` script-coverage reads it; avoids duplicate inventory drift. |
| D7 | `contracts/` | Index-only README to schemas | Copy schemas; drop | Schemas are generated (`content:schemas`); copies would drift. |
| D8 | `examples/` | Dropped | Keep empty | No public API. |
| D9 | Ordering | Run after SP01/02/04 | Parallel | Avoids rebasing doc edits; documents final state. |
| D10 | Gate | Extend `check:docs` with link + index checks | Leave | Moves are the exact failure mode; cheap to detect. |

## Risks / Open Questions
- Anchor links (`#owner-art-overrides`, section anchors in rules) break on split. [RESOLVED: D10 link check validates files; add anchor validation for headings in same repo]
- `GAME_RULES` is ~9.9k words; `git mv` keeps blame, but SP04 edits may conflict. [RESOLVED: SP04 lands first]
- SP04 PRD wording for 1.0.0. [RESOLVED: SP04 PRD now exists. Docs describe the final state only: every version constant 1.0.0 (protocol 1, save v:1, package.json 1.0.0, own editor/app version strings 1.0.0), no tombstones/Supersedes/Since/legacy language, `GAME_RULES.md` changelog is a single `1.0.0` entry, ids never reused (history in git), `--base none` one-time baseline mechanism is mentioned only in ADR-0008/`reference/versions` as the reset mechanism. Implementer still re-reads the SP04 diff at write time for exact values]
- Should `reference/balance-values` be generated from `balance.json` to avoid drift? [DEFERRED: hand-written with source keys; futures entry]
- Do fixtures in tools tests that fake `docs/GAME_RULES.md` (`bot-version.test`, `content-lock-cli.test`) need to move with the constant? [RESOLVED: yes, same new path]
- Keep research evidence in `docs/research/` or also index from `reference/`? [RESOLVED: keep, link from `docs/README.md`]
- Does owner approve `AGENTS.md`/`CLAUDE.md` doc-rule edits? [RESOLVED: approved 2026-11-03: path pointers + "Where docs go" table (R8); new `check:docs` relative-link + folder-index checks (R4/D10) approved]
- `Credits.tsx` imports `docs/CREDITS.md?raw`. [RESOLVED: SP02 removes the Credits UI before SP03 runs; R6 verification stays as a guard]

## Acceptance Criteria
- `pnpm check:docs`, `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; `pnpm check:rules`, `pnpm check:manifest` read the new paths.
- `docs/` top-level contains only README, mission, architecture, the folders above; `agent_files/` byte-identical to pre-change.
- Old-filename grep (R3) returns nothing outside agent_files and the mapping table.
- Every old doc's content is present at its mapped path (spot-check heading list diff per file).
- Every ADR has Status/Date/Context/Decision/Consequences and is linked from `decisions/README.md`.
- No doc mentions legacy/tombstone/pre-1.0 versions; spacing 3.5, pick radius 1.10, hard 1000 ms appear with sources.
- Deliberately breaking a relative link or removing a folder index makes `check:docs` fail (test added).
