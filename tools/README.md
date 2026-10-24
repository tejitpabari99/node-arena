# Repository tools

Node-only tools run through the root pnpm scripts and `tools/src/cli.ts`. Run `pnpm build:prerequisites` on a fresh checkout: workspace APIs resolve compiled exports. Node >=22.13; pnpm 10.34.6.

## Contents

| Path | Role |
|---|---|
| `tools/src/cli.ts`, `tools/src/files.ts`, `tools/src/content.ts`, `tools/src/output.ts` | Dispatch, deterministic file loading, version/hash baseline and located Markdown/JSON diagnostics |
| `tools/src/import-tw/` | Level parsers, feature gate, mapper, campaign merge, frozen prefab/collider inputs |
| `tools/src/assets-tw/` | RAW GLB/textures/FX extraction and manifest fragment merge |
| `tools/src/manifest.ts`, `tools/src/manifest-assets.ts`, `tools/src/credits.ts` | Manifest/schema references, safe asset files, budgets, hashes and attribution |
| `tools/src/rules.ts`, `tools/src/replay.ts` | Rule/test coverage and standalone/bundled replay playback |
| `tools/src/levels.ts`, `tools/src/levels-output.ts`, `tools/src/unsolved.ts` | Common/custom union integrity, proxy checks, level lock and unsolved allowlist |
| `tools/src/editor-ops.ts`, `tools/src/editor-validation.ts`, `tools/src/editor-solvable.ts`, `tools/src/editor-finalize.ts`, `tools/src/editor-finalize-worker.ts` | Node-only authoring Save, validation, proxy jobs and fixed-argv Finalize steps; no automatic commits |
| `tools/src/balance*.ts`, `tools/src/balance-worker.mjs` | Match matrix, aggregation and deterministic worker pool |
| `tools/src/parked.ts`, `tools/src/parked-commands.ts`, `tools/src/docs-check.ts` | Gate parking and documentation consistency |
| `tools/assets/` | Extract/UI locks, scene and real-client capture tools, prototype validation |
| `tools/test/` | Gate fixtures, including corrupted inputs that must fail |
| `tools/solutions/README.md` | Reserved solution directory; no recorded-solution fallback |

## Gates

| Command | Contract |
|---|---|
| `pnpm check:schemas` | Generated JSON schemas match defs/content sources |
| `pnpm check:content --base HEAD` / `pnpm validate:content --base HEAD` | Fresh sim/bot lock, valid v2 content, references and derived requires; content/rules/bot versions compared with committed baseline |
| `pnpm check:manifest` | Manifest schema and visual/theme/palette references; safe files; unit/building/obstacle/ground triangle budgets 1100/1200/300/500, 256px texture limit; committed output hashes against `tools/assets/tw-extract.lock.json`; `docs/CREDITS.md` coverage |
| `pnpm check:rules` | Every active heading rule ID has a literal covers tag in an active test title; unknown tags fail; tombstones remain known and exempt |
| `pnpm check:import` | Re-import bytes match committed importer-owned levels/campaign; orphan importer files fail; skips without local extract |
| `pnpm assets:tw:check` | Regenerated model/texture/FX output and extract lock match committed bytes; skips without local extract |
| `pnpm assets:ui:check` | Generated UI sprite files/lock match the committed files |
| `pnpm validate:levels` | Campaign integrity, proxy safety/determinism, idle-human loss, proxy wins and seed-1 lock; details below |
| `pnpm replay:verify golden` | Sim and bot golden replay records match headers, checkpoints, final hashes and outcomes; no bot execution |
| `pnpm sim:golden` / `pnpm bots:golden` | Regenerate expected simulation/bot scenarios in memory and enforce golden identities/version guards |
| `pnpm bench:sim` / `pnpm bench:bots` | Strict local performance budgets; `--ci` permits shared-runner budgets |
| `pnpm check:docs` | Every root script is documented in this file or AGENTS; documented paths exist; removed tooling references fail |
| `pnpm art:status [--strict]` | Report-only list of manifest file fields not yet in the art overrides dir; strict exits 1 while any remain |
| `pnpm check:parked --strict` | No parked CI entries, refused commands or parked source/test directories remain |

Content/manifest/replay/level/balance reports use `--format md|json` (default Markdown). Failures exit 1; malformed command arguments fail. Caller-supplied paths resolve from the working directory. Defaults resolve from the repository. Common content options: `--dir`, `--base`, `--manifest`, `--assets-dir`, `--credits`, `--lock`; supported options depend on the command. Manifest credits default to `docs/CREDITS.md`; committed assets are checked without the extract. A custom assets directory omits the repo asset lock unless an explicit lock is supplied.

