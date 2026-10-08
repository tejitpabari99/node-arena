# Node Arena — Game Rules

RULES_VERSION: 1.0.0

This is the mechanics contract. Authored content owns tunable values; rules name the resolved parameters after archetype inheritance and level overrides. The simulation must follow these rules. Presentation, bots and tools consume the same mechanics.

## 1. Conventions

Rule IDs have the form `R-<AREA>-<NN>` and are permanent. Areas are `GEN` generation, `SND` sending, `LIN` lines, `CAP` capacity, `CMB` combat, `CPT` capture, `WIN` outcomes, `TCK` ticks and `ENT` entities. Removed rules remain as tombstones; IDs are never reassigned. Every implemented rule needs a test named `covers R-…`. Each rule below records its parameters, an example reference and its first rules version.

`RULES_VERSION` uses semver: major for a change to replay outcomes for existing content, minor for an additive rule or component, patch for a clarification. Replay compatibility requires an exact major.minor match; content identity and the replay header must also pass the content/replay validation contract. The content metadata mirrors this header. A mechanics change updates this document and changelog, then tests, then implementation. A value change edits content and its content version/hash without changing a rule.

### R-TCK-01

The engine constant is `tickRate = 20` ticks per simulation second. A step advances one fixed tick and has no wall-clock dependency. Pause stops steps; normal and accelerated play change only how often the driver steps. A finished match accepts no further simulation changes.

*Params:* None; `tickRate` is a rules constant, recorded in replays, not a balance parameter.

*Examples:* E-TICK.

*Since:* 1.0.0.

### R-TCK-02

Authored fixed-point fields have at most three decimal places and compile at `numericScale = 1000`. Simulation state and arithmetic use integers. Integer division truncates toward zero; for non-negative operands this is floor. Multiply before dividing in a multiply-divide expression, using an exact, range-checked intermediate. Integer square root returns the greatest integer whose square does not exceed its input. No floating-point approximation, trigonometry or wall-clock value may influence outcomes.

*Params:* Fixed-point fields including `generates.ratePerSec`, troop `speed`, tower `pos`; scale and rounding are rules constants, not tunables.

*Examples:* E-TICK.

*Since:* 1.0.0.

### R-TCK-03

Players and towers iterate by ascending stable ID, compiled to that same dense-index order. Channels iterate by source index, then target index. Commands in a step are stably ordered by player index and retain submission order within a player. Troops in a channel retain FIFO order. All tie-breaks use these explicit orders; random behaviour, when supported, must use the recorded seed. Current v1 mechanics do not consume randomness.

*Params:* Player/tower `id`; replay `seed`.

*Examples:* E-ARRIVAL.

*Since:* 1.0.0.

### R-TCK-04

Troop progress uses `numericScale × tickRate` units per world unit. Each tick advances progress by troop `speedMilli`, the compiled form of troop `speed`, with no per-tick rounding. For source/target position differences in milli-units, line length is `isqrt((dx × tickRate)² + (dy × tickRate)²)` in progress units. A departing troop begins at zero progress in its departure tick; later progress is elapsed ticks times its speed. Movement may be evaluated analytically rather than by mutating every troop.

*Params:* Tower `pos`; troop `speed` / compiled `speedMilli`.

*Examples:* E-TICK.

*Since:* 1.0.0.

### R-TCK-05

Each tick follows the phase order in §4. Capture happens inline during the arrival that empties a garrison. Slot enforcement finishes before outcomes or state are exposed; no completed step exposes more drawn lines than slots.

*Params:* `drawsLines.extraSlotAbove`, `garrison.cap`, `timeLimitSec`.

*Examples:* E-SLOTS, E-ARRIVAL.

*Since:* 1.0.0.

## 2. Entities

### R-ENT-01

