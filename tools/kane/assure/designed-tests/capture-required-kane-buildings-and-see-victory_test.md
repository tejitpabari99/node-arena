---
assurance:
  id: t-7
  base: sha256:9b8a9c56ce5c983daed1fbccc3758e3e10c6f0d24285a5a8a37f3b24e1a39555
---
# Capture required Kane buildings and see victory

> Capture all non-ignored buildings including neutral, observe the remaining ignored buildings flip, and complete the single Kane level.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena at default Speed 0.25x and locate the panel of outgoing routes grouped by human-owned houses.

## Step 2 @verifies ac-35, ac-36, ac-37, ac-40

In the Kane Arena route panel, use the live ready-route buttons from human-owned houses to capture every non-ignored building, including neutral buildings, without reloading; when the match ends, then assert the Kane result text reads `Victory!`, the feedback banner reads `Game over`, the panel buttons are disabled, and the result dialog title reads `All levels complete!`.
