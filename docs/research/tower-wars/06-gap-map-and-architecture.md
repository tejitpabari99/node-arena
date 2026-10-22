# 06 - Tower War vs Node Arena: gap map, modular architecture proposal, port roadmap (direction P6)

Date 2026-10-21. Worktree `/root/projects/node-arena-wt-tower-war-research`, branch `research/tower-war-teardown`. Design only, no code changes. Sources: teardown docs 01-05 and `06a-node-arena-baseline.md` in this folder, plus direct checks of our code (cited `path:line`, paths relative to the worktree).

Citation keys. TW claims cite `<doc>#<section>`: `01` = `01-characters-units-towers.md`, `02` = `02-levels.md`, `03` = `03-core-mechanics.md`, `04` = `04-ai-bots.md`, `05` = `05-meta-modes-ux.md`, `06a` = `06a-node-arena-baseline.md`. Our code is `path:line`. Anything labelled **PROPOSAL** is my design, not a fact. "Not found" means I looked and could not locate it. "Unverified" means a TW claim rests on names or partial decompilation in the teardown docs.

Reading order: 0 (summary), 1 (fundamental differences + determinism), 2 (gap map), 3 (architecture), 4 (roadmap), 5 (open decisions), 6 (unverified items to settle before coding), 7 (appendix: verified code facts, coverage numbers).

---

## 0. Summary

