---
assurance:
  id: t-3
  base: sha256:1fe9c9186cbfa7427071488da1742dfa1f0b9363a7ef25fda75be03a4fc0ba8c
---
# Lose the last qualifying building despite troops in transit

> Reach defeat when the human owns no nonignored buildings despite human troops in transit; ensure loss does not complete the campaign level.

## Step 1

At http://localhost:4173/?level=1, load the Node Arena level 1 battle and reach its in-battle map and HUD.

## Step 2 @verifies ac-17

In the level 1 battle HUD, inspect the control share bar's accessible label, then assert the bar has an aria-label of the form "Control share: N%" for a numeric N.

## Step 3 @verifies ac-7, ac-16

On the level 1 battle's WebGL map, reach a state with human troops visibly in transit while the human loses ownership of the last nonignored building, then assert the battle ends in a loss with a result dialog showing "Defeat".
