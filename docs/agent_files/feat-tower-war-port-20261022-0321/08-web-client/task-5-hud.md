---
status: done
summary: TW battle HUD, paused restart dialog and winner-aware result actions implemented; Chromium flow checks and scoped types/lint pass.
date: 2026-10-23
---
# Task 5 — In-play HUD and popups

- Back opens the restart overlay through `app.pause()`; Restart / Continue / Levels use the existing controller lifecycle. The overlay captures pointer events, traps Tab/Shift+Tab and restores focus to its trigger. Escape uses the shell's existing handler.
- Ownership reads only public `sim.view` through the Task 3 building-level share function; player-index keyed segments use manifest palette colours and 200 ms width transitions. Controller tick publications already cap ordinary HUD rendering at 10 Hz; frame rendering does not await Preact.
- Level name sits below the ownership capsule; the corner sound control writes both mute flags. No speed or booster controls.
- Result victory requires `winner === human index`. Victory offers Next level / Replay / Levels; the last level offers All levels complete / Replay / Levels. AI wins, null-winner draws and timeouts show Defeat / Retry / Levels. Completion/unlock persistence stays in the tested controller/save layer.
- Shared source-owned `ui/assets.ts` URLs replace forbidden Vite imports from `publicDir` in HUD and Picker. A parity test checks every URL against the locked UI manifest; imported art/locks unchanged.
- The browser fixture exposed a shell mount/boot race: an immediately resolved boot published before `useEffect` subscribed, leaving Loading battle visible. `App` now installs its subscription with `useLayoutEffect`; the fixture mounts before boot to regress this.

## Verification

Test-first Chromium failure after selecting level 1: Back button absent with the shell placeholder. Implemented HUD then passed. A separate mount-before-boot regression failed waiting for level 1 while the UI stayed on Loading battle; synchronous subscription installation passed it.

- `pnpm --filter @node-arena/web exec vitest run test/sp08/hud-browser.test.ts test/sp08/hud-assets.test.ts test/sp08/ownership.test.ts test/sp08/picker.test.ts test/sp08/state-v2.test.ts test/sp08/save-v2.test.ts`: 6 files, 23 tests pass.
- Chromium checks: initial two-colour ownership/permille/transition; Back freezes real driver ticks; focus trap and restoration; Continue; Restart resets tick; Levels returns to picker; mute writes both flags; injected human/AI/null/timeout results through real controller; completion unlock and Next; Replay and Retry; final-level variant; popup fits 1280×720 and 2560×1080; no browser exceptions.
- `pnpm --filter @node-arena/web exec tsc -p tsconfig.sp08-shell.json --pretty false`: pass. Also checked HUD tests and TSX fixture with a temporary extending config; pass, temporary file removed.
- Targeted ESLint on all changed UI source/test files: pass.
- Full existing web TypeScript check remains red in obsolete legacy tests/e2e using removed screens, fields and sim types. Those belong to Task 9; no full CI or intermediate implementation review run.

## Visual evidence

Actual Preact browser captures in branch `ref/out/`: `task-5-hud.png`, `task-5-restart.png`, `task-5-victory.png`, `task-5-defeat.png`, `task-5-complete.png`. `task-5-hud.compare.png` and `task-5-victory.compare.png` pair captures with original `d-hud-topbar-18.jpg` and `d-victory.jpg`; inspected. Reproduce with the Chromium test above.

White curved Back arrow, pill border/bright team colours, outlined Coiny text, extracted lavender panel and green/gray action art follow Task 2's landscape contract. Victory uses the approved panel/action layout; portrait reference region/currency decoration is outside this shell. These captures intentionally isolate UI over a plain fixture backdrop; integrated renderer acceptance remains Task 9. Owner final visual approval remains.
