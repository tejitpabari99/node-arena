# Repository tools

Node-only TypeScript gates, executed with `tsx`. Build `@node-arena/content` first when starting from a fresh checkout (`pnpm --filter @node-arena/content build`).

## Contents

- `layout/` — optional symmetry helper (`mirror|rot3|rot4`): `pnpm --filter @node-arena/tools layout layout/examples/rot3.json --out <level.json>` emits level JSON to commit; JSON stays source of truth.
- `src/cli.ts` — content, manifest, rule coverage, replay and level gate dispatch and located diagnostics.
- `src/levels.ts` / `src/levels-output.ts` — per-band match gate, committed solution verification and per-level reports.
- `solutions/` — committed band-four scripted winning replays.
- `test/fixtures/levels/` — isolated win, loss, idle-win and seeded band-four scenarios.
- `src/rules.ts` — active rule headings and literal coverage tags in parsed test titles.
- `src/replay.ts` — public SP02 playback of standalone records and golden bundles, with content-level resolution.
- `src/walk.ts` — sorted file traversal, excluding generated/dependency directories and refusing symlinks.
- `src/content.ts` — committed baseline lookup, fresh sim/bot locks, rules/content version checks.
- `src/files.ts` — deterministic content loading and explicit file/JSON errors; rejects data symlinks.
- `src/output.ts` — shared Markdown/JSON reports and exit status (0 pass, 1 failure).
- `test/gates.test.ts` — repository checks and temporary corrupted-content/manifest fixtures.
- `test/rules-replay.test.ts` — missing/unknown rule tags, misleading source strings, standalone and bundled replays, incompatible headers and first-divergence fixtures.

```sh
pnpm validate:content --base HEAD
pnpm validate:content --base <git-revision> --format json
pnpm check:manifest --format json
pnpm check:rules
pnpm check:rules --format json
pnpm replay:verify golden
pnpm replay:verify packages/sim/test/golden --format json
pnpm replay:verify path/to/match.replay.json --format json
pnpm --filter @node-arena/tools test
pnpm --filter @node-arena/tools build
```

`validate:content` calls the shared content validator, checks the entire `packages/content/hashes.lock.json` (both level simHash and resolved botHash), and checks rules/content versions against committed metadata and hashes. `--base` defaults to `HEAD`; branch/CI checks should explicitly supply the relevant pre-change revision with available history. Regenerating a changed simulation lock cannot bypass the contentVersion bump. A revision before the first dataset is supported; missing or invalid history fails. Resolved bot-hash changes against a versioned committed baseline also require an increasing literal BOT_VERSION in `packages/bots/src/version.ts`; pre-version baselines establish the first version. The shared Node-only literal loader reads source and baseline text without adding bot runtime or Node dependencies to browser content APIs.

`check:manifest` calls `validateContent(fileMap, {manifest})` for visual/theme/palette references, then the existing SP03 Node adapter for safe files, model/texture budgets, and credits. It never edits SP03's manifest. The current primitive-only repository needs no credits text; when external assets are used, supply `--credits <CREDITS.md>` (credits are empty by default, so uncredited files fail).

Options: `--format md|json` (default md), `--dir <content-package-directory>`, `--base <revision>`, `--manifest <manifest.json>`, `--assets-dir <directory>`, `--credits <CREDITS.md>`. Paths supplied by callers resolve from their working directory. Defaults resolve from the repository, so scripts work from the tools workspace. `--dir` changes the current corpus only: its baseline remains the committed repository's `packages/content`. Reports contain `command`, `ok`, `summary`, `errors`, and `warnings`; diagnostics contain source `file`, JSON `pointer` where available, and `message`. JSON is written to stdout on both pass and failure.

`check:rules` reads `docs/GAME_RULES.md` and traverses source test/spec files under `packages/`. Only headings beginning with a literal `R-[A-Z]+-digits` ID define rules; body references, heading references, comments and fenced examples do not. Tombstones marked in their heading or at the start of a status/body line remain known IDs and are exempt from coverage. The TypeScript parser reads literal `covers R-...` fragments in `test`/`it` titles (including template fragments), excluding helper strings, comments, test bodies and skipped/todo tests. Missing active IDs and unknown coverage tags both fail. Override inputs with `--rules <file>` and `--packages-dir <directory>` for isolated fixtures.

`replay:verify <file|dir|golden>` requires the sim build (`pnpm --filter @node-arena/sim build`). Root scripts resolve supplied paths from the caller's working directory; tools workspace scripts resolve them from that workspace. `--dir` selects the authoritative content package; headers resolve level IDs through `loadContent`/`compileLevel`, then SP02's public `playReplay` checks compatibility, every checkpoint, final hash and outcome. State mismatches report the first observable diverging tick (checkpoint or final tick). Playback imports no bot engine and never instantiates bots.

