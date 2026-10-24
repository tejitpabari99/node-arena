# Hosted stream foundation

Private Node Arena live-view service. `pnpm kane:stream` is registered for
`server.mjs`; the HTTP server, driver lifecycle, relay, screencast and static viewer
are subsequent tasks. This foundation does not start a listener or spend credits.

Run the pure guard tests from the repository root:

```sh
node --test tools/kane/stream/test
```

`test/index.js` is the Node 22 directory entry. Add imports there for later test
modules so the directory command includes them.

## Guard integration

`guards.mjs` uses only `node:net`; it never reads environment variables or the clock.
Pass `readGuardConfig(process.env)` once from the eventual server. State transitions
return new state without changing the supplied Maps. Treat returned state as owned
by the server and assign it synchronously before any asynchronous work.

- `clientIp(request, config)` reads the socket IP, canonicalizes IPv6 and IPv4-mapped
  addresses, and supplies the IP key for **both** admission APIs. Missing/invalid
  addresses share the key `unknown`. With explicit proxy trust, a valid
  `CF-Connecting-IP` takes precedence, then the first `X-Forwarded-For` hop. A malformed
  preferred header falls back to the socket. Proxy trust assumes a controlled
  loopback proxy that overwrites forwarding headers; do not expose the Node listener.
- `checkOrigin(request, config)` returns a boolean. Apply to Start and WS upgrades.
  Both Host and a valid HTTP(S) Origin are required. Canonical hostname and port
  must match, or the full origin must be explicitly allowed. Forwarded Host is ignored.
  An explicitly allowed cross-origin caller may have `Sec-Fetch-Site: cross-site`.
- `createStartState()` creates `{day, starts, lastStarts: Map<ip, nowMs>}`.
  `checkStart(state, ip, nowMs, config)` is a dry check. `admitStart(...)` checks and
  consumes one admission, returning `{allowed, state}`. Denials also contain
  `{status: 429, reason, retryAfterSeconds}` and return the original state. Days use
  UTC midnight; IP cooldowns survive midnight. Expired IP entries are pruned on
  each admission, and rejected requests add no IP entries. Assign accepted state
  only when committing an actual start; the lifecycle must separately hold its
  single-run lock across asynchronous credit preflight.
- `createConnectionState()` creates `{ws: Map<id, ip>, sse: Map<id, ip>}`.
  `admitConnection(state, {kind, ip, id}, config)` reserves a unique identity and
  returns `{allowed, state}` or `{allowed: false, status: 429, reason, state}`.
  Caps are separate for each transport. `releaseConnection(state, kind, id)`
  returns the updated state and is idempotent. Release on close, aborted upgrade
  and setup failure so reservations cannot leak. Never reuse an active identity.

## Guard configuration

Invalid numeric settings fail startup; zero caps deliberately deny all admissions.
Limits accept non-negative safe integers, with cooldown seconds converted to ms.

| Environment variable | Default | Meaning |
|---|---|---|
| `KANE_IP_COOLDOWN_S` | `600` | Minimum time between Starts from one IP |
| `KANE_DAILY_CAP` | `6` | Starts per UTC day, across all IPs |
| `KANE_STREAM_MAX_WS` | `100` | Total live WS connections |
| `KANE_STREAM_MAX_SSE` | `200` | Total live SSE connections |
| `KANE_STREAM_MAX_WS_PER_IP` | `3` | WS connections per IP |
| `KANE_STREAM_MAX_SSE_PER_IP` | `3` | SSE connections per IP |
| `KANE_STREAM_TRUST_PROXY` | unset | Only literal `1` enables forwarded IP headers |
| `KANE_STREAM_ORIGINS` | unset | Comma-separated exact HTTP(S) origins, no paths |

Start counters and connections are in memory; restarting loses quota history.
Single-run cooldown, credit floor, request byte/time limits and response security
headers belong to the lifecycle/server tasks.

## Dependency

The only added third-party dependency is exact-pinned `ws@8.22.0` in
`tools/package.json`. It provides the WS server missing from Node 22's native client.
The version was checked against the [upstream release](https://github.com/websockets/ws/releases/tag/8.22.0)
and current upstream advisories for [fragment/chunk memory exhaustion](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p)
and [uninitialized memory disclosure](https://github.com/websockets/ws/security/advisories/GHSA-58qx-3vcg-4xpx).
Later server wiring must use the PRD's `noServer` and `maxPayload: 1` settings.
