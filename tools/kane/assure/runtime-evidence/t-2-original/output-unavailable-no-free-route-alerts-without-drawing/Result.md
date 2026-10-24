---
test: ../unavailable-no-free-route-alerts-without-drawing_test.md
status: failed
started: 2026-10-24T22:46:06.376Z
duration_s: 310
session_id: 2be92bff-1de7-48f9-b486-c2ee4ce2788f
---

# Unavailable no-free route alerts without drawing — Result

## Step 1 ✓ passed (31.3s)
md5: e42d0c7c42fd1083bb779bc3ba24d0e5
Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena; keep the default 0.25x speed and use the bottom route panel.

## Step 2 ✓ passed (108.8s)
md5: c2473ccada0c713760a7e3b0d7cec660
In a human-owned house's bottom-panel outgoing group, use currently ready routes as needed to reach a live grey route button whose text says `no free route`; do not assume any particular pair is unavailable in advance.

## Step 3 ✗ failed (165.1s)
md5: abafdad75835f99a3c66190ee7c04ea2
Reason: Final verification failed: "the red alert banner reads exactly `This building has no free routes.`, the selected pair is not active, and its unavailable button remains clickable" — bug verdict: Assertion ran after route availability changed [automation_bug/timing_sync, confidence 0.93]
In that house's outgoing group, use the still-clickable grey `no free route` button for its displayed pair, then assert the red alert banner reads exactly `This building has no free routes.`, the selected pair is not active, and its unavailable button remains clickable.
