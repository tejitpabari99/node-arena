---
status: done
summary: Four tasks to reset all versions to 1.0.0, wipe rule history and legacy code, regenerate locks/goldens, and restore normal version gating.
date: 2026-11-03
---
# Tasks: SP04 Version reset to 1.0.0 + legacy removal
Source of truth: docs/agent_files/feat-online-polish-20261103-0028/04-version-reset-legacy/PRD.md. Runs after SP01 and SP02 land, before SP03. Each task is one committable unit; gates stay green by landing the `--base none` support first.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Gate support for no-baseline + rules history wipe | SP01, SP02 | done |
| 2 | Version reset to 1.0.0 everywhere | 1 | done |
| 3 | Legacy/compat code removal | 2 | done |
| 4 | Regenerate locks/goldens, full verification, restore baseline gating | 3 | done |

## Task 1 — Gate support for no-baseline + rules history wipe
What it is / what it means: Prepares tooling so the reset can pass monotonic-version guards, and removes rule-history machinery (PRD D2, D3, R3–R6).
What changes at a high level: Add generic `--base none` / `VERSION_GUARD_BASE=none` (baseline treated as absent; lock freshness still checked), with tests; simplify old-baseline tolerance in content versioning and the bot-version first-implementation branch, keeping monotonic checks. Set the one-time no-baseline override in the CI baseline step. In GAME_RULES: delete retired-id tombstones, `Supersedes:`/`Since:`/v1 notes, collapse changelog to one 1.0.0 row (ids and R-ENT-05 kept). Remove tombstone parsing in the rules tool and update its tests; rewrite "keep tombstones" policy text in AGENTS.md, CONTENT_GUIDE, tools README.
Done when: `check:rules` and tool tests pass; `check:content --base none` works; no tombstone/Supersedes/Since text remains.

## Task 2 — Version reset to 1.0.0 everywhere
What it is / what it means: Every version constant, mirror, package.json, and data schemaVersion becomes 1.0.0 (protocol 1, save v:1) per the Version Inventory (R1, R8, D4, D5).
What changes at a high level: Source constants, rules header/content.json/manifest mirrors, 8 package.json versions, data and code `schemaVersion` literals, save format version; implementer checks `editorVersion`/`gameVersion` (own product string to 1.0.0; external Tower War metadata and CLOSE_VERSION stay). Test fixtures with hard-coded old values import constants instead. Run build prerequisites first so dist is not stale.
Done when: greps for old values (3.3.0, 2.6.x, 2.0.0 outside agent_files/lockfiles) are empty; unit tests pass apart from lock/golden staleness handled in Task 4.

## Task 3 — Legacy/compat code removal
What it is / what it means: Delete remaining legacy artifacts from the Legacy Removal Inventory (R2).
What changes at a high level: Rewrite stale v1/compat comments in content schemas and manifest; rename `*-v2` test files; inline editor CSS compat aliases; drop dead LegacyPanel comment; drop test-only param from snap helpers and update callers; remove the server `DRAIN_MS=0` legacy-shutdown path (config, tests, ops text); shorten save-module comment. Keep: light-rig "Unity legacy lights", import-tw foreign-format refusals, replay incompatibility logic.
Done when: grep for legacy/compat/migrat/deprecated in apps, packages, tools source hits only keep-list items; unit and typecheck pass.

## Task 4 — Regenerate, verify, restore baseline gating
What it is / what it means: Rebuild all derived artifacts and prove the reset, then return CI to normal monotonic gating (R6, R7).
What changes at a high level: Regenerate in order: schemas, content lock, levels lock, sim golden, replay verify, bot goldens, manifest check. Review golden diffs: outcomes, ticks and final hashes unchanged, only version envelope differs. Run full CI chain, PvP e2e, campaign verify, and local `pvp-versions` healthz match. Then remove the one-time override so baseline selection is normal (may ride with SP03), confirmed locally via `--base HEAD`.
Done when: `pnpm run ci`, `test:pvp:e2e`, `campaign:verify`, `check:content --base none` and then `--base HEAD` all green; golden diff reviewed.

## Manual steps (owner)
- Deploy Fly server and web together in one release using a drain deploy; old clients get the existing reload prompt; in-flight rooms are lost (accepted).
- Merge note: post-merge CI runs the merged workflow, so the override must be restored in a follow-up commit/PR.
