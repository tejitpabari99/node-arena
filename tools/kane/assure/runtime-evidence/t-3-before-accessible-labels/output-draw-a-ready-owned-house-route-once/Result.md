---
test: ../draw-a-ready-owned-house-route-once_test.md
status: passed
started: 2026-10-24T23:17:21.628Z
duration_s: 102
session_id: cd18d7c2-649a-42f6-bd7d-72f2fa5fefad
---

# Draw a ready owned-house route once — Result

## Step 1 ✓ passed (51.9s)
md5: de58b57f307c49e184b0a8a588c2a7aa
Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena and keep the default Speed 0.25x. Remain completely read-only: do not click or activate any route or other map control. Identify outgoing source groups by the existing section DOM attributes `data-testid="kane-group"` and `data-source`, never by a changing numeric heading. Assert that the initial bottom panel has exactly one outgoing source group, whose `data-source` is `A` for the human-owned house, and no source group with `data-source="E"` for the tower. Within `section[data-testid="kane-group"][data-source="A"]`, assert that the group's own h2 current DOM text starts with `A (blue `, allowing any numeric suffix. Assert that the A → C button within that same source group has DOM text containing `ready`. Anchor these reads on the stable source-group attributes, not on a full heading containing a cached numeric level.

## Step 2 ✓ passed (45.1s)
md5: 1d531a2b31efcff7f4dfbe566675d363
In human-owned house A's bottom-panel outgoing group, locate the A → C ready button using its live target colour and level description. Click that specific A → C ready button exactly once. Wait for the same A → C button's DOM text to contain `A → C · active`, then assert that the same A → C button's DOM text contains `A → C · active`. Do not choose, invert or click another source-target pair.
