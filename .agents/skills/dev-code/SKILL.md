---
name: dev-code
description: Use when an approved design+tasks folder exists (PRD.md + TASKS.md, e.g. from dev-design/dev-tasks) and you need to implement it — execute the tasks as code via coding sub-agents in dependency order, one commit per task, with the orchestrator (not the sub-agents) tracking each task's Status in TASKS.md, then write a run-summary artifact. Triggers include "implement this", "code this out", "build the tasks", "implement SP3 / task 5 only".
---

# dev-code — Execute PRD+TASKS into Code

## Overview

Implement a settled plan by **orchestrating coding sub-agents** — the main thread plans
order, dispatches agents, verifies their evidence, tracks each task's Status, and never
writes code itself. Core principle: **one verified commit per task, in dependency order,
built only from a settled PRD.** Since `TASKS.md` no longer carries code or file lists
(see `dev-tasks`), each coding agent grounds itself in the PRD's Architecture/Decisions
and explores the repo itself to find the actual files. Every task agent works test-first
and proves it ran the tests.

Shared dispatch/output/commit conventions live in `../_shared/dev-common.md`.

**REQUIRED SUB-SKILLS** (each task agent must use these):
- `superpowers:test-driven-development` — test first, watch fail, implement, watch pass.
- `superpowers:verification-before-completion` — run tests/build, paste evidence.
**Orchestration draws on:** `superpowers:subagent-driven-development`,
`superpowers:executing-plans`, `superpowers:dispatching-parallel-agents`,
`superpowers:using-git-worktrees`, `superpowers:systematic-debugging`,
`superpowers:finishing-a-development-branch`. Reviews via the `code-review` skill.

## When to Use

- A folder with `PRD.md` + `TASKS.md` exists and the human wants it built.
- "Implement the whole branch folder", a single sub-project, or a single task.
- **Not for:** designing/decomposing (`dev-design`) or generating tasks (`dev-tasks`); or
  any sub-project whose PRD still has `[OPEN]` items.

## Input & Scope Modes

The only required input is a **folder path**:
- **Branch folder** (`…/agent_files/<branch-slug>-<timestamp>/`) → all sub-projects, order
  from `README.md`.
- **Single sub-project folder** (`…/<NN-name>/`) → that one's tasks, in `TASKS.md` table order.
- **"only SP&lt;N&gt;" / "only task N"** → just that sub-project/task.

## Preconditions (main thread, before dispatching)

1. **Workspace guard:** apply `../_shared/dev-common.md`'s workspace guard before anything
   else — confirm you're on a non-default branch inside a linked worktree (create one if
   not), and do the rest of this run there.
2. **Read context:** project `CLAUDE.md`, `README.md` index, each target `PRD.md` (esp.
   Architecture, Decisions, Manual steps, Risks / Open Questions), and `TASKS.md`. **Read
   `TASKS.md` once and hold it** — you own it for the rest of the run; sub-agents never
   read it to make decisions, only you dispatch from it.
3. **Settled-design gate:** target `TASKS.md` missing → stop, send to `dev-tasks`. Target
   PRD's Risks / Open Questions has any `[OPEN]` item → stop, list them, route to the
   human. Do not implement unsettled design.
4. **Git safety:** working tree clean.
5. **Order:** execution order = `TASKS.md`'s tracking table (`Depends on` column) within
   each sub-project, sub-projects ordered by the README's phases/deps.
6. **Resume:** the tracking table's `Status` column is the resume source — skip tasks
   already `done`; cross-check against `git log` if anything looks stale.

## Execution Loop (everything via agents — nothing coded on the main thread)

For each task, in order (sequential by default):

1. **Mark it `in-progress`.** Main thread edits `TASKS.md`'s tracking table — only the
   Status cell for this task — before dispatching. This is bookkeeping, not code.
2. **Dispatch one coding agent** (`Agent`, general-purpose or `dev-agent`) using
   `code-agent-prompt-template.md`: repo path, the task's section text verbatim from
   `TASKS.md`, the PRD path with instruction to read its Architecture + Decisions, and the
   mandate to explore the repo itself to find the files, then implement with TDD +
   verification. **Tell it explicitly: do not edit `TASKS.md`.**
3. **The agent** implements ONLY that task, test-first, runs the tests/build, makes
   **exactly one commit** (message/trailer per `../_shared/dev-common.md`). It reports:
   commit SHA, files changed, the test command + real output, acceptance criteria met,
   deviations.
4. **Orchestrator verifies** before advancing: commit exists, tests actually passed
   (spot-check the diff/output, don't trust prose alone).
5. **Review gate (recommended for risky/large tasks):** run `code-review` or a
   `code-reviewer` agent on the diff; feed material findings back as a fix before moving on.
6. **Flip Status.** Success + criteria met → main thread sets `done`. Failure (impl
   fails, tests red, criteria unmet) → main thread sets `blocked`, **stops the run** (don't
   pile broken commits or skip ahead), diagnoses via `superpowers:systematic-debugging` or
   reports the blocker to the human, and records it in the artifact.

**Parallelism:** tasks with shared files or sequential deps stay serial. Independent
sub-projects in the same phase MAY run in parallel — each gets its own git worktree
nested under `<repo>/.worktrees/<sub-project-branch>` (`superpowers:using-git-worktrees`),
branched from the feature worktree's branch and merged back into it per sub-project (not
into main).

**Commits:** one per task by default; combine only when genuinely inseparable (say so in
the artifact). Never mix unrelated changes.

**Scope discipline:** agents implement only what the task specifies. New issues/ideas
discovered mid-task go into the artifact's follow-ups (and back to the PRD via
`dev-design`), never silent scope creep.

## Finish

1. Run the **full test suite** once more (via an agent) and capture the result.
2. **Write the artifact** `code-<YYYY-MM-DD-HHMM>.md` in the target folder. Multiple runs
   → multiple artifacts (history).
3. Offer next steps from `superpowers:finishing-a-development-branch` (merge / PR / leave).

### Artifact format (`code-<timestamp>.md`)

```
# Code Run — <date time> — <scope: all sub-projects | SP3 | SP3/Task 5>
Branch: <branch>   Base: <base>

## Tasks completed
| Sub-project | Task | Status | Commit | Files | Tests |
|---|---|---|---|---|---|
| 01-... | Task 1 — ... | done | <sha> | a.py, b.py | 12 passed |
| ...    | ...          | blocked | — | — | 1 failed (see below) |

## Deviations from the PRD/TASKS
- <task> — <what changed and why>

## Follow-ups / new issues discovered
- <issue> → <where it should go: PRD update, new task, bug>

## Still requires you (from PRD Manual steps + this run)
- <human-only step>
```

## Common Mistakes

- **Coding on the main thread.** Orchestrate only; all code is written by agents.
- **Implementing past the gate.** Missing TASKS or `[OPEN]` PRD items = stop.
- **Trusting "tests pass" without evidence.** Verify the diff + real test output.
- **Letting a coding agent edit `TASKS.md`.** Status is main-thread-only; a sub-agent
  editing it (even the description) breaks the tracking contract.
- **Barreling past a failure.** Stop, mark `blocked`, diagnose, report.
- **Giant catch-all commits.** One task per commit unless genuinely inseparable.
- **Scope creep.** Build the task; route new ideas to the artifact/PRD.
- **Committing to `main`, or working outside the feature worktree.** Apply the workspace
  guard first.
- **Skipping the artifact.** The run log is the deliverable that closes the loop.
