uc-4 — Continue after a match result [derived; fresh]
description: After the match ends, the human player can use the result dialog's outcome-dependent controls to replay a won level or retry a lost level, or choose Levels instead; the source specifies which choices are offered but does not describe the subsequent navigation or new match state.
value: Gives the player a way to continue or leave the finished match.

risk: low
human player
- The result dialog offers Replay on a win or Retry on a loss, together with Levels.
Citations / relations:
- DERIVES: excerpt → uc-4 (L119-L119)

sc-2 — Click an unavailable no-free route [derived; fresh]
intent: When a live owned-house pair shows no free route, click its still-enabled unavailable button and observe the exact alert without drawing or cutting.

negativetechniques: Negative, equivalence partitioning and BVA for free=0 versus free>0; BVA tool returned 0,1,2 for a positive free-slot threshold of 1 (negative free is separately allowed by the source). Strength=3 for ownership and rejected-command state; covering array ownership × free-slot × route blocking produced 12 three-wise combinations, constrained to sourced panel-operable paths and budget 3. Error/empty-state, field validation and REST profile checks do not apply: this is a route button, not a form or specified endpoint.
Citations / relations:
- belongs_to: sc-2 → uc-1
- exercises: sc-2 → ac-1
- exercises: sc-2 → ac-6
- exercises: sc-2 → ac-14
- exercises: sc-2 → ac-15
- exercises: sc-2 → ac-17
- scoped_to: ac-17 → sc-2
- automates: t-2 → sc-2

sc-4 — Cut an active owned route after 700 ms [derived; fresh]
intent: Draw an owned ready route, allow an in-flight troop, then after at least 700 ms double-click its active panel button to remove the line while previously launched troops continue and new departures stop.

happytechniques: State-flow and CRUD-style removal; BVA threshold representatives from expand_bva: 0, 699, 700, 701 ms, with >=700 retained and 699 evicted as a separate outcome. Three-wise route-state × gesture × elapsed-ms from covering_array (strength=3 because ownership is an auth boundary), curtailed by max_pairs=3; route choice is a live human-owned ready panel pair, not hard-coded. No prerequisite scenario: establish active route within this path.
Citations / relations:
- belongs_to: sc-4 → uc-2
- exercises: sc-4 → ac-19
- exercises: sc-4 → ac-21
- exercises: sc-4 → ac-22
- exercises: sc-4 → ac-24
- scoped_to: ac-24 → sc-4
- automates: t-4 → sc-4

sc-6 — Double-click a ready route [derived; fresh]
intent: On an owned ready route, double-click the panel button and observe one active drawn route rather than an immediate cut.

negativetechniques: Negative ready-state partition of route-state × gesture; strength=3 three-wise covering array due to auth ownership boundary; duration variants are equivalent for ready-state draw and are not separate outcomes. State is established locally, with no cross-test prerequisite.
Citations / relations:
- belongs_to: sc-6 → uc-2
- exercises: sc-6 → ac-25
- scoped_to: ac-25 → sc-6
- automates: t-6 → sc-6

sc-3 — Draw a live ready route [derived; fresh]
intent: In the test-build panel select a currently ready human-owned house-to-target pair, read the current target description, draw once, and wait for that pair to become active.

happytechniques: Equivalence partitioning of ready versus unavailable and state-flow ready→active; BVA free-slot positive representative 1 and 2 apply without inventing a fixed level. Strength=3 due to ownership gate and rejected-command state; covering array returned 12 ownership × free-slot × blocking combinations at strength 3; this path covers owned house, positive free, clear route. Estimated 8 scenarios with an explicit ceiling of 3. Native, API-contract, currency, search/list, file/media, temporal, i18n, a11y, performance, and responsive-layout profile examples provide no additional sourced route outcome.
Citations / relations:
- belongs_to: sc-3 → uc-1
- exercises: sc-3 → ac-8
- exercises: sc-3 → ac-13
- exercises: sc-3 → ac-14
- exercises: sc-3 → ac-16
- scoped_to: ac-16 → sc-3
- automates: t-3 → sc-3

sc-8 — Lose after the last required human building falls with troops in transit [derived; fresh]
intent: Let the last non-ignored human building fall despite remaining troops in transit and observe defeat without campaign completion.

negativetechniques: Negative/EQP: none required human-owned while troops are in flight, timeLimitSec absent. State-flow confirms loss rather than draw; pairwise strength=2 (user-reach only) on ownership × timer; this represents the untimed loss combination. No sourced numeric bounds for BVA. CRUD, auth, API contract, concurrency, idempotency, i18n, a11y, responsiveness, empty-state, overflow, persistence, temporal clock manipulation, currency, pagination, file and notification do not yield further sourced rules. Five candidates, max 3 kept.
Citations / relations:
- belongs_to: sc-8 → uc-3
- exercises: sc-8 → ac-29
- exercises: sc-8 → ac-30
- exercises: sc-8 → ac-31
- exercises: sc-8 → ac-34
- exercises: sc-8 → ac-35
- exercises: sc-8 → ac-36
- exercises: sc-8 → ac-38
- exercises: sc-8 → ac-41
- exercises: sc-8 → ac-42
- automates: t-8 → sc-8

