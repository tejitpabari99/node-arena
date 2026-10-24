---
assurance:
  id: t-3
  base: sha256:7ce15b72b7028037c4c60c294be7cb7173b11e4c46955db33bcd0f849d022752
---
# Draw a ready owned-house route once

> In the test-build panel select a currently ready human-owned house-to-target pair, read the current target description, draw once, and wait for that pair to become active.

## Step 1 @verifies ac-14

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena and keep the default Speed 0.25x. Observe the bottom panel's outgoing route groups without clicking or activating any route. Assert that these groups have human-owned house headings rather than tower source headings, and that the A → C button in human-owned house A's group has DOM text containing `ready`.
## Step 2 @verifies ac-8, ac-16

In human-owned house A's bottom-panel outgoing group, locate the A → C ready button using its live target colour and level description. Click that specific A → C ready button exactly once. Wait for the same A → C button's DOM text to contain `A → C · active`, then assert that the same A → C button's DOM text contains `A → C · active`. Do not choose, invert or click another source-target pair.
