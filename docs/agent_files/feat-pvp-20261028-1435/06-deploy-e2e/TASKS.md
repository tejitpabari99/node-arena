---
status: draft
summary: Tasks for PvP dev script, 2-browser e2e harness and CI job (M1), then Fly deploy workflow/ordering, Docker check, origins, extra e2e specs, docs and owner runbook (M2)
date: 2026-10-28
---
# Tasks: Deploy, CI and E2E for PvP
Source of truth: docs/agent_files/feat-pvp-20261028-1435/06-deploy-e2e/PRD.md. M1 = local one-command dev + 2-browser e2e + CI steps + doc stubs; M2 = Fly deploy chain, Docker job, origins, more specs, full docs, runbook. SP05 deps use real task numbers (SP05#10 test hooks/testids, SP05#3+#15 mismatch UX, SP05#14 watch, SP05#15 rematch).

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | [M1] `dev:pvp` script + server URL env wiring | SP04#1, SP04#7 | done |
| 2 | [M1] PvP e2e harness (config, build:test:pvp, script) | 1, SP05#10 | in-progress |
| 3 | [M1] Scripted-attack helper + Duel S 1v1 spec | 2, SP03#2, SP04#8 | todo |
| 4 | [M1] CI: ci.sh checklist + `pvp-e2e` job | 3, SP02#1, SP04#1 | todo |
| 5 | [M1] Doc stubs + M1 play-test runbook | 1, 4 | todo |
| 6 | [M2] `deploy-server.yml` (Fly deploy + versions smoke) | SP04#17 | todo |
| 7 | [M2] `deploy.yml` ordering: changes -> server -> web | 6 | todo |
| 8 | [M2] `VITE_PVP_SERVER_URL` in deploy + preview builds | 7 | todo |
| 9 | [M2] `ALLOWED_ORIGINS` in fly.toml | SP04#17 | todo |
| 10 | [M2] `docker` CI job | SP04#17, 4 | todo |
| 11 | [M2] Version-mismatch UX verification | 8, SP05#3, SP05#15 | todo |
| 12 | [M2] e2e specs: spectator + rematch | 3, SP04#13, SP04#14, SP05#14, SP05#15 | todo |
| 13 | [M2] e2e specs: bot-seat lobby + 2v2 Cross | 3, SP04#12, SP03#7 | todo |
| 14 | [M2] Full docs pass | 5, 9, 12, 13 | todo |
| 15 | [M2] `docs/PVP_OPS.md` owner runbook | 7, 8, 9 | todo |

## Task 1 — [M1] `dev:pvp` script + server URL env wiring
What it is / what it means: R1/R2/D1. One command runs server and web together; plain `dev` stays web-only.
What changes at a high level: root `package.json` gets `dev:pvp` running web `vite` and server dev (tsx watch) in parallel. Server dev defaults: `PORT=8080`, localhost/127.0.0.1 origins allowed on 5173 (inline default, no `.env`). Verify web falls back to `ws://127.0.0.1:8080` in DEV (SP05 owns code; this task only confirms the wiring). Document that `build:prerequisites` includes net.
Done when: after `build:prerequisites`, `pnpm dev:pvp` serves web on 5173 and server `/healthz` 200 on 8080; `pnpm dev` unchanged.

## Task 2 — [M1] PvP e2e harness
What it is / what it means: R5/D7. Separate Playwright suite so existing `test:web:all` stays untouched.
What changes at a high level: `apps/web/playwright.pvp.config.ts` with two `webServer`s: built server (`PORT=8081`, `ALLOWED_ORIGINS=http://127.0.0.1:4173`, `LOG_LEVEL=warn`, `/healthz` readiness) and `vite preview` of a `dist-test` built by new `build:test:pvp` (`VITE_TEST_HOOKS=1`, server URL `ws://127.0.0.1:8081`). Root `test:pvp:e2e` script. Specs live in `e2e-pvp/`; the existing e2e config must not pick them up. Smoke spec: two contexts reach lobby and see the same `lobby-code`.
Done when: `pnpm test:pvp:e2e` boots both servers and smoke spec passes; `pnpm test:web:all` unaffected.

## Task 3 — [M1] Scripted-attack helper + Duel S 1v1 spec
What it is / what it means: R5/D8. Deterministic fast finish through the real input path, no lobby time-limit override.
What changes at a high level: helper that is a pure function of `__na.view`: greedy nearest enemy/neutral target from player 0's start building, issues DrawLine via `__na.submit`, re-run every 2 s; player 1 idle. Spec: two `newContext()`s, create, pick Duel S, join via `?room=`, ready, start, run script, assert both pages reach `pvp-result` with winner seat 0 and equal final hash, timeout 150 s. Record measured duration; if > ~90 s, add test-only tiny fixture map loaded only via the e2e server's test content option (not in `pvp.json`).
Done when: spec passes locally, duration recorded in the spec comment/task notes, fixture decision made.

## Task 4 — [M1] CI: ci.sh checklist + `pvp-e2e` job
What it is / what it means: R4/R5. Verify, not duplicate, 02/04 edits to root filters.
What changes at a high level: confirm `scripts/ci.sh` and root `build`/`test` filters include `build:net`, `build:server`, typecheck/test for net and server; add whatever is missing (rebase on 02/04 edits). Add `pvp-e2e` job to `ci.yml`: install, `build:prerequisites` (+net, server), Chromium, `pnpm test:pvp:e2e`. Existing `playwright` job unchanged.
Done when: `pnpm run ci` runs net/server build, typecheck, tests; `pvp-e2e` job green on the branch.

## Task 5 — [M1] Doc stubs + M1 play-test runbook
What it is / what it means: R3/R13 (stubs). `check:docs` fails on undocumented root scripts and nonexistent inline paths.
What changes at a high level: `tools/README.md` inventory rows for `dev:pvp`, `test:pvp:e2e`, plus 02/04 scripts (`dev:server`, `test:net`, `test:server`). README "Play online (PvP)" stub with the R3 two-tab steps (create, Duel S, open `?room=` link in new tab, ready, play; per-tab sessionStorage tokens). Only inline-code paths that exist.
Done when: `pnpm check:docs` passes; owner can follow README steps verbatim.

## Task 6 — [M2] `deploy-server.yml`
What it is / what it means: R6/D2/D10. Reusable Fly deploy with version smoke.
What changes at a high level: `workflow_call` + `workflow_dispatch`; `permissions: contents: read`; concurrency group `deploy-server`, no cancel; setup-flyctl pinned by commit SHA (release >= 2 weeks old, resolved at implementation); `flyctl deploy --remote-only -c apps/server/fly.toml`; `FLY_API_TOKEN` from secrets. Smoke: curl `/healthz` and compare `versions` with values computed by a Node one-liner from `@node-arena/net` version constants + content version (not hard-coded).
Done when: workflow lints (actionlint if available); dispatch run deploys and smoke passes once owner secret exists; wrong token fails the job.

## Task 7 — [M2] `deploy.yml` ordering
What it is / what it means: R7/D3. Server-first ordering so web never outruns server.
What changes at a high level: add `changes` job (git diff `before..sha`; server=true on `apps/server/**`, `packages/{net,sim,content,bots,defs}/**`, `pnpm-lock.yaml`, `deploy-server.yml`), `server` job calling the reusable workflow when changed or dispatched, and `web` needing both with `!cancelled() && server.result in (success, skipped)`. Handle first-push/missing `before` safely.
Done when: web-only push skips `server`; `packages/sim/**` push runs server then web; server failure blocks web (verify in Actions graph).

## Task 8 — [M2] `VITE_PVP_SERVER_URL` in deploy + preview builds
What it is / what it means: R9/D5/D4. Prod and previews both target the prod server.
What changes at a high level: build steps in `deploy.yml` and `preview.yml` get `VITE_PVP_SERVER_URL=${{ vars.PVP_SERVER_URL }}` with hard fallback `wss://node-arena-server.fly.dev`. No other preview changes.
Done when: built artifacts contain the URL; empty variable falls back.

## Task 9 — [M2] `ALLOWED_ORIGINS` in fly.toml
What it is / what it means: R10/D6. One `[env]` line, versioned.
What changes at a high level: add `ALLOWED_ORIGINS` with `https://node-arena-99.web.app`, `https://node-arena-99.firebaseapp.com`, `https://node-arena-99--*.web.app` to `apps/server/fly.toml`. Confirm `firebase.json` still has no CSP; note requirement if added.
Done when: server config parser (SP04) accepts the value incl. wildcard; disallowed origin test from SP04 still passes.

## Task 10 — [M2] `docker` CI job
What it is / what it means: R8/D9. Catches Dockerfile rot (incl. 04's `pnpm deploy` caveat) per PR.
What changes at a high level: `ci.yml` job: `docker build -f apps/server/Dockerfile .`, run with `ALLOW_NO_ORIGIN=1`, poll `/healthz` for 200 with timeout, dump logs on failure, always stop container.
Done when: job green; deliberately broken Dockerfile fails it.

## Task 11 — [M2] Version-mismatch UX verification
What it is / what it means: R11. SP05 implements strings; 06 verifies the contract end to end.
What changes at a high level: check reload prompt text and hard-reload button on `error{version-mismatch}`, then "PvP unavailable: this build differs from the server" with Create/Join disabled after reload; single-player unaffected. Add an e2e spec if a test-only server version override is cheap in the e2e server; otherwise record as manual check (force a bumped server version).
Done when: behavior confirmed per PRD acceptance; result recorded.

## Task 12 — [M2] e2e specs: spectator + rematch
What it is / what it means: R12. Reuse the scripted-attack helper.
What changes at a high level: spectator context joins mid-match via `?room=X&watch`, reaches `pvp-result` with same outcome. Rematch spec: after result, `pvp-rematch` from players returns to a new match in the same room.
Done when: both specs pass in `pvp-e2e` job.

## Task 13 — [M2] e2e specs: bot-seat lobby + 2v2 Cross
What it is / what it means: R12 and Risks. Bounded, non-flaky.
What changes at a high level: bot lobby: host sets seat 1 to bot(easy), starts alone, asserts only that match ends and result shows; tag `@slow`, job `timeout-minutes: 20` (fall back to start + N ticks + hash equality if > 3 min). 2v2 on Cross: 2 humans + 2 bots, assert start, 10 s of hash-equal ticks, then leave.
Done when: both pass in CI within timeouts.

## Task 14 — [M2] Full docs pass
What it is / what it means: R13. Accurate docs, stale lines gone.
What changes at a high level: README Contents (+`apps/server/`, `packages/net/`), full "Play online (PvP)" (host, join link, `&watch`, prod URL), Deploy section server paragraph (Fly app, ordering, `PVP_SERVER_URL`, `FLY_API_TOKEN`), drop "Multiplayer ... deferred". `AGENTS.md` project list + scripts. `docs/FUTURES.md`: remove hosting-deferred line, replace PvP line with the follow-ups list. `apps/server/README.md`: env table, run, test, Docker, protocol pointer, health endpoint.
Done when: `pnpm check:docs` green; no stale hosting/multiplayer-deferred text.

## Task 15 — [M2] `docs/PVP_OPS.md` owner runbook
What it is / what it means: R14. Owner-facing; covers the Manual steps.
What changes at a high level: Fly account/app creation, `fly scale count 1`, app-scoped deploy token -> `FLY_API_TOKEN`, `PVP_SERVER_URL` variable, first deploy via dispatch, healthz check, rollback, logs, cost, name-taken fallback. Link from README.
Done when: steps are copy-pasteable and `check:docs` passes.

## Manual steps (owner)
1. Fly account + billing; `fly auth login`.
2. `fly apps create node-arena-server --org personal`; `fly scale count 1 -a node-arena-server` (if name taken, tell agents to change `fly.toml` + `PVP_SERVER_URL`).
3. `fly tokens create deploy -a node-arena-server` -> repo secret `FLY_API_TOKEN`.
4. Repo variable `PVP_SERVER_URL=wss://node-arena-server.fly.dev`.
5. First deploy via Actions "Run workflow" on `deploy-server.yml`; curl `/healthz`.
6. M1 two-tab play-test, later prod play-test with a friend.
