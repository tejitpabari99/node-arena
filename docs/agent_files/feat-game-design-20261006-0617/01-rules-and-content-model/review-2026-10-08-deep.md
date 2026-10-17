---
status: done
summary: PASS after fixes — deep spec review; 2 correctness fixes (ddf9dda)
date: 2026-10-08
---
# Review — 2026-10-08 — SP01 deep spec-compliance review
Diff: `656d0ca..16f0a93` (+ current HEAD of packages/content)   Personas: Bug Hunter, Security, Architect   Follow-up: `ddf9dda`

## Verdict: PASS (after fixes)
Architect walked every Req 1–9, AC 1–7, Decision 1–16, Task 1–12 "Done when": all met. Security: PASS. Bug Hunter: 2 verified bugs, fixed and re-reviewed PASS.

## Fixed
- [Bug Hunter] `packages/content/src/fixed-point.ts:41` — 3-decimal check used absolute tolerance 1e-9; valid large values (e.g. 16392.331) falsely rejected, 1e-13 silently → 0. Now exact `Math.round(x*1000)/1000 === x`; verified exhaustively over all int32/1000 values.
- [Bug Hunter] `packages/content/src/validate-content.ts:114` — coincident towers with footprintRadius 0 passed overlap check (zero-length line). Identical positions now always flagged.

## Notes (non-blocking, not changed)
- PRD says footprints "non-overlapping (+margin)"; code allows touching (documented in CONTENT_GUIDE as deliberate).
- Campaign order check accepts any contiguous prefix 1..N; SP05 must assert exactly 20 levels.
- Human player with `botProfile` accepted and ignored.
- simHash uses explicit field whitelist (`hash.ts:212`), not `x-presentation` tags; new sim-relevant fields need `hashCompiledLevel` update.
- [Security] Level arrays have no `maxItems`; sim `create` allocates n² channels — cap before v3 server accepts untrusted levels.

## Verification
content 232/232, sim 152/152, lint, check:schemas, check:content, sim:golden all pass.

## Next step
SP01 done.
