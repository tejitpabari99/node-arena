---
status: draft
summary: Server-authoritative editorVersion (0.0.N) bumped on real saves, 30s autosave, Finalize-saves-first, no-op unchanged saves, and a server Duplicate op for the topbar.
date: 2026-10-26
---
# PRD: SP02 Level versioning and save semantics
Repo/branch: node-arena / `feat/editor-chrome-polish` · Depends on: none · Consumed by: SP03 topbar-menus
Owns: `packages/content/src/schemas.ts` (+ generated `packages/content/schemas/level.schema.json`), `packages/content/src/key-order.ts`, `tools/src/editor-ops.ts`, `apps/web/src/dev/editor-middleware.ts`, `apps/web/src/editor/{api.ts,save-core.ts,useAutosave.ts,document.ts}`, finalize flow in `Editor.tsx` (logic only), tests under `apps/web/test/editor/`, `tools/test/custom-levels.test.ts`, `apps/web/e2e/editor-shell-ui.spec.ts`.

## TL;DR
- Level JSON gains optional `editorVersion` ("0.0.N"). Server save bumps it only when content really changed. Client never writes it.
- Autosave 5s to 30s. Finalize saves first, then finalizes; no longer blocked by dirty.
- New server op `duplicate` creates `<id>-copy[-N]`, version 0.0.1, returns the doc for SP03 to open.
- No rules/sim/hash impact: field is metadata, outside `simHash`.

## Problem
- No visible revision for a custom level; users cannot tell if a save landed or how many times a level changed.
- Autosave every 5s (`useAutosave.ts:4`) is noisy once each save bumps a version.
- Finalize is disabled while dirty (`JobPopovers.tsx:67`, guard `Editor.tsx:150`), forcing a manual Save step.
- Copy exists only as a FileModal flow with a user-typed id (`FileModal.tsx:48-53`, `document.ts:copyDocument`), producing an unsaved doc.

## Goals / Non-Goals
Goals: bump-on-real-save; no-op on unchanged; 30s autosave; Finalize = save then finalize; Duplicate server op; new/copy start 0.0.1.
Non-goals: UI chrome (SP03 renders version/status/menus); user-editable version; persisted check state; rename/delete; changing rules or content versions.

## Requirements
| # | Requirement |
|---|---|
| R1 | Level schema accepts optional `editorVersion` matching `^\d+\.\d+\.\d+$`. |
| R2 | `saveEditorLevel` ignores any client-supplied `editorVersion`; it sets the value from disk. |
| R3 | No file on disk (new / copy): written as `0.0.1`. |
| R4 | File on disk, canonical content (minus `editorVersion`) differs: write with patch+1 (missing field counts as `0.0.0`, so first save gives `0.0.1`). |
| R5 | File on disk, canonical content equal: no level write, no bump; response returns the on-disk doc. |
| R6 | Save response always includes `level` (with `editorVersion` when present on disk) and `warnings`; adds `changed: boolean`. |
| R7 | `AUTOSAVE_MS = 30000`; comment updated. Gating in `shouldAutosave` unchanged. |
| R8 | Finalize: save first (manual-source, queued), abort with issues shown if save fails or doc invalid; else run finalize on the saved doc. Button not disabled by `dirty`. |
| R9 | `POST /__editor/duplicate {id}` reads the saved source from disk, picks first free `<id>-copy`, `-copy-2`, ..., saves it (copy semantics), returns `{level, warnings}`. |
| R10 | Imported/read-only fields stay as today: copy drops `source`; imported (non `na-`) levels never receive `editorVersion`. |

