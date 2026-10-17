# SP04 final CI/browser/nightly evidence

Accepted source/configuration ends at `a1dc5ef`. Evidence is from local delegated workers; no remote Actions run/upload is claimed.

| File | Meaning |
|---|---|
| `ci-final.log` | Corrected-tree `CONTENT_BASE=1716a53 pnpm run ci` exits 0; all 15 commands, 656 tests, 28 rule IDs, 14 replays, current schemas/content/versions and benchmark gates pass. Final configuration was committed unchanged. |
| `browser-full-initial.log` | Complete production preview: 17 passed / 14 intentional dev-only skips. Complete dev: 30 passed / one stress p95 failure (5.6 ms against required <4 ms) under unrelated host CPU load. This is not an entirely green full dev run. |
| `browser-dev-stress-rerun.log` | Unchanged isolated dev stress/lifetime rerun passed after other jobs naturally ended; combined dev case coverage reaches all 31. |
| `balance-200-seeds.md`, `balance-200-seeds.json` | Local 200-seed/two-worker nightly demonstration, 600 matches/three rows. These sample measurements do not validate the future SP05 campaign. |

SHA-256:

- Final CI log: `465ef7bf60d8952f1c78690d06686a6bebf754d611d6f86d84079f2dc7860064`
- Balance Markdown: `5d55efa266dffd115552ed58ebdae8093d141b337a29104df09e57da3a667883`
- Balance JSON: `c96571cd104c46ea91a4e7e4956b50c4453c640bc457606b96abbb22a9c19fbe`

Large traces/images and raw profiling artifacts are excluded. The failure trace/error context remains transient at `/tmp/node-arena-task14-browser-failure`; durable failed-run output is preserved here. One-millisecond strict bot and four-millisecond browser thresholds were not weakened. No unrelated process was stopped or changed. Real-GPU owner checks remain pending.
