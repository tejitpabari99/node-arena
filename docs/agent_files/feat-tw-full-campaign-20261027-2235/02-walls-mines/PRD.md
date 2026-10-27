---
status: draft
summary: Walls (hp sponge that consumes troops) and mines (one-shot, 0.1 s delayed kill) as content-driven element modules on a new generic "element crossing + element state" facility that SP03/05/08 reuse; flips the Wall/Mine importer rows, re-imports levelview-100-es with its wall, and imports >=10 curated levels per element (wall, mine).
date: 2026-10-27
---
# PRD: 02 Walls + mines

Repo/branch: node-arena, `feat/tw-full-campaign` (Phase A PR = SP01+02+03) · Depends on: 01 soft (pool tool for selection; themes only matter for levels >= 41) · Feeds: 03 (element hp + crossing helper), 05 (rivers reuse crossing helper), 08 (trolley takes mine damage), 09 (docs, final gates)
Owns: `docs/GAME_RULES.md` (new areas `ELM`, `WAL`, `MIN`, phase-6 row, changelog), `packages/content/src/versioning.ts` (RULES_VERSION), `packages/defs/src/modules/{absorbs,detonates}.def.ts` + registry + event defs (`WallHit`, `WallDestroyed`, `MineTriggered`), `packages/content/data/elements/{wall,mine}.json` + element/level schema bits, `packages/sim/src/{elements.ts,state.ts,hash.ts,snapshot}` (element state columns) + `modules/{absorbs,detonates}.ts`, `tools/src/import-tw/{feature-map.json,map-level.ts}` (Wall/Mine rows + emitters), `apps/web/src/render/*` (wall/mine renderers, fx), `apps/web/src/editor/*` (library items), `tools/src/assets-tw/*` (wall/mine model rows), imported levels, `tools/levels-lock.json`, `tools/unsolved-by-proxy.json` rows.
Does not own: bots (unchanged), resource piles (03), rivers/bridges (05), trolley (08), themes (01).

## TL;DR
- Wall = neutral static element with `hp`; each troop that reaches it is **consumed** and removes `min(attack, hp)` hp; gone at 0. Mine = neutral one-shot; first troop to touch it **dies 0.1 s (2 ticks) later**, mine destroyed at once. Neither blocks line drawing; both are invisible to bots. [verified: 03-core-mechanics §8.2-8.3, decomp refs there]
- Introduces the **only new sim facility**: per-element state columns (hashed, snapshotted) + a swept "troop enters element" helper. Today elements are static, stateless [verified: `SimModule.state` is per-building; `blocksLines` only reads `level.elements`].
- Hits resolve in phase 6 (Contacts) after the head-on and crossing passes, before tower shots. Integer, no RNG.
- Importer: `Wall` and `Mine` become `map` rows; the `levelview-100-es` wall drop is removed (position 23 gains its wall; its lock + content hash change).

## Problem
Wall and mine levels are blocked at import: 397 / 291 of 1,012 TW levels carry them, first appearing at positions 24 and 36 [verified: 06-gap-map §1; 02-levels §5]. Only `levelview-100-es` imports, with its wall dropped (`source.dropped: [cargo, sc, tutorial-script, wall]`) [verified: level JSON; LEVELS_GUIDE §5]. The sim has no state for elements and no troop/element interaction (R-OBS-02).

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| Rules `R-ELM-*`, `R-WAL-*`, `R-MIN-*` text + tests + code | Talents/artefacts: `destroyWallBonus`, `mineBlockBonus` (meta OUT); keep a zero-default hook only |
| Generic element state + `onCross` helper reusable by 03/05/08 | Rocket / area damage to walls and mines (SP06) |
| Faithful decoded numbers (hp, delay, clamp, consume) | Trolley-vs-mine (SP08 consumes the helper) |
| Web render + hp/destroy feedback; editor can place both | Wall-only sound design / new UI chrome |
| Importer rows + newly unlocked levels, lock refresh | Bot behaviour change |

## Requirements

