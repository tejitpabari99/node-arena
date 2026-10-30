# PvP game server

Authoritative Node + ws server (`@node-arena/server`): rooms, lobby seats/teams/bots, spectators, deterministic tick broadcast, results/rematch and pause/disconnect catch-up. State lives in memory; use one process/machine. Restarts discard rooms.

## Run and test

From the repository root, with Node >=22.13 and pnpm 10.34.6:

```sh
pnpm install --frozen-lockfile
pnpm build:prerequisites
pnpm dev:pvp
```

The launcher sets server port 8080 and allows the web origin on 5173. Web: <http://127.0.0.1:5173>. Existing `PORT` and `ALLOWED_ORIGINS` values override those defaults. See the [play instructions](../../README.md#play-online-pvp).

For server-only watch mode, set `ALLOWED_ORIGINS` to the web origins you want to allow, then run `pnpm dev:server`. Unlike the combined launcher, server-only mode defaults to an empty origin allowlist. To run the built server:

```sh
pnpm build:server
node apps/server/dist/main.js
```

```sh
pnpm test:server
pnpm typecheck:server
pnpm test:net
pnpm test:pvp:e2e
```

The last command builds server/test web and runs the isolated Chromium PvP suite; install Chromium with `pnpm --filter @node-arena/web exec playwright install --with-deps chromium` first. It uses server port 8081 and web port 4173. Root `pnpm run ci` includes net/server build, typecheck and tests; Actions also has separate PvP browser and Docker jobs.

## Environment

Defaults below are for direct server startup. Invalid values fail boot with exit 1. The combined launcher supplies local port/origin defaults; the image supplies the packaged content directory.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Listen port, 0–65535; Fly expects 8080 |
| `HOST` | `0.0.0.0` | Listen address |
| `ALLOWED_ORIGINS` | empty | Comma-separated HTTP(S) origins; `*` matches one DNS label; unmatched origins are refused |
| `ALLOW_NO_ORIGIN` | `0` | `1`/`true` permits missing Origin; CI/CLI clients only; keep off in production |
| `INPUT_DELAY` | `3` | Scheduled input delay, 1–10 ticks |
| `MAX_ROOMS` | `40` | Room cap, 1–100000 |
| `MAX_CONNS` | `200` | Connection cap, 1–100000; excess sockets close with 1013 |
| `CONTENT_DIR` | repository `packages/content/data` | Content JSON tree; image sets `/app/content-data/data` and includes adjacent metadata |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error`; structured logs |

## Health and protocol

```sh
curl -fsS http://127.0.0.1:8080/healthz
```

`GET /healthz` returns 200 JSON with `ok`, room/connection/running-match counts, `draining` (true after SIGTERM; stays 200), `lateP99Ms`, `uptimeS` and `versions` (protocol, rules, schema, content, bot). Responses use `Cache-Control: no-store`. Other HTTP paths return 404; the same listener accepts WebSocket connections.

Protocol authority: [message types](../../packages/net/src/messages.ts), [validation](../../packages/net/src/validate.ts), [handshake](../../packages/net/src/handshake.ts) and [protocol version](../../packages/net/src/version.ts). The hello handshake requires exact protocol/schema/content versions and matching rules major/minor before room actions. Rules patch differences are accepted; bot-version differences are logged without refusing the connection. See [game rules](../../docs/GAME_RULES.md) for mechanics and version policy.

## Docker and Fly

Build context is the repository root:

```sh
docker build -f apps/server/Dockerfile -t node-arena-server:local .
docker run --rm -p 8080:8080 -e ALLOWED_ORIGINS=http://127.0.0.1:5173 node-arena-server:local
```

The image builds workspace dependencies and packages production dependencies/content; runtime is a non-root Node process with a 192 MB JS heap cap. `SIGTERM` drains connections within 6 s, with an 8 s hard-exit deadline; Fly allows 10 s.

Fly app `node-arena-server` uses one shared-cpu-1x/256 MB machine in `ewr`. Production deploy order is changes → server (Fly plus version smoke) → web (Firebase). Repo secret `FLY_API_TOKEN` authorizes Fly; repo variable `PVP_SERVER_URL` supplies the public WebSocket URL to web builds. First Fly deployment and live checks remain pending. See the [operations runbook](../../docs/PVP_OPS.md) for setup, origin configuration, deploy/rollback, health, logs, heartbeat verification and cost.
