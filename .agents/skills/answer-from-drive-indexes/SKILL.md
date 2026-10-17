---
name: answer-from-drive-indexes
description: Use when the user gives a Google Drive folder (URL or ID) and asks questions or a task to be answered from that folder's contents. Uses `index.md` files (short descriptions of each file/subfolder) as routing maps to find the right files fast, then answers strictly from the actual contents of the selected files via sub-agents. Stops immediately if the provided root folder has no index.md. Read-only on Drive. Triggers include "answer from this drive folder", "use the drive indexes", "look this up in <drive link>".
---

# answer-from-drive-indexes — Index-Routed, Grounded Drive Q&A

## Overview

`index.md` files in Drive folders hold short descriptions of each file and subfolder in that folder. Use them as routing maps to traverse quickly to the right files, then answer **only** from the actual contents of the selected source files. Index text is routing metadata, never evidence.

Core principles:

- **Root index is a hard gate.** If the folder the user provided has no usable `index.md`, stop and tell the user. Do not explore or answer.
- **Route first, then answer.** Complete routing before launching answer agents.
- **Grounded only.** Every claim traces to a ledger entry pointing at real file content.
- **Read-only Drive.** Never create, update, copy, share, or trash anything. Never create or upload an `index.md`.
- **Orchestrate, don't answer.** The coordinator (main agent) routes, delegates, audits, and merges. It does not independently answer delegated questions.

## Machine constraints (always apply)

- Max **2 concurrent** sub-agents. Batch parallel work in pairs.
- Max sub-agent depth **2** (main → sub-agent → one further sub-agent). Prefer flat: the coordinator spawns routing and answer agents directly.
- Sub-agent model: Sonnet 5.5 (`model: sonnet`), medium reasoning effort, unless a task clearly needs otherwise.
- Stay silent until done: no progress narration; return only the final result (or a blocking stop).
- If sub-agent execution is unavailable, stop and say this skill requires agents. Do not silently answer in the coordinator.

## Drive tooling

Use the Google Drive MCP tools (load schemas via ToolSearch first):

- Allowed: `mcp__claude_ai_Google_Drive__search_files`, `get_file_metadata`, `read_file_content`, `download_file_content`, `list_recent_files`.
- Forbidden: `create_file`, `update_file`, `copy_file`, `share_file`, `trash_file`.

Locate indexes with a Drive query equivalent to: `name = 'index.md' and '<folderId>' in parents and trashed = false`. List children with `'<folderId>' in parents and trashed = false`.

## Inputs

Require:

- a Google Drive folder URL or resolvable folder ID;
- one or more questions, or a task to complete from the folder's information.

If either is missing, ask for it. Treat `references`, `citations`, `sources`, `show where this came from`, and equivalent language as a request for referenced output. Otherwise return the answer without visible citations.

## Step 0 — Root index gate (mandatory, first)

1. Resolve the root folder ID from the URL.
2. Search for exact, non-trashed `index.md` directly in the root folder.
3. Outcomes:
   - **None found** → STOP. Reply that the provided folder has no `index.md`, include the folder link, and suggest running `index-drive-folders` (or creating an index) first. Do not traverse or answer.
   - **Multiple found** → STOP. Report an `Index issues` notice (ambiguous root index) with the folder link. Do not pick one.
   - **Exactly one but empty/malformed** (no parseable Files/Folders entries) → STOP. Report an `Index issues` notice with the folder link.
   - **Exactly one usable** → fetch it and continue.

## Step 1 — Build the routing layer

### Terminal collections

Some indexed folders deliberately act as routing leaves even though they contain organizational subfolders. Treat a folder as a terminal collection only when the user explicitly identifies it as a leaf/boundary or its exact stable Drive ID appears below. Do not infer this from its name.

| Folder | Stable Drive ID | Boundary context |
| --- | --- | --- |
| WashU Videos | `1jAS0uSZTmHIcoUhsaXwWHMZLa8U_hZfU` | Downloaded WashU CDR training videos organized into module folders. |

For a terminal collection:

- use the boundary folder's `index.md` as the persistent routing map when usable;
- stop recursive index discovery at the boundary; its module subfolders are not missing, malformed, or ambiguous index locations;
- if the boundary folder itself has no usable index, assign one routing agent to it; that agent may inspect shallow metadata for files directly inside each immediate module folder and creates one temporary routing map for the boundary folder only;
- when an answer agent selects a module folder from the boundary map, it may list that module folder's direct files, select relevant files from names/metadata, and open the actual selected files for evidence;
- never use module names, filenames, video metadata, or the boundary context as answer evidence; if a selected video or accompanying source cannot be read, leave dependent claims unsupported;
- do not report intentionally unindexed module folders under `Folders missing index.md`.

### Discovery (coordinator, metadata only)

