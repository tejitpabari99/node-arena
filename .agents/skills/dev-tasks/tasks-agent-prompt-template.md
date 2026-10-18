# Tasks-Authoring-Agent Prompt Template (dev-tasks)

One `Agent` (general-purpose) call per **settled** PRD (no `[OPEN]` items). Dispatch rules
(parallel, cold agents, sub-agent model) are in `../_shared/dev-common.md`. **These agents
write `TASKS.md` only** — no source code, no PRD edits.

---

## PROMPT (per PRD)

```
You are deriving TASKS.md for ONE sub-project, projected from its already-approved PRD.
This is a HIGH-LEVEL DEV SPEC, not an implementation plan — no code, no exhaustive file
lists. PLANNING ONLY: READ any file; do NOT modify source code, the PRD, or anything
except the single TASKS.md named at the end.

First read /root/.claude/skills/_shared/dev-common.md — it has the frontmatter format and
output path grammar this task follows.

=== SOURCE OF TRUTH ===
Read this PRD in full and treat it as authoritative:
<repo>/docs/agent_files/<branch-slug>-<YYYYMMDD-HHMM>/<NN-kebab-name>/PRD.md
Pay special attention to "## Architecture", "## Decisions", and "## Risks / Open
Questions". Every [RESOLVED: …] item is binding. If you find any [OPEN] item, STOP and
report it instead of writing tasks (do not invent an answer).

=== CONTEXT ===
- Repo / stack: <one line>
- Sibling sub-projects & dependencies (reference only; don't do their work): <list>

=== LENGTH ===
Aim for roughly 60–150 words per task — a soft target; going over is fine when a task
needs it. Do NOT count words or edit afterwards to cut length. No code blocks, no
file-by-file listing — state what changes at the level of components/areas/behaviors;
the coding agent finds the exact files itself later, grounded in the PRD.

=== HOUSE FORMAT ===
---
status: draft
summary: <one line>
date: <YYYY-MM-DD>
---
# Tasks: <title>
Source of truth: <PRD path>. <1–3 sentences.>

| # | Task | Depends on | Status |
|---|---|---|---|

## Task N — <short name>
What it is / what it means: ...
What changes at a high level: ...
Done when: ...

Rules:
- Order tasks by dependency; the table's Depends on column reflects the same order.
- Trace every task to a PRD Decision. Do not add scope the PRD doesn't decide.
- Every new task's Status is `todo`. Never write `in-progress`/`done`/`blocked` — that's
  set later, only by the dev-code orchestrator.
- Surface human-only steps from the PRD's Manual steps section in a closing note if the
  house format's example TASKS.md includes one; otherwise they stay in the PRD.

=== RECONCILE IF TASKS ALREADY EXIST ===
If TASKS.md already exists at the target path, do NOT blind-overwrite. Diff it against the
current PRD: add new tasks, update the description of tasks whose underlying decision
changed, remove tasks the PRD no longer supports, leave unaffected tasks intact. **Preserve
the exact Status value of every task that still exists** (todo/in-progress/done/blocked) —
you may change its description text but never its Status, even for a task you're
otherwise rewriting. In your reply, give a short changelog: Added / Changed / Removed /
Status-preserved-count.

=== DELIVERABLE (create/update exactly this one file) ===
<repo>/docs/agent_files/<branch-slug>-<YYYYMMDD-HHMM>/<NN-kebab-name>/TASKS.md

When done, reply with a 4–8 line summary: task count, the changelog (or "fresh authoring"
if new), any blocking [OPEN] items found, confirmation TASKS.md was written.
```

---

## Tips

- **PRD is binding; tasks are derived.** The agent must not re-open design decisions.
- **Block on `[OPEN]`.** A stopped agent reporting an open question is correct behavior.
- **Status is sacred on reconcile** — it's the one field this skill never regenerates;
  losing it silently reverts the orchestrator's progress tracking.
- **Point at a real example TASKS.md** so format matches the repo, but note the new
  no-code/no-file-list rule overrides any older example's style.
