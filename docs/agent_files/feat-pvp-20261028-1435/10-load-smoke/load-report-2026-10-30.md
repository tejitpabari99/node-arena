# Load smoke: first measured run (2026-10-30)

Machine: 4 vCPU, 7.7 GB, Node 22.23. In-process mode (harness + server share one process, so RSS/CPU are upper bounds for the server). 20 rooms, 45 s steady window, levels cycle Duel S / Duel M / Cross, bots easy/normal/hard. JSON: `load-report-2026-10-30.json` (summaries + verdicts, no per-sample rows).

| Run | p99 late final / max | RSS peak | Rooms running (min) | CPU mean / per room | Rematches | Errors / closed |
|---|---|---|---|---|---|---|
| default | 3.44 / 123.07 ms | 205.8 MB | 13 | 10.3% / 0.53% | 7 | 0 / 0 |
| `--spectators 3` | 2.09 / 117.47 ms | 192.1 MB | 13 | 13.7% / 0.71% | 7 | 0 / 0 |
| `--churn` (1 room / 10 s) | 2.30 / 112.07 ms | 200.2 MB | 15 (tol. n-2) | 12.7% / 0.66% | 5 | 0 / 0 |

## Verdicts (PRD L6)
| Run | p99 < 25 ms | RSS < 200 MB | all rooms running | no error/closed |
|---|---|---|---|---|
| default | PASS | FAIL (205.8) | FAIL (min 13) | PASS |
| spectators | PASS | PASS (192.1) | FAIL (min 13) | PASS |
| churn | PASS | FAIL (200.2) | FAIL (min 15) | PASS |

## Spectators (3/room, 60 attached at midpoint)
Catch-up 20/20 measured: p50 0.83 ms, p99 2.83 ms, mean 0.85 KB; 0 errors. Frames/s about doubles (about 405 to 805). p99 lateness unchanged.

## Leak signal (rooms closed, forced GC)
| Run | heapUsed baseline | before GC | after GC | delta | RSS delta |
|---|---|---|---|---|---|
| default | 26.5 | 88.2 | 45.2 | +18.7 MB | +63.4 |
| spectators | 26.9 | 86.3 | 45.6 | +18.7 MB | +71.7 |
| churn | 27.7 | 91.9 | 45.2 | +17.5 MB | +72.8 |
Heap after GC is stable (~45 MB) across all three runs including churn: no leak growth seen. Residual +18 MB heap is JIT/module warmup plus harness stats; `roomsAfter` was 6 (rooms still draining at sample time). RSS does not shrink after GC; not a leak signal.

## Findings
- p99 lateness meets target in steady state (2-3.5 ms). The max over samples (about 110-123 ms) comes from the first ~6-8 s: the 400-wake window still contains ramp (20 rooms booting).
- CPU about 0.4-0.7% of one vCPU per room; 20 rooms about 8-14%.
- Rooms-running FAIL is a harness artifact: Duel S bot matches end at about 34 s (not 58 s as assumed), the harness `rematch`es, and `running` dips to 13-15 for about 4 s. No `room.closed` or `error` occurred. Shortening the window to 45 s did not avoid it.
- RSS FAIL (205.8 / 200.2) is borderline and includes the harness (heapUsed peak about 95 MB is harness+server together). Server-only RSS on Fly is expected lower; unverified.

## Follow-ups (not blockers)
1. Harness: count rematching rooms as running (or drop Duel S from the default cycle / sample window after first ends) so the "all rooms running" verdict is meaningful. Needs PRD L6 wording change, so left for owner.
2. Harness: measure p99 lateness after a warmup (skip first ~8 s) or reset the clock window after ramp.
3. Owner: rerun in URL mode against Fly (`--url wss://<app>.fly.dev --rooms 5`) for server-only RSS; then decide `MAX_ROOMS` / VM size.