sc-1 — Replace a same-owner reverse route [derived; fresh]
intent: From two human-owned houses, draw an outgoing line and reverse it from the destination after confirming a ready reverse route; the old reverse line disappears while previously launched troops continue.

edgetechniques: State-flow, CRUD and persistence apply to reverse replacement and already-in-flight troops; equivalence partitions same-owner versus hostile reverse. Strength=3 because route replacement risks loss of existing state; three-input covering array identified ownership × free-slot × blocking interactions, but this path isolates the same-owner reverse outcome. BVA free-slot representatives 0,1,2 inform the positive-slot condition; no documented upper bound. Estimated 8 candidate scenarios, limited to 3 by explicit max_pairs. API contract, currency, file/media, i18n, a11y, responsive layout, pagination, temporal and notification add no sourced distinct reverse-route promise.
Citations / relations:
- belongs_to: sc-1 → uc-1
- exercises: sc-1 → ac-8
- exercises: sc-1 → ac-9
- exercises: sc-1 → ac-10
- exercises: sc-1 → ac-13
- exercises: sc-1 → ac-14
- automates: t-1 → sc-1

sc-5 — Single-click an active route [derived; fresh]
intent: Draw a ready owned route, then click its active button once and observe the active route remains.

negativetechniques: Negative equivalence partition of gesture (single versus double), state flow; three-wise combination strength=3 for auth risk across state, gesture and elapsed time, capped at 3 pairs. Establish active route in this scenario rather than depend on another scenario's mutable game state.
Citations / relations:
- belongs_to: sc-5 → uc-2
- exercises: sc-5 → ac-23
- automates: t-5 → sc-5

sc-9 — Time out a configured Kane level [derived; fresh]
intent: On a level with timeLimitSec set, reach the phase-9 tick threshold with mixed ownership and no prior win or loss, and observe timeout loss.

boundarytechniques: Temporal boundary and state-flow: tick >= timeLimitSec × tickRate at phase 9, with neither victory nor defeat resolved. BVA cannot expand an unstated numeric timeLimitSec bound; no literal value is invented. Pairwise strength=2 (user-reach only) on ownership × timer; mixed ownership with threshold reached is the timeout combination. Negative applies to absence of completion; CRUD, auth, API contract, concurrency, idempotency, i18n, a11y, responsiveness, empty-state, overflow, currency, pagination, file and notification yield no additional promised rule. Five candidates, max 3 kept.
Citations / relations:
- belongs_to: sc-9 → uc-3
- exercises: sc-9 → ac-30
- exercises: sc-9 → ac-32
- exercises: sc-9 → ac-34
- exercises: sc-9 → ac-35
- exercises: sc-9 → ac-36
- exercises: sc-9 → ac-39
- exercises: sc-9 → ac-42
- automates: t-9 → sc-9

sc-7 — Win by capturing every required Kane building [derived; fresh]
intent: Capture all non-ignored buildings including neutral, observe the remaining ignored buildings flip, and complete the single Kane level.

happytechniques: Equivalence partitioning: all required human-owned with timeLimitSec absent. State-flow and persistence apply to outcome and progression. Pairwise strength=2 (user-reach only); covering_array over ownership × timer produced six combinations, of which this is the untimed victory class. No numeric input bounds stated, so BVA cannot supply literal limit values. Negative, concurrency, idempotency, a11y, responsiveness, i18n, CRUD, auth, API contract, empty-state, overflow, currency, pagination, file and notification do not add sourced outcome behavior. Five distinct candidate outcomes, max 3 kept.
Citations / relations:
- belongs_to: sc-7 → uc-3
- exercises: sc-7 → ac-26
- exercises: sc-7 → ac-27
- exercises: sc-7 → ac-28
- exercises: sc-7 → ac-31
- exercises: sc-7 → ac-34
- exercises: sc-7 → ac-35
- exercises: sc-7 → ac-36
- exercises: sc-7 → ac-37
- exercises: sc-7 → ac-40
- exercises: sc-7 → ac-42
- automates: t-7 → sc-7

ac-18 — A caller who does not own a line cannot cut that line. [derived; fresh]
: A caller who does not own a line cannot cut that line.

forbidden-presence
risk: medexists: removal of a line by a caller who does not own it
Citations / relations:
- scoped_to: ac-18 → uc-2

ac-7 — A draw blocked by an obstacle is rejected. [derived; fresh]
: A draw blocked by an obstacle is rejected.

