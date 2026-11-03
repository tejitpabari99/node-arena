# Browser tests and campaign verification

Use Chromium after installing dependencies and building workspace prerequisites. From the repository root:

```sh
pnpm build:prerequisites
pnpm --filter @node-arena/web exec playwright install --with-deps chromium
```

Content and simulation browser-parity tests also require Chromium for their workspace Playwright installations; CI installs all three. Test hooks are available in development/test bundles, and ordinary production excludes them.

## Choosing a browser check

| Command | Coverage and source |
|---|---|
| `pnpm test:web:e2e` | Test-build preview suite; [web config](../../apps/web/playwright.config.ts) |
| `pnpm test:web:all` | Preview and development suites, sequentially with one worker |
| `pnpm test:pvp:e2e` | Separate client/server suite: lobbies, seats/bots/teams, spectators, pause/Leave, reconnect, resync and mismatch; [PvP config](../../apps/web/playwright.pvp.config.ts) |
| `pnpm campaign:verify` | Opt-in five-second browser/render smoke for each of the 20 Common levels; [campaign config](../../apps/web/playwright.campaign.config.ts) |

Server drain behaviour is covered by [server tests](../../apps/server/test/drain.test.ts) and the manual release smoke. The web suites bind loopback port 4173. PvP additionally uses server port 8081 and an isolated test output build. Configurations refuse to reuse an existing server; run suites serially and free their ports first. PvP's test-only connection-create allowance is raised because all test clients share one IP; production limits stay in server configuration.

## Evidence and limits

Campaign verification records screenshots, a grid and results JSON under the generated directory test-results/campaign/. Its [implementation](../../apps/web/campaign/campaign.spec.ts) checks browser errors and runs the authored campaign list. It proves startup/rendering and simulation progress during the smoke interval; owner playthrough and balance approval remain separate acceptance work.

Playwright preserves test output and retains traces on failure according to each configuration. [Root play instructions](../../README.md#play-online-pvp) give the manual multi-tab flow; [pre-release checks](pre-release-checklist.md) cover the owner smoke and deployment boundary.
