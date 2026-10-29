# Node Arena

Browser tower-strategy game: draw persistent routes, capture buildings and complete a 20-level solo campaign. Landscape client with Green and Snow themes, soldiers, tanks, towers, obstacles and scripted AI.

> Assets based on / motivated by Tower War. See [credits](docs/CREDITS.md).

## Contents

- `packages/defs/` — pure registries for modules, bot kinds, commands, objectives, events and phases.
- `packages/content/` — browser-safe schemas, validation, compilation, content data and hash locks.
- `packages/sim/` — deterministic integer simulation, replay playback, goldens and benchmarks.
- `packages/bots/` — default/scripted AI and human proxy.
- `packages/net/` — transport-free multiplayer protocol, session and lockstep core.
- `apps/server/` — PvP game server (`@node-arena/server`, Node + ws).
- `apps/web/` — Vite + Preact + Three.js client, local progress/audio settings and browser tests.
- `tools/` — importers, asset pipeline, gates, level determinism and balance reports; [commands and gate semantics](tools/README.md).
- `docs/GAME_RULES.md` — mechanics contract, stable rule IDs and version history.
- `docs/CONTENT_GUIDE.md` / `docs/LEVELS_GUIDE.md` — authoring, import policy, versions and feature coverage.
- `docs/research/` — teardown evidence and historical research; `docs/agent_files/` — approved designs/tasks and run records.
- `docs/FUTURES.md` — deferred features.
- `docs/PVP_OPS.md` — owner runbook for the PvP server on Fly.io (deploy, rollback, health, heartbeat check).

The shipped campaign is the Common list's positions **4–23** (tutorial positions 1–3 omitted), shown as levels 1–20 in the client. `packages/content/data/campaigns/common.json` is authoritative. Cargo and tutorial scripts are dropped; position 23 also drops one wall. These are documented fidelity limits in the levels guide. Local two-player PvP is available below; later campaign positions remain deferred.

## Screenshots

Actual client captures from the campaign browser verification, resized to 960px wide for this README.

| Level 1 · Green | Level 10 · Green | Level 20 · Snow |
|---|---|---|
| ![Green level 1](docs/img/tw-level-01.png) | ![Green level 10](docs/img/tw-level-10.png) | ![Snow level 20](docs/img/tw-level-20.png) |

## Development

Requires Node >=22.13 and pnpm 10.34.6 (pinned by the package manager field). Run from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm build:prerequisites
pnpm --filter @node-arena/web exec playwright install --with-deps chromium
pnpm dev
```

Chromium is also needed by content/sim browser parity checks; install it with the same workspace command for those packages if their Playwright versions differ. CI installs all three.

| Command | Purpose |
|---|---|
| `pnpm build` | Build all workspaces and production client |
| `pnpm test` | Workspace tests |
| `pnpm lint` / `pnpm typecheck` | Static checks |
| `pnpm run ci` | Named gate chain, including browser parity; [baseline and parking](tools/README.md#ci-and-version-baselines) |
| `pnpm test:web:e2e` / `pnpm test:web:all` | Test-build browser suite / preview + development suites |
| `pnpm campaign:verify` | Opt-in 20-level browser smoke and captures in the generated directory test-results/campaign/ |
| `pnpm validate:levels` / `pnpm levels:lock` | Check / regenerate seed-1 campaign determinism lock |
| `pnpm check:docs` / `pnpm check:parked --strict` | Documentation consistency / closing parked-gate check |

Committed levels and assets work without the original extract. Set `TW_EXTRACT` to the Tower War extract directory for `pnpm import:tw`, `pnpm check:import`, `pnpm assets:tw` and `pnpm assets:tw:check`. Without it, import writes fail with an explanation; import verification and art regeneration/checks skip. CI never downloads the extract; `pnpm check:manifest` still checks committed asset hashes, budgets and credits. See the [levels guide](docs/LEVELS_GUIDE.md) and [tools guide](tools/README.md) before regenerating data.

## Play online (PvP)

M1 supports local Duel S 1v1. After the Development prerequisites above (including `pnpm build:prerequisites`, which builds net), run:

```sh
pnpm dev:pvp
```

The command works in Windows Command Prompt/PowerShell, macOS and Linux. Keep the process running: web uses port 5173, server uses 8080. Existing `PORT` and `ALLOWED_ORIGINS` environment values override the server defaults. Plain `pnpm dev` runs only the web client.

1. Tab A: open <http://127.0.0.1:5173/>, select **Play online**, enter a nickname, then **Create room**. M1 selects Duel S automatically; confirm the lobby map is **Na Pvp Duel S**.
2. Note the four-character **Room code**. Replace XXXX in `http://127.0.0.1:5173/?room=XXXX` with that code.
3. Open a genuinely fresh tab with your browser's New Tab command, then paste that URL into its address bar. Use the same browser profile if desired. Avoid Duplicate Tab or opening from a tab that copies its session storage: each player needs a distinct per-tab token.
4. Tab B: a saved nickname joins automatically. A new visitor sees the nickname field and prefilled room code: enter a nickname, then **Join**. You may use a separate browser profile for a different saved nickname.
5. Tab B: press **Ready**. Tab A: press **Start** (the host is already ready). After the countdown, draw routes from your buildings to capture the opponent's buildings. Keep both tabs visible in separate windows for the play-test; background tabs may throttle rendering.
6. Finish the match and confirm both tabs show the corresponding Victory!/Defeat result (or Draw on both tabs). **Leave** returns to **Play online**; the lobby's **Leave** and in-match **Esc** → **Leave** asks to confirm (Yes forfeits; the opponent wins).
7. **Pause** (top bar) freezes the match for both players and shows each hold's countdown; **Resume** continues. Each player has one 30 s budget, cumulative across pauses and disconnects (RULES 3.2.0, protocol v2). A closed, reloaded or dropped tab opens a disconnect hold on the remaining budget (detected within about 8 s); returning before it expires catches up and resumes, otherwise that seat forfeits. Matches with one human and only bots never expire. Manual post-deploy heartbeat check: [docs/PVP_OPS.md](docs/PVP_OPS.md#heartbeat-check-through-the-fly-edge-manual-once-after-first-deploy).

Tokens live in per-tab `sessionStorage`; nicknames are shared through `localStorage`. Minimal play-link startup is included in M1. Lobby controls, watch links, rematch, pause/forfeit and reconnect/catch-up are implemented; production wiring is in the deploy docs. Owner human play-test and approval are still pending; rendering smoothing awaits play-test feedback.

## Deploy / hosting

Static client on Firebase Hosting (project `node-arena-99`): <https://node-arena-99.web.app>. `firebase.json` serves `apps/web/dist` with an SPA rewrite.

- Pushes to `main` run `.github/workflows/deploy.yml` (live deploy).
- Same-repo PRs get a preview channel `pr-<N>` (7-day expiry) via `.github/workflows/preview.yml`; the URL is commented on the PR and the channel is deleted when the PR closes.
- Both need the repo secret `FIREBASE_SERVICE_ACCOUNT` (JSON key of `github-deployer@node-arena-99.iam.gserviceaccount.com`, roles Firebase Hosting Admin + Service Usage Consumer).
- Manual deploy (needs `firebase login`): `pnpm build:prerequisites && pnpm build:web && npx firebase-tools@15.34.1 deploy --only hosting --project node-arena-99`.

PvP production hosting is M2. The owner reports Fly account/app/setup complete, but the Fly dashboard has no deployment yet; secret values have not been verified. Dockerfile, Fly configuration, first server deployment and production web/server wiring remain M2 work.
