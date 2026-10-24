# Hosted Kane stream

Node Arena operator runbook. Run from the repository root with Node
>=22.13, pnpm 10.34.6 and the existing Chromium setup. The service exposes a viewer,
JPEG frames over WebSocket and allowlist-filtered driver events over SSE. The test
build, CDP and raw logs stay private. Never proxy the preview server or CDP.
The stream exposes only the viewer, captured frames and filtered events.
Assets based on / motivated by Tower War.

**Before any paid Kane run or public exposure:** pass the security audit with no
unresolved High findings, set the Kane portal spend cap and complete the owner's
exposure setup. These instructions are not evidence of deployment. nginx, ufw,
DNS and tunnel changes are owner steps; do not apply them during a local smoke.

## Configured ngrok deployment (currently stopped)

As authorized on 2026-10-24, [Kane plays Node Arena](https://helene-unreconnoitred-overslowly.ngrok-free.dev) was verified running the merged `kane-cli` branch from the primary `/root/projects/node-arena` checkout. After the successful real rehearsal, the user requested shutdown: both services are now inactive and boot-disabled, and the URL is intentionally offline. Configuration is preserved. When hosting is authorized again, normal browsers first see ngrok's free warning; click **Visit Site**. The real winning public rehearsal and proxy checks are recorded in [SP05 Task 10](../../../docs/agent_files/feat-kane-hackday-20261023-2128/05-hosted-stream/code-2026-10-24-2309.md). The user's ngrok and separate credit-budget instructions supersede the historical nginx/DNS and portal-confirmation prerequisites for this deployment; the alternatives below remain reference material.

Dedicated units (currently inactive and boot-disabled) are `node-arena-kane-stream.service` and `node-arena-kane-ngrok.service`. Private operator files live in `/root/.config/node-arena-kane-stream/`: `service.env`, `locked-driver.mjs`, `ngrok-policy.yml`; unit definitions live under `/etc/systemd/system/`. These configurations and credentials are outside git. Health checks and a restart example for a later authorized session:

```sh
systemctl is-active node-arena-kane-stream.service node-arena-kane-ngrok.service
systemctl is-enabled node-arena-kane-stream.service node-arena-kane-ngrok.service
curl --fail http://127.0.0.1:8787/api/state
# Restart interrupts an active run; coordinate shared resources first.
systemctl restart node-arena-kane-stream.service node-arena-kane-ngrok.service
```

ngrok forwards only to `127.0.0.1:8787`, preserves public Host/Origin and disables traffic inspection. Its private policy removes incoming `CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP` and `Forwarded`, then sets `CF-Connecting-IP` from ngrok's verified `${conn.client_ip}`. This replacement is required for `KANE_STREAM_TRUST_PROXY=1`; appending an attacker-supplied XFF would not provide trusted visitor identity. Actual private upstream capture verified the injected IP and Host; differing forged headers could not bypass per-IP connection caps.

Production runs the real driver through the fixed local wrapper, which takes `/tmp/node-arena-kane-resources.lock` for each credits command/run rather than the idle service lifetime. Busy resources return generic unavailable. Backend 8787, preview 4175 and CDP 9225 (fallback 9223) remain loopback; the game, CDP and raw files are not tunneled. Production retains floor 200, max runs 20, wall limit 720 s, cooldown 120 s, Start/IP 600 s, daily 6, WS/SSE totals 100/200 and per-IP 3/3; no extra origins are enabled. No fake driver remains configured. Stop/Reset is a separate follow-up and is not deployed here.

## Local operation and shared resources

Build prerequisites follow the [root README](../../../README.md). The real driver
requires `kane-cli` login. `pnpm kane:stream` listens on `127.0.0.1:8787`. Opening
the page is free; Start with the real driver spends credits. The server preflights
credits then spawns the existing headless driver with `--software-gl --serve`,
credit floor and iteration cap. `--max-run-s` belongs to the **stream server**,
not the driver:

```sh
node tools/kane/stream/server.mjs --max-run-s 720
```

Coordinate all browser/Kane work first. Hold the external advisory `flock` for the
entire browser/credit session, including shutdown and cleanup. Check stream,
preview and CDP ports before starting; never kill an unrelated listener. Port 4173
may belong to unrelated work: the example uses 4175/9225, which must also be
reserved with other operators. The runtime separately owns the lock directory
`/tmp/node-arena-kane-stream.lock`; the external advisory lock is the file
`/tmp/node-arena-kane-resources.lock`. Never delete either to bypass an active owner.

Credit-free local smoke (no Kane calls):

```sh
(
  flock -n 9 || exit 1
  ss -ltnp '( sport = :8787 or sport = :4175 or sport = :9225 )'
  # Continue only when these ports are free and coordinated with other operators.
  KANE_STREAM_DRIVER=tools/kane/stream/test/fake-driver.mjs \
    KANE_STREAM_PREVIEW_PORT=4175 KANE_STREAM_CDP_PORT=9225 \
    KANE_STREAM_FAKE_DURATION_S=12 pnpm kane:stream
  # Ctrl-C triggers server cleanup; inspect before releasing flock.
  ss -ltnp '( sport = :8787 or sport = :4175 or sport = :9225 )'
) 9>/tmp/node-arena-kane-resources.lock
```

Open `http://127.0.0.1:8787` and press Start while it runs. The fake driver reports
synthetic credits `500`, launches real loopback preview/Chrome and emits events for
12 seconds **after readiness**. Completion exits 30 and yields `failed`; it does
not claim a win. It still requires Chromium and the test build. After shutdown,
verify the session's driver, Chrome and preview exited without changing unrelated
processes. For an authorized real run use the same lock/port procedure and omit
`KANE_STREAM_DRIVER` and `KANE_STREAM_FAKE_DURATION_S`.

Only fixed viewer files, `/backup.mp4`, `/api/state`, `/start`, `/stop`, `/reset`,
`/events` and `/ws` are served. All three POST controls require a valid Origin;
the viewer sends no request body. The lifecycle includes
starting/live/ending/cooldown; default cooldown is 120 seconds. The credit floor is
checked before spawn and again by the driver. Raw NDJSON/process records stay in
ignored `kane-runs/`; never copy local paths, balances, credentials or raw driver
output into public logs. Only the relay's default-deny filtered events are public.

## Shared Start, Stop and Reset controls

Opening/reloading the viewer, connecting streams and pressing Reset perform no
credit preflight and never start a match. Only clicking **Start** sends `/start`.
Late viewers join the same run. **Stop** is available during startup (including
pending preflight) and live play; it ends the shared run and cleans its owned
resources. Everyone sees **Stopping…** during cleanup, then **Stopped**. **Reset**
appears as soon as Stop is requested and stays disabled until startup/control
settlement and cleanup complete. A Stop clicked before the server reserves a
Start waits for its starting/live announcement, so an early conflict cannot lose
the cancellation. Cancellation targets the Start's UUID, so another viewer's
run cannot satisfy it. Reset of another attempt clears presentation while keeping
an unregistered local cancellation until its own Start settles. An explicit Stop
also ends a different currently displayed run, while retaining cancellation for
a pending local Start; queued cancellation alone never stops another attempt.

Reset clears the shared frame, queued JPEG work, activity, replay cursor and run
metadata. A reconnecting viewer also clears its old display if it missed Reset.
Reset returns to **Ready** after the original cooldown expires; during cooldown
Start stays disabled. Reset never clears credit floors, daily/IP admission or the
cooldown deadline. Click Start separately to launch a fresh match. Normal match
completion retains its existing finished/failure behavior.

Public state and SSE include `attemptId` (canonical UUID or null), set before
`starting` and retained even when failed preflight returns idle with no `runId` or
outcome. It remains through terminal/cooldown states; Reset clears it. Each Start
click sends a fresh UUID in `X-Kane-Attempt-Id` on POST `/start`. The same optional
header on POST `/stop` means “stop only this attempt”; a stale/mismatched UUID
returns generic 409 before any cleanup or video change. Missing Start headers get
a server-generated UUID; missing Stop headers retain legacy unconditional Stop.
Malformed or duplicate headers return generic 400 without invoking a control.
The public nonce provides correlation only, not authentication or game input; it
never becomes a process argument, path, log filename or spending-policy override.

Credit-free verification for this change uses ephemeral local HTTP servers,
injected lifecycle operations, synthetic events and mocked JPEG/transport races:

```sh
node --test tools/kane/stream/test
KANE_VIEWER_SCREENSHOTS=1 node --test tools/kane/stream/test/viewer.test.mjs
pnpm check:docs
```

The browser suite checks two viewers, initial/reload/Reset with zero automatic
`/start` requests, stopped cleanup gating, retained cooldown, fresh Start, stale
HTTP responses, missed reset, old SSE/socket callbacks and in-flight decoding.
Screenshots go to `/tmp/kane-controls-*.png` and `/tmp/kane-viewer-*.png`. These tests
make no Kane calls and do not start the primary stream, ngrok or the private game.

Keep primary hosting intentionally off. Do not deploy this feature before merge.
An optional actual fake-driver Stop/Reset smoke needs a separately coordinated
session: first verify `/tmp/node-arena-kane-stream.lock` has no active owner, take
`/tmp/node-arena-kane-stream-controls-smoke.lock`, and reserve **8789/4176/9226**.
Use the existing fake driver (synthetic credits 500), duration 60 seconds, cooldown
1 second and IP cooldown 0; preserve primary **8787/4175/9225** and unrelated
**4173/5173**. Build prerequisites and the test client in this feature worktree.
Check two viewers share Stopped and Reset, then Start explicitly boots a fresh
match; close the smoke and verify only its owned processes/profile were removed.
Never invoke real Kane, start a tunnel or change services for these checks.

## Environment

Operator-only values; requests cannot set them. Defaults match `server.mjs`,
`run.mjs`, `guards.mjs` and `screencast.mjs`.

| Variable | Default | Validation / meaning |
|---|---|---|
| `KANE_STREAM_HOST` | `127.0.0.1` | Any other value, including `0.0.0.0`, fails startup |
| `KANE_STREAM_PORT` | `8787` | Integer 1–65535; viewer listener |
| `KANE_STREAM_PREVIEW_HOST` | `127.0.0.1` | Any other value fails startup |
| `KANE_STREAM_PREVIEW_PORT` | `4173` | Integer 1–65535; private test preview |
| `KANE_STREAM_CDP_PORT` | `9222` | Integer 1–65535; private Chrome CDP |
| `KANE_STREAM_DRIVER` | `tools/kane/drive.mjs` | Script path resolved from repository root; trusted operator input |
| `KANE_STREAM_MIN_CREDITS` | `200` | Nonnegative safe integer; preflight and driver floor |
| `KANE_STREAM_MAX_RUNS` | `20` | Positive safe integer; driver iteration cap |
| `KANE_STREAM_MAX_RUN_S` | `720` | Integer 1–86400; server wall timeout; server `--max-run-s` overrides it |
| `KANE_STREAM_COOLDOWN_S` | `120` | Integer 0–86400; delay after cleanup |
| `KANE_IP_COOLDOWN_S` | `600` | Nonnegative safe integer seconds; minimum between Starts per IP |
| `KANE_DAILY_CAP` | `6` | Nonnegative safe integer; global Starts per UTC day |
| `KANE_STREAM_MAX_WS` | `100` | Nonnegative safe integer; total WS admission cap; screencast separately caps at 100 |
| `KANE_STREAM_MAX_SSE` | `200` | Nonnegative safe integer; total SSE admission cap |
| `KANE_STREAM_MAX_WS_PER_IP` | `3` | Nonnegative safe integer; WS cap per IP |
| `KANE_STREAM_MAX_SSE_PER_IP` | `3` | Nonnegative safe integer; SSE cap per IP |
| `KANE_STREAM_TRUST_PROXY` | unset | Only literal `1` trusts client-IP headers; required behind controlled proxy |
| `KANE_STREAM_ORIGINS` | unset | Comma-separated exact HTTP(S) origins; no paths, credentials, query or fragment |
| `KANE_STREAM_FPS` | `10` | Finite number >0 and <=60; latest-frame-wins delivery cap |
| `KANE_STREAM_FAKE_DURATION_S` | `12` | Fake driver only: finite number 1–720; duration after readiness |

Invalid limits fail startup (fake duration is checked by the fake driver). Zero
admission caps deny admissions. Empty numeric settings use defaults except FPS and
fake duration, which reject empty strings. Guard integers use decimal digits; run
settings accept numeric forms evaluating to an integer. Guard cooldown seconds
must fit safely after conversion to milliseconds. Choose distinct free ports.

Counters/connections are in memory; restart loses quota history. This is not a
durable daily spending limit: also set the portal cap. Same-origin Start/WS need no
origins list; extra origins deliberately permit cross-origin callers. No CORS
headers are emitted. With proxy trust, valid `CF-Connecting-IP` wins over the first
`X-Forwarded-For` address; a malformed preferred header falls back to the socket.
Without trust, proxied clients share the proxy's loopback IP and its limits.

SSE comments and WS pings run every 15 seconds (not an env setting), including
static scenes with no JPEG frames. Heartbeats keep idle intermediaries active;
they do not guarantee unlimited connection lifetime. nginx has a separate idle
read timeout; Cloudflare can close idle/restarted connections, so clients reconnect.
See [nginx WS timeouts](https://nginx.org/en/docs/http/websocket.html) and
[Cloudflare WS guidance](https://developers.cloudflare.com/network/websockets/).
The server limits bodies to 1024 bytes, headers to 8 KiB and request/header timeouts
to 10 seconds. SSE/WS queues are bounded; lower connection caps for limited uplinks.

## Owner deployment: nginx + Cloudflare

Chosen path: Cloudflare-proxied DNS -> this box IPv4 TCP 80 -> nginx ->
`127.0.0.1:8787`. No public 443, 8787, preview or CDP rule. Owner installs/configures
nginx, reviews existing sites/firewall rules, creates orange-cloud DNS and applies
changes after audit. Replace **every** `stream.example.com` with the chosen hostname.
Keep default rejection; merge with existing config to avoid duplicate default servers.

Example inside nginx's existing `http {}` context (e.g. an included site file):

```nginx
map $http_upgrade $kane_connection_upgrade {
    default upgrade;
    ''      close;
}
limit_req_zone $binary_remote_addr zone=kane_requests:10m rate=1r/s;

server {
    listen 0.0.0.0:80 default_server;
    server_name _;
    return 444;
}

server {
    listen 0.0.0.0:80;
    server_name stream.example.com;
    client_max_body_size 1k;
    client_header_timeout 10s;
    client_body_timeout 10s;
    limit_req zone=kane_requests burst=20 nodelay;
    limit_req_status 429;

    # Trust boundary: firewall permits only Cloudflare origin connections.
    # Optional real-IP directives described below go here.
    proxy_http_version 1.1;
    proxy_set_header Host stream.example.com;
    proxy_set_header X-Forwarded-Host stream.example.com;
    proxy_set_header CF-Connecting-IP $http_cf_connecting_ip;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Real-IP $remote_addr;
    # Fixed public scheme assumes Cloudflare enforces edge HTTPS.
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Forwarded "";
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $kane_connection_upgrade;
    proxy_connect_timeout 5s;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    location = /ws {
        proxy_pass http://127.0.0.1:8787;
    }
    location = /events {
        proxy_buffering off;
        proxy_cache off;
        add_header X-Accel-Buffering no always;
        proxy_pass http://127.0.0.1:8787;
    }
    location / {
        proxy_pass http://127.0.0.1:8787;
    }
}
```

Set `KANE_STREAM_TRUST_PROXY=1` in the server environment. Every proxy location
inherits the overwritten headers. Adding a location-specific `proxy_set_header`
requires repeating the full set: nginx header inheritance is all-or-nothing.
Keep the fixed upstream Host and browser Origin. Do not append user-supplied XFF
with `$proxy_add_x_forwarded_for`. Trust the CF client header **only because**
origin access is restricted to Cloudflare; arbitrary internet clients must never
reach this listener. Leave Cloudflare's visitor-IP removal transform and Pseudo
IPv4 header-overwrite mode off to preserve the actual client IP. See
[Cloudflare header semantics](https://developers.cloudflare.com/fundamentals/reference/http-headers/#cf-connecting-ip).

Optional nginx real-IP support: add `real_ip_header CF-Connecting-IP;` and one
`set_real_ip_from CIDR;` for **each** current Cloudflare IPv4 range below inside
the named server, if nginx has `http_realip_module`. Never trust `0.0.0.0/0`.
Then `$remote_addr` and the nginx request zone use the real visitor IP. Without
this, the nginx zone groups by Cloudflare edge IP (conservative shared throttling);
Node still uses CF-Connecting-IP for its own per-IP caps. Retain the firewall.
References: [real-IP module](https://nginx.org/en/docs/http/ngx_http_realip_module.html),
[request zone](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html),
[proxy headers/buffering/timeouts](https://nginx.org/en/docs/http/ngx_http_proxy_module.html),
[WS upgrade requirements](https://nginx.org/en/docs/http/websocket.html).

Before reload, owner runs `sudo nginx -t`, inspects `sudo nginx -T` for other
listeners/default sites, then reloads through the existing service manager.
These remain manual steps; this documentation task does not execute them.

### Firewall: Cloudflare IPv4 to port 80 only

The [official IPv4 list](https://www.cloudflare.com/ips-v4) was checked 2026-10-24.
Re-fetch and review before applying or refreshing rules:

```text
173.245.48.0/20
103.21.244.0/22
103.22.200.0/22
103.31.4.0/22
141.101.64.0/18
108.162.192.0/18
190.93.240.0/20
188.114.96.0/20
197.234.240.0/22
198.41.128.0/17
162.158.0.0/15
104.16.0.0/13
104.24.0.0/14
172.64.0.0/13
131.0.72.0/22
```

Owner repeats this template for every reviewed CIDR:

```sh
sudo ufw allow proto tcp from 173.245.48.0/20 to any port 80 comment 'Kane Cloudflare origin'
```

First inspect `sudo ufw status verbose` and `sudo ufw status numbered`. Preserve
SSH/admin access, confirm an effective default-deny incoming policy, and remove or
narrow broad existing HTTP/nginx allow rules that bypass the restriction. Do not
blindly enable/reset ufw or change default policy over SSH. Inactive ufw provides
no protection: owner must finish activation with preserved management access before
public nginx starts. Add no allow rules for 443, 8787, 4173/4175 or 9222/9225.
IPv4 rules do not secure IPv6: this snippet listens only on IPv4; verify no other
site listens on `[::]:80`/443, IPv6 inbound policy denies origin access, and no
origin AAAA record opens a second route. Cloudflare edge IPv6 may remain enabled
with an IPv4-only origin. From outside, verify direct non-Cloudflare origin access
fails and only the proxied hostname reaches the viewer.

### TLS mode and verification

For HTTP-only port 80 origin, owner selects a compatible Cloudflare mode:
[Flexible](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/flexible/)
encrypts browser-to-edge traffic but leaves edge-to-origin HTTP unencrypted. Enforce
HTTPS at the edge; an origin HTTPS redirect causes a Flexible redirect loop.
Full/Full (strict) requires separately reviewed origin TLS, certificate and
restricted 443 firewall rules; this snippet does not provide them. The fixed
forwarded scheme above assumes edge HTTPS.

Before sharing: confirm Node, preview and CDP bind only 127.0.0.1 (`ss -ltnp`);
check proxied viewer, Start, WS frames and unbuffered SSE for >120 seconds; verify
unknown Host rejection and unreachable direct origin/private ports. Two viewers
must share one run; public state/logs must contain no paths, credits or credentials.
First public checks use the fake driver; paid rehearsal requires separate
authorization and the external resource lock.

## Fallbacks

After audit/owner approval only, the requested temporary tunnel command is:

```sh
cloudflared tunnel --url http://127.0.0.1:8787
```

Set `KANE_STREAM_TRUST_PROXY=1`; retain loopback binding and verify public Host/Origin
and client-IP forwarding. Do not override HTTP Host to `127.0.0.1`, which breaks
same-origin checks. The URL changes per start and expires on shutdown. Current
[Quick Tunnel docs](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
explicitly say **SSE is unsupported**, with 200 in-flight requests and no uptime
guarantee. This is a degraded viewer/WS preview fallback, not a verified replacement
for full live logs. Use nginx or a separately validated named Cloudflare Tunnel for
full WS + SSE. No tunnel is started by this task.

Owner may place a recorded winning run at `public/backup.mp4` relative to this
folder. It is git-ignored; `/backup.mp4` serves it only when present and the failure
UI can link to it. Keep sensitive raw evidence outside git and redact credentials,
private paths and account details before sharing evidence. No recording is bundled.

## Checks and dependency

```sh
node --test tools/kane/stream/test
pnpm check:docs
git diff --check
```

`test/index.js` is the Node 22 directory test entry. `ws@8.22.0` is exact-pinned in
`tools/package.json`; server mode uses `noServer` and `maxPayload: 1`. Viewer messages
cannot control the game. CDP wrapper methods are limited to screencast/target
operations; navigation and Kane ownership stay with the existing driver.
