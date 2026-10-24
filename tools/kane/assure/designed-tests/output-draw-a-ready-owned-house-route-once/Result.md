---
test: ../draw-a-ready-owned-house-route-once_test.md
status: passed
started: 2026-10-24T23:31:12.509Z
duration_s: 120
session_id: 2f1c6e4f-3fde-4238-b800-7e8e15961727
---

# Draw a ready owned-house route once — Result

## Step 1 ✓ passed (73.5s)
md5: c810a4267f61a8ead1e478c088e52418
Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena and keep the default Speed 0.25x. Remain completely read-only: do not click or activate any route or other map control. Inspect the region with accessible name `Outgoing routes`. Scope every outgoing-source-group count and tower-absence read inside that named region, never on whole-page text. Inside that region, assert exactly one outgoing source group identified by `section[data-testid="kane-group"]`; its `data-source` is `A` for the human-owned house, its role is `group`, and its accessible name is `House A outgoing routes`. Assert inside the same `Outgoing routes` region that no outgoing source group has `data-source="E"` for the tower. Within the named `House A outgoing routes` group, inspect its own h2 using the stable accessible name `House A routes`. Assert that this heading's current visible DOM text starts with `A (blue `, allowing any numeric suffix; the current count is dynamic and is also exposed as the accessible description, so do not use any exact numeric text as an identity or expected count. Assert that the A → C button within that same named A group has DOM text containing `ready`. Anchor aggregate reads on the named `Outgoing routes` region, source-A metadata reads on the named `House A outgoing routes` group, and the h2 read on `House A routes`.

## Step 2 ✓ passed (41.2s)
md5: 1d531a2b31efcff7f4dfbe566675d363
In human-owned house A's bottom-panel outgoing group, locate the A → C ready button using its live target colour and level description. Click that specific A → C ready button exactly once. Wait for the same A → C button's DOM text to contain `A → C · active`, then assert that the same A → C button's DOM text contains `A → C · active`. Do not choose, invert or click another source-target pair.