1. Starting from the root index, follow the folders it lists (and, to catch unlisted ones, the root's direct child folders) to build the in-scope folder tree. Prefer descending only into folders whose index entries look relevant to at least one question; the root index is the first filter. For each visited folder, locate exact non-trashed `index.md` files and record folder ID, name, observed URL, parent, and depth. Stop at terminal collections. Do not answer during discovery.
2. **Exactly one usable index** → fetch it; use its entries as the persistent routing map.
3. **Empty/malformed index** → treat as unusable, assign one routing agent, and record under `Index issues`. Never use it as evidence.
4. **No index (descendant folder)** → record under `Folders missing index.md` and assign exactly one routing agent to that folder.
5. **Multiple indexes (descendant folder)** → do not choose; assign one routing agent and record under `Index issues`.
6. Run routing agents deepest-first so a parent's routing agent receives completed summaries from its direct children. Run siblings in parallel, max 2 at a time.

### Routing agent brief

Give each routing agent: folder ID and observed URL, its direct-child metadata, completed direct-child routing summaries, and all atomic questions/task components with IDs. Require it to:

- inspect only that folder's direct children;
- use names, types, timestamps, and minimal shallow content reads — only enough to write a concise query-specific description and tags, or rule an item in/out;
- mark a child folder relevant to a question whenever that child's routing summary contains a relevant candidate, even if the child's name is vague;
- return an in-memory `index.md`-shaped routing map: stable IDs, observed links, relevance by question ID, files sampled, unreadable items, and a concise folder summary;
- make no Drive writes and never create or upload an `index.md`.

The coordinator assigns each unindexed/ambiguous folder once, deduplicates maps by folder ID, combines temporary maps with persistent indexes, and propagates question relevance through every ancestor so deep candidates stay reachable. A descendant relevance overlay may add a route through a persistent parent index but never becomes evidence. Temporary descriptions expire after the run.

## Grounding rules

- Index names, descriptions, and tags (persistent or temporary) are routing metadata only — never evidence.
- Support every factual statement with the actual contents of one or more selected source files.
- No web search, general knowledge, memory, unrelated conversation context, or unselected Drive files to fill gaps.
- Synthesis, reformatting, comparison, and explicit arithmetic from documented inputs are allowed. No unstated premises, causal explanations, extrapolations, or recommendations the sources don't state or directly support.
- When sources conflict, preserve the conflict and attribute each position. Don't pick a winner without source support.
- If a source cannot be read, do not answer from its index description.
- Remove every unsupported claim before returning.

## Step 2 — Split and group the request

1. Parse the request into atomic questions/task components, preserving original order and labels.
2. Use the completed routing layer before grouping.
3. Default to one answer agent per atomic question.
4. Group questions into one work unit only when routing identifies substantially the same candidate folders/files, or they are inseparable parts of one requested output. Don't group merely to reduce agent count.
5. Spawn one answer agent per work unit, max 2 concurrent.

## Step 3 — Answer-agent traversal

Give each answer agent: its exact question(s), the root folder, relevant persistent and temporary routing maps (with overlays), and whether visible references were requested. Require it to:

1. Parse the routing map's `Folders` and `Files` entries: stable IDs, names, descriptions, tags, question relevance, observed links.
2. Select only entries whose routing metadata directly indicates relevance. Don't assume vague or unrelated entries contain the answer.
3. For a selected folder, use its supplied routing map plus descendant overlays, then repeat. Don't browse unselected children as a fallback (except terminal-collection module folders as described above).
4. For a selected file, open the actual file via the Drive read tools.
5. Start with the smallest sufficient source set; if evidence is incomplete, return to the routing map for the next directly relevant candidate.
6. Track visited folder and file IDs to prevent loops and duplicate reads.
7. Stop a branch when its routing map has no directly relevant entry.
8. Stay read-only.

### Evidence ledger (mandatory, even without visible references)

Per claim: question/component ID; claim or output field; source file name, stable Drive ID, observed URL; precise location when available (section, page, slide, sheet+range, row, paragraph); concise support note grounded in source text.

Each answer agent returns:

- a separate answer for every assigned question/component;
- its evidence ledger;
- question IDs left unsupported;
- routing paths traversed (persistent and temporary);
- source files read and unreadable files;
- confirmation that no external facts were used.

The coordinator rejects any claim with no ledger entry or whose ledger points only to an index description.

## Unsupported answers stay blank

- Preserve the user's headings, numbering, table rows, fields, or requested structure.
- For an unsupported answer, leave the value/body empty. Don't write `unknown`, `not found`, `N/A`, a guess, or an explanation in the field.
- For a partly supported narrative, include only supported sentences; don't add connective claims.
- If a selected file is unreadable, leave dependent answers blank. List the access problem separately only when the user needs to act.

## References

When references are requested:

- cite every substantive statement next to the claim;
- link the actual source file (never an `index.md`) with the most precise location available;
- cite every source needed for a synthesis or calculation;
- never attach a citation to an unsupported statement;
- optionally add a deduplicated `Sources used` list after the answers.

When not requested, omit citations and source lists, but still audit via ledgers.

## Step 4 — Merge and return

1. Verify every work unit was handled by exactly one agent.
2. Audit each claim against its ledger; delete unsupported material.
3. Keep answers in the user's original order and format.
4. Prevent one agent's unsupported conclusion from entering another answer.
5. Apply the citation mode consistently.
6. Return the answer/completed task directly — no agent trace or file-reading log unless asked.
7. If any in-scope descendant folder lacked a persistent index (excluding terminal-collection internals), append `Folders missing index.md` listing each folder name with its observed link and suggest running `index-drive-folders`. Required even without visible references.
8. If any folder had multiple or malformed indexes, append a separate `Index issues` notice with each observed folder link.
