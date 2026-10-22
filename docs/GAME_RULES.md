# Node Arena — Game Rules

RULES_VERSION: 2.0.0

This is the mechanics contract for the Tower War (APK 1.29.3) port. It is a full rewrite; there are no profiles and no v1 compatibility. Rules own **structure and formulas**; every tunable number (speeds, coefficients, caps, radii, thresholds) lives in authored content under a named parameter, and rules only name the resolved parameter. The simulation must follow these rules; presentation, bots and tools consume the same mechanics. Tower War defaults appear only in the §7 glossary and in the §5 worked examples.

## 1. Conventions

**Rule IDs and areas.** Rule IDs have the form `R-<AREA>-<NN>` and are permanent. Areas: `TCK` ticks and determinism, `ENT` entities, `SPN` spawn, `GRW` growth, `LIN` lines, `CAP` level and overflow, `CMB` combat, `CPT` capture, `TWR` towers, `OBS` obstacles, `WIN` outcomes. Retired areas `GEN` (generation) and `SND` (sending) exist only as tombstones.

**Id policy.** A rewritten topic keeps its id and records `Since: 2.0.0` plus `Supersedes:` when v1 text meant something different. A dead topic is tombstoned and its id is never reused or reassigned. Tombstones stay listed under "Retired ids" in §3: GEN-01, GEN-02, SND-01, SND-02, CAP-02. Every active rule needs a test whose title contains `covers R-…` (ownership table in §8). A heading is an active rule unless it is marked tombstone; §6 contains no rule headings until an element ships.

**Rule layout.** Each rule is a `### R-AREA-NN` heading followed by the statement, then `*Source:*` (research or decomp cite), `*Params:*` (content keys, glossary in §7), `*Examples:*` (E-ids in §5), `*Since:*` and optional `*Supersedes:*`. Research cites use `03#x.y` / `06 §n` for `docs/research/tower-wars/`; "decomp" means `Game.Main.*` decompilation of the APK. Where documents disagree, decomp wins (§8 contradiction table).

**Numbers.** Rule text contains no tunable literal. The only literals allowed are structural constants: `20` (`tickRate`), `1000` (`numericScale`, one tick = 1000 milli-ticks), `1_200_000` (60 s × 20 Hz × 1000), `60000` (the 60 s offset of the TW spawn/delay curve in milli-seconds), `900_000` (growth base scale), `1_000_000` (`numericScale` squared, for the growth square root), `50` (ms per tick) and `10` (growth step, `k = idiv(L, 10) + 1`). Everything else is a content key.

**Notation.** `idiv(a, b)` = integer floor division of non-negative operands; `isqrt(n)` = greatest integer whose square does not exceed `n`. A suffix `_m` marks a content value stored in thousandths (for example `ws_m = 500` for `ws = 0.5`). `mt` = milli-ticks, 1 tick = 1000 mt, 1 second = 20 ticks = 20_000 mt. `L` = building level, `n` = number of lines of a house, `K` = line penalty factor. Multiply before dividing, with every intermediate range-checked below 2^53 (R-TCK-02).

**Terms.**
- *Building*: a map entity of kind `house` or `tower`. Both hold a *building level*, are owned by a player or neutral, and are capturable.
- *Building level* `L`: integer in `[0, maxLevel]` — garrison and hit points of a building in one number. Not to be confused with a *campaign level* (a playable map).
- *Line*: an owner-drawn directed channel from a source house to a target building (v1 "channel"). Lines are free to draw.
- *Troop*: a unit walking a line; types `soldier` and `tank` (artillery reserved, §6). Type, owner and source building are fixed at departure.
- *Stage*: 1, 2 or 3 as a building level is below the first threshold, between the two, or at or above the second threshold of `stageThresholds` (default `[10, 30]`, §7). Stage drives line slots, tower radius and art (R-GRW-02).
- *Hostile*: different owner. Every non-self owner is hostile, AI against AI included; a neutral building is hostile to every non-neutral troop.

**Versioning.** `RULES_VERSION` uses semver: major for a change to replay outcomes for existing content, minor for an additive rule or element, patch for a clarification. Replay compatibility requires an exact major.minor match; content identity and the replay header must also pass the content/replay validation contract. The content metadata mirrors this header. A mechanics change updates this document and its changelog, then tests (`covers R-…`), then code. A value change edits content and its content version/hash, not a rule. Tunable numbers live in content (`balance.json` and level data).

### R-TCK-01

The engine constant is `tickRate = 20` ticks per simulation second. A step advances one fixed tick and has no wall-clock dependency. Pause stops steps; normal and accelerated play change only how often the driver steps. A finished match accepts no further simulation changes.

*Source:* 06 §1 F1.

*Params:* None; `tickRate` is a rules constant recorded in replays.

*Examples:* E-TICK.

*Since:* 2.0.0.

### R-TCK-02

Authored fixed-point fields have at most three decimal places and compile at `numericScale = 1000`. Simulation state and arithmetic are integers only. Integer division floors for non-negative operands. Multiply before dividing, with an exact intermediate range-checked below 2^53. `isqrt` returns the greatest integer whose square does not exceed its input. No floating point, trigonometry or wall-clock value may influence outcomes.

*Source:* `math.ts` (`isqrt`, Sfc32).

*Params:* `numericScale` (rules constant), every fixed-point content value.

*Examples:* E-TICK, E-SPAWN.

*Since:* 2.0.0.

*Supersedes:* v1 R-TCK-02 (truncation wording).

### R-TCK-03

Iteration orders are explicit and are the only tie-breaks. Players iterate by ascending index; buildings by ascending dense index (stable id order); lines by source building index, then target building index; commands by player index, then submission order; troops in a line in FIFO order, each with a global sequence number `seq` assigned at departure in departure order. Named random streams are `stream(seed, purposeId, entityIdx)` derived from Sfc32 with the replay `seed`; the only sim stream is `fwd` (one stream per building, R-CAP-03). Bot streams `bot.*` are reserved for bots and live outside sim state. A bounded draw uses rejection sampling and is unbiased. Draws happen only in fixed phases (§4) in ascending index order, so a replay consumes identical draws.

*Source:* 06 §1 F1.

*Params:* Replay `seed`.

