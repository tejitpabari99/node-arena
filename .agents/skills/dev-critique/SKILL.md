---
name: dev-critique
description: Use to get an independent "rubber duck" second opinion — a devil's-advocate critique of a plan, design, proposal, in-progress implementation, or test suite. Best used early and often — right after planning and before implementing, and again on partial progress — so course corrections stay cheap. Spawns one critic agent that categorizes feedback into Blocking / Non-Blocking / Suggestions. Not a diff-only reviewer (see dev-review for that): works on ideas and partial work, not just finished code.
---

# dev-critique — Devil's-Advocate Second Opinion

## Overview

An outside, unbiased skeptic's pass over whatever the current state of work is — a plan, a
PRD, a partial implementation, a test suite, a proposal. Core principle: **call it early,
call it often, keep it cheap** — one critic agent, no verdict gate, no mandatory artifact.
It exists to catch problems the author is too close to see, while they're still cheap to
fix. No code changes — the critic never edits, it only reports.

Shared dispatch/output conventions (cold-agent pattern, Sonnet 5.5/medium-effort sub-agents, frontmatter spec,
"never comment on" list) live in `../_shared/dev-common.md`.

This is not `dev-review`. `dev-review` is a post-implementation, verdict-gated check
against a finished diff before it lands (bugs/security/architecture-fit, PASS/
NEEDS_CHANGES/BLOCK). `dev-critique` is a second opinion usable at any stage — including
before there's a diff at all — that categorizes feedback by how much it should change your
plan (Blocking/Non-Blocking/Suggestions) rather than gating landing.

## When to Use

- Right after planning, before implementing — the highest-leverage moment, since a
  Blocking finding here costs a plan revision, not a rewrite.
- On partial progress, to course-correct before finishing something built on a bad
  premise.
- For any non-trivial task where a second opinion is cheap insurance: proposals, PRDs,
  designs, in-progress code, tests.
- **Not for:** a final pre-land check on a finished diff (use `dev-review` — it's
  verdict-gated and covers bugs/security/architecture in one pass); re-running after every
  trivial edit (defeats the "cheap" part — use it at real decision points).

## Workflow

1. **Workspace guard.** Apply `../_shared/dev-common.md`'s workspace guard before anything
   else — run in the worktree of the branch whose work is being critiqued (non-default
   branch, linked worktree; create one if not).
2. **Gather the work to critique.** Whatever form it's in:
   - Plan/proposal/PRD → the plan text or file itself.
   - Partial or finished implementation → `git --no-pager diff` (staged/unstaged) or
     `git --no-pager diff main...HEAD`, plus the relevant surrounding files for context.
   - Tests → the test files plus what they're meant to cover.
3. **Spawn 1 `Agent` call** (`general-purpose`), using
   `critique-agent-prompt-template.md`. Cold agent — give it the full work product, not a
   summary, plus what the work is trying to accomplish. It may not edit files or spawn
   further agents.
4. **Report directly to the human/orchestrating agent** — Blocking Issues, Non-Blocking
   Issues, Suggestions, in that order. If there are no Blocking issues, say so explicitly
   ("no blocking issues, safe to proceed") rather than leaving it ambiguous.
5. **Act on Blocking issues before continuing** the work being critiqued. Non-Blocking and
   Suggestions are the acting agent's call — note them, don't force a detour.
6. **No mandatory artifact.** This is meant to be lightweight and conversational. Only
   write a findings file if the human is tracking critique history across iterations
   (e.g. repeated rounds during `dev-design`'s PRD iteration) — in that case, write
   `critique-<YYYY-MM-DD-HHMM>.md` into the branch folder (find/create it per
   `../_shared/dev-common.md`): sibling to `PRD.md`/`TASKS.md` if critiquing a
   sub-project, otherwise at that folder's root. Frontmatter per `../_shared/dev-common.md`
   (`status: done`, `summary:` the bucket counts).

## Verdict — not a gate, a triage

Unlike `dev-review`, there's no PASS/BLOCK computed by this skill. The critic returns three
buckets and the acting agent decides what to do:

| Bucket | Meaning | What happens next |
|---|---|---|
| Blocking | Must address for the work to succeed | Fix/revise before continuing |
| Non-Blocking | Should fix to improve quality, won't prevent success | Fix if cheap, else track it |
| Suggestions | Nice-to-have, not critical | Take or leave it |

## Output (when reporting inline)

```
## Critique — <what was reviewed>

### Blocking Issues
- <issue> — <impact> — <recommended fix>
(state explicitly if none: "No blocking issues — looks solid.")

### Non-Blocking Issues
- <issue> — <impact> — <recommended fix>

### Suggestions
- <suggestion>
```

## Common Mistakes

- Waiting until the implementation is fully done to call this — defeats the point; the
  whole value is catching bad premises while they're still cheap to change.
- Treating Suggestions as mandatory — only Blocking issues should stop forward progress.
- Using it as a substitute for `dev-review` before landing — it doesn't gate, and doesn't
  run the 3-persona bug/security/architecture pass `dev-review` does.
- Asking for critique without stating the goal — "what is this trying to accomplish" is
  required context; without it the critic can only nitpick surface details.
