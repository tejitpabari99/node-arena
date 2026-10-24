---
status: in-progress
summary: 9 tasks done; local stream and security review pass; public paid rehearsal blocked on owner proxy/DNS setup
date: 2026-10-24
---
# Tasks: 05 Hosted live stream
Source of truth: [PRD.md](PRD.md). Builds `tools/kane/stream/**` plus root script `kane:stream` and a pinned `ws` entry. Consumes 03's driver contract read-only (CLI flags, exit codes, NDJSON v1, `lib/cdp.mjs send()`, `--credits-only`, `chrome_ready.port`); depends on 03 landing. No `[OPEN]` items in the PRD.

| # | Task | Depends on | Status |
|---|---|---|---|
| 1 | Scaffold, `ws` pin, abuse-guard module | 03 | done |
| 2 | Log relay allowlist and replay buffer | 1 | done |
| 3 | Run lifecycle and fake driver | 1 | done |
| 4 | Screencast and CDP method allowlist | 1 | done |
| 5 | HTTP, SSE and WebSocket server | 2, 3, 4 | done |
| 6 | Viewer page | 5 | done |
| 7 | Credit-free smoke and acceptance greps | 6 | done |
| 8 | README, nginx/ufw and cloudflared docs | 5 | done |
| 9 | dev-security-review gate | 7, 8 | done |
| 10 | Real rehearsal through the proxy | 9 | blocked |

## Task 1 — Scaffold, `ws` pin, abuse-guard module
What it is / what it means: Foundation for the stream package (PRD Owns, R4, Architecture dependency note, Decision 3).
What changes at a high level: Create the `tools/kane/stream` skeleton with its test folder, add root script `kane:stream`, and add `ws` pinned to an exact version in `tools/package.json` (only third-party dependency; everything else is Node built-ins). Build the pure `guards.mjs`: per-IP and daily start limits, origin/Host check, per-IP and total connection caps, proxy-header trust only when `KANE_STREAM_TRUST_PROXY=1`, env-configurable defaults from R4. Unit tests cover each guard. Root `package.json` scripts edit follows 03's.
Done when: `ws` is exact-pinned and installed; guard unit tests pass under `node --test`; `pnpm kane:stream` is a registered script.

## Task 2 — Log relay allowlist and replay buffer
What it is / what it means: The default-deny filter between driver NDJSON and the public SSE (R6, Decision 6).
What changes at a high level: Build pure `relay.mjs`: parse lines (drop invalid JSON), apply the per-type field allowlist table, reduce `kane` events to step lines and `run_end` only, drop unknown types, apply value hygiene (300-char truncation, drop field on secret/path/URL regex), use driver `seq` as SSE id, keep a 200-event replay buffer with `Last-Event-ID` resume. Fixtures come from real Kane output captured in the probes.
Done when: tests show secrets, paths, balances, portal/share URLs, ids and unknown types never pass; replay and resume work; fixtures are real-run derived.

## Task 3 — Run lifecycle and fake driver
What it is / what it means: Single-run state machine and process hygiene (R3, Decisions 2, 7).
What changes at a high level: Build `run.mjs`: `idle -> starting -> live -> ending -> cooldown(120 s) -> idle`, credit preflight via `--credits-only` (floor 200, failure or parse error -> unavailable without leaking the number; `KANE_STREAM_MIN_CREDITS` override), detached spawn with fixed argv only (headless, serve, floor, max-runs, port, log path), exit-code to outcome mapping, 12-minute wall limit, ordered teardown (SIGTERM, 5 s, SIGKILL, Chrome/preview leftovers, temp profile), pid file startup sweep and signal handlers. Add a credit-free `fake-driver.mjs` (selectable via `KANE_STREAM_DRIVER`) that emits NDJSON and launches headless Chrome on preview.
Done when: state-machine tests pass (second start rejected, cooldown, daily cap, floor blocks spawn with nothing spawned, timeout path); a kill leaves no stray processes.

## Task 4 — Screencast and CDP method allowlist
What it is / what it means: Read-only video path (R5, Decision 4, "No input path" guard).
What changes at a high level: Build `screencast.mjs` on 03's generic `send()` wrapped by a method allowlist (screencast start/stop/ack, target discovery only; everything else rejected, no `Input.*`/`Runtime.*`/navigate). Attach a second session to the `kane=1` page target without disturbing the driver's, ack every frame, cap at 10 fps with latest-frame-wins, cache the last frame, per-client backpressure (skip above 512 KB buffered, drop after 10 s of skipping), retry attach 3x then continue log-only ("video lost").
Done when: tests show the wrapper rejects `Input.dispatchMouseEvent`, a fake slow client never grows past the buffer cap, and late joiners get the last frame.

