---
assurance:
  id: t-5
  base: sha256:e6db713797d83e3fe74aa33bcf340c620ec5a7ee58d09cd2c2c3b2c4dbf9c830
---
# Draw a permitted line between battle buildings

> Establish a directed connection from the player's owned house to a different existing building with an available slot and unobstructed route.

## Step 1

Open http://localhost:4173/?level=1 in the browser and enter the real-time Node Arena battle map for level 1.

## Step 2

On the battle map, identify a player-owned house and a different existing building with a free source slot, no existing directed line between them, and an unblocked route.

## Step 3 @verifies ac-20

On the battle map, establish a directed connection from the identified owned house to the identified target building, then assert the owner-drawn directed line from that source house to that target building exists on the battle map.
