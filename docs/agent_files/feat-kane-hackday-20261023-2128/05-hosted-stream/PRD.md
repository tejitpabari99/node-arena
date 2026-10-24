---
status: in-progress
summary: Public no-password page on this Linux box where anyone presses Start and watches Kane play live (CDP screencast over WS + sanitized driver log over SSE), single-run lock, credit floor 200, game never exposed (loopback only), nginx-on-this-box behind Cloudflare-proxied DNS (cloudflared fallback), security-review surface listed.
date: 2026-10-24
---
# PRD: 05 Hosted live stream

Repo/branch: node-arena, `feat/kane-hackday` · Depends on: 03-kane-driver (parallel with 04) · Brief: [brainstorm.md](../brainstorm.md) (locked)
Owns: `tools/kane/stream/**` (new: `server.mjs`, `run.mjs`, `screencast.mjs`, `relay.mjs`, `guards.mjs`, `public/{index.html,app.js,style.css}`, `test/`, `README.md`), root script `kane:stream`, `ws` entry in `tools/package.json`
Does not own: driver, NDJSON schema, credits parser, Chrome launch (03); game, DOM, `?kane=1` (01/02); hook/CI (04)

## TL;DR
`pnpm kane:stream` starts a Node server bound to **127.0.0.1:8787**. It serves a static viewer (Start button, live canvas, log pane). `POST /start` (guarded) spawns **one** `tools/kane/drive.mjs --headless --serve` process. The server reads the driver's stdout NDJSON (03 R7), allowlist-filters it to SSE, and opens a read-only CDP session to the driver's Chrome for `Page.startScreencast`, fanning JPEG frames out over WebSocket. Only frames and filtered logs are public. The test build (preview on 4173), Chrome CDP (9222), and all Kane credentials stay on loopback/server env. Exposure (owner decision 2026-10-24): nginx on this box (apt, nginx 1.24) listening on :80, reachable only from Cloudflare IPv4 ranges (ufw), Cloudflare-proxied DNS -> nginx:80 -> 127.0.0.1:8787; `cloudflared` is the fallback. Hosted link is first in the cut order; fallback is a pre-recorded win video.

## Problem
Brief wants a public "press Start, watch Kane play" link with no password, hosted here, while Kane mode only exists in a test build with `window.__na` hooks [verified: apps/web/src/main.tsx:14 gate per shared context]. Public Start spends real Kane credits, so abuse and exposure are the whole risk.

## Goals / Non-Goals
Goals: live view of the real match; shared stream for all viewers; hard bounds on credits, time, connections; nothing sensitive or interactive reachable from the internet.
Non-goals: any viewer input to the game or Chrome, accounts/passwords, spectator mirror, persistence/replay of past runs, multi-run queue, mobile polish beyond a responsive canvas.

## Requirements

### R1 Viewer page (static, `GET /`)
- Header title "Kane plays Node Arena" (no "Tower War" anywhere in `public/`; test greps it).
- Start button, status pill (`idle|starting|live|finished|failed|cooldown`), 16:9 canvas, log pane (newest at bottom, auto-scroll, copy of Kane step text and driver events), viewer count.
- Start is disabled unless state is `idle`; on `live` late viewers auto-join the running stream (last frame sent immediately, SSE replay).
- On `failed` show "Live run unavailable" + link to `/backup.mp4` if the owner placed it in `public/` [owner step].
- Log lines rendered via `textContent` only (Kane/LLM text is untrusted).

