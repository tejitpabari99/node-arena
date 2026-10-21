# 04 - Tower War AI / bots teardown (v1.29.3)

Scope: how the enemy AI decides and when, how level JSON drives it, how bot strength is scaled (campaign, daily, PvP, boss, challenge tower, arena, festival), what "fake multiplayer" is, determinism, and how this maps onto `packages/bots`. Direction P4 of the Tower War teardown. Sources: `dump.cs` = `/root/projects/tower-war/_extract/il2cpp/dump.cs`; `decomp/` = `/root/projects/tower-war/_extract/decomp/` (Ghidra output; class dirs `Game.Main.Player.*`); levels = `/root/projects/tower-war/_extract/assets/defaultlocalgroup_assets/TextAsset/`; RC = `/root/projects/tower-war/_extract/assets/data_unity3d/TextAsset/saykit_mlltrna_1.29.3_98@resourcesassets.json` (the file was named `saykit_mlltrna_1.29.3_98.json` when this research started; somebody renamed it with an `@resourcesassets` suffix during the session, so older scripts using the short name break).

Evidence levels used below: **[decomp]** read from decompiled C (and for the contentious points checked against raw AArch64 disassembly at the RVAs given), **[dump]** from `dump.cs` field/method signatures, **[data]** from level JSON / RC / assets, **(inferred from names)** only from identifiers, **not found**.

Pseudocode below is my own description of the decompiled logic; no decompiled code is copied. Re-derive with `/root/projects/tower-war/_tools/decomp.sh -f <patterns>` (see section 13).

---

## 0. Executive summary

