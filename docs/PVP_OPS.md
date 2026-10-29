# PvP server ops runbook (owner)

Fly.io app `node-arena-server` (region `ewr`, one shared-cpu-1x/256 MB machine). Web stays on Firebase Hosting (`node-arena-99`). Config: `apps/server/fly.toml`, image: `apps/server/Dockerfile`, CI: `.github/workflows/deploy-server.yml` + `.github/workflows/deploy.yml`.

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

`strategy = 'immediate'` on a single machine: a few seconds of downtime, and live matches end. On `SIGTERM` the server drains: stops accepting, sends `room.closed{shutdown}` to all rooms, closes sockets with 1001 within a 6 s grace, then hard-exits at 8 s (`kill_timeout = 10` in `fly.toml` must stay above 8). Deploy when nobody is mid-match; there is no resume across restarts.

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
JSON fields: `ok`, `rooms`, `conns`, `running` (matches in progress), `lateP99Ms` (tick-loop lateness p99; sustained high values mean CPU starvation), `uptimeS`, `versions` (`protocol` plus content/rules/schema/bot versions the handshake compares). Fly also polls `GET /healthz` every 15 s (3 s timeout, 10 s grace).

```sh
fly status -a node-arena-server
fly checks list -a node-arena-server
```

## Logs

```sh
fly logs -a node-arena-server
fly logs -a node-arena-server | grep server.shutdown
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
| `LOG_LEVEL` | info | |

## Close codes

| Code | Meaning |
|---|---|
| 4004 | Heartbeat timeout (no inbound frame or pong for 7 s) |
| 4005 | Per-connection rate limit exceeded |
| 4006 | Backpressure (client not reading fast enough) |
| 1013 | Server full (`MAX_CONNS` or per-IP cap) |
| 1001 | Server shutting down (drain) |

## Version skew

The handshake refuses on any protocol/rules/schema/content mismatch. Web shows "A newer version of Node Arena is available - reload"; if still mismatched after a hard reload, the PvP menu shows "PvP unavailable: this build differs from the server" (single-player is unaffected).
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
| Matches vanish after a deploy | Expected: restart drains rooms (`room.closed` shutdown) |