A tower has a stable ID, position, owner (or neutral), garrison and an archetype composed of supported components. `garrison` supplies capacity, `generates` supplies a troop kind and generation rate, `drawsLines` supplies outgoing line slots, and `capturable` permits ownership changes. An absent component supplies no behaviour. Unknown components or unsupported values are content errors, never silently ignored.

*Params:* Tower `id`, `pos`, `owner`, initial `garrison`; archetype `components`, `garrison.cap`, `generates.troop`, `generates.ratePerSec`, `drawsLines.extraSlotAbove`.

*Examples:* E-GENERATION; future components are specified in §6.

*Since:* 1.0.0.

### R-ENT-02

A troop has an owner fixed at departure, a troop kind, remaining combat value and progress in a directed channel. V1 supports regular troops with unit value; other values are rejected until their support ships. Speed and visual identity come from its kind; visuals never affect mechanics.

*Params:* Troop `value`, `speed`, `visual`; `generates.troop`.

*Examples:* E-CAPTURE.

*Since:* 1.0.0.

### R-ENT-03

A drawn line authorizes future departures along a directed source-to-target channel. A channel retains its FIFO of in-flight troops after its line is cut or replaced. A line's owner and draw sequence record who drew it and when; a channel is identified by its ordered tower pair.

*Params:* Source/target tower `id`; troop `speed`.

*Examples:* E-CUT.

*Since:* 1.0.0.

### R-ENT-04

A player's team defaults to that player's ID. Friendly means the same team; hostile means a different team, with neutral towers hostile to owned troops. V1 levels have distinct teams, so ownership also determines friendship. Human players and bots submit identical commands, pass identical validation and receive no mechanical privileges. Team play is reserved for §6.

*Params:* Player `id`, `team`, `kind`; tower `owner`; troop owner.

*Examples:* E-ARRIVAL.

*Since:* 1.0.0.

## 3. Rules by area

### R-GEN-01

An owned tower with `generates` produces `generates.troop` automatically at `generates.ratePerSec`. A neutral tower holds its starting garrison and does not generate. A tower without `generates` does not generate.

*Params:* Tower `owner`, initial `garrison`; `generates.troop`, `generates.ratePerSec`.

*Examples:* E-GENERATION.

*Since:* 1.0.0.

### R-GEN-02

Each generating tower has one integer accumulator. During an eligible generation tick add compiled `ratePerSecMilli`; emit a troop for each complete `numericScale × tickRate` accumulator units and retain the remainder. Generated troops either enter the garrison when no line is drawn or enter the departure allocation when a line is drawn, subject to R-CAP-01 and R-CAP-02. The accumulator is shared across all outgoing lines.

*Params:* `generates.ratePerSec`, `generates.troop`, `garrison.cap`.

*Examples:* E-GENERATION, E-CAP.

*Since:* 1.0.0.

### R-SND-01

Sending is generation routed directly into departures. Stored garrison is never dispatched. Drawing a line does not spend garrison, and sending alone neither raises nor lowers the garrison. Friendly arrivals may still raise it and hostile arrivals may lower it. A line remains drawn after input is released and sends until cut, replaced or cancelled.

*Params:* `generates.ratePerSec`, `generates.troop`; current garrison.

*Examples:* E-GENERATION, E-CUT.

*Since:* 1.0.0.

### R-SND-02

Each generated troop departs on exactly one drawn outgoing line. Choose targets round-robin in ascending target-index order after the tower's cursor, wrapping at the end, then advance the cursor to the chosen target. An initial or reset cursor starts with the lowest target index. If the previous target is absent, continue from its ordered position. Multiple lines share the tower's generation, so total departures equal generated troops rather than multiplying by line count.

*Params:* `generates.ratePerSec`, `generates.troop`; target tower `id`.

*Examples:* E-GENERATION.

*Since:* 1.0.0.

### R-LIN-01