### R2 Endpoints
| Route | Behavior |
|---|---|
| `GET /` , `/app.js`, `/style.css` | static, fixed file list (no directory serving, no path params) |
| `GET /api/state` | `{state, runId, startedAt, endsAtMax, viewers, outcome?}`; never balance, pids, paths |
| `POST /start` | guards R4 then spawn; `202 {runId}`, `409` if running, `429` rate/daily cap, `503` credit floor or infra (message generic: "unavailable") |
| `GET /events` | SSE, `Last-Event-ID` resume, replay buffer of last 200 filtered events, `: hb` every <=30 s (15 s default; Cloudflare idle timeout ~100 s [P-INFRA-Q5]) |
| `GET /ws` | WebSocket, server -> client binary JPEG frames + occasional JSON `{type:"meta",w,h}` text; server ping every <=30 s (Cloudflare idle timeout ~100 s); client messages ignored |
Everything else 404. Methods other than the above 405.

### R3 Run lifecycle (single-run lock)
`idle -> starting -> live -> ending -> cooldown(120 s) -> idle`, in-memory, one run object.
1. Credit preflight: server runs `node tools/kane/drive.mjs --credits-only` (03 R1; same as `pnpm kane:credits`), parses `{"credits":N}`; `N < 200` or parse failure -> `503`, never leaks N. Driver re-checks with `--min-credits 200` (defense in depth, exit 21).
2. Spawn (detached process group): `node tools/kane/drive.mjs --headless --serve --min-credits 200 --max-runs 20 --port 9222 --log kane-runs/<ts>/driver.ndjson` (flags verified in 03 R1; `--headless` is its own flag row). Display: headless=new with `--use-angle=swiftshader --enable-unsafe-swiftshader`; WebGL2 renders correctly; Xvfb is not used (headed Chrome under Xvfb did not expose the CDP port) [RESOLVED O2: probe: probes-20261024.md §P-INFRA-Q3, §P-RENDER]. The driver owns Chrome and the preview server (03 `--serve`, which kills the child on every exit path); 05 never starts either itself, so 05 and 03 do not overlap. Kane runs on this box for now; all paths/ports/hosts come from env/flags (host-agnostic) so Kane + Chrome can move to another host later. Single tab only: never open other tabs in Kane's browser (03 R4).
3. On driver event `chrome_ready` (port) -> `screencast.mjs` attaches (R5). On `driver_end` or process exit -> `ending`: stop screencast, kill process group (SIGTERM, 5 s, SIGKILL), kill Chrome pid from `chrome_ready` and preview if driver died uncleanly, delete temp profile, broadcast final `state`.
4. Max wall 12 min (`--max-run-s`, env `KANE_STREAM_MAX_RUN_S`); on expiry force `ending`, outcome `timeout`. Driver exits map to `outcome` per 03 (0 won, 10 lost, 11/20/22/23/30 failed variants, 21 -> `unavailable`).
5. Startup sweep: kill leftovers recorded in `kane-runs/stream.pid.json`; `SIGTERM/SIGINT` handler runs the same cleanup. State endpoint survives restarts as `idle`.

