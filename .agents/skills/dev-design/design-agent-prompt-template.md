# PRD-Authoring-Agent Prompt Template (dev-design)

Fill the `<…>` placeholders. Dispatch rules (parallel, cold agents, sub-agent model) are in
`../_shared/dev-common.md`. **These agents write `PRD.md` only — never `TASKS.md`.**

Two parts: a **shared block** (identical for every agent) and a **per-sub-project block**.

---

## SHARED BLOCK (paste into every agent prompt)

```
You are authoring a PRD for ONE sub-project of a larger initiative — a short PM-spec +
architecture doc, NOT an implementation plan. PLANNING/DESIGN ONLY: you may READ any file,
but must NOT modify source code and must NOT write a tasks file. Your only write is the
single PRD.md named at the end.

First read /root/.claude/skills/_shared/dev-common.md — it has the frontmatter format and
output path grammar this task follows.

=== PROJECT ===
<one paragraph: product, stack, where backend/frontend live, deploy targets>

=== LOCKED DECISIONS (whole initiative — context) ===
<bullets: decisions already made with the human; apply to all sub-projects>

=== KEY VERIFIED FINDINGS ===
<grep/read-backed facts: dead code, real data shapes, contradictions in the brief, with
evidence — so the agent reuses them instead of re-deriving>

=== ALL SUB-PROJECTS (reference only; do NOT do their work) ===
<numbered list: each sub-project + one-line scope + dependencies, so this agent knows its
boundaries and states cross-project interface assumptions instead of overstepping>

=== LENGTH ===
Aim for roughly 800–1,500 words — a soft target, not a limit; going over is fine if the
sub-project needs it. Write tight on the first draft — tables/bullets over prose, each
fact stated once, evidence as a short tag (e.g. `[verified: grep '...' → 0 matches]`) not
a sentence. Do NOT count words or edit the PRD afterwards to cut length.

=== HOUSE FORMAT (READ <path to an existing PRD.md, if one exists> first for tone) ===
---
status: draft
summary: <one line>
date: <YYYY-MM-DD>
---
# PRD: <title>
Repo/branch · Depends on · Owns (files)

## TL;DR
## Problem
## Goals / Non-Goals
## Requirements        (user-visible behavior)
## Architecture         (high level: components, data flow, interfaces; tiny snippet only
                         for an interface/schema when essential — never a full file/component)
## Decisions
| # | Decision | Choice | Alternatives considered | Why |
## Manual steps         (human-only; omit if none)
## Risks / Open Questions
    Each item tagged: [OPEN] (blocks tasks) / [RESOLVED: <decision>] / [DEFERRED].
## Acceptance Criteria  (observable, checkable)
```

---

## PER-SUB-PROJECT BLOCK (unique per agent)

```
=== YOUR SUB-PROJECT: SP<N> — <title> (Phase <p>; depends on <SPs>) ===
Goal: <one or two sentences>

Scope:
1. <specific scope item; name the real files involved>
2. ...

Files to READ first to build your own understanding:
<explicit paths + greps to run; tell it to verify dead-code/usage claims itself>

Think hard about <the gnarly bits: data migration, backward compat, already-persisted
data, coordination with sibling sub-projects>. Back every deletion / "dead code" claim
with grep evidence. Capture real unknowns as [OPEN] items — don't guess to fill space.

=== DELIVERABLE (create exactly this one file) ===
<repo>/docs/agent_files/<branch-slug>-<YYYYMMDD-HHMM>/<NN-kebab-name>/PRD.md

When done, reply with a 5–8 line summary: key decisions, files shared with other
sub-projects, the major [OPEN] questions, confirmation the PRD was written.
```

---

## Tips

- Put verified findings in the SHARED block so no agent re-derives them; give each agent
  the whole sub-project map so it states cross-seam assumptions instead of overstepping.
- Point at a real example PRD for tone rather than describing the format abstractly.
