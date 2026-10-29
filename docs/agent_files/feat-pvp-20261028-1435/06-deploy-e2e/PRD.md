---
status: draft
summary: One-command local PvP dev, Fly.io server deploy from CI ordered before web deploy, VITE_PVP_SERVER_URL wiring for prod/previews, 2-browser Playwright e2e, docs and owner runbook
date: 2026-10-28
---
# PRD: Deploy, CI and E2E for PvP
Repo/branch: node-arena / feat/pvp · Depends on: 04-game-server (image, fly.toml, env, `/healthz`), 05-web-netplay (screens, test ids, server URL var), 02 (version handshake) · Owns: `.github/workflows/{deploy-server.yml,deploy.yml,preview.yml,ci.yml}` edits, `scripts/ci.sh` PvP steps, root `package.json` (`dev:pvp`, `test:pvp:e2e`), `apps/web/{playwright.pvp.config.ts,e2e-pvp/**}`, `apps/server/README.md`, `docs/PVP_OPS.md` (owner runbook), README / `tools/README.md` / `docs/FUTURES.md` / `AGENTS.md` doc edits, one `[env] ALLOWED_ORIGINS` line in `apps/server/fly.toml`

## TL;DR
`pnpm dev:pvp` starts server + web; M1 play-test = two tabs on `?room=`. CI gains net/server steps, a Docker build+boot check and a 2-browser Playwright job. `deploy.yml` becomes `changes -> server (reusable deploy-server.yml) -> web`, so a new web never talks to an older server. Previews use the prod server; PvP self-disables in the preview when the handshake says versions differ. Docs updated, owner runbook for Fly.

## Problem
Nothing runs, ships or verifies PvP end to end. Web (Firebase) and server (Fly) deploy independently, but the handshake refuses on any protocol/rules/schema/content mismatch [verified: SP02 PRD "Versioning / handshake"], so deploy order and user messaging matter. Existing workflows know nothing of a server, wss URL or origins.

## Goals / Non-Goals
Goals: local one-command dev; automated Fly deploy; no window where fresh web + stale server; gated Docker + 2-client e2e; accurate docs.
Non-goals: server/client code (04/05), per-PR Fly apps, staging env, Firebase Auth, load test tooling (04 M3), monitoring beyond Fly checks.

## Requirements
| ID | Requirement | MS |
|---|---|---|
| R1 | `pnpm dev:pvp` runs server (tsx watch, `PORT=8080`, `ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173`) and web `vite` in parallel; plain `pnpm dev` unchanged (web only, per "don't change what wasn't asked"). Prerequisite builds documented (`pnpm build:prerequisites` incl. net). | M1 |
| R2 | Web resolves server URL: `import.meta.env.VITE_PVP_SERVER_URL`, else in `DEV` `ws://127.0.0.1:8080`, else PvP menu entry hidden (SP05 owns the code; 06 owns the env wiring). | M1 |
| R3 | M1 owner play-test runbook in README: `pnpm dev:pvp`; tab A: PvP -> Create -> pick Duel S; tab B (same profile is fine: tokens are per-tab `sessionStorage`): open the shown `?room=XXXX` link in a new tab; ready; play. | M1 |
| R4 | `scripts/ci.sh` steps added: `build:net`, `build:server`, `typecheck:net/server`, `test:net`, `test:server`; root `test`/`build` filters include them (owned by 02/04, verified here as a checklist item). `pnpm lint` already global. | M1 |
| R5 | `pvp-e2e` job in `ci.yml` and `pnpm test:pvp:e2e` locally: 1v1 on Duel S, two browser contexts, ends on result screen for both, hashes equal. | M1 |
| R6 | `deploy-server.yml` (`workflow_call` + `workflow_dispatch`): `flyctl deploy --remote-only -c apps/server/fly.toml` from repo root, then smoke `curl -fsS https://node-arena-server.fly.dev/healthz` and assert `versions` equals the commit's expected versions. | M2 |
| R7 | `deploy.yml` ordering: job `changes` (git diff of `before..sha` vs server-affecting paths), job `server` (calls R6 when changed or on dispatch), job `web` runs after `server` succeeded **or was skipped**; server failure blocks web deploy. | M2 |
| R8 | `docker` CI job: `docker build -f apps/server/Dockerfile .`, run it with `ALLOW_NO_ORIGIN=1`, poll `/healthz` 200. | M2 |
| R9 | Web builds in `deploy.yml`/`preview.yml` get `VITE_PVP_SERVER_URL=${{ vars.PVP_SERVER_URL }}` (repo variable, not secret; falls back to `wss://node-arena-server.fly.dev`). | M2 |
| R10 | Server `ALLOWED_ORIGINS` in `fly.toml [env]` (versioned, not secret): `https://node-arena-99.web.app,https://node-arena-99.firebaseapp.com,https://node-arena-99--*.web.app`. `firebase.json` has no CSP header, so no `connect-src` change; if one is ever added it must allow the wss host. | M2 |
| R11 | Version-mismatch UX contract (05 implements strings): on `error{version-mismatch}` web shows "A newer version of Node Arena is available - reload"; Reload button does a hard reload. If the page is **still mismatched after a reload** (preview or cache), the PvP menu shows "PvP unavailable: this build differs from the server" and disables Create/Join; single-player unaffected. | M2 |
| R12 | e2e M2 specs: spectator (`&watch`) sees the match and reaches the result; 1 human + 1 bot seat lobby; 2v2 on Cross with 2 humans + 2 bots; rematch. | M2 |
| R13 | Docs (see Architecture "Docs"); `pnpm check:docs` passes. | M1 (stubs) / M2 (full) |
| R14 | `docs/PVP_OPS.md` owner runbook: Fly setup, secrets, deploy, rollback, logs, cost. | M2 |

