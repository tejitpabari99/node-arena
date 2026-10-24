---
assurance:
  id: t-1
  base: sha256:e824da8488e37e5ffd5a07d915f927d8453ec213e5253aad6de3f66dfbeb2f65
---
# Open battle-options dialog from level 1

> From an active battle, open the HUD's Back to battle options dialog and observe its prompt and three named choices, without assuming what selecting a choice does.

## Step 1

At http://localhost:4173/?level=1, load the Node Arena level 1 battle and reach its in-battle HUD.

## Step 2 @verifies ac-1, ac-2, ac-3, ac-4

In the level 1 battle HUD, open "Back to battle options", then assert the dialog titled "Do you want to restart the battle?" is visible and contains the Restart, Continue, and Levels buttons.
