---
status: done
summary: 12 tasks implemented — rules, content schemas/registry/loader/validator/compiler/hashing, v1 data, acceptance fixtures, and CONTENT_GUIDE.md; dev-review pending
date: 2026-10-08
---
# Tasks: Rules + Data-Driven Content Model (SP01)
Source of truth: docs/agent_files/feat-game-design-20261006-0617/01-rules-and-content-model/PRD.md. Contract sub-project: every other SP consumes its rule IDs, schemas and `CompiledLevel`. No open items; resolved items are folded in (TypeBox with spike, scale 1000, R-CAP wording, no campaign overrides).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Package scaffold + TypeBox spike | — | done |
| 2 | GAME_RULES.md | — | done |
| 3 | Fixed-point numerics + browser-safe loader | T1 | done |
| 4 | Core schemas + generated JSON Schemas | T1, T3 | done |
| 5 | Component registry + `extends` resolution | T2, T4 | done |
| 6 | Hosted bot + manifest schemas | T4 | done |
| 7 | `validateContent` (schema + semantic) | T5, T6 | done |
| 8 | `compileLevel` + `CompiledLevel` | T5, T7 | done |
| 9 | Hashing, versioning, lockfile, CI checks | T8 | done |
| 10 | v1 data files + sample level | T7 | done |
| 11 | Rejection fixtures + acceptance tests | T9, T10 | done |
| 12 | CONTENT_GUIDE.md | T9 | done |

## Task 1 — Package scaffold + TypeBox spike
What it is / what it means: Stand up `packages/content` and settle schema tech (Decision 1; resolved: TypeBox, switch only if spike fails).
What changes at a high level: Package skeleton, Ajv strict setup, one real schema (troop) end to end: TypeBox type, generated JSON Schema, validation. Record spike outcome. Lint rule banning `fs`/`path`/`node:crypto` in the loader/validator/compiler/hash modules (Req 9, Decision 14).
Done when: troop schema validates a sample file and emits a committed `.schema.json`; spike result recorded; the lint rule fails on a deliberate violation.

## Task 2 — GAME_RULES.md
What it is / what it means: The mechanics contract (Req 1, Decisions 10, 12, 13). Rules cite param names, never literals.
What changes at a high level: Write the 7-section outline, `R-<AREA>-<NN>` IDs across GEN/SND/LIN/CAP/CMB/CPT/WIN/TCK/ENT covering all brief section-5 rules, tick phase order (slot enforcement at end of tick), normative R-CMB/R-CAP/R-LIN text (R-CAP per user resolution: at cap with a line keeps sending, no line stops, no banking; capture at 0 flips with leftover garrison), integer rounding conventions, tickRate=20 as R-TCK constant, "Planned v2" component specs marked not implemented, changelog, `RULES_VERSION`.
Done when: AC1 holds; every rule has Params/Examples/Since; no tunable literals outside labelled examples.

## Task 3 — Fixed-point numerics + browser-safe loader
What it is / what it means: Decimals ≤3 places become int32 (Req 4, Decision 2; resolved: scale 1000 kept, SP02 may widen internal factor only).
What changes at a high level: `fx3` field tag and conversion; reject more precision, NaN, out-of-int32. `loadContent(fileMap)` taking `Record<path, string|object>` with no fs. Export a single scale constant so SP02 can adjust internally.
Done when: 4-decimal, NaN and overflow inputs are rejected with file + JSON pointer; loader runs unchanged under Node and in a browser-like environment.

## Task 4 — Core schemas + generated JSON Schemas
What it is / what it means: v1 entity shapes (Reqs 2, 9; Decisions 3, 7, 8).
What changes at a high level: TypeBox schemas for `content.json`, balance, troop (`value`, `speed`), archetype (`extends?`, components map), level (players unbounded with `team`, towers, reserved `obstacles`/`mapObjects`, `overrides`, optional `timeLimitSec`/`visual`), all `additionalProperties:false`, `$schema` + `schemaVersion` on every file, `x-presentation` tags on presentation-only fields. Generator script, committed output, CI freshness check.
Done when: schemas validate sample shapes; regenerated JSON Schemas match committed ones.

## Task 5 — Component registry + `extends` resolution
What it is / what it means: Registry of 4 v1 components with ranges and rule IDs (Req 3, Decisions 4, 9; AC5).
What changes at a high level: Registry entries for `garrison`, `generates`, `drawsLines`, `capturable` (params, v1 ranges, rule IDs); troop `value==1` range. Depth-1 `extends` with per-component param merge, array params replaced whole, no add/remove of components, no cycles. Registry shape lets `shoots` or `value 2` be added later without schema change. Export the registry for SP02's startup parity assertion.
Done when: standard/small/large-style merges resolve; add/remove-component and depth>1 cases are rejected.

