# 03 - Tower War core mechanics teardown (P3)

Game: Tower War - Tactical Conquest 1.29.3 (Vaveda, Unity 6000.0.82f1 IL2CPP). Direction: how the base game works mechanically (ways/lines, troop flow, combat, buildings, special elements, win/lose, sim model). Written 2026-10-21.

## 0. Conventions, sources, confidence

Path prefixes (all under `/root/projects/tower-war/_extract/`, local only, never copied here):

| Short | Full |
|---|---|
| `dump` | `il2cpp/dump.cs` (class/field/method dump; `dump:Lnnn`) |
| `decomp/<Class>/<Method>.c` | `decomp/` Ghidra output (arm64 libil2cpp.so, one file per method; see `decomp/README.md`) |
| `scenes/<Class>/*.json` | `assets/defaultlocalgroup_scenes/MonoBehaviour/<Class>/` (ScriptableObject settings) |
| `prefabMB/<Class>/*.json` | `assets/defaultlocalgroup_assets/MonoBehaviour/<Class>/` (prefab component values) |
| `lvl/<file>` | `assets/defaultlocalgroup_assets/TextAsset/` level JSON |
| `strlit[i]` | `il2cpp/stringliteral.json` entry i (embedded default remote-config JSON) |
| `meta@0x..` | `base/assets/bin/Data/Managed/Metadata/global-metadata.dat` byte offset (static array initialisers) |

Evidence labels: "(decomp)" = read from decompiled code, "(data)" = read from config/prefab/level JSON, "(dump)" = field/method names from dump.cs only. "(inferred from names)" is used where I did not read code. "Not found" means I looked and could not locate it. Gap-closing pass (2026-10-21, second agent) additionally read prefab collider/component values straight from the Unity bundles with UnityPy (`base/assets/aa/Android/defaultlocalgroup_{scenes,assets}_all_*.bundle`; labelled "(prefab)"), because the exported JSON omits Collider objects.

Tools I added (in `/root/projects/tower-war/_tools`, reusable): `p3_calls.py` (per-method callee/constant summary), `p3_view.py` (clean decomp with field names), `p3_fm.py` (field offsets), `p3_f32.py` (read `_UNK_` float literals), `p3_level_stats.py` (level corpus statistics). Documented in `decomp/README.md`.

Floats in decomp that appear as `_UNK_0131xxxx` were resolved by reading libil2cpp.so .rodata (Ghidra addr - 0x100000 = file VA): growth coefficient 0.9 (`_UNK_01314654`), speed percent factor 0.01 (`_UNK_0131473c`), lateral offset range [-0.2, 0.2] (`_UNK_013146f8/_01314720`), mine kill delay 0.1 s (`_UNK_0135c758`), double-unit spawn delay 0.15 s (`_UNK_0135cd78`), warrior group column pitch 0.4/0.6 (`_UNK_01314804`, `_UNK_013146e0`).

## 1. Executive summary of the rules (what a web sim needs)

1. Map = 2D top-down plane (x,z; levels use roughly |x|<=11, z in [-9,9]), 2-18 buildings per level (avg 9.06; `lvl` corpus, `_tools/p3_level_stats.py`).
2. Buildings hold an integer "level" (= garrison / HP, cap `maxLevel`, usually 64). There is no separate troop pool: troops are spawned for free and level is only changed by growth, arriving own troops (+Defense each), arriving enemy troops (-Damage each), tower bullets and rockets.
3. The player draws a line (a "way") from an owned building to any other building. Each owned house/tower-like "selectable" building may have 1/2/3 outgoing lines depending on its level (<10 / 10-29 / >=30). Lines are free, can be any length, cannot pass through obstacles or other buildings, and are re-drawn/erased by swiping.
4. A house emits one soldier every `T = K*60/(ws*level+60)` seconds per line (K grows 0.3 per extra line; `ws`=0.5 default). Soldiers walk the line at 5 units/s (cap 7.5), at most 30 alive per house.
5. A house with zero lines regenerates +1 level every `(0.9/sqrt(floor(level/10)+1)+1) * 1.7` s (2.0 s base for Attack/Artillery houses) up to `maxLevel`; with >=1 line it does not regenerate.
6. Soldier vs soldier: both deal their own damage-vs-warrior to the other simultaneously (for power-based units this equals current HP, so the bigger HP survives with the difference; for flat 1/2/1 units it is the attack value). Soldier vs building: enemy level -= soldier attack (1 default/artillery, 2 tank); capture happens when damage exceeds level (level-damage < 0): owner flips and level becomes 0. Soldier arriving at an own building: level += Defense (1 + carried gold), capped; overflow soldiers are forwarded.
7. Win = every non-"ignored" building is owned by the human player. Lose = player owns no non-ignored building.
8. Towers shoot soldiers (instakill) and enemy houses (1 damage); fortresses shoot soldiers; rocket towers fire area-damage rockets along a drawn line; walls/mines/rivers/sheep/gates/cargo/resources/trolley/railway are map modifiers described in section 8.
9. Simulation is real-time Unity (`Time.deltaTime`, `UniRx.EveryUpdate`, physics trigger callbacks, `UnityEngine.Random`) - NOT lockstep and NOT deterministic. The "Lockstep" assemblies (30 ms step) are only used by Clan Wars (section 11).

## 2. Entities, enums and base data

### 2.1 Enums (dump)

| Enum | Values | Source |
|---|---|---|
| BuildingsType | House=0, Tower=1, Resource=2, RocketTower=3, Fortess=4, Flag=5, SpeedTower=6, SelectableFortess=7, CaptureRocketTower=8, BossTower=9, Trolley=10 | dump:L166431 |
| WarriorType | Default=1, Attack=2, Artillery=3 | dump:L155583 |
| PlayerType | Player=0, AI=1, Neutral=2, Boss=3 | dump:L155307 |
| PlayersColors | Blue=0, Green=1, Red=2, Yellow=3, Gray=4 | dump:L155318 |
| DamageableType | SelectableHouse=0, Tower=1, Resource=2, Fortess=3, Mine=6, Wall=7, Bridge=8, Sheep=9, Trolley=10, Warrior=98, OtherBuildings=99 | dump:L160628 |
| DamageableLocationType | Ground=0, Air=1 | dump:L160619 |
| ProjectileSpawnType | Tower=0, Warrior=1, RocketTower=2 | dump:L133616 |
| ResourceType | None=0, Gold=1, Wood=2, Coins=3, Dynamite=4 | dump:L155414 |
| WayType | Standard=0, Trolley=1 | dump:L120581 |
| LevelState | Loaded=0, Started=1, Win=2, Lose=3, Paused=4, StageWin=5, PrepareToNewStage=6 | dump:L155267 |
| LoadLevelType | Common=0, Daily=1, PvP=2, ChallengeTower=3, Arena=4, Boss=5, Festival=6, Test=100 | dump:L155281 |
| GateBehaviorType | Plus=0, Minus=1, Multiply=2, Divide=3 | dump:L155246 |
| RiverTypes | 18 shapes (Circle/Corner/Curved1/Curved2/HalfCircle/Line x Big/Medium/Small) 0..17 | dump:L155452 |
| UpgradeType | None, Gold=1, MovementSpeed=2, Resurrection=3, DoubleUnit=4, DestroyWallTalent=5, MineBlockTalent=6, AddResourceTalent=7, BridgeSpeedTalent=8, TowerSpeed=9, TowerRadius=10, RocketTowerSpeed=11, RocketTowerRadius=12, BuildingsSpawnSpeed=13, ArmagedonAimCount=14, SpeedBoostFactor=15, RageChance=16 | dump:L161099 |
| TalentsType | DestroyWall=1, MineBlock=2, AddResource=3, BridgeSpeed=4, TowerShootBlock=5, StrongerAgainstRed=6, ...Yellow=7, ...Green=8, Gold=9, MovementSpeed=10, Resurrection=11, DoubleUnit=12, BonusHealth=13 | dump:L155550 |
| RageSkillsType | None, RageDash=1, RageFlamethrower=2, BurningEarth=3, Forsage=4, Hail=5, Annihilation=6, LaserCannon=7 | dump:L155512 |

### 2.2 Class model (dump)

`Building : MonoBehaviour, IDamageable` (dump:L166052) holds `houseLevel` (ReactiveProperty<int>, 0x70), `addedWays` (ReactiveCollection<WayBaseController>, 0x78), `Owner` (ReactiveProperty<PlayerController>, 0x98), `canBeIgnoredToWin` (0x64), `coefficientByRocketTowerAttack` (0x68). `SelectableBuilding : Building` (dump:L169233) adds `availableWays`, `freeWaysCount`, `HouseWarriorSpawner`; subclasses `House`, `RocketTower`, `TrolleyBuilding`, `SelectableFortess`. Non-selectable: `Tower`, `Fortess`, `SpeedTower`, `Flag`, `Resource`, `CaptureRocketTower`, `BossTower`. (Selectable = can be a line start.)

### 2.3 Warrior base parameters (data)

`scenes/Game.Main.Settings.Warriors.WarriorParamsConfig/{Default,Attack,Artillery}WarriorData_*.json`:

| Type | warriorType | attack | defense | hitPoints | speed | countSpawned | speedUpCoefficient | maxSpeed |
|---|---|---|---|---|---|---|---|---|
| Default (soldier) | 1 | 1 | 1 | 1 | 5 | 1 | 1.3 | 7.5 |
| Attack (tank) | 2 | 2 | 1 | 2 | 5 | 1 | 1.3 | 7.5 |
| Artillery | 3 | 1 | 1 | 1 | 5 | 1 | 1.3 | 7.5 |

Field offsets (dump:L125669): attack 0x1C, defense 0x20, hitPoints 0x24, speed 0x28, countSpawned 0x2C, speedUpCoefficient 0x30, maxSpeed 0x34. Physics prefab values (`scenes/Game.Main.Warriors.WarriorPhysics/`): pushForce 125 (soldier/artillery), 150 (tank); delayToDeath 1300/1250 ms; bonusDelayToDeath 4000 ms (visual ragdoll timers).

### 2.4 In-match unit stats actually used (decomp)

`WarriorBase.SetStats` (decomp/Game.Main.Warriors.WarriorBase/SetStats.c; fields: `InGameWarriorSkinData._hpBasedOnPower` at +0x1C, dump:L125992):

- `_defence = cfg.defense`.
- If `skin._hpBasedOnPower >= 1`: `HitPoints = _hpBasedOnPower`, `_isDamageTheSameAsHp = true`, `DamageableData = new DamageableData(defaultAttack = cfg.attack, unique[Warrior(98)] = hp)`.
- Else: `HitPoints = cfg.hitPoints`, `DamageableData(defaultAttack = cfg.attack)` (no unique entry -> warrior-vs-warrior damage = default attack).
- After every hit `ResolveHpLogicAfterDoDamage` rewrites `unique[Warrior] = current HitPoints` for hp-based units (decomp/.../ResolveHpLogicAfterDoDamage.c: `ChangeUniqueAttackValue(0x62, HitPoints)`).
- Meta mapping power -> HP: see 2.5 (fully decoded). In short `HP = Power * WarriorParamsConfig.hitPoints` (soldier x1, tank x2, artillery x1), identical to the default `hp_config` JSON `{"hpParameters":[{"unitType":1,"hpCoefficient":1},{"unitType":2,"hpCoefficient":2},{"unitType":3,"hpCoefficient":1}]}` (strlit[19514]).
- Per-unit modifiers come from `InGameWarriorSkinData`: `_movementSpeedBonus` (percent), `_resurrectionChance` (percent chance to spawn with a 1-hit shield, see 5.4), `_doubleUnitChance` (percent chance of an extra unit after each spawn, see 4.3), `_goldBonus`, `_rageChance`, `_rageSkillType`, `_inGameArtefactsData`, `_inGameUpgradeArtefactBonuses` (dump:L125992). Example skin values: `scenes/Game.Main.Settings.Warriors.WarriorSkinData/*` (43 skins; e.g. skin 10 legendary: movementSpeedBonus 5, resurrectionChance 1.0, doubleUnitChance 1.0, goldBonus 10). Per-level rarity increments: `scenes/Game.Main.Settings.Warriors.RaritySkinsDataInfo/*` (Grey: speed +0.35, resurrection +0.15, double +0.15, gold +0.25 per level ... Relict: +1.0 / +0.4 / +0.4 / +0.8, rage +0.2).

Port notes: model a `UnitClass {attack, defense, baseHp, speed, maxSpeed}` table (3 rows) plus a per-player "unit stats" struct `{hpOverride?, speedBonusPct, shieldChancePct, doubleChancePct}`. If the web game keeps flat unit HP (1/2/1), vs-warrior damage = attack.

### 2.5 Meta power -> in-match HP/attack (decomp + data)

Pipeline (all `Game.Services.Combat.*`, decomp paths under `decomp/Game.Services.Combat.<Class>/`):

