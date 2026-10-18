---
name: deep-research
description: Use for open-ended, multi-source research on any topic — web research, idea/market validation, or deep code/repo investigation. Clarifies scope, proposes a research plan for user confirmation, then fans out parallel sub-agents (max 2 concurrent, depth ≤2) to investigate each direction and returns one synthesized, cited report. Not for a single quick lookup — use WebSearch/WebFetch/Explore directly for that.
---

# deep-research — Multi-Agent Research Orchestrator

## Overview

Two-phase flow: (1) scope the question and get the user to confirm a plan, (2) execute
silently via parallel sub-agents and return one synthesized report. Domain-agnostic — the
same flow covers internet research, idea/market validation, and deep-dives into a
codebase or repo. Nothing here is specific to one domain; don't hardcode examples into
prompts when using this skill.

Core principles:

- **Confirm before you fan out.** Phase 0/1 happen inline, in this conversation, because
  they need the user. Phase 2 onward is fully delegated and silent.
- **Silent execution.** Once the plan is confirmed, do not post status updates, progress
  narration, or partial findings to the user. Track progress with TaskCreate/TaskUpdate
  (harness-visible, not chat-visible). The next thing you say to the user is the finished
  report.
- **Depth ≤ 2.** You (this conversation) are depth 0. You may launch sub-agents (depth 1).
  Each depth-1 agent may launch at most one further sub-agent (depth 2) if its assigned
  direction genuinely benefits from splitting. Depth-2 agents may not spawn further
  agents. This is a hard limit, not a suggestion — state it explicitly in every sub-agent
  prompt so it survives the handoff.
- **Sonnet 5.5 (medium effort) for workers, your best reasoning for the plan.** Spawn every research
  sub-agent with `subagent_type: general-purpose`, `model: sonnet` (Sonnet 5.5, medium reasoning effort). Your own
  scoping/decomposition/synthesis is the highest-leverage reasoning in this workflow — if
  you're not already running as Opus with high effort, mention once at the start of Phase
  0 that switching (`/model`) will improve plan quality, then proceed regardless of the
  answer.
- **Cite everything non-trivial.** Every claim in the final report traces to a source
  (URL, `file:line`, PR#, commit, etc.). A source's silence on a point is reported as
  silence, not filled in from assumption.

## Phase 0-1 — Scope & Plan (inline, interactive)

Read `clarify-and-plan.md` and follow it. Produces:

1. Zero or one round of clarifying questions (skip entirely if the request is already
   unambiguous — don't ask just to be thorough).
2. A research plan: a short list of independent research directions, each of which will
   become one depth-1 sub-agent.
3. Explicit user confirmation of the plan before any agent is launched.

Do not proceed past this phase without an explicit go-ahead.

## Phase 2 — Execute (delegated, silent)

1. Create one Task (`TaskCreate`) per confirmed research direction, so progress is
   visible in the harness without chat narration.
2. Launch depth-1 agents using `research-agent-prompt.md`, filled in per direction. Run
   in waves of at most 2 concurrent (`run_in_background: true`); when a wave member
   completes, mark its Task done and launch the next queued direction, keeping ≤2 in
   flight at all times.
3. Each depth-1 agent may spawn exactly one depth-2 helper for a genuinely parallel
   sub-split of its own direction — the prompt template tells it this is the ceiling.
   Most directions won't need one; don't force it.
4. Wait for every direction to complete. Do not message the user in between, and do not
   preview, summarize, or speculate about results while waiting.
5. If a direction fails or returns only partial results, note it as a gap in the final
   report rather than silently retrying more than once.

## Phase 3 — Synthesize (inline, by you)

1. Read every depth-1 agent's returned findings in full.
2. Merge into one report using `report-template.md`: preserve contradictions between
   directions instead of smoothing them over, name gaps explicitly, keep every citation
   intact through the merge.
3. Mark all Tasks complete.
4. Send the report as your first and only message to the user since plan confirmation.

## Common Mistakes

- Skipping Phase 0/1 confirmation and diving straight into agents — the plan is the
  contract; don't fan out on a guess at scope.
- Narrating progress ("agent 1 of 3 done...") between plan confirmation and the final
  report — defeats the entire point of delegating.
- Launching more than 2 depth-1 agents concurrently, or letting a depth-1 agent spawn
  more than one depth-2 helper.
- Standing up this whole flow for a single quick fact — if one WebSearch/WebFetch call or
  one `Explore` agent would answer it, just do that instead.
- Losing citations during synthesis — a claim that loses its source in the merge is worse
  than a claim that was never included.