Only a tower's owner may draw its outgoing lines, and the source must have `drawsLines`. Self-lines and duplicate directed source-to-target lines are forbidden. Drawing needs an available slot after any eligible reverse-line replacement. Commands are validated fully before mutation; rejection leaves state unchanged. Sources and targets must exist.

*Params:* Tower `owner`, `id`; `drawsLines.extraSlotAbove`.

*Examples:* E-LINES.

*Since:* 1.0.0.

### R-LIN-02

A tower has one base slot plus a slot for every threshold in `drawsLines.extraSlotAbove` strictly less than its current garrison. Equality does not qualify. At the end of every tick, after arrivals and capture, cut the newest drawn outgoing line by greatest draw sequence repeatedly until the line count fits the current slots.

*Params:* `drawsLines.extraSlotAbove`; current garrison.

*Examples:* E-SLOTS.

*Since:* 1.0.0.

### R-LIN-03

Drawing a line between towers owned by the same player replaces that player's drawn reverse line if it exists. Replacement cuts only the reverse line's permission for new departures; its troops remain in transit. A reverse line between hostile towers may coexist and is subject to head-on clash.

*Params:* Source/target `owner`, `id`; `drawsLines.extraSlotAbove`.

*Examples:* E-LINES, E-CUT.

*Since:* 1.0.0.

### R-LIN-04

Lines follow straight tower-to-tower paths. Lines may geometrically cross; unrelated crossings cause no combat or blocking. Roads are decoration and never affect routing or speed. V1 has no functional obstacles or map objects.

*Params:* Tower `pos`; troop `speed`; level `obstacles`, `mapObjects` (empty in v1).

*Examples:* E-LINES.

*Since:* 1.0.0.

### R-LIN-05

A player may cut a drawn line they own. Swipe across a line and right-click on it are input gestures for the same cut command. Cutting stops future departures immediately but in-flight troops keep moving, clashing and arriving with their original allegiance.

*Params:* Line owner; troop `speed`.

*Examples:* E-CUT.

*Since:* 1.0.0.

### R-CAP-01

Capacity gates additions to garrison only. Generated troops entering garrison and friendly arrivals add at most the room below `garrison.cap`; all excess value is lost. Overflow is never stored elsewhere or rerouted. Hostile hits and routed departures are not blocked by capacity.

*Params:* `garrison.cap`, `generates.ratePerSec`; troop `value`.

*Examples:* E-CAP.

*Since:* 1.0.0.

### R-CAP-02

At capacity with a drawn outgoing line, a tower keeps generating and sending at `generates.ratePerSec`. At capacity with no drawn line, generation stops: its accumulator does not advance and no generation is banked. A previously earned fractional remainder may remain, but elapsed capped ticks contribute nothing and create no later burst. If garrison generation fills the remaining room, excess complete generation units in that tick are discarded rather than banked.

*Params:* `garrison.cap`, `generates.ratePerSec`; current drawn lines.

*Examples:* E-CAP.

*Since:* 1.0.0.

### R-CMB-01

Only opposed channels of the same tower pair can produce head-on clashes. Examine only each channel's front (oldest) troop. When the fronts are hostile and their progress sum reaches or exceeds line length, remove the smaller remaining combat value from each front. Remove exhausted fronts and repeat while the new fronts qualify. A friendly front pair does not clash and blocks examination of later troops for that phase. Cut channels still carrying troops remain eligible; unrelated crossing channels pass through.

*Params:* Troop `value`, `speed`; tower `pos`; troop owner/team.

*Examples:* E-CLASH.

*Since:* 1.0.0.

### R-CMB-02

After clash, arrivals with progress at or beyond line length are applied by overshoot (`progress − length`) descending, then channel order, then FIFO. Each arrival determines friendship or hostility against the tower's owner/team at its own turn, including ownership changes caused by earlier arrivals in the same tick. Friendly arrivals reinforce under R-CAP-01.

*Params:* Troop `speed`, `value`; tower `pos`, `owner`; player `team`, `id`.