1. Per owned skin the game builds a `CombatMemberUnitData {id, rarity, type, hp(_hpBasedOnPower), level, displayLevel, displayPower, stats[]}` (`CombatService.CreateCombatMemberUnitData`, `CreatePlayerCombatMember`). `stats[]` holds five float stats (MovementSpeed, DoubleUnit, Resurrection, GoldBonus, RageChance) plus one int `PowerData`.
2. Base stats (`BaseStatsCombatModifier.CreateCombatDataFromStats`): for each stat, only if the skin's base value is > 0: `stat = skinBase + rarityStepPerLevel * (level - 1)` (skin base from `WarriorSkinData` movementSpeedBonus/doubleUnitChance/resurrectionChance/goldBonus/rageChance; per-level step from `RaritySkinsDataInfo`, section 2.4). Research upgrades, artefact main stats/talents, extra-stats and battle-banner modifiers then add deltas to the same stats (`UpgradesCombatModifier`, `ArtefactsCombatStatsModifier`, `ExtraStatsCombatModifier`; applied in order inside `ModifyPlayerCombatMemberUnitData`). `FinallyApplyAllUnitDataModifications` clamps every stat with `CombatModifiersExtensions.LimitStats` (caps from `statsParameter`, strlit[19550]: MovementSpeed/Resurrection/DoubleUnit 50 for both player and bot; RageChance 30 player, 200 bot).
3. Power is an int sum (`CombatModifiersExtensions.CalculatePowerForStats`, `CombatMemberUnitData.CalculatePower` = sum of all `PowerData`): for each stat, `power += (stat / valueToAddPower) * addPowerPerValue`, with `valueToAddPower = 0.1` everywhere and `addPowerPerValue`: Gold 1, MovementSpeed 5, Resurrection 10, DoubleUnit 10, RageChance 28 (`powerParameters` / `ragePowerParameter`, strlit[19539]). Extra flat power: each artefact talent adds `artefactsTalentPower` = 100, and upgrade types without a stat (TowerSpeed 5, TowerRadius 5, RocketTowerSpeed 5, RocketTowerRadius 5, BuildingsSpawnSpeed 10, SpeedBoostFactor 10, ArmagedonAimCount 75 per 0.1 / per 1.0 resp.) add power through `UpgradesCombatModifier.CalculateUpgradeTalentsPowerBonus` (a sum over a `Dictionary<UpgradeType,float>` of the same weights). These last upgrade types therefore only change HP through power; their in-match effect is nil (see section 9).
4. HP: `CombatService.CalculateUnitHpBasedOnPower`: returns 0 when the `hp_config.isEnabled` flag is false; else `HP = Power * WarriorParamsConfig(type).hitPoints` (1 soldier / 2 tank / 1 artillery); if no params config is found it falls back to the `hp_config` `hpCoefficient` of that unit type (same numbers; decompiler output for this fallback is garbled, so treat as same value). The int is stored in the unit data (`HpBasedOnPower`, vtable slot 0xB setter) and copied by `CombatManager.CreateInGameData` into `InGameWarriorSkinData._hpBasedOnPower` (dump:L125992), which `WarriorBase.SetStats` reads (2.4). HP is therefore NOT capped except by the stat caps above and the maximum power.
5. Attack: not power-scaled. `DamageableData.defaultAttack = WarriorParamsConfig.attack` (1 soldier, 2 tank, 1 artillery) is what hits buildings; damage vs soldiers (`UniqueAttack[Warrior(98)]`) = the unit's CURRENT HP (rewritten after every hit, 2.4/5.2). So the "tank x2" is only the HP multiplier (+ attack 2 vs buildings); there is no separate in-match tank HP multiplier.
6. Boss/bot units reuse the same path with a target power (`CreateBotUnitForTargetPower`, `UpdateBotUnitsToTargetPower`, `GenerateUnitsPowerInProportion`; boss: `CombatManager.UpdateBotUnitsToTargetPower` from `BossPlayerController.UpdatePower`). The remote-config tables for bot power targets are meta (P4).

Worked numbers (computed from the 43 skin JSONs with the formula above; base skin at level L, no upgrades/artefacts, before the x2 tank factor), power = HP of a soldier/artillery:

| Rarity (1 Grey .. 6 Relict) | L1 power (min-max over skins) | L10 power |
|---|---|---|
| 1 Grey | 50-60 | 185-207 |
| 2 Green | 70-140 | 295-356 |
| 3 Blue | 200-300 | 470-795 |
| 4 Purple | 160-380 | 799-1100 |
| 5 Legendary | 450-1010 | 1458-2018 |
| 6 Relict | 790-1230 | 2086-2904 |

A tank has twice these HP values. Example: legendary skin 10 at level 1 = speed 5 (250) + resurrection 1.0 (100) + double 1.0 (100) + gold 10 (100) = 550 HP/damage vs soldiers. A Grey level-1 soldier (50) loses to a legendary one and deals 50 to it before dying; 11 grey soldiers kill one 550 HP unit. Because building damage is flat 1/2/1, HP only decides soldier duels, tower-bullet survival (instakill regardless of HP unless a TowerShootBlock charge), and rage damage (coefficient x HP, 5.10).

## 3. Ways (lines)

### 3.1 Data model

- Class `WayBaseController : Way` (dump:L120200; prefab `scenes/Game.Main.Ways.WayBaseController/WayBaseStandard_5412.json` has `pathNormal` + `pathOpposite`). A way owns TWO lanes: `pathNormal` (House1 -> House2) and `pathOpposite` (House2 -> House1), each a `PathController` (points + `LineRenderer` + `PathPhysics` trigger boxes). Two spawn timers: `_spawnTimer1` (House1 lane), `_spawnTimer2` (House2 lane) (dump:L120211-120212).
- `House1 : SelectableBuilding` (start, always selectable), `House2 : Building` (end, any building).
- Per-lane config (data): `scenes/Game.Main.Ways.PathController/PathNormal_*.json`: `_distanceToCreateSegment = 1.5`, `_pointOffset = (0,0.1,0)`; `PathPhysics._defaultSize = (0.38, 1.0, 0.30)` (collider box per segment = lane width 0.38).
- Way variants via `GameData.wayPrefabVariants` (`scenes/Game.Main.Settings.GameData.GameData/GameData_5319.json`): 0=Standard, 1=Trolley; `wayRocketPrefab` for rocket towers (`WayRocket`: height 2.0, rocketMoveTime 1.0, `scenes/Game.Main.Ways.WayRocket/WayRocket_5417.json`).
- Layers (data): `scenes/Game.Main.Common.LayerMaskContainer/LayerMaskContainer_920.json`: select/ground/building/aiming/obstacle/gameItem/warrior/wayImpact/eraser/water/railway layers; `boxHalfSize (0.19,0.3,0.19)`.

### 3.2 Creation (human input)

Flow (decomp/Game.Main.Player.HumanPlayerController/{StartCreateWay,UpdateWayLine,UpdateWayOnGround,TryCreateLine}.c):

1. Pointer-down on an owned selectable building (`hitBuilding.Owner == this`): spawn a `WayBaseController` from `WayFactory.Create(startBuilding, color)`, `UpdatePath(start.WayPosition, start.WayPosition)`, `SetStartBuilding`. For `buildingType == 3` (RocketTower) a rocket aim path is started instead (`StartCreateWayPath`).
2. Each frame while dragging: raycast from camera (max distance 100, `RAY_CAST_MAX_DISTANCE`, dump:L136448) against building layer; if it hits a building other than the start, `SetEndBuilding(building)` + `UpdatePath(start.WayPosition, end.WayPosition)`; else the line follows the ground hit point (`UpdateWayOnGround`).
3. Pointer-up (`TryCreateLine`) -> `PlayerController.CreateWay(way, start, end)` (decomp/Game.Main.Player.PlayerController/CreateWay.c): succeeds only if the way is not blocked (`IsBlocked == false`), way object still exists (`_isExist`), end building `IsExist`; then virtual `way.Create(start, end)`; otherwise the way is despawned.
4. Input config (data): `scenes/Game.Main.Player.HumanPlayerInputConfig/*`: `_longClickTime 0.7` (long press starts the eraser), `_delayBeforeDragChecking 0.2`, `_dragDeltaPercent 0.01`.

Constraints found:

| Constraint | Evidence |
|---|---|
| Max outgoing lines per building = `availableWays` = 1 if level<10; 2 if 10<=level<30; 3 if level>=30 (same for House, Tower, RocketTower; Fortress and Trolley use their own `SetAvailableWays`) | decomp/Game.Main.Buildings.House/SetAvailableWays.c: `iVar4=2; if(level>0x1d) iVar4=3; if(level<10) iVar4=1`; also RocketTower/SetAvailableWays.c, Tower/SetAvailableWays.c |
| `freeWaysCount = availableWays - addedWays.Count` (UI), recalculated on level/way-count change | decomp/.../House/CalculateFreeWays.c |
| No distance/length limit on a line | not found in Create/UpdateWayLine/CreateWay (only raycast range 100 for aiming) |
| Line cost | none: no currency/level cost found in CreateNormal/CreateWay (spawning is free, see 4.4) |
| Line is blocked if an obstacle collider (obstacle layer) overlaps the lane, or a building collider (building layer) that is neither House1 nor House2 overlaps | decomp/Game.Main.Ways.WayBaseController/{OnTriggerEnter,OnTriggerExit,CheckBlock}.c (`_obstaclesInWay`, `_buildingsInWay` -> `set_IsBlocked(true)`; line colour changes) |
| Rivers do NOT block; they put the way into "river state" (warriors carry wood planks, bridge ceils appear) | `SetWayStateToRiver(objToHand, ...)`, `_riversCount` (dump:L120362, L120214); see 8.4 |
| Ways ending on a Resource building are registered on the resource too (`endBuilding.AddWay`) | decomp/.../WayBaseController/CreateNormal.c (`if end.buildingType == 2 -> end.AddWay`) |
| Ways to enemy/neutral buildings are "attack ways": `IsAttackWay` = House2 not Resource(type 2) and owners differ; fire `OnHouseUnderAttack` on target | decomp/.../get_IsAttackWay.c, CreateNormal.c |

`WayBaseController.Create(start,end)` branching (decomp/.../Create.c, CreateInverse.c):

- `ChangedConstants.isDrawWay` (draw levels, +0x58): always `CreateNormal` (free-form path).
- else if `end.HasWayWith(start)` (end already has a line to start): `CreateInverse`: if `start.Owner == end.Owner` -> `CreateReverse` (the existing line between two own buildings is reversed to run start->end: remove from old owner list, add to new); else (different owners) -> `CreateOpposite(start)`: the SAME physical way gets a second lane (`pathOpposite`) and a second spawn timer: both buildings send troops along the same road in opposite directions and collide head-on.
- else if `start.HasWayWith(end)` (re-drawing an existing line): virtual call on the new way (slot 0x188, the Despawn/cancel path) - i.e. no duplicate line (`HasStraightWay` helper exists, dump:L166308).
- else `CreateNormal`: `start.AddWay(way)`, start the lane-1 spawn timer (`UniRx.Observable.EveryGameObjectUpdate`), enable `pathNormal`, set colour = owner colour.

### 3.3 Path geometry (decomp + prefab)

`WayBaseController.UpdatePath(start, end, isSelected)` (decomp/Game.Main.Ways.WayBaseController/UpdatePath.c) drives `PathController` (decomp/Game.Main.Ways.PathController/{SetPoints,SetPoint}.c) which wraps the "PathCreator" Bezier package (`PathCreator`, `BezierPath`, `BezierUtility`). Rule:

- Normal (non-draw) levels (`ChangedConstants.isDrawWay` false): the way is a straight 2-point path, start = building A `WayPosition`, end = building B `WayPosition` (each point shifted by the controller's `_pointOffset`/y-offset). `SetPoints` pushes the 2 points into `BezierPath.UpdatePoints`; with only two anchors the auto-set control points give a straight segment, so there is no curvature rule in normal play (sections 3.1-3.2 already treat lines as straight).
- Draw levels (126 "Draw" levels, 3.2): while the finger moves, `SetPoint(point, isMove)` either moves the last anchor (`BezierPath.MovePoint(numPoints-1)`) or, when the last segment's length has reached `_distanceToCreateSegment` (prefab value 1.5 on all 4 PathController prefabs; the field is called `_sqrDistanceToCreateSegment` in code but is compared against the segment's `Length`, not its square), appends a new anchor (`AddSegmentToEnd`). The package's auto-control-point mode (`AutoSetAnchorControlPoints`) smooths the polyline into a Bezier; soldiers sample the resulting path (`GetPositionOnLine`/`GetPoint`, `Points`). For a sim, store the raw drawn polyline (anchors every >=1.5 units, last one free) and treat curvature as cosmetic smoothing.
- Other cases (`isSelected`/closed-path flag +0x18 branch of `SetPoint`) only rewrite the end handles.

### 3.4 Cutting / removal / crossing

- Erase tool: long-press (0.7 s) starts `WayEraser` (a moving trigger collider on the eraser layer, `speed` field, dump:L119363); `WayEraser.OnTriggerEnter` finds the `WayBaseController` under the collider and, if `way.CheckWayPlayers(owner)` is true, calls `DestroyWayByPlayer(owner)` (decomp/Game.Main.Ways.WayEraser/OnTriggerEnter.c, decomp/.../WayBaseController/{CheckWayPlayers,DestroyWayByPlayer}.c).
- `CheckWayPlayers(owner)` = owner owns House1 and lane 1 is active, OR owner owns House2 (House2 not a Resource) and lane 2 is active. So the eraser only removes the erasing player's own lane; the opposing lane of a shared road survives (`DestroyWayFrom(destroyer)` stops only the destroyer's spawn timer, decomp/.../DestroyWayFrom.c). `DestroyWayByPlayer` throws an exception ("Wrong destroying way") if the owner matches neither side.
- `CanBeErased` is virtual (Trolley ways override to false, dump:L120241 / `TrolleyWayController.get_CanBeErased`).
- Automatic removal: capture of a house (`House.SetNewOwner` -> `DestroyAllWays` + `HouseWarriorSpawner.KillAllWarriors`, decomp/Game.Main.Buildings.House/SetNewOwner.c), house level drop making `availableWays` smaller or resource lines invalid (`House.OnHouseLevelChanged` -> `DestroyWayToResource(level)` + `SetAvailableWays`), trolley explosion (`TrolleyBuildingOnExploded` -> `KillWarriorsOnWays` + `DestroyAllWays`), sheep returning onto a line (8.6), rocket tower destroyed line (`RocketTower.TryToDestroyLine`).
- Crossing: other ways have no blocking layer, so lines freely cross (own or enemy); soldiers of different owners interact wherever their triggers meet (5.2). Opposing lanes of one road are the intended head-on duel.

