---
assurance:
  id: t-2
  base: sha256:21caa40929e5cb5a8de9de8bf4ae8e78162c64412e0ce4f75796d2d2ca55180c
---
# Win the battle after capturing qualifying buildings

> Reach victory after human ownership of all nonignored buildings including a neutral building; check ignored-building ownership and campaign completion where observable.

## Step 1

At http://localhost:4173/?level=1, load the Node Arena level 1 battle and reach its in-battle map and HUD.

## Step 2 @verifies ac-17

In the level 1 battle HUD, inspect the control share bar's accessible label, then assert the bar has an aria-label of the form "Control share: N%" for a numeric N.

## Step 3 @verifies ac-5, ac-15

On the level 1 battle's WebGL map, reach human ownership of every nonignored building, including any neutral qualifying building, then assert the battle ends in a win with a result dialog showing "Victory!".
