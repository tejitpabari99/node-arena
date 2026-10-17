# Bot core

`src/index.ts` exports the guarded `BotContext` and `Bot` contracts, plus the utility engine, match driver and headless harness. Core code imports only public sim exports and content types. Build before running the CommonJS tests, which import the built ESM boundary.

- `createBotDriver(level, matchSeed)` builds one seat per compiled `level.bots` entry. Call `driver.commands(sim)` before each `sim.step`, combining its commands with player commands. Loaded decision intervals floor to ticks (minimum one); profiles without a skill block decide every tick. A seeded phase staggers seats, and each seat mixes the match seed, dense player index and profile-ID FNV-1a hash independently of simulation RNG. Idle seats emit nothing. Repeated calls on the same tick emit nothing and do not advance bot RNG. Create a fresh driver for each match; playback consumes recorded commands instead. The driver reads only the public clock and guarded visible capabilities, and has no browser or filesystem dependencies.
- `createUtilityBot({ player, profile, seed, towerCount, extractors? })` creates one utility seat. `profile` is a resolved, loaded-unit profile; `seed` is the caller's independent per-seat seed. `decide(ctx, tick)` returns ordinary ID-based commands. Cadence, seed mixing, idle seats and match execution belong to the driver.
- `createUtilityScorer({ player, params, seed, towerCount, extractors? })` exposes `prepare(ctx, tick)`, `consideration(id, action, fromIndex, toIndex)` and `score(action, fromIndex, toIndex)` for inspectable decisions. `record` updates local pair history after an accepted action. Call `prepare` before scoring the current view.
- `createComponentExtractors()` returns a registry with `register(name, extractor)`. Extractors return nonnegative int32 values from visible columns. Adding `shoots` needs one extractor and a profile component weight. Definitions are captured when the scorer is created. Missing positive-weight extractors fail at construction.

The consideration registry is exhaustive against content's public `BotConsideration` union. Startup validates its static IDs; `assertConsiderationParity(ids)` supports checking an authoritative ID list at an integration boundary without importing content runtime into core.

Every consideration returns an integer in `0..1000`. Component value normalizes each extractor against that component's largest visible value, then averages using configured component weights. `generates` extracts milli-units per second, `garrison` extracts cap, and `drawsLines`/`capturable` extract presence. Missing components contribute zero.

Generation flow is rate times troop value, split across existing outgoing lines (one additional slice for a proposed draw). Visible in-flight troops also contribute near-term arrival flow, including troops on cut channels. Rates aggregate with int32 saturation. Stored source garrison never contributes attack flow. Capture utility compares travel plus capture ticks against remaining ticks; hostile target generation defends, while neutral generation is inactive. Threat compares hostile arrival flow against generation, allied incoming flow and garrison amortized over remaining seconds. `threatToSource` returns **safety for draws**, so positive weights discourage overextension; cuts receive danger instead. `threatToTarget` returns danger for reinforcement. Distance normalizes against the visible tower bounding extent, weakness uses count/cap, dominance uses owner's tower share, and slice cost favors fewer outgoing lines. Friendly targets and targets already overwhelmed by other incoming flow favor cutting. Stickiness penalizes changing action kind or reversing direction on a recently acted pair, recovering linearly over cooldown ticks.

Scoring truncates `sum(weight * consideration) / sum(weight)` **before** multiplying by the loaded bias and dividing by 1000, then adds seeded sfc32 noise in `[-noise, noise]`. Zero-weight maps score zero. Equal scores prefer source index, then target index. Scores must strictly exceed the fixed hold threshold. Attack enumeration keeps the nearest legal non-friendly targets per source; reinforcement only targets the same owner. Selection rechecks `canDraw`, tracks newly used source slots, and reserves both directions of each emitted pair so replacements and cuts cannot conflict in a batch. Cuts must still name an existing own line.

Omitted optional profile fields use deterministic neutral defaults: bias 1000 per action; attack weight `targetValue:1000`; other action maps empty; component weights `generates:1000,garrison:1000`; hold threshold, cooldown and noise zero; one action per decision; all legal targets retained. Explicit empty maps and zero values are preserved. Personality data overrides these defaults.