### Decoded vs spike
| Fact | Status |
|---|---|
| Wall: per trigger entry `dmg = UniqueAttack[Wall] ?? DefaultAttack`, clamp to remaining hp, `hp -= dmg`, soldier `ForceKill`ed, wall gone at 0; `PS` always 15 | decoded [verified: 03 §8.2; `DestroyedWallItem/{OnTriggerEnter,GetDamage}.c`] |
| Mine: non-Air soldier touch -> mine destroyed; troop killed after 0.1 s; `timeToDisableMine 2.0` is the scale-down animation | decoded [verified: 03 §8.3; `MineItem/OnTriggerEnter.c`] |
| Wall/mine **trigger shape and size** | NOT decoded: `colliders.json` holds obstacles only [verified: colliders.json top-level keys] -> spike S1 |
| Do walls/mines sit on the obstacle layer (i.e. block `CheckBlock`/AI box-cast)? | NOT decoded; inferred "no" (a blocking wall could never be reached) -> spike S2 |
| Owner gate: do AI and human troops both trigger? are tanks consumed when hp < attack? | read as "any warrior" -> spike S3 confirms |
| Wall footprint vs `Hp` (`addedPosByOneElement 0.5`, `addedScaleByOneElement 0.12`) | NOT decoded -> S1 |

### R1 Rules (GAME_RULES first, then tests, then code)
- **R-ELM-01 Element crossings.** A troop *crosses* an element when its centre-line swept this tick (progress `p_prev -> p_now`, spawn tick included from 0) comes within `troopRadius (350) + footprint` of the element. Order per tick: elements ascending index; per element, channels ascending key, then troops front-first (descending progress, i.e. ring order). Sub-tick time ignored (as R-CMB-04). Elements never block lines unless they carry `blocksLines` (R-OBS-01).
- **R-WAL-01..03** hp init from level `params.hp` (>= 1); crossing removes `min(unit attack, hp)` and kills the troop (`cause: wall`); at hp 0 the wall is inactive for the rest of the match (same-tick later troops pass). WAL-03: walls are neutral, not win participants, hit every owner.
- **R-MIN-01..03** first crossing flips the mine inactive immediately; a `due = tick + delayTicks` kill is queued for that troop (`delayMs 100 / 50 = 2 ticks`); at `due` the troop dies if still alive (`cause: mine`), else nothing; troops crossing an inactive mine are unaffected. A delayed troop can still fight, arrive and capture in those ticks. Air units immune (param, no current air unit).
- Phase table row 6 gains "element crossings (R-ELM/WAL/MIN) after crossing pass"; R-OBS-02 gets a cross-reference. Changelog + `RULES_VERSION` 3.0.0 -> **3.1.0** (additive; if SP03 lands first, rebase to the next minor) [verified: versioning.ts].

### R2 Defs / content
- Two module defs (`appliesTo: 'element'`): `absorbs {hp, consumesTroop: true}` and `detonates {delayMs, destroyOnTrigger: true}`. `ruleIds` tagged; phase `contacts`.
- `elements/wall.json` (`footprint` placeholder box, `modules.absorbs`), `elements/mine.json` (circle, `modules.detonates`). Neither lists `blocksLines`. Level element `params` (already in the level schema [verified]) carries `hp`; `punchStrength` kept as `x-presentation` (not hashed, no sim effect).
- Level `requires` gains `absorbs`, `detonates`. Unit attack is `units/*.json attack` (soldier 1, tank 2) [verified].
- Events: `WallHit{element,hp,x,z}`, `WallDestroyed`, `MineTriggered{element,troop,dueTick}`; `KillCause` += `wall | mine` (counted in `killed`, not `died`, like towers).

### R3 Sim
- `SimModule` gains `elementState?: Record<string, number>`; `createState` allocates `Int32Array(elements x fields)` per module, included in `hash`/snapshot (new state version; old snapshots rebuildable since fields are derivable from tick 0 only on fresh games -> bump snapshot schema, no migration of live saves needed [RESOLVED: see O4 in Risks]).
- `elements.ts`: cold `create`-time precompute of `crossIntervals[element][channel]` using the existing `geometry.ts` lane-interval primitive (extend with `pad = troopRadius`); BigInt only at create, per-tick Numbers (same budget as SP04 R1). Hot path: skip channels with no troops (bench gate), skip inactive elements.
- `contactsPass` calls `elementPass(state)` after `crossingPass`; `elementPass` iterates modules via `MODULE_ORDER`. Mid-ring kill uses `killTroop` (ring supports removal at any index [verified: `indexOfSeq` + `removeAt`]).
- Mine pending kills: a small sorted queue in module state (`dueTick, channel, seq`), processed at the start of `elementPass`. Reuse `timers.ts` if it fits; else a ring-free array. Fully hashed.