### R4 Abuse guards
| Guard | Default (env override) |
|---|---|
| Single run + cooldown | 1 run, 120 s cooldown (`KANE_STREAM_COOLDOWN_S`) |
| Credit floor | 200, server preflight + driver flag |
| Rate limit `/start` | per client IP 1 Start / 10 min (`KANE_IP_COOLDOWN_S`, default 600); global daily cap 6 starts (`KANE_DAILY_CAP`, default 6) -> bounds worst-case daily spend to ~6 x 150 credits [03 R5 budget cap] |
| Max run duration | 12 min |
| Connections | 100 WS + 200 SSE total, 3 per IP each; 429/close beyond. Sizing: ~0.3 MB/s per viewer (10 fps x ~24 KB/frame) [P-INFRA-Q4], so 100 viewers ~30 MB/s (~240 Mbit/s) worst case; lower the WS cap if the uplink is smaller (`KANE_STREAM_MAX_WS`) |
| Request limits | body <= 1 KB (Start needs none), headers 8 KB, 10 s header/request timeout, no keep-alive abuse (`server.requestTimeout`) |
| Origin/CORS | no CORS headers; `POST /start` and WS upgrade require `Origin` host == `Host` header (or listed in `KANE_STREAM_ORIGINS`); `Sec-Fetch-Site` same-origin preferred |
| Client IP | `CF-Connecting-IP`/`X-Forwarded-For` honored only if `KANE_STREAM_TRUST_PROXY=1`, else socket address (always loopback behind a tunnel, so this MUST be set for per-IP limits to mean anything) |
| No input path | CDP wrapper in `screencast.mjs` wraps 03 `lib/cdp.mjs` generic `send(method, params)` and permits only `Page.startScreencast`, `Page.stopScreencast`, `Page.screencastFrameAck`, `Target.getTargets/attachToTarget`, and rejects every other method; no `Input.*`, `Runtime.*`, `Page.navigate`. Test greps `Input.` in `tools/kane/stream/` = 0 |
| Headers | CSP `default-src 'self'; img-src blob:; connect-src 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on API/SSE |
| Secrets | Kane auth lives in `kane-cli` login/server env; only passed to the child via inherited env; server never reads, logs, or serializes env; the allowlist (R6) is default-deny |

### R5 Screencast
- `Page.startScreencast {format:'jpeg', quality:60, maxWidth:1280, maxHeight:720, everyNthFrame:1}` on the game page target (found via CDP target list, URL contains `kane=1`). Driver (03) is the CDP owner for visibility handling; 05 attaches a **second, read-only** session and must not detach the driver's. Verified: a second CDP client screencast coexists with the driver and Kane, 10.8-13 fps, ~24 KB/frame [P-INFRA-Q4, P-KANE-P2].
- Ack every frame immediately (Chrome stops sending otherwise). Server FPS cap 10 (`KANE_STREAM_FPS`; plan 10 fps per measured rate) with latest-frame-wins (older pending frame dropped, never queued). Game runs at 0.25x so 10 fps is ample.
- Backpressure per client: skip a frame if `ws.bufferedAmount > 512 KB`; close a client that skipped for 10 s. Last frame cached and sent on connect. Frames sent as raw binary JPEG; client draws via `createImageBitmap` onto canvas.
- Static scenes yield no frames; viewer keeps last frame (no heartbeat frames).
- If CDP session drops while run `live`: retry attach 3x (2 s), else keep run going with log only and show "video lost".

### R6 Log relay (driver NDJSON -> SSE) and allowlist
Server parses each driver stdout line as JSON (invalid lines dropped, not forwarded), applies default-deny allowlist (field names from real Kane output [P-KANE-P3]), assigns SSE `id` = driver `seq`, stores in replay buffer, writes. Raw unfiltered log stays on disk only (`--log`).

| Driver `type` (03 R7) | Passed fields | Dropped |
|---|---|---|
| `driver_start` | `mode` | `args`, `url`, `credits` |
| `chrome_ready` | (type only) | `pid`, `port`, `headless` |
| `page_ready` | `levelId`, `speed`, `letters` | |
| `credits` | `ok` | `balance`, `floor` |
| `state` | `iter, tick, result, ready, active, unavailable, humanDrawn, humanCut` | |
| `idle`, `stall`, `fallback` | `iter, waitedS / noProgress / to` | `reason` text |
| `run_start` | `iter, phase, objective, maxSteps` | |
| `kane` | `iter` + `event` reduced to: step lines `{step, status, remark}` (NO `type` field on step lines); `run_end` `{status, summary, duration, credits_consumed}` | everything else, notably `test_url`, `share_url`, `session_dir`, `run_dir`, `screenshot_path`, `commit_id`, `testcase_id`, `project_id`, `org_id`, `session_id`, `describe_trigger.objective`, `recent_actions`, `run_end.context`, `verdict`, `reason`, `result_code`, `reason_code`, `stream_start`/`recording_state`/`bifurcation` lines |
| `run_end` | `iter, kaneStatus, durationMs` | `creditsRun`, `sessionDir`, `kaneExit` |
| `verify` | `iter, accepted[{tick,type,from,to}], rejected[{reason}], claimMatches` | |
| `warn` | `code` | `msg` |
| `game_over` | `result, winner, tick, humanCommands, drawn, cut` | |
| `driver_end` | `outcome, runs, wallMs` | `creditsUsed`, `exitCode` |
Plus value hygiene on every passed string: truncate 300 chars; drop the whole field if it matches `/(LT_|token|secret|api[_-]?key|bearer|password|\/root\/|\/home\/|https?:\/\/(?!localhost))/i`. Unknown `type` -> dropped (a `kane` event is identified by the wrapper `type:'kane'`, then its inner shape: step lines have `step`+`status`, `run_end` has `status`+`summary`; anything else dropped). `remark`/`summary` may echo the objective text: fine, not secret. Fixtures in `test/` come from real Kane output [RESOLVED O3: probe: probes-20261024.md §P-KANE-P3].

## Architecture
```
Browser viewer  <-- WS (JPEG) / SSE (filtered) / JSON --  stream/server.mjs (127.0.0.1:8787)
                                                              | spawn + stdout NDJSON        | CDP ws (read-only, allowlisted)
                                                         tools/kane/drive.mjs  ---------->  Chrome (127.0.0.1:9222, headless)
                                                              |  kane-cli --cdp-endpoint        ^ page: preview:test 127.0.0.1:4173 (?kane=1)
                                                              +---------------------------------+
