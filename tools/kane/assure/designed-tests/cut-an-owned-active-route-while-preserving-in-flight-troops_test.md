---
assurance:
  id: t-4
  base: sha256:eda769b1b8352e481e1308a641a020a5263b8e21ad9d62642a85b64696c79c09
---
# Cut an owned active route while preserving in-flight troops

> Draw an owned ready route, allow an in-flight troop, then after at least 700 ms double-click its active panel button to remove the line while previously launched troops continue and new departures stop.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the browser to enter Kane Arena at the default Speed 0.25x; in the bottom outgoing-routes panel identify a live green ready pair under a human-owned house, avoiding unavailable pairs.

## Step 2

On that pair's ready button, draw its route and wait for its button to say active and for a troop to be visibly in flight toward the target in the arena.

## Step 3 @verifies ac-19, ac-21, ac-22, ac-24

At least 700 ms after drawing, on the same red active pair button in the outgoing-routes panel, double-click to cut the route; follow the already in-flight troop to its target while play continues at Speed 0.25x, then assert the pair is no longer active, the previously in-flight troop continues toward its target, and no new troops depart on that cut route.
