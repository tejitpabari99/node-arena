---
assurance:
  id: t-2
  base: sha256:53dad30fe1108211fe9094631f70bafdec91e775e8ec5f2c4248bba4c83b76ff
---
# Unavailable no-free route alerts without drawing

> When a live owned-house pair shows no free route, click its still-enabled unavailable button and observe the exact alert without drawing or cutting.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena; keep the default 0.25x speed and use the bottom route panel.

## Step 2

In a human-owned house's bottom-panel outgoing group, use currently ready routes as needed to reach a live grey route button whose text says `no free route`; do not assume any particular pair is unavailable in advance.

## Step 3 @verifies ac-6, ac-15, ac-17

In that house's outgoing group, use the still-clickable grey `no free route` button for its displayed pair, then assert the red alert banner reads exactly `This building has no free routes.`, the selected pair is not active, and its unavailable button remains clickable.