1. The two games are closer than the code suggests. Both use a garrison count as the building "level" that also drives line slots (1/2/3 lines at thresholds 10/30), both spawn troops for free (sending never lowers garrison), both let hostile lines share a road head-on, both lose overflow, both let you cut only your own line (03#3.2, 03#4.4 vs `docs/GAME_RULES.md` R-SND-01, R-LIN-02, R-LIN-03). The slot rule differs only by an off-by-one that content can absorb (`extraSlotAbove: [9, 29]`, section 1 F7).
2. The real gaps are: (a) production formula (level- and line-count dependent, one timer per line, separate growth vs spawn) vs our single fixed-rate accumulator; (b) capture and arrival arithmetic (damage = attack not HP, strictly-greater capture, overshoot discarded, old owner's in-flight troops die, overflow forwarded); (c) win condition (capture every non-ignored building incl. neutrals) vs our elimination; (d) geometry (blockers, curved/free lines, crossing combat); (e) everything that shoots or sits on the map (towers, rockets, walls, mines, rivers, gates, sheep, resources, trolley, railway, boss); (f) AI (event-sequenced scripts, weakest-first targeting, per-seat power percent); (g) a whole meta layer; (h) the art pipeline (team-colour texture swap, multi-part animated models, 3 stage meshes per building).
3. Only 38 of the 1,012 listed campaign levels (3.8 percent) use nothing but houses, tanks and decor-level extras (obstacles, cargo, scripted AI treated as decor); 385 need towers, 274 rocket towers, 412 resource piles, 397 walls, 291 mines, 208 rivers, 176 selectable fortresses, 125 capture rocket towers, 61 railways (section 7.2, my count over the raw level JSON). So a faithful port is feature-gated, not level-gated: build the sim modules in the order of the introduction curve (02#5) and let the importer tag each level with the modules it `requires`.
4. Our core already has the right extension seams (component registry with systems, hooks and `registerPhase`, `packages/sim/src/registry.ts:8-87`; open param bags, `packages/content/src/core.schema.ts:18-30`; manifest-keyed visuals). What blocks a data-driven port is that the seams are duplicated and capped: content `COMPONENT_REGISTRY` (`packages/content/src/component-registry.ts:22-30`) vs sim `createComponentRegistry` (`packages/sim/src/registry.ts:74-87`) with a runtime parity assert (`registry.ts:64`); closed unions for commands, events, rejects, outcomes (`packages/sim/src/commands.ts:4-19`); closed bot enums (`packages/content/src/bot-params.ts:5-9`, `bot.schema.ts:8`); closed manifest `kind`/`build`/`anim` (`manifest.schema.ts:16-37`); hard caps (20 levels, 1 human + 1-3 bots, troop value 1; `validate-content.ts:105,154`, `component-registry.ts:29`).
5. Target architecture (section 3, PROPOSAL): one declarative **module definition** per behaviour (params schema, state columns, phase placement, rule ids, versions) in a new pure package that content, sim, bots and web all import; implementations are sibling files keyed by the same id and checked by the type system, not a runtime parity list. Everything TW has becomes archetypes (buildings, units, elements, projectiles) built from components, plus a small set of generic "lane modifier" components that express walls, mines, gates and obstacles as data. A **rules profile** (`na-v1`, `tw-1.29`) selects capture/arrival/win/slot variants so existing replays stay valid and TW behaviour is additive (RULES_VERSION minor, not major).
6. Roadmap (section 4): SP-A registry refactor (no behaviour change) -> SP-B TW sim parity core -> SP-C level importer, campaign lists, packs -> SP-D art pipeline (parallel track) -> SP-E map elements and shooters in five slices -> SP-F AI port -> SP-G HUD, boosters, meta in three slices -> SP-H scale hardening. Recommended first milestone: SP-A + SP-B + SP-D + E1/E2 (about 60 levels playable), then towers/rockets (about 730 levels).

---

## 1. Fundamental model differences (read before the table)

Each item: what differs, why it matters, recommendation. Evidence in the gap map (section 2).

**F1 - Real-time non-deterministic sim vs deterministic fixed-tick sim.** TW gameplay timers are `Time.deltaTime` accumulators on UniRx `EveryUpdate`, combat is Unity physics trigger callbacks, randomness is unseeded `UnityEngine.Random`; the `Lockstep` assemblies are only used by Clan Wars; there is no replay (03#11, 04#11). Ours is a fixed 20 Hz integer engine with `sfc32` PRNG, hashes, replays and goldens (`packages/sim/src/math.ts:2,76`, `docs/GAME_RULES.md` R-TCK-01..05, `packages/sim/src/replay.ts`).
Recommendation (PROPOSAL, "determinism contract for TW parity"):
- Keep the fixed 20 Hz tick and lazy analytic movement. Do not move to frame-time. TW numbers translate to ticks without visible change: a TW house at level 64 emits every 0.65 s (13 ticks), speed 5 u/s is 0.25 u/tick (03#4.1, 03#4.5). Jitter is at most one tick (50 ms) and averages out because accumulators carry the remainder, exactly as TW does (`timer -= T`, 03#4.1).
- Translate float formulas to integer rationals evaluated once per tick from integer inputs (level, line count). Use timer-versus-period (store timer in milli-ticks, compare against period computed from content constants), not rate accumulation, so a period that changes mid-interval behaves like TW (timer compared with the new target). `isqrt` (R-TCK-02) covers the `sqrt(floor(level/10)+1)` growth term; or use a content lookup table for stages 1..7.
- Replace every `UnityEngine.Random` use with a named seeded stream forked from the match seed: `stream(matchSeed, purposeId, entityIndex)`. Draws happen only inside a fixed phase, in ascending index order, so adding a feature never perturbs another stream. TW random uses to port: double-unit chance (03#4.3), shield chance (03#5.4), overflow-forward lane choice (03#5.3), rage trigger (03#5.10), AI source pick (04#3.1), AI bot power rolls (04#8.1). Lateral path offset (+-0.2, 03#4.2) is cosmetic and stays client-side (render RNG, never hashed).
- Replace physics triggers by swept tests in lane space (03#11 port notes): same-road head-on is already analytic (`packages/sim/src/combat.ts:24-43`); crossing contacts use precomputed lane-lane intersection points and time-interval overlap.
- Resolve ties with explicit orders (tick, channel, fifo, id). TW `List.Sort` ties are unstable (04#11); ours must be total orders.
- Asymmetric TW effects that look like "time scale" are rules, not driver speed: the Speed booster multiplies only Player soldier speed and spawn rate (03#8.10). Model as a recorded command `UseBooster` + player modifier with an expiry tick. The driver's accelerated play (R-TCK-01) stays purely a stepping-rate feature.
- Randomness consumed by the sim and the modifiers/power inputs are part of the replay header (`seed`, `setupHash`), never read from storage at replay time.

**F2 - "Level" is garrison/HP/slot-driver/art-stage in TW; ours is garrison with the same driver role.** TW: `houseLevel` is both the displayed number, the hit points of the building, the input to production and slot count, and the art stage; there is no separate troop pool; sending is free (03#2.2, 03#4.4, 03#4.6). Ours: `garrison.count` is the displayed "level", slots derive from it, sending never lowers it (R-SND-01, `packages/sim/src/economy.ts:5-12,35-75`). Same concept, so keep our names (`garrison`). Terminology note: TW also says "level" for a campaign level, so docs must say "building level" versus "campaign level". Differences are numeric (cap 64 default vs 50/20/80, per-instance `ml`, start 5..30; 03#4.6, 03#10).

**F3 - Free lines with slots by building level.** TW: no cost, no length cap; 1/2/3 lines at level <10 / 10-29 / >=30 (decomp: `iVar4=2; if(level>0x1d) 3; if(level<10) 1`, 03#3.2). Ours: one base slot plus one per threshold strictly below garrison (`economy.ts:5-12`, R-LIN-02). Off-by-one: TW is inclusive (`>=10`, `>=30`), ours strict (`>10`, `>30`). Content fix without a rules change: `extraSlotAbove: [9, 29]` (9 < 10 gives the second slot at 10; 29 < 30 gives the third at 30). One more difference, **unverified**: TW `House.OnHouseLevelChanged` only calls `DestroyWayToResource`, `SetAvailableWays`, `UpdateSpawnWarriorTime`, `UpdateTargetTime` (I read `decomp/Game.Main.Buildings.House/OnHouseLevelChanged.c` and `SetAvailableWays.c`); `SetAvailableWays` updates the allowed count and free-way UI and plays a stage up/down sound but I found no code that cuts surplus lines. Ours auto-cuts the newest line (R-LIN-02, `economy.ts:13-27`). Treat TW as "surplus lines persist until the next removal" until proven otherwise, and expose it as a param (`slotLoss: cutNewest | keep`).

**F4 - Shared two-lane roads.** TW: one `WayBaseController` per unordered pair holds two lanes; hostile reverse line becomes the second lane on the same road (`CreateOpposite`), friendly reverse reverses the road; the eraser removes only the caller's lane (03#3.2, 03#3.4). Ours: directed channels per ordered pair, same-owner reverse replaced (R-LIN-03), hostile reverse coexists and clashes (R-CMB-01), cut only own (R-LIN-05). Behaviourally equivalent for head-on duels; keep our channel model and add a `road` entity (unordered pair + path geometry) that owns both channels' geometry. Crossings of different roads are the real difference (F9).

**F5 - Capture overshoot discarded, strictly-greater capture, kill-on-capture.** TW `Building.TryDoDamageFrom`: `n = level - damage; if n < 0 { level = 0; capture } else level = n`; leftover discarded; exact depletion leaves the owner at level 0 and needs one more hit; each soldier deals its `attack` (1 soldier, 2 tank, 1 artillery) regardless of HP and is consumed; friendly arrival adds `defense` (1, plus carried gold) and surplus above max is re-spawned on a random other lane; capture calls `DestroyAllWays` and `KillAllWarriors` (every soldier that house spawned dies, including those in flight) (03#5.3, 03#2.3). Ours: arrival removes `min(value,count)`, leftover value becomes the new garrison, exact depletion captures, in-flight troops persist, overflow is discarded (`packages/sim/src/combat.ts:65-88`, R-CMB-03, R-CPT-02, R-CAP-01). Five independent switches. Recommendation: make each a param of the `capturable`/`garrison` components selected by a rules profile (section 3.4), default = v1 behaviour, so v1 replays remain valid and TW behaviour is additive. Unverified: whether subclasses (`Tower`, `Fortess`) override `SetNewOwner` (03#14).

**F6 - Win condition.** TW: win when every building with `canBeIgnoredToWin == false` is owned by the human (so all neutrals must be captured); lose when the human owns no such building (troops in transit do not keep you alive); flags auto-flip a player whose last building is a flag; boss levels add a timer; the common campaign has no time limit in data (03#7.2, 02#3.2 "no win rule field"). Ours: elimination = owns a tower or has a troop in transit; human wins when all other teams are eliminated; mandatory `timeLimitSec` default 300 with timeout loss (`packages/sim/src/tick.ts:6-35`, R-WIN-01..03). Recommendation: objective registry (`elimination`, `captureAll`), per-building `ignoreForWin`, optional time limit.

**F7 - Production model.** TW: per outgoing line a timer with `T = K*60/(ws*level+60)/f`, `K = 1 + cwc*(lines-1)` (cwc 0.3 house, 0.2 selectable fortress); total output with n lines is n/T (1.0x, 1.54x, 1.88x of one line at level 10); first soldier after one full period; no growth while any line exists; with no line the level grows +1 every `(0.9/sqrt(floor(level/10)+1) + 1) * gl` seconds (gl 1.7 default, 2.0 for tank/artillery houses) up to `ml`; alive-soldier cap 30 per house; double-unit chance spawns one extra after 0.15 s (03#4.1-4.6). Ours: one integer accumulator per tower at constant `ratePerSec`, round-robin across lines, total rate independent of line count, same stream fills garrison when there is no line (`economy.ts:36-75`, R-GEN-02, R-SND-02). TW needs two distinct mechanisms (sending rate and growth rate) with level- and line-dependent formulas; ours cannot express that with `generates{troop, ratePerSec}`. Add components `spawns` (per-line timers) and `grows` rather than overloading `generates`.

**F8 - Unit value split.** TW units have `attack`, `defense`, `hitPoints` (soldier 1/1/1, tank 2/1/2, artillery 1/1/1) and in real progression HP comes from "power" and equals the damage dealt to other warriors (`_isDamageTheSameAsHp`), while damage to buildings stays `attack` (03#2.3, 03#2.4, 03#2.5, 03#5.2). Our `value` plays all three roles and the validator pins it to 1 (`packages/content/src/troop.schema.ts:5-13`, `component-registry.ts:29`), though the sim already carries per-troop `value` with partial consumption (`packages/sim/src/state.ts:10-12,73-80`, `combat.ts:24-43`). Soldier-vs-soldier trade `min(hpA,hpB)` matches our clash exactly; the mismatch is on arrival (TW consumes the whole soldier and deals `attack`; we consume `min(v,count)`). Split `value` into `hp`, `attack`, `defense` in the unit def, with `value` kept as shorthand for v1 content.

**F9 - Crossing combat and physics-driven map interaction.** TW soldiers of different owners fight wherever their trigger colliders overlap, not only on a shared road; roads cross freely; walls, mines, gates, rivers, bridge planks, sheep and trolleys are physical triggers on lanes (03#3.4, 03#5.2, 03#8). Ours: only opposed channels of the same pair clash, unrelated crossings do nothing (R-CMB-01, R-LIN-04). Port as a generic **lane-crossing** facility: at draw time compute intersections of the new road polyline with other roads and with element shapes; each intersection becomes a (lane, arc-length, element or lane) event; per tick, for troops whose progress crossed that arc-length, fire the module that owns the intersection. This keeps lazy analytic movement (the ring only needs re-anchoring when a troop's kinematics change). Contact radii are now known: soldier and tank body is a sphere of radius 0.35, artillery a 0.71 x 0.84 box (03#5.9, prefab); the exact radius used for unit-versus-building contact (box colliders `Hit` 0.6, `Building` 1.5, `Selecable` 2.5) was not traced (03#14).

**F10 - Level = list of owned buildings + free-form map objects, no bounds/time/win/theme.** TW levels have 11 lists, per-instance stat overrides (`l`, `ml`, `ws`, `cwc`, `sc`, `gl`, ...), AI settings per player, no bounds, no time limit, no environment (02#3). Ours: towers with archetype + garrison; patches only whole-archetype params; `order`/`band` pinned to 20/4 (`packages/content/src/core.schema.ts:50-68`, `validate-content.ts:151-155`). Need per-instance param overrides, element lists, inline AI, and an external campaign list (TW campaign order is a remote-config list, not in level files, 02#4.1).

**F11 - AI is tiny and different in kind.** TW default AI: one timer, one action per tick, weakest-first target sort (`level`, `/1.5` for tank/artillery houses), uniformly random free source, nearest-own reinforcement fallback, never cuts, no threat model; reaction handler is probably inert; script is an event-sequenced queue (04#0, 04#3, 04#6). Ours: utility scorer over ten considerations with cut/reinforce/attack and line commitment (06a#3). Add a second bot kind (`tw`) instead of bending the utility scorer; `BT` 1/2 are the same attack-only variant (04#13).

**F12 - Difficulty and power are meta-driven.** TW scales bot unit power by a percent (80..200 for Common) of the human's combat power, adjusted per win/loss; level files only set building levels (04#8). We have no unit-power concept. Model as a match-setup input (`seatPower`, per-player `modifiers`) resolved outside the sim and recorded in the replay header (F1).

**F13 - Art binding.** TW: team colour by swapping a per-colour 256x256 atlas texture on a shared mesh (not tint); buildings have 3 mesh/child-enable stages; battle units are 7-18 rigid parts with decoded node animations (Run/Death/Parachute), 1,036-2,330 triangles each (01#4, 01#3.3, 01#5.1, 01#7.2). Ours: static GLB, team colour by tinting a named material, only `none|bob`, troop <=300 triangles, code-built stacked tower with the roof number vs a GLB path without it (`apps/web/src/render/towers.ts:56-61`, `manifest.schema.ts:19-22`, 06a#4.3).

---

## 2. Gap map

Columns: ID, subsystem, Tower War behaviour (doc#section), Node Arena today (path:line), gap, port difficulty (S small <= 1 week of agent work, M medium, L large, XL multi-slice), whether it touches rules (and the RULES_VERSION class under the proposed opt-in design: "minor" = additive module/param with v1 defaults unchanged; "major" only if an existing default must change). Rules rows assume the opt-in design of section 3.4; without it, most M/L rows would be "major".

| ID | Subsystem | Tower War | Node Arena today | Gap | Diff | Rules |
|---|---|---|---|---|---|---|
| G01 | Time and determinism | Real-time `deltaTime`, physics triggers, unseeded RNG, no replay (03#11, 04#11) | Fixed 20 Hz, integer math, seeded sfc32 unused by v1, replays and goldens (`packages/sim/src/math.ts:2,76`; R-TCK-01..05) | Keep ours; port formulas as integer timer/period; named seeded RNG streams; swept lane contacts (F1) | M | minor (new RNG consumers; R-TCK-03 already allows seeded use) |
| G02 | Space, units, scale | Free float x,z, playfield ~19.5 x 17.3, y=0, 2 decimals, min building spacing 1.05..7.95 (median 3.86), soldier speed 5 u/s (02#3.7, 03#2.3) | Rect bounds (default 120x80), coords +-500 fx3, footprint radius 3, speed 10 (`packages/content/src/core.schema.ts:41-42`; 06a#1.2) | Adopt TW native units (scale 1), per-building footprint, per-level bounds from extent; rescale web constants (camera, troop size, lane width) | S | none (content + web) |
| G03 | Players, factions | Human (blue, always first) + 1-3 AI (green/red/yellow) + neutral player (gray, owns most buildings) + boss; no teams (02#3.3, 02#3.4) | 1 human + 1-3 bots, neutral = `owner: null`, 4 colours, teams reserved (`validate-content.ts:105`; manifest palettes) | Fits. Add gray as a neutral colour key, keep `owner: null`; boss deferred | S | none |
| G04 | Building taxonomy | 11 `BuildingsType`, 10 with prefabs; "selectable" = can start lines (house, selectable fortress, trolley); tower, fortress, flag, resource, capture RT, boss are non-selectable; rocket tower aims, no soldier lines (03#2.2, 03#5.5-5.8, 01#3.1) | Tower archetype = `garrison`, `generates`, `drawsLines`, `capturable` (`component-registry.ts:22-30`); `drawsLines` presence = can start lines | Express each type as a component set: Selectable = `drawsLines`; Tower = `garrison`+`capturable`+`shoots`; etc. (section 3.3 table) | M | minor per new component |
| G05 | Garrison semantics | `houseLevel` = HP = garrison = slot input = art stage; cap `ml` (64 default, 30..450, 7 houses 999999); start `l` 5..30; spawning free (03#4.4, 03#4.6, 03#10) | `garrison.count/cap`; cap 50/20/80; sending never changes garrison (R-SND-01; `packages/sim/src/combat.ts:65-88`) | Same concept; add per-instance `cap`/start; art stage thresholds as content | S | none |
| G06 | Production | Per-line timers, `T = K*60/(ws*level+60)/f`, K from line count, growth `(0.9/sqrt(floor(L/10)+1)+1)*gl` only with zero lines, cap 30 alive per house, double-unit chance (03#4.1-4.6) | One accumulator, constant `ratePerSec`, round-robin, same stream grows garrison when no line (`packages/sim/src/economy.ts:36-75`; R-GEN-02, R-SND-02) | New `spawns` + `grows` components; integer timer/period; per-lane timers; alive cap; seeded double unit (F7) | M | minor |
| G07 | Line slots | 1/2/3 at level <10, 10-29, >=30; surplus lines on level drop not cut (unverified) (03#3.2; decomp `House/SetAvailableWays.c`) | `1 + #{threshold < count}`; auto-cut newest at end of tick (`economy.ts:5-27`; R-LIN-02) | Content `[9,29]` for the thresholds; param `slotLoss` for the cut behaviour (F3) | S (content) / S (param) | minor if `slotLoss` param |
| G08 | Line geometry and validity | No length cap, free; blocked if the BoxCast corridor (half extents 0.19, 0.3, 0.19) hits an obstacle or a third building; rivers do not block; straight 2-point path in normal levels (no curvature rule, 03#3.3); "Draw" levels store a drawn polyline with an anchor every >= 1.5 units, Bezier smoothing is cosmetic (03#3.3); crossing lines freely (03#3.2, 04#3.2) | Straight segment between any two towers, no blockers; `reserved` obstacles rejected (R-LIN-04; `validate-content.ts:144`; `commands.ts:27-38`) | Path provider (straight, polyline), corridor test, obstacle elements; Draw mode only for the 130 Draw-family levels (not in the campaign list) | M (corridor) / L (draw mode) | minor (R-LIN-04 text amended; blocker rule new) |
| G09 | Roads | One road per pair with two lanes, own-lane erase, reverse reverses (03#3.2, 03#3.4) | Directed channels, same-owner reverse replaced, cut own only (R-LIN-03, R-LIN-05; `commands.ts:45-93`) | Equivalent for head-on; add `road` geometry owner; document equivalence | S | patch (clarification) |
| G10 | Movement | Speed 5 (+skin percent, x boost), cap 7.5; follows lane points; group formation 4 per row; lateral offset cosmetic (03#4.5) | Lazy `p0 + (tick-t0)*speedPerTick`, per kind (`combat.ts:9-11`, `state.ts:117`) | Per-troop speed from modifiers (ring column); polyline lengths; formation is render | M | minor |
| G11 | Soldier vs soldier | Trigger overlap anywhere (same road and crossings), simultaneous damage = own `damage-vs-warrior` (HP-based), shield absorbs one hit, air/ground, artillery ranged (03#5.2, 03#5.4, 03#5.9) | Same-pair head-on only, front-vs-front, `min(value)` trade (`combat.ts:24-43`; R-CMB-01) | Add crossing contacts (lane intersections), shield, air/ground, ranged as opt-in modules (F9) | L | minor |
| G12 | Soldier vs building, capture | Damage = attack, whole soldier consumed, capture when `damage > level`, level 0 and overshoot discarded, friendly adds `defense`, overflow forwarded, capture kills old owner's soldiers and ways (03#5.3) | `min(v,count)`, leftover becomes garrison, capture on depletion, in-flight persist, overflow dropped (`combat.ts:65-110`; R-CMB-03, R-CPT-01/02, R-CAP-01) | Five params on `capturable`/`garrison` selected by profile (F5) | M | minor (defaults = v1) |
| G13 | Units | 3 classes (attack, defense, hp, speed, maxSpeed), skins add speed/resurrect/double/gold/rage, HP = power x hitPoints, attack not power-scaled, HP only decides soldier duels (03#2.3-2.5, 01#1.1) | Troop kind `{id, visual, value=1, speed}` (`troop.schema.ts:5-13`; `component-registry.ts:29`) | Unit def with `hp/attack/defense`, modifiers struct; flat 1/2/1 first (F8) | M (flat) / L (modifiers, rage) | minor |
| G14 | Shooters | Tower (instakill soldiers, -1 house level, radius by stage 1.6/2.5/3.4, delay 1.75*60/(2L+60)), fortress turrets, selectable fortress, rocket tower (aim path anywhere, area damage 3/4/5), capture RT, artillery soldier (03#5.5-5.9) | None. `shoots` only planned (`docs/GAME_RULES.md:342-350`; `packages/sim/test/extensibility.test.cjs`) | Needs projectiles or scheduled effects, targeting, kill-from-middle of a lane (ring is front-only, `state.ts:11-81`), area damage, `Aim` command (closed union `commands.ts:4-6`) | L | minor |
| G15 | Special buildings | Flag (last-house rule), boss tower (damage sponge, power-up loop), trolley (ready when filled to capacity; moving cart kills every soldier it touches; contact deletes the target building), railway (moving a building destroys its lines and in-flight soldiers), selectable fortress parachutes (03#5.6.1, 03#8.7-8.9) | None | Per-feature behaviours | L each | minor |
| G16 | Map elements | Obstacles (891 campaign levels), walls (397), mines (291), resources (412), rivers (208), cargo (600), sheep, gates, railway (03#8, 02#6, 02#10) | `obstacles`/`mapObjects` reserved and rejected (`core.schema.ts:44-47,62`; `validate-content.ts:144`); no sim code | Lane-crossing facility plus generic and bespoke components (section 3.5) | L (facility) + S-M per element | minor |
| G17 | Win/lose/time | Capture all non-ignored buildings; lose at zero non-ignored buildings; flag rule; no common time limit (03#7.2) | Elimination incl. troops in transit; timeout default 300 s (`tick.ts:6-35`; R-WIN-01/03) | Objective registry, `ignoreForWin`, optional timer (F6) | M | minor |
| G18 | Level format | 11 lists, short/long dialects, per-instance overrides, AI per player, no bounds/time/theme (02#3) | Towers with archetype+garrison, archetype-level overrides, `order`, `band` (`core.schema.ts:50-68`) | Level v2 (section 3.11): per-instance params, elements, inline bot, rules profile, view | M | none (schema bump) |
| G19 | Campaign sequencing and volume | RC list of 1,024 ids, 3 tutorials + 49 skipped then loop of 972 forever; per-mode lists (Daily, PvP, Arena, Tower, Boss, Festival); environment = (levelIndex/20) mod 6 (02#2, 02#4.1, 02#4.4) | Files by glob, `order` contiguous <= 20, `band` 1-4, up to 4 players (`validate-content.ts:151-155`; `apps/web/src/app/boot.ts:6-12`; `tools/src/levels.ts:21`) | `campaigns/*.json` lists with skip/loop/theme-cycle rules; lazy pack loading; difficulty tags replace `band` | M | none |
| G20 | AI behaviour | Default timer AI, weakest-first, random source, nearest-own fallback, never cuts; scripted queue (`AiDS/AiCWS/AiRM/AiSC`); inert reaction handler (04#2-6) | Utility scorer, 10 closed considerations, `kind` utility/idle, tick-keyed `ScriptedController` for tests (`bot-params.ts:5-9`; `bot.schema.ts:8`; `packages/bots/src/harness.ts`) | Bot-kind registry; kind `tw` (~60 lines per 04#12.3); event-sequenced script interpreter; inline per-level bot params | M | none for bots; BOT_VERSION bump |
| G21 | Difficulty | Per-seat percent 80..200 of human power, win/loss step, per-mode formulas (04#8) | Skill tiers only (06a#3) | `seatPower` in match setup (F12) | M | minor |
| G22 | Boosters | Bomb (zero a building level, 900 gold), Speed (player-only x speed and spawn), Trooper, Cargo drop (05#4.6, 03#8.10) | None | Commands `UseBooster` + player modifiers with expiry | M each | minor |
| G23 | Meta | Wallet of ~12 ints, unit level 1..110 with price curve and token gates, rarity 1-6, artefacts, research center, summon queue, quests, modes, shop, events, clans (05#2-5) | Save keeps completed levels, settings, last level (`apps/web/src/save/index.ts:14-20`); R-WIN-02 forbids persistent upgrades | New pure `packages/meta` + content tables; sim receives resolved modifiers only (F1, F12) | L (split) | patch (R-WIN-02 wording: sim sees only setup modifiers) |
| G24 | Skins and art | 43 unit skins x 4 colour textures, rigid-part meshes with clips, building stage meshes, 5 building colours, festival style (01#0-#5) | Static GLB, material-name tint, `none\|bob`, <=300 tris, per-kind not per-player skin (`manifest.schema.ts:16-37`; 06a#4, 06a#5.4) | Texture-swap team colours, multi-node animation, stage meshes, per-player skins, per-visual budgets | M-L | none |
| G25 | HUD, input, camera | Portrait 1080x1920 canvas, FOV 21 at 55 degrees pitch, drag-to-draw, swipe cut, long-press 0.7 s, progress bar, bomb/speed/emote buttons (02#3.7, 05#6) | Landscape fit camera, swipe/right-click cut (`apps/web/src/input/index.ts:80`), strength pill | Web-only; keep our camera, adopt thresholds and HUD skeleton | S-M | none |
| G26 | Tooling at scale | 2,195 level files (2,165 current format), 10 content-identical pairs (02#6) | Per-level `simHash` lock, `validate:levels` plays reference+idle bots per level, `check:content` loads everything (06a#2.6; `tools/src/levels.ts:19-24`) | Chunked packs, tiered validation, per-level `requires`, parallel balance | M | none |
| G27 | VFX, audio | 1,150 ParticleSystems not extractable, 85 FX textures (01#8.2) | Closed `BUILTIN_FX` set `pulse\|puff\|spark` (`apps/web/src/manifest/resolve.ts:16`) | FX registry in web; rebuild effects | S-M | none |

---

## 3. Target architecture (PROPOSAL)

Goal: express every Tower War feature and the foreseeable additions (new tower types, blockers, map elements, boosters, rage skills, AI scripts, skins, level packs) as content plus at most one behaviour file, with one registration point per concept, and without losing determinism, replays, goldens, hashes or the rules-authority workflow (`docs/GAME_RULES.md`: rule text and changelog first, then tests with `covers R-...`, then code; `AGENTS.md`).

### 3.1 Principles

1. **One definition, many consumers.** Each behaviour is declared once as plain data (params schema, state columns, phase placement, rule ids, version). Content validation, JSON Schema generation, the sim, the bots and the web client all import that definition. No second hand-written list anywhere (removes 06a#7 item 7).
2. **Behaviour files are keyed by definition id and exhaustiveness-checked by the compiler.** `Record<ModuleId, Behaviour>` fails typecheck if a definition has no implementation, replacing the runtime `assertParity` (`packages/sim/src/registry.ts:64`).
3. **Archetypes compose components; components are the only behaviour unit.** Buildings, units, map elements and projectiles are all "an id, optional `extends`, a bag of components, tags".
4. **Opt-in rules, v1 defaults frozen.** Every TW difference that conflicts with a v1 rule becomes a component param or a rules-profile entry whose default reproduces v1. Existing 20-level campaign, replays and goldens stay valid; TW parity is additive (RULES_VERSION minor).
5. **Sim is blind to meta, art and AI.** Meta and difficulty reach the sim only as a resolved `MatchSetup` recorded in the replay header (section 3.9). Art reaches nothing but the web client through the visual manifest. AI uses the same command path as humans (R-ENT-04).
6. **Closed enums become registries.** Commands, events, reject reasons, objectives, bot kinds, bot considerations, fx kinds, manifest visual kinds, theme/ground builders each get a definition type (section 3.14).
7. **Packs.** Content is grouped in packs (the Tower War import is a pack; today's 20 levels become pack `na-core`). A pack declares which modules and rules it needs, so levels can be gated by capability and a pack can be kept out of a public repo (section 3.10).

### 3.2 Module definitions and registration points

A **module definition** is a TypeBox-described value of this shape (pseudo-TypeScript, PROPOSAL; lives in a new pure package `packages/defs`, no I/O, browser-safe, imported by `content`, `sim`, `bots`, `apps/web`, `tools`):

```ts
defineModule({
  id: 'shoots',                         // unique; also the component name used in content
  kind: 'component',                    // component | command | event | objective | bot-kind | consideration | fx | render-kind
  version: '1.0.0',                     // behaviour version; major bump = replay outcomes change for levels using it
  ruleIds: ['R-SHT-01', 'R-SHT-02'],    // checked against GAME_RULES.md headings and `covers R-` tests
  params: { /* TypeBox: radius fx3, delay {...}, damage {...} */ },
  state:  { cooldown: 'int32', targetSeq: 'int32' },   // SoA columns (replaces ad hoc 'garrison.count' string keys)
  requires: ['garrison'], excludes: ['drawsLines'],     // archetype-level validation
  phase:  { id: 'projectiles', after: 'clash' },        // optional new phase; otherwise attach to an existing one
  tags:   ['targetable-by:rocket'],                     // free-form facets other modules/bots can query
  bot:    { extract: { value: 'radius' } },             // declarative scalar for bot scorers; code only if non-trivial
  view:   { overlay: 'range-ring', fx: ['Shot'] },      // hints; the web registry binds them to renderers by key
})
```

Registration points (one authoritative place per concept; everything else is derived):

| Concept | Where it is registered (the only place to touch) | Derived automatically | Optional sibling code |
|---|---|---|---|
| Component / behaviour (building, unit, element, projectile) | `packages/defs/src/modules/<id>.def.ts` | content schema + generated JSON Schema, validator rules, rule-id coverage, replay-header module version, bot `componentValue` keys (today `Object.keys(COMPONENT_REGISTRY.components)`, `bot-params.ts:56`) | `packages/sim/src/modules/<id>.ts` (systems/hooks), `packages/bots/src/extract/<id>.ts` (only if declarative extractor insufficient), `apps/web/src/render/modules/<id>.ts` (overlay/fx) |
| Command (DrawLine, CutLine, Aim, UseBooster, MoveRail, Erase) | `packages/defs/src/commands/<type>.def.ts` (schema, reject reasons) | replay JSON validation, command type union (generated), bot `canDraw`-style validators | `packages/sim/src/commands/<type>.ts` (validate + apply) |
| Event (LineDrawn, Shot, WallHit, ...) | `packages/defs/src/events/<type>.def.ts` | web fx/sfx binding via the manifest `events` map (already keyed by event name, 06a#4.1), event union | none |
| Objective (win rule) | `packages/defs/src/objectives/<id>.def.ts` | level `rules.objective` validation | `packages/sim/src/objectives/<id>.ts` |
| Bot kind | `packages/defs/src/bots/<kind>.def.ts` (params schema) | `BotSchema` oneOf, tier/inheritance validation | `packages/bots/src/kinds/<kind>.ts` |
| Rage skill, booster | module with `kind: component` attached to a unit/player archetype (see 3.7) | as above | sim behaviour file |
| Level element, building type, unit type | **data only**: a JSON archetype file (section 3.10) | nothing to register | none, if components exist |
| Skin, theme, palette, stage meshes | **data only**: visual manifest of the pack (section 3.12) | `check:manifest` | none, unless a new `render-kind` is needed |

Discovery. Behaviour files are found by convention (`<id>.ts` next to siblings) and wired by one generated barrel (`pnpm modules:index`, checked in CI like `check:schemas`) for Node, and by Vite glob in the web client (already used for content, `apps/web/src/app/boot.ts:6-12`). The exhaustive `Record<ModuleId, Behaviour>` type is built from the generated id union, so a missing file is a compile error and a stray file is a lint error.

Phases. Replace the fixed `PHASES` tuple (`registry.ts:8`) by a partial order assembled from definitions: each module may declare `phase.id` with `after`/`before` and each system an `order` within its phase (the existing `ComponentSystem.order`, `registry.ts:13`). Resolve once at sim creation by stable topological sort (ties by id), hash the resolved phase list into the replay header, and keep the v1 list as the base so v1 order is byte-identical.

### 3.3 Entity model and component catalogue

Five entity classes, all archetype-driven:

| Class | Today | Proposed |
|---|---|---|
| **Building** (TW "House", "Tower", "RocketTower", "SelectableFortess", "Fortess", "Flag", "CaptureRocketTower", "BossTower", "Trolley", "Resource") | tower archetypes in `data/archetypes/*.json` (`packages/content/data/archetypes/standard.json`) | `data/buildings/<id>.json`, same schema as archetypes (alias folder kept for compatibility); instance params per level entry |
| **Unit** (TW "Warrior": soldier, tank, artillery) | troop kind `{id, visual, value, speed}` (`troop.schema.ts:5-13`) | `data/units/<id>.json` with components (`hp`, `attack`, `defense`, `mover`, `ranged`, `shield`, `airborne`, ...) |
| **Element** (obstacle, wall, mine, river, bridge ceil, sheep pen, gate, cargo, resource pile) | reserved empty arrays (`core.schema.ts:44-47,62`) | `data/elements/<id>.json` with components (section 3.5) |
| **Projectile** (tower bullet, rocket, artillery shell, capture rocket, bomb) | none | `data/projectiles/<id>.json` (`mover`, `explodes{radius, damage}`, `homing`) or "scheduled effect" (instant hit after travel delay computed from distance/speed) |
| **Road / lane** | directed channels with FIFO rings (`packages/sim/src/state.ts:11-82`) | unordered `road` entity (pair + path geometry + crossings) owning two directed lanes (channels) |

Component catalogue. "Exists" = present in our registry today; "new" = needs a definition plus a behaviour file. Params shown are the TW constants from 03; values stay in content.

| Component (module id) | Params (TW source) | Phase | Used by | Status |
|---|---|---|---|---|
| `garrison` | `cap` (`ml`), `start`, `art.stages` hint | arrivals | all capturable buildings | exists (`component-registry.ts:23`), add `start` |
| `capturable` | `threshold: zero\|exceed`, `overkill: carry\|discard`, `killOutgoingOnCapture`, `forwardOverflow` (03#5.3) | arrivals | houses, towers, fortresses, flag, trolley | exists (no params), extend (F5) |
| `drawsLines` | `extraSlotAbove`, `slotLoss: cutNewest\|keep`, `startTypes` (can start lines) (03#3.2) | commands, slots | house, selectable fortress, trolley | exists, extend |
| `generates` | `troop`, `ratePerSec` | generation | NA-native towers | exists, unchanged |
| `spawns` | `unit`, `ws`, `cwc`, `sc`, `aliveCap`, `perLine` (03#4.1-4.3) | generation, departures | TW houses, selectable fortress | new |
| `grows` | `periodBase` (`gl`), `stageLevels: 10`, `coef: 0.9`, `stopWhenLines` (03#4.6) | generation | TW houses | new |
| `shoots` | `targets: [warrior, building]`, `radius{base, perStage}`, `delay{base, coef}`, `stages: [10,30]`, `damage{warrior: kill, building: 1}`, `projectile`, `speed` (03#5.5) | projectiles | tower, fortress turrets, selectable fortress | new (planned in `docs/GAME_RULES.md` section 6) |
| `aimsRocket` | `stageDamage [3,4,5]`, `volleyDelay`, `moveTime`, `areaRadius`, `disableOnZero` (03#5.7) | commands, projectiles | rocket tower | new (needs `Aim` command) |
| `chargedStrike` | `startPoints`, `maxPoints`, `cooldown`, `blastRadius 3.0`, `effect: zeroLevel`, target = highest-level building (03#5.8; it zeroes level, does not capture) | projectiles | capture rocket tower | new |
| `dropsReinforcements` | `delay`, `count`, `perParachute`, `fall` (03#5.6) | generation | selectable fortress | new |
| `flag` | objective hook: last-building flip (03#7.2) | win | flag | new (objective param) |
| `rides` | rail polyline, move durations, lock state (03#8.8) | commands | railway buildings | new (E5) |
| `explodesOnContact` | removes target building (03#8.7) | arrivals | trolley | new (E5) |
| `resourceSource` | `amount`, `pickupDisable` (03#6) | arrivals | resource pile | new |
| `bossRoutine` | move points, power-up table (03#8.9, 04#10) | generation | boss tower | new, deferred |

Unit components (new): `hp` (`value`, `fromPower` coefficient), `attack` (`default`, `vs{building, wall, resource, warrior}` replacing `DamageableData`, 03#5.1), `defense`, `mover` (`speed`, `maxSpeed`, `speedUpCoefficient`), `shield`, `airborne`, `ranged{radius, firstDelay, nextDelay, bulletSpeed}` (03#5.9), `carries{resourceType}` (03#6), `rage{skill, chance}` (03#5.10). The v1 `value` field stays as sugar that expands to `hp=attack=defense=value`.

### 3.4 Rules profiles, RULES_VERSION and module versions

- **Profile** = a small JSON object `data/core/profiles/<id>.json` choosing variant params for core rules, referenced by `level.rules.profile` (default `na-v1`). Example (`tw-1.29`): `{ objective: 'captureAll', capture: { threshold: 'exceed', overkill: 'discard', killOutgoingOnCapture: true, forwardOverflow: true }, slots: { slotLoss: 'keep' }, arrival: { consume: 'all', damage: 'attack', friendlyAdds: 'defense' }, crossContact: true, timeLimit: null }` (slot thresholds themselves are archetype content, `[9, 29]`). The resolved profile enters the level hash.
- Why a profile and not per-archetype params only: capture/arrival/objective variants are properties of the ruleset, not of one tower; one place keeps TW levels consistent and keeps rule text per variant (R-CPT-01 "v1 variant", "TW variant").
- **Versioning (PROPOSAL):** `RULES_VERSION` stays the core contract version (`packages/content/src/versioning.ts:7`, `docs/GAME_RULES.md:3`, `content.json`). Add per-module `version` (in the def) and a replay-header map `modules: {id: version}` for the modules a level uses plus the resolved profile id and phase-list hash. Replay compatibility = same core major.minor and same major for each used module. A module behaviour change that alters outcomes bumps only that module's major and invalidates goldens only for levels that use it. Adding a module = RULES_VERSION minor (additive component, existing replays unaffected). Rule IDs get new areas (`SHT` shoot, `ELM` elements, `OBJ` objectives, `SPN` spawn, `PRF` profile, `BST` boosters) and live in `docs/GAME_RULES.md` (or split `docs/rules/*.md` indexed by it; `check:rules` already keys off headings, `tools/src/rules.ts`).
- **Migration of "major vs minor" classification used in the gap map:** with the opt-in design no TW feature requires a v1 default to change, so the whole port is minor bumps (1.1.0, 1.2.0, ...). If the owner instead wants TW behaviour to replace v1 defaults (single ruleset), every row marked "minor (defaults = v1)" becomes **major** and the 20 NA levels must be re-balanced (open decision D3).

### 3.5 Map elements as lane modifiers

Observation (03#8): walls, mines, gates, sheep, rivers, obstacles, resources are all "something positioned on the map that interacts with troops or lines that touch it". Express them with a small set of generic components plus three bespoke ones.

Generic components (new, element archetypes):

| Component | Params | Meaning |
|---|---|---|
| `shape` | `circle{r}` or `rect{w,h,rot}` or `poly[]` | footprint in world units (used by corridor test, crossing computation, render picking) |
| `blocksLines` | `corridor` (default: line half width 0.19, see 04#3.2) | a road whose corridor intersects the shape is rejected at draw (reason `blocked`) |
| `blocksTroops` | none | troops cannot pass (used with obstacles that sit on a lane; TW: obstacle colliders, 03#8.1) |
| `hp` | `value`, `regen` | depletable; at 0 the element is removed and its roads/crossings recomputed |
| `onCross` | `effect: kill\|drain\|modify\|consume\|pick`, `amount`, `immunityStat`, `destroySelf`, `drainsHp` | effect applied to each troop whose arc-length progress crosses the element on a lane; implemented once as a lane-crossing event handler |
| `timed` | `cooldown`, `respawn` | re-arm and resurrection timers (sheep 30 s, resource disable 4 s) |

Mapping of each TW element to components (03#8, 02#3.6):

| TW element | Components | Bespoke code? |
|---|---|---|
| Obstacle (OBS/ROBS) | `shape`, `blocksLines`, optional `blocksTroops` | no (render only differs by theme meshes) |
| Wall (`Hp`, `PS`) | `shape`, `hp{value:Hp}`, `onCross{effect: drain, amount: attack.vs.wall, destroySelf: false, consumesTroop: true}` | no |
| Mine | `shape`, `onCross{effect: kill, amount: 1, immunityStat: mineBlock, destroySelf: true, delay: 0.1s}` | no |
| Gate (Plus/Minus/Multiply/Divide, `C`) | `shape`, `onCross{effect: modify, op, coef, perGroup: true}` | small: per-group bookkeeping (group id = spawn batch) |
| Resource pile | `shape`, `resourceSource`, lanes may end on it | yes: troop `carries` + return trip (reverse re-anchor) |
| Cargo | `shape`, `resourceSource`-like reward, tap/hit open | yes (meta reward hook) |
| River + bridge | `shape`, `bridgeable{ceils, widths}` plus troop `carries{wood}`; ceil state per element | yes: per-ceil activation, plank consumption, reverse or die when no plank (03#8.4) |
| Sheep pen | `shape`, `penned{moveTime, returnDelay, cooldown}`, `timed`; destroys roads still crossing when sheep return | yes (road destroy hook) |
| Trolley, railway | `rides`, `explodesOnContact` on buildings (not elements) | yes |
| Speed tower (unused in TW) | would be `aura{radius, spawnMult}` | not needed |

Lane-crossing facility (the one new piece of engine, PROPOSAL):
- At `DrawLine` (and on element removal) compute, for the new road polyline, its intersections with every active element `shape` and every other road's polyline. Store per lane a sorted list `crossings[] = {s, kind: element|lane, ref}` (arc-length `s` in progress units, same unit as R-TCK-04).
- Each tick, for each lane with crossings, find troops whose progress moved from below to at-or-above `s` this tick (the ring is FIFO by progress for equal-speed troops, so a front-to-back scan with early exit is enough). Dispatch to the module that owns `ref` in a stable order (tick, lane key, fifo, crossing index). For `kind: lane` crossings, compare the two lanes' troop time-intervals within contact radius to decide a crossing contact (G11).
- Cost: O(troops near a crossing) per tick; typical TW level has 9 buildings and a handful of lanes (02#6), well inside the existing performance budgets (`pnpm bench:sim`).
- Ring changes this implies (to design in SP-B/SP-E): `kill(seq)` marks a middle troop's value 0 and skips tombstones at `front()`; per-troop speed column (today speed is per kind, `combat.ts:9-11` and duplicated in `packages/sim/src/read.ts:75`); re-anchor (`p0`, `t0`) when a troop's kinematics change; sorted insert for returning troops (resource collectors, bridge-less soldiers) on the reverse lane.

### 3.6 Lines, roads and path geometry

- `road` entity = unordered tower pair + `path` (provider id + points) + two lanes. Providers: `straight` (v1 default and all TW normal levels: a 2-point path, 03#3.3) and `polyline` (Draw levels, 130 files, not in the campaign list, 02#2; store the raw drawn anchors, smoothing is cosmetic, 03#3.3). Lane length is computed once from the polyline (integer `isqrt` per segment, R-TCK-02).
- Line validity (new `validateDraw` hooks, still `DrawLine` command): owner, source has `drawsLines`, free slot, no duplicate, plus `blocked` (corridor vs `blocksLines` shapes and third buildings; end buildings exempt, 04#3.2), rivers do not block (TW). Reject reasons become a registry (today a closed union, `commands.ts:7`).
- Eraser: swipe polyline vs lane polylines owned by the swiper (03#3.5). Our `CutLine` stays per pair; the web input maps the swipe to the intersected owned lanes.
- Slot rules stay in `drawsLines` (G07).

### 3.7 Units, modifiers, skins, boosters, rage

- **Unit archetype** (data): `data/units/soldier.json` = `{ components: { hp: {value: 1}, attack: {default: 1}, defense: {value: 1}, mover: {speed: 5, maxSpeed: 7.5} } }`; tank `hp 2, attack 2, defense 1`; artillery adds `ranged`. HP from power: `hp.fromPower` coefficient (1/2/1 from `hp_config`, 03#2.4) applied to `setup.power`.
- **Modifiers** (per player, resolved before the match, recorded in the header): `{speedPct, shieldPct, doublePct, goldBonus, rageChance, wallDamage, mineBlock, towerBlock, plankCarry, goldCarry, vsColourShieldPct[3]}` (03#9 port notes). Units read them at spawn: speed, shield flag (seeded roll), double-unit (seeded roll), carry capacity. The sim never knows whether a modifier came from a skin, an artefact or a research upgrade.
- **Boosters** (`kind: command` + player modifier): `UseBooster{bomb}` picks the highest-level enemy/neutral buildings (excluding resources, flags and ready trolleys), then tweens each target's level to 0 over 1.0 s after a random 0-0.3 s delay; ownership is unchanged (03#8.9; aim count from setup, see the discrepancy in section 6), `UseBooster{speed}` sets `speedMult` for the player's troops and spawn until an expiry tick; trooper and cargo are meta-gated. Prices and gating are meta, not sim.
- **Rage**: `rage{skill, chance}` on a unit; skills are modules with `kind: component` giving temporary modifiers and area effects (Dash, Flamethrower, BurningEarth, Forsage, Hail, Annihilation, Laser). Activation is now decoded (03#5.10): one seeded roll per unit at spawn (percent, caps 30 player / 200 bot), armed for the unit's life; Dash, Flamethrower and Annihilation trigger on head-on contact with an enemy on the same lane, Forsage and Laser immediately when armed, Hail and BurningEarth only on artillery shots; some trigger-box sizes and conditions remain partly unverified. Schedule after E3.
- **Skins** are visual only (section 3.12): a skin id maps to model parts, four team textures, icon, and carries the *meta* bonuses used to build `modifiers`. Per-player skin = `MatchSetup.players[].skin`.

### 3.8 AI

- Bot kinds become registered modules (`kind: bot-kind`): `utility` and `idle` (existing), `tw` (new, spec in 04#12.3), `script` as a prelude available to any kind. Level player entry gains an inline block `bot: { profile?, kind?, params?, script? }`; `botProfile` stays as a shorthand. Resolution and hashing as today (`packages/content/src/resolve-profiles.ts`, `hash.ts`), with the inline block merged over the profile.
- `tw` kind params (04#12.2): `actionDelaySec`, `behavior` (`attack` full; `defense`/`random` attack-only, 04#13), `reactionDelaySec` (reserved, handler inert in TW, 04#4), `levelDiscount{special: 1.5}`, `script[]`.
- Script interpreter (new, shared): ops `delay`, `line`, `steps` (tree, children in parallel, capture poll 1 s = 20 ticks), `railMove`; semantics from 04#6.2 (skip when authored own building lost, fallback source, capture wait). State is local to the bot; reads the same `BotContext` (`packages/bots/src/index.ts`); randomness from the seat stream only (driver rule, 04#12.3).
- `consideration` registry replaces the closed `BOT_CONSIDERATIONS` list (`bot-params.ts:5-9`) so utility bots can score `shoots` or obstacle-aware features without schema edits.
- Difficulty: `seatPower` percent in `MatchSetup` (default 100, TW range 80..200), applied as modifiers to the bot's units/spawns (04#8.1). Controller lives in `packages/meta`, never in sim or bots (04#12.4).
- Not ported: fake-lobby UX, nickname pool, boss AI (until a boss mode), useless-attack behaviour (disabled in RC, 04#5).

### 3.9 Meta and the match-setup contract

- New pure package `packages/meta` (TS, deterministic where it touches sim inputs): wallet, reward/price schemas (05#2.2), unit progression (price curve, token gates, evolve gates, 05#3.2), combat power (05#3.4), summon queue (05#3.6), unlock gates (05#7), quests (05#4.5), research upgrades (author the numbers, 05#3.5), campaign/mode state. Content tables live in `data/meta/` (RC-style: one JSON per concern, same shape as the RC keys in 05#9). Remote-config-style overrides can be added later by loading a second pack layer.
- `MatchSetup` (PROPOSAL) is the only meta-to-sim channel:

```jsonc
{ "levelId": "levelview-1", "seed": 123456,
  "players": [ { "id": "p1", "skin": { "soldier": "skin:default:1", "tank": "skin:attack:1", "artillery": "skin:artillery:1" },
                 "modifiers": { "speedPct": 5, "shieldPct": 1, "doublePct": 1, "wallDamage": 0, "mineBlock": 0 },
                 "power": 100, "seatPowerPct": 100 } ],
  "boosters": { "bombAims": 1 } }
```
`setupHash = sha256(canonicalJson(setup minus presentation fields like skin ids))` goes into the replay header next to `simHash`; replays play back without meta. R-WIN-02's "no persistent upgrades" becomes "the sim itself grants none; setup modifiers are inputs".
- Save data: grows from `{completed, settings, last}` (`apps/web/src/save/index.ts:14-20`) to the meta state, versioned and migrated in `packages/meta`.

### 3.10 Content layout (folders, files, schemas)

```
packages/defs/                          NEW  pure module/command/event/objective/bot-kind definitions + TypeBox schemas
packages/content/
  content.json                          envelope: schemaVersion, rulesVersion, contentVersion, packs[] (ids + versions)
  data/
    core/
      profiles/na-v1.json, tw-1.29.json rules profiles (3.4)
      balance.json                      defaults (time limit, theme) as today
    packs/
      na-core/                          today's 20 levels, 3 archetypes, 23 bot profiles (migrated, behaviour unchanged)
      tower-war/                        imported pack (may live in a private repo or git submodule, D1)
        pack.json                       { id, version, requires:{rules:'^1.x', modules:['spawns',...]}, licence:'personal-use', source:{game,version} }
        units/*.json                    soldier, tank, artillery (+ ranged etc.)
        buildings/*.json                house-soldier, house-tank, house-artillery, tower, rocket-tower, selectable-fortress, fortress, flag, capture-rocket-tower, trolley, boss-tower, resource
        elements/*.json                 obstacle, wall, mine, river-line, sheep-pen, gate, cargo, ...
        projectiles/*.json              tower-bullet, rocket, artillery-shell, capture-rocket
        boosters/*.json                 bomb, speed, trooper
        rage/*.json                     dash, flamethrower, ...
        ai/*.json                       tw-default, tw-attack-only, tutorial-passive (AD >= 30)
        campaigns/*.json                common.json (ordered id list), daily.json, pvp.json, challenge-tower.json, arena.json, boss.json, festival-terminator.json
        levels/<family>/<slug>.json     level v2 (3.11); families LevelView, Pvp, Arena, ChallengeTower, Draw, Daily, Boss, Terminator
        levels/<family>/_index.json     id -> file, requires[], hash (lazy-loading index; also feeds hashes.lock.json)
        meta/*.json                     currencies, rewards, unit-progression, summon-queues, unlock-gates, quests (RC-shaped)
        hashes.lock.json                per-level simHash, per-bot botHash for this pack
  schemas/                              generated JSON Schemas (as today)
packages/meta/                          NEW  wallet, progression, power, summon, quests (3.9)
apps/web/assets/packs/<pack>/
  visuals.json                          visual manifest for the pack (3.12)
  skins/<skin-id>.json                  one file per skin (3.12)
  models/*.glb, textures/*.png, audio/*
tools/import-tower-war/                 NEW  deterministic importer (3.11); never ships to the web bundle
```

Schemas (generated from defs, `pnpm content:schemas`, as today): `unit.schema`, `building.schema` (= `archetype.schema` renamed with alias), `element.schema`, `projectile.schema`, `profile.schema`, `campaign.schema`, `pack.schema`, `level.schema` v2, `bot.schema` (oneOf by registered kind), `visuals.schema` (open `kind`), `skin.schema`, `meta-*.schema`. The open-param-bag approach already used for components (`core.schema.ts:18-30`) generalises: params are validated by the owning module definition instead of the central `COMPONENT_REGISTRY`.

Instance params and archetype inheritance: levels reference an archetype and may set per-instance `params` for any component param (TW's `l`, `ml`, `ws`, `ad`, `ar`, ...). Validation is by the module definitions; the resolved values enter the level hash. Archetype `extends` stays depth-limited but may now add components (today variants cannot, `packages/content/src/resolve-archetypes.ts:23-28`); relaxing that is part of SP-A and is what lets `house-tank` be `house-soldier` plus a different `spawns.unit`.

### 3.11 Level v2 and the lossless importer

Pipeline (PROPOSAL; builds on the prototype converter `p2_tw2na.py`, 02#8-9):

```
TW level JSON (v0/v1-short/v1-long)  --p2_levellib-->  tw-level-ext v0.1 (lossless, 2,195/2,195 round-trip proven, 02#9)
                                                         |
                                  tools/import-tower-war (deterministic, pure) 
                                                         v
                                   level v2 files in packs/tower-war/levels/<family>/  +  campaigns/*.json  +  _index.json
```

Level v2 shape (compact; replaces `order`/`band`/`towers`/`obstacles`/`mapObjects`; v1 files are migrated mechanically):

```jsonc
{ "schemaVersion": "2.0.0", "id": "levelview-277-es", "name": "LevelView 277_ES",
  "category": "campaign", "source": { "game": "tower-war", "version": "1.29.3", "asset": "LevelView 277_ES", "dialect": "v1-short" },
  "rules": { "profile": "tw-1.29", "objective": "captureAll", "timeLimitSec": null },
  "view": { "theme": "env:green", "bounds": "auto" },
  "players": [ { "id": "p1", "kind": "human", "colorKey": "blue" },
               { "id": "p2", "kind": "bot", "colorKey": "red", "bot": { "kind": "tw", "params": { "actionDelaySec": 10, "behavior": "defense", "script": [ ... ] } } } ],
  "neutral": { "colorKey": "gray" },
  "buildings": [ { "id": "b1", "archetype": "house-soldier", "pos": [0.14, -3.69], "owner": "p1", "params": { "garrison": { "start": 10, "cap": 64 }, "spawns": { "ws": 0.5, "cwc": 0.3, "sc": 1.7 }, "grows": { "periodBase": 1.7 } }, "ignoreForWin": false } ],
  "elements": [ { "id": "e1", "archetype": "wall", "pos": [1.0, 2.0], "rot": 30, "params": { "hp": { "value": 5 } } } ],
  "requires": ["spawns", "grows", "shoots", "wall"] }       // computed, never authored
```

Mapping (from 02#3.4-3.6, 03#7.1): `P[].PT/PC` -> `players` + `neutral`; `BD[]` entries -> `buildings` with `archetype` chosen from `bt` + `WT` + `lt` (festival style -> style key, not a new archetype) and `params` from the short keys; `WOD res` -> `elements` `resource-pile`; `OBS` children -> one `obstacle` element per active child; `ROBS`, `Mine`, `Wall`, `Sheep`, `River`, `Gate`, `Railway` -> elements; `Cargo` -> `cargo` elements with `building` link; `AiDS/AiCWS/AiRM/AiSC` -> `bot.params.script` ops (04#12.2); building ids keep the game ids as strings (`b<id>`), preserving cross references. Anything the importer cannot place goes to `extra` (lossless), so `ext -> v2 -> ext` is a CI round-trip test (`pnpm check:import`).

`requires` drives gating: a campaign list entry is playable iff all `requires` modules are registered in the running build. The importer emits the whole pack from day one (2,165 current-format levels shipped, 30 v0 legacy assets kept archive-only); the picker filters by capability, so coverage grows as modules land (section 7.2).

Scale and size: the 2,195 raw TW level files total 10.4 MB (average 4.7 KB, measured); v2 with semantic keys will be larger before gzip. Do not `import.meta.glob` all of it eagerly (today `boot.ts:6-12` loads every level at boot): fetch `_index.json` and campaign lists at boot, level files on demand, optionally bundled per family. `check:content` and `content:lock` run per pack with a per-pack lock so the NA-core lock is untouched by importer reruns.

Campaign lists (`campaigns/common.json`): `{ id, entries: [{ level, tutorial?: true, difficulty? }], skipOnLoop: 52, loop: 'tail', envCycle: { everyLevels: 20, envs: ['green','snow','lava','mine','jungle','darkmine'] } }` mirrors TW's skip/loop and environment rules (02#4.1, 02#4.4). Other lists (daily, pvp, arena, tower, boss, festival) are the same shape with `loop: 'modulo'`. App code only interprets the list; no order data lives in level files, which removes the `order <= 20` and band pins (`validate-content.ts:151-155`, `campaign-invariants.test.ts:51-53`, `tools/src/levels.ts:21`).

### 3.12 Skins and visual manifests

- `visuals.json` per pack replaces the single `apps/web/assets/manifest.json` (06a#4.1): `palettes` (team colour keys incl. `gray`), `themes` (`env:green`, ...: ground, sky, light, fog, scatter, `propSet`), `events`, `camera`, `levelVisuals`. `visuals.kind` becomes open (`tower|troop` today, `manifest.schema.ts:34`) with a registered renderer per kind (`building`, `unit`, `element`, `projectile`).
- **Skin** file (one per skin; TW has 43 unit skins x 4 team textures, 01#2):

```jsonc
{ "id": "skin:default:10", "class": "soldier", "name": "Cowboy Bob", "rarity": 5,
  "model": { "parts": "skins/default-10.glb", "lod": ["skins/default-10-lod1.glb"], "budget": "unit-hi" },
  "team": { "mode": "textureSwap", "textures": { "blue": "textures/default-10-blue.png", "green": "...", "red": "...", "yellow": "..." } },
  "anim": { "clips": { "run": "Run", "death": "Death", "parachute": "ParachuteFly" }, "mode": "node-tracks" },
  "bonuses": { "speedPct": 5, "shieldPct": 1, "doublePct": 1, "goldBonus": 10 },   // meta, copied from WarriorSkinData
  "icon": "icons/default-10.png", "rage": { "skill": null, "chance": 0 } }
```
`team.mode` is a registered strategy (`tint` = today's `teamMaterial`, `textureSwap` = TW). Building visuals add `stages: [{ minLevel: 0, mesh|enable }, { minLevel: 10, ... }, { minLevel: 30, ... }]` (TW art stages are 3 per building, thresholds not serialized, 01#3.3; default 10/30 to match slots, D8) and `teamTextures` per colour. The stacked code-built tower stays as `build: stacked` (registered), and GLB buildings get the same roof-count overlay so the two paths have feature parity (06a#7 item 8).
- **Swapping all characters** = replacing the skin set and the `defaultSkins` map in `visuals.json`; no sim, level or code change (section 3.15, example 4). Per-player skins come from `MatchSetup`.
- Budgets (today fixed: troop <=300 triangles, textures <=1024; `check:manifest`, 06a#4.3) become named budget classes per visual (`unit-lo` 300, `unit-hi` 2500, `building` 5000, ...), because TW battle units are 1,036-2,330 triangles (01#7.2) and ~30 soldiers per house at once. Instancing and the existing derived low-LOD (`apps/web/src/render/troop-lod.ts`) carry the cost.
- Animation: TW uses 3-4 node-TRS clips per soldier (53 decoded, `catalog/anim_unit_clips.json`, 01#8.1); our static-mesh policy rejects skinned meshes only. Proposal: keep rigid-part GLBs (no skins), bake per-part node tracks into a small vertex-animation texture or a shader-driven part transform for instanced units; tanks and artillery are static parts (01#1.4).

### 3.13 Versioning, hashes, locks

| Item | Today | Proposed |
|---|---|---|
| Core rules version | `RULES_VERSION` (`versioning.ts:7`) | unchanged; minor bump per added module or param family |
| Module version | none | per def; map in replay header for modules the level uses |
| `simHash` | SHA-256 of resolved level: players, towers (resolved components), kinds (`hash.ts:58-69`) | adds buildings (resolved params incl. instance overrides), elements, resolved profile, used module versions, resolved bot kind is excluded as today (`botHash` separate); presentation (`visuals`, skins, themes) still excluded so reskins never move it |
| `setupHash` | none | new: modifiers, power, seat power, boosters (replay header) |
| `contentVersion` | one monotonic semver, bumped when any level hash moves (`versioning.ts:34-41`) | per pack `version` + global envelope version; `check:content --base` compares per pack; `na-core` unaffected by Tower War pack churn |
| Lock | `packages/content/hashes.lock.json` per level and bot | `hashes.lock.json` per pack; importer regenerates only its pack |
| Manifest gate | `check:manifest` (assets, budgets, credits) | per pack; credit entries per external model remain (`docs/CREDITS.md`); `licence` field per pack |
| Goldens | `sim:golden`, `bots:golden`, `replay:verify golden` | add `tw` profile goldens (hand-built TW-shaped levels per module); keep NA goldens untouched; importer levels covered by a sampled replay set, not 2,165 goldens |

### 3.14 Closed enums and literals to open

| Closed today | Where | Replacement |
|---|---|---|
| `PHASES` tuple | `packages/sim/src/registry.ts:8` | phase partial order from definitions (3.2) |
| `Command` union | `packages/sim/src/commands.ts:4-6` | command registry |
| `RejectReason` union | `commands.ts:7` | string ids declared by command/validator definitions |
| `SimEvent` union | `commands.ts:10-19` | event registry; web `fx.ts` handlers keyed from manifest `events` |
| `Outcome` | `commands.ts:8` | objective definitions return outcome ids (`won\|lost\|draw\|timeout` stay core) |
| Win rule | `packages/sim/src/tick.ts:6-35` | objective registry (`elimination`, `captureAll`) |
| `COMPONENT_REGISTRY` (content) vs `createComponentRegistry` (sim) | `component-registry.ts:22-30`, `registry.ts:74-87` | single `packages/defs` catalogue, compile-time exhaustive implementation map |
| `troopValue {1..1}` | `component-registry.ts:29` | unit components `hp/attack/defense` with own ranges |
| `BOT_CONSIDERATIONS`, `BOT_ACTIONS`, bot `kind` | `bot-params.ts:5-9`, `bot.schema.ts:8` | consideration and bot-kind registries |
| Bot scorer literal columns | `packages/bots/src/considerations.ts:200-201` | columns read through module-declared state names, absent component yields neutral score |
| Level `players` 1 human + 1-3 bots, 4 colours | `validate-content.ts:105`, manifest palettes | profile/objective declares player counts; palette keys open (`gray`, extra colours) |
| Campaign `order` <= 20, `band` 1-4 | `validate-content.ts:154`, `tools/src/levels.ts:21` | campaign lists; `difficulty` tag instead of band, `validate:levels` thresholds keyed by tag |
| `obstacles`/`mapObjects` reject | `validate-content.ts:144` | `elements[]` validated by module definitions |
| Manifest `visuals.kind`, `build`, `anim`, `fx` | `manifest.schema.ts:16-37`, `resolve.ts:16` | registered render kinds, build strategies, anim modes, fx kinds |
| `PROP_KINDS`, `MAX_FLOORS`, overlay keys | `apps/web/src/render/props.ts:11`, `tower-mesh.ts:8`, `overlays.ts:9-17` | manifest-driven props, `stages` in visuals, overlays keyed by module `view` hints |
| Event name literals | `apps/web/src/render/fx.ts:17-29`, `audio/index.ts:82` | manifest `events` map only |

### 3.15 Worked examples: files changed, today vs proposed

**Example 1: add a new tower type.**

| Case | Today (06a#5.1) | Proposed |
|---|---|---|
| 1a. Same behaviours, new numbers/look ("fortress" with bigger cap) | new `data/archetypes/<id>.json` (+ manifest `visuals`/`models` entries; GLB path loses the roof number) | new `packs/<p>/buildings/<id>.json`; new skin/visual entry in `visuals.json` (roof number works on every build path). 1-2 files, no gate beyond lock/version |
| 1b. New behaviour (e.g. "frost tower" that slows troops) | `GAME_RULES.md` (+changelog, +section 6), `versioning.ts`, `content.json`, content `component-registry.ts`, `core.schema.ts` (if typed param), sim `registry.ts` + system file, bots `considerations.ts` + profiles + `version.ts`, web `overlays.ts`, `fx.ts`, tests, goldens (about 12-14 files, 3 places for the rules version) | `docs/GAME_RULES.md` rules + changelog; `packages/defs/src/modules/slows.def.ts`; `packages/sim/src/modules/slows.ts`; `data/.../buildings/frost-tower.json`; tests with `covers R-SLW-*`. Generated: schema, validator, bot `componentValue` key, replay module-version. Optional: bot extractor (declarative first), web overlay key. 4-5 files you author |
| 1c. A tower that is an existing TW composition (e.g. rocket tower) | not possible | `buildings/rocket-tower.json` using `garrison`, `capturable`, `aimsRocket` once `aimsRocket` exists |

**Example 2: add a blocker or map element.**

| Case | Today (06a#5.2) | Proposed |
|---|---|---|
| 2a. Static blocker ("log barricade") | impossible without schema, validator, compile, hash, sim, bots, rules, renderer, input, manifest changes (about 10 areas, greenfield) | `elements/barricade.json` = `shape` + `blocksLines`; visual entry in `visuals.json`; instances in level files. 2 files once SP-E1 exists (the blocker mechanism itself is the SP-E1 work) |
| 2b. Wall with HP, mine, gate | same | `elements/<id>.json` using `hp` + `onCross` (no code) |
| 2c. New effect type (e.g. "tar pit slows lane") | same | one module def + behaviour for a new `onCross` effect kind, or a new `slowsLane` component |

**Example 3: add 500 levels.**

| Today (06a#5.3) | Proposed |
|---|---|
| Data only, but: relax four pins (`validate-content.ts:105,154`, `campaign-invariants.test.ts:51-53`, `tools/src/levels.ts:21`), bump `contentVersion`, `content:lock`, run `validate:levels` over all (bots per level, 4 seeds), whole set bundled eagerly | Drop JSON in `packs/<p>/levels/<family>/`, add ids to `campaigns/<list>.json`, run `pnpm content:lock --pack <p>`; level `requires` auto-computed; unplayable-yet levels are listed but gated; `validate:levels` runs tiered (sampled seeds, reference bot only on changed levels); lazy load. Zero code; zero pins |

**Example 4: swap all characters.**

| Today (06a#5.4-5.5) | Proposed |
|---|---|
| Replace GLB in `apps/web/assets/models/`, edit `manifest.json` `models` and `visuals.troop.*`; keep material name `Shirt` or lose team colour; static mesh <=300 triangles, `bob` only; per-player or per-faction skin impossible | Replace `skins/*.json` + referenced GLB/PNGs in `apps/web/assets/packs/<p>/`; set `defaultSkins`; `team.mode` chosen per skin (tint or textureSwap); budget class per skin; per-player skin through `MatchSetup`. No sim/content/code change; `simHash` unchanged by construction |

---

## 4. Phased port roadmap (PROPOSAL)

Sub-projects sized for our pipeline (dev-design PRD per SP, dev-tasks TASKS.md, dev-code with one commit per task, dev-review per SP; `AGENTS.md`). Each SP lists scope, dependencies, rules impact, acceptance criteria and risks. Task counts are rough (agent tasks of about one commit each).

Dependency sketch:

```
SP-A registry/profiles/packs ──┬─> SP-B sim parity core ──┬─> SP-E1 obstacles+crossings ─> E2 walls/mines/resources ─> E3 shooters ─> E4 rivers/sheep/gates ─> E5 trolley/rail/boss
                               │                           ├─> SP-F1/F2 AI (tw kind, scripts)
                               ├─> SP-C importer+campaign ─┘   (levels gated by `requires`)
                               ├─> SP-D art pipeline (parallel; soft dep on A for open visual kinds)
                               └─> SP-G1 HUD/boosters ─> G2 MatchSetup+meta core ─> G3 progression/modes
SP-H scale hardening runs after C and each E slice.
```

### SP-A: Module registry, rules profiles, packs (no behaviour change)
- **Scope:** `packages/defs` with module/command/event/objective/bot-kind/consideration definitions; migrate the four components (`garrison`, `generates`, `drawsLines`, `capturable`), `DrawLine`/`CutLine`, the nine event types, v1 phases, elimination objective, `utility`/`idle` bots to definitions; compile-time exhaustive behaviour map and generated barrel (`pnpm modules:index`); delete runtime `assertParity` and the content `COMPONENT_REGISTRY` literal; phase partial order; per-module versions in replay header; rules profile object with `na-v1`; level v2 envelope (`buildings[]` with per-instance `params`, `rules`, `view`, inline `bot`, `elements[]` still rejected until E1); archetype `extends` may add components; packs (`na-core`) and `campaigns/*.json` replacing `order`/`band` and the 20-level pins; open manifest `visuals.kind`/`fx` registry; per-pack lock/version gates; docs (`CONTENT_GUIDE`, rules text for profiles and module versions).
- **Dependencies:** none.
- **Rules impact:** RULES_VERSION minor (1.1.0): adds the module/profile surface and header fields; no outcome change for any existing content. Rule text: profile concept, module versioning, R-WIN-02 wording only if touched.
- **Acceptance:** all existing gates green; `sim:golden`, `bots:golden`, `replay:verify golden` produce identical final state hashes (replay header gains fields; old replays still load via a documented compat shim); removing a sim behaviour file fails `pnpm typecheck`; "add a component" in `docs/CONTENT_GUIDE.md` lists def + behaviour only; v1 levels auto-migrated with identical `simHash` (hash input canonicalisation unchanged for v1 content); web boots with pack `na-core`; `pnpm check:schemas` and `check:manifest` green.
- **Risks:** hash/lock churn (mitigate with a hash-compat canonicaliser and a one-time `contentVersion` bump if unavoidable); wide diff across four packages (split: defs+sim, content, bots, web); `SCHEMA_VERSION` bump touches every data file; Vite glob and Node barrel must agree.
- **Size:** L, 8-10 tasks.

### SP-B: Sim parity core (Tower War rules as modules, profile `tw-1.29`)
- **Scope:** unit components `hp`/`attack`/`defense`/`mover` and lifting the `troopValue` cap; `spawns` (per-line timer/period, K from line count, alive cap 30) and `grows` (stage period, stop with lines); per-troop speed column; `MatchSetup` `modifiers` plumbing with seeded streams (double unit, shield); `capturable` params (`threshold`, `overkill`, `killOutgoingOnCapture`, `forwardOverflow`); `drawsLines.slotLoss`; slot thresholds as content `[9,29]`; objective `captureAll` + `ignoreForWin`; optional time limit; `road` entity (straight path, two lanes, own-lane cut, hostile reverse); tank/soldier/artillery (non-ranged) as data; scenario levels reproducing 03 tables.
- **Dependencies:** SP-A.
- **Rules impact:** RULES_VERSION minor (1.2.0). New rule areas `SPN`, `GRW`, `PRF`, `OBJ`; clarifying patches for R-LIN-03/R-LIN-05 equivalence. All TW variants opt-in via profile (`na-v1` outcomes unchanged).
- **Acceptance:** scenario tests assert the TW spawn interval table (03#4.1: L=1 0.99/1.29/1.59 s, L=64 0.65/0.85/1.04 s for 1/2/3 lines, within one tick) and growth table (03#4.6); tank vs soldier, capture-needs-strictly-more, overshoot discarded, kill-outgoing-on-capture, overflow forward (seeded); captureAll win with a neutral and an ignored flag; replay determinism across 50 seeds and Node 22/24; `check:rules` covers every new R-id; `bench:sim` budgets hold with 30 alive units per house; na-v1 goldens unchanged.
- **Risks:** float-to-integer mapping of TW formulas (document rounding, test against the decomp-derived tables); ring changes (per-troop speed touches `state.ts` ring columns, `hash.ts` words, `read.ts:75` duplicate progress math); alive-cap and double-unit interplay with the lazy ring; unresolved items in section 6.
- **Size:** L, 10-12 tasks.

### SP-C: Level importer, campaign lists, pack loading
- **Scope:** `tools/import-tower-war` (reads `TW_EXTRACT`, deterministic, emits level v2, campaign lists, `_index.json`, `requires`); port the lossless `tw-level-ext` stage (`p2_levellib.py`/`p2_tw2na.py`) so the repo is reproducible without Python, or keep Python as a documented prerequisite (my recommendation: TS, so `pnpm` reproduces it given `TW_EXTRACT`); include the 14 prefab-only levels (12 campaign + 2 Draw; `converted/ext-prefab`, 02#2) as flagged hand-data; campaign list interpreter (skip/loop/env cycle); lazy pack loading in the web app; level picker filtered by registered capability; per-pack `content:lock`/`check:content`; tiered `validate:levels`.
- **Dependencies:** SP-A (v2, packs); SP-B for any level to be playable; starts in parallel with SP-B after A.
- **Rules impact:** none.
- **Acceptance:** all 2,195 assets import with zero loss into the archive form (`ext -> v2 -> ext` round trip; the 2,165 current-format files include 76 long-dialect ones, the 30 v0 legacy files are archive-only); `requires` histogram equals section 7.2; common campaign list resolves 1,024 entries; web lists all levels and plays those whose `requires` are met; boot loads index and list only (no eager 10 MB); `check:content` per pack within a time budget; na-core gates unaffected.
- **Risks:** licence and repo placement (D1); level id stability (author tags, duplicated numbers, 02#2); the converter's scale choice (use native units, G02); the 14 prefab-only levels carry scripted tutorials that are not data (02#11); importer correctness without a reference implementation (sample-replay checks).
- **Size:** M-L, 8 tasks.

### SP-D: Art import pipeline (parallel track)
- **Scope:** validate the prototype GLBs first (01#8.2 states they were never opened in a renderer): load 43 skins + 15 buildings in three.js, compare handedness/winding/UV against reference renders; productionise `tools/assets` (from `catalog/units_buildings.json`, `prefab_parts_*.json`, `glb_proto*`) to emit GLB + skin JSON + `visuals.json`; `team.mode: textureSwap` strategy (4 colours, gray for neutral buildings); building stage meshes by level; roof-count overlay for GLB buildings; rigid-part animation baking for instanced soldiers; per-visual budget classes; per-player skin selection in render buckets; credits and `licence` gates; rebuild VFX with sprites (particles are not extractable, 01#8.2).
- **Dependencies:** SP-A (open visual kinds, per-pack manifest) is soft; no sim dependency.
- **Rules impact:** none.
- **Acceptance:** all 58 models load and render with correct orientation and team colour (screenshot comparison per the AGENTS.md visual workflow); `pnpm check:manifest` passes with named budgets; instanced scene of 270 units at 60 fps on the reference GPU (the existing Perf-open item, 06a#7 item 2, is tracked, not assumed); changing a skin changes no `simHash`.
- **Risks:** prototype correctness; rigid-part animation under instancing; triangle budget growth (1.0-2.3k triangles per unit vs 300 today); garage models skipped (skinned, 01#8.2); texture colour-space and mip/size budgets; licensing.
- **Size:** L, 8-10 tasks.

### SP-E: Map elements and shooters (five slices, ordered by the introduction curve, 02#5)

| Slice | Scope | Deps | Rules | Acceptance | Risks | Size |
|---|---|---|---|---|---|---|
| E1 | Lane-crossing facility; `shape`, `blocksLines`, corridor test, `blocked` reject; obstacle render (themed meshes); web input hit-test; `canDraw` exposure for bots; TW-profile `elements[]` validation | A, B | minor (R-LIN-04 amended, new `ELM` rules) | lines crossing an obstacle rejected; end buildings exempt; importer obstacles placed for 891 levels; no regression in na-v1 | corridor half width (0.19) mapping to our units; obstacle collider shapes are decor-derived (OBS child positions only, no collider size, 02#3.6) | M, 5 tasks |
| E2 | `hp`, `onCross` (wall, mine), resource pile + carry/return (reverse re-anchor, sorted insert), cargo as reward hook, talent modifiers (`wallDamage`, `mineBlock`, `goldCarry`) | E1 | minor | wall absorbs hp points then vanishes (03#8.2); mine kills one soldier then is destroyed (03#8.3); gold carry adds `defense` on return (03#6); unit tests per element | reverse-lane insert order; draw-order of crossings in one tick | M-L, 7 tasks |
| E3 | Projectile/scheduled-effect core; kill-from-middle (`kill(seq)`); E3a `shoots` tower + fortress turrets; E3b artillery soldier (`ranged`); E3c rocket tower (`Aim` command, area damage, disabled timer) and capture rocket tower; E3d selectable fortress (spawns + turrets + parachutes) | E1, E2 | minor | tower delay/radius tables (03#5.5), rocket volley delay (03#5.7), stage damage 3/4/5; kills deterministic; bots see shooters via declarative extractors | unit-vs-building contact radius not traced and capture RT charge accounting not decoded (03#14), rest of the radii are now extracted (03#5.7-5.9); ring structure change; artillery volley rule (fires at every target in range) read from control flow only (03#5.9) | L, 14 tasks |
| E4 | `bridgeable` rivers with planks, `penned` sheep, gates (modify op), `flag` objective rule, polyline path provider for Draw levels | E2, E3 (partly) | minor | river rules per 03#8.4; gate arithmetic per 03#8.5; flag last-building flip per 03#7.2 | sheep and bridge timing details partly unverified; Draw family is outside the campaign list | L, 8 tasks |
| E5 | `rides` railway and `explodesOnContact` trolley, boss tower routine | E3 | minor | trolley removes target building (03#8.7); railway move durations (03#8.8) | railway and boss details only partly decoded (03#8.8-8.9) | L, 8 tasks |

### SP-F: AI port
- **Scope:** F1 `consideration` and bot-kind registries, inline per-level `bot`, kind `tw` (spec 04#12.3, including seat-stream random source, weakest-first with `/1.5` special discount, nearest-own fallback, no cuts); F2 shared script interpreter (`delay`, `line`, `steps`, capture poll, skip-if-lost, fallback source, 04#6.2); F3 `seatPower` percent and difficulty controller in `packages/meta`; F4 rocket aiming and railway moves after E3/E5.
- **Dependencies:** F1 after A and B; F2 after C (scripts live in imported levels) and B; F3 after SP-G2; F4 after E3/E5.
- **Rules impact:** none for bots; `BOT_VERSION` bump and `bots:golden --update`; F3 uses modifiers (minor).
- **Acceptance:** deterministic replay of a `tw` bot match; unit tests for each script op against 04#6.2 semantics; sample levels play through scripted openings; win-rate sanity by campaign position (TW AD values 2-15 s, 04#6.3); no change to utility bot goldens.
- **Risks:** no ground truth (cannot run TW); reaction handler ambiguity (04#4: treated inert); unstable-sort tie order replaced by a total order (documented deviation); script semantics around capture polling at 20 Hz.
- **Size:** M-L, 8 tasks.

### SP-G: HUD, boosters, meta
- **G1:** HUD skeleton (ownership progress bar for up to 4 colours, bomb button, speed button, emotes optional, restart popup), input thresholds (long press 0.7 s eraser, 0.2 s drag delay, 1 percent of screen diagonal; 05#6.3), bomb and speed boosters through `UseBooster` (needs E2/E3 only for bomb visuals), victory/defeat flow. **Deps:** B. **Rules:** minor (booster commands). Size M, 6 tasks.
- **G2:** `MatchSetup` and `setupHash`, modifiers plumbing end to end, `packages/meta` core (wallet, reward/price schemas, unit price curve, token/evolve gates, combat power, deterministic summon queue, unlock gates), save migration. **Deps:** B, G1. **Rules:** patch/minor (R-WIN-02 wording, header field). Size L, 9 tasks.
- **G3:** garage, research center, artefacts (24 items), quests, mode shells (Secret Mission/Draw, Challenge Tower with power gate, Arena/PvP with an offline 33-slot bot leaderboard), campaign result extras (spin wheel). Skip monetisation (ads, IAP, battle pass, VIP) and clans. **Deps:** G2 (+E4 for Draw, E5 for others). **Rules:** none. Size XL, 15+ tasks, to be split by mode.
- **Acceptance (G):** HUD/gesture e2e tests via Playwright; replays reproduce with meta disabled; price curve unit tests match the values listed in 05#3.2; summon queue reproduces the first 16 pulls of 05#3.6.
- **Risks:** meta numbers partly absent from the APK (research table, per-win gold, 05#3.5, 05#4.2) and must be authored; live-config overrides unknown (05#1).

### SP-H: Scale hardening
- Run after C and after each E slice: tiered `validate:levels` (reference-bot wins by feature tier instead of by `band`), sampled balance matrix, perf budgets with 30 alive units per house, determinism audit on Node 22/24, memory of 2,165-level pack, importer and lock regeneration time, docs and AGENTS.md updates. Size M, recurring.

### Milestones and level coverage (my count, section 7.2)

| Milestone | Delivered | Campaign levels fully supported (of 1,012 listed) |
|---|---|---|
| M0 | SP-A | 0 new (na-core only) |
| M1 | + SP-B + SP-C + SP-D, E1 | 38 (3.8 percent) with obstacles/cargo/scripted AI as decor (faithful once E1/F land) |
| M2 | + E2 | 138 (13.6 percent) |
| M3 | + E3a (tower) | 312 (30.8 percent); + E3b artillery 386 (38.1 percent); + E4 rivers 446 (44.1 percent) |
| M4 | + E3c (rocket, capture rocket) | 731 (72.2 percent) |
| M5 | + E3d (selectable fortress) | 899 (88.8 percent) |
| M6 | + E5 (trolley, railway) | 1,012 (100 percent) |

Recommended first target: M2 (about 14 percent faithful, tutorials and the early introduction curve) while SP-D lands the TW look; then M3/M4 because towers and rocket towers unlock most of the remaining levels. Sheep, gates, flags appear in no campaign-list level (02#5), so E4 is only needed for rivers there and for Draw/other families.

---

## 5. Open decisions for the owner

1. **D1 Where does imported Tower War content live?** Commit levels/art/skins in this repo, keep them in a private pack (separate repo or submodule), or generate locally from `_extract`. The pack design supports all three; credits and `licence` gates apply (approved for personal learning use).
2. **D2 Fidelity target and scale.** "Exactly like them" for feel numbers (speed 5 u/s, intervals, TW native units, scale 1) versus a gameplay-equivalent retune. Native units force a rescale of web camera, troop size and lane constants.
3. **D3 One ruleset or two.** Opt-in profiles (`na-v1` + `tw-1.29`, all minor bumps, existing replays valid) versus TW rules replacing v1 defaults (major bump, re-balance the 20 NA levels).
4. **D4 Fate of the NA-native game.** Keep `na-core` as a parallel pack, or retire it after M3.
5. **D5 Unit HP model.** Flat 1/2/1 (HP = attack) first, or power-derived HP (needs the meta layer; TW uses power-based HP in real progression, 03#2.4).
6. **D6 Tick rate.** Stay at 20 Hz (recommended) or move to 30/60 Hz for finer contact resolution; changing it is a major bump (R-TCK-01).
7. **D7 Meta scope.** Which of garage, research center, artefacts, summon, quests, Challenge Tower, Arena/PvP (offline bot leaderboards), Boss, festivals; confirm skipping ads, IAP, battle passes, VIP, clans and Clan Wars (05#10).
8. **D8 Building stage thresholds.** TW's art-stage thresholds are not serialized; default to 10/30 (matching slots)?
9. **D9 AI fidelity.** Reproduce TW's simple AI exactly (never cuts, weakest-first, random source, inert reaction handler) versus keeping the NA utility bots for difficulty; if the reaction handler is wanted, implement the intended inverted guard (04#4).
10. **D10 Layout and camera.** Adopt TW's portrait 1080x1920 canvas and FOV 21 / 55 degree camera, or keep our landscape diorama camera.
11. **D11 Scope of level families.** Common campaign only first, or also Daily/Draw, PvP, Arena, Challenge Tower, Boss, Festival (each needs mode shells and, for Draw and Boss, extra mechanics).
12. **D12 Surplus lines when a building level drops.** Confirm TW keeps them (needs one more decompilation check, section 6) and choose `slotLoss: keep` for the TW profile, or keep our auto-cut.
13. **D13 Tutorials.** 12 campaign levels are hand-built prefabs with scripted tutorials (02#2); implement as a data-driven step table (05#8) or skip.

---

## 6. Unverified items to settle (research follow-ups before the related SP)

1. Surplus lines on level drop (F3): `House.OnHouseLevelChanged` and `SetAvailableWays` do not cut lines; confirm no other caller (`DestroyAllWays`, way listeners) does so. Blocks `slotLoss` default in SP-B.
2. Capture subclass behaviour (`Tower`, `Fortess`, `SelectableFortess` `SetNewOwner`) and whether `DestroyAllWays` also removes incoming lines (03#14). Blocks the `capturable` profile values.
3. Radii are mostly closed (soldier body r 0.35, tower trigger 2.4 x stage scale = 3.84/6.0/8.16, rocket blast 1.15, artillery blast 1.0, capture rocket 3.0; 03#5.5-5.9, 03#14). Still open: which collider a soldier's trigger tests on a building (`Hit` 0.6, `Building` 1.5, `Selecable` 2.5) and nested-collider parent scales. Needed by crossing contact (G11) and E3.
4. Art-stage thresholds for buildings (01#3.3, D8) and tower/fortress gun gating by level.
5. Way curvature is CLOSED: straight 2-point path in normal levels, drawn polyline in Draw levels (03#3.3). Still unread: draw-mode release/validation edge cases and `CheckBlock` edge cases (03#14).
6. Prototype GLB correctness (01#8.2): no renderer validation yet; first task of SP-D.
7. `coefficientByRocketTowerAttack` is the AI rocket-tower target weight only, and the five upgrade types TowerSpeed/TowerRadius/RocketTowerSpeed/RocketTowerRadius/BuildingsSpawnSpeed have no gameplay consumer (power-only), per 03#5.7 and 03#9; both closed with a reflection caveat. Discrepancy to resolve: bomb `defaultBombBoosterAimsCount` is 1 in 03#8.9 and 3 in 05#4.6.
8. Capture rocket charging accounting (lives in the undecompiled UI view), boss damage-from-power table and `bossDurability` semantics, rage trigger-box sizes (03#14, 04#13). Trolley explosion strength and railway movement are now decoded (03#8.7-8.8).
9. Live remote-config values differ from APK defaults (05#1, 04#8); all numbers here are 1.29.3 defaults.
10. `03-core-mechanics.md` was updated by a second agent while I wrote this (commit `03e0ab7`, gap-closing pass); I re-read the diff and updated the affected rows. Section numbers cited here are valid at that commit; re-check if 03 changes again.

---

## 7. Appendix

### 7.1 Code facts verified in this worktree (HEAD `03e0ab7`)

- Component registry duplicated, parity asserted at runtime: content `COMPONENT_REGISTRY` (`packages/content/src/component-registry.ts:22-30`), sim `createComponentRegistry` (`packages/sim/src/registry.ts:74-87`), `assertParity` (`registry.ts:64`). `registerPhase` and `SimComponent` hooks exist (`registry.ts:10-27,36`).
- Phases and loop: `PHASES` (`registry.ts:8`); `step` special-cases `clash` and `arrivals` inline (`packages/sim/src/commands.ts:45-93`, loop near the end of `step`).
- Command, reject, outcome, event unions are closed (`commands.ts:4-19`). Only `DrawLine`/`CutLine` exist.
- Win rule is elimination plus transit, with timeout precedence (`packages/sim/src/tick.ts:6-35`).
- Capture and arrival arithmetic: `garrisonArrive` (`packages/sim/src/combat.ts:65-88`), `capturableHit` (`combat.ts:90-110`); slots (`packages/sim/src/economy.ts:5-27`); generation and departures (`economy.ts:35-75`).
- Sim already has a seeded PRNG in state (`packages/sim/src/state.ts:210`, `new Sfc32(seed)`); v1 mechanics do not consume it (R-TCK-03).
- Troops: per-troop `value` with partial consumption (`state.ts:11-81`), speed per kind (`combat.ts:9-11`, duplicated at `packages/sim/src/read.ts:75`); troop value pinned to 1 by the content validator only (`component-registry.ts:29,74-77`).
- Schema: component params are an open flat bag with a few typed names (`packages/content/src/core.schema.ts:18-30`); level schema has `order`, `band`, `obstacles`, `mapObjects`, `overrides` (`core.schema.ts:44-68`); the validator rejects any element (`validate-content.ts:144`), requires 1 human + 1-3 bots (`:105`), caps campaign order at 20 (`:154`).
- Hash: `hashCompiledLevel` covers players, towers with resolved components, kinds; excludes presentation and bots (`packages/content/src/hash.ts:58-69`); `contentVersion` must rise when level hashes move (`packages/content/src/versioning.ts:34-41`).
- Bots: closed `BOT_CONSIDERATIONS`/`BOT_ACTIONS` (`packages/content/src/bot-params.ts:5-9`), `kind` utility|idle (`bot.schema.ts:8`), `componentValue` keys derived from the content registry (`bot-params.ts:56`).
- Web: manifest `visuals.kind` tower|troop and `build: stacked` (`packages/content/src/manifest.schema.ts:34-37`), `BUILTIN_FX` closed (`apps/web/src/manifest/resolve.ts:16`), eager glob of all content (`apps/web/src/app/boot.ts:6-12`), `MAX_FLOORS` (`apps/web/src/render/tower-mesh.ts:8`), stacked-tower branch in `apps/web/src/render/towers.ts:56-61`.
- Slot rule: `1 + count(thresholds < garrison)` (`economy.ts:5-12`), hence `[9,29]` reproduces TW's `>=10`, `>=30`.

### 7.2 Level coverage by feature (my count; method)

Method: for the 1,012 campaign ids that have a level JSON (`/root/projects/tower-war/_extract/converted/campaign_order.tsv`, `hasJson=1`, 02#4.1), I read the raw level TextAssets (`assets/defaultlocalgroup_assets/TextAsset/`) and recorded, per level, the building kinds (`bt`: house, tower, rocket tower, selectable fortress, capture rocket tower, trolley, flag), tank (`WT=2`) and artillery (`WT=3`) houses, ownerless resource piles (`WOD`), and non-empty lists (`OBS`, `ROBS`, `Mine`, `Wall`, `Sheep`, `River`, `Cargo`, `Gate`, `Railway`), plus scripted AI (any `AiSC/AiCWS/AiDS/AiRM`) and AI rail moves. Script (scratch, not committed): `/tmp/claude-0/-root-projects-node-arena/5ceb4fc4-c666-4f8a-93c9-cb3b5463740b/scratchpad/cov/cov3.py`. Counts agree with 02#10 (e.g. 891 levels with obstacles, 385 with towers, 274 with rocket towers).

Levels containing each feature (of 1,012): house 1,012; obstacle 891; tank house 636; scripted AI 621; cargo 600; resource pile 412; wall 397; tower 385; artillery house 312; mine 291; rocket tower 274; river 208; selectable fortress 176; capture rocket tower 125; river obstacle 103; trolley 66; railway 61; AI rail move 20; sheep, gate, flag 0.

Cumulative fully supported levels when obstacles, cargo and scripted AI are treated as decor and default AI at first (so these counts do not depend on E1/F, only their fidelity does):

| Features supported (cumulative) | Levels | Percent |
|---|---|---|
| Houses, tank houses, decor-level obstacles/cargo/script | 38 | 3.8 |
| + walls, mines | 60 | 5.9 |
| + resource piles | 138 | 13.6 |
| + tower | 312 | 30.8 |
| + artillery houses | 386 | 38.1 |
| + river | 446 | 44.1 |
| + rocket tower, capture rocket tower | 731 | 72.2 |
| + selectable fortress | 899 | 88.8 |
| + sheep, gate, flag (no campaign level uses them) | 899 | 88.8 |
| + trolley, railway, AI rail moves | 1,012 | 100.0 |

Caveat: the order of the middle rows is a choice; adding a feature that appears in many levels but also co-occurs with others only moves the count when all co-occurring features are present.

### 7.3 Sizing assumptions

Sizes assume Sonnet-class coding agents with the existing gate chain (`pnpm run ci`). L = 8-12 tasks and a PRD with architecture; M = 5-7 tasks. SP-A and SP-B are on the critical path; SP-D and SP-C parallelise after SP-A (max two concurrent agents per the orchestration rules in `AGENTS.md`/`CLAUDE.md`).