## Task 6 — Hosted bot + manifest schemas
What it is / what it means: Content hosts schemas it does not populate (Decisions 15, 16; Req 8).
What changes at a high level: `src/manifest.schema.ts` plus generated `manifest.schema.json`, exported as TypeBox type and plain JSON Schema object. Bot envelope `bot.schema.json` (`{id, kind: utility|idle, params}`, extends depth ≤1, `skill`-only override for extending profiles, weight bound 10,000 milli) with a placeholder `bot-params.ts` that SP04 fills (SP04 authors the inner params). The manifest.json file itself belongs to SP03.
Done when: both schemas are generated, committed, and exported from the package index; the CI freshness check covers them.

## Task 7 — `validateContent` (schema + semantic)
What it is / what it means: Shared validator for tools, dev panel and server (Req 5, Decision 7).
What changes at a high level: `validateContent(fileMap, {manifest}?) → {errors, warnings}` with file + JSON pointer. Schema pass, then the full semantic list: unique ids, resolving refs, registry ranges, ascending thresholds, `garrison ≤ cap`, bounds/footprint overlap, every player owns a tower, ≥2 owners, rates/speed > 0, `speed ≤ 100`, `|coord| ≤ 500`, v1 team rules (one human, 1–3 bots, distinct teams), empty obstacles/mapObjects, order contiguous 1–20, override targets exist, tooling bot profiles not level-referenceable, manifest visual keys when a manifest is given. Level-reachability stays a reserved hook.
Done when: valid content yields zero errors and every listed violation yields a located error.

## Task 8 — `compileLevel` + `CompiledLevel`
What it is / what it means: The only sim input (Req 7, 8; CompiledLevel section).
What changes at a high level: Resolve overrides and `extends`, convert to int32, emit dense towers/players sorted by id, owner index or -1, team defaulting to own id, `kinds[]` with `speedMilli`, `timeLimitSec` with balance default, pass-through visual keys, resolved `bots` (profiles merged, `fx3` to int32). Export the types SP02/03/04 import.
Done when: golden compile of the sample level matches expectations; the type is exported from the package index.
Depends on SP04 only for the real bot-params contents; the envelope suffices here.

## Task 9 — Hashing, versioning, lockfile, CI checks
What it is / what it means: Replay/handshake identity (Req 6, Decision 11; Hashing section).
What changes at a high level: Pure-TS SHA-256 over canonical JSON; `simHash` of resolved sim-relevant content (presentation-tagged fields, `name`, `visual`, `colorKey` excluded; bots excluded); `botHash` per resolved profile. `pnpm content:lock` generates `hashes.lock.json`. CI checks: hash change without `contentVersion` bump fails (botHash defers to SP04 `BOT_VERSION`), `RULES_VERSION` equals between GAME_RULES.md header and `content.json`, schemas fresh. Replay header shape exported.
Done when: AC3 holds; hashes are identical across Node versions on fixtures.

## Task 10 — v1 data files + sample level
What it is / what it means: Minimum data set (AC2; Variants section).
What changes at a high level: `content.json`, `balance.json` (small: `defaults.timeLimitSec`, default theme), `regular` troop, `standard` archetype, `small`/`large` as `extends` archetypes with placeholder values (SP05 tunes), one sample level with no `overrides`. Campaign levels 01–20 and bot data are not authored here (SP05, SP04).
Done when: the set passes `validateContent` and compiles.

## Task 11 — Rejection fixtures + acceptance tests
What it is / what it means: Prove the contract (AC3–AC6, Decision 9).
What changes at a high level: Fixtures rejecting all AC4 cases (unknown component, unknown field, 4-decimal, dangling ref, overlapping towers, non-empty obstacles/mapObjects, troop `value: 2`, missing override target, coord >500, speed >100, tier profile overriding non-`skill`, tooling-profile reference, missing manifest key). `archer` + `tank` fixtures fail only on registry/range and pass when registry entries are added in-test. Same `simHash` via `fs` map and Vite glob. Tests tagged by rule ID where applicable.
Done when: AC3–AC6 pass in CI.

## Task 12 — CONTENT_GUIDE.md
What it is / what it means: The change process doc (Req/AC7).
What changes at a high level: Document the change-process table (what to edit, which versions to bump, which tests), `content:lock` usage, extension rule (schema + registry + rule IDs + sim impl + tests together), the "campaign uses no overrides" convention, and the semver meaning of `RULES_VERSION`.
Done when: AC7 holds.

## Manual steps (owner)
None in this PRD. R-CAP wording and the capture-at-0 rule are already resolved by the user. The map scale (120×80, radius ~3) is deferred to greybox tuning, which is not an SP01 task.