forbidden-presence
risk: medexists: new line across a blocked route
Citations / relations:
- scoped_to: ac-7 → uc-1

ac-5 — A draw for an ordered source–target pair already connected is rejected. [derived; fresh]
: A draw for an ordered source–target pair already connected is rejected.

forbidden-presence
risk: medexists: additional line for the already-connected ordered pair
Citations / relations:
- scoped_to: ac-5 → uc-1

ac-2 — A draw from a source the caller does not own is rejected. [derived; fresh]
: A draw from a source the caller does not own is rejected.

forbidden-presence
risk: medexists: new line from the unowned source
Citations / relations:
- scoped_to: ac-2 → uc-1

ac-3 — A draw from a tower source is rejected. [derived; fresh]
: A draw from a tower source is rejected.

forbidden-presence
risk: medexists: new outgoing line from a tower source
Citations / relations:
- scoped_to: ac-3 → uc-1

ac-4 — A draw to a nonexistent or identical target is rejected. [derived; fresh]
: A draw to a nonexistent or identical target is rejected.

forbidden-presence
risk: medexists: new line to a nonexistent target or to the source itself
Citations / relations:
- scoped_to: ac-4 → uc-1

ac-6 — A draw when the source has no free slot after any same-owner reverse-line replacement is rejected. [derived; fresh]
: A draw when the source has no free slot after any same-owner reverse-line replacement is rejected.

forbidden-presence
risk: medexists: new line when free slots after same-owner reverse replacement are not positive
Citations / relations:
- scoped_to: ac-6 → uc-1
- exercises: sc-2 → ac-6
- verifies: t-2 → ac-6

ac-11 — A hostile reverse line coexists with a newly drawn line. [derived; fresh]
: A hostile reverse line coexists with a newly drawn line.

presence
risk: medexists: both the hostile reverse line and the newly drawn line
Citations / relations:
- scoped_to: ac-11 → uc-1

ac-28 — A human win completes the campaign level. [derived; fresh]
: A human win completes the campaign level.

absolute
risk: med= campaign level completed
Citations / relations:
- scoped_to: ac-28 → uc-3
- exercises: sc-7 → ac-28

ac-26 — A human win occurs when the human owns every non-ignored building, including neutral buildings. [derived; fresh]
: A human win occurs when the human owns every non-ignored building, including neutral buildings.

presence
risk: medfor all every building with ignoreForWin=false, including neutral buildings, is human-owned at victory
Citations / relations:
- scoped_to: ac-26 → uc-3
- exercises: sc-7 → ac-26

ac-12 — A level drop does not cut existing lines even if the line count exceeds the new slot count. [derived; fresh]
: A level drop does not cut existing lines even if the line count exceeds the new slot count.

presence
risk: medfor all previously drawn lines remain after a level drop even when lines exceed slots
Citations / relations:
- scoped_to: ac-12 → uc-1

ac-30 — A loss or timeout does not complete the campaign level. [derived; fresh]
: A loss or timeout does not complete the campaign level.

forbidden-presence
risk: medexists: campaign level completed after loss or timeout
Citations / relations:
- scoped_to: ac-30 → uc-3
- exercises: sc-8 → ac-30
- exercises: sc-9 → ac-30

ac-42 — A match has no draw outcome. [derived; fresh]
: A match has no draw outcome.

forbidden-presence
risk: medexists: draw outcome
Citations / relations:
- scoped_to: ac-42 → uc-3
- exercises: sc-7 → ac-42
- exercises: sc-8 → ac-42
- exercises: sc-9 → ac-42

ac-34 — A recorded match outcome remains final. [derived; fresh]
: A recorded match outcome remains final.

absolute
risk: med= original recorded match outcome after later ticks
Citations / relations:
- scoped_to: ac-34 → uc-3
- exercises: sc-7 → ac-34
- exercises: sc-8 → ac-34
- exercises: sc-9 → ac-34

ac-1 — A rejected DrawLine command leaves the match unchanged. [derived; fresh]
: A rejected DrawLine command leaves the match unchanged.

state-transition
risk: med= same match state (was match state immediately before the rejected command)
Citations / relations:
- scoped_to: ac-1 → uc-1
- exercises: sc-2 → ac-1

ac-9 — A same-owner reverse line is removed when the new line replaces it. [derived; fresh]
: A same-owner reverse line is removed when the new line replaces it.

forbidden-presence
risk: medexists: same-owner old reverse line after replacement
Citations / relations:
- scoped_to: ac-9 → uc-1
- exercises: sc-1 → ac-9
- verifies: t-1 → ac-9

ac-23 — A single click on an active route does not cut it. [derived; fresh]
: A single click on an active route does not cut it.

presence
risk: medexists: the active route after a single click
Citations / relations:
- scoped_to: ac-23 → uc-2
- exercises: sc-5 → ac-23
- verifies: t-5 → ac-23

