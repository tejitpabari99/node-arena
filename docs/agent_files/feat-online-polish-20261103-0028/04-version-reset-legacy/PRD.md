---
status: approved
summary: Pre-launch reset of every version constant to 1.0.0, removal of legacy/back-compat code and rule history (tombstones, old changelog), adaptation of monotonic-bump gates via a one-time baseline reset, and regeneration of all locks/goldens.
date: 2026-11-03
---
# PRD: SP04 Version reset to 1.0.0 + legacy removal
Repo/branch: node-arena / `feat/online-polish` · Depends on: SP01, SP02 landed (they do normal version bumps per repo rules so each commit passes gates; SP04 overwrites everything with 1.0.0). Execution order: 01 ∥ 02 -> 04 -> 03 · Consumed by: SP03 (docs restructure rewrites the cleaned GAME_RULES/AGENTS)
Owns: all version constants and `package.json` versions, `docs/GAME_RULES.md` (history sections), `AGENTS.md` + `docs/CONTENT_GUIDE.md` + `tools/README.md` (policy text), `tools/src/rules.ts`, `packages/content/src/versioning.ts`, `packages/content/scripts/bot-version.ts`, `.github/workflows/ci.yml` (one-time baseline), regenerated locks/goldens.

## TL;DR
- Nothing is in production: every version becomes `1.0.0` (protocol `1`, save `v:1`), one commit sequence, no compat.
- Strip history: tombstones, `Supersedes/Since` notes, 3.3.0-era changelog -> single `1.0.0` entry. Strip compat shims/comments found by grep (inventory below; code is already fairly clean).
- Gates compare to `--base`/CI base and reject decreases. Land the reset with a one-time "no baseline" mode, then restore normal gating.
- Regenerate in dependency order. Fly server + web must deploy together (protocol 4 -> 1 hard-refuses old clients by design).

## Problem
- Versions are 2.0.0 schema, 2.6.1 content, 3.3.0 rules, 2.6.0 bot, protocol 4: meaningless pre-launch, and imply history that does not exist.
- Legacy remains: v1 rule history in `GAME_RULES.md`, tombstone machinery in `tools/rules.ts`, "older baseline" tolerance in version guards, stale "v1/legacy/compat" comments and CSS aliases.
- Guards `checkContentVersion` / `checkBotVersion` throw when a version drops vs the baseline [verified: versioning.ts `checkContentVersion`, bot-version.ts "BOT_VERSION must not decrease"]; the reset would fail CI as-is.

## Goals / Non-Goals
Goals: every version = 1.0.0; no legacy/compat/migration/old-format code; clean rule doc; green full gate chain; deployable to Fly.
Non-goals: touching `docs/agent_files/**`; changing mechanics/balance (hashes change only because the version envelope does -- see Risks); docs restructure (SP03); removing *rejections* of foreign formats (e.g. TW v0/long dialect refusal in import-tw is current feature code, keep); `gameVersion: '1.29.3'` (Tower War source-game metadata, not ours); `CLOSE_VERSION=4003` (WebSocket close code, not a version) and any other external/protocol codes. Our own product/app version strings are in scope (see Version Inventory).

## Requirements
| # | Requirement |
|---|---|
| R1 | Every constant in the Version Inventory below = `1.0.0` (ints: protocol `1`, save `v:1`). A grep for the old values returns zero outside `agent_files`/lockfiles. |
| R2 | Removal inventory items deleted/rewritten; no code path reads, migrates or tolerates an older format. |
| R3 | `GAME_RULES.md`: delete §"Retired ids" tombstones (GEN-01/02, SND-01/02, CAP-02), retired-areas sentence, id-policy tombstone sentences, all `Supersedes:` / `Since:` lines and "v1" mentions; changelog = one `1.0.0` row; header `RULES_VERSION: 1.0.0`. Rule ids stay stable names (e.g. `R-TWR-02`) -- no renumbering (tests `covers R-...` unchanged). |
| R4 | `AGENTS.md`, `CONTENT_GUIDE.md`, `tools/README.md`: "keep tombstones" -> "ids are never reused; a retired rule is deleted with its tests (history lives in git)". |
| R5 | `tools/rules.ts`: drop tombstone parsing/exemption; unknown-id-in-test-title stays an error. Update `rules.test.ts`, `rules-repo.test.ts`. |
| R6 | Gates keep monotonic enforcement for post-reset history; reset lands via one-time no-baseline (see Architecture). |
| R7 | Regenerate all locks/goldens (order below); `pnpm run ci`, `test:pvp:e2e`, `campaign:verify` green. |
| R8 | Persisted client data: no migration; mismatched data discarded (already the behavior). |

