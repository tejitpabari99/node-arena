---
assurance:
  id: t-9
  base: sha256:5e363277b2c384f6b1a1af34f22376f39c7664ebbc4af762d14948882b6370fd
---
# Observe timeout on a configured Kane level

> On a level with timeLimitSec set, reach the phase-9 tick threshold with mixed ownership and no prior win or loss, and observe timeout loss.

## Step 1

Open {{timed_level_url}} in the Kane Arena test build, on a level configured with timeLimitSec and mixed ownership; use its match panel at Speed 0.25x.

## Step 2 @verifies ac-32, ac-35, ac-36, ac-39

On the timed Kane Arena level, keep at least one non-ignored building human-owned and at least one not human-owned until tick reaches timeLimitSec × tickRate at phase 9; after the deadline, then assert the result text reads `Time up`, the banner reads `Game over`, and the panel buttons are disabled.