## Architecture
**Local dev.** `dev:pvp` = `pnpm --parallel --filter @node-arena/web --filter @node-arena/server dev` [assumes both packages expose a `dev` script; SP04 R1 defines `pnpm dev:server` at root, SP04 server `dev` = tsx watch]. Server env set in the server's `dev` script or a `.env`-free inline default (`NODE_ENV!=production` -> allow `127.0.0.1`/`localhost` origins on any port). Browser opens `127.0.0.1:5173`; web falls back to `ws://127.0.0.1:8080`. Tokens are per-tab `sessionStorage` (SP05), so two tabs in one profile are two distinct players; a reload in the same tab reconnects as the same player.

**Workflows.**
```
push main -> deploy.yml
  changes  (git diff $before..$sha; server=true if paths match
            apps/server/** packages/{net,sim,content,bots,defs}/** pnpm-lock.yaml
            .github/workflows/deploy-server.yml)
  server   needs changes; if server=true||dispatch -> uses ./.github/workflows/deploy-server.yml
  web      needs [changes, server]; if !cancelled() && server.result in (success, skipped)
```
Content/rules/sim changes touch both sides, so they redeploy server (flyctl, ~1-2 min) before the Firebase deploy; web-only changes (apps/web/**) skip the server. Order is server-first because the server then refuses stale cached clients with a clear "reload" message, whereas web-first would hand fresh clients a server that refuses *them*. Fly `strategy=immediate` on a single machine means a few seconds of dropped rooms per deploy [verified: SP04 fly.toml]; deploy-time room loss is accepted for friends-only scale (M3: SIGTERM drain notice, 04 R18).
- `deploy-server.yml`: `superfly/flyctl-actions/setup-flyctl` pinned by commit SHA to a release >= 2 weeks old (same SHA-pin style as existing workflows; resolve SHA at implementation), `permissions: contents: read`, `concurrency: group: deploy-server, cancel-in-progress: false`, `env FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}`, deploy token should be an app-scoped deploy token (`fly tokens create deploy -a node-arena-server`). Expected versions in the smoke check come from a tiny Node one-liner reading the same constants the server exposes (`@node-arena/net` version.ts + `content.json`), not hard-coded.
- `preview.yml`: only adds `VITE_PVP_SERVER_URL` env on the build step. Previews hit the **prod** server. A PR that bumps protocol/rules/content therefore sees the R11 "unavailable" state in its preview until merged; PR author tests PvP locally with `dev:pvp` and the e2e job (which runs the PR's own server code). Per-PR Fly apps rejected (cost, secrets, teardown) [DEFERRED].
- `ci.yml`: `pvp-e2e` job: install, `build:prerequisites` (+net, server), Chromium, `pnpm test:pvp:e2e`; `docker` job per R8. The existing `playwright` job (`test:web:all`) stays unchanged and does not pick up PvP specs (they live in `e2e-pvp/`, separate `playwright.pvp.config.ts`, mirrors how `playwright.campaign.config.ts` isolates its suite [verified: apps/web/playwright.campaign.config.ts]).

**E2E harness.** `playwright.pvp.config.ts` has two `webServer` entries: (1) built server (`node apps/server/dist/main.js`, `PORT=8081`, `ALLOWED_ORIGINS=http://127.0.0.1:4173`, `LOG_LEVEL=warn`, `/healthz` readiness), (2) `vite preview` of `dist-test` built with `VITE_TEST_HOOKS=1 VITE_PVP_SERVER_URL=ws://127.0.0.1:8081` (new script `build:test:pvp`, since the existing `build:test` has no server URL) [verified: apps/web/package.json build:test]. Test creates `browser.newContext()` twice (separate storage = distinct tokens).

SP05 names (reconciled with SP05 PRD, exact): `data-testid`s `pvp-nick`, `pvp-create`, `pvp-code-input`, `pvp-join`, `pvp-watch`, `lobby-code`, `lobby-seat-<i>`, `lobby-map-<levelId>`, `lobby-ready`, `lobby-start`, `pvp-result`, `pvp-rematch`, `conn-state`; `window.__na` (test hooks, only with `VITE_TEST_HOOKS`) exposes `screen`, `view` and `submit(cmd)` in netplay mode so a spec can issue DrawLine through the real input path to the NetDriver; room code readable from `lobby-code`.

**Deterministic fast path (decision).** No lobby time-limit override (time limit is per map, locked; a hidden override would diverge client/server setup). The spec plays a *scripted attack* on Duel S: player 0 repeatedly draws lines from its start building to the nearest enemy-owned/neutral buildings (positions read from `__na.view`), player 1 stays idle. Duel S is the smallest map and an idle opponent is eliminated in well under the 8 min limit; spec timeout 150 s, assertion `outcome.kind === 'win'` winner seat 0 on both pages, and equal final hash across pages. The script is a pure function of `view` (greedy nearest target), re-run every 2 s, so it is not timing-fragile. If measured duration at M1 exceeds ~90 s, add a test-only tiny e2e fixture map (not shipped in `pvp.json`, loaded only by the e2e server via the test content option); still no lobby time-limit override.
M2 specs reuse the helper: spectator context joins mid-match via `?room=X&watch`, asserts `pvp-result` with the same outcome; bot-seat lobby: host sets seat 1 to bot(easy), starts alone, expects a result (idle host -> bot wins or timeout; spec asserts only "match ends and result screen shows", bounded by 8 min -> mark `@slow`, run only in the `pvp-e2e` job with `timeout-minutes: 20`) - see Risks; 2v2: 2 humans + 2 bots on Cross, asserts start, 10 s of hash-equal ticks, then leaves (no full playout).

**Docs.**
- README: Contents adds `apps/server/`, `packages/net/`; new "Play online (PvP)" section (how to host: `pnpm dev:pvp`; how friends join: link `?room=XXXX`, spectate `&watch`; production URL); "Deploy / hosting" gains the server paragraph (Fly app, `deploy.yml` ordering, `PVP_SERVER_URL` var, `FLY_API_TOKEN`); drop "Multiplayer ... remain deferred" phrase.
- `tools/README.md`: command inventory rows for `dev:pvp`, `test:pvp:e2e`, plus 02/04's `dev:server`, `test:net`, `test:server` (check:docs fails on any undocumented root script [verified: tools/src/docs-check.ts]); only inline-code paths that exist (check:docs path scan covers README.md, tools/README.md, CONTENT_GUIDE, LEVELS_GUIDE, CREDITS [verified]); `docs/agent_files` is exempt from the scan.
- `AGENTS.md` Project list: add `apps/server`, `packages/net` and the new scripts.
- `docs/FUTURES.md`: delete "Hosting/deploy. Deployment setup remains deferred." and replace "PvP/multiplayer" line with "PvP follow-ups: matchmaking/ranked, accounts + Firebase Auth (`hello.auth` slot exists), in-match chat, mobile/portrait, server-side replay storage/sharing, fog of war, per-PR Fly staging, multi-machine/region, cosmetics".
- `apps/server/README.md`: env table, run, test, Docker, protocol pointer, health endpoint.
- `docs/PVP_OPS.md`: runbook (owner-facing; see Manual steps).

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| D1 | Local one-command | New `dev:pvp`; `dev` untouched | Change `dev` to run both | Existing flow/docs stay; single-player dev doesn't need Node server [RESOLVED: agent recommendation] |
| D2 | Server deploy trigger | Reusable `deploy-server.yml` called from `deploy.yml`, plus manual dispatch | Separate path-triggered workflow | Cross-workflow ordering is impossible in Actions; one graph guarantees server-before-web [RESOLVED: agent recommendation] |
| D3 | Deploy order | Server first, then web | Web first; parallel | Stale cached clients get explicit "reload" instead of fresh clients stuck on old server [RESOLVED] |
| D4 | Preview servers | Previews use prod server; PvP disabled on mismatch | Per-PR Fly app; shared staging app | $0, no teardown logic; mismatch handled by handshake anyway; PR tests PvP via local/e2e [RESOLVED] |
| D5 | Server URL config | Repo variable `PVP_SERVER_URL` -> `VITE_PVP_SERVER_URL`, hard fallback in workflows | Secret; hard-code only | URL is public; variable allows later domain swap w/o commit [RESOLVED] |
| D6 | Origins config | In `fly.toml [env]` | `fly secrets` | Not secret; reviewed in PRs; wildcard covers previews [RESOLVED] |
| D7 | PvP e2e location | `e2e-pvp/` + own config + own CI job | Add to `e2e/` suite | `test:web:all` runs the suite twice (prod+dev) and has no server; keeps existing job untouched [RESOLVED] |
| D8 | Fast e2e finish | Scripted attack vs idle opponent on Duel S; test-only tiny fixture map if > ~90 s at M1 | Env time-limit override; forfeit message | No content/protocol pollution; uses real input path [RESOLVED] |
| D9 | Docker check | Build+boot in CI on every PR | Only on main/deploy | Catches Dockerfile rot before merge; ~2 min [RESOLVED] |
| D10 | Fly token | App-scoped deploy token in `FLY_API_TOKEN` | Org token | Least privilege |

## Manual steps
Owner status (2026-10-29): Fly account/app/setup tasks are owner-reported complete, including deploy-token/repository configuration. Secret values have not been inspected or verified. The owner reports no deployment in the Fly dashboard yet.

Pending:
1. M2 implementation: Dockerfile, Fly configuration, deploy workflow and production web/server wiring.
2. First server deployment and `/healthz` verification after M2 wiring exists.
3. Owner M1 two-tab Duel S play-test per the root README; still pending, not approved. Use a genuinely fresh second tab: duplicated/opener tabs may copy sessionStorage tokens. Saved nickname autojoins; new visitors enter a nickname then Join. Minimal play-link startup is M1; full lobby/watch remain M2.
4. Later production play-test with a friend and final approval. Rendering smoothing awaits owner play-test feedback.

Full operations runbook remains M2. Agent-doable implementation proceeds within the relevant milestone.

## Risks / Open Questions
- R-token: [RESOLVED: orchestrator - SP05 stores the token in per-tab `sessionStorage` (nick in localStorage), so two tabs in one profile act as two players; no separate profile needed for the M1 play-test]
- [RESOLVED: orchestrator - e2e duration: measure at M1; if the scripted Duel S attack exceeds ~90 s, add a test-only tiny e2e fixture map (not shipped in `pvp.json`); no lobby time-limit override]
- Bot-seat e2e depends on bot behavior/duration; M2 uses start + N ticks + hash equality, not full playout, if > 3 min. [RESOLVED: agent recommendation]
- Deploy drops live rooms for seconds. [DEFERRED: M3 SIGTERM drain with `room.closed{reason:'server-restart'}` -> web shows "server updating, reconnecting"]
- `superfly/flyctl-actions` SHA and flyctl version unresolved until implementation (must be >= 2 weeks old per repo policy). [RESOLVED: pin at implementation]
- Docker `pnpm deploy --legacy` caveat is 04's [to verify at impl]; `docker` job will surface it.
- Fly cost/billing and domain choice are owner-only.
- Root `package.json` filter edits are shared with 02/04; whoever lands first edits, others rebase. [RESOLVED: 06 verifies in R4 checklist]

## Acceptance Criteria
- M1: `pnpm dev:pvp` from a fresh clone (after `build:prerequisites`) serves web on 5173 and server `/healthz` 200 on 8080; two browser profiles complete a Duel S 1v1 per R3.
- M1: `pnpm test:pvp:e2e` passes locally and in CI job `pvp-e2e`: both pages reach `pvp-result` with the same winner and final hash, < 150 s.
- M1: `pnpm run ci` includes net/server build, typecheck, tests; `pnpm check:docs` passes with the new scripts documented.
- M2: `deploy-server.yml` dispatch deploys; smoke asserts `/healthz` versions match the commit; wrong `FLY_API_TOKEN` fails the job and `web` does not deploy on main.
- M2: main push touching only `apps/web/**` skips `server` job and deploys web; push touching `packages/sim/**` deploys server first, web second [check in Actions graph].
- M2: production page connects via wss (origin `node-arena-99.web.app`) and a preview-channel page connects (wildcard origin); disallowed origin refused.
- M2: mismatched build shows reload prompt, then "PvP unavailable" after reload; single-player still works (manual check by forcing a bumped server version).
- M2: `docker` job green; e2e spectator/bot/2v2/rematch specs green.
- M2: README, tools/README, AGENTS, FUTURES (stale hosting line gone), apps/server/README, PVP_OPS.md updated; `check:docs` green.