*Examples:* E-ARRIVAL.

*Since:* 1.0.0.

### R-CMB-03

A hostile arrival of remaining value `v` removes `d = min(v, count)` from the target garrison and expends that same value from itself. If the garrison reaches zero and the tower has `capturable`, it immediately flips to the arriver and the leftover `v − d` becomes its new garrison. Exact depletion therefore captures with an empty garrison. An arrival at an already empty capturable tower flips it and contributes its full remaining value. Capacity still bounds any resulting garrison.

*Params:* Troop `value`; `garrison.cap`; `capturable`; current garrison.

*Examples:* E-CAPTURE.

*Since:* 1.0.0.

### R-CPT-01

Capture changes the tower owner immediately, cancels the previous owner's drawn outgoing lines, and resets the tower's generation accumulator and send cursor. New ownership governs generation from the next generation phase, never retroactively in the current tick. Archetype, capacity, position and component parameters do not change on capture.

*Params:* Tower `owner`, `pos`; `capturable`; `generates.ratePerSec`, `generates.troop`, `garrison.cap`.

*Examples:* E-CAPTURE, E-ARRIVAL.

*Since:* 1.0.0.

### R-CPT-02

Capture preserves incoming lines and all in-flight troops, including troops on cancelled outgoing lines. Troops keep their departure owner; every later arrival re-evaluates attack or reinforcement against current ownership. Owner colour, labels and other presentation follow the resulting state without affecting mechanics.

*Params:* Tower `owner`; troop owner; player `colorKey`; archetype/troop `visual`.

*Examples:* E-ARRIVAL, E-CUT.

*Since:* 1.0.0.

### R-WIN-01

A player remains alive while they own any tower or troop in transit. Elimination occurs only when both are absent, checked after slot enforcement. Neutral towers do not count as opponents. The human wins when alive and every opposing player has no towers and no troops in transit, subject to R-WIN-03.

*Params:* Tower `owner`; troop owner; player `team`, `kind`.

*Examples:* E-OUTCOME.

*Since:* 1.0.0.

### R-WIN-02

If the human is eliminated while an opponent remains alive, the outcome is loss. If no team remains alive, the outcome is mutual defeat (`draw`) and the level is not completed. A win marks the level completed; loss, draw and timeout do not. Campaign completion grants no persistent troop or tower stat upgrades.

*Params:* Player `team`, `kind`; tower and troop owner.

*Examples:* E-OUTCOME.

*Since:* 1.0.0.

### R-WIN-03

The level uses its `timeLimitSec`, or `balance.defaults.timeLimitSec` when omitted. At the outcome phase, `tick ≥ timeLimitSec × tickRate` ends the match as timeout, a loss. Reaching the limit takes precedence over a victory or elimination result in that same tick. Once an outcome is recorded, later input or driver steps cannot alter it.

*Params:* Level `timeLimitSec`; `balance.defaults.timeLimitSec`.

*Examples:* E-OUTCOME.

*Since:* 1.0.0.

## 4. Tick phase order

R-TCK-05 fixes this order. Iteration and ties follow R-TCK-03 throughout.

| Order | Phase | Required effect |
|---|---|---|
| First | Apply commands | Canonicalize, validate and atomically apply draw/cut commands. |
| Next | Generation | Update eligible owned towers' accumulators; produce garrison additions or departure units. |
| Next | Departures | Allocate generated departure units round-robin; never remove stored garrison. |
| Implicit | Movement | Evaluate integer progress for this tick, with newly departed troops at zero. |
| Next | Clash | Resolve eligible hostile head-on fronts before tower arrivals. |
| Next | Arrivals + capture | Apply overshoot/channel/FIFO order; capture inline on a hit leaving zero. |
| Next | Line-slot enforcement | Recompute slots from final garrison and auto-cut newest lines until within slots. |
| Last | Win/lose/time check | Update elimination, apply the time boundary and determine outcome; expose final state. |