## Architecture
```jsonc
// level.json (new, optional; after "name" in key order)
"editorVersion": "0.0.7"
// TypeBox: editorVersion: Type.Optional(Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+$', 'x-presentation': true }))
```
Evidence and design:
- **Schema.** `LevelSchema` is closed (`schemas.ts:110`, `options('level')`), so an unknown key fails today. Add the optional field there, add to `KEY_ORDER.level` (`key-order.ts:7`) so `serializeLevel` places it deterministically (unknown keys otherwise trail, `serialize.ts:ordered`), then `pnpm content:schemas`.
- **Hash/version impact.** `computeSimHash` hashes an explicit field list (`compile.ts:70-78`); `compileLevel` copies explicit fields (`compile.ts:121-126`), so the field never reaches sim or `simHash`. Per `docs/CONTENT_GUIDE.md:35,76,197`, metadata outside `simHash` needs no lock change and no `contentVersion`/`RULES_VERSION`/`BOT_VERSION` bump; `levels:lock` pins sim outcomes only. Every autosave therefore never makes locks stale. `schemaVersion` literal (`schemas.ts:7`): see Decisions D6.
- **Bump location: server.** `save()` in `tools/src/editor-ops.ts:41-` already holds `originalLevel` (disk text), runs under a per-root promise chain (`pending` map, line 17) and the middleware job gate (`acquireSave`, middleware ~L130). Both the read of disk version and the write happen inside that serialized section, so autosave + manual races cannot double-bump or skip. Client-side bump would race and could not detect disk equality.
- **No-change test.** After `validateEditorDocument` (canonical, `requires` recomputed) serialize via `serializeLevel` with `editorVersion` removed from both candidate and parsed `originalLevel`; compare strings (same canonical writer, so key order cannot cause false diffs). Equal and campaign entry present: return early (no temp files). Equal but campaign entry missing: still write campaign only, no bump.
- **Client dirty vs changed.** `isDirty` (`save-core.ts:13`) compares `present` vs `savedRef` via `stableStringify`. `savedRef` is set from the server response (`Editor.tsx:91`), so it carries the server version and `present` derives from it: undo back to the saved state gives equal docs, so not dirty (Saved), and no save fires. Edit then manual Save with net-zero change after canonicalization (e.g. float rounding) is dirty client-side but server no-op; client sets `savedRef = response.level` so it clears.
- **Queue.** Reuse `createSaveQueue` (`save-core.ts:33`): a save queued behind an in-flight one only runs if still dirty. Finalize calls `doSave('manual')` and awaits it.
- **Finalize path.** Server compares `isDeepStrictEqual(readLevel(id), value.level)` (middleware ~L150). The client sends `savedRef.current` (the save response), which includes `editorVersion`, so equality holds. Finalize does not rewrite the level file (`editor-finalize.ts` runs lock/bump tools only), so it does not bump `editorVersion`.
- **Duplicate.** New `duplicateEditorLevel(contentDir, sourceId)` in `editor-ops.ts` inside the same `pending` chain: read source JSON, compute id, call `save(root, newId, srcDoc, copy=true)`. Id rule: `base = id`; if `id` not `na-` prefixed, `na-${id}`. Candidate `${stem}-copy` then `-copy-2..`; stem truncated so total <= 43 chars (`^na-[a-z0-9-]{1,40}$`), trailing hyphens trimmed; skip existing files and campaign ids. Doc name gets `" (copy)"`? No: name unchanged (D5). Source content of `source` dropped by existing copy path (`editor-validation.ts:copy`). `editorVersion` of the source is discarded, new file = R3.
- **API surface for SP03** (`api.ts`):
```ts
saveLevel(level): Promise<{ level: LevelDoc; warnings: ContentIssue[]; changed: boolean }>
duplicateLevel(id: string): Promise<{ level: LevelDoc; warnings: ContentIssue[] }>   // level.id = new id
export const versionOf = (d: LevelDoc) => d.editorVersion ?? '0.0.0';  // display helper
```
  Editor state exposed (for SP03): `doc.editorVersion`, `saveState`, `doSave`, `finalize()` (now saves first). Version display reads `savedDoc` version (the on-disk value), not `present`.
