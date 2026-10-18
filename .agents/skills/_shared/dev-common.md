# dev-* shared conventions

Referenced by the `dev-*` pipeline skills (design, tasks, code, review, critique,
security-review) instead of each restating it. Not a skill itself (no `SKILL.md` here).

## Dispatching sub-agents

- Every dispatched agent is **cold** — it has no memory of this conversation. Give it
  everything it needs inline: paths, decisions, exact deliverable, house format/example to
  read. Point at a real example file rather than describing a format abstractly.
- One `Agent` call (`general-purpose`) per unit of work (sub-project / PRD / task /
  persona). Independent units dispatch in **one message** so they run in parallel.
- **Sub-agent model: Sonnet 5.5 (`model: sonnet`), medium reasoning effort.** Never dispatch a sub-agent on a smaller model.
- A cold agent may not spawn further agents unless its calling skill explicitly says so.

## Commit convention (dev-code and any skill that commits)

One commit per unit of work. Message: `"<NN-name>: Task N — <short name>"`, body as
needed, ending with:
```
Co-Authored-By: <model name> <noreply@anthropic.com>
```
Use the actual model the committing agent is running as (e.g. `Claude Sonnet 5`) — don't
hardcode a stale version. Never combine unrelated changes into one commit.

## Workspace guard (every skill runs this first — before reading/writing anything else)

Confirm both, in the target repo:
1. **Not on a default branch:** `git rev-parse --abbrev-ref HEAD` is not `main`/`master`/
   the repo's actual default branch.
2. **Inside a linked worktree, not the primary checkout:**
   `git rev-parse --git-dir` differs from `git rev-parse --git-common-dir`.

If either check fails, fix it before doing anything else:
```
branch=<descriptive kebab-case name for the work, e.g. feat/<topic>>
git worktree add ".worktrees/$branch" -b "$branch"     # base = current HEAD
grep -qxF '.worktrees/' .gitignore || printf '.worktrees/\n' >> .gitignore
# if .gitignore changed: git add .gitignore && git commit -m "chore: ignore .worktrees/" \
#   (on the new branch, per the commit convention below)
```
If already on a non-default branch in the primary checkout, base the new branch off it
instead of HEAD-of-default, and tell the human you moved the work into a worktree.

Do all further work — reads, writes, sub-agent dispatch — inside that worktree from then
on. Never commit to main. Read-only skills (`dev-review`, `dev-critique`,
`dev-security-review`) apply this guard too — they still write artifacts, and should run
in the worktree of the branch under review, not the primary checkout.

## Output convention — one folder per branch

Every file any pipeline skill writes goes under one folder, created once per branch:
```
<repo>/docs/agent_files/<branch-slug>-<YYYYMMDD-HHMM>/
```
`<branch-slug>` = the current branch name with `/` replaced by `-`. The timestamp is set
when the folder is first created and never changes on later runs.

**Find before creating:** `ls -d docs/agent_files/<branch-slug>-* 2>/dev/null` — if one or
more already exist for this branch, reuse the newest; never create a second folder for the
same branch.

Layout inside it:
```
docs/agent_files/<branch-slug>-<YYYYMMDD-HHMM>/
  README.md                          # index, written/updated last
  brainstorm.md                      # brainstorm brief (skill: brainstorm), if any
  critique-<YYYY-MM-DD-HHMM>.md      # critique of the whole-branch work, if not a sub-project
  <NN-kebab-name>/                   # one folder per sub-project
    PRD.md
    TASKS.md
    code-<YYYY-MM-DD-HHMM>.md
    review-<YYYY-MM-DD-HHMM>.md
    security-review-<YYYY-MM-DD-HHMM>.md
    critique-<YYYY-MM-DD-HHMM>.md
```
`<FILE>` for a sub-project is `PRD`, `TASKS`, or a timestamped artifact (`code-<timestamp>.md`,
`review-<timestamp>.md`, `security-review-<timestamp>.md`, `critique-<timestamp>.md`).

No other location: never write to `docs/brainstorms/`, a `tasks/<YYYY-MM-DD>/` folder, "the
repo's local convention", the repo root, or a scratch fallback.

## Frontmatter (every generated pipeline doc)

Every generated PRD.md / TASKS.md / brainstorm brief / review / critique / security-review
artifact opens with:
```yaml
---
status: draft | approved | in-progress | done
summary: <one line>
date: <YYYY-MM-DD>
---
```
For a point-in-time report (review, critique, security-review), `status` is `done` once
written and `summary` is the one-line verdict (e.g. `NEEDS_CHANGES — 2 must-fix`,
`Blocking: 1, Non-Blocking: 2`) rather than a design-doc gist.

## Feedback bar — "never comment on" list

Reviewer/critic personas (dev-review, dev-critique, dev-security-review, and any future
persona-style skill) never report: style, formatting, or naming conventions;
grammar/spelling; "consider doing X" suggestions that aren't bugs; minor refactors that
don't affect correctness/design; missing docs/comments that don't cause real
misunderstanding; general "best practices" with no concrete harm named.

## Confidence framing — "silence is better than noise"

A finding should feel like discovering a $20 bill in your jeans after doing laundry — a
genuine, useful surprise, not noise to wade through. If a persona isn't confident
something is a real problem, it leaves it out rather than padding the list. A report with
zero findings is a valid, useful outcome — never pad to look thorough.

## Length discipline (generated docs)

Skills give a word **aim** (e.g. "aim for ~800–1,500 words"), not a limit — it's a soft
target that shapes the first draft. Going over is fine when the content needs it. Write
tight on the first draft: tables/bullets over prose, each fact stated once, evidence as a
short tag (`[verified: grep '...' → 0 matches]`) not a sentence. Never count words or edit
a finished draft just to cut length — no post-draft trim pass, and don't report a word
count.
