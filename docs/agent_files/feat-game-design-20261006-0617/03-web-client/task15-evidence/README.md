# Task 15 verification evidence

All runs use the feat/game-design linked worktree, Node/pnpm as pinned by the repo,
Chromium/SwiftShader, and one browser worker. These are local CI-compatible checks;
no remote CI run is claimed.

| File | Command / contents |
|---|---|
| [0.log](0.log) | `pnpm test`: content 232, sim 152, web 125 passed; 509 total, zero skipped |
| [1.log](1.log) | `pnpm build` |
| [2.log](2.log) | `pnpm lint` |
| [3.log](3.log) | `pnpm check:schemas` |
| [4.log](4.log) | `pnpm check:content --base 343593c` |
| [5.log](5.log) | `pnpm sim:golden`: 11 replays verified |
| [6.log](6.log) | `pnpm bench:sim`: all active/event-parity/performance budgets pass |
| [preview.log](preview.log) | Full preview Playwright: 13 passed, 12 skipped |
| [dev.log](dev.log) | Full dev Playwright: 25 passed, zero skipped |
| [portable-build.log](portable-build.log) | Build/typecheck after making three legacy dev imports location independent |
| [portable-lint.log](portable-lint.log) | Lint after that test-only change |
| [portable-dev.log](portable-dev.log) | All three affected dev tests re-run successfully |
| [preview-full-runtime-stress.json](preview-full-runtime-stress.json) | Every measured synchronous full-runtime CPU sample and draw count, plus troop/memory data |
| [dev-full-runtime-stress.json](dev-full-runtime-stress.json) | Same for dev |
| [preview-full-runtime-lifetime.json](preview-full-runtime-lifetime.json) | Warm GPU baseline, all retired contexts, menu DOM/listener/rAF baseline |
| [dev-full-runtime-lifetime.json](dev-full-runtime-lifetime.json) | Same for dev |
| [commands.json](commands.json) | Root gate command exit codes |

The 12 preview skips are pre-existing isolated source-module fixtures: app-flow,
assets, audio, five input tests, lines/fx, scene, towers, and troops. Their imports
require Vite dev transport. Every one passes in dev. The eight new acceptance
checks use the real application shell in **both** preview and dev and have no skips.

Reproduction: `pnpm test:web:all` builds once and runs both full browser suites
sequentially. Detailed baseline/performance interpretation is in
[the full-scene spike report](../spike-full-scene-2026-10-08.md).
