---
test: ../draw-a-ready-owned-house-route-once_test.md
status: passed
started: 2026-10-24T22:56:10.328Z
duration_s: 143
session_id: c357ba6e-ab4f-4aff-a326-54a792ade5bf
---

# Draw a ready owned-house route once — Result

## Step 1 ✓ passed (50.1s)
md5: 6aebd51218c4f0c0f84d07f93b221ffb
Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena and keep the default Speed 0.25x. Observe the bottom panel's outgoing route groups without clicking or activating any route. Assert that these groups have human-owned house headings rather than tower source headings, and that the A → C button in human-owned house A's group has DOM text containing `ready`.

## Step 2 ✓ passed (88.1s)
md5: 1d531a2b31efcff7f4dfbe566675d363
In human-owned house A's bottom-panel outgoing group, locate the A → C ready button using its live target colour and level description. Click that specific A → C ready button exactly once. Wait for the same A → C button's DOM text to contain `A → C · active`, then assert that the same A → C button's DOM text contains `A → C · active`. Do not choose, invert or click another source-target pair.