*Examples:* E-ARRIVAL, E-OVERFLOW.

*Since:* 2.0.0.

*Supersedes:* v1 R-TCK-03.

### R-TCK-04

Progress is measured in `numericScale × tickRate` units per world unit. Each tick a troop advances by `speedMilli`, the compiled form of its type's `speed`; speed is constant per troop type and never changes mid-flight in 2.0.0. Line length between centre positions with milli-unit differences `dx`, `dy` is `isqrt((dx × tickRate)² + (dy × tickRate)²)` progress units. A departing troop starts at progress 0 in its departure tick; afterwards progress is elapsed ticks times `speedMilli`. Movement is analytic (evaluated from departure tick) rather than stepped per troop.

*Source:* v1 R-TCK-04; 03#4.5.

*Params:* `units.*.speed` (compiled `speedMilli`), building `pos`.

*Examples:* E-TICK.

*Since:* 2.0.0.

### R-TCK-05

Each tick follows the nine-phase order in §4. Capture happens inline during the arrival that causes it. There is no slot-enforcement phase. A captured building produces nothing for its new owner until a later tick. Troops killed by a capture are removed immediately and their later arrivals in the same tick do not apply.

*Source:* 03#5.3, 03#4.1.

*Params:* None.

*Examples:* E-ARRIVAL.

*Since:* 2.0.0.

*Supersedes:* v1 R-TCK-05 (eight phases with slot enforcement).

### R-TCK-06

Timers count in milli-ticks and are translated from TW float timers as follows. Each eligible tick `timer += 1000`; the timer fires when `timer >= period(tick)`; on fire `timer -= period`, so the remainder carries; a timer fires at most once per tick; `period` is clamped to at least `1000`. `period` is recomputed every tick from current integer inputs using floor division, multiply before divide, with intermediates below 2^53. Because the timer is compared to the current period, a mid-interval change (a line added or removed, a level change) behaves as in TW (`timer >= SpawnWarriorTime`). Quantisation to tick edges delays an event by 25 ms on average and 50 ms at most and never accumulates (the remainder is carried to 1/1000 tick); independent timers resolve in the TCK-03 order instead of a float race.

**Exemption (tower cooldown).** The tower cooldown (R-TWR-01, R-TWR-02) is not recomputed per tick. It is set once at the fire tick from the tower's current level, then counts down by `1000` per tick, floored at 0, and the tower is ready when it is `<= 0`. Level changes while cooling (growth, hit, capture) do not alter a running cooldown. Spawn and growth timers keep the per-tick recompute.

*Source:* 06 §1 F7; 03#4.1 `UpdateSpawnTimer`; decomp `WaitForSeconds(curAttackDelay)`.

*Params:* None (`1000` is `numericScale`).

*Examples:* E-TIMER, E-TOWER.

*Since:* 2.0.0.

## 2. Entities

### R-ENT-01

A building has a stable id, position, owner (a player or neutral), level, kind (`house` or `tower`) and a derived stage. A house supplies lines, per-line spawning and growth; a tower supplies a shooter. Both are capturable. Obstacles are not buildings (R-OBS-02). Level, owner, kind and parameters come from the building's archetype and level data after inheritance; unknown kinds or unsupported values are content errors, never silently ignored.

*Source:* 03#2, 03#5.5.

*Params:* `buildings.*` (archetype), `maxLevel`, `stageThresholds`, initial level, `ignoreForWin`.

*Examples:* E-SPAWN, E-STAGE.

*Since:* 2.0.0.

*Supersedes:* v1 R-ENT-01 (tower with garrison and components).

### R-ENT-02

A troop has an owner, a source building and a type (`soldier` or `tank`), all fixed at departure, plus hit points and progress on a line. `hp`, `attack` and `defense` are flat per type and come from content, not from the owner. Visual identity never affects mechanics.

*Source:* 03#2.3.

*Params:* `units.*.hp`, `units.*.attack`, `units.*.defense`, `units.*.speed`.

*Examples:* E-EXCHANGE, E-CAPTURE.

*Since:* 2.0.0.

*Supersedes:* v1 R-ENT-02 (value-1 troops).

### R-ENT-03

A line has an owner, a source house, a target building, its own spawn timer (R-SPN-01) and a draw sequence. Troops on a line keep FIFO order. Cutting or replacing a line does not remove its in-flight troops. A line is identified by its ordered source/target pair.

*Source:* v1 R-ENT-03; 03#3.4.

*Params:* None.

*Examples:* E-LINES.

*Since:* 2.0.0.

### R-ENT-04

A player's identity is its team: each player id is its own team. Player kinds are human, ai and neutral. Every owner that is not the same owner is hostile, including AI against AI; a neutral building is hostile to every non-neutral troop. Human players, AI and bots submit identical commands, pass identical validation and receive no mechanical privileges.

*Source:* 03#5.2.

*Params:* Player `id`, `kind`; building `owner`.

*Examples:* E-ARRIVAL.

*Since:* 2.0.0.

*Supersedes:* v1 R-ENT-04 (team field).

## 3. Rules by area

### R-SPN-01

Every line of an owned (non-neutral) house has its own spawn timer, run under R-TCK-06. With `L` the house's current building level and `n` its current number of lines, the period is

`K_m = 1000 + lineSpawnPenalty_m × (n − 1)`

`period mt = idiv(K_m × 1_200_000, spawnSpeed_m × L + 60000)`

Both `L` and `n` are read afresh every tick. `n` counts every drawn line, including surplus lines above the stage's slots (R-LIN-02).

*Source:* 03#4.1 (`T = K·60/(ws·L + 60)`).

*Params:* `spawnSpeed`, `lineSpawnPenalty`.

*Examples:* E-SPAWN, E-TIMER.

*Since:* 2.0.0.

### R-SPN-02

When a spawn timer fires, one troop of the house's `troopType` departs on that line at progress 0 with the next global `seq`. Spawning is free: the house's level does not change. If the number of live troops whose source is this house (troops on cut lines included) is at or above `aliveCap`, the spawn is skipped but the timer is still consumed.

*Source:* 03#4.2, 03#4.4.

*Params:* `balance.spawn.aliveCap`, `troopType`.

*Examples:* E-SPAWN.