ac-8 — A valid draw creates the requested source-to-target line. [derived; fresh]
: A valid draw creates the requested source-to-target line.

presence
risk: medexists: active line for the requested ordered pair
Citations / relations:
- scoped_to: ac-8 → uc-1
- exercises: sc-1 → ac-8
- exercises: sc-3 → ac-8
- verifies: t-1 → ac-8
- verifies: t-3 → ac-8

ac-41 — After a loss, the result dialog title reads `Defeat`. [derived; fresh]
: After a loss, the result dialog title reads `Defeat`.

absolute
risk: med= Defeat
Citations / relations:
- scoped_to: ac-41 → uc-3
- exercises: sc-8 → ac-41
- verifies: t-8 → ac-41

ac-16 — After a ready route button is clicked once, that same pair shows active. [derived; fresh]
: After a ready route button is clicked once, that same pair shows active.

absolute
risk: medcontains active
Citations / relations:
- exercises: sc-3 → ac-16
- scoped_to: ac-16 → sc-3
- verifies: t-3 → ac-16

ac-35 — After the match, panel buttons are disabled. [derived; fresh]
: After the match, panel buttons are disabled.

presence
risk: medfor all panel button disabled after match
Citations / relations:
- scoped_to: ac-35 → uc-3
- exercises: sc-7 → ac-35
- exercises: sc-8 → ac-35
- exercises: sc-9 → ac-35
- verifies: t-7 → ac-35
- verifies: t-8 → ac-35
- verifies: t-9 → ac-35

ac-36 — After the match, the feedback banner reads `Game over`. [derived; fresh]
: After the match, the feedback banner reads `Game over`.

absolute
risk: med= Game over
Citations / relations:
- scoped_to: ac-36 → uc-3
- exercises: sc-7 → ac-36
- exercises: sc-8 → ac-36
- exercises: sc-9 → ac-36
- verifies: t-7 → ac-36
- verifies: t-8 → ac-36
- verifies: t-9 → ac-36

ac-40 — After the single Kane level is won, the result dialog title reads `All levels complete!`. [derived; fresh]
: After the single Kane level is won, the result dialog title reads `All levels complete!`.

absolute
risk: med= All levels complete!
Citations / relations:
- scoped_to: ac-40 → uc-3
- exercises: sc-7 → ac-40
- verifies: t-7 → ac-40

ac-31 — An absent timeLimitSec imposes no time limit. [derived; fresh]
: An absent timeLimitSec imposes no time limit.

forbidden-presence
risk: medexists: timeout outcome when timeLimitSec is absent
Citations / relations:
- scoped_to: ac-31 → uc-3
- exercises: sc-7 → ac-31
- exercises: sc-8 → ac-31

ac-17 — An unavailable no-free-route button remains clickable. [derived; fresh]
: An unavailable no-free-route button remains clickable.

presence
risk: medexists: clickable unavailable no-free-route button
Citations / relations:
- exercises: sc-2 → ac-17
- scoped_to: ac-17 → sc-2
- verifies: t-2 → ac-17

ac-15 — An unavailable no-free-route click displays `This building has no free routes.` [derived; fresh]
: An unavailable no-free-route click displays `This building has no free routes.`

absolute
risk: med= This building has no free routes.
Citations / relations:
- scoped_to: ac-15 → uc-1
- exercises: sc-2 → ac-15
- verifies: t-2 → ac-15

ac-19 — Cutting an owned line removes that line. [derived; fresh]
: Cutting an owned line removes that line.

forbidden-presence
risk: medexists: the cut outgoing line remaining active
Citations / relations:
- scoped_to: ac-19 → uc-2
- exercises: sc-4 → ac-19
- verifies: t-4 → ac-19

ac-20 — Cutting an owned line stops its spawn timer. [derived; fresh]
: Cutting an owned line stops its spawn timer.

forbidden-presence
risk: medexists: a running spawn timer for the cut line
Citations / relations:
- scoped_to: ac-20 → uc-2

ac-24 — Double-clicking an owned active route at least 700 ms after drawing cuts that route. [derived; fresh]
: Double-clicking an owned active route at least 700 ms after drawing cuts that route.

forbidden-presence
risk: medexists: the selected route remaining active after a double-click at least 700 ms after drawing
Citations / relations:
- exercises: sc-4 → ac-24
- scoped_to: ac-24 → sc-4
- verifies: t-4 → ac-24

ac-25 — Double-clicking an owned ready route draws it once rather than immediately cutting it. [derived; fresh]
: Double-clicking an owned ready route draws it once rather than immediately cutting it.

count
risk: med= 1 drawn line for the selected source-target pair
Citations / relations:
- exercises: sc-6 → ac-25
- scoped_to: ac-25 → sc-6
- verifies: t-6 → ac-25

ac-21 — No further troops depart on a cut line. [derived; fresh]
: No further troops depart on a cut line.

