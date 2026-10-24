---
assurance:
  id: t-3
  base: sha256:1c13a6fc5a12673b79e0495e172ca5a842b559e3922d74c41593e079ca2ee941
---
# Draw a ready owned-house route once

> In the test-build panel select a currently ready human-owned house-to-target pair, read the current target description, draw once, and wait for that pair to become active.

## Step 1 @verifies ac-14

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena and keep the default Speed 0.25x. Remain completely read-only: do not click or activate any route or other map control. Identify outgoing source groups by the existing section DOM attributes `data-testid="kane-group"` and `data-source`, never by a changing numeric heading. Assert that the initial bottom panel has exactly one outgoing source group, whose `data-source` is `A` for the human-owned house, and no source group with `data-source="E"` for the tower. Within `section[data-testid="kane-group"][data-source="A"]`, assert that the group's own h2 current DOM text starts with `A (blue `, allowing any numeric suffix. Assert that the A → C button within that same source group has DOM text containing `ready`. Anchor these reads on the stable source-group attributes, not on a full heading containing a cached numeric level.
## Step 2 @verifies ac-8, ac-16

In human-owned house A's bottom-panel outgoing group, locate the A → C ready button using its live target colour and level description. Click that specific A → C ready button exactly once. Wait for the same A → C button's DOM text to contain `A → C · active`, then assert that the same A → C button's DOM text contains `A → C · active`. Do not choose, invert or click another source-target pair.
