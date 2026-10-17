# Phase 0-1 — Clarify & Plan

## When to ask a clarifying question

Ask only if you genuinely cannot scope the work without an answer: unresolved
acronyms/jargon, an ambiguous subject ("which X — the company or the OSS project?"), or a
scope-defining choice you can't reasonably infer (breadth vs. one narrow angle, which
repo/codebase, time-bound vs. not). If the request is already concrete, skip straight to
drafting a plan — do not ask a question just to seem thorough.

At most one round of questions. If you already asked once earlier in this conversation
about the same research task, don't ask again — proceed with your best interpretation and
say so.

Use `AskUserQuestion` for concrete choices (scope, depth, audience, output shape). Use a
plain follow-up message instead when the gap is open-ended in a way multiple-choice can't
capture (e.g. "what's the actual question you're trying to answer here").

## Drafting the plan

A plan is a short list of independent research directions. Independent means each could
run without needing another direction's output first — that's what makes them
parallelizable.

Guidance on count:

| Scope | Directions |
|---|---|
| Narrow/simple question | 1-2 |
| Standard comparative or multi-part question | 3-4 |
| Exhaustive/broad topic | 5-6 (run in waves of 2) |

For each direction, state in 1-2 lines:

- What it covers — a genuinely distinct angle, not a rephrasing of another direction.
- Where it'll likely look (web, a specific repo/path, docs, APIs, issue trackers, internal
  files, etc.) — enough to write the sub-agent prompt later, not an exhaustive source
  list.

Also decide, and state to the user:

- **Output shape** — a chat answer, or a saved file. Ask if it's unclear from context;
  default to a chat answer for anything that isn't clearly meant to be a persistent
  document.
- **Depth** — overview (fast, few sources per direction), standard, or exhaustive (many
  sources, cross-checked, higher tool-call budget per agent).

## Getting confirmation

Present the plan as plain text (directions + output shape + depth), then confirm with
`AskUserQuestion`: one question, options "Proceed as planned" and "Let me adjust it" (the
tool auto-adds a free-text option for actual edits). Do not launch any agent before an
explicit "proceed."

If the user adjusts scope, redraft and reconfirm before moving to Phase 2.