`pnpm replay:verify` accepts a file, directory or the golden alias. It reads JSON, resolves standalone level IDs through authoritative content, and verifies embedded compiled inputs in golden bundles; malformed replay-like JSON and zero-record inputs fail. Checkpoint divergence identifies the first observable differing tick. Example using an existing corpus:

```sh
pnpm replay:verify packages/sim/test/golden --format json
```

### Levels and balance

`campaignLevels(data)` returns exactly Common; `customLevels(data)` returns the optional custom list. Their integrity check requires all level files to equal the union of Common and custom entries. `validate:levels` defaults to that union; `--levels all` explicitly selects it. Balance defaults and `--levels all` retain the Common campaign only; an explicit `--levels na-...` selects a custom level.

`pnpm validate:levels --levels all --seeds 4 --max-ticks 20000` checks the 20 Common campaign levels plus the optional custom list against all committed level files. Common positions and numbering stay unchanged; custom positions only order the custom picker. Each seed in 1..N runs the human seat as a fresh TW proxy with full behaviour at action delays 500/1000/2000 ms, versus authored AI. Rejected commands and invariant errors fail; seed 1 at delay 2000 is rerun for hash equality. An idle human must never win. An untimed stalemate hitting the cap appears as **Capped**, not a safety failure or a victory.

Solvable means at least one proxy victory across delays/seeds. `tools/unsolved-by-proxy.json` records id, position, reason and owner sign-off. Position is required for Common levels and optional reporting metadata for `na-*` levels. An unsolved level absent from this allowlist fails; listed unsolved levels warn, and solved stale entries also warn. Proxy success is evidence only; owner manual playthrough remains acceptance. `tools/levels-lock.json` pins each level's delay-2000 seed-1 outcome, tick and final hash. `pnpm levels:lock` rewrites it for Common plus custom. `pnpm levels:lock --levels <id>` reruns only that level and merges its entry, preserving all other entries; this mode refuses a missing or malformed lock. `--levels all` performs a full rewrite; first make the rules/content/bot version changes required by the identity change. CI checks four seeds.

```sh
pnpm validate:levels --levels levelview-1 --seeds 1 --format json
pnpm levels:lock
pnpm levels:lock --levels na-trial
pnpm balance --levels all --proxy 1000,2000,4000,idle --seeds 20 --jobs 2
pnpm balance --mode arena --proxy 1000,2000 --seeds 20 --format json
```

Balance is report-only: statistical results do not fail a gate. It reports win percentage, median win time, timeout percentage (including capped runs) and median towers per level/proxy. Campaign mode replaces the human; arena mode rotates TW proxy profiles across every seat. Reports carry rules/content/bot versions and bot hashes; jobs 1 and 2 produce identical bytes for the same inputs. The nightly workflow uses 200 seeds/two workers and uploads Markdown/JSON.

### Development editor operations

