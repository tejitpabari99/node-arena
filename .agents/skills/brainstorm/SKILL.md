---
name: brainstorm
description: Use before any creative or design work — a new feature, a refactor, a product or business idea, a technical decision, or a vague brain-dump that needs sharpening. Runs a relentless round-based interview to turn a fuzzy idea into a decided design with an explicit decision log, then stops at an approval gate. Trigger phrases include "brainstorm", "grill me", "stress-test this", "poke holes in this", "help me think through", "what am I missing", or any request to build/change something that is not yet a decided design.
---

# Brainstorm

Turn an idea into a decided design by interviewing the human until nothing is left silently assumed.

Two things make this skill work, and both are non-negotiable:

1. **You interview in rounds** — not one question at a time, and not everything at once.
2. **You do not implement anything until the human says yes.**

<HARD-GATE>
No code, no scaffolding, no file writes into the project, no other
implementation skill — until you have stated what you intend to do and
the human has explicitly approved it. The size of the design scales
with the task. The gate never does.
</HARD-GATE>

Shared dispatch/output conventions (cold-agent pattern, Sonnet 5.5/medium-effort sub-agents, frontmatter spec)
live in `../_shared/dev-common.md` — read it once; this file covers what's unique to
brainstorming.

## 0. Workspace guard

Before anything else — including reading the repo for Round 0 — apply the workspace
guard in `../_shared/dev-common.md`: confirm you're on a non-default branch inside a
linked git worktree, creating one if not.

## 1. Classify the depth, out loud

Before your first question, say which of these the request is, in one sentence, so the human can override you.

| Depth | What it is | What it costs |
|---|---|---|
| **Probe** | A feasibility or fact question whose output is an answer, not something you keep. "Can we…", "is it possible…", "quick and dirty is fine". | State the question and how you would find out, in 2–3 sentences. One round at most. No document. |
| **Bounded** | A well-scoped change to something that already exists and that you can read. A flag, one endpoint, a copy change, a single decision with a small blast radius. | One or two rounds. A short design in chat. No document. |
| **Deep** | A new project, a new subsystem, a restructuring, a product direction, or anything whose parts you cannot yet name. | Full interview. Written brief. |

**Bounded measures the artifact, not your familiarity.** If the thing you would be changing does not exist yet for you to read, it is not bounded.

**The ratchet is one-way.** Hidden complexity found mid-session upgrades the depth — stop, say so, re-classify. Nothing ever downgrades. When torn between two, take the heavier one; reaching for the lighter label in order to skip work *is* the doubt.

## 2. Ground yourself before asking anything

Never open with questions you could have answered yourself.

- Read the actual thing: the repo, the files, the recent commits, the existing doc, the idea file. For ideas kept in `/root/projects/cc-gateway/content/ideas/`, read that idea file first.
- **Finding facts is your job. Making decisions is theirs.** If a question could be settled by the filesystem, a tool, a search, or a sub-agent, go settle it. Asking the human something you could have looked up wastes the only resource this skill spends.
- Dispatch sub-agents for lookups that are slow — dispatch mechanics in `../_shared/dev-common.md`. Respect this machine's limits: **max 2 concurrent sub-agents, delegation depth ≤ 2.**
- **Do not block on research.** A running lookup is an unsettled prerequisite: only the questions downstream of it wait. Ask the rest of the round now.

## 3. Round 0 — say the idea back, and name your assumptions

Before the first real round, write:

- **The idea, in one paragraph, in your own words.** Not a restatement of their sentence — your understanding of it.
- **What you are already assuming.** Three to six bullets: the premises you would otherwise interview from without ever putting them up for inspection.
- **Who or what this is for**, if that is not already obvious.

Then ask them to correct it before you go further.

This step exists because the most expensive failure in this skill is a beautifully-run interview into a misunderstood premise. Skipping it is not a shortcut; it is the bug.

## 4. Interview in rounds

Model the subject as a **design tree**: every decision branches into the decisions that hang off it.

The **frontier** is every decision whose prerequisites are already settled — the questions you can honestly ask *now*, without guessing at answers you have not heard. A **round** is one frontier, asked in full.

Ask the whole frontier in one message. Then **stop and wait.**

### Round format

```
❓ **Q1 — <short title>**

<The question. May be several paragraphs. Offer concrete options where
options exist; a real choice beats an open-ended prompt.>

➡️ **My take:** <your recommended answer, and why, in a line>

---

❓ **Q2 — <short title>**

…
```

End every round with: *"Answer by number — 'Q1 yes, Q2 the second one, Q3 no because…'. Or say **all** to take every recommendation as written."*

### Rules of the round

- **Nothing in a round may depend on anything else in that round.** If Q3's answer would change how you would word Q5, Q5 belongs to the next round. This rule is the whole reason a round is safely answerable at once.
- **Every question carries your recommendation.** A question without a `➡️` take is you outsourcing the thinking. Say what you would do and why. Flag it when your take argues *against* the question as worded, so that agreeing means answering "no".
- **Width is a scope signal, not a target.** If the honest frontier is more than about seven questions wide, the scope is too big to grill in one session. Say so and propose decomposing before continuing.
- **Never answer a decision question yourself.** Recommending is the job. Deciding is not.
- Answers reshape the tree. Recompute the frontier each round — later rounds ask what earlier rounds could not have.
- Depth is not capped. Some ideas need three questions and some need fifty. If a session runs very long, the cause is usually scope: stop and decompose.

