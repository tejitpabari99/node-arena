---
status: done
summary: Integrated HUD/L4 reference captures, measured 720-troop presentation budgets, and restored web gates.
date: 2026-10-23
---
# Task 10 — Visual pass, performance, web gates

## Visual evidence

`ref/out/task-10-*` captures the actual application entrypoint: picker; original L04 (displayed Level 1) with HUD at 1280×720, 1600×900, 1920×1080, 1366×768 and 2560×1080; restart; victory; defeat. Result captures submit a legal public driver command to Task 8's test-only win/loss fixture; they do not prove a campaign playthrough. Three side-by-side sheets compare L04, `d-hud-topbar-18` and `d-victory` references. Capture completed with zero uncaught page errors.

Inspected final screenshots against original references and Task 2's landscape layout: white curved back arrow, blue outline, white capsule ownership border, bright team colours, outlined rounded display lettering, readable unmirrored building labels, and top HUD margins retained. Popup uses the previously selected extracted panel and green/grey action sprites. Keyboard focus outline deliberately remains visible.

Differences needing owner visual approval: reference L04 has larger screen coverage and dense edge scenery; the integrated level has smaller central buildings and plain grass/sand edges. Reference victory has hero/banner/confetti presentation; the approved Task 5 popup uses the simpler selected panel/actions. No new world/content/art changes were made in this acceptance task. Landscape layout follows Task 2 rather than portrait placement.

Reproduce: `pnpm assets:capture:web`.

## Performance evidence

`ref/out/perf-shell.{json,png}` uses the actual `createAppController`, `createLevelScene`, `mountApp` and HUD with SP07's synthetic public SimView/troop-buffer population. Simulation/bot throughput is outside this presentation measurement. The legacy standalone perf scene reuses the same fixture; its stage column now follows the real one-based view contract.

| Measurement | Result |
|---|---:|
| Population | 720 troops (600 soldiers, 120 tanks), 20 buildings, 36 lanes, 4 colours |
| Viewport | 1600×900, DPR 1 |
| HUD publication + Preact commit median | 0.0300 ms/update |
| Largest measured batch average | 0.3600 ms/update |
| HUD warmup / measured samples | 400 updates / 2,000 updates (200 batches × 10) |
| World update median | 0.6000 ms (100 samples) |
| Software frame median / mean | 450.4 / 498.2 ms (20 samples after 5 warmups) |
| Triangles | 236,550 (<300,000 budget) |
| Total / instanced unit draw calls | 197 / 52 |

Each HUD update includes two public controller ticks, snapshot publication, ownership computation, asynchronous Preact DOM commit and an assertion that committed segment widths match changed building-level ownership. Batched timing avoids Chromium's 0.1 ms timer resolution masking individual updates. Canvas rendering never waits on this measurement loop. The measured canvas frame includes troop movement, world update, render and synchronous `readPixels` to complete queued GL work; textures and fonts are warmed first.

Renderer identifies itself as ANGLE Vulkan SwiftShader Device (Subzero): **software rasterization**, not evidence of hardware 60 fps. Retain SP07's LOD and dropped player quality setting; software timing alone cannot justify a new hardware quality control. Real GPU 60 fps remains an owner check.

Reproduce: `pnpm assets:capture --scene perf-shell --out docs/agent_files/feat-tower-war-port-20261022-0321/08-web-client/ref/out`. Capture asserts HUD median <1 ms and triangles ≤300,000.

## Gate wiring

Root `test`, `build` and `typecheck` include web again. CI runs full web build/typecheck/tests, including SP07 tests and new SP08 browser fixtures; duplicate isolated SP07 CI steps are removed. Dedicated production/development browser suites remain `test:web:all`. UI sprites/font/manifest use the existing 12-output hash check through `assets:ui:check`; CI now runs it. `PARKED=()` and strict parked check passes. Obsolete root slice command and deleted visual-tool lint reference removed.

Targeted verification: capture-tool ESLint, actual entrypoint captures, synthetic population + actual shell perf capture, `assets:ui:check` (12 outputs), and `check:parked --strict` passed.

Final integrated verification ran once after Task 9 commit `de54c3c`, on Node v22.23.3:

```sh
CONTENT_BASE=f00e30883f24b07f84a6c3875a616eab2c659ee2 VERSION_GUARD_BASE=f00e30883f24b07f84a6c3875a616eab2c659ee2 pnpm run ci
CI_RELEASE=1 pnpm check:parked --strict
```

Both exit 0. CI covers lint; defs/content/sim/bots builds; real production web build; all six workspace typechecks; every live package test; schemas, content versions/hashes, manifest/assets/credits, UI lock, active rules, levels, replay, goldens and performance. Tools build is its same no-emit typecheck. Root script wiring includes exactly these full package sets, so redundant root build/typecheck/test reruns were unnecessary.

| CI suite | Passed | Skipped |
|---|---:|---:|
| defs | 11 | 0 |
| content | 82 | 0 |
| sim + sim golden tests | 217 + 5 | 0 |
| bots + bot golden tests | 79 + 5 | 0 |
| tools + replay + rule tests | 135 + 5 + 1 | 19 source-dependent |
| web | 194 across 27 files | 0 |
| **Total** | **734** | **19** |

All failures/cancellations: zero. Campaign gate: 20/20 levels, four seeds, five already recorded proxy-unsolved. Replay: 22/22; goldens: 19 sim + 3 bot. Sim stress/realistic/geometry benchmarks within CI budgets; bot p95 0.00124 ms against 5 ms CI allowance. `check:import` explicitly skipped because `TW_EXTRACT` is unset. Strict parked check: empty list and no parked artifacts.

Reuse Task 9's fresh `pnpm test:web:all` success: **17 production-preview + 17 development browser tests**, including 200 level/viewport combinations, visible model/label bounds, gestures and content hash parity. No application code changed afterward; no duplicate browser run.

Evidence logs: `/tmp/sp08-ci-final.log` and `.status` (0), `/tmp/sp08-parked-final.log` and `.status` (0), `/tmp/sp08-web-all-final.log`, `/tmp/sp08-visual.log`, `/tmp/sp08-perf.log`, `/tmp/sp08-capture-lint.log`. Production build emits the existing >500 kB advisory; browser scenes emit existing texture-before-image warnings, with no uncaught page errors.

## Owner / deferred checks

Final visual approval; mouse/trackpad feel; real GPU 60 fps. Existing five proxy-unsolved levels remain SP09 campaign acceptance work. No rules, content identities or goldens changed. SP09 broad docs, Node 22/24 matrix and campaign verification remain out of this task's scope.