### R4 Bots
TW AI ignores walls and mines [verified: 04-ai-bots.md §port-gaps: "obstacle corridor test (no sim features)"; box-cast only rejects obstacle/third-building hits]. Because walls/mines are non-blocking, `canDraw` is unchanged and **no bot code changes**; `BOT_VERSION` stays 2.4.4. Bot results on wall levels change only through sim effects (troops die on walls) -> covered by `validate:levels`.

### R5 Web
- Assets: add `DestroyedWallItem`, `MineItem` rows to `tools/src/assets-tw` (model + texture, shared across themes unless S4 shows per-theme materials); manifest visual ids `element.wall`, `element.mine`; credits rows; `assets:tw:check` byte-identical.
- Wall render: one "stick" per remaining hp (prefab `addedPosByOneElement 0.5`); each `WallHit` pops a stick with a burst; `WallDestroyed` clears. Mine: scale-down over 2.0 s on `MineTriggered`, puff fx; no extra HUD.
- Element renderer is obstacle-only (`placeObstacles`); add a sibling renderer registered by visual id rather than special-casing.
- Editor: library items `wall`, `mine` (no `obstacle` overlap warnings since non-blocking); selection panel `hp` number field (1-20) and yaw; `LevelDoc.elements[].params.hp`. Model + thumbnails extend `LibraryItem`.

### R6 Importer
- `feature-map.json`: `Wall` -> `{action: map, kind: element, archetype: "wall"}`, `Mine` -> `"mine"`; delete `onlyLevels` and the recorded `wall` token. Emitters `emitWalls` (pos `P`, yaw `R`, `params.hp = Hp`, `punchStrength = PS`) and `emitMines` in `map-level.ts`; inactive (`S` false) entries are omitted as for obstacles. Parser already reads both [verified: parse-raw.ts L39-40].
- Re-import `levelview-100-es` (position 23): wall now present; update `source.dropped`, `levels-lock.json`, `hashes.lock.json`; refresh the state-v2 test and any golden referencing it [verified: grep lists `tools/levels-lock.json`, `apps/web/test/sp08/state-v2.test.ts`, `campaign-results.json`]. Level plays harder -> re-run solvability.
- Curated import: select >=10 TW-pool levels (Common 24-340) featuring walls and mines (>=10 each; re-imported position 23 counts as a wall level) per README Curation rules (candidates and metrics from SP01 pool tool; the first selected level introduces walls and mines (>=10 each; re-imported position 23 counts as a wall level) with no other new element; spread across later positions; prefer proxy-solvable, allowlist only if no equal-feature alternative); import only those; show the coverage line in the PR (`walls and mines (>=10 each; re-imported position 23 counts as a wall level): n levels, first at display N`). Selection is provisional; SP09 finalizes order and numbering. Unsolvable by proxy -> `tools/unsolved-by-proxy.json` (reason, `ownerSignOff: null`).
- Content version bump + `content:lock`.

## Architecture (high level)
- `elements.ts` is the shared seam: `forEachCrossing(state, moduleId, cb(elementIdx, channel, seq, tick))` plus `elementState(state, moduleId)`. `absorbs` implements `hp` drain; `detonates` queues delayed kills. SP03 resource piles add `onCross: carry/return` and an `absorbs`-style hp; SP05 river obstacles/bridge ceils and SP08 trolley mines call the same helper. Interface is **hooks + state columns, no wall/mine-specific code in `elements.ts`**.
- Tick position: Contacts (6) = head-on -> crossing -> **element pass**; towers (7) then see survivors; arrivals (8) after. A troop killed by a clash cannot hit a wall; a troop eaten by a wall cannot be shot.
- Determinism: integer milli progress, ticks not seconds, no RNG, deterministic iteration (R-ELM-01), all new state hashed.
- Version impact: levels without walls/mines replay bit-identically; `levelview-100-es` content hash changes (expected), no other lock moves.

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| 1 | Block line drawing? | No (default) pending S2 | Walls block like obstacles | A blocking wall is unreachable; box-cast mask would stop AI/human drawing |
| 2 | Module split | `absorbs` + `detonates` modules on one helper | Single `hazard` module; hard-coded wall/mine in sim | Data-driven (06-gap-map §3.5), reuse by 03/05/08 |
| 3 | Where in tick | Phase 6 after crossing pass | New phase; before clashes | Keeps phase numbers stable; matches "ForceKill after contact" |
| 4 | Mine delay | 2 ticks, troop stays live | Instant kill; delay as float | 0.1 s decoded; integer ticks; delayed troop can still arrive |
| 5 | Which troop hits | Every troop crossing, front-first | Front troop only | Wall consumes each entrant; mid-ring removal supported |
| 6 | Tank vs wall | Clamp to hp, tank consumed | Tank survives overkill | Decoded clamp + ForceKill |
| 7 | Talents | zero-default params only | Implement bonuses | Meta is OUT |
| 8 | Footprint | S1 spike, else fallback | Guess now | Fidelity rule; fallback recorded as deviation |
| 9 | Re-import 23 | Yes, lock refresh | Keep drop | Drop was a stop-gap |
| 10 | RULES bump | minor 3.1.0 | major | Existing replays on non-wall levels unchanged |