## Version Inventory (current -> 1.0.0)
| Constant | Location | Now |
|---|---|---|
| `RULES_VERSION` | `packages/content/src/versioning.ts:7`; mirrored `docs/GAME_RULES.md:3` header, `packages/content/content.json` `rulesVersion` | 3.3.0 |
| `BOT_VERSION` | `packages/bots/src/version.ts:2` | 2.6.0 |
| `PROTOCOL_VERSION` | `packages/net/src/version.ts:2` | 4 |
| `SCHEMA_VERSION` | `packages/content/src/schemas.ts:7` | 2.0.0 |
| `MANIFEST_SCHEMA_VERSION` | `packages/content/src/manifest.schema.ts:5` (+ `apps/web/assets/manifest.json` `schemaVersion`) | 2.0.0 |
| `contentVersion` | `packages/content/content.json:4` | 2.6.1 |
| `schemaVersion` in data | `content.json`, `balance.json`, 3 campaigns, 3 buildings, 2 units, 1 element, 24 levels (`packages/content/data/**`) | 2.0.0 |
| `schemaVersion` literals in code | `tools/src/editor-ops.ts:106`, `tools/src/import-tw/map-level.ts:289`, `import-tw/run.ts:123`, `apps/web/src/editor/document.ts:21`, `editor/play-content.ts:16`, `e2e/editor-play.spec.ts:70` | 2.0.0 |
| Save format `v` | `apps/web/src/save/index.ts` (`v: 2`, 3 places) | 2 |
| `package.json` version | root has none; `tools`, `packages/{defs,content,sim,bots,net}`, `apps/{web,server}` = 8 files | 0.0.0 |
| Generated | `packages/content/schemas/*.schema.json` (embedded const), `hashes.lock.json`, `tools/levels-lock.json`, sim/bots/replay goldens | derived |
Total: 6 source constants + 3 mirrors (rules header, content.json, manifest.json) + 8 package.json + ~35 data/code `schemaVersion` sites. Test fixtures that hard-code old values (`pvp-versions.test.ts`, `versioning.test.ts`, `handshake.test.ts`, e2e-pvp `version-mismatch.spec.ts`) updated to import constants, not literals.
Also in scope (owner: "all things"): `editorVersion` (per-level server-owned save counter, patch-incremented by `editor-ops.ts:102`; absent in shipped levels [verified: grep `packages/content/data` -> none]) and `gameVersion` -- implementer verifies each: if it is our own product/app version string, set to `1.0.0` (editorVersion keeps its increment behavior from the 1.0.0 baseline); if it is external metadata (e.g. `gameVersion: '1.29.3'` = Tower War source game, per Non-Goals) leave it. Left alone, with reason: `CLOSE_VERSION=4003` and other external/protocol codes.