*Since:* 2.0.0.

### R-SPN-03

A new line starts with its timer at 0, so its first troop departs after a full period. A line's timer ceases when the line is cut, replaced or cancelled. Neutral buildings never spawn.

*Source:* 03#4.1.

*Params:* None.

*Examples:* E-TIMER.

*Since:* 2.0.0.

### R-GRW-01

An owned (non-neutral) house with zero lines has a growth timer under R-TCK-06. With `k = idiv(L, 10) + 1` the period is

`period mt = idiv((idiv(growthBase_m × 1000, isqrt(k × 1_000_000)) + 1000) × growTime_m, 50)`

(`growthBase_m × 1000` is `900_000` at the TW default). When it fires the level becomes `min(L + 1, maxLevel)`. The timer advances only while the house has zero lines; it persists, unchanged, while any line exists (starting or stopping lines does not reset it) and resets on fire and on capture. Neutral buildings and towers do not grow.

*Source:* 03#4.6; decomp `HouseGrowth` `StartGrowth` / `StopGrowth`, `House.OnGrow`.

*Params:* `growTime`, `balance.growth.base`, `maxLevel`.

*Examples:* E-GROWTH.

*Since:* 2.0.0.

### R-GRW-02

`stage(L) = 1 + (number of entries of stageThresholds that are <= L)`. The stage function is the single source for line slots (R-LIN-02), tower radius (R-TWR-01) and art stage. Thresholds are inclusive.

*Source:* 03#3.2; 06 D8 (thresholds are not serialized).

*Params:* `stageThresholds`.

*Examples:* E-STAGE.

*Since:* 2.0.0.

### R-LIN-01

`DrawLine{from, to}` is valid if and only if: the caller owns the source; the source is a house; the target exists and is not the source; no line from source to target already exists; a free slot exists (after a same-owner reverse-line replacement, R-LIN-03); and the line is not blocked (R-OBS-01). A rejected command changes nothing.

*Source:* 03#3.2.

*Params:* None.

*Examples:* E-LINES, E-BLOCK.

*Since:* 2.0.0.

*Supersedes:* v1 R-LIN-01 (tower sources, slot auto-cut).

### R-LIN-02

A house has `slots = stage(L)` line slots. There is **no auto-cut**: when the level drops (hit, tower shot) a house keeps every drawn line even if `lines > slots`. `free = slots − lines` may be negative; a draw needs `free > 0`. The spawn penalty (R-SPN-01) uses the actual line count.

*Source:* decomp `SetAvailableWays` → `SetAvailableWaysCount` only sets a reactive property; `CalculateFreeWays = avail − count`; no cutter found (03#3.1).

*Params:* `stageThresholds`.

*Examples:* E-STAGE.

*Since:* 2.0.0.

*Supersedes:* v1 R-LIN-02 / v1 slot enforcement (end-of-tick auto-cut of newest lines).

### R-LIN-03

Drawing a line that is the reverse of an existing line of the **same owner** replaces that reverse line: the old line is removed, its troops stay in flight, and the new line starts a fresh timer (R-SPN-03). A reverse line of a **hostile** owner coexists with the new line and creates head-on combat (R-CMB-01).

*Source:* 03#3.2.

*Params:* None.

*Examples:* E-LINES, E-HEADON.

*Since:* 2.0.0.

### R-LIN-04

Lines are straight, centre to centre, free to draw and have no length cap. Line crossings alone do nothing; combat between crossing lines is governed by R-CMB-04 and blocking by R-OBS-01.

*Source:* 03#3.3.

*Params:* None.

*Examples:* E-LINES.

*Since:* 2.0.0.

*Supersedes:* v1 R-LIN-04 (crossings had no effect).

### R-LIN-05

`CutLine{from, to}` by the line's owner removes the line: its spawn timer ceases and no further troops depart. Troops already in flight on the line continue to their target.

*Source:* 03#3.4 (`DestroyWayFrom` stops the spawn timer only).

*Params:* None.

*Examples:* E-LINES.

*Since:* 2.0.0.

### R-CAP-01

A building's level is an integer in `[0, maxLevel]`. A friendly arrival raises the level to `min(L + defense, maxLevel)`, where `defense` is the arriving troop type's `defense`. Any amount above `maxLevel` is surplus handled by R-CAP-03.

*Source:* 03#5.3 (`House.AddLevel`).

*Params:* `maxLevel`, `units.*.defense`.

*Examples:* E-OVERFLOW.

*Since:* 2.0.0.

*Supersedes:* v1 R-CAP-01.

### R-CAP-03

Surplus from R-CAP-01 re-enters play as **one** new troop of the arriving type, departing at progress 0 on a line chosen uniformly at random among the building's outgoing lines (one bounded draw on that building's `fwd` stream). If the building has no outgoing line, or the alive cap (R-SPN-02) is reached, the surplus is lost and no draw is consumed. The forwarded troop is free (level unchanged) and takes the next `seq`.

*Source:* decomp `House.AddLevel`, `TrySpawnAdditionalWarrior`.

*Params:* `balance.spawn.aliveCap`.

*Examples:* E-OVERFLOW.

*Since:* 2.0.0.

### R-CMB-01

Two hostile troops on opposite lines of the same building pair (head-on) fight when their fronts are within `contactDistance`: for the front-most troop of each line, the exchange fires when `progA + progB >= length − contactDistance_m × tickRate`. The exchange is resolved by R-CMB-05; afterwards the new fronts are tested again, repeating while a new pair qualifies. Only fronts fight; troops behind them wait.

*Source:* v1 R-CMB-01; 03#5.2.

*Params:* `balance.contactDistance`.

*Examples:* E-HEADON.

*Since:* 2.0.0.

*Supersedes:* v1 R-CMB-01 (cancel when the progress sum reaches the length).

### R-CMB-02

Arrivals (progress at or beyond line length) are applied in order of overshoot (`progress − length`) descending, then line order (source index, target index), then FIFO `seq`. Each arrival determines friendship or hostility against the building's owner at its own turn, including ownership changes caused by earlier arrivals in the same tick. Friendly arrivals follow R-CAP-01; hostile arrivals follow R-CMB-03.

*Source:* v1 R-CMB-02.

*Params:* None.