### 3.5 Port notes (ways)

- Data: `Way {a, b, laneAB:{active,timer}, laneBA:{active,timer}}`; one Way per unordered pair (HasWayWith check) so reverse/opposite logic maps to "toggle lane direction for same owner, add second lane for different owners".
- Rules: slot limit by level thresholds (10, 30) as content constants; line blocked by segment-vs-obstacle/building intersection (precompute with segment/AABB tests; treat End buildings as exempt).
- Free lines, no length limit. Optional: cap length for usability.
- Erase = segment-segment intersection of the swipe polyline with a lane polyline owned by the swiper.

## 4. Troop production and flow

### 4.1 Spawn interval (decomp)

`House.UpdateSpawnWarriorTime` (decomp/Game.Main.Buildings.House/UpdateSpawnWarriorTime.c) and `SelectableFortess.UpdateSpawnWarriorTime` (same shape):

```
SpawnWarriorTime = ( K * 60 / (ws * level + 60) ) / f
K  = 1 if ways <= 1 else coefficientByWayCount * (ways - 1) + 1     (House.OnWayCountChanged.c)
ws = spawnWarriorSpeed (prefab/level `ws`, default 0.5)
f  = 1; if ChangedConstants.IsSpeedUpActive and owner is Player: f = spawnCoefficient (1.7; modified by the SpeedBoostFactor upgrade)
     then speed-tower coefficient c: c>0: f*=c ; c<0: f/= -c
```
`ways` = `addedWays.Count` (lanes started from this building incl. resource lines). `coefficientByWayCount` default 0.3 (houses), 0.2 (SelectableFortess). Per-way timer: every frame `timer += dt`; when `timer >= SpawnWarriorTime`, `timer -= SpawnWarriorTime` and `HouseWarriorSpawner.TrySpawnWarrior(way)` (decomp/.../WayBaseController/UpdateSpawnTimer.c). First soldier appears after one full interval.

Interval table (ws=0.5, no boost), seconds per soldier per line: L=1: 0.99/1.29/1.59 (1/2/3 lines); L=10: 0.92/1.20/1.48; L=30: 0.80/1.04/1.28; L=64: 0.65/0.85/1.04. Total output with n lines = n/T: more lines -> more total throughput but each line slower (1 line 1.0x, 2 lines 1.54x, 3 lines 1.88x of one-line rate).

### 4.2 Spawn cap and entry

`HouseWarriorSpawner.TrySpawnWarrior` refuses when `spawnedWarriors.Count >= GameConfig.max_units_from_house` unless `withIgnoreLimits` (decomp/Game.Main.Buildings.HouseWarriorSpawner/TrySpawnWarrior_0x319F358.c: `*(int*)(config+0x400) <= count`). Default `max_units_from_house = 30` (ctor writes 0x1E at +0x400, decomp/UniWrapperGameConfig/.ctor.c + .rodata 0x125d018 = `1e000000 23000000`). Soldiers spawn at the house's `SpawnPoints` (count by `countSpawned`), rotated to the lane direction, with a random lateral path offset in [-0.2, 0.2] (`SetPathOffset`) and `START_PATH_OFFSET = 0.2` (dump:L167574). Requires lane with >=2 points.

### 4.3 Double unit

After each successful spawn: `rand = Random.Range(0,100)`; if `rand < spawnerSkin.doubleUnitChance` (percent, `InGameWarriorSkinData._doubleUnitChance`) then `TryToSpawnDoubleUnit` spawns one extra soldier after `TimeSpan.FromSeconds(0.15)` (decomp/Game.Main.Buildings.HouseWarriorSpawner._TrySpawnWarrior_d__28/MoveNext.c, ._TryToSpawnDoubleUnit_d__35/MoveNext.c).

### 4.4 Spawning is free