forbidden-presence
risk: medexists: new troops departing on the cut line after the cut
Citations / relations:
- scoped_to: ac-21 → uc-2
- exercises: sc-4 → ac-21
- verifies: t-4 → ac-21

ac-27 — On a human win, remaining ignored buildings become human-owned. [derived; fresh]
: On a human win, remaining ignored buildings become human-owned.

presence
risk: medfor all every remaining ignored building is human-owned after victory
Citations / relations:
- scoped_to: ac-27 → uc-3
- exercises: sc-7 → ac-27

ac-38 — On loss, the Kane result text reads `Defeat`. [derived; fresh]
: On loss, the Kane result text reads `Defeat`.

absolute
risk: med= Defeat
Citations / relations:
- scoped_to: ac-38 → uc-3
- exercises: sc-8 → ac-38
- verifies: t-8 → ac-38

ac-39 — On timeout, the Kane result text reads `Time up`. [derived; fresh]
: On timeout, the Kane result text reads `Time up`.

absolute
risk: med= Time up
Citations / relations:
- scoped_to: ac-39 → uc-3
- exercises: sc-9 → ac-39
- verifies: t-9 → ac-39

ac-37 — On victory, the Kane result text reads `Victory!`. [derived; fresh]
: On victory, the Kane result text reads `Victory!`.

absolute
risk: med= Victory!
Citations / relations:
- scoped_to: ac-37 → uc-3
- exercises: sc-7 → ac-37
- verifies: t-7 → ac-37

ac-29 — The human loses when they own no non-ignored building, even if their troops remain in transit. [derived; fresh]
: The human loses when they own no non-ignored building, even if their troops remain in transit.

absolute
risk: med= loss when zero non-ignored buildings are human-owned, irrespective of troops in transit
Citations / relations:
- scoped_to: ac-29 → uc-3
- exercises: sc-8 → ac-29
- verifies: t-8 → ac-29

ac-14 — The panel groups outgoing routes by human-owned source house. [derived; fresh]
: The panel groups outgoing routes by human-owned source house.

presence
risk: medfor all outgoing route groups are headed by human-owned source houses
Citations / relations:
- scoped_to: ac-14 → uc-1
- exercises: sc-1 → ac-14
- exercises: sc-2 → ac-14
- exercises: sc-3 → ac-14
- verifies: t-3 → ac-14

ac-13 — The ready route button describes its target's current colour and level. [derived; fresh]
: The ready route button describes its target's current colour and level.

absolute
risk: medcontains current target colour and level
Citations / relations:
- scoped_to: ac-13 → uc-1
- exercises: sc-1 → ac-13
- exercises: sc-3 → ac-13

ac-22 — Troops already in flight on a cut line continue to their target. [derived; fresh]
: Troops already in flight on a cut line continue to their target.

presence
risk: medexists: a pre-cut in-flight troop continuing toward its target after the cut
Citations / relations:
- scoped_to: ac-22 → uc-2
- exercises: sc-4 → ac-22
- verifies: t-4 → ac-22

ac-10 — Troops already in flight on a replaced same-owner reverse line continue toward their target. [derived; fresh]
: Troops already in flight on a replaced same-owner reverse line continue toward their target.

presence
risk: medexists: previously in-flight troops continuing toward their original target after reverse-line replacement
Citations / relations:
- scoped_to: ac-10 → uc-1
- exercises: sc-1 → ac-10
- verifies: t-1 → ac-10

ac-33 — Victory on the final permitted tick takes precedence over timeout. [derived; fresh]
: Victory on the final permitted tick takes precedence over timeout.

absolute
risk: med= win on final permitted tick
Citations / relations:
- scoped_to: ac-33 → uc-3

ac-32 — When timeLimitSec is set, reaching tick >= timeLimitSec × tickRate at phase 9 yields timeout loss if neither a win nor a loss was resolved first. [derived; fresh]
: When timeLimitSec is set, reaching tick >= timeLimitSec × tickRate at phase 9 yields timeout loss if neither a win nor a loss was resolved first.

absolute
risk: med= timeout loss at phase 9 when tick >= timeLimitSec × tickRate and neither win nor loss has already resolved
Citations / relations:
- scoped_to: ac-32 → uc-3
- exercises: sc-9 → ac-32
- verifies: t-9 → ac-32

t-7 — Capture required Kane buildings and see victory [derived; fresh]
= Victory!
definitionId: sha256:9b8a9c56ce5c983daed1fbccc3758e3e10c6f0d24285a5a8a37f3b24e1a39555
# Capture required Kane buildings and see victory

> Capture all non-ignored buildings including neutral, observe the remaining ignored buildings flip, and complete the single Kane level.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena at default Speed 0.25x and locate the panel of outgoing routes grouped by human-owned houses.

## Step 2 @verifies ac-35, ac-36, ac-37, ac-40