*Examples:* E-ARRIVAL.

*Since:* 2.0.0.

### R-CMB-03

A hostile arrival deals `attack` damage (not its hit points) and the troop is consumed whole. With `n = L − attack`: if `n < 0` the building is captured (R-CPT-01) and the **overshoot is discarded**; otherwise `L = n`. Capture therefore needs damage **greater than** the level; damage equal to the level leaves the owner at level 0.

*Source:* 03#5.3 (`Building.TryDoDamageFrom` sets level 0 on overflow; no later "level = leftover").

*Params:* `units.*.attack`.

*Examples:* E-CAPTURE.

*Since:* 2.0.0.

*Supersedes:* v1 R-CMB-03 (leftover value became the new garrison).

### R-CMB-04

Hostile troops on different lines fight when, at any instant within the tick, the distance between their centre-line positions is `<= contactDistance` (the interaction window: the region of lane coordinates `(s, u)` where that distance holds; it covers X-crossings and near-parallel lines closer than `contactDistance`). The test is swept, so a troop cannot tunnel through another in one tick. All contacts in a tick resolve in ascending `(channelKeyA, channelKeyB)` of the ordered-pair channel keys, then `(seqA, seqB)`; sub-tick contact time is ignored. Each contact is an exchange under R-CMB-05; survivors continue and may fight again in the same pass. Same-owner troops never fight. Head-on pairs of the same building pair use R-CMB-01 instead.

*Source:* 06 F9; research 04 D6/R3.

*Params:* `balance.contactDistance`.

*Examples:* E-CROSSING.

*Since:* 2.0.0.

### R-CMB-05

An exchange reads both troops' `attack` first and applies both simultaneously; a troop with `hp <= 0` dies. If both survive, a second round runs (at most two rounds). `defense` plays no part in an exchange.

*Source:* 03#5.2.

*Params:* `units.*.hp`, `units.*.attack`.

*Examples:* E-EXCHANGE.

*Since:* 2.0.0.

### R-CPT-01

Capture (R-CMB-03) changes the building's owner to the arriver's owner and sets its level to 0. The old owner's outgoing lines are cancelled. **Every troop whose source is this building dies, including troops on cut lines and in flight.** The growth timer resets, `ignoreForWin` is cleared, and the new owner's timers start from 0. Neutral owners cannot capture.

*Source:* 03#5.3; decomp `House.SetNewOwner`.

*Params:* None.

*Examples:* E-CAPTURE, E-ARRIVAL.

*Since:* 2.0.0.

*Supersedes:* v1 R-CPT-01 (leftover value became garrison); v1 R-CPT-02 (in-flight troops survived capture).

### R-CPT-02

Capture keeps incoming lines. Troops of other buildings are unaffected. Every later arrival re-evaluates attack or reinforcement against the current owner.

*Source:* v1 R-CPT-02.

*Params:* None.

*Examples:* E-ARRIVAL.

*Since:* 2.0.0.

### R-TWR-01

A tower's attack radius depends on its stage and its attack delay depends on its level:

`radius_m = idiv((attackRadius_m + radiusUpByLevel_m × (stage − 1)) × radiusUnit_m, 1000)`

`delay mt = idiv(speedUpByLevel_m × 1_200_000, attackDelay_m × L + 60000)`

`stage` is R-GRW-02 at the tower's current level. The delay is evaluated once, at fire time (R-TCK-06 exemption).

*Source:* 03#5.5; decomp `Tower` (`coefficientSpeedByLevelUp`, `coefficientRadiusByLevelUp`).

*Params:* `attackDelay`, `attackRadius`, `speedUpByLevel`, `radiusUpByLevel`, `radiusUnit`.

*Examples:* E-TOWER.

*Since:* 2.0.0.

### R-TWR-02

A tower is ready when its cooldown is `<= 0`, its level is at least 1, and its owner is non-neutral — or neutral when `neutralFires` is true. A ready tower fires at the nearest hostile troop with `minRadius < dist <= radius + troopPad` (distances in milli-units, compared as squares via exact integers); ties by distance, then owner index, then troop `seq`. If no troop qualifies it fires at the nearest hostile **house**; towers are never targets of tower shots, and neutral houses are targets only when `hitsNeutralHouses` is true. A tower fires at most one shot per cooldown; the cooldown is then set from the current level (R-TWR-01). A ready tower with no target stays ready.

*Source:* 03#5.5; decomp (trigger reach is the radius plus the troop body radius).

*Params:* `minRadius`, `troopPad`, `hitsNeutralHouses`, `neutralFires`.

*Examples:* E-TOWER.

*Since:* 2.0.0.

### R-TWR-03

A shot at a troop kills it regardless of hit points. A shot at a house lowers its level by 1, floored at 0, and never captures. Bullet flight is visual only and is not simulated; the effect lands on the fire tick.

*Source:* 03#5.5.

*Params:* None.

*Examples:* E-TOWER.

*Since:* 2.0.0.

### R-TWR-04

A tower's cooldown timer persists through capture. A neutral tower fires at every non-neutral owner's troops when `neutralFires` is true (the decomp has no owner gate on firing); the flag exists so that a change of behaviour is a content flag plus a content-version bump, not a rule change.

*Source:* 03#5.5; decomp `Update` / `TryAttackWarrior` / `OnLevelStateChanged` (owner type only toggles the radius indicator).

*Params:* `neutralFires`.

*Examples:* E-TOWER.

*Since:* 2.0.0.

### R-OBS-01

A `DrawLine` is blocked when the segment from source centre to target centre, thickened by `laneHalfWidth` on each side, intersects an obstacle footprint or the footprint of any building other than the two endpoints. Touching is not overlap: tangent contact does not block. An obstacle that overlaps the segment blocks even at an endpoint; the endpoint buildings' own footprints never block. Footprints are `circle` or `box` shapes in archetype data.

*Source:* 03#3.2 `CheckBlock`; 03#14.

*Params:* `laneHalfWidth`, footprints in archetype data.

*Examples:* E-BLOCK.

*Since:* 2.0.0.

### R-OBS-02

Obstacles are static, unowned, take no part in winning and do not interact with troops.

*Source:* 03#8.1.

*Params:* Obstacle footprints.

