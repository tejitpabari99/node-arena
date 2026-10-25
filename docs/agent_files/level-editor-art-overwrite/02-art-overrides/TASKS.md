---
status: done
summary: Completed tasks 1–8 — art patch schema + three-way merge, importer scope guard, check:manifest art rules, credits warning, tintMask, art:status, showcase levels, docs.
date: 2026-10-24
---
# Tasks: Art overrides
Source of truth: [PRD.md](PRD.md). Order: merge layer first (R2-R4), then checks (R5-R6), renderer (R7), reporting (R9), showcase levels (R8, only task needing 01), docs last. Tasks 1-6 do not depend on 01; Task 7 depends on the custom-list contract. No sim/rules/content version bump is needed until Task 7.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Art patch schema + three-way merge + default sfx move | none | done |
| 2 | Importer scope guard (art/ never touched) | 1 | done |
| 3 | check:manifest art rules | 1 | done |
| 4 | Credits check becomes a warning | none | done |
| 5 | tintMask team mode (schema + renderer) | 1 | done |
| 6 | art:status command | 1 | done |
| 7 | Showcase levels (green, snow) | 5, 01 P0 (custom list) | done |
| 8 | Docs | 1-7 | done |

## Task 1 — Art patch schema + three-way merge + default sfx move
What it is / what it means: The core override layer (R2, R3, R4, D2-D4, D10). `manifest.art.json` is a sparse, whitelisted patch applied after the TW fragment inside `assets:manifest`.
What changes at a high level: Add a closed TypeBox art-manifest schema (whitelist per PRD; `kind`, budgets, ids not overridable; no nulls) and generate it via `content:schemas`. Extend the merge with an optional third art argument: objects deep-merge, arrays and scalars replace. Move the default event sfx map into the fragment/merge defaults so removing an art sfx override restores the default. Merge-CLI and the manifest self-merge check both load the art file when present and use the new three-way message. Create the empty art folders.
Done when: unit tests cover merge order, object-merge vs array-replace, idempotence, no-art no-op, and sfx default restore; `assets:manifest --check` is clean with and without a fixture patch; unknown or non-whitelisted keys are rejected.

## Task 2 — Importer scope guard (art/ never touched)
What it is / what it means: Goal 2 / R1: overrides must survive `assets:tw` re-runs.
What changes at a high level: Verify that the importer's stale-file cleanup only touches the owned directories and `manifest.tw.json`. If it can reach `art/` or `manifest.art.json`, restrict it to the owned set. Add a regression test that runs the importer cleanup over a tree containing art files and asserts they survive.
Done when: test proves `art/` and `manifest.art.json` are intact after an importer run; finding (verified safe or fixed) recorded in the commit message.

## Task 3 — check:manifest art rules
What it is / what it means: Keep art game-compatible and fail loudly (R4, R5, D5; Goal 3).
What changes at a high level: Art-owned means any manifest path starting `art/`; those are exempt from the lock walk, but an art patch pointing into the owned importer dirs is an error. Add a stale-target error for every patched key/field missing from the fragment. Warn on orphan files under `art/`. Add audio checks (exists, ogg/mp3/wav, over 1 MB warns). Extend the PNG <=256 check to fx and tintMask base/mask refs. Existing budget/stage-node/clip checks run unchanged on the merged manifest.
Done when: fixture tests pass for a valid override and fail loudly for unknown key, missing stage node, missing clip, over-budget tris, PNG >256px, art file under `models/tw`, and stale target; orphan and big-audio produce warnings.

## Task 4 — Credits check becomes a warning
What it is / what it means: Owner-made art needs no credit (R6, D8).
What changes at a high level: The uncredited-assets result moves from a thrown error to a reported warning for all assets; `CREDITED_DIRS` unchanged; `check:manifest` still exits 0.
Done when: a test with a missing CREDITS row yields a warning and exit 0.

## Task 5 — tintMask team mode (schema + renderer)
What it is / what it means: One skin plus a grey mask recoloured per team palette instead of five skins (R7, D6, D7).
What changes at a high level: Add `tintMask` to the team modes and make the merged manifest schema's `team` a union of textureSwap and tintMask (`base`, `mask`). Renderer: a per-(family, team) Lambert material tinted by the palette colour only where the mask's R channel is white; unit and building renderers derive team keys from palette teams for tintMask; manifest path/reference checks read base and mask. `textureSwap` stays default and unchanged; instancing and draw-call count unchanged.
Done when: render test shows the masked region recoloured per palette and the unmasked region unchanged; `campaign:verify` screenshots unchanged for textureSwap visuals; `sim:golden`, `replay:verify golden` and simHash unchanged.

## Task 6 — art:status command
What it is / what it means: A report of art still using original files (R9, Goal 5).
What changes at a high level: New report-only `pnpm art:status [--strict]` reading the merged manifest and listing every file-valued field whose path is not under `art/` (TW vs stock label), with a summary count line; scalars are not listed. `--strict` exits 1 while any remain.
Done when: tests cover listing, count line, and `--strict` exit codes against a fixture manifest with and without art overrides.

## Task 7 — Showcase levels (green, snow)
What it is / what it means: Two playable levels that show all art together (R8, D9). Depends on 01's custom-list contract and its optional `position` in `unsolved-by-proxy.json`; 01 also owns `validate:levels`/`levels:lock` covering custom levels.
What changes at a high level: Add `na-showcase-green` and `na-showcase-snow` to the custom list: 3 building types x 5 owners (human, 3 AI, neutral gray) with levels chosen so every stage is visible at start (verify stage thresholds in code), 2 small + 2 big obstacles, and lines so troops, tower shots, clashes and capture fx occur. Allowlist them in the unsolved list if the proxy cannot win. Ship both in one commit: `content:lock`, `contentVersion` bump, `BOT_VERSION` bump, `levels:lock`. If this lands before 01, add the minimal custom list per the PRD fallback.
Done when: both levels load from the custom list and show every type/stage/colour and both obstacle sizes; `validate:content --base HEAD`, `content:lock`, `levels:lock` pass with bumps; 20-level tests unaffected; a test loads and compiles both.

## Task 8 — Docs
What it is / what it means: Make the workflow discoverable (PRD Risks: node/clip naming).
What changes at a high level: CONTENT_GUIDE art section: folder layout, patch shape and whitelist, merge semantics, tintMask mask format, Blender export notes (stage nodes, Run/Death clips, small/big obstacle nodes, budgets), showcase levels, art:status. Add `art:status` and art notes to the tools README (coordinate with 01's edits) and a note that the credits check is now a warning.
Done when: `check:docs` passes; every new command and rule above is documented once.

## Closing note — manual steps (owner)
Author GLBs in Blender (within budgets; building stages as nodes `stage0..2`; unit clips `Run`/`Death`; obstacle nodes `small`/`big`) and textures in Krita (<=256px PNG; tintMask grey mask). Then run `pnpm assets:manifest`, `pnpm check:manifest`, reload a showcase level, and commit. Tune tintMask colour once on the showcase if it shifts versus the palette.
