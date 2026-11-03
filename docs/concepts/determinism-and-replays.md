# Determinism and replays

A match is determined by compiled content, seed, optional PvP team setup and the ordered commands submitted at each tick. [Game rules R-TCK-01 through R-TCK-06](../specs/game-rules.md#1-conventions) define the contract; browser frame timing and network arrival timing are handled outside the simulation.

## Fixed ticks and integer state

[TICK_RATE](../../packages/sim/src/math.ts) is 20 ticks per simulation second: one fixed step represents 50 ms. Pause stops steps, while local accelerated play changes their wall-clock cadence. Content fields tagged as fixed point accept at most three decimal places and compile at scale 1000 through [fixed-point conversion](../../packages/content/src/fixed-point.ts).

Simulation arithmetic uses checked integers, integer division and integer square roots. Iteration and command ordering are explicit. [Named random streams](../../packages/sim/src/streams.ts) derive reproducible draws from the match seed; wall-clock values and unseeded randomness do not determine outcomes.

## What a replay contains

The [recorder and player](../../packages/sim/src/replay.ts) store:

- A header with rules/schema/content versions, level ID, level simulation hash, seed and optional teams.
- Commands stamped with the simulation tick before the step advances it.
- State-hash checkpoints every 20 completed ticks, plus final tick, hash and outcome.

Playback executes recorded commands without running bots. It checks rules major/minor, exact schema/content identity and the level hash, then compares checkpoints and final state. Malformed input is rejected; a state disagreement reports the first observable divergent checkpoint or final tick.

The content simulation hash identifies compiled inputs; a running-state hash identifies a particular simulation state. They serve different checks. [Golden replay gates](../../tools/README.md#gates) retain expected outcomes and hashes to catch unintended changes. Mechanics changes follow [rules-first change order](../decisions/0005-rules-first-change-order.md).

## Shared use in PvP

PvP clients consume the server's command log and step this same engine. Hash checkpoints and replay-based catch-up use that reproducibility; [match lifecycle](pvp-match-lifecycle.md) explains the surrounding connection state.
