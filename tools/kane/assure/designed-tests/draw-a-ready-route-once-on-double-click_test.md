---
assurance:
  id: t-6
  base: sha256:e0f38d8032e84775fe4f113a49da6d3eaa59c3f303da58c7431681c04ed1c64d
---
# Draw a ready route once on double-click

> On an owned ready route, double-click the panel button and observe one active drawn route rather than an immediate cut.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the browser to enter Kane Arena at Speed 0.25x; in the bottom outgoing-routes panel identify a live green ready pair under a human-owned house.

## Step 2 @verifies ac-25

On the identified ready pair's button, double-click and inspect the resulting route in the arena and its panel state, then assert that exactly one line for that source-target pair was drawn and its button shows active rather than being immediately cut.