*Examples:* E-BLOCK.

*Since:* 2.0.0.

### R-WIN-01

The human wins when every building with `ignoreForWin = false` (neutral buildings included) is owned by the human. The remaining ignored buildings then flip to the human.

*Source:* 03#7.2.

*Params:* `ignoreForWin` (TW `cbi`).

*Examples:* E-OUTCOME.

*Since:* 2.0.0.

*Supersedes:* v1 R-WIN-01 (elimination by towers and troops in transit).

### R-WIN-02

The human loses when they own no building with `ignoreForWin = false`. Troops in transit do not count. There is no draw outcome. A win marks the campaign level completed; loss and timeout do not.

*Source:* 03#7.2.

*Params:* `ignoreForWin`.

*Examples:* E-OUTCOME.

*Since:* 2.0.0.

*Supersedes:* v1 R-WIN-02 (mutual-defeat `draw`).

### R-WIN-03

A level may set `timeLimitSec`; when absent there is no limit (no campaign level sets one). At phase 9, `tick >= timeLimitSec × tickRate` ends the match as a timeout loss and takes precedence over a win in that tick. Harness step caps are not outcomes. Once recorded, an outcome is final.

*Source:* v1 R-WIN-03; 03#7.2.

*Params:* `timeLimitSec` (optional).

*Examples:* E-OUTCOME.

*Since:* 2.0.0.

*Supersedes:* v1 R-WIN-03 (300 s default limit).

### Retired ids

These ids are tombstones. They stay known so stale references are caught, are never reused, and are not active rules.

### R-GEN-01 — tombstone

Status: tombstone. v1 owned-tower generation at a rate. Replaced by R-SPN-01..03 and R-GRW-01. *Since:* 1.0.0, retired 2.0.0.

### R-GEN-02 — tombstone

Status: tombstone. v1 shared generation accumulator and garrison/departure routing. Replaced by per-line timers (R-SPN-01). *Since:* 1.0.0, retired 2.0.0.

### R-SND-01 — tombstone

Status: tombstone. v1 "sending is generation" (stored garrison never dispatched). Replaced by free spawning (R-SPN-02). *Since:* 1.0.0, retired 2.0.0.

### R-SND-02 — tombstone

Status: tombstone. v1 round-robin target choice across lines. Replaced by independent line timers (R-SPN-01, R-SPN-03). *Since:* 1.0.0, retired 2.0.0.

### R-CAP-02 — tombstone

Status: tombstone. v1 no-bank rule (capped towers stop generating without a line). Replaced by growth (R-GRW-01) and overflow (R-CAP-03). *Since:* 1.0.0, retired 2.0.0.

## 4. Tick phase order

R-TCK-05 fixes this order. Iteration and ties follow R-TCK-03 throughout. A reader derives, per phase, the rules that run and the order inside the phase from this table.

| Phase | Name | Rules | Iteration and tie order | Required effect |
|---|---|---|---|---|
| 1 | Commands | R-LIN-01..05, R-ENT-04 | Player index, then submission order. | Canonicalize, validate and atomically apply `DrawLine` / `CutLine`. A rejected command changes nothing. |
| 2 | Reserved (unused) | — | — | Slot kept so phase numbers stay stable (formerly booster strikes, deferred, §6). Nothing runs. |
| 3 | Growth | R-GRW-01, R-GRW-02, R-TCK-06 | Buildings by ascending index. | Advance growth timers of owned buildings with zero lines; fire raises level by one up to `maxLevel`. |
| 4 | Spawn / departures | R-SPN-01..03, R-TCK-06 | Buildings by index; within a building lines by target index. | Advance each line's spawn timer; fire departs one troop at progress 0 with the next `seq`, or skips under the alive cap. |
| 5 | Movement | R-TCK-04 | None (analytic). | Evaluate every troop's progress for this tick; no state is mutated per troop. |
| 6 | Contacts | R-CMB-01, R-CMB-04, R-CMB-05 | Head-on pass first, pairs by ascending ordered channel key; then crossing pass by ascending `(channelKeyA, channelKeyB)`, then `(seqA, seqB)`. | Resolve exchanges (R-CMB-05); dead troops are removed immediately; survivors may fight again in the same pass. |
| 7 | Tower shots | R-TWR-01..04 | Towers by ascending building index, sequentially (a troop killed by an earlier tower cannot be shot again). | Decrement cooldowns, then each ready tower fires once (target tie: distance, owner index, troop `seq`). |
| 8 | Arrivals + capture | R-CMB-02, R-CMB-03, R-CAP-01, R-CAP-03, R-CPT-01, R-CPT-02 | Arrivals ordered by overshoot descending, then channel order (source index, target index), then FIFO `seq`. Ownership is re-evaluated per arrival. | Apply reinforcement or damage; capture inline; forward overflow on the `fwd` stream; troops removed by a capture do not arrive. |
| 9 | Win / loss / time | R-WIN-01..03 | Players by ascending index. | Evaluate outcome and the optional time limit; expose final state. Outcome is final. |

Captured buildings neither grow nor spawn for the new owner before the next tick, because capture happens after phases 3–4. Level drops never cut lines (R-LIN-02).

### 4.1 Commands

The command set is closed and is extended only by union with a minor version bump.

- `DrawLine{from, to}` — validated and applied by R-LIN-01, R-LIN-03.
- `CutLine{from, to}` — R-LIN-05.

Human players, scripted AI and bots submit the same commands, pass the same validation and get no privileges (R-ENT-04). Tower War AI never cuts; that is bot policy, not a rule. There is no booster command (§6).

### 4.2 Hash surface

The state hash covers, in index order: per building owner, level, growth timer, `ignoreForWin` and tower cooldown; per line owner, endpoints, draw sequence and spawn timer; per troop owner, source building, type, line, progress, hit points and `seq`; and the state of every sim random stream. Presentation-only state (bullet flight, art stage) is not hashed.

## 5. Worked examples and edge cases

Examples assume the stated Tower War default values (§7). They illustrate rules; changing content changes the numbers, not the mechanics. Every arithmetic result below is reproducible by hand from the formula in the cited rule.

