---
status: done
summary: PASS — operations/runtime verification and real win complete; subsequently stopped at user request
date: 2026-10-24
---
# Security Review — 2026-10-24 22:56 UTC — SP05 Task 10 operations

## Verdict: PASS

No reportable findings; no unresolved High. This is a static operations audit, not evidence that public acceptance checks or a paid rehearsal passed. It supplements [the implementation audit](security-review-2026-10-24-2230.md); that review history remains intact.

## Scope and evidence

Reviewed read-only: `/root/.config/node-arena-kane-stream/locked-driver.mjs`, `ngrok-policy.yml`, `service.env`, and `/etc/systemd/system/node-arena-kane-{stream,ngrok}.service`. Base application: merged PR #28, `8fe61961fb1cc6f3c77eded71d2a3b9b1f6507ed`; relevant lifecycle/guard/server/screencast code rechecked. Credential file contents were not read or copied. `service.env` mode verified 0600. User explicitly authorizes ngrok hosting and separately budgeted credits; primary checkout use supersedes the skill worktree convention for this deployment.

The fixed HTTPS endpoint is configured as `https://helene-unreconnoitred-overslowly.ngrok-free.dev`; startup and reachability are pending. ngrok forwards only to `http://127.0.0.1:8787`, uses `--inspect=false`, and does not rewrite Host. The request policy removes `cf-connecting-ip`, `x-forwarded-for`, `x-real-ip`, and `forwarded`, then adds `cf-connecting-ip: '${conn.client_ip}'`. With `KANE_STREAM_TRUST_PROXY=1`, the application therefore intends to trust the edge-derived address rather than client-supplied identity. This follows ngrok's documented [remove-then-add behavior](https://ngrok.com/docs/gateway/traffic-policy/actions/add-headers), [remove-headers action](https://ngrok.com/docs/gateway/traffic-policy/actions/remove-headers), and connection variable reference (`https://ngrok.com/docs/gateway/traffic-policy/variables/connection`; variable behavior still requires runtime proof).

The real-driver wrapper fixes `/usr/bin/flock -x -n -E 75 /tmp/node-arena-kane-resources.lock`, Node, and the SP03 driver path. It inherits only server-generated argv/stdout and uses `shell:false`; busy exit 75 maps to driver unavailable exit 21. This locks each real-driver command, including its descendants, rather than the idle service lifetime. Existing lifecycle cleanup verifies PID/start time/argv/PGID, tracks descendants, and validates root-owned temporary profile directories before deletion. systemd adds `KillMode=mixed` and a 45-second stop timeout. Preview 4175 and CDP 9225 (fallback 9223 only if coordinated) remain private; no firewall/nginx/PM2 changes are in scope.

## Categories examined

| Category | Review result |
|---|---|
| StringInjection | Fixed executable/driver paths, audited server argv, no shell or request-derived command. |
| BadCrypto | No new crypto implementation; HTTPS termination remains ngrok's responsibility. |
| BrokenAccessControl | Public viewer/Start remain intentional; Origin check and fixed static routes unchanged; proxy IP headers replaced at edge. |
| HardcodedCredentials | No credentials embedded in reviewed wrapper/policy/units/environment; credential file excluded. |
| SensitiveDataLeak | Only existing viewer/JPEG/allowlisted events forwarded; ngrok inspection disabled; raw logs remain private. |
| SecurityMisconfiguration | Loopback upstream, no Host rewrite, sanitized edge identity, restrictive environment-file permissions; runtime proof pending. |
| AuthenticationFailure | Public no-password viewer follows PRD; no new authentication/TLS/CORS bypass route introduced. |
| DataIntegrityFailure | No deserialization/prototype path added; existing relay and guards unchanged. |
| SSRF | Fixed loopback upstream and driver target; no request-controlled fetch target. |
| SupplyChainAttack | No new dependencies introduced by operations configuration; existing exact ws pin unchanged. |
| XPIA | No new LLM instruction/tool-routing path; existing sanitized relay and read-only CDP facade unchanged. |

The service runs as the existing root operator with existing HOME/PATH; this audit does not claim a new privilege-isolation boundary. Existing Node/Chrome/Kane credential access follows the authorized host model.

## Next step — runtime and production pending

Current environment is deliberately fake: 145-second fake duration, 3-second cooldown, 240-second wall limit. Before paid work, switch `KANE_STREAM_DRIVER` to the locked real wrapper, cooldown to 120, wall limit to 720, floor to 200 and max runs to 20. Keep `TRUST_PROXY=1`, default daily/IP/connection limits, and extra origin allowlist unset.

Record public WS/SSE survival >120 seconds, two viewers, Origin and connection-cap enforcement, mixed-case spoof-header rejection plus private upstream header proof, viewer-only route 404s, loopback listeners and owned-process cleanup. Then record separately authorized real rehearsal outcome and credit ledger. Neither these checks nor production restoration are claimed complete here; Task 10 stays in progress.

## Runtime addendum — 2026-10-24 23:09 UTC

The read-only audit above records the pre-exposure state and remains unchanged. This addendum records subsequent operator runtime evidence; it does not claim a new source-code audit. The user-authorized fixed endpoint was successfully claimed and serves the viewer. Both dedicated systemd services are active and boot enabled.

Production effective process environment was checked: real `/root/.config/node-arena-kane-stream/locked-driver.mjs`, cooldown 120 s, wall limit 720 s, floor 200, max runs 20, `KANE_STREAM_TRUST_PROXY=1`, no fake duration or extra origins; defaults daily 6, Start/IP 600 s, WS/SSE totals 100/200 and per-IP 3/3. Backend 8787, preview 4175 and CDP 9225 bound only to loopback. A tagged synthetic public request was captured privately at the loopback upstream: injected CF IP was valid and matched independently measured request egress, forged identity fields were stripped, and public Host was preserved. No captured IP value or raw packet is committed.

With differing forged CF/XFF identity values, SSE admissions were 200/200/200/429 and WS admissions 101/101/101/429. Missing/foreign Origin returned 403; driver/test-build/CDP/unknown paths returned 404. Holding the shared global lock made real public Start return generic 503 before paid spawn. Fake two-viewer WS/SSE remained up for 125.871 s; the real stream remained live for 369.527 s with 965 JPEG frames, 105 SSE chunks and no WS closure. Full captured fake/real SSE payloads passed privacy checks. Actual game, driver and public outcome all reported won. Owned preview/Chrome ports disappeared after cleanup; unrelated processes and the subsequent foreign global-lock owner were untouched.

Normal Chrome initially showed the free ngrok warning; **Visit Site** opened the viewer. The real observer wrote/asserted its successful report, then its shell session returned 143 during browser teardown; independent state, outcome, service and cleanup rechecks confirmed the recorded result. See [Task 10 deployment record](code-2026-10-24-2309.md). Earlier pending next steps are now completed; Task 10 is done.

## User-requested shutdown — 2026-10-24

After observing the working real stream, the user explicitly requested shutting down the current hosted service. Both `node-arena-kane-ngrok.service` and `node-arena-kane-stream.service` were gracefully stopped and boot-disabled. Independent checks show inactive/disabled units, no owned backend 8787, preview 4175, CDP 9225/9223 or ngrok 4040 listener, and no owned driver/Chrome/preview remaining. Unrelated SP04/global-lock processes and listeners 4173/5173 were preserved. Operator configuration remains private on disk for a later authorized restart. The prior acceptance remains PASS and Task 10 remains done; the URL is intentionally offline now.
