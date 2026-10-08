# SP02 golden replays

`baseline.json` commits complete compiled inputs, seed, submitted commands,
checkpoint hashes, final tick/hash/outcome, and the event-log hash for each fixture.
`scenarios.ts` is the executable fixture definition; the checker requires the entire
committed baseline to equal its freshly recorded result. No scenario mutates sim
state. Each command goes through `createReplayRecorder.step`, and every recording
is verified by `playReplay` with explicit authoritative metadata and compiled level.
These are SP02 test-owned levels, not SP05 campaign content; no bots run here.
Level identities use the content package's canonical compiled-input hash.

| Fixture | Purpose |
| --- | --- |
| generation-cap | Fractional rate reaches cap; stopped accumulator does not bank generation |
| persistent-cut-replaced | Persistent sends, friendly reverse replacement, explicit cuts, surviving transit |
| slot-reduction | Incoming hit crosses strict slot threshold; newest line is cut |
| head-on-clash | Generated hostile fronts meet exactly at the clash boundary |
| overshoot-capture | Faster/larger overshoot beats channel index; later arrival recaptures |
| cap-overflow | Capped sender sends; capped friendly receiver reports overflow |
| command-rejections | Submitted order and duplicate/self/unknown rejections are replayed |
| mutual-defeat | Empty players eliminate together; draw outcome |
| full-transit-win | Full game: enemy tower captured at tick 2; last transit clears at 101, then won |
| full-human-loss | Full game: enemy takes last human tower at tick 4, then lost |
| full-stalemate-timeout | Full game: continuous clashes reach the 60-tick limit, then timeout |

`run.ts` hashes the ordered JSON event log through the same integer word-hash
implementation used by state hashes, with its own domain prefix. The browser
fixture exposes complete logs and replay results, so parity checks compare actual
events as well as hashes. The Node test builds this fixture with Vite and runs it in
real headless Chromium using Playwright, including playback of every committed record.

Run `pnpm sim:golden` to check Node replays and committed version discipline;
`pnpm --filter @node-arena/sim test` also verifies Chromium parity and guard behavior.
Both commands are suitable for CI; SP04 owns workflow composition. The pinned
Playwright/Vite versions match the content package. Chromium must be installed:
`pnpm --filter @node-arena/sim exec playwright install chromium`.

Updates use `pnpm sim:golden --update`. Versions come only from
`packages/content/content.json`. An update always requires a strictly increased
version against every existing and HEAD-committed baseline, even for unchanged
state. Changing behavior without changing fixture inputs requires `rulesVersion`;
changing fixture inputs requires `contentVersion` or `schemaVersion`. No version
may decrease. Only a missing initial baseline can bootstrap. Deleting the working
baseline cannot bypass the committed baseline check. Refused updates do not write.

The check path also compares changed baselines with `HEAD^`, catching direct JSON
edits and committed changes that skip the updater. CI can set
`SIM_GOLDEN_BASE_REF` to a valid PR merge-base or push base instead of `HEAD^`.
An absent baseline in a valid base commit permits initial bootstrap; an invalid
base reference fails. Tests use isolated metadata copies and temporary Git repos;
the authoritative content envelope is never bumped to make a test or bootstrap pass.
