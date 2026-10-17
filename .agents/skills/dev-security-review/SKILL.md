---
name: dev-security-review
description: Use for a deep, dedicated security audit of a diff — heavier than dev-review's lightweight Security persona. Spawns one specialized security agent that checks 11 vulnerability categories (injection, crypto, access control, hardcoded creds, data leaks, misconfig, auth failures, data integrity, SSRF, supply chain, XPIA) with severity/confidence scoring to minimize false positives. Best for security-sensitive diffs — auth, crypto, secrets, user input handling, external fetches, new dependencies. Writes one findings artifact and reports a verdict.
---

# dev-security-review — Deep Security Audit

## Overview

A dedicated, single-agent security pass over a diff. Core principle: **one specialist, a
fixed taxonomy, confidence-gated reporting** — not a general review, and not a second
`dev-review` run. `dev-review`'s Security persona is a lightweight generalist check meant
to catch obvious problems alongside correctness and architecture; `dev-security-review` is
the deep dive for changes where security actually is the risk. No code changes, no state
files — read the diff, write one findings file, hand back a verdict.

Shared dispatch/output conventions (cold-agent pattern, Sonnet 5.5/medium-effort sub-agents, frontmatter spec,
confidence framing) live in `../_shared/dev-common.md`.

**Bar for feedback: high-confidence, high-impact only.** Confidence and severity are
scored explicitly (see below) and gate what gets reported — theoretical issues, DoS,
rate-limiting, and secrets-at-rest concerns are out of scope by design (see Exclusions).

## When to Use

- The diff touches authentication, authorization, cryptography, secrets/credentials, raw
  user input reaching a query/command/template/URL, deserialization, or a new/updated
  third-party dependency or CI/build config.
- A human explicitly asks for a security review, or `dev-review`'s Security persona flags
  something that warrants a deeper look than a generalist pass gives.
- **Not for:** routine diffs with no security-relevant surface (use `dev-review` instead —
  running both on every diff is redundant cost for no signal); reviewing a PRD before code
  exists; fixing issues found here (route back to `dev-code`).

## Workflow

1. **Workspace guard.** Apply `../_shared/dev-common.md`'s workspace guard before anything
   else — run in the worktree of the branch under review (non-default branch, linked
   worktree; create one if not).
2. **Locate inputs.** Diff = `git --no-pager status`, then `git --no-pager diff --staged`
   or `git --no-pager diff` if there are pending changes, else
   `git --no-pager diff main...HEAD` (adjust base branch as needed) if the tree is clean.
3. **Gather repo security context.** Skim for existing security frameworks/libraries,
   established sanitization/validation patterns, and the project's `CLAUDE.md` — the
   agent needs this to judge deviations from established secure patterns, not just the
   diff in isolation.
4. **Spawn 1 `Agent` call** (`general-purpose`), using
   `security-review-agent-prompt-template.md`. Cold agent — give it the full diff, repo
   context gathered above, and the category taxonomy. It may not edit files or spawn
   further agents.
5. **Filter by threshold** (belt-and-suspenders — the agent is instructed to self-filter,
   but check its output): drop anything below the confidence floor for its severity (see
   Severity & Confidence below). If a reported finding doesn't meet its floor, cut it.
6. **Write one artifact**: `security-review-<YYYY-MM-DD-HHMM>.md` in the branch folder
   (find/create it per `../_shared/dev-common.md`) — the sub-project folder, sibling to
   `PRD.md`/`TASKS.md`, if this diff belongs to one; otherwise the branch folder's root.
   Multiple runs → multiple timestamped files.
7. **Report** verdict and findings — don't just leave the file sitting there.

## Categories examined

Injection (`StringInjection`) · weak crypto (`BadCrypto`) · path traversal / CSRF / open
redirect (`BrokenAccessControl`) · secrets in source (`HardcodedCredentials`) · cleartext
sensitive data in transit/logs (`SensitiveDataLeak`) · unsafe defaults/config
(`SecurityMisconfiguration`) · weak auth/TLS/CORS (`AuthenticationFailure`) · unsafe
deserialization/prototype pollution (`DataIntegrityFailure`) · attacker-controlled fetch
targets (`SSRF`) · mutable/unverified third-party deps (`SupplyChainAttack`) · untrusted
data reaching LLM instructions/tool routing/planning (`XPIA`). Full issue/non-issue
definitions per category live in the prompt template — the orchestrator doesn't need to
memorize them, just knows the taxonomy exists so it can sanity-check the agent's output.

## Exclusions (never report)

Denial of Service / resource exhaustion, rate-limiting or performance issues, secrets
stored on disk (as opposed to leaked in logs/transit), theoretical attacks with no clear
exploitation path, style/maintainability concerns, test-code issues that don't indicate a
production vulnerability, missing input validation on non-security-critical fields.

## Severity & Confidence

| Severity | Meaning | Report at confidence ≥ |
|---|---|---|
| CRITICAL | RCE, full system compromise, data breach | 6/10 |
| HIGH | Privilege escalation, auth bypass, sensitive data access | 7/10 |
| MEDIUM | Info disclosure, limited data access | 8/10 |
| LOW | Security control bypass, config issue | 9/10 |

Confidence scale: 9–10 clear vulnerability, obvious exploit path. 8–9 high confidence,
well-understood attack vector. 7–8 likely, needs specific conditions. 6–7 potential, needs
further investigation. Below 6 → don't report.

## Verdict rules

1. Any CRITICAL or HIGH severity finding (at its confidence floor) → **BLOCK**.
2. Otherwise, any MEDIUM finding → **NEEDS_CHANGES**.
3. Only LOW findings, or none at all → **PASS**.

## Output

`security-review-<timestamp>.md` (frontmatter per `../_shared/dev-common.md`):

```
---
status: done
summary: <verdict — e.g. "BLOCK — 1 HIGH finding">
date: <YYYY-MM-DD>
---
# Security Review — <date time> — <scope: task/sub-project name>
Diff: <base>...<head>

## Verdict: PASS | NEEDS_CHANGES | BLOCK

## Findings
### Alert 1
**File:** path/to/file.ts:42
**Category:** StringInjection
**Severity: HIGH | Confidence: 9/10**
**Problem:** ...
**Evidence:** ...
**Suggested fix:** ...
...
(omit this section entirely if empty — say so explicitly instead)

## Next step
<see routing below>
```

## Next step routing

- **PASS** → proceed to land / hand back to the human, or on to `dev-review` if that
  hasn't run yet.
- **NEEDS_CHANGES** → back to `dev-code` with the findings as its next task; re-run
  `dev-security-review` on the follow-up diff.
- **BLOCK** → do not land. Back to `dev-code` for an immediate fix, or to `dev-design` if
  the finding reveals the PRD's approach itself is unsafe (record as an Open Question).

## Common Mistakes

- Running this on every diff regardless of security surface — that's what `dev-review`'s
  Security persona is for; reserve this for diffs that actually touch sensitive surface.
- Reporting DoS, rate-limiting, or theoretical issues — explicitly excluded, not just
  low-priority.
- Reporting a finding below its severity's confidence floor "just in case" — that's the
  false-positive noise this skill exists to avoid.
- Skipping repo context gathering — a finding that ignores an existing sanitization
  pattern the codebase already uses reads as a false positive, not a review.
