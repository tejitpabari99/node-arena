# Level gate fixture corpus

`corpus.json` contains the authored source/target archetypes and isolated two-seat level used by `levels.test.ts`. The test loader merges these into a copy of current content in memory; campaign content and bot profiles are never edited.

- `win`: strong reference versus an authored idle opponent; four real wins, zero idle wins.
- `lose`: one-second duration ends before troops arrive; zero reference wins.
- `partial`: short duration and a fixture-only reference decision interval of 0.2 seconds yield wins for seeds 1–3 and timeout for seed 4. All outcomes come from real simulation runs.
- `idle-win`: adversarial compiled ownership starts with both towers human-owned. The content validator already rejects this authored ownership; the runtime gate independently rejects the automatic idle win.

Tests generate real winning replays from stamped human commands. They verify fallback eligibility, stale simulation identity, unrelated levels, a valid replay with overridden foreign bots, and committed/uncommitted solution files in an isolated temporary Git repository. Replays and reports from tests are removed afterward.
