---
assurance:
  id: t-3
  base: sha256:a4eb682ecbf2c453b6c253a536cccd12bc84001af5c00d5db89a196bd231d6aa
---
# Draw a ready owned-house route once

> In the test-build panel select a currently ready human-owned house-to-target pair, read the current target description, draw once, and wait for that pair to become active.

## Step 1 @verifies ac-14

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena; at the default 0.25x speed, locate the bottom panel's outgoing route groups, then assert these groups have human-owned house headings rather than tower source headings.

## Step 2 @verifies ac-8, ac-16

In a human-owned house's bottom-panel outgoing group, choose a pair whose live button says ready and displays the target's current colour and level; click that ready button once and wait for the same pair's button to show active, then assert the requested source-to-target pair is active.