internet -> Cloudflare (proxied DNS) -> nginx :80 (this box, ufw: Cloudflare IPv4 only) -> 127.0.0.1:8787 only  [fallback: cloudflared tunnel]
```
Modules: `guards.mjs` (rate limit, origin, conn caps; pure, unit-tested), `relay.mjs` (allowlist + replay buffer; pure), `screencast.mjs` (CDP session + fan-out + backpressure, reuses 03 `lib/cdp.mjs` with method allowlist wrapper), `run.mjs` (state machine, spawn, cleanup), `server.mjs` (http + `ws` `noServer`, `maxPayload: 1`, so any client message closes it).
Reuses from 03 (read-only contract): CLI flags/exit codes (R1, incl. the standalone `--headless` flag and `--serve` child cleanup on exit), NDJSON v1 schema (R7), `lib/cdp.mjs` generic `send(method, params)` (05 adds the allowlist wrapper), `--credits-only` output. 03 keeps `chrome_ready.port` and `--headless` stable. Does not touch `drive.mjs` internals.
Dependency: **`ws` pinned exact in `tools/package.json`** (Node 22 has a client `WebSocket` only, no server). Alternative hand-rolled RFC 6455 send-only server rejected: a protocol parser is a worse audit surface than a ubiquitous library with `maxPayload` limits. Everything else is `node:http`, `node:child_process`, zero deps. `ws` is the only supply-chain item for review.

### Exposure
| Option | How | Notes |
|---|---|---|
| A (chosen, owner 2026-10-24) nginx on this box | Cloudflare-proxied DNS -> nginx:80 -> `127.0.0.1:8787`; ufw allows :80 only from Cloudflare IPv4 ranges, no 443 rule. `/` proxy with `proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr` (and real client IP via `CF-Connecting-IP`; `set_real_ip_from` Cloudflare ranges optional); `/ws`: `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_read_timeout 3600s;`; `/events`: `proxy_buffering off; proxy_cache off; add_header X-Accel-Buffering no; proxy_read_timeout 3600s;`; `client_max_body_size 1k; limit_req_zone ... rate=1r/s` | Owner creates DNS record and picks Cloudflare SSL mode. Per-IP guards need `KANE_STREAM_TRUST_PROXY=1` + `CF-Connecting-IP`. Heartbeats <=30 s (Cloudflare ~100 s idle). Full snippet in `README.md` [P-INFRA-Q5] |
| B fallback cloudflared quick tunnel | `cloudflared tunnel --url http://127.0.0.1:8787` -> random `https://*.trycloudflare.com` | `cloudflared` present [verified: which → /usr/local/bin/cloudflared]; no DNS/account; URL changes per start; WS + SSE pass |
Server sends `X-Accel-Buffering: no` on SSE itself. Cloudflare idle timeout ~100 s, hence SSE heartbeat <=30 s and WS ping <=30 s [P-INFRA-Q5]. Never bind `0.0.0.0`; `KANE_STREAM_HOST` override documented as unsafe.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Test build exposure | **Not public.** Preview + CDP bound to 127.0.0.1; only frames + filtered log leave the box | Expose preview through proxy for a live iframe | Test hooks (`window.__na`) never reachable; collapses the security surface; viewers cannot interact anyway |
| 2 | Process model | Server spawns the 03 driver (`--serve --headless`) | Server reimplements Chrome/preview/Kane loop | No overlap with 03; one source of truth for loop and events |
| 3 | WS lib | `ws` pinned | hand-rolled; SSE-only video | audited, maxPayload guard; brief says WS |
| 4 | Video path | CDP `Page.startScreencast` JPEG, FPS cap 10, latest-wins | noVNC/Xvfb capture, WebRTC | brief; no extra daemon; backpressure simple |
| 5 | Display | headless=new + SwiftShader flags | headed on Xvfb (no CDP port exposed) | measured: WebGL2 renders correctly headless [P-INFRA-Q3, P-RENDER] |
| 6 | Log filter | default-deny allowlist table + value regex (fields from P-KANE-P3) | pass-through | Kane/driver lines hold session paths, portal URLs, balance, tenant IDs |
| 7 | Credit control | preflight floor 200 + driver floor + daily start cap 6 (`KANE_DAILY_CAP`) + per-IP 1/10 min (`KANE_IP_COOLDOWN_S`) + portal cap | floor only | floor alone allows repeated 150-credit runs down to 200 |
| 8 | Auth | none; abuse guards only | shared secret | brief: no password |
| 9 | Exposure | nginx on this box, ufw :80 from Cloudflare IPv4 only, Cloudflare-proxied DNS (owner choice 2026-10-24); cloudflared fallback | cloudflared default | owner decision; firewall already scoped; no 443 rule so Cloudflare terminates TLS |