## Legacy Removal Inventory
Evidence = grep for legacy|compat|migrat|deprecated|tombstone|shim|v1|"older". Surprisingly little real legacy code exists; no migration functions found [verified: `decodeSave` already discards non-matching saves].
| Pkg | File | What | Why legacy | Action |
|---|---|---|---|---|
| docs | `docs/GAME_RULES.md` (§3 Retired ids ~L705-725; ~87 `v1`/`Since`/`Supersedes` lines; changelog L852-860) | tombstones, v1 history, 2.0.0-3.3.0 rows | pre-launch history | delete; single 1.0.0 row |
| docs | `AGENTS.md`, `docs/CONTENT_GUIDE.md:78`, `tools/README.md:29` | "keep tombstones" policy | | rewrite (R4) |
| tools | `src/rules.ts:10-32,81` | tombstone detection/exemption | no tombstones left | remove |
| content | `src/versioning.ts` `readBaselineVersion`, `ContentBaseline` comments ("baseline may predate schema", "older baselines") | old-baseline tolerance | no older envelope | simplify to current envelope; keep `checkContentVersion` monotonic |
| content | `scripts/bot-version.ts` (`current===undefined` "older standalone fixtures", `previous===undefined` "first implementation") | missing-bot-package tolerance | | remove first branch; keep second for brand-new base |
| content | `src/manifest.schema.ts:4,39`, `src/schemas.ts:6` | comments on "v1 / live v1 MANIFEST_SCHEMA_VERSION / beside v1", "Removed vs v1" | v1 no longer exists | rewrite comments; rename `*-v2` test files to drop the version suffix (e.g. `audio-v2.test.ts`) |
| sim | `src/replay.ts:30,111` | "incompatible replay" wording | keep logic (rules major.minor + schema/content exact is the *current* contract) | no change beyond golden regen |
| web | `editor/style.css:18-19` | `--ed-panel/--ed-ink` "compat aliases" | 7 remaining uses [verified: grep] | inline to `--ed-g-0/--ed-text`, drop aliases |
| web | `editor/EditorContext.ts:36` | "temp ... LegacyPanel" comment; no LegacyPanel exists [verified] | dead comment | delete comment |
| web | `editor/model.ts:197-202` `snapPosition/snapYaw(enabled)` | "kept only for test compatibility" | param is test-only | drop param, update callers/tests |
| web | `src/save/index.ts` `v:2` + header comment "Historical saves are intentionally discarded" | | | `v:1`; comment kept short |
| server | `src/main.ts:22,79`, `src/config.ts:19` "0 = legacy 8 s / immediate shutdown" | `DRAIN_MS=0` path | legacy shutdown mode | remove; keep only current drain behavior (update config, tests, ops docs text) |
| web | `src/render/light-rig.ts:4` ("Unity legacy lights") | | Tower War/Unity term, current | keep |
| tools | `import-tw/parse-raw.ts` v0/long refusals, `v1-short` dialect id | | foreign TW formats; current feature | keep |
| CI | `.github/workflows/ci.yml` baseline step | | | one-time override (below) |

## Architecture
**Gate adaptation (one-time baseline reset).** Guards compare vs `CONTENT_BASE`/`VERSION_GUARD_BASE`/merge-base (`tools/README.md:89`, `ci.yml` "Select content version baseline"). Reset (3.3.0 -> 1.0.0, hashes change) fails `checkContentVersion`, `checkBotVersion`. Design:
1. Add generic support for `--base none` / `VERSION_GUARD_BASE=none`: baseline treated as absent (guards already early-return when `baseline` is undefined; lock-freshness still checked). Permanent, small, tested; reusable for any future pre-launch reset.
2. Reset PR sets `CONTENT_BASE=none` in the ci.yml baseline step (commit A). Because post-merge push CI runs the merged workflow file, main stays green.
3. Next commit/PR restores normal baseline selection (commit B, may ride with SP03). From then, monotonic rules apply with 1.0.0 as history.
Rejected: relaxing monotonic checks permanently; fake-bumping to 4.0.0; committing the reset against a throwaway orphan base.

**Order of work (each step gated):**
1. Policy/docs text (R3, R4) + `rules.ts` tombstone removal + tests.
2. Version constants, package.json, data `schemaVersion`, code literals, save `v`, tests-with-literals.
3. Legacy inventory removals (web/content/tools).
4. Regenerate: `content:schemas` -> `content:lock` (hashes.lock.json; sim/bot hashes) -> `levels:lock` -> `sim:golden` -> `replay:verify golden` -> `bots:golden` -> `assets:tw`-style manifest hash if it embeds versions (`check:manifest`). Replay/golden headers embed `rulesVersion/schemaVersion/contentVersion`, so all goldens change; no mechanics change, so only header/hash-envelope diffs (review the golden diff: outcomes/ticks must be identical) [RESOLVED: OPEN-1, see Risks].
5. Full `pnpm run ci`, `pnpm test:pvp:e2e`, `pnpm campaign:verify`; ci.yml override (commit A).

