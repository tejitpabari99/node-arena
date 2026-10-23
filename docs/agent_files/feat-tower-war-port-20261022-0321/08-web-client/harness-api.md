---
status: done
summary: SP08 Task 8 dev/test browser harness contract for Task 9
date: 2026-10-23
---
# Browser harness v2

Only development or `VITE_TEST_HOOKS=1` builds import harness code. Ordinary production has no hooks, fixture logic or query handling. `window.__na` exists once the app controller is mounted. Wait for `__na.screen === 'playing'` after autoload, or `picker` without a level.

URL examples:
- `/?test=1`: real picker/save, manual stepping (no RAF).
- `/?test=1&level=20&seed=73&speed=2`: isolated in-memory save, previous 19 campaign entries completed, level 20 started at tick 0.
- `/?level=10&seed=1`: dev/test visual capture, ordinary RAF enabled.
- `/?test=1&level=1&fixture=win` (or `loss`): isolated save, idle bots, result after the first legal human DrawLine. Commands still pass through the real engine; a fake Sim owns its own public view and emits MatchOver. Engine internals/content are untouched. Hash belongs to the underlying real engine; fixture result overrides are solely UI-test state.

`level` accepts displayed number 1..20 or exact campaign id. Seed defaults to 1 (uint32); speed accepts 1 or 2 (default 1). Fixtures require `test=1`. Speed changes only elapsed-wall-time stepping; `step(n)` always advances exactly n fixed ticks, subject to pause/result. Restart preserves the match seed. Autoload saves and fixture results never write localStorage. Without level/fixture, real browser persistence remains available for picker/save tests.

| API | Return / effect |
|---|---|
| `load(id: string \| number, seed = URL seed)` | Promise; normal unlock rules apply; use `?level=` to select any campaign entry in an isolated save |
| `step(n = 1)` | completed tick count; 0 when paused/over; also renders |
| `render()` | `step(0)`; render without advancing simulation |
| `submit(cmd)` | `{tick,cmd}` frozen stamped submission, or null while paused/over |
| `commandLog` | submissions consumed at completed ticks, including AI; `{tick,cmd}[]`; cleared on driver replacement |
| `events` | v2 SimEvent[] collected after ticks; events have no synthetic tick field |
| `view` | public SimSnapshot (buildings columns / channels / seed / tick / over) |
| `hash()` | current engine hash |
| `screen` / `state()` | screen string / AppSnapshot (save, levels, result, restartPopup etc.) |
| `hud()` | `{state: AppSnapshot, ownership: OwnershipSegment[], tick: number \| null}` |
| `project(buildingId, label = false)` | `{x,y}` page CSS pixels; renderer anchor through worldRoot matrix then camera; label=true projects roof label |
| `legality(fromIndex,toIndex,player = human)` | `{reason: RejectReason \| null, explanation: {reason,point:{x,z},ref} \| null}` |
| `menu()`, `pause()`, `resume()`, `restart()`, `next()` | controller navigation; pause opens restart popup |
| `settings(patch)` | same four fields as SaveSettings |
| `renderInfo()` | `{calls,triangles}` or null |
| `visualProbe()` | shape below |

```ts
{
  viewport: {w: number, h: number}, // window CSS viewport, capture at 1600x900
  screen: Screen,
  popup: 'restart' | 'result' | null,
  hud: {remainingSeconds: number, ownership: OwnershipSegment[], levelId: string | null},
  buildings: [{id, index, owner, level, point:{x,y}, label:{x,y}}],
  lines: [{channel, from, to, owner, length, drawSeq}]
}
// OwnershipSegment = {player:number,colorKey:string,permille:number}
```

A mouse gesture test can get building points via `project(id)`, drag on the canvas, call `step()`, and inspect `commandLog`. Choose a legal pair with `legality()`; use rejection reason/explanation to find blocked draws. Win/loss popup tests use fixture URLs, then a legal DrawLine through either mouse drag or submit/step; click Next/Retry in the real UI. Query `state().levels` for all 20 campaign ids. Capture picker, HUD, restart/result popups with ordinary Playwright screenshots.

Validation: 17 scoped tests passed; dedicated main/audio/harness/test TypeScript subset passed with the existing source paths for defs/content/sim; scoped ESLint passed. Vite test and production bundles built. Production JS string scan found no `__na`, `test-harness`, `createFixtureSim`, or `testHookRequest`. Browser at 1600x900 loaded level20 seed73 tick0, produced projected anchor probes, fixture DrawLine entered win result, localStorage remained null, zero page errors. Full app `tsc`/`build:test` remains blocked by parked v1 tests/e2e and legacy assets modules (Task9 cleanup); direct Vite builds validate current entrypoints.
