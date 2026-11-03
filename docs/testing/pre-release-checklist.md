# Pre-release checklist

For maintainers preparing a reviewed build. Command contracts remain in [the tools inventory](../../tools/README.md); product acceptance follows [mission](../mission.md).

## Automated evidence

- Run the [full gate chain](gates-and-ci.md) on the intended revision; retain the named-step summary and any extract-dependent skips.
- Run affected [web/PvP browser checks](e2e-and-campaign-verify.md). Run the campaign smoke for campaign/client changes; compare generated captures when visuals change.
- Verify rules/content/bot versions and committed schemas, locks and golden envelopes agree. Follow the [current baseline policy](../reference/versions.md#baseline-reset-and-owner-follow-up).
- Inspect the final diff and require a clean strict parked-gate check. Tests should cover the changed contract; unrelated green tests do not establish acceptance.

## Player and owner smoke

- Campaign: play the affected maps and inspect ownership, route drawing/cutting, win/loss and progress. Spacing-adjusted Common positions 8, 16 and 20 are explicit owner replay targets.
- Online: use fresh tabs with distinct per-tab tokens; create/join, ready/start, finish and rematch. Check a bot seat, Cross teams and watching a running match.
- In a timed match, verify Pause freezes the board/clock and shows Time left. Confirm Leave forfeits only the active seat; exercise reconnect before and after the budget boundary.
- Check result rows, version-mismatch reload behaviour and a disallowed origin. Perform heartbeat/disconnect and drain smoke through the Fly edge using the [runbook](../operations/pvp-server.md).

Production play-testing with a friend and final M2 owner approval remain pending. Recorded scripted/server evidence does not replace those approvals.

## Deployment and follow-up

For server-affecting changes, deploy Fly first and check the live health versions before Firebase web deployment. Keep exactly one machine; drain/restart discards rooms and ends matches without results. Rollback coordinates both server and web to avoid a handshake mismatch. Follow the [operations checklist](../operations/pvp-server.md#first-deploy-checklist) for commands and access requirements.

After the baseline reset merges into main, restore ordinary CI baseline selection as recorded in [the version reference](../reference/versions.md#baseline-reset-and-owner-follow-up).
