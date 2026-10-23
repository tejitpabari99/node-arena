# Repository tools

Node-only TypeScript gates, executed with `tsx`. Build `@node-arena/content` first when starting from a fresh checkout (`pnpm --filter @node-arena/content build`).

## Contents

- `layout/` — optional symmetry helper (`mirror|rot3|rot4`): `pnpm --filter @node-arena/tools layout layout/examples/rot3.json --out <level.json>` emits level JSON to commit; JSON stays source of truth.
- `src/cli.ts` — content, manifest, rule coverage, replay and level gate dispatch and located diagnostics.
- `src/levels.ts` / `src/levels-output.ts` / `src/unsolved.ts` — proxy solvability gate (06 R6), `levels-lock.json` determinism lock, `unsolved-by-proxy.json` allowlist.
- `solutions/` — reserved (no recorded-solution fallback in v2).
- `src/assets-tw/` — Tower War art importer (`TW_EXTRACT=<extract> pnpm assets:tw`, `pnpm assets:tw:check`): reads the private extract's catalogs/OBJ/PNG and writes RAW GLBs (`apps/web/assets/models/tw`), team textures (`textures/tw`), FX/lane PNGs (`fx`) and `tools/assets/tw-extract.lock.json` (sha256 of every input). Both commands skip with exit 0 when `TW_EXTRACT` is unset. Add new asset families as jobs in `run.ts` (`JOBS`).
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

`validate:levels --levels id|all --seeds 4 --max-ticks 20000` first runs the same content/schema/lock/version checks as `validate:content`, then plays the human seat (the one player without a `bot` block) with the `tw` human proxy (`HUMAN_PROXY`) against the authored AIs, seeds exactly `1..K`, fresh controllers each run. Per level: (a) every run finishes within `--max-ticks` (untimed levels are capped; a capped stalemate is reported in the `Capped` column, not a failure) with 0 rejected commands and no invariant throw, and a seed-1 rerun (action delay 2000) has an equal final hash; (b) an idle human (no commands) never wins; (c) solvable = any win over proxy action delays 500/1000/2000 (`behavior: full`; faster = stronger). Win counts per delay are printed. Band-based `requiredWins` is retired. It also asserts the `common` campaign entries are exactly the files in `data/levels`.

`tools/unsolved-by-proxy.json` (`[{id, position, reason, ownerSignOff}]`, schema-checked in `src/unsolved.ts`) lists levels the proxy cannot win. An unsolvable level not in the list fails; a listed level is printed as a warning (owner sign-off pending until `ownerSignOff` is set after the manual playthrough); a listed level the proxy now solves also warns (remove it from the list). `tools/levels-lock.json` holds seed-1 (delay 2000) outcome, final tick and final hash per level; `validate:levels` fails on any difference and `pnpm levels:lock` rewrites it (do so only after the rules/content/BOT_VERSION bump that justifies the change).

```sh
pnpm build
pnpm validate:levels
pnpm validate:levels --levels levelview-1 --seeds 1 --format json
pnpm validate:levels --seeds 2 --base <git-revision>
pnpm levels:lock
```

Reports go to stdout: Markdown has one table row per level; JSON has the shared gate fields plus `levels` (wins per proxy delay, idle wins, capped runs, lock entry, errors, warnings). Gate failures exit 1. Measured runtime at 4 seeds: ~38 s for all 20 levels (09 allows dropping CI to `--seeds 2` if over budget).

`balance --levels all --proxy 1000,2000,4000,idle --seeds 20 --jobs 2 --format md|json` is report only (exit 0, no targets, no flags): per level and proxy, win %, median seconds to win, timeout % (capped untimed matches count as timeouts) and median towers. Campaign mode replaces the human seat with the `tw` proxy at the given action delays (`--proxy` tokens are delays in ms plus `idle`); authored AIs stay. `--mode arena` drives every seat with a rotating `tw` proxy (seat `s` gets profile `(s + rotation) % P`). A `worker_threads` pool (default 2) keeps Markdown/JSON byte-identical for `--jobs 1` and `--jobs 2`; the header carries rulesVersion, contentVersion, bot hashes and BOT_VERSION. Files: `src/balance.ts` (matrix, aggregation), `src/balance-match.ts` (one match), `src/balance-pool.ts` (workers), `src/balance-worker.mjs`/`.ts` (worker entry), `src/balance-output.ts` (Markdown).

```sh
pnpm balance --levels all --proxy 1000,2000,4000,idle --seeds 20 --jobs 2
pnpm balance --mode arena --proxy 1000,2000 --seeds 20 --format json
```