**E-TICK — fixed-point motion.** Soldier `speed = 5.0` gives `speedMilli = 5000`. A line of length 10 world units has `dx = 10000`, `dy = 0`, so length `= isqrt((10000 × 20)²) = 200000` progress units. The troop advances `5000` per tick and arrives after `200000 / 5000 = 40` ticks (0.25 world units per tick). Rounding: `idiv(7, 2) = 3`, `isqrt(15) = 3`. Pause leaves tick and progress unchanged; running faster changes real duration only.

**E-TIMER — carried remainder and mid-interval change.** A house at `L = 10` with one line has period `18461` mt (E-SPAWN). Each eligible tick adds `1000`: at tick 19 the timer is `19000 >= 18461`, fires, leaves `539`; the next fire is at tick 37 (`539 + 18000 = 18539`, leaves `78`), then tick 56 (the timer is `18078 < 18461` at tick 55 and `19078` at tick 56, leaving `617`). If a second line is added when the timer reads `10000`, the period becomes `24000` at once and the timer keeps its `10000`; it must reach `24000` before firing.

**E-SPAWN — per-line period (R-SPN-01).** `ws = 0.5` (`spawnSpeed_m = 500`), `cwc = 0.3` (`lineSpawnPenalty_m = 300`). Soldier house, `L = 10`, one line: `K_m = 1000`; `period = idiv(1000 × 1_200_000, 500 × 10 + 60000) = idiv(1_200_000_000, 65000) = 18461` mt (0.92 s). Two lines: `K_m = 1300`; `idiv(1_560_000_000, 65000) = 24000` mt (1.20 s). `L = 64`, three lines: `K_m = 1600`; `idiv(1_920_000_000, 500 × 64 + 60000 = 92000) = 20869` mt (1.04 s). With `aliveCap` live troops from the house a fire is skipped and the timer is still reduced by the period; spawning never changes the house's level.

**E-GROWTH — zero-line growth (R-GRW-01).** `gl = 1.7` (`growTime_m = 1700`), `growthBase_m × 1000 = 900_000`. `L = 0`: `k = 1`, `isqrt(1_000_000) = 1000`, `idiv(900_000, 1000) = 900`, `(900 + 1000) × 1700 = 3_230_000`, `idiv(3_230_000, 50) = 64600` mt (3.23 s). `L = 60`: `k = 7`, `isqrt(7_000_000) = 2645`, `idiv(900_000, 2645) = 340`, `(340 + 1000) × 1700 = 2_278_000`, `idiv(2_278_000, 50) = 45560` mt (2.28 s). A house with a line does not advance the timer; its value is kept for when all lines are cut.

**E-STAGE — stage function and surplus lines.** With `stageThresholds = [10, 30]` levels 9, 10, 29, 30 have stages 1, 2, 2, 3 and slots 1, 2, 2, 3. A house at level 30 with three lines hit to level 29 keeps all three lines: `slots = 2`, `free = −1`; a new draw is rejected until a line is cut, and spawn periods still use `n = 3`.

**E-LINES — validation, replacement and crossings.** `p1` owns houses `a` and `b`, `p2` owns house `c`. `a→a` is rejected; `a→b` twice is rejected on the duplicate; a draw from a tower is rejected. `a→b` while `b→a` (also `p1`) exists replaces `b→a`; its troops continue. `a→c` while `c→a` exists keeps both lines (head-on, E-HEADON). Cutting `a→b` stops departures; troops already in flight arrive. Line crossings alone do nothing.

**E-BLOCK — lane thickening and tangent contact.** A line from `(0, 0)` to `(10, 0)` with `laneHalfWidth_m = 190`. A circle footprint at `(5, 1)` radius `0.81` (`810`): `810 + 190 = 1000` equals the centre offset (1.0), so contact is tangent and the draw is allowed. Radius `0.82` gives `1010 > 1000`: blocked. An obstacle covering the source centre blocks the draw; the source and target buildings' own footprints never do.

**E-OVERFLOW — surplus forwarded.** `maxLevel = 64`. A friendly tank (`defense = 2`) arrives at a house with `L = 63`: `63 + 2 = 65`, level becomes `64`, surplus 1. The house has two outgoing lines: one `fwd` draw below 2 picks the line, and one new tank departs there at progress 0. With no outgoing line, or at `aliveCap`, the surplus is lost and no draw is made. The forwarded troop is free.

**E-CAPTURE — damage must exceed level; overshoot discarded.** Soldier `attack = 1`. Hostile soldier arrives at level 3: `n = 2`, owner keeps the house. At level 1: `n = 0`, level 0, **not** captured. At level 0: `n = −1 < 0`, captured; the new level is 0 (overshoot is not kept). On capture, every troop whose source is the captured house dies, including troops on its cut lines.

**E-EXCHANGE — attack, not hit points.** Soldier (`hp 1, attack 1`) against tank (`hp 2, attack 1`): both read attack first; the soldier takes 1 and dies, the tank goes `2 → 1`. Soldier against soldier: both die in round 1. Tank against tank: round 1 leaves both at 1, round 2 kills both.

**E-HEADON — fronts meet.** Opposing hostile soldiers on a line of 200000 progress units depart on the same tick. Contact is `700 × 20 = 14000` progress units, so the exchange fires when `progA + progB >= 186000`. The sum is `180000` after 18 ticks and `190000` after 19, so they fight on tick 19 (each at 95000, 4.75 world units). Closing speed is 0.5 world units per tick, below `contactDistance`, so a threshold test cannot skip the meeting. Cutting a line does not protect its troops.

**E-CROSSING — swept crossing.** Two hostile soldiers on perpendicular lines are each 0.6 world units before the crossing point and move 0.25 per tick. Separation is `0.6 × √2 ≈ 0.85 > 0.7` at tick start and `0.35 × √2 ≈ 0.49` at tick end; the distance passes `0.7` during the tick, so the contact is detected in that tick and resolved by R-CMB-05. Order among several contacts is `(channelKeyA, channelKeyB)`, then `(seqA, seqB)`.