## Manual steps
- Owner: set Kane portal credit/spend cap (brief); optionally change daily cap (`KANE_DAILY_CAP`, default 6) / per-IP cooldown (`KANE_IP_COOLDOWN_S`, default 600); top up credits.
- Owner: `kane-cli login` already valid on this box [verified in 03]; keep server env free of other secrets.
- Owner: exposure chosen (nginx here). Owner creates the Cloudflare-proxied (orange-cloud) DNS record and picks the Cloudflare SSL mode (no 443 rule exists, so use a mode that works over port 80 to origin, e.g. Flexible, or add a 443 rule + origin cert for Full). Agent/owner `apt install nginx` (1.24; not installed today) and applies the README snippet. Fallback: cloudflared quick tunnel.
- Owner: place a recorded winning run at `tools/kane/stream/public/backup.mp4` (git-ignored) for the failure plan.
- Xvfb not needed (headless=new used) [P-INFRA-Q3]; chromium present [verified: ~/.cache/ms-playwright/chromium-1248].
- Owner: **dev-security-review must pass before the link is shared** (see Risks).

## Risks / Open Questions
- [RESOLVED: yes, a second CDP client screencast coexists with the driver and Kane; 10.8-13 fps, ~24 KB/frame, ~0.3 MB/s per viewer [probe: probes-20261024.md §P-INFRA-Q4, §P-KANE-P2]] O1 second-client screencast.
- [RESOLVED: headless=new + `--use-angle=swiftshader --enable-unsafe-swiftshader` renders WebGL2 correctly; Xvfb headed Chrome did not expose CDP; tab visibility handled by single tab + `bringToFront` + `__na.resume()` (03 R4) [probe: probes-20261024.md §P-INFRA-Q3, §P-RENDER]] O2 headless frames/WebGL.
- [RESOLVED: allowlist from real Kane output: step `{step,status,remark}`, run_end `{status,summary,duration,credits_consumed}`; everything else dropped [probe: probes-20261024.md §P-KANE-P3]] O3 Kane field names.
- [RESOLVED: stale; Probe 2 verified attach, and 03 now treats it as resolved [probe: probes-20261024.md §P-KANE-P2]] O4 `--cdp-endpoint` attach.
- [RESOLVED: orchestrator default 2026-10-24 — daily start cap 6 and per-IP Start limit (1 per 10 min), both env-configurable (e.g. KANE_DAILY_CAP, KANE_IP_COOLDOWN_S); owner may change] O5 Daily start cap and per-IP Start rate limit.
- [RESOLVED: brief] Test build is used; mitigated by decision 1.
- [DEFERRED] Spectator mirror, run history, WS compression, TURN/WebRTC.
- **Threat surface for dev-security-review**: (1) `POST /start` credit-drain/DoS and the rate/daily/credit-floor controls incl. IP spoofing via proxy headers (`TRUST_PROXY`); (2) child-process spawn args (none from client; fixed argv) and env inheritance; (3) NDJSON allowlist leakage (paths, balances, Kane URLs, prompt-injected LLM text) and SSE XSS (text-only rendering, CSP); (4) CDP on 127.0.0.1:9222 reachable by any local user (shared box) and the method allowlist; (5) `ws` dependency + upgrade origin check + frame flood/slow-client memory (bufferedAmount, connection caps); (6) process/zombie cleanup and temp profile dirs; (7) tunnel/nginx config (Host header, WS timeouts, buffering); (8) static file serving path traversal (fixed list); (9) log files in `kane-runs/` contain unfiltered Kane output; (10) Kane uploads screenshots to LambdaTest cloud (existing brief acceptance).