Run `pnpm dev` and open `http://127.0.0.1:5173/editor.html` (or Vite's printed local port). The dev-only main/card Edit links select the level; imported levels require a new `na-*` copy id, while custom levels reopen in place. Keep the explicit `127.0.0.1` binding. The serve-only middleware rejects non-local Host, mismatched Origin, POSTs without `X-NA-Editor: 1`, invalid ids, oversized bodies and writes to imported files. Neither the editor entry nor write/process middleware ships in an ordinary production build.

`editor-ops` saves validated canonical `na-*.json`, recomputes `requires` and upserts `packages/content/data/campaigns/custom.json` using `max(position)+1` for a new entry. No version or lock mutation happens on Save. The editor's unfinalized banner comes from a read-only `validate:content --base HEAD` check through protected `POST /__editor/status` (exact local Origin, `X-NA-Editor: 1`, 1 MiB body cap); GET never starts a process. Concurrent checks share one in-flight command. Content changes invalidate that command's revision, so stale callers receive 409 and can retry after it settles; checks do not hold the Save/job gate. Its Solvable? proxy results are evidence only and require owner play/sign-off.

Finalize runs, in order: saved-level validation → content patch bump → conditional bot-version bump → `pnpm content:lock` → `pnpm levels:lock --levels <id>` → `pnpm build:bots` → guarded sim golden refresh → guarded bot golden refresh → `pnpm validate:content --base HEAD` → `pnpm check:content --base HEAD` → `git diff --stat`. The bot bump is required when the AI identity map or content replay version changes: bot golden envelopes embed `contentVersion` even for geometry/name-only edits. Each golden refresh runs its official check first, invoking the official `--update` command only when needed; both use HEAD explicitly, overriding inherited CI baseline variables, and retain all existing strict version guards. This extends PRD R5 to keep versioned replay fixtures CI-ready. Repeated Finalize leaves bytes unchanged. Version bumps already made against HEAD are retained, output streams to the UI, and the first failure stops the sequence. The selected lock mode merges other entries unchanged. Review the resulting content/custom list/versions/locks/golden replay envelopes diff and commit manually; tooling never commits. See [authoring workflow](../docs/LEVELS_GUIDE.md#4-author-an-original-level) for Play, forms and draft controls.

### Local extract and assets

`TW_EXTRACT` names the private local Tower War extract directory; CI never downloads it. Unset extract: `pnpm check:import` skips (exit 0); `pnpm import:tw` refuses (exit 2). Art generation and checks skip when the directory is unset or absent. CI surfaces skipped extract checks as notices. Committed output validation stays active.

`pnpm import:tw` defaults to Common positions 4–23; `pnpm check:import` covers the committed imported campaign. Import merges by position and never edits metadata/locks. Read [the levels guide](../docs/LEVELS_GUIDE.md) before changing ranges or feature policy. `pnpm assets:tw` writes models/textures/FX plus the extract lock. `pnpm assets:manifest` merges the world fragment into the world manifest and copies the optional UI fragment to its presentation namespace; `--check` checks without writing and needs no extract. `pnpm assets:ui` generates UI sprites and its lock.

`pnpm assets:capture` renders named SP07 scenes (options include --scene, --compare, --out); `pnpm assets:capture:web` captures the real SP08 client. `pnpm assets:validate` compares prototype/RAW importer geometry and optionally renders turntables; it skips without the private prototype extract. These are local development tools. `pnpm campaign:verify` builds the test client, loads all 20 campaign levels for five seconds, checks browser errors and writes screenshots, grid and JSON in the generated directory test-results/campaign/.

## CI and version baselines

`scripts/ci.sh` wraps named gates and reports each parked entry with its owning SP. `pnpm check:parked` lists remaining entries/artifacts; strict mode fails until all are removed. `CI_RELEASE=1` makes the final parked check strict. See the [SP09 plan](../docs/agent_files/feat-tower-war-port-20261022-0321/09-gates-tooling-docs/PRD.md) for ownership/closure history.

For branch runs the baseline priority is VERSION_GUARD_BASE, CONTENT_BASE, merge-base against main (or origin/main), then HEAD^ (HEAD for an initial commit). CI exports the branch baseline to content and golden version guards; release runs unset VERSION_GUARD_BASE and use the normal committed baseline. Outside CI, content CLI defaults to VERSION_GUARD_BASE or HEAD. Invalid explicit revisions fail. Regenerating a lock cannot bypass version bumps. A shell template, with a placeholder revision:

```sh
CONTENT_BASE=<revision> pnpm run ci
```

GitHub CI keeps Node 22/24, Chromium for web/content/sim and a separate sequential browser-suite job. Local CI needs Chromium too. `pnpm run ci` is the script invocation; pnpm reserves its bare ci command. Browser suites use development/test bundles with hooks; ordinary production excludes hooks. Neither CI nor campaign verification deploys anything.

## Root script inventory

Every root script is listed below; package-filtered commands above are additional workspace entry points.

- Workspace checks/builds: `pnpm test`, `pnpm test:defs`, `pnpm test:content`, `pnpm test:sim`, `pnpm test:bots`, `pnpm test:bots:golden`, `pnpm test:tools`, `pnpm test:web`, `pnpm test:web:sp07`, `pnpm build`, `pnpm build:defs`, `pnpm build:content`, `pnpm build:sim`, `pnpm build:bots`, `pnpm build:web`, `pnpm build:prerequisites`, `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:defs`, `pnpm typecheck:content`, `pnpm typecheck:sim`, `pnpm typecheck:bots`, `pnpm typecheck:tools`, `pnpm typecheck:web`, `pnpm typecheck:web:sp07`.
- Content and rules: `pnpm content:schemas`, `pnpm check:schemas`, `pnpm content:lock`, `pnpm check:content`, `pnpm validate:content`, `pnpm check:manifest`, `pnpm check:rules`, `pnpm import:tw`, `pnpm check:import`.
- Simulation and reports: `pnpm sim:golden`, `pnpm bots:golden`, `pnpm replay:verify`, `pnpm validate:levels`, `pnpm levels:lock`, `pnpm bench:sim`, `pnpm bench:bots`, `pnpm balance`.
- Web and assets: `pnpm dev`, `pnpm test:web:e2e`, `pnpm test:web:all`, `pnpm campaign:verify`, `pnpm assets:capture`, `pnpm assets:validate`, `pnpm assets:tw`, `pnpm assets:tw:check`, `pnpm assets:manifest`, `pnpm assets:ui`, `pnpm assets:ui:check`, `pnpm assets:capture:web`.
- CI and consistency: `pnpm run ci`, `pnpm check:parked`, `pnpm check:docs`.