Generation and departures precede arrivals. A reinforcement cannot generate another troop in the same tick. A captured tower cannot generate for its new owner until a later tick. A garrison drop can temporarily exceed its slots internally, but enforcement completes before observable state.

## 5. Worked examples and edge cases

These labelled examples assume the stated data values. They illustrate rules; editing content changes the values without changing the mechanics.

**E-TICK — fixed-point motion and scheduling.** Assume troop `speed = 3.001` world units/second and a straight line of length `6.002` world units. Compiled speed is `3001` milli-units; line length is `120040` progress units. A troop advances `3001` progress units each tick and arrives after `40` elapsed ticks. For a rounding example, `idiv(-7, 3) = -2` and `isqrt(15) = 3`. Pause leaves tick/progress unchanged; running the same commands faster changes real duration only.

**E-GENERATION — frozen stack and shared stream.** Assume an owned tower starts with `garrison = 12`, `garrison.cap = 50`, `generates.ratePerSec = 1.5`, `generates.troop = regular`, regular `value = 1`, and `drawsLines.extraSlotAbove = [10, 30]`. With no line and an empty accumulator, the first generated troop is available after `14` ticks; the accumulator retains `1000` units. With two drawn lines, successive generated troops alternate between targets in ID order and the total rate remains `1.5` troops/second. Sending alone leaves garrison `12`. A neutral tower with the same components and starting count generates nothing.

**E-SLOTS — strict thresholds and newest cut.** Assume `drawsLines.extraSlotAbove = [10, 30]`. Counts `10`, `11`, `30`, `31` allow respectively `1`, `2`, `2`, `3` lines. A tower with three lines that ends arrivals at count `30` loses its newest line before the step returns. If the count reaches `10`, enforcement cuts newest lines repeatedly until only one remains.

**E-CAP — no bank, sending at capacity, overflow.** Assume `garrison.cap = 50`, regular `value = 1` and `generates.ratePerSec = 1`. At count `50` with no line, waiting contributes nothing to the generation accumulator. Drawing a line enables the normal stream immediately, with no burst for the time spent waiting. At count `50` with a line already drawn, sending continues and garrison remains `50`. At count `49`, three friendly regular arrivals produce count `50` and lose two arrivals to overflow. If a generation batch contains three troops with only one garrison space, one is stored and two are lost.

**E-LINES — validation, replacement and crossings.** Assume player `p1` owns towers `a` and `b`, each with an available outgoing slot, while `p2` owns `c`. Drawing `a→a` fails; drawing `a→b` twice fails on the duplicate. Drawing `a→b` while `b→a` is drawn replaces that reverse line. Drawing `a→c` while `c→a` exists can preserve both, creating head-on combat. A geometric crossing with a different endpoint pair has no effect.

**E-CUT — persistence and allegiance.** Assume `a→b` is drawn and already carries two regular troops owned by `p1`. Releasing the drawing gesture leaves the line active. Cutting it by swipe or right-click stops subsequent departures; both existing troops complete their journeys, subject to clash. Capturing `a` changes neither troop's owner nor destination. Reverse-line replacement has the same effect on already departed troops.

**E-CLASH — only fronts.** Assume channel length `100`, regular front progress `60` on `a→b` and `40` on `b→a`, each value `1` and hostile. The sum reaches length, so both fronts cancel. Repeat on their next fronts only if that pair also reaches length. With progress `59` and `40`, they do not yet clash. Cutting either line does not protect its troops from a later clash.

**E-CAPTURE — exact depletion and empty targets.** Assume a capturable tower has garrison `1` and regular arrival value `1`. The hostile arrival removes `1`, flips ownership immediately and leaves garrison `0`. A subsequent hostile regular troop hitting that empty tower flips it again and leaves garrison `1`. More generally, a hit uses `min(v, count)` and retains `v − d` for the capturer; a higher-valued tank example belongs to the unimplemented future spec below.