**Fly/PvP.** Handshake needs exact protocol/schema/content and rules major.minor [verified: handshake.ts:22-25]. Old cached web bundle (pv 4) vs new server (pv 1) -> `version-mismatch` close 4003 -> existing "reload to update" UX. Deploy server + web in one release (`deploy-server.yml` smoke `scripts/pvp-versions.mjs` compares `/healthz` versions to the checkout, so it self-validates). Do a drain deploy (`DRAIN_MS`) to avoid killing live matches; accept room loss (nothing launched).

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Rule ids | Keep ids (e.g. R-TWR-02), drop history only | renumber from 01 | Tests' `covers R-...` tags and docs stay valid; ids are names |
| D2 | Tombstone policy | No registry; ids never reused (git history), retired rule deleted with tests | keep tombstone list | Owner: wipe history; reuse risk accepted |
| D3 | Gate landing | `--base none` + one-time ci.yml override | permanent loosening; fake 4.0.0 | Keeps monotonic check meaningful post-launch |
| D4 | Client persisted data | Discard on mismatch (current `decodeSave`), reset notice + `.bak` kept | silent clear; migration | Zero migration code; nobody has real saves. Editor has no browser autosave store (autosave is server-side file save via `__editor/save`, `useAutosave.ts`) [verified], nothing to clear |
| D5 | Rules compat window | Keep major.minor match in handshake/replay | exact match | It is the current contract, not legacy |
| D6 | Mechanism | Single branch, ordered commits above | per-package PRs | Versions/locks are mutually dependent |

## Risks / Open Questions
- Golden diff noise hides a real behavior change. Mitigate: assert tick/outcome/finalHash unchanged where hashes exclude version envelope; otherwise explain per file. Does `simHash` include `contentVersion`? [RESOLVED: implementer determines in `hash.ts`; regardless, regenerate all goldens and verify in the diff that match outcomes/ticks are unchanged]
- SP01/SP02 bumps. [RESOLVED: owner: they do normal bumps per repo rules so each commit passes gates; SP04 runs after both and overwrites everything with 1.0.0. SP02 also adds `R-ENT-05` (kept in the single 1.0.0 rules entry).]
- Stale browser tabs/old bundles during deploy. [RESOLVED: handshake refuses with reload message; e2e `version-mismatch.spec.ts` covers.]
- [OPEN-2] `package.json` 0.0.0 -> 1.0.0. [RESOLVED: yes, owner 2026-11-03]
- [OPEN-3] `editorVersion`/`gameVersion`. [RESOLVED: owner: if our own product/app version strings, set to 1.0.0; leave only external/protocol codes (CLOSE_VERSION=4003, Tower War source metadata). Implementer verifies each field]
- [OPEN-4] `DRAIN_MS=0` legacy shutdown. [RESOLVED: remove; keep only current drain behavior]
- [OPEN-5] Rename `*-v2` test files. [RESOLVED: yes, drop the version suffix; `sp0N` dir names not covered by the decision, left unchanged]
- [OPEN-6] `Supersedes:`/`Since:` removal makes `R-GRW`/`R-SPN` docs lose rationale; assumed acceptable. [RESOLVED: acceptable — owner chose full history wipe; any rationale worth keeping is captured as ADRs by SP03 docs restructure]
- CI cannot re-verify normal gating until commit B. [DEFERRED] restore with SP03; AC below covers a local `--base HEAD` run.
- Dist/prebuilt artifacts stale after constant changes. [RESOLVED: run `pnpm build:prerequisites` before gates.]

## Acceptance Criteria
- `grep -rnE "3\.3\.0|2\.6\.[01]|\"2\.0\.0\"" --exclude-dir=agent_files --exclude-dir=node_modules` -> none; all package.json `1.0.0`; `PROTOCOL_VERSION===1`; save `v:1`.
- `GAME_RULES.md` has no "tombstone", "Supersedes", "Since:", "v1" (except TW dialect names); one changelog row; `pnpm check:rules` green.
- No hits for `legacy|compat|migrat|deprecated` in `apps/ packages/ tools/` source outside the keep-list (light-rig, import-tw).
- `pnpm run ci`, `pnpm test:pvp:e2e`, `pnpm campaign:verify`, `pnpm check:content --base none`, then `--base HEAD` after commit, all green; golden diff reviewed.
- Local server + web build report identical `/healthz` versions (`node scripts/pvp-versions.mjs`) ; mismatched old client gets reload prompt.
