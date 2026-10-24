---
status: in-progress
summary: First assurance checkpoint; four derived use-cases await human approval; zero designed or proven tests.
date: 2026-10-24
---
# SP04 Task 5 — Extraction checkpoint

Task 5 remains **pending human approval**, not complete. Extraction finished successfully; no review verdicts or design calls have run. The generated graph contains four fresh derived use-cases, zero trusted use-cases, zero designed tests, and no completed runs. No requirement has been proven by this assurance session. The acceptance criterion `designed > 0` remains unmet.

## Evidence and provenance

- CLI: `0.10.0-rc.3`; local assurance store in `tools/kane/assure/`; no shared-project link. All direct calls tagged `KANE_CLI_USER_AGENT=codex`.
- Source: committed [excerpt.md](excerpt.md), source id `excerpt`, containing R-LIN-01–05, R-WIN-01–03 and shipped panel facts. Citation line numbers below refer to this excerpt.
- Source graph identity: `sha256:b3fe1ad1f99f48b186210c61b6b5543fa9086231df69ae5e8551d6deb4a58363`.
- Free excerpt generation and ingest were completed before this extraction. Paid extraction: `tools/kane/assure/run.sh extract`, exit 0, session `as-20261024T2205-t2q3s9gb`, no retry or pause.
- Free review listing: `tools/kane/assure/run.sh review`, exit 0; it promoted nothing. Actual `context list --json` format is one JSON object per line with `id`, `cid`, `label`, `title`, `trust`, `fresh`.
- [CLI-generated context view](context-checkpoint-2026-10-24.html): exact self-contained output of `kane-cli context view --no-open --out output-checkpoint-1.html`, renamed for persistence. Its embedded JSON includes all node descriptions, criteria, source line anchors, identities and graph history as of `2026-10-24T22:06:02.048Z`. This is an inspection snapshot, **not a cloneable context-store backup**.
- `context explain --json` on this CLI returned node history only. Full use-case content and citations were verified with `context view --json` and the saved HTML. Runner review rendering was subsequently corrected separately.
- Shared resource lock held by `run.sh` for extraction/review and by `flock` for direct context view/balance reads. No browser, preview, public exposure, or store mutation was required for the view.
- Raw `.context/`, authentication files and ignored run scratch are excluded from this commit. The context store stays ignored and unchanged by this documentation capture.

## Credit ledger

| Measurement | Credits |
|---|---:|
| Preflight / pre-extraction balance | 100200.7113 |
| Post-extraction balance | 100194.9731 |
| Actual balance debit | **5.7382** |
| Extraction stream total, rounded by CLI | 5.74 |
| Task 5 hard budget | 200 |
| Task 5 budget remaining after extraction | **194.2618** |
| Minimum balance floor | 200 |

The before/after balance delta is the precise ledger amount; the stream reports rounded usage. The pre-command floor was respected. Listing, explaining, viewing and this checkpoint capture are free; no additional paid commands have run. Do not infer authorization from the available account balance.

## Human decision required

Recommended design batch: **uc-1, uc-2, uc-3**. Invalid/rejected draws are included in uc-1. Leave uc-4 undesigned unless explicitly requested; its dialog choices are peripheral to the draw/cut/reject and outcome scope.

Risks: uc-1 bundles WebGL mechanics that the panel cannot fully prove; uc-3 includes full-playthrough and optional-time-limit behavior that may remain owed. A designed test is not runtime evidence. The approved budget cut permits deferring testrun; win/loss may remain owed. All criteria below are Kane-extracted proposals, not approved acceptance claims.

The next store mutation must wait for the user's explicit approval of exact use-case refs. Then promote only those refs and design sequentially within the remaining budget. Present generated tests, gaps, warnings and variables at the second human checkpoint before any testrun. Task 5 still requires designed output locations to be verified, generated tests and a reconstructable CLI-supported context export to be committed, and a dated coverage snapshot showing `designed > 0`. No designed output path has been verified yet.

## Extracted use-cases

Descriptions, criteria and citation anchors below are copied from the CLI-generated view payload, with HTML formatting decoded. Rule mappings are supplied for review convenience.

### uc-1 — Draw a route from an owned house

Identity: `sha256:4183075ebe40f1bf136c2817ef97f5bd42aa992b569ce2c3145cda4156f6e454`. Trust: `derived`; freshness: `fresh`.

The human player establishes an outgoing line from a house they own to a different existing building, provided no line already connects that ordered pair, a slot remains after any same-owner reverse-line replacement, and no obstacle blocks the route; drawing replaces a same-owner reverse line but can coexist with a hostile reverse line, while invalid commands leave the match unchanged and the panel shows the route's live availability and feedback.

