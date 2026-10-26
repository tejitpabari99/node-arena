---
status: done
summary: Six tasks - schema field, server bump/no-op save, duplicate op, client copy/blank hygiene, 30s autosave, save-first Finalize.
date: 2026-10-26
---
# Tasks: SP02 Level versioning and save semantics
Source of truth: `docs/agent_files/feat-editor-chrome-polish-20261026-1553/02-versioning-save/PRD.md`. Server-authoritative `editorVersion` (0.0.N) bumped only on real saves; no sim/hash/lock impact. Landing order 01 -> 02 -> 05 -> 04 -> 03; SP03 consumes this.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Schema field and key order | - | done |
| 2 | Server save: bump and no-op | 1 | done |
| 3 | Duplicate op and client API | 2 | done |
| 4 | Client copy/blank and savedRef | 3 | done |
| 5 | Autosave 30s | - | done |
| 6 | Finalize saves first | 4 | done |

## Task 1 — Schema field and key order
What it is / what it means: Level JSON may carry optional `editorVersion` ("0.0.N"). Metadata only, outside `simHash` (R1, D6, D9).
What changes at a high level: Add optional pattern-checked field to `LevelSchema`, place it after `name` in `KEY_ORDER.level`, regenerate the JSON schema. `schemaVersion` stays 2.0.0. Verify the content gates do not flag the field; if one does, exempt `editorVersion` there.
Done when: `pnpm content:schemas && pnpm check:schemas` clean; `validate:content --base HEAD`, `check:content --base HEAD`, `check:manifest`, `validate:levels` pass with no version/lock edits; schema test rejects "1.0" and "x"; serialize places the key deterministically.

## Task 2 — Server save: bump and no-op
What it is / what it means: The server decides version and whether anything changed (R2-R6, D1-D4).
What changes at a high level: In `editor-ops.ts` `save()`, ignore any client `editorVersion`. No file on disk: write 0.0.1. Disk differs (canonical serialization minus `editorVersion` on both sides): patch+1, missing counts 0.0.0. Equal: no level write, no bump, return on-disk doc; if campaign entry missing, write campaign only. Response adds `changed`. Runs inside the existing per-root chain. Update `save.test.ts` (first save, bump, identical re-save untouched, legacy, forged version, parallel monotonic; existing byte-stable and drift tests ignore version) and middleware save-response test.
Done when: those vitest cases pass; `tools/test/custom-levels.test.ts` green; `pnpm test` green.

## Task 3 — Duplicate op and client API
What it is / what it means: Atomic server-side copy for SP03's Duplicate (R9, D5, D10).
What changes at a high level: Add `duplicateEditorLevel` in `editor-ops.ts` within the same chain: read saved source from disk, pick first free `<stem>-copy`, `-copy-2`, ... (na- prefix, <=43 chars, trim trailing hyphens, skip files and campaign ids), save with copy semantics, keep name, version 0.0.1. Add `POST /__editor/duplicate {id}` in the middleware (CSRF headers, jobs gate 409). Extend `api.ts` with `saveLevel` returning `changed`, `duplicateLevel`, and `versionOf`.
Done when: middleware tests cover happy path, `-copy-2` collision, 40-char truncation, non-`na-` source, CSRF, 409 gate; ids match `^na-[a-z0-9-]{1,40}$` and appear in `custom.json`.

## Task 4 — Client copy/blank and savedRef
What it is / what it means: Client never writes the version; saved state carries the server's (R10, D3).
What changes at a high level: `blankDocument` omits `editorVersion`; `copyDocument` deletes it alongside `source` (covers `?template=` flow). In `Editor.tsx`/save-core set `savedRef` from the response level, so net-zero canonical edits clear dirty and undo-to-saved is not dirty. Expose `doc.editorVersion` from the saved doc for SP03.
Done when: `shell.test.ts` asserts no `editorVersion` on blank/copy; test that a `changed:false` response clears dirty; vitest editor suite green.

## Task 5 — Autosave 30s
What it is / what it means: Quieter autosave now each save may bump a version (R7, D7).
What changes at a high level: `AUTOSAVE_MS = 30000` in `useAutosave.ts`, comment updated; `shouldAutosave` gating unchanged. Update `editor-shell-ui.spec.ts` (rename, `runFor(30100)`, re-check 15000 negative checks near line 95) and any unit test pinning 5s.
Done when: Playwright `editor-shell-ui` shows no save at 5s/15s and a save at 30s after a manual save plus dirty edit; vitest green.

## Task 6 — Finalize saves first
What it is / what it means: Finalize no longer needs a manual Save step (R8, D8).
What changes at a high level: `finalize()` in `Editor.tsx` awaits `doSave('manual')` through the queue; abort with issues shown if save fails or doc invalid, else finalize with `savedRef.current` (includes version, so the 409 equality holds). Remove the dirty-disable in `JobPopovers`. Logic only, no chrome.
Done when: `shell.test.ts` asserts button not disabled when dirty; `editor-finalize.spec.ts`: dirty valid doc saves then streams, invalid doc aborts without POST finalize; `pnpm test`, `lint`, `typecheck` pass.