## Manual steps
- Run S1-S4 against the rebuilt extract (`/root/projects/tower-war/_tools/decomp.sh 'DestroyedWallItem'` / `'MineItem'`, UnityPy collider dump), time-boxed 1 day each batch.
- Owner spot-check of `unsolved-by-proxy.json` rows added here (`ownerSignOff` stays null).
- Pre-merge full `validate:levels --all` (SP01 R3) for the Phase A PR.

## Risks / Open Questions
- [RESOLVED: decode spike first (task: decomp wall/mine trigger classes (Wall, Mine) via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use wall box 1.2 x 0.4 yawed by `R` regardless of Hp, mine circle r 350 and record it as a deviation in GAME_RULES + the deviations ledger] S1: wall/mine trigger sizes and wall length vs Hp.
- [RESOLVED: decode spike first (task: decomp wall/mine layer setup via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use non-blocking layer (do not block drawing or AI); if the decode shows an obstacle layer, flip Decision 1 to `blocksLines` and bots use existing `canDraw` only and record it as a deviation in GAME_RULES + the deviations ledger] S2: wall/mine layer.
- [RESOLVED: decode spike first (task: decomp wall/mine trigger handlers via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use both enemy-owned and AI troops trigger, and mines trigger on tanks and record it as a deviation in GAME_RULES + the deviations ledger] S3: owner gate and tank/AI triggering.
- [RESOLVED: decode spike first (task: decomp wall/mine renderers or materials via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use reuse the base theme obstacle material tinted per theme and record it as a deviation in GAME_RULES + the deviations ledger] S4: per-theme wall/mine materials (asset rows only).
- [RESOLVED: bump sim snapshot/hash schema version for element columns; no persisted sim snapshots exist (save stores progress only, verified in LEVELS_GUIDE/save notes), so no migration] O4.
- [RESOLVED: decode spike first (task: decomp the clash/element update order via /root/projects/tower-war/_tools/decomp.sh, time-box ~1 h); if inconclusive use element pass after clash and record it as a deviation in GAME_RULES + the deviations ledger] Ordering of element pass vs clash (Decision 3); calibrate against TW playthrough refs in the golden task and lock after.
- [RESOLVED: selection count is driven by README Curation (>=10 per element); pool tool lists candidates; recorded in the SP02 PR coverage line] How many wall/mine levels to ship.

## Acceptance Criteria
- `R-ELM-01`, `R-WAL-01..03`, `R-MIN-01..03` in GAME_RULES with `covers R-...` tests; `pnpm check:rules` green; RULES_VERSION 3.1.0 + changelog.
- Unit tests: wall hp drain with soldiers and tanks (clamp), multiple troops in one tick, mid-ring removal, mine 2-tick delayed kill incl. troop dying first, arrival during delay, inactive mine ignored, determinism (replay hash equal across runs), snapshot round-trip with element state.
- `levelview-100-es` imports with its wall; `source.dropped` has no `wall`; locks refreshed; all other level hashes unchanged.
- Selected levels (>=10 wall, >=10 mine) imported; each solvable by proxy or in `unsolved-by-proxy.json` with `ownerSignOff: null`; coverage line recorded.
- Web: wall/mine render in-game, hp/destroy fx fire from events, editor places both and exports valid JSON; `assets:tw:check` and `check:manifest` green.
- `pnpm bench:sim` within budget on a mine-heavy level; `pnpm run ci` green.