**E-ARRIVAL — re-evaluation after inline capture.** `p2` owns house `B` at level 0, with a `p2` troop `T` in flight from `B`. Three arrivals this tick: `p1` soldier (overshoot 9), `p1` soldier (overshoot 6), `p2` soldier (overshoot 2). Order is overshoot descending. First: `n = −1`, `B` is captured by `p1`, level 0, `p2`'s lines from `B` are cancelled and `T` dies. Second: friendly, level `0 + 1 = 1`. Third: hostile `p2`, `n = 1 − 1 = 0`, level 0, not captured. Equal overshoot falls back to line order, then FIFO `seq`. Incoming lines persist.

**E-TOWER — radius, delay, targeting.** `ar = 1.6`, `rupl = 0.9`, `radiusUnit = 2.4` (`1600`, `900`, `2400` milli): stage 1 `idiv(1600 × 2400, 1000) = 3840`, stage 2 `idiv(2500 × 2400, 1000) = 6000`, stage 3 `idiv(3400 × 2400, 1000) = 8160` (3.84, 6.0, 8.16 world units). With `supl = 1.75` (1750) and `ad = 2.0` (2000): `L = 1`: `idiv(1750 × 1_200_000, 2000 × 1 + 60000) = idiv(2_100_000_000, 62000) = 33870` mt (1.69 s); `L = 64`: `idiv(2_100_000_000, 188000) = 11170` mt (0.56 s). After a shot at `L = 1` the cooldown is `33870`, falls `1000` per tick and is `<= 0` after 34 ticks; at `L = 64` it takes 12 ticks. Leveling up mid-cooldown changes nothing. A stage-1 tower reaches `3840 + troopPad` (4.19 world units): a hostile troop at 1.0 world unit is ignored (`minRadius < dist` is strict); one at 3.0 is shot dead. If no troop is in range it hits the nearest hostile house, lowering it by 1 (never capturing); other towers are never shot.

**E-OUTCOME — win, loss, timeout.** The human owns every non-ignored building: the match is won in phase 9 and ignored buildings flip to the human. Troops in transit do not matter. If the human owns none, the match is lost; there is no draw. With `timeLimitSec` unset a match never times out; when set, `tick >= timeLimitSec × 20` is a timeout loss, even on a tick where the human would otherwise win.

## 6. Reserved modules — not implemented

These are future elements, not active rules and not registry entries. They have no `R-` headings; a heading is an active rule. Level import and validation reject them until they ship (see the SP02 registry). **Shipping an element** means a new three-letter area, rule ids, a minor `RULES_VERSION` bump (2.x.0), a registry entry, schema support and tests together. Tuning values belong in content. Phase anchors are `preContact`, `postContact` or `postArrival` within the §4 phase that owns them.

| Element | Intended behaviour | TW source | Hook points (validation / phase anchor / win / hash) |
|---|---|---|---|
| Walls | Static breakable barrier with hit points; troops that reach it damage it; blocks lines and movement as per level data. | 03#8.2 | Validation: footprint and hp; anchor `preContact`; not a win participant; hash hp. |
| Mines | Static trap that kills troops that touch it; may be protected or removed by upgrades (meta, out of scope). | 03#8.3 | Validation: footprint; anchor `postContact`; not a win participant; hash triggered state. |
| Rivers / bridges | Crossable region slowing or blocking troops; bridges allow passage. | 03#8.4 | Validation: geometry; anchor `preContact` (movement modifier); not a win participant; hash bridge state. |
| Rockets (rocket tower, capture rocket tower) | Tower variants firing area damage or charged rockets along a drawn line. | 03#5.7, 03#5.8 | Validation: archetype; anchor `postContact`; capturable; hash charge/cooldown. |
| Fortress | Non-selectable defensive building with turrets, or selectable fortress with turrets and lines. | 03#5.6 | Validation: turret layout; anchor with tower shots; capturable; hash cooldowns. |
| Trolley | Single-line moving building that fills with own troops, then travels and kills what it meets. | 03#8.7 | Validation: line ready flag; anchor `preContact`; win rule per `ignoreForWin`; hash position and ready flag. |
| Railway | Rail track with moving carriages carrying troops. | 03#8.8 | Validation: track geometry; anchor `preContact`; not a win participant; hash carriage positions. |
| Cargo (parachute / drops) | Periodic reinforcement drops at a building. | 03#5.6.1 | Validation: drop timing; anchor `postArrival`; capturable host; hash drop timers. |
| Flags | Level-only building: no lines, no combat; counts for ownership and the last-house rule. | 03#8.9 | Validation: no lines; anchor `postArrival`; participates in win unless `ignoreForWin`; hash owner and level. |
| WT3 artillery troop | Ranged troop type that hits every target in range with an area blast. | 03#5.9 | Validation: unit type `artillery`; anchor `postContact`; not a win participant; hash hp and cooldown. |
| Double unit | Chance-based extra troop on spawn (skin power). | 03#4.3 | Validation: chance value; anchor within spawn; none; hash an extra random stream. |
| Shield | Chance-based absorb of one hit (skin power, `Resurrection` stat). | 03#5.4 | Validation: chance value; anchor within contact/arrival; none; hash shield flag and stream. |

**Deferred boosters.** Bomb and speed boosters are deferred and are not part of 2.0.0: there are no booster rule ids, no `UseBooster` command, no `bomb` random stream, no booster content keys and no per-troop speed state; phase 2 is kept free for the strike phase. Facts kept for revival: the bomb aims 3 times by default (APK remote-config default; the code-embedded fallback is 1), human only, starts after a delay and has a cooldown, strikes AI and neutral buildings by level then index and sets their level to 0 without capture; the speed booster multiplies troop speed and spawn rate, is activate-only for the rest of the match and affects troops already in flight (`OnChangeSpeedUp`). Revival is a new area `BST`, a minor bump, a `UseBooster` command, a `bomb` stream, a strike phase in slot 2, a per-troop speed column with re-anchoring and a spawn-rate factor in R-SPN-01. See `docs/FUTURES.md`.

## 7. Parameter glossary

One row per content key: the key rules name, its Tower War source, the rule ids that use it and the Tower War default. Defaults are not rule text; content owns the values. The first thirteen rows are the keys that the content schemas must match exactly (SP02 parity test).

