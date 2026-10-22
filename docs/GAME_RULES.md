# Node Arena — Game Rules

RULES_VERSION: 2.0.0

This is the mechanics contract for the Tower War (APK 1.29.3) port. It is a full rewrite; there are no profiles and no v1 compatibility. Rules own **structure and formulas**; every tunable number (speeds, coefficients, caps, radii, thresholds) lives in authored content under a named parameter, and rules only name the resolved parameter. The simulation must follow these rules; presentation, bots and tools consume the same mechanics. Tower War defaults appear only in the §7 glossary and in the §5 worked examples.

## 1. Conventions

**Rule IDs and areas.** Rule IDs have the form `R-<AREA>-<NN>` and are permanent. Areas: `TCK` ticks and determinism, `ENT` entities, `SPN` spawn, `GRW` growth, `LIN` lines, `CAP` level and overflow, `CMB` combat, `CPT` capture, `TWR` towers, `OBS` obstacles, `WIN` outcomes. Retired areas `GEN` (generation) and `SND` (sending) exist only as tombstones.

**Id policy.** A rewritten topic keeps its id and records `Since: 2.0.0` plus `Supersedes:` when v1 text meant something different. A dead topic is tombstoned and its id is never reused or reassigned. Tombstones stay listed under "Retired ids" in §3: GEN-01, GEN-02, SND-01, SND-02, CAP-02. Every active rule needs a test whose title contains `covers R-…` (ownership table in §8). A heading is an active rule unless it is marked tombstone; §6 contains no rule headings until an element ships.

**Rule layout.** Each rule is a `### R-AREA-NN` heading followed by the statement, then `*Source:*` (research or decomp cite), `*Params:*` (content keys, glossary in §7), `*Examples:*` (E-ids in §5), `*Since:*` and optional `*Supersedes:*`. Research cites use `03#x.y` / `06 §n` for `docs/research/tower-wars/`; "decomp" means `Game.Main.*` decompilation of the APK. Where documents disagree, decomp wins (§8 contradiction table).

**Numbers.** Rule text contains no tunable literal. The only literals allowed are structural constants: `20` (`tickRate`), `1000` (`numericScale`, one tick = 1000 milli-ticks), `1_200_000` (60 s × 20 Hz × 1000), `60000` (the 60 s offset of the TW spawn/delay curve in milli-seconds), `900_000` (growth base scale), `50` (ms per tick) and `10` (growth step, `k = idiv(L, 10) + 1`). Everything else is a content key.

**Notation.** `idiv(a, b)` = integer floor division of non-negative operands; `isqrt(n)` = greatest integer whose square does not exceed `n`. A suffix `_m` marks a content value stored in thousandths (for example `ws_m = 500` for `ws = 0.5`). `mt` = milli-ticks, 1 tick = 1000 mt, 1 second = 20 ticks = 20_000 mt. `L` = building level, `n` = number of lines of a house, `K` = line penalty factor. Multiply before dividing, with every intermediate range-checked below 2^53 (R-TCK-02).

**Terms.**
- *Building*: a map entity of kind `house` or `tower`. Both hold a *building level*, are owned by a player or neutral, and are capturable.
- *Building level* `L`: integer in `[0, maxLevel]` — garrison and hit points of a building in one number. Not to be confused with a *campaign level* (a playable map).
- *Line*: an owner-drawn directed channel from a source house to a target building (v1 "channel"). Lines are free to draw.
- *Troop*: a unit walking a line; types `soldier` and `tank` (artillery reserved, §6). Type, owner and source building are fixed at departure.
- *Stage*: 1, 2 or 3 as a building level is below the first threshold, between the two, or at or above the second threshold of `stageThresholds` (default `[10, 30]`, §7). Stage drives line slots, tower radius and art (R-GRW-02).
- *Hostile*: different owner. Every non-self owner is hostile, AI against AI included; a neutral building is hostile to every non-neutral troop.

**Versioning.** `RULES_VERSION` uses semver: major for a change to replay outcomes for existing content, minor for an additive rule or element, patch for a clarification. Replay compatibility requires an exact major.minor match; content identity and the replay header must also pass the content/replay validation contract. The content metadata mirrors this header. A mechanics change updates this document and its changelog, then tests (`covers R-…`), then code. A value change edits content and its content version/hash, not a rule. Tunable numbers live in content (`balance.json` and level data).

## 2. Entities

_Pending: later SP01 task._

## 3. Rules by area

_Pending: later SP01 task._

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

_Pending: later SP01 task._

## 5. Worked examples and edge cases

_Pending: later SP01 task._

## 6. Reserved modules — not implemented

_Pending: later SP01 task._

## 7. Parameter glossary

_Pending: later SP01 task._

## 8. Changelog

_Pending: later SP01 task._

