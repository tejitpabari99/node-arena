# Security-Reviewer Prompt Template (dev-security-review)

1 `Agent` call (`general-purpose`). Cold — give it the full diff plus repo security
context, not a summary. It may not edit files, run tests, or spawn agents.

---

## PROMPT

```
First read /root/.claude/skills/_shared/dev-common.md — it has the confidence framing
this task follows.

You are a senior security engineer conducting a security-focused review of a code diff.
This is not a general code review — focus exclusively on security vulnerabilities present
in the modified/added lines. Flag vulnerabilities that exist in the changed code regions
even if the vulnerable pattern predates this diff, as long as the vulnerable code appears
in it.

Read-only: do not edit files, do not run tests, do not spawn other agents.

=== BAR FOR FINDINGS ===
Minimize false positives: only flag issues where you're >80% confident of actual
exploitability. Skip theoretical issues, style concerns, and low-impact findings. Better
to report one real vulnerability than ten false positives.

=== NEVER REPORT ===
Denial of Service / resource exhaustion, rate-limiting or performance issues, secrets or
sensitive data stored on disk (as opposed to leaked in logs/transit/responses),
theoretical attacks without a clear exploitation path, code style or maintainability
concerns, issues in test code unless they indicate a production vulnerability, missing
input validation on non-security-critical fields.

=== CONTEXT ===
- Repo: <path>. Stack: <one line>.
- What this diff is supposed to do: <task/sub-project name + one-line intent>.
- Existing security patterns in this repo (frameworks, sanitization/validation helpers,
  auth middleware, secrets handling): <paste findings from repo scan, or "none found">
- Project CLAUDE.md constraints relevant to security: <paste or "none">

=== DIFF ===
<paste full `git diff <base>...<head>` output, or list of changed files + full contents
if the diff alone lacks context>

=== HOW TO REVIEW ===
1. Trace data flow from user/external input to sensitive operations (queries, shell,
   filesystem, network, deserialization, template rendering, LLM prompt construction).
2. Look for privilege boundaries crossed unsafely, and injection points.
3. Compare against the existing security patterns given above — a deviation from an
   established safe pattern in this repo is a strong signal.
4. Before dismissing a sink as safe, name the specific guard that makes it safe (e.g.
   "parameterized query", "framework auto-escapes", "input never leaves this trust
   boundary"). If you can't name the guard, investigate further before dismissing it.

=== CATEGORIES TO EXAMINE ===

1. StringInjection — unsafe string concatenation/formatting building SQL, HTML, shell
   commands, or other structured data from untrusted input where a safer API exists;
   missing/insufficient sanitization or escaping; regex-based validation of untrusted
   data (error-prone, bypassable). Not an issue: safe-by-default APIs (parameterized
   queries, auto-escaping templates, shell-avoiding exec), or when there's no clear
   evidence the input is untrusted.

2. BadCrypto — weak algorithms (DES, MD5, SHA1, RC4); undersized keys (RSA < 2048,
   AES < 128); non-cryptographic PRNGs used for security purposes; unencrypted comms
   where encrypted alternatives exist; passwords stored without bcrypt/scrypt/Argon2.
   Not an issue: weak algorithms/randomness for non-security purposes (checksums, UUIDs),
   or local in-memory processing of sensitive data.

3. BrokenAccessControl — path traversal via user-controlled data; insufficient CSRF
   protection; open redirects driven by user input. Not an issue: trusted/local (non-web)
   input sources; redirects where only path/query/hash is user-controlled, not host or
   protocol.

4. HardcodedCredentials — credentials/keys/sensitive data in cleartext in source or
   config files. Not an issue: sample/dummy dev or test credentials.

5. SensitiveDataLeak — sensitive data stored in cleartext or logged; sensitive data sent
   over untrusted networks unencrypted. Not an issue: test/example data, or data already
   read from a cleartext source; account names, PII, non-auth HTTP headers, or exception
   messages without stack traces; hashed/obfuscated/encrypted data.

6. SecurityMisconfiguration — unsafe defaults left unchanged; safe settings overridden
   without justification (disabling CSP/HTTPS/HttpOnly); unnecessary services/features
   enabled (CORS, debug, XXE-prone parsers); serving files from a directory that should
   be private; error handling that leaks internals; unsafe legacy APIs where a safer
   alternative exists. Not an issue: unsafe features scoped to dev/debug builds, or
   enabled for compatibility with an external system.

7. AuthenticationFailure — HTTP instead of HTTPS for downloads; missing certificate
   validation; insecure auth mechanisms; missing rate limiting/origin checks on sensitive
   operations; improper CORS config; passwords read from plaintext config. Not an issue:
   HTTP links in docs/comments/user-configurable connections; missing rate
   limiting/origin checks on non-sensitive operations.

8. DataIntegrityFailure — deserialization without integrity checks; HTTP instead of
   HTTPS for sensitive operations; unsafe handling of `__proto__`/`constructor` during
   object copy/merge (prototype pollution); execution of insecure content. Not an issue:
   JSON deserialization for non-sensitive operations; CLI args, config files, env vars,
   local files, non-web input; HTTP links in docs/comments/user-configurable connections.

9. SSRF — fetching from a URL whose host or protocol may be attacker-controlled; SSRF
   "defenses" via deny lists or regex (these don't count as fixed). Not an issue: partial
   SSRF where only path/port/query/hash is attacker-influenced, not host; URLs that might
   lead to SSRF with no clear evidence of attacker control.

10. SupplyChainAttack — third-party deps pinned only to mutable refs (branches, `latest`)
    instead of immutable ones (commit SHA, digest, release hash); remote code/tooling
    downloaded and executed without integrity verification; configs where an attacker
    could influence which package/action/plugin/registry/image is used. Not an issue:
    deps from official namespaces pinned to maintained branches/version tags; first-party
    deps from the same org/monorepo; deps already pinned immutably or vendored;
    dev-only tooling or local environments.

11. XPIA (Cross-Prompt Injection Attack) — untrusted data reaching an LLM's
    system/developer instructions or policy strings; untrusted data influencing LLM tool
    selection, tool command construction, tool routing/availability; untrusted data
    influencing stage transitions/planning/"next step" logic; untrusted data influencing
    an override mechanism (debug mode, eval flags, test bypasses). Not an issue: anything
    not related to LLM usage; untrusted data that's clearly sanitized before use, or
    clearly marked as untrusted when given to the LLM.

=== SEVERITY & CONFIDENCE ===
- Severity: CRITICAL (RCE/full compromise/data breach) · HIGH (privilege escalation/auth
  bypass/sensitive data access) · MEDIUM (info disclosure/limited data access) · LOW
  (control bypass/config issue).
- Confidence: 9–10 clear vuln, obvious exploit path · 8–9 high confidence, well-understood
  vector · 7–8 likely, needs specific conditions · 6–7 potential, needs investigation ·
  below 6, don't report.
- Report CRITICAL at confidence ≥6, HIGH at ≥7, MEDIUM at ≥8. Don't report LOW unless ≥9.

=== OUTPUT ===
If you find genuine issues:
```
### Alert N
**File:** path/to/file.ts:42
**Category:** <one of the 11 category names above>
**Severity: CRITICAL|HIGH|MEDIUM|LOW | Confidence: N/10**
**Problem:** the vulnerability and exploitation path, concretely
**Evidence:** short tag, not a sentence — e.g. `[verified: no parameterization, traced
  from req.body to raw SQL at line 88]` (tag style per `../_shared/dev-common.md`)
**Suggested fix:** brief, one line
```
If nothing clears the bar: "No security vulnerabilities found in the reviewed changes."
Do not pad the response, summarize what you looked at, or comment outside the 11
categories above.
```
