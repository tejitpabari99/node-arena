# Opt-in Claude Code Stop verification

`kane-verify.sh` checks the shipped Kane smoke recording after web edits. It builds
the test client on every verification requiring replay, replays on preview port
**4173**, and returns exit 2 with the failing test, status, reason and session
directory for Claude to act on.
A passed check exits 0. Infrastructure problems print `skipped` and exit 0;
build failures exit 2 with the last 30 build-log lines.

## Install (owner action)

1. From the repository root, follow the [Kane setup](../README.md), including
   dependencies, Chromium, `pnpm build:prerequisites`, and `kane-cli login`.
   This rehearsal used Kane CLI 0.10.0; the design probes used 0.9.0.
2. Validate the example: `jq . tools/kane/hooks/settings.example.json`.
3. Merge the `hooks.Stop` entry from `settings.example.json` into your local
   `.claude/settings.local.json`, preserving existing settings and hooks. The
   command uses `$CLAUDE_PROJECT_DIR` so it works from a subdirectory. Its
   `timeout: 360` allows the build and replay to finish.
4. Start a new Claude Code session in this repository. Remove that local Stop
   entry to disable it. This repository ships an example only; no hook is enabled
   by these files and no `.claude/settings*.json` is committed.

The saved test navigates to `http://localhost:4173/?kane=1&seed=1`. Recorded
navigation wins over a CLI URL override, so the development server on **5173**
cannot substitute for the built preview. The replay wrapper starts and cleans up
its own preview when needed; it preserves a pre-existing server. Ensure any
existing 4173 server serves this checkout's current `dist-test`.

On this shared machine, hold `flock -x /tmp/node-arena-kane-resources.lock` for
manual verification and cleanup; reserve/release 4173 in the local coordination
note. An automatically installed Stop hook does not acquire that lock: enable it
only in a session with exclusive preview/browser ownership.

## Controls and cost

| Environment variable | Default / effect |
|---|---|
| `KANE_WATCH` | `apps/web`; one Git pathspec, including untracked files |
| `KANE_HOOK_FORCE=1` | Bypass clean-tree and last-passed-state skips; useful for rehearsal |
| `KANE_HOOK_NOBUILD=1` | Skip rebuilding; use only with a known-current test bundle |
| `KANE_HOOK_LOG` | Optional path receiving one timestamped line per Stop invocation |
| `KANE_TIMEOUT` | Per-test seconds; defaults to 120, replay clamps smaller values to 120 |
| `KANE_CLI_CHROME_PATH` | Optional Chromium executable override; otherwise use Playwright's cache |
| `KANE_CLI_USER_AGENT` | Defaults to `codex`; set to the assistant runtime when appropriate |

`stop_hook_active: true` exits immediately to prevent a Stop loop. A clean watched
tree skips replay. Unchanged changes that already passed skip too: the cache in
`${TMPDIR:-/tmp}/kane-hook-<repo-hash>` fingerprints tracked diffs and untracked
contents. Failed checks are never cached. Missing `jq`, `node`, or `kane-cli`
also skip with a note. After the clean-tree and last-passed-state skips, every
verification rebuilds the test client unless `KANE_HOOK_NOBUILD=1`. This includes
source deletions and HTML/configuration edits, which file mtimes cannot reliably
detect.

Budget **(Stops with changed web content requiring replay) × ~1–3 credits** per
session, per saved test. Forced checks cost too; cache hits and clean skips cost
nothing. Replay requires login and is not free. Failures can cost more because
Kane investigates them: an earlier negative replay cost 5.6102 credits. Leave
extra budget for the fail/fix/pass demo, check `pnpm --silent kane:credits` before
and after, and allow for delayed billing. The wrapper validates existing
recordings and disables adaptive healing; it does not author tests.

## Demo: ready → go → ready

The shipped string lives in **`apps/web/src/kane/pairs.ts`**, not `Overlay.tsx`.
The ready suffix is `` `ready · ${toLetter}: ${buildingDescription(view, to)}` ``.
The saved smoke checks the DOM text of the bottom-panel **A → C** button contains
`ready`, activates it once, then checks `active`.

1. Confirm a clean game-source tree, a current test build and sufficient credits.
   Keep the original `pairs.ts` bytes available for immediate restoration.
2. With the local Stop hook installed, prompt Claude: “In
   `apps/web/src/kane/pairs.ts`, change only the ready-state button's displayed
   suffix word from `ready` to `go`. Keep the internal `PairState` values intact.”
3. On Stop, the hook rebuilds and replays. Expect exit 2 and stderr beginning
   `Kane browser verification FAILED:`, followed by the smoke test path,
   `status=failed`, a reason and `session_dir=...`. Inspect its evidence with
   `kane-cli evidence serve <session_dir>/evidence/*.evidence` if needed.
4. Restore the displayed word to `ready` immediately. Since the loop guard skips
   nested Stops, use a fresh follow-up turn (“Verify the restored ready label”)
   to get another normal Stop. A clean restored tree skips by design; for a
   visible passing replay, use `KANE_HOOK_FORCE=1` for the demo session or invoke
   the forced check below. Expect exit 0, normally within 1–2 minutes per replay.
5. Remove any demo-only environment settings and confirm `pairs.ts` is restored.

Without enabling a real hook, rehearse each stage from the repository root with:

```sh
printf '%s\n' '{"stop_hook_active":false}' |
  KANE_HOOK_FORCE=1 tools/kane/hooks/kane-verify.sh
```

Use a shell cleanup trap when automating the temporary label mutation, so errors
and interruption restore the source. Do not commit the mutation, regenerated
recordings, or real Claude settings.

## Rehearsal evidence (2026-10-24)

Kane CLI **0.10.0**, saved `panel_draw_cut_test.md`, seed 1, authenticated Chromium
replay. No real Stop hook was enabled. All preview/browser runs held the shared
resource lock and reserved 4173; it was free before and after the rehearsal.

| Check | Hook exit | Wall time | Immediate balance delta |
|---|---|---|---|
| Loop guard | 0 | 0.018 s | No Kane invocation |
| Clean watched tree | 0 | 0.029 s | No Kane invocation |
| Forced original label | 0 | 43.265 s | 0 |
| Temporary displayed `ready` → `go` | 2 | 49.861 s | 6.0943 credits |
| Restored `ready`, forced | 0 | 35.444 s | 0 |

Balances: **100206.8056 → 100206.8056 → 100200.7113 → 100200.7113**;
6.0943 credits total observed. Each replay reported two replay decisions and
zero author decisions. The failed run reported `assertion_failed: @ step 3`;
the displayed `go` word was the detected mismatch. Failure investigation explains
why its cost exceeded the normal ~1–3 estimate. Billing can lag these readings.

Durable session IDs, under `~/.testmuai/kaneai/sessions/`:

- Original pass: `b5cb0432-01d7-4f2b-9047-e444b1c88b55`.
- Regression: `53527345-c4e0-46e1-a1cd-bfe22f43c90a`; evidence file
  `evidence/d8349914-5f4b-4a84-a83d-42617169dca4.evidence`.
- Restored pass: `afa2ff1d-6767-4fe6-b755-d8404896286d`.

The rehearsal exposed CLI 0.10's deleted scratch `run_dir` in failure stderr.
The replay wrapper now prefers an existing explicit session directory, then an
existing directory resolved from a safe terminal `session_id`, before legacy
fallback. Unit regression checks use the captured event shape; no paid rerun was
needed for that diagnostic fix. The source bytes were restored immediately after
the failure and checked again on cleanup. No game-source or real settings change
is included.
