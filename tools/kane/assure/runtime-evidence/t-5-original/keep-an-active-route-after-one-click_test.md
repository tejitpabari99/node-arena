---
assurance:
  id: t-5
  base: sha256:55da62e4eb027c33abfdbb9b27341aef7d84d991944fc4eaca6e956aea68d787
---
# Keep an active route after one click

> Draw a ready owned route, then click its active button once and observe the active route remains.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the browser to enter Kane Arena at Speed 0.25x; identify a live green ready pair in the bottom outgoing-routes panel under a human-owned house.

## Step 2

Draw that ready pair and wait for the same outgoing-routes button to display active.

## Step 3 @verifies ac-23

On the red active button for that same pair in the outgoing-routes panel, click once, then assert that the pair remains active.
