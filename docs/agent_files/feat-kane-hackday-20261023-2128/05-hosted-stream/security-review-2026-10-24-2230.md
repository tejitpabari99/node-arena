---
status: done
summary: PASS — 11 security categories and all 10 PRD threat surfaces examined; no reportable findings or unresolved High
date: 2026-10-24
---
# Security review — SP05 hosted stream

Diff: `3c9200c951d0f5b14bb94f855a2b3468e6a081f1...7c29106404f0a7442cc0a7498786f797c34cb1ac`.
Dedicated reviewer: read-only security specialist, final functional head including fallback correction. This is the orchestrator's synthesis of the specialist report, with implementation controls checked against actual source. The reviewer did not independently execute tests. Lightweight dev-review Security also returned PASS.

## Verdict: PASS

No confidence-qualified findings in any severity; no unresolved High. This is a source/diff assessment, not proof of deployed proxy/firewall behavior.

## Eleven-category examination

| Category | Assessed control / result |
|---|---|
| StringInjection | Fixed Node argv and no shell execution; requests cannot supply driver arguments. No finding. |
| BadCrypto | No new cryptographic protocol; public TLS termination is owner proxy configuration. No finding. |
| BrokenAccessControl | Exact static allowlist, symlink rejection, Origin/Host checks on Start and WS; read-only capture. No finding. |
| HardcodedCredentials | No credentials committed; inherited child environment is never serialized publicly. No finding. |
| SensitiveDataLeak | Recursive per-type log schemas, field value hygiene before truncation, public state projection and generic failures. No finding. |
| SecurityMisconfiguration | Viewer, preview and CDP constrained to loopback; runbook documents trusted-proxy boundary. No finding. |
| AuthenticationFailure | No-password viewer is intentional; no CORS headers; same-origin Start/upgrade validation. No finding. |
| DataIntegrityFailure | Validated primitive/nested schemas, own-property checks and immutable filtered events; identity-checked PID records. No finding. |
| SSRF | Browser discovery accepts validated loopback endpoints; clients cannot select CDP URL/port. Only known fallback is accepted. No finding. |
| SupplyChainAttack | Exact `ws` 8.22.0 pin and lock integrity; patched advisory ranges checked. No finding. |
| XPIA | Untrusted Kane/LLM text is filtered then rendered with `textContent`; viewer input never becomes instructions or CDP commands. No finding. |

## Ten PRD threat surfaces

| Surface | Evidence reviewed |
|---|---|
| 1 Start abuse and client-IP spoofing | Single-run lock, preflight/floor, quotas, cooldown; proxy headers used only with explicit trust, deploy runbook requires controlled origin access. Quotas are memory-only; portal cap remains required. |
| 2 Child process arguments/environment | Fixed executable/argv, detached ownership, server-inherited environment; no request-to-spawn path. |
| 3 Relay leakage / SSE XSS | Default-deny recursive allowlist, unknown types dropped, forbidden value detection, JSON SSE framing, text-only DOM and CSP. |
| 4 Local CDP / method access | Loopback, page-target validation and five-method read-only facade; independent session does not detach driver. |
| 5 WS dependency / upgrades / slow clients | Exact patched dependency, Origin checks, `maxPayload: 1`, compression disabled, connection caps and bounded buffer/backpressure cleanup. |
| 6 Process/profile cleanup | PID/start-time/group/command identity, owned descendant tracking including PID-less fallback, bounded teardown, validated temporary-profile deletion. |
| 7 Proxy/tunnel configuration | Fixed upstream headers, Cloudflare-only origin firewall guidance, WS upgrade/SSE no-buffering and heartbeat runbook. Deployment remains unverified. |
| 8 Static traversal | Fixed route-to-file mapping; no directory serving or client path interpolation; refuses symlinks. |
| 9 Raw local logs | Raw NDJSON stays under ignored local `kane-runs/`; static routes cannot serve it. At-rest local storage itself is outside specialist findings scope. |
| 10 Kane cloud uploads | Existing driver/provider behavior retained; screenshot uploads remain the previously accepted boundary. |

Abuse/resource controls above are documented PRD coverage; the dedicated taxonomy excludes standalone DoS/rate-limiting findings. They do not constitute a durable spending guarantee.

## Dependency evidence

Pinned [ws 8.22.0 release](https://github.com/websockets/ws/releases/tag/8.22.0). [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) memory disclosure is patched in 8.20.1; [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) fragmented-message memory exhaustion is patched in 8.21.0. The exact pin exceeds both patched thresholds. Advisory checks do not assert absence of every future vulnerability.

## Next step

Audit gate passes. Owner proxy/DNS, portal cap and public paid Task 10 rehearsal remain outstanding. Quick Tunnel is unsuitable for complete logs because [official documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#limitations) excludes SSE. No public exposure or paid credits occurred during this implementation run.