In the Kane Arena route panel, use the live ready-route buttons from human-owned houses to capture every non-ignored building, including neutral buildings, without reloading; when the match ends, then assert the Kane result text reads `Victory!`, the feedback banner reads `Game over`, the panel buttons are disabled, and the result dialog title reads `All levels complete!`.
Citations / relations:
- automates: t-7 → sc-7
- verifies: t-7 → ac-35
- verifies: t-7 → ac-36
- verifies: t-7 → ac-37
- verifies: t-7 → ac-40

t-4 — Cut an owned active route while preserving in-flight troops [derived; fresh]
exists: the selected route remaining active after a double-click at least 700 ms after drawing
definitionId: sha256:eda769b1b8352e481e1308a641a020a5263b8e21ad9d62642a85b64696c79c09
# Cut an owned active route while preserving in-flight troops

> Draw an owned ready route, allow an in-flight troop, then after at least 700 ms double-click its active panel button to remove the line while previously launched troops continue and new departures stop.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the browser to enter Kane Arena at the default Speed 0.25x; in the bottom outgoing-routes panel identify a live green ready pair under a human-owned house, avoiding unavailable pairs.

## Step 2

On that pair's ready button, draw its route and wait for its button to say active and for a troop to be visibly in flight toward the target in the arena.

## Step 3 @verifies ac-19, ac-21, ac-22, ac-24

At least 700 ms after drawing, on the same red active pair button in the outgoing-routes panel, double-click to cut the route; follow the already in-flight troop to its target while play continues at Speed 0.25x, then assert the pair is no longer active, the previously in-flight troop continues toward its target, and no new troops depart on that cut route.
Citations / relations:
- automates: t-4 → sc-4
- verifies: t-4 → ac-19
- verifies: t-4 → ac-21
- verifies: t-4 → ac-22
- verifies: t-4 → ac-24

t-3 — Draw a ready owned-house route once [derived; fresh]
contains active
definitionId: sha256:a4eb682ecbf2c453b6c253a536cccd12bc84001af5c00d5db89a196bd231d6aa
# Draw a ready owned-house route once

> In the test-build panel select a currently ready human-owned house-to-target pair, read the current target description, draw once, and wait for that pair to become active.

## Step 1 @verifies ac-14

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena; at the default 0.25x speed, locate the bottom panel's outgoing route groups, then assert these groups have human-owned house headings rather than tower source headings.

## Step 2 @verifies ac-8, ac-16

In a human-owned house's bottom-panel outgoing group, choose a pair whose live button says ready and displays the target's current colour and level; click that ready button once and wait for the same pair's button to show active, then assert the requested source-to-target pair is active.
Citations / relations:
- automates: t-3 → sc-3
- verifies: t-3 → ac-8
- verifies: t-3 → ac-16
- verifies: t-3 → ac-14

t-6 — Draw a ready route once on double-click [derived; fresh]
= 1 drawn line for the selected source-target pair
definitionId: sha256:e0f38d8032e84775fe4f113a49da6d3eaa59c3f303da58c7431681c04ed1c64d
# Draw a ready route once on double-click

> On an owned ready route, double-click the panel button and observe one active drawn route rather than an immediate cut.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the browser to enter Kane Arena at Speed 0.25x; in the bottom outgoing-routes panel identify a live green ready pair under a human-owned house.

## Step 2 @verifies ac-25

On the identified ready pair's button, double-click and inspect the resulting route in the arena and its panel state, then assert that exactly one line for that source-target pair was drawn and its button shows active rather than being immediately cut.
Citations / relations:
- automates: t-6 → sc-6
- verifies: t-6 → ac-25

t-5 — Keep an active route after one click [derived; fresh]
exists: the active route after a single click
definitionId: sha256:55da62e4eb027c33abfdbb9b27341aef7d84d991944fc4eaca6e956aea68d787
# Keep an active route after one click

> Draw a ready owned route, then click its active button once and observe the active route remains.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the browser to enter Kane Arena at Speed 0.25x; identify a live green ready pair in the bottom outgoing-routes panel under a human-owned house.

## Step 2

Draw that ready pair and wait for the same outgoing-routes button to display active.

## Step 3 @verifies ac-23

On the red active button for that same pair in the outgoing-routes panel, click once, then assert that the pair remains active.
Citations / relations:
- automates: t-5 → sc-5
- verifies: t-5 → ac-23

t-8 — Observe defeat despite human troops in flight [derived; fresh]
= Defeat
definitionId: sha256:785fcb2f8ce3d6b9a925479ea53b6ddb570371bedfc2459a3d9e97306f75a9e9
# Observe defeat despite human troops in flight

> Let the last non-ignored human building fall despite remaining troops in transit and observe defeat without campaign completion.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena at default Speed 0.25x and locate the panel of outgoing routes grouped by human-owned houses.