Tower and pair typed scratch arrays are allocated once. Geometric milli-distances and exact simulation progress lengths (coordinates multiplied by `TICK_RATE` before `isqrt`) cache against the immutable public `towerStatic` array identity. Nearest target order also caches against that identity. Dynamic numeric team identities, garrison, flow and danger inputs refresh during every preparation; weighted terms depending on only one tower are summed once per decision. Incoming allied flow tracks source pairs, so a line's own in-flight pipeline cannot mark that same line redundant. Reinforcement enumeration filters visible v1 ownership, slot, component and drawn-pair facts; selected commands always call authoritative `canDraw`. Attack entrants also call it to preserve nearest legal target fallback. Troop storage grows during preparation only when the public read reports a larger count. Enumeration, consideration scoring and top-N selection allocate no temporary arrays or objects; emitted commands and the returned array are ordinary allocations. Sim's own public validation may allocate internally. Run `pnpm --filter @node-arena/bots build`, `test` and `lint` to verify this package.

## Headless matches

Import `runMatch` from `@node-arena/bots/harness` (also exported at the package root).
It is synchronous and browser/worker-safe:

```ts
import { createProfileBot } from '@node-arena/bots';
import { runMatch } from '@node-arena/bots/harness';

const proxy = createProfileBot(level, seed, humanPlayerId, resolvedReferenceProfile);
const result = runMatch({
  level, seed, controllers: [proxy],
  record: { rulesVersion, schemaVersion, contentVersion },
});
```

`controllers` is an optional array of `Bot` or `{ player, commands: [{ tick, cmd }] }`
scripted controllers. Each entry replaces the level's default controller for that player
ID; unspecified compiled bot seats still use their profiles. Uncontrolled human seats
are idle. Invalid/duplicate player mappings fail before decisions. Commands must belong
to the controller's player. Script entries use nonnegative int32 **pre-step** ticks in
nondecreasing order; several commands can share a tick. Scripts are ordinary agent-authored
command lists, suitable for recording band-4 solution replays. Entries after the match ends
are unused. Controllers run in dense player order, independent of override array order.

Raw `Bot.decide` runs before every tick and receives only the guarded `view`, `canDraw`
and `readTroops` capabilities. Use `createProfileBot(level, seed, playerId, resolvedProfile)`
to bind a tooling profile such as `reference`, `human-proxy` or `idle` to any seat. Its
seed, decision interval and phase are exactly those of the default driver; it schedules
internally and suppresses repeated calls on a tick. Profiles use loaded integer units.
Create new controllers for each match because RNG, cooldowns and scripts are match-local.

`record` is authoritative `ReplayMetadata`, or omitted/`false` to disable recording.
Compiled levels do not carry content-envelope versions, so the caller supplies them;
the harness never invents a replay header. Both modes step with `events:false`, inspect
the cumulative `sim.rejected` counter after each step and throw immediately on any
rejection. The recorder stores ordinary submitted commands and checkpoints. Public
`playReplay({level, metadata}, result.replay)` verifies playback without running bots.

The result has `{ outcome, ticks, replay, stats }`. `outcome` retains sim's
`{ outcome: 'won'|'lost'|'draw'|'timeout', winnerTeam }` meaning; tooling should use
`winnerTeam` to identify a winning team. Sim results are human-relative: with no human
seat alive, sim can report `lost` while multiple bot teams remain, so arena tools should
keep the intended player seat kind rather than convert every seat to `kind:'bot'`.
Omitted `maxTicks` runs to the level's configured limit. A shorter safety cap returns
`{outcome:'truncated', winnerTeam:null}` and records a partial replay whose outcome is
null; it cannot be mistaken for a terminal win or the level's timeout. `maxTicks:0`
returns an unstepped truncated match.

`stats` contains `finalHash`, `rejected` (zero for every returned result), `commandCount`,
`timeLimitTicks`, `players` and `towers`. Player rows carry `player`, `team`, `alive`,
`towers`, `garrison`, `transit`, `lines`, and all four cumulative counters (`generated`,
`overflowLost`, `kills`, `captures`). `transit` preserves sim's in-flight troop **value**,
not object count. Tower rows carry `tower`, `owner` (ID or null), `slots`, `lines` and
all final visible component columns in `col`. Every numeric statistic preserves exact
integer units; results are detached from the live view and contain no bot-local state.

