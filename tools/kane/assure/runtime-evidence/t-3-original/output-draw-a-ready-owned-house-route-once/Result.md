---
test: ../draw-a-ready-owned-house-route-once_test.md
status: failed
started: 2026-10-24T22:38:59.770Z
duration_s: 216
session_id: 1a974db3-dc0e-4ff9-8d07-d495efd2c8b8
---

# Draw a ready owned-house route once — Result

## Step 1 ✓ passed (136.1s)
md5: b8790a4cdced67259230924da459b987
Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena; at the default 0.25x speed, locate the bottom panel's outgoing route groups, then assert these groups have human-owned house headings rather than tower source headings.

## Step 2 ✗ failed (75s)
md5: cd34b7f4a94e5b7ad684ee354b13b660
Reason: Final verification failed: "{{source_target_pair}} is active." — bug verdict: Final assertion did not retain the selected pair [automation_bug/config_issue, confidence 0.82]
In a human-owned house's bottom-panel outgoing group, choose a pair whose live button says ready and displays the target's current colour and level; click that ready button once and wait for the same pair's button to show active, then assert the requested source-to-target pair is active.