## Step 2 @verifies ac-29, ac-35, ac-36, ac-38, ac-41

From the Kane Arena route panel, draw a live ready route from a human-owned house and allow its troops to enter transit while the remaining non-ignored human-owned buildings fall; on match end, then assert the result is `Defeat` despite human troops in flight, the feedback banner reads `Game over`, panel buttons are disabled, and the result dialog title reads `Defeat`.
Citations / relations:
- automates: t-8 → sc-8
- verifies: t-8 → ac-29
- verifies: t-8 → ac-35
- verifies: t-8 → ac-36
- verifies: t-8 → ac-38
- verifies: t-8 → ac-41

t-9 — Observe timeout on a configured Kane level [derived; fresh]
= Time up
definitionId: sha256:5e363277b2c384f6b1a1af34f22376f39c7664ebbc4af762d14948882b6370fd
# Observe timeout on a configured Kane level

> On a level with timeLimitSec set, reach the phase-9 tick threshold with mixed ownership and no prior win or loss, and observe timeout loss.

## Step 1

Open {{timed_level_url}} in the Kane Arena test build, on a level configured with timeLimitSec and mixed ownership; use its match panel at Speed 0.25x.

## Step 2 @verifies ac-32, ac-35, ac-36, ac-39

On the timed Kane Arena level, keep at least one non-ignored building human-owned and at least one not human-owned until tick reaches timeLimitSec × tickRate at phase 9; after the deadline, then assert the result text reads `Time up`, the banner reads `Game over`, and the panel buttons are disabled.
Citations / relations:
- automates: t-9 → sc-9
- verifies: t-9 → ac-32
- verifies: t-9 → ac-35
- verifies: t-9 → ac-36
- verifies: t-9 → ac-39

t-1 — Replace a same-owner reverse route without recalling troops [derived; fresh]
exists: same-owner old reverse line after replacement
definitionId: sha256:3158e117967f67cfee13487bc35c208f4a113d2b2a0c948f4ffba091b23c2c0c
# Replace a same-owner reverse route without recalling troops

> From two human-owned houses, draw an outgoing line and reverse it from the destination after confirming a ready reverse route; the old reverse line disappears while previously launched troops continue.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena; keep the default 0.25x speed and use the bottom route panel.

## Step 2

In Kane Arena, establish a live match with two human-owned houses and identify their letter-tagged route buttons where one direction can be drawn and the reverse direction can subsequently show ready.

## Step 3

In the bottom panel, draw the ready route from the first owned house to the second exactly once, wait for that button to show active, and observe a troop already in flight toward the second house.

## Step 4 @verifies ac-8, ac-9, ac-10

In the second human-owned house's outgoing group, draw the ready reverse route exactly once while that troop is still in flight, wait for the reverse button to show active, then assert the new ordered pair is active, the original-direction pair is no longer active, and the already-in-flight troop continues toward its original target.
Citations / relations:
- automates: t-1 → sc-1
- verifies: t-1 → ac-8
- verifies: t-1 → ac-9
- verifies: t-1 → ac-10

t-2 — Unavailable no-free route alerts without drawing [derived; fresh]
= This building has no free routes.
definitionId: sha256:53dad30fe1108211fe9094631f70bafdec91e775e8ec5f2c4248bba4c83b76ff
# Unavailable no-free route alerts without drawing

> When a live owned-house pair shows no free route, click its still-enabled unavailable button and observe the exact alert without drawing or cutting.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 in the test build of Kane Arena; keep the default 0.25x speed and use the bottom route panel.

## Step 2

In a human-owned house's bottom-panel outgoing group, use currently ready routes as needed to reach a live grey route button whose text says `no free route`; do not assume any particular pair is unavailable in advance.

## Step 3 @verifies ac-6, ac-15, ac-17

In that house's outgoing group, use the still-clickable grey `no free route` button for its displayed pair, then assert the red alert banner reads exactly `This building has no free routes.`, the selected pair is not active, and its unavailable button remains clickable.
Citations / relations:
- automates: t-2 → sc-2
- verifies: t-2 → ac-6
- verifies: t-2 → ac-15
- verifies: t-2 → ac-17

gap-1 — Blocked route omitted [derived; fresh]
: [object Object]

budget-evicted
risk: medwhy: A route crossing an obstacle could be incorrectly accepted; the panel omits blocked pairs and the ceiling excludes the path.
ref: s4
Citations / relations:
- No citation relations recorded.

gap-11 — Duplicate pair [derived; fresh]
: [object Object]

invariant-unexercised
risk: medwhy: An active pair is a cut button rather than a second draw control.
ref: ac-5
Citations / relations:
- No citation relations recorded.

gap-2 — Duplicate route omitted [derived; fresh]
: [object Object]