Extracted criteria:

1. Only an owned house may source a draw; the target must exist and differ from the source, the ordered pair must not already have a line, a slot must be free after any same-owner reverse replacement, and the route must not be blocked; rejection changes nothing.
2. Slots equal stage(L); a level drop does not cut existing lines, even when lines exceed slots; free may be negative and drawing requires free > 0; spawning uses actual line count.
3. A same-owner reverse line is replaced, its troops continue in flight and the new line starts a fresh timer; a hostile reverse line coexists and causes head-on combat.
4. Lines are straight centre-to-centre, cost nothing and have no length cap; crossings alone do nothing, with crossing combat and blocking governed by their respective rules.
5. Outgoing routes are grouped by human-owned source house; towers have no outgoing group, blocked routes are omitted, and displayed colours, levels and routes change during play.
6. A ready button shows the current target colour and level; one click draws, and the player waits for that button to show active before another action.
7. An unavailable route remains clickable, shows its reason, and clicking gives an alert without drawing or cutting; no-free-slot feedback says `This building has no free routes.`, obstacles have their own message, and errors last up to 12 seconds or clear on the next pair click.
8. The test-build panel opens with the Kane URL or seed-1 short URL; controls are unavailable in production, and speed defaults to 0.25x and cycles 0.25, 0.5, 1, 2.

Requirement mapping: R-LIN-01–04 and panel facts. Source citations: `excerpt` `L3-L3`, `L31-L31`, `L17-L17`, `L43-L43`, `L111-L114`, `L115-L115`, `L117-L118`, `L113-L113`.

### uc-2 — Cut an owned outgoing route

Identity: `sha256:d0c23ab40e593171f422a9b10700e6b9da4c5881a8470d44c1391625fe5ab0b9`. Trust: `derived`; freshness: `fresh`.

The human player removes a line they own to stop its spawning timer and prevent further troop departures, while troops already in flight continue toward the target; in the panel an active route must be double-clicked at least 700 ms after drawing, whereas a single click does not cut and double-clicking a ready route draws once instead.

Extracted criteria:

1. Only the line owner can cut it; cutting removes the line and stops its timer and future departures, but troops already in flight continue to the target.
2. An active route requires a double-click at least 700 ms after drawing to cut; a single click does not cut, and a ready-route double-click draws once rather than immediately cutting.

Requirement mapping: R-LIN-05 and panel facts. Source citations: `excerpt` `L57-L57`, `L116-L116`.

### uc-3 — Complete a Kane Arena level

Identity: `sha256:e4197b787cafa390b0850fe23f67aa6fb42fcdb44b26cb8acd7aa10e49c22caa`. Trust: `derived`; freshness: `fresh`.

The human player wins by owning every non-ignored building, including neutral buildings, at which point remaining ignored buildings flip to human ownership and the campaign level is completed; the match otherwise ends in loss when no non-ignored building remains human-owned or in timeout loss if an optional time limit expires after win and loss checks, with no draw and a final outcome reflected in the result UI.

Extracted criteria:

1. Victory requires human ownership of every building with ignoreForWin=false, including neutral buildings; remaining ignored buildings flip to human ownership.
2. Loss occurs when no non-ignored building is human-owned; in-transit troops do not count, there is no draw, and only a win completes the campaign level.
3. Without timeLimitSec there is no limit; when set, tick >= timeLimitSec × tickRate at phase 9 causes timeout loss after win and loss are evaluated, so final-tick victory wins; harness caps are not outcomes and recorded outcomes are final.
4. After a match, buttons are disabled, the banner shows `Game over`, and result text is `Victory!`, `Defeat`, or `Time up` for win, loss, or timeout respectively.
5. The result dialog title is `Victory!` if another campaign level remains, `All levels complete!` after the single Kane level is won, and `Defeat` after loss.

Requirement mapping: R-WIN-01–03 and result UI facts. Source citations: `excerpt` `L69-L69`, `L83-L83`, `L97-L97`, `L119-L119`.

### uc-4 — Continue after a match result

Identity: `sha256:0464bf7dfcbd432cfeceddb5bf4b01ec1f22dc5df7bc76c500222f1b71beced6`. Trust: `derived`; freshness: `fresh`.

After the match ends, the human player can use the result dialog's outcome-dependent controls to replay a won level or retry a lost level, or choose Levels instead; the source specifies which choices are offered but does not describe the subsequent navigation or new match state.

Extracted criteria:

1. The result dialog offers Replay on a win or Retry on a loss, together with Levels.

Requirement mapping: Result dialog controls in panel facts. Source citations: `excerpt` `L119-L119`.