- **Copy/New (FileModal).** `blankDocument` omits `editorVersion` (first save gives 0.0.1); `copyDocument` must `delete copy.editorVersion` alongside `source`; server stamps R3 anyway (defence in depth). `?template=` create flow (`useInitialLoad.ts`) uses `copyDocument`, so it is covered.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| D1 | Bump owner | Server in `save()` | Client in save-core | Serialization and disk comparison already live in `editor-ops.ts`; client can't see disk |
| D2 | Change definition | Canonical content minus `editorVersion` differs from disk | Client dirty flag; byte compare | Matches what Finalize/lock see; canonical writer removes key-order noise |
| D3 | Client-supplied version | Ignored/overwritten | Trust client | Read-only in UI; prevents drift/tampering |
| D4 | Missing field on existing level | Treated 0.0.0; unchanged save writes nothing, stays 0.0.0 | Backfill on any save | Locked rule: no-change = no-op |
| D5 | Duplicate impl | New server op `duplicate` over saved disk copy | Client `copyDocument` + `saveLevel(copy)` | Atomic free-id pick under the save chain, no id race, one round trip |
| D6 | `schemaVersion` | Keep `2.0.0` (additive optional field) | Bump to 2.1.0 | A bump needs a literal change in every level + lock; field is optional so old files stay valid. Resolved: no bump |
| D7 | Autosave | 30000ms; same arming rules | Debounce-on-edit | Locked decision; minimal change |
| D8 | Finalize save failure | Abort, surface save issues via existing chip/validation, do not call finalize | Finalize anyway | Finalize requires disk == draft (middleware 409) |
| D9 | Lock interaction | None; version excluded from hashes | Include in lock | Lock covers sim identity; versions change every save |
| D10 | Duplicate name | Keep source name | Append " copy" | Name is edited in LeftPanel (SP04 owns); avoid scope. Revisit with SP03 |

## Risks / Open Questions
- [RESOLVED: verify in implementation task; if gate flags, exempt editorVersion.]
- [RESOLVED: no bump; schemaVersion stays 2.0.0.]
- [RESOLVED: save-then-duplicate sequencing owned by SP03 (awaits `doSave` first).]
- [RESOLVED: Duplicate disabled for never-saved doc: yes.]
- [RESOLVED: git dirtiness on committed na-* levels accepted.]
- [RESOLVED: server queue + `createSaveQueue`] Autosave vs manual race.
- [RESOLVED: sim hash excludes unknown metadata, `compile.ts:70`] No replay/golden impact.
- [RESOLVED: undo to saved state is not dirty] via `isDirty` stable compare.
- [DEFERRED] Persisted check state, version history/rollback.

## Tests
- `apps/web/test/editor/save.test.ts`: first save writes 0.0.1; changed save bumps; identical re-save leaves file mtime/bytes and version, `changed:false`; legacy file without field + real change gives 0.0.1; client-forged version overwritten; parallel saves yield monotonic, non-skipping versions; existing "second save byte-stable" test (line 30) and drift comparisons must ignore `editorVersion`.
- `middleware.test.ts`: `/__editor/duplicate` happy path, `-copy-2` on collision, truncation at 40-char ids, non-`na-` source, CSRF headers, jobs gate 409; save response has `changed`.
- `tools/test/custom-levels.test.ts` / schema check: `check:schemas` passes; `editorVersion` pattern rejects "1.0", "x".
- `shell.test.ts`: `copyDocument`/`blankDocument` carry no `editorVersion`; Finalize no longer disabled when dirty (JobPopovers prop contract).
- `editor-shell-ui.spec.ts:99`: rename to 30s; `runFor(30100)`; earlier 15000 negative checks stay valid (re-check line 95).
- `editor-finalize.spec.ts`: dirty doc + Finalize saves then streams; invalid doc aborts without POST finalize.

## Acceptance Criteria
- [ ] `pnpm content:schemas && pnpm check:schemas` clean; `editorVersion` in schema and key order.
- [ ] `pnpm validate:content --base HEAD`, `check:content`, `check:manifest`, `sim:golden`/`replay:verify golden` unchanged (no version/lock edits needed).
- [ ] New level saved twice with an edit between: 0.0.1 then 0.0.2; saved twice with no edit: stays 0.0.1, file untouched.
- [ ] Legacy level reports no `editorVersion` (UI shows 0.0.0), becomes 0.0.1 after first changed save.
- [ ] Autosave fires at 30s (not 5s) after one manual save and a dirty edit.
- [ ] Finalize on a dirty valid doc saves then finalizes; on an invalid doc aborts with issues.
- [ ] Duplicate returns `<id>-copy`, then `<id>-copy-2`; ids always match `^na-[a-z0-9-]{1,40}$`; registered in `custom.json`; version 0.0.1.
- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck` pass; vitest editor suite (103) plus new cases green.
