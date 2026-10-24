---
assurance:
  id: t-3
  base: sha256:da6c23c5904edb0bc961314d670a12e80cabc22426d6cee6f97fb0d1792bef0f
---
# Draw a ready owned-house route once

> In the test-build panel select a currently ready human-owned house-to-target pair, read the current target description, draw once, and wait for that pair to become active.

## Step 1 @verifies ac-14

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena and keep the default Speed 0.25x. Remain completely read-only: do not click or activate any route or other map control. Inspect the region with accessible name `Outgoing routes`. Scope every outgoing-source-group count and tower-absence read inside that named region, never on whole-page text. Inside that region, assert exactly one outgoing source group identified by `section[data-testid="kane-group"]`; its `data-source` is `A` for the human-owned house, its role is `group`, and its accessible name is `House A outgoing routes`. Assert inside the same `Outgoing routes` region that no outgoing source group has `data-source="E"` for the tower. Within the named `House A outgoing routes` group, inspect its own h2 using the stable accessible name `House A routes`. Assert that this heading's current visible DOM text starts with `A (blue `, allowing any numeric suffix; the current count is dynamic and is also exposed as the accessible description, so do not use any exact numeric text as an identity or expected count. Assert that the A → C button within that same named A group has DOM text containing `ready`. Anchor aggregate reads on the named `Outgoing routes` region, source-A metadata reads on the named `House A outgoing routes` group, and the h2 read on `House A routes`.

## Step 2 @verifies ac-8, ac-16

In human-owned house A's bottom-panel outgoing group, locate the A → C ready button using its live target colour and level description. Click that specific A → C ready button exactly once. Wait for the same A → C button's DOM text to contain `A → C · active`, then assert that the same A → C button's DOM text contains `A → C · active`. Do not choose, invert or click another source-target pair.
