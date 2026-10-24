---
assurance:
  id: t-1
  base: sha256:3158e117967f67cfee13487bc35c208f4a113d2b2a0c948f4ffba091b23c2c0c
---
# Replace a same-owner reverse route without recalling troops

> From two human-owned houses, draw an outgoing line and reverse it from the destination after confirming a ready reverse route; the old reverse line disappears while previously launched troops continue.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena; keep the default 0.25x speed and use the bottom route panel.

## Step 2

In Kane Arena, establish a live match with two human-owned houses and identify their letter-tagged route buttons where one direction can be drawn and the reverse direction can subsequently show ready.

## Step 3

In the bottom panel, draw the ready route from the first owned house to the second exactly once, wait for that button to show active, and observe a troop already in flight toward the second house.

## Step 4 @verifies ac-8, ac-9, ac-10

In the second human-owned house's outgoing group, draw the ready reverse route exactly once while that troop is still in flight, wait for the reverse button to show active, then assert the new ordered pair is active, the original-direction pair is no longer active, and the already-in-flight troop continues toward its original target.
