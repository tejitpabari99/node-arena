---
test: ../panel_draw_cut_test.md
status: passed
started: 2026-10-24T20:50:38.721Z
duration_s: 80
session_id: 8474fbad-f6b8-4ee4-bdab-de572d88b0bd
---

# A → C button changes from ready to active — Result

## Step 1 ✓ passed (30.4s)
md5: 2593357a0347a08b7691a19d465595e3
Open http://localhost:4173/?kane=1&seed=1 and locate the bottom-panel green button whose text begins A → C, then assert its DOM text contains ready.

## Step 2 ✓ passed (42.5s)
md5: ee788e53a999b87251f0fa107f71f983
On that bottom-panel green A → C button, activate it once, then assert the same button's DOM text contains active.