I searched all decomp for writes to `houseLevel` (`ReactiveProperty<int>.set_Value`): only AddLevel (arrival), TryDoDamageFrom/ProjectileFrom (damage), OnGrow (growth), Resource pick-up, trolley, capture-tower AddLevel. `HouseWarriorSpawner`/`WarriorBase.OnSpawned` never touch the level (files with `ReactiveProperty_int___set_Value`: Building/{TryDoDamageFrom,TryDoDamageFromProjectile}, House/AddLevel, Tower/SetAvailableWays, SelectableFortess/AddLevel, TrolleyBuilding/*, Flag/AddLevel, Resource/*, RocketTower/WayPath*). Conclusion: sending soldiers does not cost garrison; output rate depends on level.

### 4.5 Speed and spacing

`WarriorMovement` (decomp/Game.Main.Warriors.WarriorMovement/{InitWarriorMove,ResolveCurrentWarriorSpeed,Move}.c):
```
saved = cfg.speed (5)
speed = saved + saved * 0.01 * skinMovementSpeedBonus          // bonus is in percent (e.g. 5 -> +5%)
if (isSpeedBoostActive)  speed *= curSpeedCoefficient          // only Player-owned, only while ChangedConstants.IsSpeedUpActive
speed = min(speed, cfg.maxSpeed (7.5))
IncreaseSpeedCoefficient = speed / saved
```
`Move()`: `distancePassed += speed * Time.deltaTime`, advance `moveTargetIndex` when `distancePassed` reaches the segment length, position by interpolation along lane points (frame/delta-time driven, not fixed step). Spacing is implicit: gap = speed x interval (e.g. L=10, 1 line: ~4.6 world units).

Group formation (`WarriorGroup`, dump:L122417): `COUNT_IN_ROW = 4`, `WARRIOR_OFFSET_X = 0.4`, `WARRIOR_OFFSET_Y = 0.6` - used for multi-unit spawns (parachute drops, gates).

Speed buffs: `SpeedTower` (dump:L169981; `warriorSpeedUpStartValue/ByStage`, `houseSpeedUpStartValue/ByStage`, `defaultBuffRadius`) exists in code but no prefab/level contains it (levels have no `bt=6`; no `SpeedTower` MonoBehaviour in assets) -> unused in base game.

### 4.6 Growth and cap (decomp)

`HouseGrowth` (decomp/Game.Main.Buildings.HouseGrowth/{Update,UpdateTargetTime,StartGrowth}.c): `currentTime += dt` (EveryUpdate); at `currentTime >= targetTime` -> `GrowEvent` -> `House.OnGrow`: `level+1` if `level+1 <= maxLevel` (decomp/Game.Main.Buildings.House/OnGrow.c).
```
targetTime(level) = ( 0.9 / sqrt( floor(level/10) + 1 ) + 1.0 ) * defaultGrowLevelTime     // UpdateTargetTime / House.OnHouseLevelChanged
defaultGrowLevelTime: Default house 1.7, Attack/Artillery house 2.0 (prefabMB/Game.Main.Buildings.House); level JSON `gl` (1.7 / 2.0)
```
Seconds per +1 (1.7 base): L0-9 3.23; 10-19 2.78; 20-29 2.58; 30-39 2.47; 40-49 2.38; 50-59 2.33; 60-64 2.28 (2.0 base: 3.80, 3.27, 3.04, 2.90, 2.81, 2.74, 2.68).

Start/stop rules: `House.OnWayCountChanged(count)`: `count < 1 -> StartGrowth`, `count >= 1 -> StopGrowth` (decomp/.../House/OnWayCountChanged.c). `OnLevelStateChanged(Started)`: start growth for non-Neutral owners; any other state stops growth and stops all lane spawn timers (`WayBaseController.StopSpawn`). Neutral buildings do not grow (decomp/.../House/OnLevelStateChanged.c: `PlayerType != 2`). `SetNewOwner` zeroes the growth timer and restarts it for non-neutral owners. Level cap `maxLevel`: 64 on all House prefabs; level JSON overrides `ml` (corpus: 64 for 15,467 of 16,237 houses; others 30..450, 7 houses 999999) (`prefabMB/Game.Main.Buildings.House`, `lvl`).

### 4.7 Port notes (production)

Content constants per building: `{maxLevel, startLevel(l), spawnSpeed ws, coefByWayCount cwc, spawnCoef sc, growTime gl}`. Sim: per-lane accumulator; per-building growth accumulator active only when `ways==0 && owner!=neutral`. Keep the 0.9 constant and 10-level steps as content. Cap 30 alive units per house as content.

## 5. Combat

### 5.1 Damage model objects

`DamageableData {DefaultAttack, UniqueAttack: Dictionary<DamageableType,int>}` (dump:L160564). `GetDamage(type)` = `UniqueAttack[type]` if present else `DefaultAttack`. Used by every attacker.

### 5.2 Soldier vs soldier (decomp)

Trigger-driven: `WarriorPhysics.OnTriggerEnter` (tag "Warrior") creates/gets a `WarriorCollisionConflictBehaviour` for the pair; `ResolveWarriorsCollision(CloseCollision)` (decomp/Game.Main.Warriors.WarriorCollisionConflictBehaviour/{ResolveWarriorsCollision,ResolveDoDamageVariants,CheckCanDoDamageVariants,IsDamageableLocationCorrectToDoDamage,CheckIfAllAlive}.c):

1. `dmgCur = cur.DamageableData.GetDamage(Warrior)`; `dmgOther = other.DamageableData.GetDamage(Warrior)` - both read BEFORE applying.
2. Location rule (`IsDamageableLocationCorrectToDoDamage`, no rage skill): attacker can hit target iff `attacker.DamageableLocationType == Air(1)` or both same location. Default location Ground(0); rage skills with `damageableLocationInSkill: 1` (Forsage, Hail) make the unit Air while active (strlit[12200]).
3. If `canDamageOther`: `other.TryDoDamageFrom(cur.Owner, dmgCur)`; if `canDamageCur`: `cur.TryDoDamageFrom(other.Owner, dmgOther)`.
4. For CloseCollision the pair is resolved up to 2 rounds while both are alive (`do{ if(!CheckIfAllAlive) return; ResolveDoDamageVariants(...) }while(i<2)`).
5. For `DistanceCollision` (ranged attackers) the side with the larger `AttackDistance` (or rage-skill distance) is the only one that deals damage (`CheckCanDoDamageVariants`).

`WarriorBase.TryDoDamageFrom(attacker, dmg)` (decomp/.../WarriorBase/TryDoDamageFrom.c): ignored if `attacker == own Owner` or `HitPoints <= 0`; if `TryToDisableShield()` consumes a shield -> returns true, no HP loss; else `HitPoints = max(0, HitPoints - dmg)`, `if HitPoints <= 0 -> WarriorKilled()` (async: death delay then despawn), then `ResolveHpLogicAfterDoDamage`.

Resulting outcomes: with hp-based units (damage = current HP): soldiers with HP a and b -> both deal their HP; larger survives with `|a-b|` HP, equal -> both die. With flat 1/2/1 HP and attack 1/2/1: tank (hp2, atk2) vs soldier (hp1, atk1): soldier dies, tank left with hp1.

### 5.3 Soldier vs building

`House.OnTriggerEnter` (tag "Warrior"): ignores a warrior that belongs to this house's spawner unless it may collide with its start house (`CanCollideWithStartHouse`, set after a reverse) (decomp/Game.Main.Buildings.House/OnTriggerEnter.c, _OnTriggerEnter_g__ResolveWarriorCollision_50_0.c):

- Same owner: `House.AddLevel(warrior)`: `level' = level + warrior.Defense`; if `level' > maxLevel` -> level = maxLevel and the surplus warrior is re-spawned on a random other lane of this house (`TrySpawnAdditionalWarrior`, transit) instead of vanishing (decomp/.../House/AddLevel.c); plays "HouseMaxLevel" sound at max. `WarriorEffectOnCollision` handles carried resources (6).
- Enemy or neutral: `damage = warrior.DamageableData.GetDamage(building.DamageableType)` then `Building.TryDoDamageFrom(attackerOwner, damage)`.

`Building.TryDoDamageFrom` (decomp/Game.Main.Buildings.Building/TryDoDamageFrom.c): if `attacker != Owner`: `n = level - damage`; if `n < 0`: `level = 0` and virtual `SetNewOwner(attacker)` (capture; overshoot is discarded); else `level = n` (level 0 with damage 0 stays). Capture therefore needs strictly more damage than current level (level+1 soldiers of attack 1). Returns `attacker != Owner`.

`House.SetNewOwner` (decomp/.../House/SetNewOwner.c): ignored if the new owner is the Neutral player; clears `canBeIgnoredToWin` (field +0x64 set to 0), resets growth timer, `DestroyAllWays`, `HouseWarriorSpawner.KillAllWarriors` (all soldiers spawned by the old owner die), moves the building between players' `Buildings`/`SelectableBuildings` lists, sets `Owner`, starts growth (non-neutral), plays capture sound / optional interstitial (`ChangedConstants.IsAdAvailableOnLevel` +0x6F).

`TryDoDamageFromProjectile` (tower bullets, rocket explosions): `level = max(0, level - dmg)`, never flips ownership (decomp/.../Building/TryDoDamageFromProjectile.c). A level-0 building still needs a soldier hit to capture.

`Tower.OnTriggerEnter`, `Fortess.OnTriggerEnter`, `SelectableFortess`, `Flag`, `TrolleyBuilding` follow the same own -> AddLevel / enemy -> damage pattern (calls: `AddLevel`, `DamageableData.GetDamage`, `WarriorBase.Despawn`).

Port notes: arrival resolution = `if owner==b.owner: b.level=min(max, level+def) (overflow->forward) else if d>level: flip(level=0) else level-=d`. Note flat per-soldier damage (1/2/1) is independent of soldier HP.

### 5.4 Shield ("Resurrection" stat) (decomp)

`WarriorBase.Initialize` (decomp/.../WarriorBase/Initialize.c): `shieldActive = Random.Range(0,100) < skin._resurrectionChance + talents.strongerAgainst<enemyColor>` where enemy color: Yellow(3) -> talent +0x28, Red(2) -> +0x24, Green(1) -> +0x2C, else 0. If active the unit spawns with `UnitShieldVfx`; `TryToDisableShield` (called at start of `TryDoDamageFrom`) absorbs exactly one incoming damage event (including projectile and rage hits unless `shieldIgnoreAvailable`, strlit[12200]). The UI name for the stat is "Resurrection" (`UpgradeType.Resurrection`, `SkinStatsType.Resurrection`) but behaviour is a one-hit shield.

### 5.5 Towers and bullets (decomp + data)

`Tower : Building` (dump:L169780). Prefab data (`prefabMB/Game.Main.Buildings.Tower.Tower/*`): maxLevel 64, `defaultAttackDelay` 2.0 (2.5 variant), `defaultAttackRadius` 1.6 (2.0 variant), `coefficientSpeedByLevelUp` 1.75, `coefficientRadiusByLevelUp` 0.9, `bulletSpeed` 12, `minRadius` 1, startLevel 3-5. Tower prefab colliders (prefab): `Hit` BoxCollider 0.6x1.0x0.6 (soldier hits it), `Building` 1.5x1.0x1.5, `Selecable` 2.5x1.0x2.5 (all triggers); bullet `TowerProjectile` SphereCollider r 0.25 trigger. Level JSON `to` (1,047 towers): `ad` 2.0, `ar` 1.6 (1.5/1.2/1.4/2.0 rare), `supl` 1.75, `rupl` 0.9, `bs` 12.0 (20.0 once), `cbi` true for 19.

```
stage = 1 if level<10; 2 if 10<=level<30; 3 if level>=30     (Tower.SetAvailableWays; Tower has no lines, "ways" = stage)
radiusScale = defaultAttackRadius + coefficientRadiusByLevelUp * (stage - 1)   -> 1.6 / 2.5 / 3.4   (uniform localScale of the trigger object)
WORLD radius = radiusScale * 2.4 = 3.84 / 6.0 / 8.16  (prefab: `TowerRadius` SphereCollider r = 2.4, isTrigger; `Tower.IsPointInAttackRadius` also uses curAttackRadius * 2.4, decomp/.../Tower/IsPointInAttackRadius.c, `AbstractDamageableTrigger.ChangeLocalScale`)
attackDelay = coefficientSpeedByLevelUp * 60 / (defaultAttackDelay * level + 60)      (Tower.CalculateAttackDelay)
   L=1: 1.69s, L=5: 1.50, L=10: 1.31, L=30: 0.88, L=64: 0.56
bullet damage = DamageableData(defaultAttack = 1)      (Tower.Init: DamageableData(1))
```
Target selection (`Tower.Update`, TryAttackSelectableHouses, TryAttackWarrior): the trigger is a `DetectAndGroupedDamageableTrigger` with `_canAttackTypes [98 Warrior, 10 Trolley, 0 SelectableHouse]` (`prefabMB/Game.Main.Buildings.DetectAndGroupedDamageableTrigger`); targets are grouped by type, sorted by distance to the tower; houses/trolleys go to `TryAttackSelectableHouses` (skips own and Neutral owners - owner PlayerType checks in decomp), warriors to `TryAttackWarrior` (only enemy owners). `SpawnBullet` spawns a pooled `BulletPhysicsProjectileToTarget` with `bulletSpeed`.
Bullet effect on soldiers: `WarriorBase.TryDoDamageFromProjectile(owner, ProjectileSpawnType.Tower, ...)` -> if `talents.towerShootDefBonus > 0` consume one charge and block, else damage = current HP (instant kill) (decomp/.../WarriorBase/TryDoDamageFromProjectile.c: type 2 RocketTower and unmatched types kill; type 1 Warrior uses the given damage). Bullet effect on houses: `TryDoDamageFromProjectile` with damage 1 (level -1, no capture).
Tower can be captured like houses (arrival -> `AddLevel`/damage).

Port notes: tower = `{stage thresholds, radius(stage), delay(level)}`; targets enemy soldiers (kill, optionally N block charges) and enemy houses in radius (-1 level/shot).

### 5.6 Fortresses

- `Fortess` (BuildingsType 4, dump:L170722) = non-selectable defensive building with 8 `FortessTower` turrets (`prefabMB/Game.Main.Buildings.BaseFortess.Fortess`): `attackCooldown 2.0`, `bulletSpeed 15`, maxLevel 64, startLevel 25, `coefficientByRocketTowerAttack 3.0`. Each `FortessTower` has a `DetectDamageableTrigger` with `_canAttackTypes [98 Warrior, 10 Trolley]` (`prefabMB/Game.Main.Buildings.DetectDamageableTrigger`) -> shoots soldiers (and trolleys) in range (instakill rules as 5.5; turret cooldown timers are DOTween delayed calls). Captured by arriving soldiers (levels as Tower).
- `SelectableFortess` (type 7, dump:L170526): behaves like a house (lines, spawn formula with `cwc 0.2`, `ws 0.5`, `sc 1.7`, maxLevel 64 default or up to 350 in prefabs) AND has 8 turrets (`attackCooldown 2.0`, `bulletSpeed 15`) AND periodically drops parachute reinforcements (`FortessCargoWithWarriors`: `delayTimeToSpawnCargo` 5 s default in prefab, level JSON `dtsc` 3-20 s; `spawnedWarriorCount` `swc` 3-30, mostly 9; `warriorsCountPerParachute` `wcpr` 1-7, mostly 3; fall times 1.0 / 2.0 s, first step y 10.0, `prefabMB/Game.Main.Buildings.SelectableFortess.FortessCargoWithWarriors`). Parachute logic is decoded in 5.6.1 below. Fortress gun detection = CapsuleCollider r 3.0 (local; trigger) plus a r 0.5 non-trigger body collider per gun (prefab); fortress `Hit` box 3.3x1x3.3, `Building` 4.7x1x4.7, `Selecable` 4.0x1x4.0 (SelectableFortess adds a `SmallHit` 0.3x1x0.3). Level JSON stats: 323 fortresses in the corpus, `ml` 64/100/150/120/200/300..., `ac` 2.0 (4.0, 6.0 rare).

#### 5.6.1 Fortress parachute cargo (decomp + prefab)

`FortessCargoWithWarriors` (decomp/Game.Main.Buildings.SelectableFortess.FortessCargoWithWarriors/*; coroutine `_SpawnFlyWarriors_d__28`, async `_ManipulateWarriorFallDown*_d__32/33`, `_SpawnAdditionalWarriors_d__34`):

- Gating: runs only while the fortress is owned by a non-Neutral player (`ActivateSpawnCargo` returns at once if `lastPlayerType == 2`). Every owner change (`OwnerChanged`) stops all coroutines, kills every still-airborne parachute warrior (`ResetSpawnedWarriors` -> `WarriorBase.ForceKill`, kills the fall tweens) and restarts the cycle for the new owner. `ForceStopSpawnCargo` does the same without restart.
- Cycle: `drops = trunc(spawnedWarriorCount / warriorsCountPerParachute)` (the field `delayTimeToSpawnCargo` is reused as this integer drop counter); a `WaitForSecondsRealtime(delayTimeToSpawnCargo seconds)` (Init; level JSON `dtsc`, prefab 5 s) sits between drops; the remaining-warrior budget is decremented by `min(budget, warriorsCountPerParachute)` per drop (`CalculateAdditionalWarriorsCount`). Each drop spawns that many soldiers through `HouseWarriorSpawner.TrySpawnWarrior` at the fortress parachute spawn points (`spawnPointsWarrior`, 9 `ManyPoints_N` sets chosen by count), they fall in two tween steps (`firstStepFallDownTime` 1.0 s from y 10.0, then `secondStepFallDownTime` 2.0 s), and the cycle waits (`WaitUntil`, 0.3 s polling via `UniTask.Delay`) until all of them are disposed before the next full wave.
- Landing: if the fortress has an outgoing lane (`GetAddedWays`), the chargers land and walk a RANDOM lane of the fortress (`UnityEngine.Random.Range(0, ways.Count)` as move path; `WarriorMovement.SetMovePointIndex(1)`, `AllowToCollideWithStartHouse`). Without lanes (`ManipulateWarriorFallDownWithBonusLevel`) they fall onto the fortress, `ChangeIgnoreCollisionCount`/`InsertAnotherStartMovePoint` make them collide with their own start house and thus add `Defense` each (5.3 AddLevel), i.e. parachuted reinforcement of its level. The warriors are normal units (own spawner, HP/skin of the owner), so killing them in the air is impossible; they are dead only if the fortress changes owner or they are shot/fought after landing.
- Numbers: prefab `FlyWarriorController`: delayTimeToSpawnCargo 5.0, firstStepFallDownTime 1.0, secondStepFallDownTime 2.0, firstStepPosY 10.0, spawnedWarriorCount 14, warriorsCountPerParachute 5; level JSON overrides `dtsc`, `swc`, `wcpr` (section 5.6 above).

### 5.7 Rocket tower (decomp + data)

`RocketTower : SelectableBuilding` (BuildingsType 3, dump:L168925): prefab `rocketMoveTime 1.0`, `defaultDelayToShoot 0.5`, `coefficientShootByLevelUp 4.0`, `disabledDuration 5.0`, maxLevel 64, startLevel 5/25, `coefficientByRocketTowerAttack 2.0` (`prefabMB/Game.Main.Buildings.RocketTower`); level JSON `ds 0.5`, `lup 4.0`.

- It has no soldier lines. The player drags from it to create a `WayRocket` aim path (Human: `StartCreateWayPath`/`TryCreateWayPath`; `RocketTower.WayPathCreated` sets `availableWays`=0, one aim at a time; `WayPathDestroyed` restores 1).
- Stage = 1/2/3 by level as above; each volley fires `stage` rockets (AttackCoroutine loops i=1..stageLevel, `RocketTowerRocketSpawnData(movePath, moveTime, damageableData, isDamageAllowed, material)`), rocket flies the path in `rocketMoveTime`.
- Volley delay: `currentDelayToShoot = coefficientShootByLevelUp*60/(defaultDelayToShoot*level+60)` (L=1: 3.97 s; L=10: 3.69; L=30: 3.20; L=64: 2.61); first shot delay = `defaultDelayToShoot*0.5`-style (`WaitForSeconds(delay*0.5)` when first shot, else 2.0 s wait if no path) (decomp/Game.Main.Buildings.RocketTower._AttackCoroutine_d__73/MoveNext.c).
- Rocket damage per stage: `rocketTowerAttackByStage = [3, 4, 5]` (static array initialiser, meta@0x8EB060 -> ints 3,4,5; `RocketTower.SetAvailableWays` -> `DamageableData.ChangeDefaultAttackValue(attack[stage-1])`).
- Impact (`RocketTowerRocket._Move_b__0` -> `CollisionCheckerInSphere.DoDamageInRadiusFromProjectile`): area (`_damageRadius`) damage to everything in `_allowToDamageTypes`: buildings via `TryDoDamageFromProjectile(owner, RocketTower, damage = GetDamage(type))`, soldiers killed (`TryDoDamageFromProjectile` type 2), mines destroyed, walls damaged, sheep destroyed, bridge ceils destroyed (decomp/Core.Common.Components.CollisionCheckerInSphere/*). Radius values (prefab): rocket `RocketTowerProjectile/DestroyTrigger` `_damageRadius` 1.15 with `_allowToDamageTypes` [0 SelectableHouse, 1 Tower, 3 Fortess, 6 Mine, 7 Wall, 8 Bridge, 9 Sheep, 98 Warrior, 10 Trolley]; `projectileSpawnType` 2 (RocketTower). The `RocketTowerRadius` upgrade (UpgradeType 12) has NO in-match consumer, so 1.15 is fixed (section 9).
- A rocket tower dropped to level 0 by a RocketTower-type projectile is disabled for `disabledDuration` 5 s (`TowerDisabledCoroutine`, `RocketTower.TryDoDamageFromProjectile`).
- `coefficientByRocketTowerAttack` (Building +0x68; 1.0 Default house, 3.0 Attack/Artillery house and Fortress/CaptureRocketTower, 2.0 rocket tower, 0.0 flag/trolley/resource): consumer FOUND, it is the AI rocket-tower target weight. `DefaultBehavior.TryCreateWayFromRocketTower` (decomp/Game.Main.Player.DefaultBehavior/TryCreateWayFromRocketTower.c) scans the list of enemy buildings, skips BuildingsType 2 (Resource) entries and picks the one maximising `coefficientByRocketTowerAttack * level` (float x int, strict `<` comparison keeps the first of equals), then asks the AI attack controller to draw a rocket line from the chosen rocket tower to it. No gameplay consumer for humans.

### 5.8 Capture rocket tower (decomp + prefab)

`CaptureRocketTower` (BuildingsType 8, dump:L166505; fields: projectileAttack 0x100, projectileSpeed 0x104, CaptureRocketTowerParams 0x108, IsChargingActive 0x132). Prefab: `projectileAttack 64`, `projectileSpeed 0.5`, params `{maxLevel 64, startLevel 10, startChargingPoints 58, maxChargingPoints 1000, chargingCooldown 3.0}`; level JSON `scp`, `mcp` (typ. 100-350), `cc 3.0`; `coefficientByRocketTowerAttack 3.0`; colliders `Hit` 0.6x1x0.6, `Building` 2.08x1x2.08, `Selecable` 2.5x1x2.5.

- It is NOT a capture of ownership: the "rocket" zeroes the target building's level. `CaptureRocketTowerProjectile.DoDamage` (decomp/Game.Main.Projectile.CaptureRocketTowerProjectile/DoDamage.c) plays "ArmagedonBoom", calls virtual slot 0x308 on the target = `Building.SetHouseLevelToZeroWithAnimation` (tweens the level to 0 over 1.0 s with `DOVirtual.Float`, decomp/.../Building/SetHouseLevelToZeroWithAnimation.c; Trolley variant keeps a ready flag), and does area damage (`DestroyObjectInRadius`) of radius 3.0 that only allows type 98 Warrior (prefab `CaptureTowerRocketProjectile`), i.e. enemy soldiers within 3.0 of the impact are killed (projectileSpawnType 2). Ownership does not change; the zeroed building can then be taken by any soldier (needs damage >= 1, 5.3).
- Targeting (`CaptureRocketTower.TryToAttack` / `IsAttackable`): builds the list of all level buildings that pass `IsAttackable` (target has an owner; a Trolley counts only when its ready flag +0x6C is set), sorts by `level` DESCENDING and takes the first one that also passes a second predicate in the compiler lambda (captures an int from the tower owner's player object, presumably an own-vs-enemy check; not resolved); fires one `CaptureRocketTowerProjectile` from `projectileSpawnPoint` at it. Highest-level wins, so it hits the strongest enemy building (and can hit neutral buildings).
- Flight: parabolic; `moveProgress` advances `+= dt * projectileSpeed` (0.5/s, so 2.0 s flight) clamped to 1, position from two `AnimationCurve`s (`movementCurve` horizontal, `curveY` height scaled by `curHeight = clamp(dist / distanceToIncreaseHeight * increaseHeightValuePerDistance, minHeight..)`); on progress 1 it calls DoDamage then despawns. The 64 `projectileAttack` is stored in `_damageableData` but the level zeroing ignores it (damage radius check only targets warriors).
- Level handling: own soldiers arriving add `Defense` up to `maxLevel` (64) (`CaptureRocketTower.AddLevel`, clamps, plays "HouseMaxLevel" at exactly max), enemy soldiers damage it like a house (5.3); it keeps firing whatever its level.
- Charging: `IsChargingActive` (0x132) = tower is started (level state == 1 `OnLevelStateChanged`, `0x130 gameStarted`) AND owner PlayerType != Neutral (`TryToStartCharging`), further gated by `OnHouseLevelChanged` (`level != 0 && ...`); the charge counter itself (`startChargingPoints` 58 -> `maxChargingPoints` 1000, +points per `chargingCooldown` 3.0 s; fire when full) is driven from the UI view `CaptureRocketTowerUiView` (not decompiled; dump:L43524) which calls `TryToAttack`. Not decoded: points gained per tick; the per-instance `scp`/`mcp`/`cc` fields in level JSON are the only tuning knobs; recommend modelling it as "charge bar fills `mcp-scp` over ~3 s ticks, then shoots".

### 5.9 Artillery soldiers (ranged) (decomp + prefab)

`WarriorArtilleryController` (prefab `ArtilleryWarriorComponent`: `sphereColliderRadius 4.0` (detect trigger, set on the SphereCollider at init), `firstAttackDelay 0.4`, `nextAttackDelay 1.2`, `bulletSpeed 9.5`; `DetectDamageableTrigger._canAttackTypes [98 Warrior, 10 Trolley, 0 SelectableHouse, 1 Tower, 3 Fortess]`). Unit body collider (prefab `1_MilitaryArtilleryWarrior`): BoxCollider 0.71 x 0.72 x 0.84 trigger; soldier/tank body: SphereCollider r 0.35 trigger (physics layer 7).

- Timing: cooldownTimer starts at `firstAttackDelay` (0.4 s), `Update` decrements by `Time.deltaTime`, `canAttack` (+0x68) flips true at <= 0; after a volley cooldown = `nextAttackDelay` 1.2 s (`Update`, `CooldownTick`, `Attack` decomp/Game.Main.Warriors.WarriorArtilleryController/*.c).
- Targeting (`Attack`): if the trigger has >= 1 target it sorts them by distance (`SortTargetsByDistance`), rotates the turret (`LookAtEnemy`), then iterates the sorted list: a target qualifies when `IDamageable.CanBeAttackedBy(ownerPlayer)` (slot 7) is true and its planar distance (own position vs target `Position`/`WayPosition`) is `<=` the detect trigger's radius (virtual radius getter, 4.0). For every qualifying target it spawns a projectile (`SpawnBullet`) - the loop has no break after the spawn, so one volley fires at EVERY qualifying target in range (closest first), not just one; medium confidence (control flow read from decompiler output, not observed).
- Projectile (`ArtilleryRocketProjectile`/`RocketProjectile`; prefab: `destroyObjectsCollider` `DestroyObjectInRadius` `_damageRadius 1.0`, `_allowToDamageTypes [0,1,3,98,10]`, `projectileSpawnType 1` Warrior): flies straight at the target (`MoveTowardsTargetProjectile.Update`: moves `speed*dt` toward the target position, despawn/explode when squared distance < 0.1, i.e. ~0.32 units). On arrival `RocketProjectile.DoDamage` does an area hit via `CollisionCheckerInSphere.DoDamageInRadiusFromProjectile` (radius 1.0, centre = impact point): buildings take `GetDamage(type)` through `TryDoDamageFromProjectile`, soldiers take damage from `projectileSpawnType` 1 = the carried damage value (`unique[Warrior]` = the artillery unit's current HP, so a high-HP artillery one-shots weaker soldiers), shield absorbs one hit (5.4). Friendly units/buildings are ignored by the owner check. Direct-hit variant (`PhysicsProjectileToTarget`, used by tower/fortress bullets): straight rigidbody motion `moveSpeed*fixedDeltaTime`; only a trigger overlap with the exact designated target counts (`OnTriggerEnter` compares the hit object's IDamageable with `_projectileTarget`); then `DoDamage` = `GetDamage(target.DamageableType)` via `TryDoDamageFromProjectile(owner, spawnType, dmg)`; if the target is disposed first the bullet despawns (`OnTargetDisposed`).
- Rage variants (5.10): Hail adds `_bonusAimsCount 1` extra homing rockets at the next-closest enemy; BurningEarth turns the shot into a rocket that leaves a fire zone.

### 5.10 Rage skills (decomp + prefab + strlit)

Seven skills (`RageSkillsType`: 1 Dash, 2 Flamethrower, 3 BurningEarth, 4 Forsage, 5 Hail, 6 Annihilation, 7 LaserCannon). Base defaults (strlit[12200] `rageSkillConfig`, one entry per skill): `damageCoefficient`, `shieldIgnoreAvailable`, `immortalStateAvailable`, `damageableLocationInSkill` (0 Ground / 1 Air), `availableToAttackLocations`: Dash coef 2 (ignores shield, immortal, ground only); Flamethrower coef 1 (ignores shield, hits Ground+Air); BurningEarth coef 1 (no shield ignore; `stopDamageTimeByDamageableType` {SelectableHouse 1, Warrior 0.5, Tower 1, Fortess 1} s); Forsage coef 2 (ignores shield, immortal, Air, hits both); Hail coef 2 (no shield ignore, immortal, Air, hits both); Annihilation coef 99999 (ignores shield, ground only); LaserCannon coef 0.5.

Activation (decomp/Game.Main.Warriors.WarriorBase/ActivateRageSkill.c, WarriorArtillery/ActivateRageSkill.c, WarriorRageSkillController/*.c):

1. Per unit, at spawn init (`WarriorBase.Initialize` -> `InitRageSkill(skinRageSkillPrefab, config, skillActivationChance = skin._rageChance)`), a skill component exists only if the skin has `_rageSkillType != 0`. `ActivateRageSkill(skin)` (virtual; artillery overrides) rolls `Random.Range(0,100) < rageChance` (rageChance is the already-capped percent; 0.2 per level step for Relict, section 2.4/2.5). On success `SetActiveRageSkill(type)` arms the skill for the unit's LIFE (not per hit) and sets `unit.DamageableLocationType := config.damageableLocationInSkill` (Forsage/Hail units become Air targets: only attackers with `availableToAttackLocations`/Air can hit them, 5.2). `TryToActivateSkill` is the same roll (used by artillery `SpawnBullet`, where the roll is re-done PER SHOT, see below).
2. Arming calls `skill.SetSkillCanBeActivatedState(warrior, physics, attackLocations)`: caches own start/end house and owner (`BaseRageSkill.SetBaseLinks`, warrior +0xE0 start house, +0xE8 end house, +0xD0 owner) and enables the detect collider.
3. Trigger rule for Dash, Flamethrower, Annihilation (`OnTriggerEnter` of the detect collider): other collider tagged "Warrior"; its attack location is in the skill's available list; its owner != mine; AND it is on the same lane in the opposite direction (`other.startHouse == myEndHouse && other.endHouse == myStartHouse`). First such contact activates the skill (`ActivateSkill` via vslot); while already active a further contact just calls `WarriorBase.ResolveWarriorsCollision(other, mode)` (mode 0 Dash, 1 Flamethrower). Forsage activates immediately when armed (no trigger). LaserCannon activates immediately when armed if the unit's destination building has `DamageableType` in `_damageableTypes [0 House,1 Tower,3 Fortess]` and a different owner. Hail/BurningEarth are consulted only by `WarriorArtilleryController.SpawnBullet`, i.e. they work on artillery shots.

Effects:

- Dash (prefab `_percentBonusSpeed 15`, `_durationTime 0.5`; detect box (local) 1.48 x 2.84 x 13.88 ahead of the unit, damage box 2.78 x 3.6 x 1.46): on activation turns on the damage collider, turns off the unit's own physics collider (so it cannot be hit = "immortal"), plays dash anim, speed `+= percent * speed * 0.01` (= x1.15) capped at `maxSpeed` 7.5 for 0.5 s (DOVirtual delayed call -> `ResetSkillAfterEnd` re-enables collider, `ResolveCurrentWarriorSpeed`). Every enemy it touches resolves a collision with coefficient 2: damage = `int(GetDamage(Warrior) * 2)` (decomp/.../WarriorCollisionConflictBehaviour/{GetDamageWithActiveSkill,_DoDamageWhenAllWarriorsWithSkill_g__TryGetDamage_13_0}.c; the coefficient comes from the ATTACKER's active skill config) and shield ignored.
- Flamethrower (`_attackDistance 5`, `_durationTime 2.0`; detect/damage boxes 0.5 x 1.0 x 5.2 and 0.5 x 1.0 x 2.35): for 2.0 s a damage trigger in front of the tank hits enemy soldiers on the lane (coef 1, shields ignored, hits Air too) through `ResolveWarriorsCollision(other, 1)`.
- BurningEarth (artillery; `BurningEarthSkillParams {attackCooldown 0.5, startAttackDelay 0.5, lifeTime 1.5, damageableTypes [0,1,3,98], ground only}`, zone collider CapsuleCollider r 0.75): the artillery shot becomes a `BurningEarthRocketProjectile` (RocketProjectile hit radius 1.0 and then spawns a `BurningEarthSkill` zone at the impact point); the zone lives 1.5 s, applies damage to each enemy entering it after 0.5 s and then every 0.5 s (`StartAttackTick`), and after a hit a given target type is immune for `stopDamageTimeByDamageableType` (houses/towers/fortress 1 s, soldiers 0.5 s). Damage = unit's DamageableData (coef 1, no shield ignore).
- Forsage (`_percentBonusSpeed 25`, `_bonusDamage 1`, `_bonusDefence 1`, `_bonusDamageApplyTypes [0,1,3,99]`): on arming: speed x1.25 (capped 7.5), unit becomes Air, and `DamageableData.AddUniqueAttackValue` +1 vs SelectableHouse/Tower/Fortess/OtherBuildings (so +1 damage to buildings: a Default unit hits for 2, a tank for 3). `_bonusDefence 1` is serialized but its consumer was not traced. The damage bonus is removed in `DisableSkill` (unit death/despawn).
- Hail (artillery, `_bonusAimsCount 1`, `ArtilleryHailRocketProjectile`: `_damageRadius 1.0`, types [0,1,3,98], spawnType 1): on a successful per-shot roll the volley adds extra homing rockets at `bonusAims` more targets (the next closest enemies in range, excluding the first target), each with area damage radius 1.0; unit is Air (hard to hit) and has coefficient 2 (no shield ignore).
- Annihilation (T800-style tank/soldier; detect box 1.0 x 0.5 x 5.0, `_bonusSpeed 5.0`, `_stopWarriorMoveTime 0.1`, `_minTriggerDistance 1.0`, `_damageableTypes [98]`): on the head-on trigger the carrier stops 0.1 s and spawns a pooled `AnnihilationSkill` projectile (`AnnihilationSkillSpawnData`, raycast along the lane via `Physics.RaycastNonAlloc`, flies at its `_speed` to the far end of the lane); any enemy WARRIOR it touches (different owner, location rule) takes `int(unit.GetDamage(98) * 99999)` after shield removal (`ApplyRageSkillConfigToDisableShield`) = instant kill; one-shot (`0xA8` flag set; disarms until re-armed), projectile despawns 1.0 s after reaching its target point.
- LaserCannon (any unit that carries the skill prefab; `_bonusSpeed 5.0`, `_damageableTypes [0,1,3]`, left/right muzzle points): when the unit is walking toward an enemy building/tower/fortress it fires lasers (`LaserCannonSkillProjectile` = `MoveTowardsTargetProjectile`, 0.1^2 arrival threshold) from both muzzles with damage `GetDamage(targetType) * 0.5` (coefficient 0.5) until its cancellation token fires (death / target change); no shield bypass.

Rage-chance caps: player 30 / bot 200 in `statsParameter` (strlit[19550], percent points; note a brief claiming 35/50 is not supported by this data - those are different remote-config keys or live overrides). Because `rageChance` is a percentage rolled 0-100 and caps at 30 for humans, a maxed relict unit arms its skill in at most 30% of spawns.

## 6. Resources, gold and carried objects

- `Resource : Building` (type 2, dump:L168635): a pile with `amountOfResources` (= its `houseLevel`; prefab 6/12/14/18/24/32/60/100/154/224; level JSON `WOD[].c` same set, 994 piles of 6, 357 of 12, 337 of 24 ...). `canBeIgnoredToWin 1`, `canBeDestroyedInGame 1`, `RESOURCE_DISABLE_TIME 4`.
- A house can draw a line to a resource. Soldiers spawned on such a line have `IsResourceMove` set; on touching the pile `Resource.PickUp(warrior)` takes `min(amount, warrior.GetMaxCollectObjectsCount(type))` where `GetMaxCollectObjectsCount = DamageableData.DefaultAttack + talent bonus` (Gold: `addResourceBonus` +0x18; Wood: `createBridgeBonus` +0x1C) (decomp/.../WarriorBase/GetMaxCollectObjectsCount.c, Resource/PickUp.c), then `warrior.AddObjectInHand(obj, count)` and reverses its movement back home (`ReverseWarriorMove`, `WarriorMovement.ChangeMoveToReverse`). Empty pile is disabled (`DisableResource`, 4 s).
- `AddObjectInHand`: `ResourceTypeSelection.isHpIncreased` (Gold = true, `prefabMB/Game.Main.InGameItems.ResourceTypeSelection/Gold_*.json`) -> `warrior._defence += amount`; `isAttackedIncreased` -> `DefaultAttack += amount` (no resource uses it in data; Wood `BridgeWood`: both false, it is only a plank token).
- On return to its own house `House.WarriorEffectOnCollision` (decomp): type Gold -> notifies `onHouseLevelChangedFromResource(defense, 1)`; type Coins -> `(DefaultAttack, 3)` and awards currency (analytics key "cargo_add_money"); level itself rises through `AddLevel` (+Defense, i.e. 1 + carried gold). Net effect: gold piles let a soldier reinforce its house by more than 1.
- `DestroyWayToResource(level)` / `CheckIfCanDestroyWayToResource`: resource lines are removed when the house's `availableWays`/level changes make them invalid (decomp/Game.Main.Buildings.House/DestroyWayToResource.c, Way/CheckIfCanDestroyWayToResource.c; exact condition not decoded).
- Cargo crates (`CargoManager`, dump:L172000; `CargoAnimationController`): airdropped crate at predefined points (`Cargo[].P` in level JSON, `BId`); `CargoResourceType {Gold=0, Coin=1, None=2}`; spawn is gated by remote config (`show_cargo_*`, `SetPlayerAdventageToSpawnCargo`: crates appear when the player is behind) and opens when a soldier hits it or the player taps it (`OpenCargoFromTouch`, `Resource.SetResourceToCargo`). (inferred partly from names + decomp call lists.)

Port notes: resource = building-like node with `amount`; per-soldier carry = `attack + bonus`; carried gold adds to `defense` (reinforcement value); optional feature.

## 7. Players, ownership and win/lose

### 7.1 Players in level JSON (data, `lvl`, schema dump:L144746 PlayersSavedJsonValues, L146642 LevelSavedJsonValues)

`P[]` entries: `PT` PlayerType (corpus: 0 human 2,165; 1 AI 4,011; 2 neutral 2,162; 3 boss 32), `PC` color (0 blue human, 4 gray neutral, 2 red 2,006, 1 green 1,055, 3 yellow 982), `BD[]` buildings, AI fields `AD` (action delay 2-15 s), `MinRD/MaxRD` (reaction delay 1-2 typical, up to 15), `BT` behaviour (0 Attack / 1 Defense / 2 Random; AiBehavior dump:L155120), `AiDS`, `AiCWS`, `AiRM`, `AiSC` (scripted steps: `{I, AiSA:{GT, OHId, THId, DS, OS}}`) - AI decision logic belongs to P4. Building entries: `id`, `bt` BuildingsType, `lt` style (1 common, 2 festival), `p` {X,Y,Z}, `key` ('h' house, 'to' tower, 's_f' selectable fortress, 'rt' rocket tower, 'c_rt' capture rocket tower, 'tr' trolley, 'flag', 'b_t' boss tower, 'res'), type-specific fields (see 5.x), plus legacy upper-case duplicates (`L`,`ML`,`Id`,`Position`) in older level blocks.

### 7.2 Win / lose (decomp)

`LevelController.CheckLevelCompleteCondition` async state machine (decomp/Game.Main.Levels.LevelController._CheckLevelCompleteCondition_d__77/MoveNext.c and lambdas `_CheckLevelCompleteCondition_b__77_1/_2` in `LevelController.__c`):

- WIN: `Buildings.All(b => b.canBeIgnoredToWin || b.Owner.PlayerType == Player)` -> `ChangeAllBuildingToOwner` (all remaining ignored buildings flip to the player) -> `OnLevelWin`.
- LOSE: `Buildings.All(b => b.canBeIgnoredToWin || b.Owner.PlayerType != Player)` -> `OnLevelLose`.
- Boss levels (`LoadLevelType.Boss`, type 5) additionally lose when `LevelTimerController.IsLevelTimerElapsed` or the boss "last chance" logic fails (`LevelControllerBossHandler.IsLastChanceUnused/CheckIsMainPartOver`).
- Evaluated when building ownership/disposal changes (`LevelController.BuildingOnDisposed` -> `CheckLevelCompleteCondition`).
- `canBeIgnoredToWin` is a per-building flag from level JSON `cbi`: false on all 16,237 houses in the corpus, true on 19 towers, 49 rocket towers, 3 flags, boss towers; Resources and Trolleys prefab-true. `SetAllNeutralBuildingToBeIgnoredToWin` is used in stage modes. So in normal levels the player must capture EVERY neutral and enemy house/tower/fortress.
- Flag rule: `PlayerController.CheckIfFlagLastHouse` - if a player's only building is a Flag (type 5) it is force-flipped via virtual `SetNewOwner` (decomp/.../PlayerController/CheckIfFlagLastHouse.c); a flag alone does not keep a player alive.
- Multi-stage levels: `LevelState.StageWin/PrepareToNewStage`, `LevelController.StartNextLevelStage`, `ChangePlayerBuildingsAfterStageComplete`, `LevelDependencyStageMode`/`StageParams` (festival/challenge tower modes).

### 7.3 Ownership change

Ownership transfer happens only through `Building.TryDoDamageFrom` overflow (5.3) for houses/towers/fortresses; the new owner's colour/materials update (`OnOwnerChanged`); neutral owners are inert (no growth, cannot be a capturer: `House.SetNewOwner` early-out). `PlayerController.OnBuildingAdd/OnBuildingRemove` maintain per-player collections and push the owner's warrior skin data onto the building spawner (`SetNewWarriorSkinData`).

## 8. Map modifiers and special elements

All level-JSON schemas: dump:L143415-144480; corpus statistics from `_tools/p3_level_stats.py` over 2,195 level files.

### 8.1 Obstacles (OBS / ROBS / WOD)

`OBS[]`: `{OPP pos, OPR rot, OCP[] child positions, OCR[] child rotations, S[] active flags}` = grouped solid obstacles (`ObstacleContainer`, dump:L137778); `ROBS[]` = river-side obstacles (`RiverObstacleContainer`). They sit on the obstacle layer and block ways (3.2) and (as colliders) soldiers. Counts: OBS present in 1,890 levels (4,321 containers in the Default family). `WOD[]` = world objects (resource piles `key:"res"`, `c` amount).

### 8.2 Walls (`Wall[]`: `P,R,S,Hp,PS`)

`DestroyedWallItem` (dump:L151799). `Hp` 2-20 (mode: 5 in 1,477 of 3,750; 8; 10), `PS` (punch strength) always 15.0; prefab `addedPosByOneElement 0.5`, `addedScaleByOneElement 0.12`. Rule (decomp/Game.Main.InGameItems.DestroyedWallItem/{OnTriggerEnter,GetDamage}.c): each soldier entering the trigger calls `GetDamage(warrior.DamageableData)`: `dmg = UniqueAttack[Wall(7)]` if present else `DefaultAttack`, clamped to remaining Hp; `Hp -= dmg` (one "stick" explodes per HP point); then the soldier is `ForceKill`ed (consumed). Wall gone at Hp 0. Talent: at spawn `UniqueAttack[Wall] = DefaultAttack + talents.destroyWallBonus` and `UniqueAttack[Resource(2)] = DefaultAttack + destroyWallBonus` (decomp/.../WarriorBase/Initialize.c). Rocket area damage also hurts walls (CollisionCheckerInSphere).

### 8.3 Mines (`Mine[]`: `P,R,S`; 5,720+ in Default family)

`MineItem` (dump:L152181): prefab `timeToDisableMine 2.0`, `delayToPlayBoom 0`. Soldier (non-Air) touching it: `WarriorBase.DoDamageFromMine`: if `talents.mineBlockBonus > 0` decrement and survive; else after `0.1 s` the soldier is `ForceKill`ed; the mine is destroyed either way (`DestroyMine`, scale-down animation). Trolley takes `MINE_DAMAGE_FOR_TROLLEY = 1` level damage (dump:L152184). Mines are also destroyed by rocket/area explosions. (decomp/Game.Main.InGameItems.MineItem/OnTriggerEnter.c, WarriorBase._DoDamageFromMine_d__138/MoveNext.c, WarriorTalentsController/TryToDefendAgainstMineBoom.c.)

### 8.4 Rivers and bridges (`River[]`: `P,R,T,W,D`)

`T` shape 0-17 (most common 11 MediumLine 133, 5 LineRiver 92), `W` bridge width always 1.014, `D` distance between bridges 0.2 (`prefabMB/Game.Main.InGameItems.RiverBridgeController`). A line crossing a river is allowed; the way enters "river state" and the soldiers spawned on it carry a `BridgeWood` plank token (`WayBaseController.SetWayStateToRiver(objToHand, ...)`, `_riversCount`). `RiverBridgeController` raycasts the way against the river colliders (`FindPositionsToCreateBridges`) and creates `RiverBridge` objects with `BridgeCeil` planks (`CreateBridgeCeils`, `PLANK_OFFSET 0.55`). A soldier with a plank touching an inactive ceil activates it and consumes one plank (`BridgeCeil.OnTriggerEnter`: `CheckRightWay`, `WithResourceInHand`, `ActivateCeil`, `RemoveObjectInHand`); a soldier without a plank that cannot proceed reverses (`TryToReverseWarriorMove`: if forward move and no reverse possible -> `ForceKill`, else `ChangeMoveToReverse`). Bridge complete when all ceils active (`CheckCreatedState`, `Enumerable.All`). Talents `createBridgeBonus`/BridgeSpeedTalent increase carried planks. Rocket explosions destroy ceils (`BridgeCeil.GetDamage`). (decomp/Game.Main.InGameItems.{BridgeCeil,RiverBridge,RiverBridgeController}.)

### 8.5 Gates (`Gate[]`: `T,C,P,R`; only "Draw" levels: 126 levels, 375 gates)

`GateBehavior` (dump:L151924): `T` type (Plus 302, Minus 67, Multiply 6, Divide 0 in corpus), `C` coefficient (1: 251, 2: 90, 5: 19, 3: 14, 4: 1). Applied once per `WarriorGroup` passing the trigger (`groupIdAndWarriors` dictionary): Plus: add `C` soldiers to the group (`HouseWarriorSpawner.SpawnWarrior` clones, flash vfx); Minus: remove `C` (despawn); Multiply: add `groupSize*(C-1)`; Divide: remove `groupSize/C` (decomp/Game.Main.InGameItems.GateBehavior/{PlusBehavior,MinusBehavior,MultiplyBehavior,DivideBehavior,StartMinus,AddWarrior}.c; Divide rounding as read: `StartMinus(group, size / C)`).

### 8.6 Sheep (`Sheep[]`: `P,R,S,D,IsS`; 344+42 in corpus)

`SheepControllerAnotherVersion` (dump:L152673): prefab `cooldownToEnableCreateWay 10`, `sheepMoveTime 1`, `delayToReturn` 2 (round pen) / 5 (square, `IsS` true), `sheepTimeToResurrection 30`, explosion strength 350 radius 3. When a way is created through the pen (`OnWayCreated` -> `Aside`), sheep step aside to free points (`TryToMoveSheeps`, `SheepMove.Move`), the pen trigger goes on cooldown (10 s), and after `delayToReturn` seconds sheep return (`ArriveSheeps`); any way still crossing them is destroyed (`DestroyWaysWitchCollidedWithSheeps`). Rocket area damage kills sheep (`CheckCollisionWithSheeps` -> `SheepMove.DestroySheep`), they resurrect after 30 s. (decomp call lists; timings from data.)

### 8.7 Trolley (BuildingsType 10; `tr` 166 + 21 in corpus; `WayType.Trolley`) (decomp + prefab)

`TrolleyBuilding : SelectableBuilding` (dump:L169394; prefab `_maxLevel` 12 / start 6; level JSON `l` 0-98, `ml` 5-15; `canBeIgnoredToWin 1`, `coefficientByRocketTowerAttack 0`; colliders `Building` 1.31x1x1.31, `AimingCollider` 0.48x1x0.84, `Hit`/`Selecable` as houses; prefab `_moveSpeed 1.0`, `_rotationSpeed 5.0`). Two phases controlled by `TrolleyMovementController` (+0x38 = isMoving) and the building ready flag `+0x6C`:

1. Loading (stationary, `isMoving == false`): own soldiers touching it `AddLevel` (+Defense, despawn the soldier); enemy soldiers damage it (house-like, plays "HouseLevelDown"). `TrolleyBuilding.AddLevel` (decomp/.../TrolleyBuilding/AddLevel.c): if `level + defense > _maxLevel` -> the trolley sets `availableWays=1`, `freeWaysCount=1` and the ready flag `0x6C := 1`, fires `ReadyToMove` (so the player may draw its single line); else level += defense. Init: if `_startLevel == _maxLevel` it starts ready (`0x6C = 1`). Gating = "filled to capacity with own soldiers".
2. Moving (after the player draws a line from the ready trolley to a building: `OnWayCountChanged` -> `freeWaysCount = 0`, `TrolleyMovementController.StartMove(wayEndBuilding.transform)` and `TrolleyPhysics.OnStartMove`): the cart moves in a straight line toward the target building transform at `_moveSpeed` (1.0 units/s, x `_speedUpCoefficient` = WarriorParams speedUpCoefficient 1.3 when the speed booster is on; `GetMoveSpeed`, `MoveToTarget`; rotation `Slerp` at 5.0). While moving, ANY warrior touching it (own or enemy) is `ForceKill`ed (decomp/.../TrolleyCollidedResolverOnWarriorCollided.c, `isMoving` branch), a touch on a Building calls `Explosion(building)` (except a Resource whose level < 1) (`TrolleyCollidedResolverOnBuildingCollided`), and reaching the target within squared distance 1e-5 calls `MovementControllerOnTargetReached` -> explosion on the target. Mines (`DoDamageFromMine`: level -= damage, explode when level <= 0 and ready) and projectiles (`TryDoDamageFromProjectile`: explode when level <= 0 and ready) also detonate it; a hit before ready only plays the negative-punch animation.
3. Explosion strength: binary, NOT level-dependent. `Explosion` stops the controller and raises `Exploded(trolley, building)` -> `PlayerController.TrolleyBuildingOnExploded` (decomp/.../PlayerController/TrolleyBuildingOnExploded.c): if the touched/target building exists it `KillWarriorsOnWays(building)`, `DestroyAllWays(building)` and `LevelView.RemoveBuilding(building)` + virtual `Dispose` (slot 0x398) - the target building is deleted from the map entirely, whatever its level or owner (towers, houses, fortresses alike; only the Resource exception above) - and the same for the trolley itself. The trolley's carried level only matters as the readiness threshold (12/15 soldiers).

Trolley lines use `TrolleyWayController` (not erasable). Port: `Trolley{maxLevel, ready, target}`; ready when level would exceed max; line draw triggers straight-line travel at 1 u/s killing all soldiers it meets; contact/arrival deletes the target building and its lines.

### 8.8 Railway (`Railway[]`: `P,CTI,PPP,SCV`; 61+7 levels) (decomp + prefab)

`RailwayController` (dump:L168307, prefab `Railway`: `_pathPoints` (5 in the sample prefab), `_cart`, `_startCartPositionPointIndex`, cart collider BoxCollider 2.6x2.54x2.6 non-trigger, `_cartSize 1.35`) hosts a connected building (`CTI` = id of the tower/house sitting on the cart; `SetupConnectedBuilding` reparents it to the cart at the `SCV` point) that can slide along the rail polyline. `RailwayModel` state (`RailwayState {Lock 0, Active 1, Moving 2}`, `CanMove = state in {Active, Moving}`, decomp/.../RailwayModel/{SetState,get_CanMove}.c); on every state change `RailwayController.RailwayModelOnStateChanged` copies `state != Lock` to the connected building's flag +0x6C ("movable").

- Who moves: by owner. `RailwayModel.OnOwnerChanged` stores the owner's PlayerType; `RailwayController.RailwayModelOnPlayerControllerChanged` enables `HumanRailwayMovementController` only for the Player owner and `AiRailwayMovementController` for AI owners, and disables both for Neutral (type 2). So a captured railway tower changes controller.
- Human drag: `HumanRailwayMovementController.MoveByWorldPosition` projects the pointer onto the current rail segment (`GetClosestPointOnSegment`, hit offset), steps to the next/previous segment when the projection passes an end (`TryIncrementSegment`/`TryDecrementSegment`), and `Update` snaps the cart to that target position every frame while the model state is Active or Moving; on release `MoveToNearestPoint` snaps to the nearest rail path point by tween over `_moveDuration` (0.2 s; `MoveByPathValue`, path value 0..1 along the polyline via `AbstractRailwayMovementController.GetPathValue/GetCartPositionByPathValue`).
- AI: `AiPlayerController.OnBuildingAdd` locks (`SetState(0)`) and starts `MoveRailway`; `_PerformRailwayMoveAsync` moves along the rail with `AiRailwayMovementController.MoveByPathValue` (1.5 s ease curve, 0.5 s pause after, 0.7 s lock animation; `RailwayConfig_5315.json`), calls `PlayerController.KillWarriorsOnWays(building)` + `DestroyAllWays(building)` first (the moving building loses its lines AND its in-flight soldiers) and then `RailwayBehavior.TryFindAttackPositionForTower` / `TryCalculatePositionForWayTo` / `IsPathClear` (BoxCast) / `TryGetNearestPointPosition` choose the rail point from which a tower covers (`Tower.IsPointInAttackRadius`) or a house can draw a clear line to the chosen enemy, then `TryCreateWay` draws it. `RailwayMoveBehavior` is the JSON-configured step version (`RailwayMoveStepBehaviorSavedValues`, `UpdateBehavior` follows a `pathValue` target at a configured speed).
- Gating: the cart only moves in states Active/Moving, i.e. never while the owner is Neutral or during the AI's lock animation; a moving building cannot fire (its lines are destroyed at move start).
- Explosion strength: not applicable (railway is movement only; the cart collider is solid so soldiers do not pass through it).

### 8.9 Flags, boss towers (decomp + prefab + data)

`Flag` (type 5): level (`l`, `ml`) only, no lines, no combat (prefab coefficientByRocketTowerAttack 0), counts for ownership; see 7.2 for last-house rule.

`BossTower` (type 9, `Game.Main.BossEvent`, 32 boss levels; prefab colliders like a house: Hit 0.6, Building 1.5, Selecable 2.5; 9 `ManyPoints_N` spawn sets; level JSON `cmp`/`mp` movement point lists). It is a boss "damage sponge" owned by `BossPlayerController`:

- Damage model (decomp/Game.Main.BossEvent.BossTower/{OnTriggerEnter,OnDamageReceived,OnProjectileDamageReceived}.c): an enemy soldier touching the tower is despawned and converted into boss damage `IBossLevelConfigController.<slot 0x14>(unitPower)` (method name not resolved) where `unitPower = PlayerController.GetUnitPower(owner, warriorType)` (2.5); projectile damage only counts from the human player: tower/rocket-tower bullets (spawn types 0 and 2) = 1 flat, artillery rockets (type 1) = damage derived from the player's artillery power. Damage is summed in `_sessionDealtDamage` and reported via `OnDamaged`; nothing happens when the boss level state is 3 (finished). The boss itself has no HP bar in-sim: the score is total damage dealt (boss event rewards, P5).
- Power-up loop (`BossPowerUpController.StartBehave` timer -> `BossPlayerController.OnPowerUp`/`PowerUpFlow` -> `BossTower.PowerUp` coroutine): each iteration sets the boss level (`SetupUnits(iteration)`: new `HouseWarriorSpawner` skin/unit data for that level via `UpdatePower`/`CombatManager.CreateBossInGameWarriorSkinData`, i.e. soldier HP follows a boss-power table), sets the number of lines to `max(1, iteration - previous)` (`SetupWays`), teleports the tower to a random valid position (`GetRandomPosition` filters the point list `mp`, `Random.Range`), plays the power-up animation and waits. Timers come from the boss event config `{bossDelay[21], bossDurability[21], snowmanDurability 10}` (strlit[19471]; `bossDelay` likely = seconds between power-ups per boss level (1,6,5,6,7,8,4,7,...), `bossDurability` likely = number of power-up steps/damage thresholds per boss level (3-6); both are unverified readings of the names).
- AI (BossPlayerController): own AI step system (`AiStep`/behaviours from level JSON, `CapturedByBossBuildingsController` handles buildings the boss has captured and defends them), `CreateWaysOnPowerUp`/`FindWayByPriority` pick the boss's lines, `SpawnFakeUnits` produces decorative fodder; `OnLastChanceActivated` (the player's "last chance" revive) pauses boss updates, despawns boss warriors and fires the bomb booster on all boss towers (`PlayBombsOnAllBossTowers` -> `ArmagedonManager.ActivateBombOnBuildings`).
- Not decoded: the numeric damage-from-power table (`IBossLevelConfigController` slot 0x14), boss level 1-32 unit power curve, `bossDurability` exact semantics (number of damage thresholds vs. iterations). Belongs with modes/P5.

### 8.10 Speed tower (unused) and Armagedon bomb

- Bomb booster ("Armagedon", `ArmagedonManager`, dump:L171514): player-only booster, price 250 currency in Common levels, "Speed" booster by ad (`strlit[19527]`: `bombBoosterPriceByRcLevelCoefficient 250`, `defaultBombBoosterAimsCount 1`). Bomb button appears when the player is behind: `CheckBombButtonAdventage(playerAdvantage, activePlayersCount)` compares advantage to `ChangedConstants.PlayerAdvantageToActivateArmagedon[players-2]` (decomp/.../ArmagedonManager/CheckBombButtonAdventage.c); `FindArmagedonHouseAttack` sorts enemy buildings by level descending and bombs `aimCount` of them (aim count = 1 + `ArmagedonAimCount` upgrade); the strike is confirmed in decomp: candidates exclude Resource(2) and Flag(5) buildings and ones whose ready flag +0x6C is set, split into AI-owned (PlayerType 1) and neutral (2) lists (`FindArmagedonHouseAttack`); each chosen building gets `ActivateArmagedon` after a random delay `Random.Range(0, 0.3 s)` (`_ActivateBombOnBuildings_d__20`), which instantiates `ArmagedonAnimationController`; its animation callback (`DisplayClass21_0._ActivateArmagedon_b__6`) calls virtual slot 0x308 = `Building.SetHouseLevelToZeroWithAnimation`, which tweens the level linearly to 0 over 1.0 s (`DOVirtual.Float`). Ownership does not change (a 0-level building still needs a soldier hit to flip); no area damage to soldiers. Button cooldown `DELAY_AFTER_SPEED_UP_BUTTON_CLICK 5`; bots never use it; the boss mode uses it on boss towers when the player takes a last chance (8.9).
- Speed booster ("speed up"): `ChangedConstants.IsSpeedUpActive` multiplies PLAYER soldier speed by `curSpeedCoefficient` (SpeedBoostFactor upgrade, boost_1..3 step +0.1) and PLAYER house spawn rate by `spawnCoefficient` (1.7 default). It is asymmetric (human-only) and ad-driven.

## 9. Artefacts and upgrades in match

Data: `scenes/Game.Main.Settings.Artefacts.ArtefactsData/*.json` (24 artefacts; table in section 12.1). Each artefact: `artefactType`, bound `warriorType` (Default 8, Attack 8, Artillery 8), `mainStatType` (SkinStatsType: 0 Gold, 1 MovementSpeed, 2 Resurrection, 3 DoubleUnit), `mainStatBaseValue` (10 / 1.0 / 2.0), `mainStatUpgradeStep` (2 / 0.2 / 0.4), and 6 rarity talents `{rarity 1-6, talentType, value}`.

In-match effect path: `InGameWarriorSkinData._inGameArtefactsData` + `_inGameUpgradeArtefactBonuses` -> `WarriorTalentsController.InitWarriorTalents/InitArtefactTalents/InitUpgradesTalents` fill `WarriorTalents` (dump:L122722): `destroyWallBonus`, `mineBlockBonus`, `addResourceBonus`, `createBridgeBonus`, `towerShootDefBonus`, `strongerAgainstRed/Yellow/Green` (field offsets in controller: 0x10, 0x14, 0x18, 0x1C, 0x20, 0x24, 0x28, 0x2C). Talent semantics read in decomp:

| Talent | In-match effect | Evidence |
|---|---|---|
| DestroyWall | +N to the soldier's damage vs Wall and vs Resource(2) | WarriorBase/Initialize.c (`ChangeUniqueAttackValue(7|2, default + destroyWallBonus)`) |
| MineBlock | N charges: each mine hit consumed instead of dying | TryToDefendAgainstMineBoom.c |
| TowerShootBlock | N charges: tower bullets blocked | TryToDefendAgainstTowerShot.c, TryDoDamageFromProjectile.c |
| AddResource | +N gold units per pile pick-up | GetMaxCollectObjectsCount.c, GetResourceTypeBonus.c |
| BridgeSpeed | +N planks carried | same (Wood) |
| StrongerAgainstRed/Yellow/Green | +N percentage points to shield chance vs that enemy colour | Initialize.c, CalculateAdditionalBonusToActivateShield.c |
| Gold/MovementSpeed/Resurrection/DoubleUnit/BonusHealth | folded into the skin stats (`_goldBonus`, `_movementSpeedBonus`, `_resurrectionChance`, `_doubleUnitChance`) | InGameWarriorSkinData fields |

Research-center upgrades (`UpgradeConfig`, default config strlit[12451], 126 entries; `params.upgradeType`, `startValue`, `step`, `maxLevel`, `targets`): MovementSpeed/Gold/Resurrection/DoubleUnit per unit class (step 0.2, 5 levels), All-units versions (step 0.2, 3 levels), wall breaking / mine protection / gathering resources / bridge building (+1 flat, 1 level each, per class, up to 2 tiers), TowerSpeed/TowerRadius (Towers), RocketTowerSpeed/Radius (RocketTowers), BuildingsSpawnSpeed (AllBuildings), SpeedBoostFactor (boost_1-3, step 0.1), ArmagedonAimCount (bomb_1-2). Upgrade stat caps for combat power (`statsParameter`, strlit[19550]): MovementSpeed/Resurrection/DoubleUnit 50 (bot and player), RageChance 200 bot / 30 player. Power weights (`powerParameters`, strlit[19539]) are meta. CLOSED (high confidence): TowerSpeed/TowerRadius/RocketTowerSpeed/RocketTowerRadius/BuildingsSpawnSpeed have NO gameplay consumer. The only classes holding an `IUpgradesCompiler`/`IUpgradeService` outside the research-center UI are `SpeedBoosterUpgradeHandler` (SpeedBoostFactor), `BoosterManager`/`ArmagedonManager` (ArmagedonAimCount), `LevelBoostersService`, and the combat-power classes (`UpgradesCombatModifier`, `CombatService`, 2.5); no Tower/RocketTower/House/spawner class takes a compiler (dump constructor/field scan), so these five upgrades only add `addPowerPerValue` (5/5/5/5/10 per 0.1) to the combat power and hence to soldier HP. Caveat: absence is shown by dump/decomp scan of constructor/field injection; reflection or a Zenject signal consumer I did not enumerate remains theoretically possible.

Port notes: expose a "modifier set" per player {speedPct, shieldPct, doublePct, wallDmg, mineCharges, towerBlockCharges, goldCarry, plankCarry, vsColorShieldPct[3]} applied at spawn; this keeps meta decoupled.

## 10. Level instantiation data (what a sim loader needs)

Per level JSON (corpus counts, `_tools/p3_level_stats.py`): families Default 1,214 (+LevelView), Pvp 251, ChallengeTower 170, Arena 155, Terminator 153, Draw 130, Daily 56, Boss 32. Element presence (levels with >=1): OBS 1,890, Cargo 1,119, Wall 767, WOD 816, Mine 575, River 440, ROBS 242, Railway 68, Sheep 68, Gate 126 (Draw only), Trolley-building levels about 21 (166 buildings counted by key `tr` incl. duplicates). Building types in corpus: house 16,237 (+593 legacy), tower 1,047, rocket tower 837, selectable fortress 323, capture tower 236, trolley 166, flag 50, boss tower 32. House start level `l`: 10 (5,647), 5 (4,095), 15 (1,814), 20 (1,109), 25 (907) ...; unit type `WT`: Default 12,497, Attack 2,599, Artillery 1,734. House params almost constant: `ws` 0.5 (15,811) / 1.0 (417), `cwc` 0.3, `sc` 1.7, `gl` 1.7 (11,766) / 2.0 (4,470) (Attack/Artillery houses use 2.0 and often ws 1.0 in neutral variants). Player colours/AI fields as in 7.1.

`LevelElementsCreator` methods are trivial in decomp (no output); loading is data-driven through `HouseSavedJsonValues` etc. (`SetParamsFromJson` overrides prefab fields: startLevel, maxLevel, ws, cwc, sc, gl, canBeIgnored; decomp/.../House/SetParamsFromJson.c).

## 11. Simulation model, ticks, determinism

- Gameplay timers use `UniRx.Observable.EveryUpdate/EveryGameObjectUpdate` + `Time.deltaTime` (HouseGrowth, way spawn timers, WarriorMovement, tower/fortress DOTween delayed calls, coroutines/UniTask delays). Combat and capture rely on Unity physics trigger callbacks (`OnTriggerEnter` with tags "Warrior" etc.). Randomness: `UnityEngine.Random` for double-unit, shield chance, lateral offsets, overflow-forward lane choice. => frame-rate dependent, non-deterministic, no seeds, no replay.
- `Games.Uni.Lockstep.*` (dump:L1239884-1251602): `LifecycleConfig {_stepDurationMs 30, _stepDurationMinMs 15}`, `LockstepConfig {_historyDurationMs 5000}` (`scenes/Games.Uni.Lockstep.*`), `LifecycleService.MAX_STEPS_PER_FRAME`, `FAST_FORWARD_THRESHOLD`, states store with snapshots/rewind. Its only consumers in dump are Clan Wars classes (`IClanWarsService`, `ClanWarsMatch*`, dump:L160146, L186853 ...), not battle (`LevelController`, `GameController`, `PlayerController`). So there is no lockstep multiplayer for the tower-war battle; PvP/Arena opponents are AI bots with personalization (`Game.Main.FakeMultiplayer`, `Game.Services.Combat.CreateBotCombatMember`).
- Pause: `GamePauseManager.SetPause/SetUnpause` static (dump:L140906). Level speed-up (`IsSpeedUpActive`) is a player-side multiplier only.

Port notes (sim): use a fixed step (e.g. 30 ms like Lockstep, or 16.7 ms), integrate timers by step, replace trigger physics with swept segment/circle overlap tests in lane space, seed an RNG, and resolve same-step pair events in a stable order (e.g. by id). A discrete model works: each lane = ordered list of soldiers with `s` (distance along polyline); collisions between opposing lanes of a shared road happen when `s_a + s_b >= length` (head-on); crossings of different roads need geometric overlap (radius from `WarriorPhysics` colliders - not extracted; estimate ~0.15-0.2 from lateral offset range).

## 12. Data tables

### 12.1 Artefacts (data, `scenes/Game.Main.Settings.Artefacts.ArtefactsData`)

| id | Artefact | Unit | Main stat | base | step/level | Rarity talents (r1..r6) |
|---|---|---|---|---|---|---|
| 1 | Token | Default | DoubleUnit | 1.0 | 0.2 | r1 Gold 3, r2 StrongerVsRed 1, r3 MoveSpeed 5, r4 Resurrection 4, r5 StrongerVsRed 2, r6 DoubleUnit 6 |
| 2 | Axe | Default | Gold | 10 | 2.0 | MoveSpeed 2, DestroyWall 1, DoubleUnit 3, Gold 12, DestroyWall 2, Resurrection 6 |
| 3 | Belt | Default | Resurrection | 1.0 | 0.2 | DoubleUnit 1, StrongerVsGreen 1, Gold 8, DoubleUnit 4, StrongerVsGreen 2, Gold 20 |
| 4 | Berets | Default | MovementSpeed | 2.0 | 0.4 | Resurrection 1, DestroyWall 1, MoveSpeed 5, Gold 12, DestroyWall 2, MoveSpeed 12 |
| 5 | Backpack | Default | DoubleUnit | 1.0 | 0.2 | Gold 3, AddResource 1, MoveSpeed 5, Resurrection 4, AddResource 2, Resurrection 6 |
| 6 | Hammer | Default | Gold | 10 | 2.0 | Resurrection 1, BridgeSpeed 1, DoubleUnit 3, Gold 12, BridgeSpeed 2, DoubleUnit 6 |
| 7 | RabbitFoot | Default | MovementSpeed | 2.0 | 0.4 | Gold 3, MineBlock 1, Gold 8, Gold 12, MineBlock 2, Gold 20 |
| 8 | Flask | Default | Resurrection | 1.0 | 0.2 | DoubleUnit 1, StrongerVsYellow 1, Resurrection 3, DoubleUnit 4, StrongerVsYellow 2, Resurrection 6 |
| 9-16 | RadioSet, Canister, Optics, ImprovedRunningGear, Antenna, AdditionalContainersForCargo, AdditionalBlocking, RacingWheel | Attack | same pattern as 1-8 (Radio=Token, Canister=Axe, Optics=Belt, Gear=Berets, Antenna=Backpack, Containers=Hammer, Blocking=Flask with StrongerVsYellow 1/1/3, Wheel=RabbitFoot) | | | |
| 17-24 | Rocket, RepairKit, RadarTablet, HandBrake, Gear, FuelBarrel, Engine, Camouflage | Artillery | same pattern (Rocket=Token, RepairKit=Axe, Radar=Belt (StrongerVsGreen 1/2/3), HandBrake=Berets, Gear=Backpack, FuelBarrel=Hammer, Engine=Flask (Yellow 1/2/3), Camouflage=RabbitFoot) | | | |

(Values per rarity are the talent amounts; the main stat at level n = base + step*n by the field names - formula not decompiled.)

### 12.2 Corpus statistics worth keeping (data)

| Item | Value |
|---|---|
| Buildings per level | min 2, max 18, avg 9.06 |
| Wall Hp distribution | 5 (1,477), 8 (587), 10 (541), 6 (277), 3 (237), 7 (166), 4, 12, 15, 9, 2, 16, 20, 18; PS=15 always |
| Mines per level | up to dozens (5,720 mines in 330 Default levels) |
| Gate types / coefficients | Plus 302, Minus 67, Multiply 6; C: 1 251, 2 90, 5 19, 3 14, 4 1 |
| Sheep delay D | 2.0 (212), 5.0 (174) |
| Rivers | width 1.014, spacing 0.2 |
| Tower `ar` | 1.6 (1,035), 1.5 (9) |
| Fortress `swc/wcpr/dtsc` | 9/3/5 most common |

## 13. Port notes summary (data-driven module list)

1. `content/units.json`: 3 unit classes (attack, defense, hp, speed, maxSpeed) + modifier struct.
2. `content/buildings.json`: per type {maxLevel, ways thresholds [10,30], spawn {ws, cwc, sc}, growth {coef 0.9, step 10, base}, tower {delay coef, radius coef, bullet speed, damage}, rocket {volleyDelay coef 4, stage damage [3,4,5], moveTime}, fortress {cooldown, bullet speed, parachute}}.
3. Systems: WaySystem (create/validate/erase/lanes), SpawnSystem (per-lane timer + cap 30 + double unit), MoveSystem (polyline follow, speed formula), ContactSystem (soldier-soldier subtract, soldier-building capture), TowerSystem (kill/hit), ElementSystem (wall hp, mine, river planks, gates, sheep), WinSystem (ignore flags), GrowthSystem.
4. Determinism: fixed step + seeded RNG; document that the original is non-deterministic.
5. Keep tunables in content: all numbers above come from prefab data or constants identified in code and are listed with their source.

## 14. Contradictions, uncertainty and gaps

- Spawn is free (no level decrement): based on exhaustive absence of `houseLevel` writes in spawner/OnSpawned code; real play (original game) could still show a visual counter change via growth/arrival only. High confidence for the decomp set analysed; the spawner `TrySpawnWarrior` async state machine was read only partly.
- Capture rule overshoot discarded: `Building.TryDoDamageFrom` sets level 0 on overflow; I did not find any later "level = leftover" assignment in `House.SetNewOwner` (high confidence), but a subclass could differ (Tower/Fortress `SetNewOwner` not diffed).
- `IsSpeedUpActive` spawn/speed multiplier applies only to Player-owned units/houses (PlayerType==0) per decomp; I did not verify whether AI gets the equivalent via `botActionDelay`.
- Soldier HP model (CLOSED, 2.5): `HP = Power * hitPoints` with `Power = sum((stat/0.1)*weight)`; remaining uncertainty is only (a) exact per-skin `Level` used by the bot/boss generators and the remote-config power targets (meta, P4/P5), (b) fallback branch when `WarriorParamsConfig` lookup fails (decompiler garbled; assumed same numbers). Embedded remote-config JSON in `stringliteral.json` are DEFAULTS; live servers can override.
- Radii (mostly CLOSED, prefab): soldier/tank body SphereCollider r 0.35, artillery body box 0.71x0.72x0.84, tower trigger r = 2.4 x {1.6,2.5,3.4}, fortress gun capsule r 3.0 (local, parent scale not applied), artillery detect 4.0, rocket-tower blast 1.15, artillery/hail/burning-earth blast 1.0, capture-rocket blast 3.0 (warriors only), burning-earth zone capsule r 0.75. NOT applied: parent transform scales for nested colliders (fortress guns, rage skill boxes), and the exact radius of unit-vs-building contact (houses use box colliders `Hit` 0.6 / `Building` 1.5 / `Selecable` 2.5; which one the soldier trigger tests was not traced).
- `coefficientByRocketTowerAttack` (CLOSED): AI rocket-tower target weight only (5.7). The five upgrade types TowerSpeed/TowerRadius/RocketTowerSpeed/RocketTowerRadius/BuildingsSpawnSpeed are power-only (no in-match effect, section 9; dump scan, not exhaustive vs reflection).
- Still open: capture-rocket tower charge accounting (points per tick, lives in the undecompiled `CaptureRocketTowerUiView`; 5.8); boss damage-from-power table and boss power curve (`IBossLevelConfigController`, `bossDurability` semantics, 8.9); artillery volley fires at every in-range target (read from control flow, unverified in play, 5.9); Dash/Flamethrower/Annihilation zone sizes are local collider sizes (parent scales unknown); BurningEarth/Hail/LaserCannon trigger conditions read from `SpawnBullet`/`SetSkillCanBeActivatedState` only (no behavioural confirmation); the live game's rage cap (task brief said 35% player / 50% bot, the embedded default config says 30 / 200).
- Way curvature (CLOSED, 3.3): straight 2-point path in normal levels; Bezier auto-smoothing of a drawn polyline in Draw levels (anchor every >=1.5 units). Still unread: `GetPositionOnLine`, `SetEndBuilding`/`CheckBlock` edge cases and the draw-mode release/validation rules.
- Level-JSON legacy blocks (`L, ML, Id, Position, BuildingsType` upper-case keys; 593 houses) duplicate the new schema; I treated them as legacy.
- Decompiler caveats: arrays/struct fields show as raw offsets (mapped by `p3_fm.py`), virtual calls as vtable slots (I identified `+0x2c8` = `SetNewOwner`, `+0x188` = way cancel by usage), `rt_*` runtime helper names are guesses (decomp/README.md).