The `golden` alias recursively scans `packages/sim/test/golden` and `packages/bots/test/golden` when the latter exists. SP02-style JSON bundles (`metadata`, `scenarios` with compiled `level`, `results` with `name`/`replay`) use embedded test-owned compiled inputs, recompute their simulation identities, and require authoritative metadata. Standalone records and `{replay: ...}` wrappers resolve authored levels instead. Auxiliary objects containing only command logs may coexist with records; malformed replay-like JSON fails and an input with zero replay records fails. The verifier reads JSON data, never imports executable fixture modules. All reports use the shared Markdown/JSON shape and exit 1 on failure.

`validate:levels --levels id|all --seeds 4` first runs the same content/schema/lock/version checks as `validate:content`, then binds the resolved `reference` and `idle` profiles to the level's single human seat. Authored bot seats keep their compiled profiles. Seeds are exactly `1..K`, with fresh controllers each run; seed 1 is repeated and its final hash compared. Every match runs to its configured end with zero rejected commands and no invariant exceptions. A win requires both `outcome: won` and the human team's ID; timeouts never count.

Bands 1–3 require all K reference wins. Band 4 requires at least K−1 (including zero required wins at K=1). Idle must win zero runs in every band. A band-four reference shortfall can pass via `tools/solutions/<levelId>.replay.json`, committed unchanged at HEAD. The standalone replay must pass public `playReplay` compatibility/checkpoint/final-hash/outcome verification for that exact level and record a legal human-team win. The gate then extracts only the human commands and runs them as a scripted controller against the authored opponents, requiring the same winning outcome, final tick and hash. A changed `simHash` invalidates the solution. Bundles, foreign-level records, staged-only or modified solution files cannot satisfy this fallback.

```sh
pnpm build
pnpm validate:levels
pnpm validate:levels --levels sample --seeds 4 --format json
pnpm validate:levels --levels all --seeds 4 --base <git-revision>
```

Reports go to stdout: Markdown contains one section and seed table per level; JSON contains the shared gate fields plus sorted `levels` with per-seed outcomes, ticks, hashes, rejection counts and final player/tower statistics. Gate failures exit 1. `--dir` and `--base` have the same content/baseline meaning as `validate:content`. The current repository has one sample level; the gate automatically includes SP05's future authored dataset without creating or tuning campaign levels here. `src/levels.ts`, `src/levels-output.ts` and `test/fixtures/levels/` implement and exercise this gate.

`balance --levels all --proxy reference,human-proxy,idle --seeds 200 --jobs 2 --format md|json` measures the full configured match duration with fresh controllers and seeds exactly `1..N`. Campaign mode replaces the single human controller; authored opponent profiles remain fixed. `--levels <id>` selects one level. Root `pnpm balance` preserves supplied relative paths; `--dir` selects a different validated content corpus.

`--mode arena` sorts and deduplicates selected profiles, then runs P rotations per seed. Dense seat s receives profile `(s + rotation) % P`: every profile visits every seat once per seed, including repeated profiles when there are fewer profiles than seats. Rows aggregate by level/profile over controlled seat appearances. `matches` counts matches containing that profile; `observations` counts controlled seats. Win percentages use the controlled seat's winning team (including bot-team wins reported as human-relative losses); timeouts never count as wins. Rows also contain median seconds to win (null with zero wins), timeout/draw percentages, and median final owned tower count.

A real `worker_threads` pool defaults to two workers, and ordered aggregation gives byte-identical Markdown/JSON for `--jobs 1` and `--jobs 2`. Reports have sorted rows and a header with rulesVersion, contentVersion, resolved per-profile botHash and BOT_VERSION, with no timestamps or worker-count-dependent fields. Invalid content/profiles/options, worker failures, rejected commands and truncated matches fail the command; partial suites never produce a successful balance report. Statistical target violations flag rows and keep exit status 0, since balance is a measurement tool rather than the level gate.

SP05 authors `tools/balance-targets.json`; no placeholder values are supplied here. All target numbers are percentages in 0..100. Every band `1`–`4` requires `{referenceWinMin, humanProxyWin:[min,max], timeoutMaxPct, idleWinMax}` with ordered human-proxy bounds and no unknown fields. [balance-targets.schema.json](balance-targets.schema.json) is the editor schema; `src/balance-targets.ts` exports the same TypeBox/Ajv runtime boundary. An optional `$schema` string can reference the editor schema. Use `--targets <file>` for fixture/custom targets; an explicitly supplied missing file fails. Missing default targets are explicitly reported as absent, and disable band checks. Reports list selected levels with SP01 overrides.

Balance implementation: `src/balance.ts` builds the matrix and aggregates metrics, `src/balance-match.ts` runs one full match, `src/balance-pool.ts` owns worker lifecycle, `src/balance-worker.mjs` bootstraps TypeScript in each worker, `src/balance-worker.ts` processes tasks, and `src/balance-output.ts` emits the matrix. `test/balance.test.ts` covers real campaign/arena fixtures, cross-worker reproducibility, target bounds and worker failures.

```sh
pnpm balance --levels all --proxy reference,human-proxy,idle --seeds 200 --jobs 2
pnpm balance --mode arena --proxy rusher,turtle,economist,opportunist --seeds 200 --format json
```
