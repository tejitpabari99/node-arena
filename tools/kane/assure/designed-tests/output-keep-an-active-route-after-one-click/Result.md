---
test: ../keep-an-active-route-after-one-click_test.md
status: passed
started: 2026-10-24T22:52:38.295Z
duration_s: 121
session_id: 7313a3b0-a703-4d0e-9765-bf270e3a2812
---

# Keep an active route after one click — Result

## Step 1 ✓ passed (32s)
md5: c0f3e3deac8dd99832683e0a5ea14c54
Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena at the default Speed 0.25x. Observe the bottom panel's human-owned house A group without clicking or activating any route. Assert that the A → C button's DOM text contains `ready`.

## Step 2 ✓ passed (46.8s)
md5: 6ea24c80b526555b8d0405a1f082ebf7
In human-owned house A's bottom-panel outgoing group, click only the A → C ready button once. Wait for that same A → C button's DOM text to contain `active`, then assert that the A → C button's DOM text contains `active`. Take no actions on another source-target pair.

## Step 3 ✓ passed (37.1s)
md5: a059dad0aa9755d2e468906ccaa73c9e
Single-click that same A → C active button exactly once. Assert that the same A → C button's DOM text still contains `active`. Take no actions on another source-target pair.
