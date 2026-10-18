# Coding-Agent Prompt Template (dev-code)

One `Agent` (general-purpose or `dev-agent`) call **per task**. Default sequential (one
task → verify → next); independent sub-projects may run in parallel only with separate git
worktrees. Dispatch/commit conventions in `../_shared/dev-common.md`. The agent implements
ONE task, test-first, verifies, makes ONE commit, and **never touches `TASKS.md`** — the
orchestrator owns Status.

---

## PROMPT (per task)

```
You are implementing ONE task from an approved plan. Implement ONLY this task — do not
start other tasks, refactor unrelated code, or add scope the task doesn't specify. Do NOT
edit TASKS.md (any file named TASKS.md) — the orchestrator tracks task status, not you.

First read /root/.claude/skills/_shared/dev-common.md for the commit trailer format.

=== REQUIRED METHOD ===
- superpowers:test-driven-development — test first, watch it fail, implement the minimum
  to pass, then refactor.
- superpowers:verification-before-completion — actually RUN the tests/build and include
  the real command + output in your report. No "should work" / "looks correct" claims.

=== PROJECT & CONSTRAINTS ===
- Repo: <path>. Stack: <one line>.
- READ and OBEY the project CLAUDE.md: <path/to/CLAUDE.md>.
- Test command: <e.g. `cd backend && pytest -q` / `cd frontend && npm test`>.
- Current branch: <branch>  (commit here, inside this git worktree; do NOT switch branches
  or touch main).

=== YOUR TASK (verbatim from TASKS.md) ===
<NN-name> / Task <N> — <short name>
<paste the task's full section text: what it is, what changes at a high level, done-when>
Sibling tasks already completed (commits) so you build on them: <list>

=== GROUND YOURSELF (TASKS.md has no file list — find it yourself) ===
The PRD is authoritative design context. Read it, especially "## Architecture" and
"## Decisions", to understand the intended shape:
<repo>/docs/agent_files/<branch-slug>-<YYYYMMDD-HHMM>/<NN-name>/PRD.md

Then explore the repo yourself (Grep/Glob/Read) to find the actual files this task
touches — the task text names components/behaviors, not paths. Ground every edit in real,
currently-existing code; don't assume a file exists because the PRD implies it.

=== WHEN DONE ===
1. Ensure the working tree contains ONLY this task's changes (never TASKS.md).
2. Make EXACTLY ONE commit on the current branch:
   message: "<NN-name>: Task <N> — <short name>"
   trailer per ../_shared/dev-common.md (use the model you're actually running as).
3. Reply with: commit SHA; files changed; the exact test command + its real output; each
   done-when/acceptance criterion marked met/not-met; any deviations or new issues found
   (describe them — do NOT act on them).

If you cannot make the task pass (tests stay red, criterion unmet, blocker found): STOP,
do NOT commit broken code, and report the blocker with what you tried. Use
superpowers:systematic-debugging to investigate before giving up.
```

---

## Orchestrator checklist (main thread, per task)

- [ ] Set this task's Status to `in-progress` in `TASKS.md` before dispatch.
- [ ] Branch is a feature branch (not `main`); working tree clean before dispatch.
- [ ] Agent returned a real commit SHA; `git show --stat <sha>` matches the task's intent.
- [ ] Test output in the report is real and green (spot-check; re-run if doubtful).
- [ ] `git show <sha>` does not touch `TASKS.md` — reject/re-dispatch if it does.
- [ ] Acceptance criteria met → set Status `done`. If not → set Status `blocked`, stop the
      run, record the blocker.
- [ ] (Risky/large task) ran `code-review` on the diff; folded in material findings.
- [ ] Logged the task row for the `code-<timestamp>.md` artifact.

## Tips

- **Put completed-sibling commits in the prompt** so the agent builds on, not over, them.
- **One commit, one task, zero TASKS.md edits** — reject reports that violate any of these.
- **Stop-on-red is correct behavior**, not failure to push through.
- **Capture deviations/new issues** from each agent into the run artifact and route real
  scope changes back to the PRD via `dev-design`.