## Acceptance Criteria
- `node --test tools/kane/stream/test` green: allowlist (secrets/paths/balance stripped, unknown type dropped, fixtures from a real run), state machine (second `/start` -> 409, cooldown, daily cap), rate limit, origin check, SSE replay + `Last-Event-ID`, backpressure (fake slow WS client never grows buffer past cap), CDP wrapper rejects `Input.dispatchMouseEvent`.
- `grep -rniE 'tower war' tools/kane/stream/public` -> 0; `grep -rn 'Input\.' tools/kane/stream --include=*.mjs` -> 0 (excluding test strings).
- Credit-free smoke: `KANE_STREAM_DRIVER=tools/kane/stream/test/fake-driver.mjs pnpm kane:stream`, open page, press Start: canvas shows live frames of preview:test, log pane fills, run ends, cleanup leaves 0 `chrome`/`vite`/driver processes (`pgrep` check) and `/api/state` = `idle` after cooldown.
- With `--min-credits 99999` equivalent (`KANE_STREAM_MIN_CREDITS`), `POST /start` -> 503 and no process spawned.
- `ss -ltnp` shows 8787, 4173, 9222 bound only to 127.0.0.1 (nginx :80 the only public listener); from outside the box (via Cloudflare) `/` works, SSE and WS stay up >120 s through the proxy, and `:4173`/`:9222`/`:8787` are unreachable; direct non-Cloudflare access to :80 is blocked by ufw.
- Two browsers: both see the same stream; Start disabled on both while `live`; one more viewer beyond caps gets 429/close.
- Real rehearsal: one Start through the tunnel ends with `driver_end.outcome` matching the game result, credits spent within 03 budget.
- dev-security-review artifact exists with no unresolved High before the link is posted.
