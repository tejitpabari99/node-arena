---
assurance:
  id: t-8
  base: sha256:785fcb2f8ce3d6b9a925479ea53b6ddb570371bedfc2459a3d9e97306f75a9e9
---
# Observe defeat despite human troops in flight

> Let the last non-ignored human building fall despite remaining troops in transit and observe defeat without campaign completion.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena at default Speed 0.25x and locate the panel of outgoing routes grouped by human-owned houses.

## Step 2 @verifies ac-29, ac-35, ac-36, ac-38, ac-41

From the Kane Arena route panel, draw a live ready route from a human-owned house and allow its troops to enter transit while the remaining non-ignored human-owned buildings fall; on match end, then assert the result is `Defeat` despite human troops in flight, the feedback banner reads `Game over`, panel buttons are disabled, and the result dialog title reads `Defeat`.
