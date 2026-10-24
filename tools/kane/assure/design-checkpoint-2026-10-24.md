---
status: in-progress
summary: Nine Kane-generated tests across three approved use-cases; second human checkpoint pending, none run.
date: 2026-10-24
---
# SP04 Task 5 — Design checkpoint

The first human checkpoint passed with the user's exact instruction: **“Approve uc-1, uc-2, uc-3; leave uc-4”**. The runner promoted exactly those three use-cases; uc-4 remains derived and undesigned. Each approved use-case was designed sequentially using `run.sh design <ref>` (`--max 3`); all three commands completed with exit 0, no retries and no pause questions.

**Second human checkpoint pending:** all newly generated criteria, scenarios and tests remain derived. No designed test has been authored or replayed; coverage is **0% proven**, not a test failure. The dated [cover snapshot](cover-2026-10-24.txt) reports **3 of 4 use-cases designed**, satisfying `designed > 0`. This checkpoint does not approve its own tests or authorize execution.

## Generated evidence

- [Full review content](design-review-2026-10-24.md): runner-generated descriptions, all 42 acceptance criteria, nine scenarios, nine tests, 21 gaps and citation relations. uc-4 appears because it remains unapproved; it is not part of the approved batch.
- [CLI context snapshot](context-designed-2026-10-24.html): exact `context view --no-open` output, with graph/source anchors embedded. An inspection export, not a cloneable `.context` backup.
- [Designed tests](designed-tests/): nine byte-for-byte copies of generated `_test.md` files. Original output verified: `tools/kane/assure/.testmuai/tests/`. Frontmatter retains assurance ids and definition identities. CLI context selection uses originals; committed copies preserve generated contents for review.
- [Variables export](designed-variables.json): byte-for-byte copy of `.testmuai/variables/assurance.json`; one blank nonsecret value.
- `.context/` and other `.testmuai/` contents remain ignored. No auth files/raw store included. No tests or scenarios hand-authored or edited.
- [Earlier extraction checkpoint](checkpoint-2026-10-24.md) and its view are historical evidence before approval.

## Credit ledger

| Stage | Before | After | Exact debit | CLI reported |
|---|---:|---:|---:|---:|
| Extract | 100200.7113 | 100194.9731 | 5.7382 | 5.74 |
| Design uc-1 | 100194.9731 | 100175.6136 | 19.3595 | 19.36 |
| Design uc-2 | 100175.6136 | 100160.1303 | 15.4833 | 15.48 |
| Design uc-3 | 100160.1303 | 100143.3148 | 16.8155 | 16.82 |
| **Task 5 total** | **100200.7113** | **100143.3148** | **57.3965** | |

Hard budget 200; remaining **142.6035**. Floor 200 respected before every paid command; minimum observed balance 100143.3148. Free review/view/cover add no credits. Event totals rounded; balance deltas authoritative. Ready check reconfirmed authenticated CLI `0.10.0-rc.3`, local unlinked store. All real commands used the shared lock; `run.sh` owns its acquisition.

## Proposed runtime selection

Recommend **t-3 first (draw), t-2 second (reject), t-5 third if observed costs leave sufficient budget**. Their actions and terminal checks use panel DOM text. Eight authored steps total; first authoring is paid and output limits do not cap spending. Check balance before each; preserve a margin for uncertain in-flight costs. No paid blind retries. Selected tests need a fresh dry-run variable check after approval.

Exact proposed review refs: **ac-6 ac-8 ac-14 ac-15 ac-16 ac-17 ac-23; sc-2 sc-3 sc-5; t-2 t-3 t-5**. None promoted. The user may choose a smaller set. t-5 verifies that one click does not cut; it does **not** prove the actual double-click cut.

Actual cut t-4 observes WebGL troops; it is not a DOM-only candidate. Keep designed/owed unless explicitly selected with that limitation. t-1/t-6 also have visual assertions. t-7/t-8 need full matches; t-8's transit-defeat setup is not established by the source. t-9 lacks a timed fixture. Win/loss owed and deferring some/all testrun are permitted by the approved budget cut.

A read-only listener check after design found **4173 free**. Point-in-time observation, not reservation. Recheck process ownership under lock and update the shared coordination note before preview/browser operations. Do not reuse/stop another checkout's preview.

## Tests submitted for review

| Test | Use-case | Generated behavior | Runtime recommendation |
|---|---|---|---|
| t-1 | uc-1 | Reverse same-owner route; preserve airborne troops | Defer: live capture/setup and WebGL |
| t-2 | uc-1 | Click no-free route; exact alert and unchanged pair | Candidate after t-3; three steps |
| t-3 | uc-1 | Draw ready house route; source groups and active pair | First candidate; two steps |
| t-4 | uc-2 | Double-click active after 700ms; cut, airborne troops, stopped departures | Defer or explicitly accept WebGL risk |
| t-5 | uc-2 | Single-click active; remains active | Candidate if budget permits; three steps |
| t-6 | uc-2 | Double-click ready; exactly one line and active button | Defer: WebGL line-count assertion |
| t-7 | uc-3 | Full victory; Game over, disabled panel, completion dialog | Owed: full playthrough |
| t-8 | uc-3 | Defeat despite troops in transit; disabled panel/dialog | Owed: setup/reachability gap and full playthrough |
| t-9 | uc-3 | Configured timeout; Time up, Game over, disabled panel | Blocked: missing timed_level_url |

## Warnings, variables and debt

- **28 criterion-approval warnings** (9/6/13 by use-case): linked generated criteria await the second human review. No runtime evidence exists.
- `timed_level_url` blank. Description: browser entry URL for a test-build Kane Arena level configured with `timeLimitSec` and mixed ownership; no campaign level sets that parameter. No documented fixture; no placeholder filled. Only t-9 uses it and remains excluded until a real fixture exists.
- 21 explicit gaps include blocked/duplicate/invalid-source draws, level-loss route preservation, hostile reverse lines, owner-only cuts, early-double-click boundary, internal spawn-timer observability, final-tick victory precedence, absence-of-time-limit proof, missing timed fixture, transit-defeat reachability. Complete reasons in full review/view.
- uc-1:8/17 criteria designed; uc-2:6/8; uc-3:9/17. **23/42 criteria designed, 0 proven**. uc-4 undesigned. Omitted mechanics remain debt.

No draw/cut/reject runtime proof claimed. Next paid action requires the user's choice at this checkpoint.