### Questions worth asking that people skip

Work at least one of each into the interview before you close.

- **The kill question.** "What would have to be true for this to be a bad idea?" and "What is the cheapest thing we could do that would tell us we are wrong?"
- **The YAGNI pass.** Name the pieces you would cut and ask which ones they would actually miss. Cut ruthlessly by default; make them argue things back in.
- **The boundary question.** What is explicitly *not* in scope? Write the answer down — an unstated non-goal comes back later as scope creep.
- **The failure question.** What happens when this breaks, and who notices?
- **The already-exists question.** What in the current system does part of this job today, and why is it not enough?

## 5. Design (Deep only)

Once the frontier is nearly empty:

- **Propose 2–3 approaches**, each with real trade-offs. Lead with your recommendation and say why. An approach that exists only to make another one look good is padding — cut it.
- **Present the design in sections**, each scaled to its own complexity: a few sentences when it is straightforward, a few hundred words when it is genuinely nuanced. Ask after each section whether it lands before continuing.
- Cover: the shape of the thing, its parts and their boundaries, how data or control flows, what happens on failure, and how it gets verified.
- **Design for isolation.** For each unit: what does it do, how is it used, what does it depend on? If someone cannot understand it without reading its internals, or you cannot change its internals without breaking callers, the boundary is wrong.
- **In an existing codebase:** follow the patterns already there. Where existing code genuinely obstructs this work, fold a targeted improvement into the design. Do not propose unrelated refactoring.

## 6. Close

The frontier being empty does not end the session. **The human saying the understanding is shared does.** Ask for that explicitly.

Then, by depth:

- **Probe** — report the finding and a recommendation. Anything you built stays labelled throwaway; keeping it is a new request that gets its own classification.
- **Bounded** — the short design plus the decision log, in chat. Get an explicit yes. Then implement through the normal workflow.
- **Deep** — write the brief, then hand off.

### The brief (Deep)

Write to `docs/agent_files/<branch-slug>-<YYYYMMDD-HHMM>/brainstorm.md` — find/create the
branch folder per `../_shared/dev-common.md`. Length: aim for **~600–1,200 words** (soft
target — going over is fine; never trim after writing). Frontmatter per
`../_shared/dev-common.md`, then:

1. **TL;DR** — 2–4 sentences, first on the page: what was decided and why, in one breath.
2. **Problem** — what we are solving, and for whom.
3. **Decision log** — one row per settled decision, as a table:

   | Decision | Alternative rejected | Why |
   |---|---|---|

   This is the highest-value part of the document and the part future-you will actually read. Do not compress it away — every settled decision gets a row.
4. **Design** — the approach, its parts, and their boundaries. Prose only where genuinely nuanced; a table for anything enumerable (parts, boundaries, failure modes).
5. **Non-goals** — what this explicitly does not do.
6. **Open risks** — what could still sink it, and the cheapest test for each.

**Self-review before showing it.** Read it once with fresh eyes and fix inline: placeholders and TBDs, sections that contradict each other, requirements that could be read two ways, and scope that has quietly grown past one implementable unit. Fix and move on — no second pass. This step is for correctness, not for trimming length.

Then: *"Brief written to `<path>`. Review it and tell me what to change before we turn it into a plan."* Wait.

**Handoff:** once approved, invoke `dev-design` to turn the brief into PRDs, then `dev-tasks`, then `dev-code`. Do not jump straight to implementation.

## Anti-patterns

| Thought | Reality |
|---|---|
| "This is too simple to need a design." | Simple means a *short* design, not none. Two sentences, then approval. |
| "The design is obvious — I'll start while they read it." | The gate is the approval, not the design's length. |
| "I'll ask them what the config currently sets." | Facts are your job. Go look. |
| "I'll ask everything I can think of in one round." | A round is the frontier, not your whole question list. Dependent questions belong to later rounds. |
| "I'll skip the recommendation, it's their call." | The decision is theirs. The recommendation is yours, and it is not optional. |
| "The frontier is empty, so we're done." | Done is when *they* say the understanding is shared. |
| "It grew, but I'm nearly finished — no need to re-classify." | Hidden complexity upgrades the depth. Stop and say so. |
| "They approved the probe, so the follow-up is approved too." | Every task gets its own classification and its own approval. |

## It's working if

- Round 0 surfaced at least one assumption they corrected.
- Each round arrives numbered, with a `➡️` recommendation per question, answerable by number.
- Nothing in a round needed another question in the same round answered first.
- Later rounds ask things the first round could not have.
- You looked facts up instead of asking for them.
- Background research never stalled a round.
- Question count is high; round count is low.
- It ended by asking, not by starting.
