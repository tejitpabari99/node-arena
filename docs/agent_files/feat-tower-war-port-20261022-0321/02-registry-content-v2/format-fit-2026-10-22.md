---
status: done
date: 2026-10-22
task: 02-registry-content-v2 / Task 8 (post-05 format-fit review + lock regen)
---

# Format fit: 20 imported levels vs level v2 schema

**Summary:** no schema gaps. `pnpm content:lock` is a no-op (20 levels, 30 bots; lock already current from 05 Task 7). `validate:content --base HEAD`, `check:content --base HEAD`, `check:schemas` green. Every level loads, `requires` matches the derived set, and `simHash` is stable across two independent load+compile runs.

## Findings
- Warnings (logged only, by design): 17 elements outside `bounds` - levelview-10 (8), levelview-182-nb (9). Obstacle parents reach beyond the building AABB + pad; matches PRD R4.
- Footprint overlap warnings: none. Coincident buildings / elements: none.
- Per-instance obstacle `footprint` + `yawDeg` + `variant` (`small|big`) present on every element of every level with elements (levels with 0 elements: 1, 5, 6, 12, 13, 16, 19). Element `params` unused. Fits R4 as written.
- Building `params` overrides all valid: `grows.growTime 2000` (11, 12, 13, 14, 15, 16, 17, 19, 20, 8-es), `level.maxLevel` 34 (14), 35 (3-ab), 65 (15, 16, 17), 99 (12).
- Bot blocks: all `kind: tw`, `behavior: full`, script lengths 0-2; building refs resolve.
- Themes: `green` / `snow` only (snow: 100-es, 19, 20). Objective `captureAll`, `timeLimitSec: null` everywhere.
- `source`: dialect `v1-short` (18) or `prefab` (100-es, 182-nb); `dropped` lists present.
- Campaign `common.json` references all 20 levels (loadContent cross-ref passes).

## For 04 (sim footprints)
- Overlap warning is currently vacuous (no overlaps with present archetype footprints); re-check once 04 writes real building footprints, since every element carries a per-instance box footprint that will participate.
- Buildings use archetype footprint only (no per-instance building footprint in schema); not needed by any level.

## Test fix
`tools/test/gates.test.ts` "regenerated sim lock still requires a contentVersion increase over explicit baseline" now builds its fixture from `git archive HEAD packages/content` so it matches the `--base HEAD` baseline regardless of working-tree state.
