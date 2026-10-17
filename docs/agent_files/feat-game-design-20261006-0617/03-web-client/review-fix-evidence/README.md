# SP03 correction verification evidence

Validated source ends at `635ce0e`. All checks use the feature linked worktree; browser suites run sequentially with one worker. Original untracked evidence was preserved intact.

| Files | Meaning |
|---|---|
| `commands.json`, `0.log`–`6.log` | Pre-existing integrated-check evidence, retained as history. |
| `fresh-commands.json`, `fresh-0.log`–`fresh-8.log` | Fresh checks at `0899c49`; initial full browser run includes dev p95 failure. `fresh-0` passed all 133 web tests because that script's `--` invocation did not filter. |
| `followup-commands.json`, `targeted-regressions*.log` | Correct targeted invocation: eight model/cache regressions passed. |
| `initial-dev-stress-error.md`, `initial-dev-stress.json` | Initial 4.20 ms dev p95 failure and raw sample. |
| `isolated-dev-stress*.log`, `isolated-dev-stress-*.json` | Unchanged isolated scenario passed at 3.80 ms; complete lifetime measurement. |
| `final-dev*.log`, `final-dev-*.json` | Pre-optimization full dev repeated 4.10 ms p95 failure; all other 30 scenarios passed. |
| `profile-breakdown.json` | CDP 100 µs sampled CPU attribution of original 3,200-troop workload; inclusive totals overlap and do not replace wall-time acceptance. |
| `pose-cache-red.log`, `pose-cache-green*.log` | Real red→green regression evidence: per-bucket buffer resolution bounded, live writes preserved after growth. |
| `pose-cache-commands.json`, `pose-cache-{test,build,build-final,lint}.log` | 518 units; initial test-only TypeScript union error retained; corrected build/lint pass. |
| `pose-cache-browser-commands.json`, `pose-cache-preview*.log`, `pose-cache-preview-*.json` | Final preview: 17 pass/14 explicit dev-only skips; 3.60 ms p95; stress, twenty switches and production offline-cache attachments. |
| `pose-cache-dev*.log`, `pose-cache-dev-*.json` | Shared-host loaded dev run: 30 pass/one 6.00 ms p95 failure. |
| `host-contention.log` | Read-only CPU/load/process investigation; unrelated tests not modified. |
| `quiescent-dev-command.json`, `quiescent-dev*.log`, `quiescent-dev-*.json` | Final dev: 31 pass, no skips/failures/flaky tests; 3.10 ms p95; raw stress/lifetime/cache attachments and host snapshots. |

Browser `.log` files using JSON reporter contain full JSON plus any pnpm failure trailer; parse their JSON prefix when a command failed. `*-stderr.log` files preserve runner warnings separately. Cache/lifetime attachments distinguish decoded CPU templates from per-level GPU resources and record explicit final manager cleanup. Real-GPU owner sign-off remains pending.
