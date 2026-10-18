# Final Report Template (deep-research, Phase 3)

Written by you (the orchestrator), after every depth-1 direction has returned. This is
the one message you send since plan confirmation.

Keep it proportional to the plan's `depth` — an overview plan shouldn't produce an
exhaustive report. Don't add sections that have nothing in them.

---

```markdown
# <Research question, restated as a title>

## TL;DR
3-6 bullets with the headline answer(s). Each with an inline citation.

## Findings

### <Direction 1 name>
Merged findings for this direction — prose or bullets, inline citations per claim.

### <Direction 2 name>
...

(one subsection per confirmed direction — do not collapse them into an undifferentiated
wall of text; the direction is the useful unit of provenance)

## Contradictions & uncertainty
Anywhere two directions (or two sources within one direction) disagreed, or a finding is
low-confidence. Name both sides with citations. If unresolved, say so plainly rather than
picking one silently.

(omit this section if genuinely nothing conflicted)

## Gaps
What remains unanswered, and what would be needed to close it (a specific source, an
owner to ask, an experiment). Pull these up from each direction's reported gaps.

## Sources
Flat, deduped list of every citation used above, numbered.
```

## Synthesis rules

- Every claim in the merged report must still carry the citation it had in the source
  agent's findings — don't summarize away the locator.
- If two directions cite the same underlying source, cite it once and note both
  directions used it only if that's itself informative.
- Don't resolve a contradiction by picking a side unless one source is clearly more
  authoritative, recent, or specific — otherwise report both and mark it unresolved.
- If the plan specified a saved-file output, write the report there (via `Write`) and
  tell the user the path; otherwise just send it as your chat message.
