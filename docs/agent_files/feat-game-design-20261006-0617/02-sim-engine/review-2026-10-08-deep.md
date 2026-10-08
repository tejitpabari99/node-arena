---
status: done
summary: PASS after fixes — deep spec review; 2 replay fixes (ca53b9d)
date: 2026-10-08
---
# Review — 2026-10-08 — SP02 deep spec-compliance review
Diff: `16f0a93..4615945`   Personas: Bug Hunter, Security, Architect   Follow-up: `ca53b9d`

## Verdict: PASS (after fixes)
Architect walked every Req 1–6, AC 1–6, Decision 1–14, Task 1–13, API/SimView/phase/registry/lint/replay/golden/property/bench rows: all met; R-ID set == `covers` test set (28/28). Security: PASS. Bug Hunter: mechanics verified with scratch scenarios (ring wrap, slot cut, round-robin, simultaneous arrivals+capture, timeout precedence); 1 must-fix + 1 note in replay, both fixed and re-reviewed PASS.

## Fixed
- [Bug Hunter] `packages/sim/src/replay.ts:107` — `playReplay` required exact rulesVersion; spec requires major.minor match only (patch bump would refuse all replays). Now major.minor; schema/content versions still exact.
- [Bug Hunter] `packages/sim/src/replay.ts:114` — early GameOver during playback threw instead of returning first diverging tick. Now returns `{ok:false, divergingTick}`.

## Notes (non-blocking, not changed)
- `index.ts` exports more than the PRD's allowed surface (SimState, registry types) — needed for extensibility; SP03/SP04 should stick to the PRD list.
- `readTroops` channel = `from*N+to`; cut channels have no `view.lines` entry — SP03 must decode key; undocumented in code.
- `playReplay` takes `{metadata, level|resolveLevel}` rather than raw content.
- `economy.ts:37` literal `1000 * TICK_RATE` (rules constant, not tunable).
- 3 "full-level" goldens use hand-built mini levels (campaign not authored yet).
- `CutLine` on non-existent line rejects as `unknown-id`.
- `CompiledLevel.componentNames` added to SP01 compile for parity check (contract addition).
- [Security] `step()` throws on non-array input; very deep replay JSON throws RangeError — wrap at server boundary (v3).

## Verification
content 232/232, sim 152/152 (incl. Chromium parity), lint, check:schemas, check:content, 11 goldens all pass.

## Next step
SP02 done.