## Task 5 — HTTP, SSE and WebSocket server
What it is / what it means: The only listener, loopback-bound (R2, R4 headers/limits, Decisions 1, 8).
What changes at a high level: Build `server.mjs` on `node:http` plus `ws` in `noServer` mode with `maxPayload: 1`. Bind 127.0.0.1:8787 only (`KANE_STREAM_HOST` override flagged unsafe). Serve fixed static files, `GET /api/state`, guarded `POST /start` (202/409/429/503 with generic messages), SSE with heartbeat, WS with ping and origin check, 404/405 for everything else. Apply CSP and other headers, body/header/request limits, connection caps, and `X-Accel-Buffering: no`. Wire guards, relay, run and screencast together.
Done when: endpoint tests cover status codes, Last-Event-ID resume, origin rejection, cap rejection (429/close) and method handling; `ss` shows loopback binding.

## Task 6 — Viewer page
What it is / what it means: Static public UI (R1).
What changes at a high level: `public/index.html`, `app.js`, `style.css`: title "Kane plays Node Arena", Start button enabled only in `idle`, status pill, 16:9 canvas drawn through `createImageBitmap`, log pane with `textContent` only and auto-scroll, viewer count, late-join auto-attach, and the `failed` state showing "Live run unavailable" with a link to `/backup.mp4` when present. No original-game name anywhere.
Done when: page renders all six states against the server; `grep -rniE 'tower war' tools/kane/stream/public` returns 0.

## Task 7 — Credit-free smoke and acceptance greps
What it is / what it means: End-to-end local verification without spending credits (Acceptance Criteria).
What changes at a high level: Run the stack with the fake driver, press Start in two browsers, check both see the same frames and logs, Start disabled while live, extra viewer beyond cap gets 429/close, run ends and cleanup leaves zero chrome/vite/driver processes, state returns to `idle` after cooldown; force `KANE_STREAM_MIN_CREDITS` high and confirm 503 with no spawn. Run the `Input.` and "tower war" greps. Fix defects found.
Done when: all credit-free acceptance items pass and the full `node --test tools/kane/stream/test` suite is green.

## Task 8 — README, nginx/ufw and cloudflared docs
What it is / what it means: Exposure runbook (Exposure table, Decision 9, Manual steps).
What changes at a high level: Write `tools/kane/stream/README.md` with env var table, the nginx snippet (Host and forwarded headers, WS upgrade with long read timeout, SSE buffering off, 1k body limit, request rate zone, optional real-IP ranges), ufw rule for Cloudflare IPv4 on :80 only, the `KANE_STREAM_TRUST_PROXY=1` requirement, Cloudflare SSL mode note, heartbeat/idle-timeout rationale, cloudflared quick-tunnel fallback, and the `backup.mp4` git-ignore. Docs only; applying nginx/ufw/DNS is an owner step.
Done when: README matches shipped env names and defaults; `check:docs` passes if it covers this path.

## Task 9 — dev-security-review gate
What it is / what it means: Mandatory pre-share audit (PRD Risks threat surface, Manual steps, Acceptance last bullet, README Gate row).
What changes at a high level: Run the `dev-security-review` skill over the 05 diff, covering the PRD's ten-item threat surface: start abuse and proxy-header spoofing, spawn args and env inheritance, allowlist leakage and SSE XSS, local CDP exposure and method allowlist, `ws` plus upgrade/flood handling, process and profile cleanup, nginx/tunnel config, static path traversal, unfiltered `kane-runs/` logs, Kane cloud uploads. Fix every High and re-review as needed; record the findings artifact in the branch's docs folder.
Done when: a security-review artifact exists with no unresolved High. The link must not be shared before this.

## Task 10 — Real rehearsal through the proxy
Execution status (2026-10-24): **blocked** on owner proxy/DNS setup. No nginx or named-tunnel configuration is available; [official Quick Tunnel limitations](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#limitations) exclude SSE. Follow the [exposure runbook](../../../../tools/kane/stream/README.md#owner-deployment-nginx--cloudflare) with nginx or a separately validated named tunnel before the public paid rehearsal. No paid credits or public exposure this run.

What it is / what it means: Live validation with real credits (Acceptance: rehearsal, exposure checks).
What changes at a high level: With the owner's nginx/Cloudflare (or cloudflared) in place, perform one real Start through the public path. Verify `driver_end.outcome` matches the game result, credits spent within 03's budget, SSE and WS stay up over 120 s through the proxy, `:4173/:9222/:8787` unreachable externally, direct non-Cloudflare :80 blocked, `ss -ltnp` shows only nginx public. Record results and tune caps if needed.
Done when: rehearsal results are recorded and all exposure acceptance items pass; failures documented with the recorded-video fallback noted.

## Owner-only steps
- Set Kane portal credit/spend cap; optionally change `KANE_DAILY_CAP` / `KANE_IP_COOLDOWN_S`; top up credits.
- Keep `kane-cli login` valid; keep server env free of other secrets.
- Create the Cloudflare-proxied (orange-cloud) DNS record; pick SSL mode (Flexible works over :80, or add 443 rule + origin cert for Full).
- `apt install nginx` (1.24) and apply the README snippet; set the ufw :80 Cloudflare-IPv4-only rule (cloudflared is the fallback).
- Place a recorded winning run at `tools/kane/stream/public/backup.mp4` (git-ignored).
- Do not share the link until Task 9 passes.
