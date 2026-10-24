---
assurance:
  id: t-5
  base: sha256:695d0cc1b4aed001d25c366e7e045dfa7f49d867759113f1d975c431e5341d33
---
# Keep an active route after one click

> Draw a ready owned route, then click its active button once and observe the active route remains.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena at the default Speed 0.25x. Observe the bottom panel's human-owned house A group without clicking or activating any route. Assert that the A → C button's DOM text contains `ready`.
## Step 2

In human-owned house A's bottom-panel outgoing group, click only the A → C ready button once. Wait for that same A → C button's DOM text to contain `active`, then assert that the A → C button's DOM text contains `active`. Take no actions on another source-target pair.
## Step 3 @verifies ac-23

Single-click that same A → C active button exactly once. Assert that the same A → C button's DOM text still contains `active`. Take no actions on another source-target pair.