| Content key | TW source | Rule ids | TW default |
|---|---|---|---|
| `maxLevel` | `ml` | R-CAP-01, R-GRW-01 | 64 |
| `spawnSpeed` | `ws` | R-SPN-01 | 0.5 |
| `lineSpawnPenalty` | `cwc` | R-SPN-01 | 0.3 |
| `growTime` | `gl` | R-GRW-01 | 1.7 |
| `attackDelay` | `ad` | R-TWR-01 | 2.0 |
| `attackRadius` | `ar` | R-TWR-01 | 1.6 |
| `speedUpByLevel` | `supl` | R-TWR-01 | 1.75 |
| `radiusUpByLevel` | `rupl` | R-TWR-01 | 0.9 |
| `radiusUnit` | tower radius unit (decomp) | R-TWR-01 | 2.4 |
| `minRadius` | tower min radius (decomp) | R-TWR-02 | 1.0 |
| `neutralFires` | tower owner gate (absent in decomp) | R-TWR-02, R-TWR-04 | true |
| `troopPad` | troop body radius added to trigger reach (milli) | R-TWR-02 | 350 |
| `hitsNeutralHouses` | tower house-target filter | R-TWR-02 | true |
| `stageThresholds` | art/slot stages 10 / 30 (not serialized; 03#3.2) | R-GRW-02, R-LIN-02, R-TWR-01 | [10, 30] |
| `balance.spawn.aliveCap` | alive soldier cap per house (03#4.2) | R-SPN-02, R-CAP-03 | 30 |
| `balance.growth.base` | growth base constant 0.9 (03#4.6) | R-GRW-01 | 0.9 |
| `balance.contactDistance` | 2 × body sphere radius (03#14) | R-CMB-01, R-CMB-04 | 0.7 |
| `troopType` | house archetype warrior type | R-SPN-02 | soldier |
| `units.*.hp` | flat unit hit points (03#2.3) | R-ENT-02, R-CMB-05 | soldier 1, tank 2 |
| `units.*.attack` | flat unit damage | R-ENT-02, R-CMB-03, R-CMB-05 | soldier 1, tank 1 |
| `units.*.defense` | flat unit level gain | R-ENT-02, R-CAP-01 | soldier 1, tank 2 |
| `units.*.speed` | warrior speed (03#4.5) | R-TCK-04, R-ENT-02 | 5.0 |
| `laneHalfWidth` | line half-width for blocking (03#3.2) | R-OBS-01 | 0.19 |
| `ignoreForWin` | `cbi` (canBeIgnored) | R-WIN-01, R-WIN-02, R-CPT-01 | false |
| `timeLimitSec` | none (TW has no limit) | R-WIN-03 | absent |
| `numericScale` | rules constant | R-TCK-02 | 1000 |
| `buildings.*` | house / tower archetype (`l` start level, `ml`) | R-ENT-01 | per level |

`sc` (TW spawn coefficient, speed booster only) and all other TW level keys not listed here are not consumed in 2.0.0 (R11 deferred boosters, §6). Bullet speed and other visuals are presentation only.

## 8. Changelog

| RULES_VERSION | Date | Change |
|---|---|---|
| 2.0.0 | 2026-10-22 | Full rewrite as the Tower War (APK 1.29.3) rules contract, replacing v1. **Replay outcomes change**: v1 replays and goldens are invalid and must be regenerated. Per-line spawn timers, zero-line growth, stage-based slots with no auto-cut, tank/soldier hp and attack, capture by damage greater than level with overshoot discarded and the source building's troops killed, overflow forwarded, crossing combat, shooting towers, lane blocking by obstacles, optional time limit; draw outcome and 300 s default limit removed; integer milli-tick timers. **Retired ids:** GEN-01, GEN-02, SND-01, SND-02, CAP-02 (tombstones). Rewritten ids keep their numbers (`Since: 2.0.0`); new areas SPN, GRW, TWR, OBS. Boosters deferred (§6). |
| 1.0.0 | 2026-10-08 | Initial mechanics contract (generation/sending, strict slots with auto-cut, no-bank capacity, front-only head-on combat, leftover capture, elimination outcomes). Superseded. |

### 8.1 Contradiction settlements

Research documents and earlier drafts disagreed in six places. Settlements follow the decomp.

| # | Question | Settlement | Rule | Evidence |
|---|---|---|---|---|
| 1 | Surplus lines when building level drops (v1 auto-cut; 06 D12) | Kept; no auto-cut | R-LIN-02 | decomp `SetAvailableWays`/`CalculateFreeWays`; 03#3.1 |
| 2 | Do troops of a captured building survive? (v1 yes) | No: all troops with that source die | R-CPT-01 | decomp `SetNewOwner`; 03#5.3 |
| 3 | Overshoot damage on capture (v1 leftover became garrison) | Discarded; damage must exceed level | R-CMB-03 | decomp `Building.TryDoDamageFrom`; 03#5.3, 03#14 |
| 4 | Overflow beyond `maxLevel` (v1 lost) | Forwarded as one troop on a random outgoing line | R-CAP-03 | decomp `House.AddLevel`, `TrySpawnAdditionalWarrior`; 03#5.3 |
| 5 | Tower scaling | Radius by stage, delay by level | R-TWR-01 | decomp `Tower`; 03#5.5 |
| 6 | Do neutral towers fire? (SP01 draft: inert) | Yes (`neutralFires = true`); flag kept | R-TWR-04 | decomp has no owner gate; level 4 neutral tower; 03#5.5 |

Booster aim count (1 versus 3, 03#8.10 against 05#4.6) is not settled here because boosters are deferred (§6).

### 8.2 Test-tag ownership

`pnpm check:rules` requires, for every active id, a non-skipped test title containing `covers R-X-NN` under `packages/**/*.{test,spec}.*` (`apps/web` and `tools/test` are not scanned); unknown ids in titles are errors; tombstoned ids stay known. It is red from the 2.0.0 commit until the owners below add their tags.

| Area | Tests written by |
|---|---|
| TCK, ENT, SPN, GRW, LIN, CAP, CMB-01/02/03/05, CPT, WIN | SP03 (`packages/sim/test`) |
| CMB-04, TWR, OBS | SP04 |
| Content validation of rule params | SP02 (`packages/content/test`) |
| Stale v1 `covers` tags (sim step/rules/economy tests, content components, tools/test, apps/web) | Deleted by the SP that deletes that file; SP09 verifies none remain |