## Test coverage

`pnpm --filter @node-arena/bots test` includes the Chromium parity gate, using the
workspace web package's installed Playwright and Vite. Install Chromium with
`pnpm --filter @node-arena/web exec playwright install chromium` on a fresh machine.
The gate launches one headless browser and bundles only the bot/sim test adapter;
it compares complete command logs, outcomes, ticks and final hashes for authored
content and eight seeded, schema-validated generated levels. No web server or GPU
rendering is involved. The generated corpus varies neutral/hostile ownership,
three distinct teams, profile tiers, tower caps, generation archetypes, troop
speeds and slot thresholds within supported v1 rules.

Every corpus match checks rejection and slot invariants after every tick, compares
the driver with a fresh recorded harness run, and verifies replay with bot profiles
that throw on access. Tiny-view tests assert exact or directional expectations for
all considerations, including the `shoots` extractor extension. Scenario tests
observe actual neutral capture and subsequent cut, safe/unsafe reinforcement,
hold/idle behavior and authored personality timing. Zero-noise seed invariance is
checked on identical per-decision views: driver phases deliberately depend on the
match seed, so different seeds can change cadence even when noise is zero.

## Bot versions, goldens and performance

`BOT_VERSION` is a pure export from `src/version.ts`, initially `1.0.0`. Increase it
when changing bot algorithms or resolved profiles. Both `check:content --base <ref>`
and `validate:content --base <ref>` compare freshly generated bot hashes against
committed hashes and require a strictly increasing version if they differ. Regenerating
`hashes.lock.json` cannot bypass the check. Node adapters read the current and historical
literal as data; content runtime never imports bots or Node I/O. The first bot version
can establish its baseline when an older revision has no version file.

```sh
pnpm --filter @node-arena/bots build
pnpm bots:golden
pnpm bots:golden --update
pnpm bench:bots
pnpm bench:bots --ci
```

`bots:golden` reruns three fixed compiled corpus fixtures (`random-6`/seed 1,
`random-0`/seed 37, `random-3`/seed 704). The committed JSON bundle contains complete
ordinary command logs and replays, level inputs with recomputed simulation identities,
resolved bot hashes and authoritative replay metadata. Every generated replay plays
back through the public sim API. Comparison includes all bundle data, so unversioned
algorithm changes fail even if final outcomes coincide. `--update` requires a semver
increase over the existing bundle and committed HEAD bundle; initial `1.0.0` bootstrap
is allowed. Deleting or replacing the working fixture does not erase the committed
version guard. Build after editing the source version, then commit it with regenerated
goldens. `replay:verify golden` includes these three matches without instantiating bots.

`bench:bots` generates 2,000 live troops through ordinary simulation commands on a
50-tower, 50-line fixture (25 towers per opposing team). It times the complete
`rusher-expert` utility decision, including public troop reads, preparation, candidate
enumeration, scoring and final legality checks. It uses an active stable snapshot to
isolate decision time from sim stepping, with live bot RNG/history; no driver cadence
shortcut or hidden bot access is involved. After 1,000 warmup decisions it measures
5,000 individual decisions and reports environment, mean and nearest-rank p99.
The fixture uses a fixed translation into the authored coordinate bounds; pair distances, tower counts and troop workload are unchanged. Strict mode fails at p99 >= 1 ms. `--ci` (or `CI=1`/`true`) uses the prescribed noise
margin and fails at p99 >= 5 ms. Unit tests cover both exact failure boundaries.

Task8 verification on Node v22.23.3, Linux x64 / AMD EPYC-Rome passed the strict
1 ms target: mean **0.597239 ms**, p99 **0.881843 ms**. The complete unchanged
benchmark ran on CPU 1 using `taskset` for its own process after a two-second
per-core activity sample. Other work consumed approximately 0.022 CPU seconds on
that core during the 4.380-second run. Earlier runs were affected by unrelated test
processes; the prescribed CI margin also passed (p99 3.8184 ms). No workload,
timing boundary or threshold was relaxed. Functional validation passed 82 bot
tests (including Chromium parity), three unchanged golden comparisons and all
14 replay playbacks. The measured strict run is recorded in
[benchmark-evidence.json](benchmark-evidence.json).
