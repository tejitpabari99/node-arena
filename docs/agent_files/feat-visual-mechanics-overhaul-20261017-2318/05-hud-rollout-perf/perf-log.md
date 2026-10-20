# SP05 Task 10 - L18 perf log (R7, Gate 3)

Host: SwiftShader (no real GPU), 7 GB / 4 cores. fps here is dominated by software rasterisation + readback (~1-2 s/frame): INFORMATIONAL, usable only as a relative GPU-load signal. Meaningful host signals: jsMs p95 (step + render CPU), renderMs (scene.render submission), drawCalls, triangles.
Protocol: `pnpm --filter @node-arena/web visual:capture --scene l18 --viewport 1920x1080 --headed --gpu --perf-only --no-build --throttle 4 --dpr 2 --perf-quality med` (new options this task: `--throttle N` CDP `Emulation.setCPUThrottlingRate`, `--dpr N` deviceScaleFactor, `--perf-quality q`, `--perf-only`). Same seed, 5 s warm-up + 30 s sample, l18 1920x1080. PROXY (4x CPU + DPR 2) used on all rows except the last. Quality `med` = shipped default (harness screenshots use `high`, so they are unaffected by med-tier rungs; no visual re-score needed).
Note: jsMs under proxy includes sim catch-up on ~2 s frames (5 ticks/frame), so it is inflated; "app renderMs" is render-only.

| # | rung / change | fps (info) | 1% low | frame p95 ms | drawCalls | triangles | jsMs p95 | jsMs mean | app renderMs mean/p95 | verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | baseline (med: DPR cap 1.5, shadow 1024, tree shadows on) | 0.414 | 0.40 | 2498 | 43 | 151,794 | 27.3 | 18.8 | 7.16 / 15.6 | - |
| 1 | rung 1: med pixel ratio 1.5 -> 1.25 | 0.524 | 0.50 | 2018 | 44 | 151,794 | 33.5 | 18.9 | 7.57 / 15.9 | keep: +27% fps (GPU-fill proxy), JS flat |
| 2 | rung 2: tree shadows only on high (shadow map was already 1024 on med) | 0.545 | 0.52 | 1940 | 42 | 147,206 | 28.9 | 17.9 | 6.94 / 15.7 | keep: +4% fps, -3% tris |
| 2b | repeat of 2 (noise estimate) | 0.554 | 0.54 | 1869 | 42 | 147,206 | 28.4 | 16.5 | 6.57 / 15.3 | noise ~2-5% |
| 3 | rung 3 merge/instance static meshes | - | - | - | 42 | - | - | - | - | skipped: drawCalls 42 vs budget 100, nothing to gain |
| 4 | rung 4 `--lod low` forced on L18 | 0.553 | 0.53 | 1882 | 42 | 147,206 | 29.6 | 19.0 | 7.48 / 16.0 | no gain (tris unchanged; L18 troop count small): not applied |
| 5 | rung 5 upper bound: roof atlas flush disabled entirely | 0.505 | 0.49 | 2037 | 42 | 147,204 | 26.6 | 13.4 | 4.58 / 7.7 | fps no gain; JS -2 ms under 4x (~0.5 ms real). Atlas is 512x512, uploaded only when a tower's state changes, at <= 20 Hz: not a bottleneck; throttling would add stale numbers. Not applied |
| 6 | rung 6 auto-detect low quality (<60 fps for 3 s) | - | - | - | - | - | - | - | - | not implemented: cannot validate without a real GPU; stuck rule (3 steps < 3%) reached, see below |
| F | final state, NO proxy (1x CPU, DPR 1, med) | 0.674 | 0.63 | 1547 | 42 | 147,206 | 5.9 | 4.3 | 1.59 / 3.3 | JS target met |

Measures used: 7 of 12.

## Targets vs result
- drawCalls <= 100 (M13): met (42).
- jsMs p95 <= 8: met unthrottled on this host (5.9 ms incl. sim catch-up; render-only p95 3.3 ms). Under the 4x proxy it is ~27 ms raw, i.e. ~6.8 ms normalised (inflated by catch-up).
- mean fps >= 58 / 1% low >= 45: NOT measurable (SwiftShader ~0.5-0.7 fps). 

## Perf-open: needs user spot-check on laptop
Measured bottleneck: GPU fill-rate/rasterisation (fps responds to pixel count: rung 1 +27%; JS stays at ~2 ms/frame render-only, 147k triangles, 42 draw calls). JS is not the bottleneck. Applied (no visible harness change): med pixel-ratio cap 1.25, tree shadows high-only. If the laptop run misses 58/45 fps, next steps: rung 6 auto-quality (not implemented), lower `high` DPR cap, drop PCF to basic shadows on med.