1. The campaign AI is **tiny**: one timer, one action per tick. Every `ActionDelay` seconds it tries, in this order, (a) retract finished rocket-tower aims, (b) attack: take every non-own building (neutrals, other AIs, the human, resource piles) sorted by ascending "effective house level", and for the first target for which a *random* free-slot own house has a valid straight line, draw it; (c) only for behaviour type 0: move a railway tower, then (d) "defense": draw a line from a random free house to the nearest own building. It never cuts lines (the only AI-initiated destruction is rocket-tower aim retraction and the optional "useless attack" switch). It does not look at troop flow, distance (except path validity), or owner identity. [decomp: `DefaultBehavior.UpdateBehavior/Attack/Defense`]
2. `BT` (AiBehavior) is **not** a personality: 1 (Defense) and 2 (Random) are identical to each other and are a *subset* of 0 (Attack): they run only step (b). Type 0 adds railway moves and the nearest-own-building reinforcement. [decomp: `DefaultBehavior.UpdateBehavior`; dump.cs:L155120]
3. The "reaction delay" (`MinRD/MaxRD`) is only read in the under-attack handler, and as compiled that handler has an owner check that looks inverted (it exits unless the *attacking line's origin* is owned by the AI itself), so the reaction path appears **inert** in 1.29.3. Confidence medium-high (asm verified, same pattern in the boss copy). [decomp+asm: `AiPlayerController._OnHouseUnderAttack_d__57.MoveNext`, RVA 0x304C9B4]
4. Scripted AI (level JSON `AiDS/AiCWS/AiRM/AiSC`) is a **single ordered queue** indexed by `I` across the four lists; steps run sequentially; when the queue is empty the AI falls into the default behaviour for the rest of the level. Step "create way" has a built-in fallback (any free non-rocket own building if the authored own house is gone or the line is invalid). [decomp]
5. Difficulty is **not** in the AI rules: it is a per-seat *power percentage* (`dynamic_complexity`, 80..200 for Common) applied to the bot's unit stats: bot power = human combat power x percent / 100, split over 3 unit types. Percent moves +step on win (growing by `increaseStep` on streaks), -step on a loss (not for quick losses < 15 s), gated to player level >= 10. Challenge Tower, Arena, Boss and Festival use their own formulas (section 7). [decomp + RC]
6. All AI randomness is `UnityEngine.Random` (unseeded, frame-rate-timed): no replay determinism. Only skin picks use a seeded `System.Random`. [decomp]

---

## 1. Class map (what exists)

| Class | dump.cs | Role |
|---|---|---|
| `AiPlayerController : PlayerController` | L134874 | per-AI player: settings, behaviour queue, helpers (free houses, enemies, validity), under-attack handler, railway moves |
| `Behavior` (abstract) | L135230 | `StartBehavior/UpdateBehavior/StopBehavior`, `_pauseTime`, `OnBehaviourCompleted` |
| `DefaultBehavior` | L135423 | the AI proper (timer + attack/defense/railway/rocket logic) |
| `CreateWayBehavior` | L135297 | scripted: one authored line after `attackDelay` |
| `DelayBehavior` | L135507 | scripted: wait `delay` |
| `RailwayMoveBehavior` | L135588 | scripted: move a rail building to a path point |
| `AiActionStepCreator` + `AiStepAction` | L135053 / L135143 | scripted: tree of delayed steps (create way / capture house) |
| `RailwayBehavior` | L135555 | path-point search + `IsPathClear` raycast for railway AI |
| `UselessAttackBehaviour/Condition/Action/FocusAction/SwitchAction/JsonValues` | L135690 / L135736 / ... / L135811 | optional anti-stalemate behaviour (disabled in RC) |
| `Comparators` | (Game.Main.Player) | `CompareByLevel`, `CompareByDefense`, `CompareByDistance`, `CompareByArenaLeaderboardView` |
| `IAiAttackController` / `IAiAttackRailwayController` | L136826 / L136874 | the AI's capability interface (13 + 5 methods) |
| `BossPlayerController` | L136104 | separate boss AI + `CapturedByBossBuildingsController` (L170995) reusing the default AI for captured buildings |
| `AiPlayersSavedJsonValues` + step value classes | L144503, L144082, L144323, L144352, L144429, L144474 | level JSON model |
| `LevelsComplexityService`, `LevelComplexityParameters`, `LevelsComplexityStaticGrowService` | L104919, L104650, L104548 | dynamic / static difficulty |
| `BaseLevelManager` (+ Common/Daily/Pvp/Arena/ChallengeTower/Boss/Festival managers) | L145954 | creates bot combat members per level type |
| `CombatManager` (Game.Main.Combat) / `CombatService` | L165490 / L110356 | builds bot unit stats from target power |
| `FakeMultiplayer.Opponent`, `OpponentDataManager`, `FakeMultiplayerSelectPopUp*` | L154852.., L35253.. | fake PvP lobby |

The AI is **component-based on one GameObject**: `AiPlayerController` adds `DefaultBehavior`/scripted `Behavior` components at runtime (`GetNextBehavior`, `CreateBehavioursFromJsonData`).

---

## 2. Controller lifecycle and the behaviour queue

Files: `decomp/Game.Main.Player.AiPlayerController/{Init,SetDataFromJson,InitAiBehaviour,CreateBehavioursFromJsonData,GetNextBehavior,OnBehaviorCompleted,OnLevelStateChanged,UpdateBehavior,SetBotDelay,AddPauseAfterUselessAction}.c`.

```
construct (.ctor):  actionDelay=1.0  reactionDelayMin=1.0  reactionDelayMax=2.0  defaultActionDelay=1.0
                    ValidBuildingTypesToCreateWay = [House(0), SelectableFortess(7), Trolley(10)]
SetDataFromJson(json, uselessJson):  color, actionDelay<-AD, reactionMin<-MinRD, reactionMax<-MaxRD, behaviorType<-BT
Init():  defaultActionDelay = actionDelay;  subscribe global "botActionDelay" -> SetBotDelay;
         lockAnimationSpan = cfg.lockAnimationTime;  railwayPauseTime = cfg.aiPauseAfterRailwayMove + cfg.aiMoveDuration + 2*cfg.lockAnimationTime;
         InitInitialHouses() (subscribe HouseUnderAttack on each own building)
OnLevelStateChanged(state):
   Loaded(0):  InitAiBehaviour();  stop any running update subscription;  StopBehavior(current);  stop useless
   Started(1): InitAiBehaviour() if not done;  (re)subscribe per-frame UpdateBehavior
   other (Win/Lose/Paused/...): drop subscription, StopBehavior(current), stop useless
InitAiBehaviour():  CreateBehavioursFromJsonData();  queue = Queue(presetBehaviorsSequence);  GetNextBehavior()
GetNextBehavior():
   if queue empty:  current = new DefaultBehavior{ActionDelay=actionDelay, BehaviorType=behaviorType}
                    and, if uselessAttack JSON present and enabled, new UselessAttackBehaviour
   else:            current = queue.Dequeue()
   on completion of current -> GetNextBehavior()   (DefaultBehavior never completes)
per frame (only while the AI owns >= 1 building):  uselessAttack.Update(dt);  current.UpdateBehavior()
SetBotDelay(d): actionDelay = (d >= 0 ? d : defaultActionDelay)      // dev override, see 10
```
Cites: ctor defaults [decomp `AiPlayerController/.ctor.c`: 1.0 at +0xC4/+0xC8, 2.0 at +0xCC, 1.0 at +0x134; the 3-element `BuildingsType[]` is `[0, 7, 10]`]; copy of JSON fields [decomp `SetDataFromJson.c`]; queue handling [decomp `GetNextBehavior.c`]; per-frame update only when `Buildings.Count > 0` [decomp `UpdateBehavior.c`]. `ValidBuildingTypesToCreateWay` means houses, selectable fortresses and trolleys can start lines; towers never do; rocket towers use a separate aim-path call (`CreateWayFromRocketTower`).

`CreateBehavioursFromJsonData` (decomp `CreateBehavioursFromJsonData.c`): requires all four lists non-null (the data always has them, possibly empty); allocates `Behavior[ DS + CWS + SC + RM ]`; each entry is placed at index `I` of its source object (`DelayBehavior`, `CreateWayBehavior`, `AiActionStepCreator`, `RailwayMoveBehavior`). Building ids (`OHId/THId/BId`) are resolved against the level building list by `Building.BuildingId` (`FindBuildingById`, `FillAiStep`). **Data check:** in all 4,043 AI/boss entries the `I` values across the four lists are unique and contiguous from 0 (`_tools/p4_ai_stats.py`), i.e. one global sequence.

### Time base
`DefaultBehavior` accumulates `Time.deltaTime` per frame (frame-rate granularity, scaled by `Time.timeScale`, so the in-game speed-up also speeds AI); `AiStepAction` start-delays use `DOVirtual.DelayedCall(..., ignoreTimeScale=true)` (unscaled); reaction delay uses `UniTask.Delay` (not decoded for time scale). [decomp]

---

## 3. The default decision loop (DefaultBehavior)

Files: `decomp/Game.Main.Player.DefaultBehavior/*.c`, lambdas in `Game.Main.Player.DefaultBehavior.__c*`.

```
UpdateBehavior():                                   // called every frame
  if pauseTime > 0:  pauseTime -= dt; return        // pause only comes from useless-attack, 5.
  if timer < ActionDelay:  timer += dt; return
  timer -= ActionDelay                              // carry the remainder -> fixed cadence
  if TryToDestroyWayToTower(): return               // stub: loops over normal-create-way buildings and always returns false
  free   = ai.GetFreeWaySelectableBuildings()       // own SelectableBuildings with FreeWaysCount > 0
  items  = ai.GetEnvironmentItems()                 // level buildings of type Resource with level > 0
  enemies= ai.GetEnemiesHouses().ToList()           // ALL level buildings whose Owner != this AI
  TryToDestroyPathFromRocketTowers()                // every tick, free action: rockets with a used aim retract it
  switch BehaviorType:
     1 (Defense), 2 (Random):  Attack(free, items, enemies)
     0 (Attack):  if Attack(...) return;  if TryMoveTowerOnRailway(enemies) return;  Defense(free)
```
[decomp `UpdateBehavior.c`; interface slots 7/9/10 resolved against dump.cs:L136826]. First decision happens `ActionDelay` seconds after the behaviour is created (timer starts at 0).

### 3.1 Attack(free, items, enemies) -> bool (= "a line or rocket was issued")
[decomp `Attack.c`, helpers `Comparators/CompareByLevel.c`, `AiPlayerController/CheckCreateWayCondition.c`]
```
if free is empty: return false
targets = enemies + items;  sort ascending by CompareByLevel (List.Sort = unstable introsort -> ties arbitrary)
for target in targets:
   if target sits on a railway currently "in control"(railway model state != 0): continue     // CheckIfBuildingOnRailwayInControlNow
   candidates = copy(free)
   while candidates not empty:
       src = candidates[ Random.Range(0, n) ]                        // uniform, unseeded
       if src.type == RocketTower:  if TryCreateWayFromRocketTower(src, targets): return true;  else remove src
       elif src.HasWayWith(target): remove src                       // symmetric "has a line with"
       elif src is on a railway and CheckIfHouseOnRailwayAndCreateWayAvailable(src):
                if railway.TryCreateWay(src, target, enemyRailway): return true;   remove src
       elif ai.CheckCreateWayCondition(src, target): ai.CreateWay(src, target); return true
       else remove src
return false
```
Key facts:
- **Effective level key** (`CompareByLevel`): `key = houseLevel`, except when `IsSpecial` (= house `WT != 1`, i.e. attack/artillery houses: `House.get_IsSpecial` returns `warriorType != 1`, decomp `Game.Main.Buildings.House/get_IsSpecial.c`) the key is `round-half-even(level / 1.5)`. Ascending, so the AI hits the **weakest** (lowest level) non-own building first, and special houses look 1.5x weaker than they are. No distance term, no troop-flow term, no owner preference (human, other AIs and neutrals are all "enemies"; resource piles are also in the list).
- **Source choice is uniform random** among free-slot own houses, retried per target until one has a valid path. There is no "closest source", no garrison threshold.
- `CompareByDefense` (used by Defense list ordering and the under-attack handler) puts attack houses (`IsAttackHouse`, WT 2) first; since both consumers then pick at random the order is effectively unused in `Defense`. [decomp `CompareByDefense.c`]
- One success ends the tick (one new line per `ActionDelay`).

### 3.2 `CheckCreateWayCondition(src, target)` - the validity function
[decomp `AiPlayerController/CheckCreateWayCondition.c`; `LayerMaskContainer` asset `defaultlocalgroup_scenes/MonoBehaviour/Game.Main.Common.LayerMaskContainer/LayerMaskContainer_920@main.json`]
```
valid = src.type in ValidBuildingTypesToCreateWay            // House, SelectableFortess, Trolley
     && !src.HasWayWith(target)                              // no existing line either direction in src's list
     && src.FreeWaysCount > 0
     && src.Owner == this AI
     && !target.isMoving                                     // Building field +0x6C (railway/trolley in motion)
     && corridor clear:  BoxCastAll from src.WayPosition toward target.WayPosition,
            halfExtents = boxHalfSize = (0.19, 0.30, 0.19),  layers = buildingLayer | obstacleLayer,
            every hit must be on buildingLayer AND belong to src or target   (any obstacle or third building => invalid)
```
- Rivers (`waterLayer`) are **not** in the mask: the AI will try lines across rivers; `PlayerController.CreateWay` can still reject a blocked way (`WayBaseController._isBlocked`).
- `AiPlayerController.CreateWay(src, target)` builds the way via the way factory (or reuses `target.GetWayWith(src)` when a setting is false), calls `PlayerController.CreateWay` (returns true on success), and returns the **negation**; when `PlayerController.CreateWay` fails it registers the way with the useless-attack tracker. [decomp `AiPlayerController/CreateWay.c` + asm RVA 0x3047B94: `tbnz` then `bic`]. `Attack` ignores that return value.

### 3.3 Defense(free) (type 0 fallback)
[decomp `Defense.c`, `TryCreateWayForDef.c`, lambdas `__c/_Defense_b__25_0.c` (`x is not TrolleyBuilding`), `__c__DisplayClass26_0/*`]
```
cand = free.Where(not Trolley);  if empty return
ownAll = copy of ai.Buildings;  sorted = cand sorted CompareByDefense
while sorted not empty:
    d = sorted[ Random.Range(0,n) ]
    others = ownAll.Where(b != d)
    TryCreateWayForDef(d, others):  sort others by distance(WayPosition) to d ascending;
         first = others.FirstOrDefault(o => CheckCreateWayCondition(d, o));  if found: CreateWay(d, first); return true
    remove d from sorted and ownAll
```
= "reinforce the nearest own building (any own building type) that is reachable and not yet linked". It only runs when `Attack` produced nothing (no free slot, or no valid pair).

### 3.4 Rocket towers
- `TryToDestroyPathFromRocketTowers`: for each own rocket tower returned by `GetRocketTowersWithPath` (type 3 and `FreeWaysCount == 0`, i.e. an aim is outstanding) call `RocketTower.TryToDestroyLine()` each tick. [decomp `TryToDestroyPathFromRocketTowers.c`, `AiPlayerController/_GetRocketTowersWithPath_b__34_0.c`]
- `TryCreateWayFromRocketTower(tower, targets)`: skip if the tower's used flag (+0x1D9) is set; target = `argmax over targets of (coefficientByRocketTowerAttack x houseLevel)` (strict `<` replacement, resources skipped as "best" until a non-resource is found); if the winner is a resource: no fire but returns true; else `CreateWayFromRocketTower(tower, winner)` and return true. [decomp `TryCreateWayFromRocketTower.c`]. `coefficientByRocketTowerAttack`: Fortress prefab 3.0 per doc 03.

### 3.5 Railways / trolleys (only if the level has rails)
- `TryMoveTowerOnRailway(enemies)` (type 0 only): for each tower on a railway with no houses in its attack radius (`GetTowerOnRailwayWithoutTarget`: `IsRailway && Tower.HousesInRadiusCount == 0`), sort enemies by distance to the tower and ask `RailwayBehavior.TryFindAttackPositionForTower` for the first path point from which an enemy lies inside the tower's attack radius; `MoveRailway(rail, pathValue)`; returns true after the first success. [decomp `TryMoveTowerOnRailway.c`, `RailwayBehavior/TryFindAttackPositionForTower.c`]
- `RailwayBehavior.TryCreateWay/TryCalculatePositionForWayTo/IsPathClear`: move the rail to the path point nearest the line origin that has a clear `BoxCastNonAlloc` (RAYCAST_DISTANCE const 100, dump.cs:L135558) then create the line. Details of the geometry not transcribed (niche, rails in ~5-17% of late levels, doc 02).
- Timing constants: `RailwayConfig_5315@sh.json`: `_humanMoveDuration 0.2`, `_aiPauseAfterRailwayMove 0.5`, `_aiMoveDuration 1.5`, `_lockAnimationTime 0.7` (`/root/projects/tower-war/_extract/assets/defaultlocalgroup_scenes/MonoBehaviour/Game.Main.Settings.Buildings.RailwayConfig/RailwayConfig_5315@sh.json`). `AiPlayerController.Init` derives `_railwayPauseTime = aiPauseAfterRailwayMove + aiMoveDuration + 2 x lockAnimationTime` (decomp `Init.c`: sum of +0x1C,+0x20,+0x30,+0x30 = 0.5+1.5+0.7+0.7 = 3.4 s). `RailwayMoveBehavior` waits that pause after issuing a move.

### 3.6 What the default AI does NOT do (important for porting)
No line cutting (`TryToDestroyWayToTower` is a no-op stub that always returns false), no look at troop counts/flow, no threat model, no economy awareness, no cooldown or commitment per line, no memory. Over time all slots fill with lines to the weakest targets; lines persist until the sim removes them (capture, level-drop slot loss) or the rocket/useless-attack paths act.

---

## 4. Under-attack reaction (and why it is probably inert)

Event: `WayBaseController.CreateNormal` calls `Building.OnHouseUnderAttack(endBuilding, way)` when `IsAttackWay` (end type != Resource, both ends exist, owners differ). The AI subscribes `HouseUnderAttack` on **its own** buildings (`InitInitialHouses`, `OnBuildingAdd`). [decomp `Game.Main.Ways.WayBaseController/CreateNormal.c`, `get_IsAttackWay.c`, `AiPlayerController/InitInitialHouses.c`]

Handler (async, `AiPlayerController._OnHouseUnderAttack_d__57.MoveNext`, RVA 0x304C9B4; state machine fields dump.cs:L134829: `way`, `attackedBuilding`, `<attackBuilding>5__2`):
```
other = (way.House1 == attacked) ? way.House2 : way.House1       // enemy line origin
if Random.value < 0.5: return                                      // 50% of events ignored
await Delay( Random.Range(reactionDelayMin, reactionDelayMax) )    // the ONLY use of MinRD/MaxRD
if ai.destroyed or ai.SelectableBuildings.Count == 0 or !way.exists: return
if attacked.HasWayWith(other): return                              // already linked to the attacker
if !other.HasWayWith(attacked): return                             // attack line gone
if other.Owner != ai: return          // <-- as compiled (asm 0x304CE5C..0x304CE90: op_Inequality then tbnz exit)
switch attacked.type:
   House(0) / SelectableFortess(7):   // "counter-attack" branch
        [if ChangedConstants.isDrawWay (SimpleVariableValue<bool>, ChangedConstants+0x58, dump.cs:L128610): validity check + create a fresh way object]
        if attacked.FreeWaysCount > 0:  PlayerController.CreateWay(way, attacked, other)           // line attacked -> attacker origin
        else if attacked.GetDefenseWay() exists: destroy it (frees a slot) and, if a slot is now free, CreateWay(way, attacked, other)
        else fall through to the reinforce branch
   RocketTower(3):  50%: aim at other
   everything else (and fallthrough): candidates = SelectableBuildings with a free slot, sorted CompareByDefense;
        first candidate that is a rocket tower and unused -> aim at other; first that passes CheckCreateWayCondition(candidate, attacked)
        -> CreateWay(candidate, attacked)                                                         // REINFORCE the attacked building
```
Intent (from the structure): "respond to an attack on my building after a human-like delay: counter-attack the origin, else free a slot by dropping a defense line, else reinforce from free buildings, or fire rockets". When `isDrawWay` is false the counter branch reuses the *enemy's* way object as the creating way, which is nonsensical, another sign this is vestigial code. The owner guard compares the owner of `other` (the enemy line origin, never the AI) with the AI and exits on difference, so as compiled the handler exits every time unless ownership changed during the delay (which also destroys the line, failing the second guard). The identical guard exists in the boss copy (`Game.Main.BossEvent.CapturedByBossBuildingsController._OnHouseUnderAttack_d__23.MoveNext`, RVA 0x31C29BC, asm 0x31C2EB0..0x31C2EE8). **Treat as inert**; if we want the intended behaviour implement it with the guard inverted (documented above). Uncertainty: cannot run the game; a different caller of `OnHouseUnderAttack` would change this (none found in the decompiled corpus).

---

## 5. "Useless attack" behaviour (anti-stalemate, disabled by default)

[dump.cs:L135690-L135872; decomp `Game.Main.Player.UselessAttack*`; RC `game_settings.bot_useless_attack_behaviours`]

Created by `GetNextBehavior` only when the JSON object exists and `isEnabled`. **RC value: `{"focusTime":10,"isEnabled":"false","levelDelta":5,"switchTime":10,"maxNewLineDelay":3,"minNewLineDelay":1,"pauseAfterNormalAction":2,"pauseAfterUselessAction":2}`** -> disabled. Local default string in the binary (stringliteral): `focusTime 5.0, levelDelta 15, switchTime 10.0, minNewLineDelay 1.0, maxNewLineDelay 3.0, pauseAfterNormalAction 2.0, pauseAfterUselessAction 2.0` (`stringliteral.json`, no `isEnabled`).

Mechanics (decomp):
- `AiPlayerController.CreateWay` calls `RegisterUselessAttackAction(way)` when `PlayerController.CreateWay` returned **false** (see 3.2). The register routine: for non-attack ways it just sets every condition's `_pauseActionTimer = pauseAfterNormalAction`; for an attack way it identifies (ownHouse = the end owned by this AI, must be a `House`; focus = other end), reuses an existing condition for that focus or creates `UselessAttackCondition(json, ownHouse, focus)`, hooks `way.WayDespawned` to drop it.
- `UselessAttackCondition.UpdateTimer(dt)`: `_focusTimer += dt; _pauseActionTimer -= dt; if pause <= 0: (focusDone ? PerformSwitchAction : PerformFocusAction)`.
- `CheckHouseLevelConditionComplete`: `startLevel - levelDelta <= focus.level <= startLevel + levelDelta` (focus level has not moved, i.e. a stalemate).
- Focus: after `focusTime` with the stalemate condition: spawn a `UselessAttackFocusAction` for every *other* own house (`GetHouses().Where(...)`) with random start delay in `[minNewLineDelay, maxNewLineDelay]` -> each draws a line to the focus house if valid ("pile on").
- Switch: after `switchTime` with the condition still true: destroy the `ownHouse->focus` line and redraw from `ownHouse` to the other enemies sorted by `CompareByLevel`, first valid.
- `AddPauseAfterUselessAction` adds `pauseAfterUselessAction` to the current behaviour's `_pauseTime` (freezes the default timer).

Not reachable with the shipped RC; level JSON has no way to enable it.

---

## 6. Scripted AI (level JSON `AiDS`, `AiCWS`, `AiRM`, `AiSC`)

### 6.1 JSON model [dump]
`AiPlayersSavedJsonValues` (dump.cs:L144503): `PT, PC, BD, AD (float), MinRD (float), MaxRD (float), BT (int), AiDS[], AiCWS[], AiRM[], AiSC[]`; boss variant keys `B_AD,B_MinRD,B_MaxRD,B_BT,B_AiDS,B_AiCWS,B_AiSC` (no `B_AiRM`) on `b_p` (data: `LevelViewBoss*`). Step classes: `DelayStepBehaviourSavedValues {I, D}` (L144474), `CreateWayStepBehaviorSavedValues {I, OHId, THId, AD}` (L144429), `RailwayMoveStepBehaviorSavedValues {I, TPPI, BId}` (L144082), `AiActionStepCreatorSavedValues {I, AiSA}` (L144323) with `AiStepActionSavedParams {GT, OHId, THId, DS, OS[]}` (L144352; `OS` = next steps). `AiBehaviourGoalType` (L135092): `None 0, CreateWay 1, CaptureHouse 2`. `AiBehavior` (L155120): `Attack 0, Defense 1, Random 2`.

### 6.2 Execution semantics [decomp]
The four lists are merged into one queue ordered by `I`. Each queue element runs to completion before the next. After the last, the default behaviour (section 3) starts and never ends.

| Behaviour | Completes when | Detail (decomp) |
|---|---|---|
| `DelayBehavior{D}` | `D` s elapsed (dt accumulate) | `StartBehavior` resets timer; completes when timer >= D |
| `CreateWayBehavior{OHId,THId,AD}` | after `AD` s then one `Attack()` | defective = authored own house's `initialOwner != this AI` -> completes immediately (skipped). `Attack`: no-op if target null; if own house alive and is RocketTower and target not a resource: fire rocket (skip if used); else if `CheckCreateWayCondition(own,target)` -> `CreateWay`. **Fallback** if own house gone or check fails: if AI has < 2 buildings stop; else `GetFreeWaySelectableBuildingsExcept([own, target], [RocketTower])` and take the first candidate (list order = building order) that passes `CheckCreateWayCondition(cand,target)`; draw it and stop. (`CreateWayBehavior/{Awake,CheckDefect,StartBehavior,UpdateBehavior,Attack}.c`) |
| `RailwayMoveBehavior{BId,TPPI}` | skipped (completes at once) if no controller / wrong railway state; else issues `MoveRailway(rail, GetPathValue(pathPoint[TPPI]))` once and completes after the rail pause (3.5) | `RailwayMoveBehavior/{Awake,UpdateBehavior}.c` |
| `AiActionStepCreator{AiSA}` | when **every node** of the step tree has completed (`stepsCount = descendants + 1`, decremented per node completion) | `StartBehavior/UpdateBehavior/OnStepComplete` |

`AiStepAction` node (`{GT, OHId, THId, DS, OS[]}`; decomp `AiStepAction/*.c`):
```
StartAction():  if ownHouse set and ownHouse.Owner != AI: ActionComplete(); return      // house lost -> skip
                schedule OnDelayComplete after DS seconds (DOVirtual.DelayedCall, unscaled)
OnDelayComplete(): if ownHouse set and not owned: ActionComplete()
   GT None(0):        ActionComplete()
   GT CreateWay(1):   Attack(); ActionComplete()
   GT CaptureHouse(2):Attack(); start 1 s poll coroutine (CHECK_CAPTURE_HOUSE_TIME = 1, dump.cs:L135162):
                         every 1 s: if own house not owned OR target destroyed/owned by AI: ActionComplete()
                         (a null target completes immediately)
ActionComplete():  fire OnStepCompleted;  for each child in OS: SetPlayer(...); child.StartAction()     // children start together
Attack(): same validity/fallback as CreateWayBehavior (own house check; if AI has 1 building and own house alive: return)
```
So `OS` is "do these next, in parallel, each with its own `DS`, after this node (or after capture for GT 2)". A GT 2 node can block the whole queue until the capture happens (bounded only by the level).

### 6.3 Corpus statistics (all level files; `/root/projects/tower-war/_tools/p4_ai_stats.py`)
- 4,043 AI/boss player entries: LevelView 2,480; ChallengeTower 365; PvP 454; Draw 289; Terminator 153; Arena 155; Daily 111; Boss 32; Test 4.
- Presence combos (DS,CWS,RM,SC): none 2,046; SC only 1,364; CWS only 605; DS+RM+SC 18; DS+CWS 6; DS+RM 4. Hence scripted `AiCWS` appears only in LevelView/Daily; ChallengeTower/Arena/Draw/PvP/Terminator use only `AiSC` (single `GT 1` first step mostly).
- Step trees: 1,398 `AiSC` roots; tree depth 1: 1,398 nodes, depth 2: 937, depth 3: 160, depth 4: 19, depth 5: 2. `GT` totals: 1 CreateWay 2,357, 2 CaptureHouse 154, 0 None 5.
- Campaign list (RC `levels`, 1,024 ids resolved here; doc 02 counts 1,012): scripted-AI levels per 100-level bucket 62/64/65/75/64/48/47/53/69/64/10 = 621 of 1,024 (doc 02 states 601 of 1,012; denominators differ, not reconciled). Mean `AD` per bucket 12.75, 9.37, 11.10, 8.64, 8.28, 6.95, 8.44, 7.38, 7.52, 7.49, 7.13 (outliers: 700 on `LevelView 936_ES`, 250, 200); median 6-8 s. Mean `AD` by AI count in a level: 1 AI 11.43, 2 AIs 8.55, 3 AIs 8.02.
- Scripted AI size: mean 1.3 steps per scripted AI (max 8). `AiDS.D` 1..25 s (mean 8.41, n 38); `AiCWS.AD` 0.1..60 s (mean 6.18, n 495); `AiSA.DS` 0..50 s (mean 5.82, mode 5.0 x240, 4.0 x184, 6.0 x171, n 1,182).
- First campaign levels (position, AI tuples `(AD, MinRD, MaxRD, BT, #AiSC, #AiCWS)`): L1 `(12,1.5,3,0,0,0)`, L2_AB `(2,1,2,0,0,0)`, L3_AB 3 AIs `(5,1,2,0,0,1)` each, L4 2 AIs `(4,...)`, L8_ES `(30,1,2,0,1,0)` (the first scripted `AiSC`), L15/L16 `(15,...)`. Large `AD` (>= 30; 48 levels) is how the designers make an AI nearly passive (tutorial/"let the player breathe"); `AD < 2` occurs once.
- `BT` over all entries: LevelView 0 x2,261 / 2 x203 / 1 x16; every other family is >= 99% type 0. Among scripted AIs: BT 0 857, 2 x120, 1 x8.

---

## 7. Parameter reference

### 7.1 AI settings (level JSON, per AI player)
| Key | Field | Default (ctor, decomp `.ctor.c`) | Data range | Effect |
|---|---|---|---|---|
| `AD` | `actionDelay` (s) | 1.0 | 1.7..700 (campaign 2-15 typical; `5` x241, `6` x206, `2` x199, `7` x178, `8` x154, `10` x135 per doc 02) | cadence of `DefaultBehavior` decisions |
| `MinRD` | `reactionDelayMin` (s) | 1.0 | 1.0 in 90%; 2, 2.5, 3, 4, 8, 10, 99 outliers | lower bound of under-attack delay (effectively unused, sec. 4) |
| `MaxRD` | `reactionDelayMax` (s) | 2.0 | 2.0 in 90% (3, 4, 5, ..., 11) | upper bound |
| `BT` | `behaviorType` | 0 | 0 / 1 / 2 | 0 = attack + rail + defense; 1,2 = attack only |
| `AiDS/AiCWS/AiRM/AiSC` | scripted queue | empty | see 6 | scripted prefix |

### 7.2 Constants found in code/assets
| Constant | Value | Source |
|---|---|---|
| Valid line-start building types | House 0, SelectableFortess 7, Trolley 10 | decomp `AiPlayerController/.ctor.c` |
| Slot thresholds (free ways) | 1 slot if level < 10; 2 if 10 <= level < 30; 3 if >= 30 | doc 03 (`House/SetAvailableWays.c`) |
| Path corridor | box half size (0.19, 0.30, 0.19) | `LayerMaskContainer_920@main.json` |
| Capture poll | 1.0 s | dump.cs:L135162 `AiStepAction.CHECK_CAPTURE_HOUSE_TIME` |
| Special-house level discount | /1.5 round-half-even | decomp `CompareByLevel.c` |
| Reaction roll | 50% ignore | decomp `OnHouseUnderAttack.MoveNext` (`Random.value < 0.5`) |
| Railway raycast | 100 | dump.cs:L135558 `RailwayBehavior.RAYCAST_DISTANCE` |
| Railway timings | 0.2 / 0.5 / 1.5 / 0.7 s | `RailwayConfig_5315@sh.json` |

---

## 8. Difficulty scaling

Pipeline: `BaseLevelManager.CreateInGameBotData` -> (static grow if enabled, else) `CreateInGameBotDataFromComplexity` -> `CreateCombatMembersData` -> `CombatManager.CreateInGameBotCombatMember` -> `CombatService.CreateBotCombatMember`. [decomp `Game.Main.Levels.BaseLevelManager/*.c`, `Game.Main.Combat.CombatManager/*.c`, `Game.Services.Combat.CombatService/*.c`]. The level JSON never carries power; bot **building** levels come from the level, bot **unit** stats from here.

### 8.1 Per-seat percent
```
for each AI colour (Green, Red, Yellow; index 4 Gray/neutral skipped):
    pct = GetRandomPowerBound(complexity param of this LoadLevelType) :
          roll = Random.Range(0,3)                       // {0,1,2}
          v = Current;  if roll==0: v += RandomBoundValue;  if roll==1: v -= RandomBoundValue
          pct = clamp(v, BottomBound, UpperBound)
    (no complexity parameter -> pct = 100)
    member = CreateInGameBotCombatMember(levelDifficult = pct, playerPower P, maxDisplayPower, isNoLimits, levelType)
```
[decomp `BaseLevelManager/CreateCombatMembersData.c`, `GetRandomPowerBound.c` (asm confirms interface slots 7 = Current, 5 = RandomBoundValue, 2 = BottomBound, 1 = UpperBound, RVA 0x30B5C8C)]. Branch: if the complexity state is `Equal` and a previous bot set exists, existing members are reused; if `Decreased` they are updated toward the new target (`TryToUpdateExistCombatMembers` -> `CombatService.UpdateBotCombatMember`) instead of regenerated.

### 8.2 Bot unit power
`CombatService.CalculateMaxBotPower(levelType, P, D, pct, onlyThis)` [decomp]:
```
if GenerateUnitsPowerInProportion enabled for levelType (RC: all four disabled) -> proportion path
T = round(P / 100 * pct)                  // P = human player combat power (CombatManager.PlayerCombatMemberPower)
a, b = Random.Range(lo, hi) twice (ints), (lo,hi) = (30,36) if CombatMemberUnitsHpConfig.isEnabled (default literal true) else (23,44)
share = [a, b, 100 - (a+b)]  -> unit power = round(T*share/100) per unit type (Default, Attack, Artillery); same shares applied to the display power D
```
Then `CreateBotCombatMemberUnitData` picks, per unit type, a skin rarity = `Random.Range(playerRarity-2, playerRarity+2)` clamped to [1, max] (or the player's rarity when `IsUnitsRarityChangeLimited`), a random available skin of that rarity (`WarriorSkinsManager.GetBotMemberAvailableUnits`) and stacks modifiers (`BaseStatsModifiersData`, `BotAddArtefactsModifierData`, `BotRemoveArtefactsModifierData`, battle-banner) to reach the unit's target power. `bot_units_level_limit_config` caps bot unit levels by rarity: RC `{"Blue":20,"Gold":110,"Green":15,"Grey":10,"Relict":110,"Violet":25}`, `isEnabled true` (binary literal default Gold 30, Relict 100). `no_power_limits_for_bots` = 1 makes `IsNoPowerBotLimits` true for Common/Daily/PvP/Challenge (those manager getters read `config+0x34 > 0`; Festival getter not decoded); `BossLevelManager.IsNoPowerBotLimits` always true; `ArenaLevelManager` delegates to the arena service (`arenaConfig.isBotPowerLimits "true"`). Per-unit power formula (HP/attack from "power") is core-mechanics, not decoded here.

### 8.3 Dynamic complexity (Common/Daily/PvP/Boss)
RC `game_settings.dynamic_complexity` (`LevelComplexityParameters`, dump.cs:L104650):
| `levelType` | `step` | `bottomBound` | `upperBound` | `increaseStep` | `randomBoundValue` | enabled |
|---|---|---|---|---|---|---|
| Common | 10 | 80 | 200 | 0 | 0 | true |
| Daily | 10 | 80 | 1000 | 1 | 5 | true |
| PVP | 7 | 90 | 150 | 0 | 0 | true |
| Boss | 20 | 50 | 1000 | 1 | 5 | **false** |
`reLogInResetTime 86400`, `reLogInResetType 0`; `change_difficulty_delay 15`; `show_garage_after_level 7`, `enable_garage_after_level 10`.

`LevelsComplexityService` (decomp `Game.Services.LevelsComplexity.LevelsComplexityService/*.c`):
```
available = playerLevelIndex >= show_garage_after_level(7) && >= enable_garage_after_level(10) && both > 0   // i.e. from level 10
ChangeLevelComplexity(isOnVictory, type):
   victory:  Change(type, increase=true)
   defeat:   if type not in {ChallengeTower(3), Arena(4)}:
                 if change_difficulty_delay < 0: if type < 2 return          // delay disabled -> never decrease Common/Daily
                 else if type < 2 and secondsSinceLevelStart < change_difficulty_delay(15): return   // quick quit/loss is not punished
             Change(type, increase=false)
Change(type, inc):
   p = param(type); old = p.Current
   p.ChangeStep = inc ? p.ChangeStep + p.IncreaseStep : p.Step         // win streak grows the step; a loss resets it to Step
   if inc  and old < p.UpperBound: p.Current = clamp(old + p.ChangeStep, Bottom, Upper)   state=Increased
   if !inc and old > p.BottomBound: p.Current = clamp(old - p.ChangeStep, Bottom, Upper)  state=Decreased
   (else state set but value unchanged); persist (SavedLevelComplexity levelType/lastComplexityValue/lastComplexityStep); analytics event
ResetGameComplexityToBottomBoundAfterPowerChange(): on login after 86400 s, or when the highest selected unit rarity (per type) changed -> every param.Current = BottomBound (reason "power_changed")
```
Asm check of `Change`: RVA 0x2F609CC (slots 8/4 for increase step, 3 for decrease, 0xC SetChangeStep, 0xB SetCurrent; `SetCurrentComplexity` clamps to [Bottom, Upper] at `LevelComplexityParameters/SetCurrentComplexity.c`). Note `ChangeComplexityStep` initial value after a reset is whatever was saved; a first win uses `ChangeStep + IncreaseStep`. `ChangedConstants.PowerDifferenceToResetDifficult` = 50 (`get_PowerDifferenceToResetDifficult.c`, decomp) exists but no caller found in decompiled code.

Net behaviour for Common levels: bots start at 80% of the player's power (reset state) and climb +10 per win up to 200%, -10 per loss down to 80%; reset to 80% after a unit-rarity upgrade or a day. Level JSON building levels (AI start-level sum typically 1.3-4.2x the player's, doc 02) add on top.

### 8.4 Static grow (disabled)
RC `static_grow_complexity {"isEnabled":false,"growParameters":[{"applyLevelType":0,"initialCombatPower":50,"powerCoefficient":2.01,"dispersionCoefficient":0.0005,"decayCoefficient":-0.00006}]}`; binary default `initialCombatPower 250, powerCoefficient 2.0, dispersion 0.5`. `CalculateRaiseValue(x) = f(decay*x) * 25 * (g(dispersion*x) * 0.5 + 1)` with `f,g` Ghidra-unresolved math helpers (decomp `LevelsComplexityStaticGrowService/CalculateRaiseValue.c`; likely exp/sin, **not verified**). When enabled it replaces the dynamic path with a required-power curve. `levels_power_recommendation_config` (RC: bands 0-105 / 105-115 / 115-500, `minStep 10`, `maxStep 25`) only drives the UI recommendation (inferred from names).

### 8.5 Mode-specific scaling
| Mode | Bot power source | Evidence |
|---|---|---|
| Common / Daily / PvP | 8.1-8.3 with `Common`, `Daily`, `PVP` params; PvP percent 90..150 step 7; Daily 80..1000 | RC + decomp |
| Challenge Tower (`ChallengeTowerLevel*`) | levelDifficult fixed **100%**, target power = `ChallengeTowerService.GetLevelDifficultyReal(index)` = `round(RC levels[i].difficulty_real x scale[index])` (display uses `difficulty_fake x scale`). `scale` is a per-level-index float stored in `ChallengeTowerStorageData`; `IncreaseDifficultyScale` adds `challenge_tower_difficulty_step_factor` (0.004) to every scale from the next index up, capped at `challenge_tower_difficulty_max_factor` (5). Generated bot unit stats are **persisted** (`aiInGameData`) so retries face the same bots. RC: `difficulty_real` 300, 500, 700, 1000, 1300, 1500, 1800, 2000, 2500, 2700, ... (`challenge_tower_levels`), 100 levels, `challenge_tower_pass_*` | decomp `ChallengeTowerLevelManager/CreateInGameBotData.c`, `ChallengeTowerService/{GetLevelDifficultyReal,GetLevelDifficultyFake,IncreaseDifficultyScale}.c`, `ChallengeTowerStorageData/ChangeExistDifficultScale.c`; call site of `IncreaseDifficultyScale` not found (inferred: after a cleared level) |
| Arena | leaderboard opponent power: `power = round(playerPower x memberPersonalCoeff x memberPowerCoeff)`; if that is below the player's *base* power it is replaced by `round(Random.Range(minMinBotPowerCoefficient 0.8, minMaxBotPowerCoefficient 1.2) x basePlayerPower)`. Groups (RC `arenaConfig.arenaGroupsConfigs`): type 0 `{power 1.0..2.0, personal 0.1..0.5, challengeCount 1}`, type 1 `{1.5..2.2, 0.3..0.9, 2}`, type 2 `{1.8..2.5, 0.8..1.3, 2}`, size 33 each; `maxBotDisplayPower 126989`; `combatPowerGrowPercents 0.05`; `updateEnemyPowerPeriodSeconds 15`; `updatePointsPeriodSeconds 900` | decomp `Game.Services.Arena.ArenaService/{CalculateBotCombatPower,GetArenaGroup}.c`; RC `game_settings.arenaConfig` |
| Boss | `dynamic_complexity.Boss` disabled; boss power ups on a timer (see 10) | RC + decomp |
| Festival (Terminator) | concrete unit levels from `IFestivalLevelsService` then `UpdateInGameBotCombatMember` with `PowerParameter = festival level difficulty`, `OnlyThisPowerApply = true`; RC `terminator_event_levels_config.botUnitsInBattle {"Default":17,"Attack":14,"Artillery":11}` and `increaseCoefficients/decreaseCoefficients` tables by player-power band (0.5 down to 0.2; 1 down to 0.003) | decomp `FestivalLevelManager/{CreateInGameBotData,GetLevelDifficulty}.c`; RC |

`generate_units_power_in_proportion_config`: `randCoefficient 0.01`, enabled false for level types 0,1,2,5. `player_power_settings` (RC) defines how the human's combat power P is computed from upgrades (doc 05).

---

## 9. Fake multiplayer / PvP / Arena opponents

- **PvP is not multiplayer.** `LevelViewPvp*` (454 AI entries, ids 227-231 in v0 legacy) are normal AI levels with PvP complexity (90..150, step 7). `FakeMultiplayerSelectPopUp{Controller,View}` (dump.cs:L35253/L35476; namespace `Game.UI.Windows.PvP`) is a fake lobby: asset `navigationscreens/MonoBehaviour/Game.UI.Windows.PvP.FakeMultiplayerSelectPopUpView/FakeMultiplayerSelectPopUp_-1614317022082369111.json`: `startDelayToFindComplete 1.0 s`, each "found player" appears after `Random(minAddDelayForPlayersCount 0.5 .. maxAddDelayForPlayersCount 1.0)` s, countdown step `timerTextStepDuration 0.8 s`; shows the player's three unit levels and the opponents' icons/names.
- Opponent identity: `OpponentDataManager.GenerateAiOpponentData(count)` fills an array with `Opponent.Generate(country)` where `country = Random.Range(0, 20)` (20 `OpponentCountry` values, 14-ish name lists present), gender `Random.Range(0, 2)` then `NameGenerator.ByEnum(country, gender)` (first name from `*_FirstName_Female/Male` lists; `Game.Main.FakeMultiplayer.OpponentDataManager/GenerateAiOpponentData.c`, `Opponent/Generate_0x312DF58.c`). `NicknamesBots_88@resourcesassets.bin` (923 newline-separated handles, e.g. `StormBringer`, `SkyRacer7`, `Player621099`) is the nickname pool for leaderboard/event bots (consumer not decoded).
- Arena/event leaderboard bots are **simulated rows**, not AI instances: `ArenaService.InitializeMembers/UpdateRandomMember/InitializePowerAfterTime/InitializeArenaPointsAfterTime/UpdateArenaMemberPoints` create group members (power by the formula in 8.5, `followersCount 6`, `winCoefficient 1`, `loseCoefficient 5`, points start 550 max 500/600 etc. in RC `arenaConfig`) and move their points/power on timers; the played match is an `ArenaLevel*` AI level (155 AI entries) whose bot power is built from the challenged member (`ArenaLevelManager.CreateInGameBotData`, `CombatService.ConvertBotLeaderboardMemberToCombatMember`). `pvp_config` (RC): `minLeaderboardScorePerHouse 3`, `maxLeaderboardScorePerHouse 7`, enemy lead score ranges 1..3 etc. (scoring, meta direction). Race event bots use `race_event_config.botBoostCoefficient 0.3` (meta).

---

## 10. Boss AI (summary)

`BossPlayerController` (dump.cs:L136104; decomp `Game.Main.Player.BossPlayerController/*`) is a separate controller for `PT 3`: one `BossTower` (selectable, `+0xF8`) plus the same preset behaviour fields. Behaviours recovered:
- `FindWayByPriority`: first building in the level list that satisfies `CheckCreateWayCondition(bossTower, x)` and is owned by, in order of priority, **HumanPlayerController**, then **NeutralPlayerController**, then **BossPlayerController** (decomp `FindWayByPriority.c` + 3 lambdas).
- `CreateWaysOnPowerUp` / `RunWaysResetFlow` / `OnLastChanceActivated`: after each power-up (and on level start/reset) draw lines until the tower has `FreeWaysCount` lines (loop `FindWayByPriority` -> `TryCreateWay`); at "last chance" (extra time) the flow resets lines and plays bombs on all boss towers.
- Power ups: RC `boss_event_config.bossAi` `{damageCoefficient 1, levelDuration 120, lastChanceAdditionalTime 60, switchZoneDelay 30, switchZoneDuration 2, startGameDelay 3, troopersCount 25, stunDuration 20, unitsConfig{unitType baseType 1 PwUp{ZTPU 0,PUA 1,MPUA 2,TTU 60}; unitRarity baseRarity 1 PwUp{0,1,8,10}; unitSpeed baseSpeed 2.5 PwUp{0,0.2,0.2,5}; lines baselines 1 PwUp{0,1,3,40}; unitPower basePower 100 PwUp{0,250,5000,5}}}`. `PowerUpConfig` JSON keys (dump.cs:L113115): `ZTPU _zonesToPowerUp`, `PUA _powerUpAmount`, `MPUA _maxPowerUpAmount`, `TTU _timerToUpdate` (names; the interpretation "every TTU seconds add PUA up to MPUA" is inferred from names; `BossPowerUpController.StartBehave` runs `BossBehaviours.MovingBehaviour` on a delay and calls `PowerUpPerformed`). Boss unit stats come from `CombatManager.CreateBossInGameWarriorSkinData`.
- Buildings captured by the boss are driven by `CapturedByBossBuildingsController`, a copy of the default AI (same `DefaultBehavior`, same reaction handler with the same guard) fed from the `B_*` JSON keys.
- Level JSON (32 boss levels): `B_AD` 4..13, `B_MinRD/MaxRD` 1/2, `B_BT 0`, a few have a 1-step `B_AiSC` scripted opening.

---

## 11. Randomness, seeding, determinism

- AI: `UnityEngine.Random.Range/value` (source choice, reaction roll/delay, boss/arena draws, bot power split and roll). Never `InitState`'d anywhere in decompiled code. Frame-timed accumulation. => runs are not reproducible; there is no replay system (doc 03 section on determinism).
- Seeded: `WarriorSkinsManager.InitSeed` (`decomp/.../WarriorSkinsManager/InitSeed.c`) builds `System.Random(seed)` with a persisted `RandomWarriorSkinSeed` for deterministic random skin picks; `CombatService.CreateBotUnitForTargetPower` takes a `seed` argument (`System.Random`) for repeatable bot unit choice (Challenge Tower reuses the stored `aiInGameData`).
- `List.Sort(CompareByLevel)` is unstable: ties in effective level resolve by IL2CPP's introsort on the input order (level building list order); the exact order is implementation-defined.

---

## 12. Mapping to Node Arena (`packages/bots`) and gaps

Today (docs `06a-node-arena-baseline.md` section 3; sources `packages/bots/src/{index,driver,utility,considerations,harness}.ts`, `packages/content/src/{bot-params,bot.schema}.ts`):
- Contract `Bot{player, decide(ctx, tick): Command[]}`, `BotContext{view, canDraw, readTroops}` guarded by a Proxy; commands are only `DrawLine`/`CutLine` (`packages/sim/src/commands.ts`). Driver: one seat per `level.bots` entry, cadence `decisionIntervalSec*20` ticks (TICK_RATE 20), seeded phase offset, per-seat sfc32 seed `mixSeed(matchSeed, index, fnv32(profileId))`. `BotSchema.kind` is `utility | idle`; level players pick a profile by string `botProfile` (no per-level overrides). `ScriptedController` in `harness.ts` replays a fixed `{tick, cmd}` list (test/replay tool).
- View: `view.tower.owner/team/slots/lines/col[...]`, `view.lines` (`channel, from, to, owner, length, drawSeq`), `towerStatic {x,y,archetype,components}`, `canDraw(player, from, to)` returns a `RejectReason | null` (`not-owner, self, no-slot, duplicate, gameover, unknown-id, no-component`).

### 12.1 Concept mapping
| Tower War | Node Arena | Fit / action |
|---|---|---|
| `DefaultBehavior` timer `AD` | `skill.decisionIntervalSec` | Direct. TW fires at t = AD, 2AD, ... (timer carry, phase 0). NA driver staggers with a seeded phase: add a profile flag `phase: 0` (or `phaseSeeded:false`) for exact timing. Granularity: TW frame-based, NA 50 ms ticks. |
| One action per tick | `actionsPerDecision = 1` | Direct. |
| `CheckCreateWayCondition` | `ctx.canDraw(player,from,to) === null` | Covers owner, slot, duplicate (undirected duplicate semantics differ: TW `HasWayWith` is symmetric over the *start's* list; NA `duplicate`/R-LIN-03 replacement). **No obstacle/corridor test** needed (NA has no blockers); if map blockers are ever added, port the box-cast corridor (3.2). |
| `ValidBuildingTypesToCreateWay` (House, SelectableFortess, Trolley) | towers with `drawsLines` component | Data: list of source archetypes. |
| Target list = all non-own buildings + resource piles | all towers with `owner != me` (incl. neutral and other bots; NA `team` allows allies later: TW has none) | Direct. Resource piles: not in NA. |
| `CompareByLevel` weakest-first | garrison count (NA "level" = garrison, `garrison.count` column) with a `special archetype /1.5` discount hook | **Needs a new bot kind**; utility scorer ranks (source,target) pairs by weighted considerations and cannot express "sort targets ascending by level, then random source". Closest utility emulation: `attack.weights.targetWeakness` only, `noise` 0, `maxTargetsPerSource` all, `holdThreshold` 0, bias cut 0 - but source choice is argmax not random and distance/other terms creep in. Recommend implementing the TW policy as a small dedicated kind (`kind: "tw"`), ~60 lines, using the seat's sfc32 for the random source pick. |
| Random free-slot source | `view.tower.slots - view.tower.lines > 0` plus own owner | Direct (`slots` = capacity, `lines` = used). |
| `Defense` nearest own building | `drawsLines` own towers sorted by `towerDistance` | New code (simple); rule: only when no attack was possible. |
| Rocket tower aim (`level x coefficientByRocketTowerAttack`) | none (`shoots` component only mentioned as future in README) | Gap: needs a rocket archetype + a command (aim) first. |
| Railway / trolley logic | none | Gap (feature absent in sim). |
| Cutting | `CutLine` | TW AI never cuts: for TW-style bots set `bias.cut = 0` (utility) or simply never emit `CutLine` (tw kind). Exceptions: rocket retract, useless-attack switch. |
| Reaction delay `MinRD/MaxRD`, under-attack handler | none | Inert in TW (sec. 4); keep fields in schema (default 1.0..2.0) but implement as no-op unless the intended inverted-guard behaviour is chosen (then: on a new hostile line into my tower, 50% roll, delay uniform in [min,max], counter-line from the attacked tower if it has a free slot, else reinforce it from free towers in `CompareByDefense` order). |
| Scripted steps | `ScriptedController` is tick-keyed and unconditional | Gap: TW script is **event-sequenced** (delays relative to previous step completion, conditional skips when the own house changed owner, capture waits, fallback source) - need a stateful `script` interpreter, not a tick list. |
| Per-AI settings in level | `players[].botProfile` string only | Gap: add `players[].bot = { kind, params }` (or an overrides block) to `core.schema.ts`; update `validate-content.ts`, compile, hash, `BOT_VERSION`. |
| Difficulty percent / bot power | tier files `{extends, skill}`; no stat scaling | Gap: add a seat-level **power multiplier** consumed by the sim (generation rate or start garrison via compiled level params), set outside the bot; hashes must include it. |

### 12.2 Proposed content schema (TW kind) - for `packages/content/src/bot.schema.ts`
```jsonc
{ "kind": "tw",
  "params": {
    "actionDelaySec": 6.0,                 // TW AD
    "behavior": "attack" | "defense" | "random",   // BT 0/1/2: "attack" = full; others = attack-only (same behaviour)
    "reactionDelaySec": [1.0, 2.0],        // MinRD, MaxRD (reserved)
    "levelDiscount": { "special": 1.5 },   // CompareByLevel IsSpecial divisor, by archetype tag
    "script": [                            // ordered by I; omit for default AI
      { "op": "delay", "sec": 8 },
      { "op": "line", "own": "t1", "target": "t4", "afterSec": 3.5 },        // CreateWayBehavior (AiCWS)
      { "op": "steps", "root": { "goal": "line" | "capture" | "none", "own": "t1", "target": "t4",
                                   "startDelaySec": 6, "then": [ /* same shape, run in parallel */ ] } },   // AiSC
      { "op": "railMove", "building": "t7", "pathPoint": 1 }               // AiRM (feature-gated)
    ] } }
```
The converter already produces this shape as `ai.steps` (`/root/projects/tower-war/_extract/converted/tw-level-ext.schema.json`, doc 02 section 8); needed addition is the semantic notes in section 6.2 (skip-if-own-lost, fallback source, capture poll 1 s).

### 12.3 Reimplementation spec for `kind: "tw"` (pseudocode)
```
state: timer=0; queue=script ops; current=null
decide(ctx, tick):               // call every tick (cadence = 1 tick), accumulate dtTicks
  advance current step if any (delay/line/steps) by dtTicks; on completion pop next; when queue empty -> default mode
  default mode: timer += 1; if timer < AD_ticks return []; timer -= AD_ticks
     targets = all towers with owner != me, sorted ascending by key(garrison or garrison/1.5 for special), tie-break by index (deterministic; TW tie order is unspecified)
     free    = own towers with slots - lines > 0 and kind drawsLines
     for t in targets: cand = shuffle-free random pick loop over free:
            s = free[rng.next() % n]; if canDraw(me,s,t) === null: return [DrawLine(s,t)]; else remove s
     (behavior == attack only) if nothing: nearest own tower o to some random free s with canDraw -> DrawLine(s,o)
     return []
  script line op: after afterSec: if own owned by me and canDraw(own,target) ok -> DrawLine(own,target)
                  else fallback: if myTowerCount >= 2: first free tower (index order) != own,target with canDraw ok -> DrawLine
  script steps node: if own not mine -> node complete; wait startDelay; line goal: same as above; capture goal: then poll each 1 s (20 ticks) until target.owner == me or own lost; on complete start all children together
```
Randomness: seat sfc32 only (`mixSeed(matchSeed, index, fnv32(profile.id))`); never read sim RNG (driver rule). Unit tests: replay determinism, golden for `bots:golden` after bumping `BOT_VERSION`.

### 12.4 Difficulty mapping suggestion
- Per-level AI strength today = `botProfile` tier (`-easy/-normal/-hard/-expert` skill-only variants). TW strength = `AD` (cadence) + level building layout (AI start levels 1.3-4.2x) + dynamic percent. Map `AD` to `skill.decisionIntervalSec` (hard <= 3 s, normal <= 7, easy > 7 matches doc 02's tier guess; real data median 6-8 s), the layout to level authoring, and the percent to an optional **meta-controlled** `seatPowerPercent` (default 100, range 80..200) stored in match metadata so replays stay deterministic. Do not put the controller inside sim or bots.
- Contradiction with doc 02 section 10 (`BT` 0/1/2 -> rusher/turtle/opportunist): BT 1 and 2 are not personalities; they are the same attack-only behaviour. Recommended mapping: BT 0 -> `tw` full, BT 1/2 -> `tw` with `behavior` = attack-only; keep NA personalities for NA-native levels.

### 12.5 Gaps list (what NA cannot represent yet)
1. Event-sequenced script interpreter (6.2).
2. Per-level bot params (inline), see 12.1.
3. Seat power multiplier + meta difficulty controller (8).
4. Rocket-tower aiming, railway/trolley moves, resource piles, obstacle corridor test (no sim features).
5. Reaction/under-attack hook (or decide to drop it, section 4).
6. Fake-lobby UX and name pool (cosmetic; `NicknamesBots` 923 handles, list of 20 countries) - web client only.
7. Boss AI (priority target by owner type, power-up timers) - only with a boss mode.

---

## 13. Contradictions, uncertainty, not found

Contradictions with earlier docs:
- Doc 02 section 10 (and `06a` table) treats `BT` as personality (0 rusher, 1 turtle, 2 opportunist): decomp shows 1 == 2 == attack-only subset. Dump enum names (Attack/Defense/Random) do not describe the code.
- Doc 02 count of scripted levels (601/1,012) vs mine (621/1,024): list sizes differ; counts per bucket reproducible with `p4_ai_stats.py`.
- Doc 03 states reaction delay semantics are "P4": result is that `MinRD/MaxRD` are read only by the (inert) handler.
- `dump.cs` offsets annotated as `AiPlayerController.actionDelay` (0xC4) etc. match decomp; no contradiction.

Uncertain:
- Inert reaction handler: literal asm; could be an intended-but-buggy guard (medium-high). Boss copy identical.
- Static-grow formula helpers `sub_625DEF0/sub_625DEB0` unresolved (disabled anyway).
- `IncreaseDifficultyScale` caller (inferred after level clear).
- Interpretation of `PwUp` keys `ZTPU/PUA/MPUA/TTU` (names).
- Time-scale behaviour of `UniTask.Delay` in the reaction handler (delayType arg unresolved).
- `List.Sort` tie order.
- Initial value of `ChangeComplexityStep` after reset (storage-dependent; `SavedLevelComplexity.lastComplexityStep`).

Not found:
- Any AI line-cut decision, threat/economy evaluation, or difficulty read from level JSON.
- Where `botActionDelay` (`ChangedConstants`, dump.cs:L128609) is set (dev console only; default presumably < 0 since `-1` means "use authored").
- Numeric value of `UniTask.Delay` delayType (9) semantics; `RailwayBehavior` geometry constants beyond `RAYCAST_DISTANCE`.
- `OpponentCountry` enum names/count beyond the `Random.Range(0, 20)` call.
- A per-unit power formula (core mechanics).

Reproduction: patterns files used `/tmp/claude-0/-root-projects-node-arena/5ceb4fc4-c666-4f8a-93c9-cb3b5463740b/scratchpad/p4pat*.txt` (classes `Game.Main.Player.*`, `Game.Services.LevelsComplexity*`, `Game.Main.Levels.*LevelManager`, `Game.Main.Combat.CombatManager`, `Game.Services.Arena.ArenaService$$*`, `Game.Services.EventCenter.ChallengeTowerService$$*`, `Game.Main.FakeMultiplayer.*`, `Game.Main.BossEvent.*`); run `TW_TRIVIAL=0 _tools/decomp.sh -f <file>` (needed so one-line lambdas are emitted). Helpers: `/root/projects/tower-war/_tools/p4_clean.py` (strips metadata-init noise), `p3_calls.py` (call/constant summary), `p4_ai_stats.py` (corpus statistics), capstone venv at `<scratchpad>/capv` with `a64.py <rva> <size>` for raw disassembly (used to verify the reaction guard, `GetRandomPowerBound`, `ChangeLevelComplexity`, `CalculateBotCombatPower`).