budget-evicted
risk: medwhy: Duplicate route commands could make extra lines; active panel buttons are not duplicate draw commands.
ref: s5
Citations / relations:
- No citation relations recorded.

gap-14 — Early double-click [derived; fresh]
: [object Object]

budget-evicted
risk: medwhy: An early double-click might accidentally cut a route; the exact threshold is not checked under the three-pair ceiling.
ref: s5
Citations / relations:
- No citation relations recorded.

gap-19 — Final-tick precedence [derived; fresh]
: [object Object]

invariant-unexercised
risk: medwhy: The final-tick victory path is distinct from ordinary victory or timeout and was budget-evicted; no selected scenario exercises ac-33.
ref: ac-33
Citations / relations:
- No citation relations recorded.

gap-17 — Final-tick victory path [derived; fresh]
: [object Object]

budget-evicted
risk: medwhy: Score 70: final-tick precedence is distinct but needs the same currently absent timed fixture; scenario omitted by the explicit maximum of three.
ref: s4
Citations / relations:
- No citation relations recorded.

gap-12 — Hostile reverse [derived; fresh]
: [object Object]

invariant-unexercised
risk: medwhy: None of the selected journeys starts with a hostile reverse line.
ref: ac-11
Citations / relations:
- No citation relations recorded.

gap-5 — Hostile reverse omitted [derived; fresh]
: [object Object]

budget-evicted
risk: medwhy: Replacing a hostile reverse line would incorrectly erase an enemy route.
ref: s8
Citations / relations:
- No citation relations recorded.

gap-10 — Invalid target [derived; fresh]
: [object Object]

invariant-unexercised
risk: medwhy: Neither invalid target is exposed as a ready route button.
ref: ac-4
Citations / relations:
- No citation relations recorded.

gap-3 — Level drop omitted [derived; fresh]
: [object Object]

budget-evicted
risk: highwhy: Automatic cutting could irreversibly remove valid lines after a level drop.
ref: s6
Citations / relations:
- No citation relations recorded.

gap-7 — Level-drop lines [derived; fresh]
: [object Object]

invariant-unexercised
risk: highwhy: An automatic cut can lose established lines and none of the selected journeys lowers level.
ref: ac-12
Citations / relations:
- No citation relations recorded.

gap-13 — Non-owner cut [derived; fresh]
: [object Object]

budget-evicted
risk: highwhy: An authorization error could remove another player's line; omission is due to explicit three-pair ceiling and no documented browser entry point.
ref: s4
Citations / relations:
- No citation relations recorded.

gap-8 — Obstacle rejection [derived; fresh]
: [object Object]

invariant-unexercised
risk: medwhy: A blocked command is distinct from the clickable no-free failure.
ref: ac-7
Citations / relations:
- No citation relations recorded.

gap-4 — Ownership gate omitted [derived; fresh]
: [object Object]

budget-evicted
risk: highwhy: Unowned-source rejection is an authorization rule, and unowned houses have no outgoing panel group.
ref: s7
Citations / relations:
- No citation relations recorded.

gap-15 — Ownership surface [derived; fresh]
: [object Object]

invariant-unexercised
risk: highwhy: Non-owner removal is an authorization violation; no retained path or documented panel action tests that boundary.
ref: ac-18
Citations / relations:
- No citation relations recorded.

gap-20 — Timed level URL [derived; fresh]
: [object Object]

incomplete
risk: medwhy: The published test URL opens an untimed campaign level; no timed entry point is documented, so the timeout test cannot run until {{timed_level_url}} is filled.
ref: sc-9
Citations / relations:
- No citation relations recorded.

gap-16 — Timer observability [derived; fresh]
: [object Object]

invariant-unexercised
risk: medwhy: No panel timer diagnostic is described; visual no-new-departures evidence cannot establish internal timer cessation.
ref: ac-20
Citations / relations:
- No citation relations recorded.

gap-9 — Tower source [derived; fresh]
: [object Object]

invariant-unexercised
risk: medwhy: Towers have no outgoing panel group.
ref: ac-3
Citations / relations:
- No citation relations recorded.

gap-21 — Transit defeat fixture [derived; fresh]
: [object Object]

incomplete
risk: medwhy: The source states the loss rule and documents seed 1, but does not establish that this exact transit-defeat state is reachable through the panel from seed 1.
ref: sc-8
Citations / relations:
- No citation relations recorded.

gap-6 — Unowned source [derived; fresh]
: [object Object]

invariant-unexercised
risk: highwhy: Ownership authorization has no selected scenario and no unowned source group in the browser panel.
ref: ac-2
Citations / relations:
- No citation relations recorded.

gap-18 — Untimed duration path [derived; fresh]
: [object Object]

budget-evicted
risk: lowwhy: Score 55: proving the absence of any time limit in finite play is difficult; its marginal coverage is lower than the three outcome families.
ref: s5
Citations / relations:
- No citation relations recorded.
