---
assurance:
  id: t-4
  base: sha256:61362271ecc6ddcdcce60852c91c35f20640ac02471795f7db8e6af3cd4aed10
---
# Reject drawing when no slot remains after reverse replacement

> With an owned house and a distinct existing target, a full source still lacking a free slot after any same-owner reverse-line replacement rejects the requested new line without command-caused state changes.

## Step 1

Open http://localhost:4173/?level=1 in the browser and enter the real-time Node Arena battle map for level 1.

## Step 2

On the battle map, establish an owned source house and a different existing target building with an unblocked route, where the source has no free slot even after any same-owner reverse-line replacement.

## Step 3

capture baseline: battle state immediately before the rejected DrawLine command

## Step 4 @verifies ac-19

On the battle map, attempt to establish a directed line from that full owned house to the different existing building, then assert the rejected command causes zero changes to battle state relative to the captured baseline.
