# PvP server ops runbook (owner)

Fly.io app `node-arena-server` (region `ewr`, one shared-cpu-1x/256 MB machine). Web stays on Firebase Hosting (`node-arena-99`). Config: `apps/server/fly.toml`, image: `apps/server/Dockerfile`, CI: `.github/workflows/deploy-server.yml` + `.github/workflows/deploy.yml`.

Status (2026-10-29): M1 local human play-test approved. Docker/Fly configuration, deploy workflows and production URL wiring are implemented. The owner reports account/app/setup complete; first Fly deployment, live health/version smoke, production/preview connections and the edge heartbeat check remain unverified. The checklist below is for that first deployment.

The server keeps all rooms in memory: exactly one machine, and every deploy/restart drops live matches (see [Deploy](#deploy)).

## First-deploy checklist

1. Fly app exists with the name in `fly.toml`:
   ```sh
   fly apps list                      # look for node-arena-server
   fly apps create node-arena-server  # if missing
   ```
   If the name is taken: pick another, edit `app = '...'` in `apps/server/fly.toml`, and update the hard-coded URLs `HEALTHZ_URL` in `.github/workflows/deploy-server.yml` and the `wss://node-arena-server.fly.dev` fallback in `.github/workflows/deploy.yml` / `.github/workflows/preview.yml` (or set repo variable `PVP_SERVER_URL`, below; the smoke URL still needs editing).
2. Exactly one machine (state is in-memory; two machines would split rooms):
   ```sh
   fly scale count 1 -a node-arena-server
   ```
3. App-scoped deploy token into the GitHub repo secret `FLY_API_TOKEN`:
   ```sh
   fly tokens create deploy -a node-arena-server
   gh secret set FLY_API_TOKEN            # paste token
   ```
4. Optional repo variable `PVP_SERVER_URL` (not secret), e.g. `wss://node-arena-server.fly.dev`. Unset/empty falls back to that same URL; web builds receive it as `VITE_PVP_SERVER_URL`:
   ```sh
   gh variable set PVP_SERVER_URL --body wss://node-arena-server.fly.dev
   ```
5. First deploy, by hand (Actions -> "Deploy server" -> Run workflow, or):
   ```sh
   gh workflow run deploy-server.yml
   gh run watch
   ```
   The workflow runs `flyctl deploy --remote-only -c apps/server/fly.toml`, then `node scripts/pvp-versions.mjs https://node-arena-server.fly.dev/healthz`, which fails if `/healthz` `versions` differ from this commit's built versions.
6. Verify health ([Health](#health)), then run the [heartbeat check](#heartbeat-check-through-the-fly-edge-manual-once-after-first-deploy).
7. Push to `main` (or run "Deploy") so the web build picks up the server URL; open the site and confirm the PvP menu entry appears.

Secrets are never in `fly.toml`; its `[env]` holds only `ALLOWED_ORIGINS`.

## Deploy

`.github/workflows/deploy.yml` on push to `main`: `changes` -> `server` -> `web`.
- `changes` runs `node scripts/server-changed.mjs <before> <sha>`; `server=true` when server-affecting paths changed (always on manual dispatch).
- `server` calls `deploy-server.yml` (Fly deploy + versions smoke) only when `server=true`.
- `web` runs after `server` succeeded or was skipped. Server failure blocks the web deploy, so a new web never ships against a stale server.

Manual server-only deploy: `gh workflow run deploy-server.yml`, or locally from the repo root: `fly deploy --remote-only -c apps/server/fly.toml`.

`strategy = 'immediate'` on a single machine: total outage is the drain window plus boot (about 5-10 s), and live matches end. `deploy-server.yml` first fetches `/healthz` and emits a `::warning::` when `running > 0` (non-blocking; a fetch failure just skips it). Deploy when nobody is mid-match; there is no resume across restarts.

### Drain on SIGTERM

Fly sends `kill_signal = 'SIGTERM'` (explicit in `fly.toml`); SIGINT behaves the same. The server then drains for `DRAIN_MS` (default 30000, range 0-120000; 0 = legacy immediate close, `room.closed{shutdown}`):
- It keeps listening: `/healthz` stays HTTP 200 with `draining: true`, token reconnects into running matches still work, running matches keep ticking.
- It refuses `room.create`, `room.join` (new members), `lobby.start` and `rematch` with `error{draining}`.
- Every connection gets one `server.draining{deadlineMs}` (remaining ms) at drain start, or right after `welcome` when it connects later.
- Early exit: once no match is in `countdown`/`running` (minimum 3 s so the notice is delivered) the drain ends. Otherwise it ends at the window.
- At the end every room is closed with `room.closed{server-restart}` (running matches abort: no `end`, no result, no forfeit), sockets close with 1001 (2 s grace), then the process exits 0.
- Hard exit (`hardExitMs`): `DRAIN_MS` + 2 s grace + 1 s = 33 s by default (8 s when `DRAIN_MS=0`). `kill_timeout` in `fly.toml` is 40 (hard exit + 5 s margin); a server test fails if it is not above the hard exit. If you raise `DRAIN_MS`, raise `kill_timeout` to `DRAIN_MS/1000 + 8`.

Check before deploying: `curl -fsS https://node-arena-server.fly.dev/healthz | jq '{running, rooms, draining}'`. `running` is matches in progress; deploy when it is 0 to finish in about 3 s.

Players see: a banner "Server restarting - this match will end in 0:24" (lobby: "Server restarting - you can't start a new match."), Create/Join/Start/Rematch disabled, then "Server restarted. Your match ended with no result." with a Back to menu button.

Owner-only, first deploy: confirm Fly honours `kill_timeout = 40` and stops routing new connections to a stopping machine (`fly config show -a node-arena-server`); if not, set `DRAIN_MS=20000` and `kill_timeout = 30`. Record the result here.

### Rollback

```sh
fly releases -a node-arena-server            # find the last good version / image
fly deploy -a node-arena-server --image <image-ref-from-releases>
```
Or revert the commit on `main` (re-triggers the pipeline). Rolling the server back alone makes it older than the deployed web: clients get `version-mismatch` until web is rolled back too. Roll back both together: revert on `main`, or redeploy the old web via Firebase.

## Health

```sh
curl -fsS https://node-arena-server.fly.dev/healthz
```
JSON fields: `ok`, `rooms`, `conns`, `running` (matches in progress), `draining` (true during SIGTERM drain; still HTTP 200), `lateP99Ms` (tick-loop lateness p99; sustained high values mean CPU starvation), `uptimeS`, `versions` (`protocol` plus content/rules/schema/bot versions the handshake compares). Fly also polls `GET /healthz` every 15 s (3 s timeout, 10 s grace).

```sh
fly status -a node-arena-server
fly checks list -a node-arena-server
```

## Logs

```sh
fly logs -a node-arena-server
fly logs -a node-arena-server | grep -E 'server\.(signal|draining|drain_end|shutdown)'
```
Structured lines; verbosity via `LOG_LEVEL` (`debug|info|warn|error`, default `info`).

## Server env vars

Fly `fly.toml [env]` sets `ALLOWED_ORIGINS`; the Dockerfile sets `PORT=8080`, `CONTENT_DIR=/app/content-data/data`. Change others with `fly secrets set` (restarts the machine) or by adding to `[env]` and deploying. Invalid values fail the boot with exit 1 (read `fly logs`).

| Var | Default | Notes |
|---|---|---|
| `PORT` | 8080 | Must match `internal_port` in `fly.toml` |
| `HOST` | 0.0.0.0 | |
| `ALLOWED_ORIGINS` | empty | Comma list; `*` = one DNS label (preview channels `node-arena-99--<channel>-<hash>.web.app`) |
| `ALLOW_NO_ORIGIN` | 0 | `1`/`true` accepts clients with no `Origin` header (CI/docker smoke only; keep off in prod) |
| `INPUT_DELAY` | 3 | Ticks, 1..10 |
| `MAX_ROOMS` | 40 | |
| `MAX_CONNS` | 200 | Past the cap new sockets close with 1013 |
| `CONTENT_DIR` | repo `packages/content/data` | Image sets `/app/content-data/data` |
| `DRAIN_MS` | 30000 | SIGTERM drain window, 0-120000; 0 = immediate close. Keep `kill_timeout` in `fly.toml` above `DRAIN_MS/1000 + 3` (see [Drain on SIGTERM](#drain-on-sigterm)) |
| `LOG_LEVEL` | info | |

## Desync resync

A client that detects a hash mismatch (`desync`), a tick gap or a rejected push sends one `resync`; the server replies like a reconnect attach (`start`, full chunked `catchup`, `pause.state`, stored `end`) without touching the sim or log. Limits: 1 per 10 s per player, plus the 5 s per-player catch-up gap; a refused resync gets `error{rate-limited, 'resync too frequent'}` and the client retries once after 5.5 s, then shows "Leave and rejoin". Max 3 resyncs per match client-side. Spectators resync the same way. Grep logs for `resync` (`outcome` allowed, limited, no-match).

## Close codes

| Code | Meaning |
|---|---|
| 4004 | Heartbeat timeout (no inbound frame or pong for 7 s) |
| 4005 | Per-connection rate limit exceeded |
| 4006 | Backpressure (client not reading fast enough) |
| 1013 | Server full (`MAX_CONNS` or per-IP cap) |
| 1001 | Server shutting down (drain; preceded by `room.closed{server-restart}`) |

## Version skew

The handshake requires exact protocol/schema/content versions and matching rules major/minor; rules patch differences are accepted and bot-version differences are logged without refusing the connection. Web shows "A newer version of Node Arena is available - reload"; if still mismatched after a hard reload, the PvP menu shows "PvP unavailable: this build differs from the server" (single-player is unaffected).
- Normal deploys are server-first, so stale cached tabs see the reload prompt.
- Preview channels talk to the prod server; a PR that bumps versions sees "PvP unavailable" in its preview until merged.
- Persistent mismatch in prod: compare `curl .../healthz` `versions` with the deployed web build; redeploy whichever side is old (`gh workflow run deploy.yml`, which also deploys the server).
- A failed versions smoke in `deploy-server.yml` means Fly runs an image whose versions differ from the commit: check the build logs, redeploy.

## Heartbeat check through the Fly edge (manual, once after first deploy)

Server pings (ws protocol) every 3 s and closes a conn silent for 7 s (4004); detection bound for a silent drop is about 8 s. Web also sends an app-level `ping` every 3 s. Fly's edge may not forward protocol ping/pong, so the app `ping` must alone keep a live tab alive. Not covered by CI (SP07 acceptance 16).

1. Open the prod site in a desktop browser, start a PvP room (against a bot, or two tabs), keep the tab in the foreground for 60 s. Expect no disconnect/pause banner and `fly logs` shows no heartbeat-timeout close (4004) for you.
2. Optional, to isolate the app ping: block protocol pings from the client side, then repeat step 1; the tab must still not drop. (Use a proxy that swallows ws control frames; if you cannot do this, step 1 plus step 3 is sufficient evidence the app ping works.)
3. Kill the client network (DevTools -> Network -> Offline, or disable Wi-Fi) during a match. Expect the other side to see the disconnect hold start within about 8 s (`fly logs` shows the 4004 close).
4. If step 1 drops the tab, or step 3 takes much longer than 8 s, the edge forwards neither ping source as assumed: record the observed timings and adjust `HEARTBEAT_INTERVAL_MS` / `HEARTBEAT_TIMEOUT_MS` (SP07 PRD, section Heartbeat) before play-testing with friends.

## Capacity

Load smoke: N bot-filled rooms against the real server loop. Report-only (exit 0 unless `--strict`).

```sh
pnpm load:smoke                                  # 20 rooms, 45 s, in-process, forced-GC leak check
pnpm load:smoke -- --spectators 3                # K spectators/room at the midpoint (catch-up cost)
pnpm load:smoke -- --churn                       # end/restart a room every 10 s (leak check)
pnpm load:smoke -- --url wss://<app>.fly.dev --rooms 5 --json out.json   # URL mode (real Fly; per-IP limits apply)
```

Reading it: per-2 s table of running rooms, tick lateness p50/p99 (`late`), RSS, CPU % of one vCPU (and per room), frames/s, event-loop p99. Verdicts: p99 lateness < 25 ms, peak RSS < 200 MB, all rooms stayed `running`, no unexpected `room.closed`/`error`. The lateness window is the last 400 clock wakes (~20 s), so the first samples include ramp; judge the final window. Leak signal = `heapUsed` after forced GC vs baseline (RSS rarely shrinks after GC; ignore it for leaks).

Measured 2026-10-30 (4 vCPU box, in-process: harness shares the server process, so RSS/CPU are upper bounds; full table in `docs/agent_files/feat-pvp-20261028-1435/10-load-smoke/load-report-2026-10-30.md`):

| Run (20 rooms, 45 s) | p99 late (final / max) | RSS peak | CPU mean (per room) | Notes |
|---|---|---|---|---|
| default | 3.4 / 123 ms | 205.8 MB | 10.3% (0.53%) | RSS FAIL borderline; running dipped to 13 (harness rematch) |
| `--spectators 3` | 2.1 / 117 ms | 192.1 MB | 13.7% (0.71%) | catch-up p99 2.8 ms, 0.85 KB |
| `--churn` | 2.3 / 112 ms | 200.2 MB | 12.7% (0.66%) | heapUsed after GC ~45 MB, same as other runs: no leak |

Max lateness is ramp (first ~8 s). The "rooms running" FAIL is a harness artifact (Duel S bot matches end ~34 s and rematch), not server rooms closing.

If a run FAILs: lower `MAX_ROOMS` (fly secret/env) and/or move to a bigger VM (`fly scale vm` / `fly scale memory`). Owner: rerun in URL mode against Fly (needs several client IPs or a temporary limit bump for 20 rooms), compare with `/healthz` `lateP99Ms`/`rss`, then decide `MAX_ROOMS` (default 40) and VM size.

## Cost

One `shared-cpu-1x` / 256 MB machine, always on (`auto_stop_machines = 'off'`, `min_machines_running = 1`): a few dollars per month. Check `fly dashboard -a node-arena-server` -> Billing. To pause spend: `fly scale count 0 -a node-arena-server` (PvP offline until `fly scale count 1`).

## Troubleshooting

| Symptom | Check |
|---|---|
| Deploy workflow fails at `flyctl deploy` with auth/app errors | `FLY_API_TOKEN` secret missing/expired or app name mismatch with `fly.toml` |
| Smoke step fails on versions | Image not from this commit; see [Version skew](#version-skew) |
| Smoke step cannot reach `/healthz` | `fly status`, `fly logs`; machine crashed on invalid env (exit 1 with config error); wrong URL after renaming the app |
| Browser WS refused / origin errors | `ALLOWED_ORIGINS` lacks the page origin; edit `fly.toml`, redeploy |
| PvP entry hidden on prod site | Web built without `VITE_PVP_SERVER_URL` (check `PVP_SERVER_URL` var and fallback), or redeploy web |
| Players dropped with 4004 | Heartbeat; see [heartbeat check](#heartbeat-check-through-the-fly-edge-manual-once-after-first-deploy) |
| Players dropped with 4005/4006 | Rate limit / slow client; look at `fly logs` |
| New connections closed 1013 | `MAX_CONNS` / per-IP cap hit; check `conns` in `/healthz` |
| Matches lag | `lateP99Ms` in `/healthz`; upsize VM in `fly.toml` `[[vm]]` |
| Matches vanish after a deploy | Expected: a deploy drains up to 30 s, then aborts live matches (`room.closed` server-restart) |