**E-ARRIVAL — re-evaluation after inline capture.** Assume `p2` owns a capturable tower with garrison `1`, cap `50`, and three regular arrivals. A `p1` arrival with overshoot `9` captures first and leaves count `0`. A `p1` arrival with overshoot `6` now reinforces, making count `1`. A `p2` arrival with overshoot `2` now attacks and recaptures with count `0`. Exact overshoot ties use channel order, then FIFO. Outgoing lines of each displaced owner are cancelled; incoming lines persist.

**E-OUTCOME — transit, mutual defeat and timeout.** Assume `timeLimitSec = 300`. An opponent with no towers but one troop in transit is still alive, so the human has not won. When that opponent's last troop disappears and the human remains alive, the human wins unless the time boundary has been reached. At tick `6000` the match times out, including if the last opponent disappears that tick. If all players have no towers or troops in the same earlier tick, the result is mutual defeat and no completion. Selecting or completing a campaign level never grants stat upgrades.

## 6. Planned v2/v4 — not implemented

These are future component specifications, not active rules or registry entries. V1 validation rejects `shoots`, unsupported troop values, non-empty `mapObjects` and non-empty `obstacles`. A new behaviour must ship its schema/registry support, permanent rule IDs, simulation implementation and tests together. Future tuning values belong in content.

| Future spec | Intended behaviour | Current status |
|---|---|---|
| `shoots{ratePerSec, radius, targeting: nearestHostile\|randomHostile}` | A ranged component shoots one troop per shot within `shoots.radius`, at `shoots.ratePerSec`. Archer tuning is slower than ordinary generation. Owned archers target hostile troops, including attackers; neutral archers choose among all troops in radius with the seeded PRNG. Nearest targeting needs a deterministic tie order when implemented. | Not implemented; validator rejects. |
| Archetype `archer` = `garrison` + `capturable` + `shoots` | Holds garrison, accepts reinforcements and can be captured; has no `generates` or `drawsLines`, so neither generates nor draws lines. | Not implemented; validator rejects `shoots`. |
| Troop kind `tank`, using troop `value` | Combat and reinforcement operate in value units; a tank-producing tower would select this kind through `generates.troop`. | Not implemented; validator rejects values outside the v1 unit-value range. |
| `mapObjects` kind `gate{delta}` | A positive value modifier on a crossed map object, with position/footprint. Crossing order and application need future rules. | Not implemented; validator rejects non-empty map objects. |
| `mapObjects` kind `hazard{delta}` | A negative value modifier on a crossed map object, with position/footprint. Exhaustion and crossing order need future rules. | Not implemented; validator rejects non-empty map objects. |
| `mapObjects` kind `wall{hp}` and obstacle kinds | A breakable wall or obstacle with future line-of-sight/blocking rules; functional geometry must be specified before support. | Not implemented; validator rejects non-empty map objects/obstacles. |
| V4 teams using player `team` | Allow shared team IDs and determine victory by surviving team. Allied routing, replacement and mixed-front behaviour require future rules; v1 content requires distinct teams. | Not implemented as a playable mode. |

**E-V2-TANK — future example, not v1 content.** Assume tank `value = 2` and a capturable target with garrison `1` and cap `50`. Under future value-unit combat, the tank expends `1` against defenders, captures and leaves garrison `1`. A tank against two regular troops cancels combat value `2`. These data values are rejected by v1 validation.

## 7. Changelog

| RULES_VERSION | Date | Change |
|---|---|---|
| 1.0.0 | 2026-10-08 | Initial mechanics contract: parameter-based generation/sending, strict slots with end-of-tick enforcement, capacity without banking, front-only head-on combat, ordered arrivals with inline zero capture, fixed integer ticks, outcomes and unimplemented future component specs. Includes the resolved rule that capped towers keep sending when a line is drawn and stop generation when no line is drawn. |
