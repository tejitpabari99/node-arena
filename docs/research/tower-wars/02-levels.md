# 02 - Tower War levels teardown

Scope: how Tower War - Tactical Conquest v1.29.3 (Vaveda, Unity IL2CPP, `games.vaveda.militaryoverturn`) stores, sequences and selects levels, what the level format supports, and how to convert it losslessly into Node Arena content. Direction P2 of the teardown. Nothing from the game's level files is copied into this repo.

Citation keys: `dump.cs:Lnnn` = `/root/projects/tower-war/_extract/il2cpp/dump.cs`. `TA:` = `/root/projects/tower-war/_extract/assets/defaultlocalgroup_assets/TextAsset/`. `RC:` = remote-config defaults `/root/projects/tower-war/_extract/assets/data_unity3d/TextAsset/saykit_mlltrna_1.29.3_98.json`, object `game_settings` (a key's value is sometimes a JSON string). `ASM:` = my arm64 disassembly of `libil2cpp.so` (addresses are `dump.cs` RVAs; see section 4.1 for method). Statements marked "(inferred from names)" rest on identifiers only. "not found" means I looked and could not find it.

Artifacts (outside the repo, regenerate with `python3 -I`): `/root/projects/tower-war/_tools/p2_levellib.py` (loader/normaliser), `p2_tw2na.py` (converter), `p2_stats.py`, `p2_campaign.py`, `p2_params.py`, `p2_tables.py`, `p2_census.py`; outputs in `/root/projects/tower-war/_extract/converted/` (`census.txt`, `stats_families.json`, `params_campaign.txt`, `params_all.txt`, `campaign_order.tsv`, `tw-level-ext.schema.json`, `ext/`, `na-v1/`, `samples_report.txt`).

---

## 0. TL;DR

1. There are 2,195 level TextAssets (one JSON per level), all in `defaultlocalgroup_assets`. 2,165 use the current format (`LevelSavedJsonValues`, dump.cs:L146642): one `P[]` array of players each holding `BD[]` buildings, plus 10 flat lists (`WOD, OBS, ROBS, Mine, Wall, Sheep, River, Cargo, Gate, Railway`). 30 are a legacy "v0" format (playable-ad, artillery-test, a few leftovers) not used by any shipped list.
2. Levels are pure data: a level is a flat set of owned buildings (houses, towers, rocket towers, ...) with per-instance stat overrides, a scripted-or-default AI per enemy, and a bag of decorative/functional map objects. There is no map grid, no lane graph and no win-condition field. Coordinates are free-float (x, z) world units on a ~19.5 x 17.3 unit playfield, y is up and almost always 0.
3. The campaign order is not in the level files. It is the remote-config list `levels` (1,024 ids, 3 tutorials + 1,021 levels). `CommonLevelContainer` plays it by index `i = PlayerStorageData.levelIndex`, then loops forever over entries `[52..1023]` (3 tutorial entries + `skip_levels_count` 49 are played once). Verified by disassembly (section 4.1).
4. Difficulty does not rise inside the level JSON: the AI/player start-level ratio is 1.3x in the first 50 levels and then fluctuates between 1.9x and 4.2x with no trend. Progression comes from feature introduction (section 5) plus a dynamic "complexity" percentage (section 4.5) that scales bot power by win/lose history (mechanism inferred from names).
5. A lossless converter is prototyped: all 2,195 assets round-trip exactly (2,165 v1 files equal the raw parsed JSON, 30 v0 files equal after v0->v1 normalisation). Projection to our current `LevelSchema` (towers only) gives valid, playable NA v1 levels for 982 of the 1,012 campaign levels that have a JSON file; everything else TW has (obstacles, mines, walls, rivers, gates, rails, ranged towers, multi-troop) is dropped. See sections 8-10.

---

## 1. Sources and verification

- Level files: `TA:*.json`, 2,195 files. `assets/_manifest/container_all.tsv` has 2,195 rows under `Assets/Addressables/Levels/SavedLevelsTxt/` (Default 1,241, Pvp 256, ChallengeTower 171, Arena 155, Festival/Terminator Event 153, Draw 130, Daily 56, Boss 32, TestLevels 1). I checked all 2,195: every row's address basename equals the exported file basename and the file suffix equals the row pathID, and all files exist. So the TextAsset names match the addressables and the scenes-bundle pathID-collision bug (doc 01 section 0, item 7) does not touch them. All 2,195 parse as JSON.
- "Default 1,241" = 1,237 `LevelView ...` files + 3 `Test LevelView Unit {Artillery,Soldiers,Tank}` + `Test level`. My family counts below add up to 2,195.
- Remote-config defaults are the shipped APK defaults. The live server config can differ (list order, counts). The stringliteral table in the binary also embeds other default JSON blobs (e.g. an alternative `levelComplexityParameters` with step 25, upperBound 1000), so treat all RC numbers here as "defaults at 1.29.3".
- Code facts that are not in dump.cs (method bodies) come from disassembling `libil2cpp.so` for a handful of small methods (capstone in a scratch venv, no Ghidra). Address mapping: file offset = RVA - 0x4000, as printed in dump.cs (`RVA: 0x30972B0 Offset: 0x30932B0`). Call targets resolved through `script.json`.

---

## 2. Categories, containers and where each list comes from

Source of the mapping: `LevelsService.InitializeLevels` (dump.cs:L147339; ASM 0x30C64B4) passes these `UniWrapperGameConfig` fields (dump.cs:L726181; field offsets in comments) to each container's `Initialize(string json)`:

| Category (`LoadLevelType`, dump.cs:L155281) | Container (dump.cs) | Config field (offset) | RC default | Level file family (folder) | Files | Wrap rule |
|---|---|---|---|---|---|---|
| Common = 0 (the campaign) | `CommonLevelContainer` L141751 | `levels` (0x78) | 1,024 ids, 1,024 unique, 3 flagged `isTutor` | `LevelView N[_xx]` (Default/) | 1,237 (+4 test) | skip + loop (section 4.1) |
| Daily = 1 | `DailyLevelContainer` L141823 | `challenge_levels` (0x80) | 77 ids, all `LevelViewDraw`, 4 flagged `isTutor` | `LevelViewDraw N_xx` (Draw/) | 130 | skip tutorials only, then same formula (ASM 0x3098A0C, 0x3098B58) |
| PvP = 2 | `PvpLevelContainer` L142079 | `multiplayer_levels` (0x88) | 252 ids, 247 unique | `LevelViewPvp N_xx` (Pvp/) | 256 (251 v1 + 5 v0) | `i mod count` |
| ChallengeTower = 3 | `ChallengeTowerLevelsContainer` L141674 | `challenge_tower_levels` (0x130) | 300 entries, 150 unique ids | `ChallengeTowerLevel N_xx` (ChallengeTower/) | 171 | `i mod count` |
| Arena = 4 | `ArenaLevelContainer` L141523 | `arena_levels` (0x348) | 155 ids = all 155 files | `LevelViewArena N_xx` (Arena/) | 155 | `i mod count` |
| Boss = 5 | `BossLevelContainer` L149793 | `boss_levels` (0x628) | 7 ids | `LevelViewBoss N_xx` (Boss/) | 32 | `i mod count` |
| Festival = 6 | `FestivalLevelsContainer` L141914 (service-driven, not a config string) | `terminator_event_levels_config` (RC key; 99 ids) | 99 ids of 153 files | `TerminatorLevelView N[_ES]` (Festival/Terminator Event/) | 153 | festival service |
| Test = 100 | `TestLevelContainer` L142147 | `test_levels` (0x98) | not in RC defaults (a binary literal `{"levels":[{"id":"Test Performance LevelView"}]}`) | `Test Performance LevelView` (TestLevels/) | 1 | - |

Notes:
- Daily is fed by `challenge_levels`, whose ids are all `LevelViewDraw`. That is the only link I found for the 130 "Draw" files. The 56 `LevelViewDaily` files are referenced by no RC default list (unused or fed by a live list - not found). `draw_levels` (0x90) exists in the config class but `InitializeLevels` never reads it. In-game the feature is behind `show_challenge_after_level` 14 and `show_challenge_per_level` 3 (RC), so Draw levels are an interleaved challenge mode (inferred from names). 97% of Draw levels contain `Gate`s (section 3.7), which no other family has.
- `LevelParams` (dump.cs:L146891) = RC list entry: `{id, isTutor, difficulty}` (DataMember names `id`, `isTutor`, `difficulty`). No RC default entry sets `difficulty`. `ChallengeTowerLevelParameters` (L141583) adds `difficulty_real`, `difficulty_fake`, `rewards[]`.
- File-name suffix `_ES _SO _VL _HM _VI _AB _NB _NES` etc. is the author tag of that level version (inferred from names). Several numbers exist in more than one version (`LevelView 3_AB`, `3_ES`, `3_ES ...`); the RC list names the exact asset, so level numbers are not unique ids.
- 549 files are named by none of the six config-string lists above: 225 `LevelView`, 56 `LevelViewDaily`, 55 `LevelViewDraw`, 25 `LevelViewBoss`, 21 `ChallengeTowerLevel`, 9 `LevelViewPvp`, 5 test files, plus the 153 `TerminatorLevelView` files that the festival service feeds (99 of them appear in `terminator_event_levels_config`). RC defaults only; the live config may reference more.
- 12 of the 1,024 campaign ids have no JSON: they are hand-built prefabs under `Assets/Addressables/Levels/Levels/Default/` (3 tutorials `2TutorLevel 3TutorLevel 4TutorLevel` with a `BaseTutorial` component, plus `LevelView 182_NB, 100_ES, 110_VL, 130_VL, 358_ES, 247_ES, 388_ES, 1093_ES, 1083_ES`) at list positions 1, 2, 3, 10, 23, 35, 66, 137, 215, 221, 266, 329. Daily has 2 more (`LevelViewDraw 1_ES`, `2_ES`). The prefab hierarchy export has no transforms, so these cannot be converted from current extraction (gap, section 11).
- Per-mode progress indices live in `PlayerStorageData` (dump.cs:L123562): `levelIndex` (0x48), `dailyLevelIndex` (0x4C), `pvpLevelIndex` (0x74), `bossLevelIndex` (0x78), `challengeTowerLevelIndex` (0x88). Selection is sequential per mode; no shuffle, mirror, flip or random-level code found (name search of dump.cs for Mirror/Flip/RandomLevel/Shuffle).

---

## 3. Level JSON format

### 3.1 Dialects

| Dialect | Count | Where | Notes |
|---|---|---|---|
| v1-short | 2,089 | all families | `LevelSavedJsonValues` with `[JsonProperty]` short keys (bt, l, ml, p ...) |
| v1-long | 76 | 9 ChallengeTower, 1 Arena, 66 Terminator | building entries (BD and WOD) serialised with C# property names: `Id, LevelStyleType, BuildingsType, Position` and long stat keys (`L, ML, CBI, WS, CWC, SC, GL, AD, AR, SUpL, RUpL, BS, AC, SWC, WCPR, DTSC, SCP, MCP, CC, DS, LUp`; rocket tower start level is `SL`; selectable fortress `WT` upper-case; resources `R, C`). No file mixes the two. A loader must accept both. |
| v0 legacy | 30 | 23 LevelView (playable-ad, artillery-test, 891_HM 1, 936-940_HM), 5 Pvp (227-231), 1 ChallengeTower 1, 1 Test Performance | `{Player, AI[], B_AI, Res, Obst, RivObst, Mine, Wall, Sheep, River, Cargo, Nplayer, Gate, Railway}`; per-type lists `H T R F SF FL CRT TR` with upper-case keys `I P WT L ML CBI WS CWC SC GL ...`. None is in an RC list. |

### 3.2 Top level (`LevelSavedJsonValues`, dump.cs:L146642)

| Key | Type | Meaning |
|---|---|---|
| `P` | `IPlayerBuilderData[]` | players in order; polymorphic by `key` (section 3.3) |
| `WOD` | `IBuildingBuilderData[]` | "without owner data": ownerless buildings; in data only `res` (resource piles) |
| `OBS` | `ObstacleSavedJsonValues[]` | decorative/blocking obstacle clusters (dump.cs:L144029) |
| `ROBS` | same | river-side obstacle clusters (4 children each) |
| `Mine` | `MineSavedJsonValues[]` | mines |
| `Wall` | `WallSavedJsonValues[]` | destructible walls |
| `Sheep` | `SheepSavedJsonValues[]` | sheep obstacles |
| `River` | `RiverSavedJsonValues[]` | rivers (bridge-building) |
| `Cargo` | `CargoSavedJsonValues[]` | cargo drop points for a house |
| `Gate` | `GateSavedData[]` | arithmetic gates |
| `Railway` | `RailwaySavedJsonValues[]` | rail tracks |

All 11 keys are present in all 2,165 v1 files. No camera, bounds, time limit, environment, win rule or difficulty field exists in the file: they come from code/config (environment: section 4.4; win rule: not found, outside P2).

### 3.3 Players (`P[]`)

`key` discriminates the class (converters dump.cs:L144787, L144796). Observed over 2,165 files: `p` x2165 (PT 0, PC 0), `ai_p` x4011 (PT 1; PC 1 x1055, 2 x1974, 3 x982), `n_p` x2162 (PT 2, PC 4), `b_p` x32 (PT 3, PC 2).

| Key | Class (dump.cs) | Fields |
|---|---|---|
| `PT` | `PlayerType` L155307: Player 0, AI 1, Neutral 2, Boss 3 | all players |
| `PC` | `PlayersColors` L155318: Blue 0, Green 1, Red 2, Yellow 3, Gray 4 | all players |
| `BD` | `IBuildingBuilderData[]` (polymorphic by building `key`) | all players; 7 entries over the corpus are `null` (editor artefacts) |
| `AD` | action delay (float) | `AiPlayersSavedJsonValues` L144503 |
| `MinRD`, `MaxRD` | reaction delay min/max | same |
| `BT` | `AiBehavior` L155120: Attack 0, Defense 1, Random 2 (inferred from names; the controller field is `behaviorType`, dump.cs:L134874 AiPlayerController) | same |
| `AiDS` | `DelayStepBehaviourSavedValues[]` `{I, D}` (L144474) | preset behaviour: wait D seconds |
| `AiCWS` | `CreateWayStepBehaviorSavedValues[]` `{I, OHId, THId, AD}` (L144429) | preset behaviour: draw a way from own house OHId to target THId, attack delay AD |
| `AiRM` | `RailwayMoveStepBehaviorSavedValues[]` `{I, TPPI, BId}` (L144082) | preset behaviour: move a railway cart of building BId to path point TPPI |
| `AiSC` | `AiActionStepCreatorSavedValues[]` `{I, AiSA}` (L144323); `AiSA = {GT, OHId, THId, DS, OS[]}` (L144352) | scripted action tree; `OS` nests more steps (observed depth 0-4). `GT` = `AiBehaviourGoalType` L135092: None 0, CreateWay 1, CaptureHouse 2 |
| Boss prefix | `BossPlayerSavedJsonValue` L144608 | same fields with `B_` prefix (`B_AD, B_MinRD, B_MaxRD, B_BT, B_AiDS, B_AiCWS, B_AiSC`; no `B_AiRM`) |

Players without AI fields: `p` (human, `PlayersSavedJsonValues` L144746) and `n_p` (neutral, `NeutralPlayerData` L144705). The human is always `p` (Blue) and always first; AI colours are Green/Red/Yellow; neutral is Gray and present in 2,162 of 2,165 files (absent only in 3 test files). Boss levels are `p` + `b_p` + `n_p`, no `ai_p`.
`AiPlayerController` (dump.cs:L134874) fields `actionDelay, reactionDelayMin, reactionDelayMax, behaviorType, presetBehaviorsSequence` map 1:1 to `AD, MinRD, MaxRD, BT` and the four step lists. The preset steps run first; default behaviour afterwards (inferred from names, not verified).

### 3.4 Buildings (`BD[]`, `WOD[]`)

Common: `id` (int, unique across BD and WOD inside one level; 0..n-1 in most levels, gaps in 77 where resources hold the missing ids), `lt` (`LevelStyleTypes` L146952: Common 1, Festival 2), `bt` (`BuildingsType` L166431), `p` {X,Y,Z}, `key`. Per kind (usage = occurrences across all 2,195 files incl. v0):

| `bt` / kind | `key` | Short keys -> meaning (class) | Count |
|---|---|---|---|
| 0 house | `h` | `WT` warrior type (`WarriorType` L155583: Default 1, Attack 2, Artillery 3), `l` start level, `ml` max level, `cbi` canBeIgnored (ignored for win), `ws` spawnWarriorSpeed, `cwc` coefByWayCount, `sc` spawnCoef, `gl` growLevelTime (`HouseSavedJsonValues` L143589) | 17,094 |
| 1 tower | `to` | `l, ml, cbi, ad` attackDelay, `ar` attackRadius, `supl` speedUpByLevel, `rupl` radiusUpByLevel, `bs` bulletSpeed (L143823) | 1,093 |
| 2 resource (WOD only) | `res` | `r` rotation vec, `c` count (L143655) | 2,254 |
| 3 rocket tower | `rt` | `l, ml, cbi, ds` delayToShoot, `lup` coefByLevelUp (L143685) | 860 |
| 4 fortess | `f` | `l, ml, cbi, ac, bs` (L143541) | 0 (class exists, unused) |
| 5 flag | `flag` | `l, ml, cbi` (L143505) | 50 |
| 6 speed tower | - | no saved class | 0 |
| 7 selectable fortess | `s_f` | `wt` (lower-case in short form), `l, ml, cbi, ws, cwc, sc, ac, bs, swc` spawnedWarriorCount, `wcpr` warriorsCountPerParachute, `dtsc` delayTimeToSpawnCargo (L143733) | 340 |
| 8 capture rocket tower | `c_rt` | `l, ml, cbi, scp` startChargingPoints, `mcp` maxChargingPoints, `cc` chargingCooldown (L143451) | 266 |
| 9 boss tower | `b_t` | `cmp` configuredMovePositions[], `mp` movePositions[], `cbi` (L143415) | 32 |
| 10 trolley | `tr` | `l, ml` (L143889) | 188 |

Buildings by owner over the corpus: player (human) 3,160 (house 2,917), AI 5,769 (house 5,098), neutral 10,928 (house 9,051, tower 845, rocket tower 573), boss 66 (boss_tower 32). Neutral buildings are the bulk of every map: neutral = capturable.

Cross references (verified over all levels): `AiSA.OHId` is an own building in 2,558 of 2,609 AI/boss steps (46 reference another player's building, 5 missing); for the 2,597 AI-player steps `THId` resolves to a building in 2,431, a resource pile (`WOD` id) in 159, nothing in 7. `AiCWS.THId`: building 777, resource 75, none 49. `Cargo.BId` always resolves to a house (or 1+8+17 rocket/selectable) of any owner (player 735, AI 800, neutral 1,397). `Railway.CTI` (connected tower id) resolves to a building of any owner (houses mostly, 5 towers, 3 rocket towers). `AiRM.BId` is a house (32) or tower (3).

### 3.5 Parameter values actually used (campaign = the 1,012 listed levels with JSON; `params_campaign.txt` has everything)

- House (player + AI + neutral, 7,609 campaign houses): `WT` 1 / 2 / 3 = 72.7% / 15.5% / 11.8% (5,528 / 1,180 / 901). `ml` is 64 in 94.7% (30 on ~300 houses, 35-550 on a few). `ws` 0.5 (a few 1.0 / 0.55), `cwc` 0.3, `sc` 1.7, `gl` 1.7 or 2.0 (2.0 only on WT2/WT3, matches prefab defaults in doc 01 section 3.2). So per-house tuning is practically only `WT`, `l`, `ml`.
- Start level `l`: player houses `10` x377, `5` x369, `15` x171, `20` x129, `25` x108; AI houses `10` x655, `5` x534, `15` x273, `20` x271, `25` x208, `30` x154 and rarely up to 64; neutral houses `5` x1,395, `10` x1,248, `15` x401.
- Tower: always `ad 2.0, ar 1.6, supl 1.75, rupl 0.9, bs 12.0` (rare variants `ar` 1.5/1.4/1.2); `l` mostly 5-10 (AI 5 x58, 9 x17, 10 x16).
- Rocket tower: `ds 0.5`, `lup 4.0` always; `l` 5/10/15/25; `cbi` true on 12 of 103 AI ones.
- Selectable fortress: `wt` 1 always, `ac` 2.0 (4.0 x9), `bs` 15.0, `swc` 9 most common (3-30), `wcpr` 3 (1-7), `dtsc` 5-30, `l` 5-300.
- Capture rocket tower: `cc 3.0` always, `scp` 0-295 (100 most common), `mcp` 75-999 (300 most common).
- Trolley: `l` 0-5, `ml` 5-25 (neutral), player `l` 20/0/9.
- Resource `c`: 6 x488, 24 x178, 18 x135, 12 x126, 32, 60, 14, 100, 154, 224 (prefab names `Resources6/12/14/18/24/32/60/100/154/224`, doc 01 table).
- AI: `MinRD` 1.0 in 90% (up to 99 in one outlier), `MaxRD` 2.0 in 90%, `BT` 0 x1,832, 2 x199, 1 x13, `AD` 2-15 s (5 x241, 6 x206, 2 x199, 7 x178, 8 x154, 10 x135). Presets: `AiSC` steps 1,182 (GT 1 x1,122, GT 2 x59, GT 0 x1), `DS` 2-16 s; `AiCWS` 495 steps (`AD` 1-15); `AiDS` 38; `AiRM` 35. 601 of 1,012 campaign levels script at least one AI step.

### 3.6 Map objects

| List | Keys -> meaning | Corpus counts | Notes |
|---|---|---|---|
| `OBS` | `OPP` parent pos, `OPR` parent euler, `OCP[]` child positions, `OCR[]` child eulers, `S[]` per-child active flag (dump.cs:L144029; runtime `ObstacleContainer` dump.cs:L137778 swaps big/small obstacle meshes by environment) | 8,019 clusters; always 8 children; 20% of children inactive | blockers/decor; 85% of LevelView levels have some |
| `ROBS` | same shape, 4 children (`RiverObstacleContainer` L137823) | 678 | river-side decor |
| `Mine` | `P, R, S` (L143992; runtime `MineItem` L152181: trigger collider, `MINE_DAMAGE_FOR_TROLLEY = 1`, boom delay) | 11,602 | `S` always true in campaign |
| `Wall` | `P, R, S, Hp, PS` punch strength (L144270; `DestroyedWallItem` L151799) | 3,810 | `Hp` 5 x821, 10 x301, 8, 6, 3, 7 ... 25; `PS` always 15.0 |
| `Sheep` | `P, R, S, D` delayToReturn, `IsS` square sheep (L144217; `SheepControllerAnotherVersion` L152673: move time, resurrection, explosion strength) | 386 | none in the campaign list (5% of all LevelView files, 2% of Pvp); in `LevelView 277_ES` each of 3 locations is listed twice (`IsS` false and true) |
| `River` | `P, R, T` river type (`RiverTypes` L155452: 18 values 0-17 = {Circle, Corner, Curved1, Curved2, HalfCircle, Line} x {large, Medium, Small}), `W` bridgeWidth, `D` distance (L144164; runtime `RiverBridgeController` L152518: bridge prefab, `bridgeWood` resource, `distanceBetweenBridges`, `isRiverLoop`) | 693 | `W` always 1.014, `D` 0.2; rivers are crossed by building bridges, apparently with resource piles (inferred from names) |
| `Cargo` | `BId` house id, `P[]` 1-6 drop points (L143918; `CargoSpawnPoint` L141442, `CargoManager` L172000) | 2,932 | reward crates near houses; RC `show_cargo_*` |
| `Gate` | `T` `GateBehaviorType` L155246 (Plus 0, Minus 1, Multiply 2, Divide 3), `C` coefficient, `P, R` (L143947; `GateBehavior` L151924 has `gateText`, per-group warrior counts) | 375, only in Draw (97% of Draw levels) | observed (T,C): (0,1) x208, (0,2) x76, (1,1) x43, (0,3) x11, (1,2) x11, (1,5) x10, (0,5) x6, (2,2) x3, (2,5) x3, (1,3) x3, (0,4) x1; 1-7 gates per level |
| `Railway` | `P` pos, `CTI` connected tower id, `PPP[]` 2-5 path points, `SCV` start path point index (L144119; `RailwayController` L168307 with `_pathPoints`, `_cart`, `_startCartPositionPointIndex`; `RailwayConfig` L130860 move durations for human/AI) | 96 | a building rides a rail; `SCV` 0 in 86 of 89 |

### 3.7 Coordinates, size, camera

- Axes: Unity, y up. Gameplay plane is (X, Z); `Y` is 0.0 for about 91% of campaign building positions (8,215 of ~9,000), else 0.1 / -0.03 / 0.05 / 0.01. `p` has 2 decimals, no grid (checked: no 0.05/0.1 snapping).
- Extents over all levels (buildings): X -9.75 .. 9.68, Z -8.4 .. 8.85; 1%..99% X -5.22 .. 5.21, Z -8.27 .. 8.25. So the playfield is about 19.5 wide x 17.3 deep. Other lists reach further (OBS parents X -28.9 .. 35.0, ROBS X -73.6 .. 83.9) because obstacles dress the area outside the camera.
- Min distance between any two kept buildings (house/tower/rocket/s_f/c_rt/flag/resource) per campaign level: min 1.05, p1 1.46, p5 2.29, p25 3.23, median 3.86, p75 4.42, max 7.95 world units. A house footprint is therefore well under 1 unit radius in TW units.
- No fixed orientation of sides: mean Z of buildings by owner is player -1.07, AI +0.71, neutral -0.08 (sd 5-6), i.e. players are not pinned to the bottom.
- Camera: `Main Camera` in the gameplay scene (scene bundle, `CAB-933d...` pathID 282, read with UnityPy): perspective, vertical FOV 21.0, near 0.3, far 1000, position (0, 53.0, -36.81), rotation quaternion (0.4617, 0, 0, 0.8870) = 55 degrees pitch down, no parent; background colour (0.514, 0.675, 1.0). The optical axis meets y = 0 at z = +0.30, so the camera looks at the origin. From these static numbers a 9:16 portrait screen sees only about +-6.7 units horizontally at the look-at point (my calculation: distance 64.7, FOV 21), narrower than the +-9.7 building extents, so code probably rescales FOV or distance per aspect ratio at runtime; not found. `CameraTransformMatrix` (dump.cs:L184667) only exposes world/screen conversions. UI camera is orthographic size 960.
- Tower footprint and unit scale: not in the level file; if you need a world-unit-to-px scale, use the 1.05-8 min-distance statistic above.

---

## 4. Sequencing and selection

### 4.1 Campaign (Common) - exact rule (disassembly)

`CommonLevelContainer.Initialize(json)` (ASM 0x30970CC): parses `levels` into `LevelsWrapper<LevelParams>`; counts entries with `IsTutor` (field 0x18) into `SkipLevelsCount`; then `SkipLevelsCount += game_settings.skip_levels_count` (0x70 of `UniWrapperGameConfig`) and `levelsCount = list.Count - SkipLevelsCount` (container fields 0x34 and 0x30).
`GetLevelName(levelIndex)` (ASM 0x30972B0): with `s = SkipLevelsCount`, `n = levelsCount`:

```
idx = s + ((levelIndex - s) % n)      // C# remainder; for levelIndex < s it yields levelIndex itself
return list[idx].Id
```

`GetLevelDifficulty` (0x3097344) uses the same idx and returns `list[idx].Difficulty`. `levelIndex` is `PlayerStorageData.levelIndex` (`CommonLevelManager.get_LevelIndex`, ASM 0x30BAA98 reads PlayerStorageData+0x48), incremented on a win (`IncrementLevelIndex(LoadLevelType)`, dump.cs:L123562 class; body not read).

With the shipped defaults (`skip_levels_count` = 49, 3 tutorial flags): `s = 52`, `n = 972`. So:
- levelIndex 0..2 = `3TutorLevel, 4TutorLevel, 2TutorLevel` (prefabs), 3.. = `LevelView 1, 2_AB, 3_AB, 4, ...`.
- positions 1..52 (list order) are played once; from levelIndex 1024 the game replays list positions 53..1024 (`LevelView 123_ES` ... `LevelView 1242_ES`) forever. The last entry is `LevelView 1242_ES`; there is no end screen and no growth in difficulty from the list itself.
- All other modes: `idx = levelIndex mod count` (Arena, Pvp, Boss, ChallengeTower: ASM 0x309461C, 0x309D89C, 0x30DFFCC, 0x3095884). Daily: tutorial-skip variant (flagged entries played once, loop over the rest).
- Order inside the list is authored, not numeric: the first ids are `LevelView 1, 2_AB, 3_AB, 4, 5, 6, 182_NB, 8_ES, 10, 11, ... 17, 49, 19, 20, 100_ES, 101_ES, 109_ES, 21, 22, 23, 103_ES, ...` and later `786_ES, 787_ES, 886_HM, 40, 41, 864_SO, 122_ES, 892_HM ...`. Level numbers are creation ids, new authors' levels are spliced in among old ones. The authoritative order is `campaign_order.tsv`.

### 4.2 Challenge Tower, Pvp, Arena, Boss, Festival

- Challenge Tower: 300 entries = three blocks of 100 floors (`challenge_tower_levels_count` 100, `challenge_tower_pass_max` 3, `challenge_tower_pass_cost` 5 with `challenge_tower_pass_cost_scale_factor` 2, `challenge_tower_pass_recovery_time` 10,800 s). Each block runs `difficulty_real` 300 .. 38,000 (`difficulty_fake` 100 .. 38,000; the two differ on 14 floors per block) and carries per-floor `rewards` (currency types 1, 3 (rarity 3), 8 (rarity 2), 11 ...). Every one of the 150 level ids appears twice (e.g. `ChallengeTowerLevel 21_ES` at index 0 with difficulty 300 and index 250 with 19,200). Which block a player uses: not found (probably by season/cycle).
- Pvp: 252 entries, `pvpLevelIndex` sequential; `pvp_config` (RC) holds attempts/leaderboard-score fields (`maxAttemptsCount` 5, `minLeaderboardScorePerHouse` 3, `maxLeaderboardScorePerHouse` 7 ...). How the opponent is chosen is not covered here.
- Arena: 155 levels with `arenaConfig`; RC `arena_levels_env` = 5, which presumably indexes `environments[5]` = `EnvironmentDataDarkMine` (inferred from names, section 4.4).
- Boss: `boss_levels` 7 ids (`LevelViewBoss 5_3ES, 1_3ES, 2_2ES, 11_ES, 12_ES, 13_ES, 14_ES`); 32 files exist (31 `LevelViewBoss` + `LevelViewBoss_1 1`).
- Festival (Terminator): 99 listed ids in `terminator_event_levels_config` plus `festivalLevelsRewards, botUnitsInBattle, decreaseCoefficients, increaseCoefficients`; 153 files; festival levels are 1 AI + neutral (avg 2.98 players incl. neutral).

### 4.3 Meta unlock gates that bear on which mode appears when (RC, counted in completed common levels)

`show_daily_tasks_after_level` 5, `show_garage_after_level` 7 / `enable_garage_after_level` 10, `show_arena_after_level` 10 / `enable_arena_after_level` 35, `show_challenge_after_level` 14 (every `show_challenge_per_level` 3), `show_multiplayer_after_level` 3 / `enable_multiplayer_after_level` 17, `enable_event_center_after_level` 18, `enable_challenge_tower_after_level` 25, `show_challenge_tower_after_level` 25, `enable_front_line_supply_after_level` 30, `show_bomb_button_first_level` 4, `show_boost_button_first_level` 4, `show_cargo_first_level` 0, `show_cargo_resources_first_level` 59, `force_change_env_after_level` 20. These are shop/meta gates, not level-content gates.

### 4.4 Environment (visual theme) selection

Not in the level JSON. `CommonLevelManager.TryChangeEnvironmentAfterLevel` (ASM 0x30BAD44) sets `curEnvironmentNumber = (levelIndex / force_change_env_after_level) % envCount`; `envCount` = `EnviromentSettings.environments` length (6). With RC 20 the campaign changes theme every 20 levels. `EnviromentSettings` (dump.cs:L130120; `assets/defaultlocalgroup_scenes/MonoBehaviour/Game.Main.Settings.Environment.EnviromentSettings/_EnviromentSettings_2377.json`) lists, in order: Green (5354), Snow (5348), Lava (5367), Mine (5334), Jungle (5358), DarkMine (5341); extra slots: `dailyEnvironment` = Halloween (5359), `pvpEnvironment` = Pvp (5346), `challengeTowerEnvironment` = Green, Snow, Lava, Mine, DarkMine (pathIDs 5354, 5348, 5367, 5334, 5341), `multiStageEnvironment` (5376), `_festivalEnvironmentData` = Terminator (5379 for `Terminator Event_1` and `_2`). `EnvCreator.GetEnvironmentData` (ASM 0x30AD388) picks by `LoadLevelType`: Daily -> dailyEnvironment[0], Pvp -> pvpEnvironment[0], ChallengeTower -> challengeTowerEnvironment[cur], Festival -> festival preset, everything else (Common, Arena, Boss) -> environments[cur]. Each `EnvironmentData` (dump.cs:L130175) = ground prefab + small/big obstacle mesh + materials for obstacles, river obstacles and river.

### 4.5 Difficulty scaling that is not in the level file

- `dynamic_complexity` (RC; `LevelComplexityParameters` dump.cs:L104650, `LevelsComplexityService` L104919): per level type a percentage in `[bottomBound, upperBound]` changed by `step` on victory/defeat (`ChangeLevelComplexity(bool isOnVictory, LoadLevelType)`), persisted per type (`SavedLevelComplexity`). Defaults: Common step 10, 80..200, `increaseStep` 0; Daily step 10, 80..1000, `increaseStep` 1, `randomBoundValue` 5; PVP step 7, 90..150; Boss step 20, 50..1000, disabled; `change_difficulty_delay` 15. Resets on login after 86,400 s and when the selected unit rarity changes (`ResetGameComplexityToBottomBoundAfterPowerChange`). It "scales bot power" (inferred from names: `levels_power_recommendation_config` low/medium/hard bands 0-105/105-115/115-500, `static_grow_complexity` disabled, `bot_units_level_limit_config` caps bot unit level by rarity: Blue 20, Green 15, Grey 10, Violet 25, Gold/Relict 110, `no_power_limits_for_bots` 1). The level file only sets building levels; the bots' unit power is computed from the player's own power at runtime.
- AI start-level ratio in the shipped list: AI start-level sum / player start-level sum is 1.26 in the first 50 listed levels, 3.3 in positions 57-106, 4.1-4.2 around 108-208, then between 1.9 and 4.2 for the rest - no monotone ramp (`p2_tables.py` output).

---

## 5. Feature-introduction curve (campaign list positions; levelIndex = position - 1)

First list position (1 = first tutorial) at which a feature appears, over the 1,012 levels with JSON:

| Position | Level id | First appearance |
|---|---|---|
| 4 | `LevelView 1` | house (WT1), tower, cargo, AI behaviour `BT` 0 |
| 5 | `LevelView 2_AB` | obstacles (`OBS`), player starts with >= 2 buildings |
| 6 | `LevelView 3_AB` | 3 AIs in one level, scripted AI steps |
| 11 | `LevelView 8_ES` | house WT2 (Attack/tank factory) |
| 24 | `LevelView 101_ES` | walls |
| 36 | `LevelView 111_VL` | mines |
| 45 | `LevelView 786_ES` | house WT3 (Artillery) |
| 47 | `LevelView 886_HM` | AI `BT` 2 (Random) |
| 67 | `LevelView 131_VL` | resource piles (`WOD`) |
| 89 | `LevelView 936_ES` | capture rocket tower |
| 103 | `LevelView 797_ES` | rivers |
| 120 | `LevelView 894_HM` | AI `BT` 1 (Defense) |
| 140 | `LevelView 945_ES` | river obstacles (`ROBS`) |
| 182 | `LevelView 601_ES` | selectable fortress |
| 216 | `LevelView 249_ES` | rocket tower |
| 267 | `LevelView 1095_ES` | trolley |
| 330 | `LevelView 1143_ES` | railway |

Never in the campaign list: `Gate` (Draw only), `Sheep`, `flag`, `fortess`, boss tower/player (Boss family only). After position 330 nothing new appears: from there the list is a shuffle of the same feature set. Earlier positions contain 1-3 AIs in all combinations from position 6 on (n_ai 1/2/3 = 268 / 456 / 288 over the list), so enemy count is not a difficulty axis.

Feature prevalence per block of 100 campaign levels that have JSON (percent of levels containing the feature; list-position ranges are approximate because 12 prefab-only entries are skipped; from `p2_campaign.py`/`p2_tables.py`):

| list pos | levels | avg bld | avg AI | OBS | River | Mine | Wall | Cargo | WOD | WT2 | WT3 | tower | RT | SF | CRT | trolley | rail | AI steps |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4-107 | 100 | 8.0 | 1.80 | 83 | 1 | 24 | 25 | 76 | 15 | 58 | 24 | 50 | 0 | 0 | 6 | 0 | 0 | 62 |
| 108-208 | 100 | 8.1 | 2.04 | 86 | 29 | 25 | 33 | 60 | 32 | 66 | 38 | 35 | 0 | 11 | 22 | 0 | 0 | 64 |
| 209-311 | 100 | 9.1 | 1.94 | 89 | 30 | 23 | 25 | 44 | 24 | 57 | 38 | 25 | 44 | 31 | 15 | 11 | 0 | 65 |
| 312-412 | 100 | 9.2 | 1.99 | 90 | 26 | 18 | 37 | 47 | 35 | 51 | 36 | 42 | 47 | 15 | 12 | 7 | 17 | 75 |
| 413-512 | 100 | 8.9 | 2.14 | 89 | 23 | 24 | 35 | 58 | 42 | 63 | 27 | 40 | 33 | 19 | 14 | 7 | 10 | 64 |
| 513-612 | 100 | 8.9 | 1.99 | 92 | 25 | 26 | 34 | 66 | 46 | 64 | 28 | 44 | 32 | 22 | 11 | 8 | 7 | 48 |
| 613-712 | 100 | 8.8 | 1.97 | 91 | 33 | 33 | 45 | 65 | 45 | 65 | 31 | 35 | 39 | 19 | 14 | 8 | 8 | 47 |
| 713-812 | 100 | 8.9 | 2.16 | 86 | 14 | 26 | 59 | 66 | 58 | 66 | 27 | 47 | 30 | 19 | 12 | 6 | 6 | 53 |
| 813-912 | 100 | 9.1 | 2.12 | 85 | 9 | 53 | 58 | 72 | 56 | 72 | 25 | 36 | 17 | 19 | 9 | 6 | 5 | 69 |
| 913-1012 | 100 | 9.7 | 2.02 | 90 | 15 | 37 | 43 | 46 | 53 | 67 | 30 | 28 | 30 | 20 | 8 | 11 | 6 | 64 |
| 1013-1024 | 12 | 9.7 | 2.25 | 83 | 25 | 17 | 25 | 0 | 50 | 58 | 67 | 25 | 17 | 8 | 17 | 17 | 17 | 83 |

Reading: obstacles are near-universal from the start (83-92%); rivers stay at 1% until position ~103 then 9-33%; walls and mines rise slowly (peak around positions 713-912); cargo falls from 76% to 44-72% while resource piles rise from 15% to 42-58%; rocket towers first appear at ~216 and reach 30-47% by 312; selectable fortresses 11% -> ~20%; capture rocket towers 6-22%; trolleys 7-11% and railways 5-17% from ~312; 62-75% of levels script at least one AI step in the first 100 and 47-75% later. Average buildings per level 8.0 (first 100) rising to about 9-9.7; the human starts with exactly 1 building in 622 of 1,012 levels, 2 in 219, 3-10 in the rest.

---

## 6. Statistics (all 2,195 assets unless stated)

Level counts and shape by family (`stats_families.json`):

| Family | Levels | Avg buildings | Avg AI | Notes |
|---|---|---|---|---|
| LevelView | 1,237 | 8.9 | 2.05 | 1,214 v1 + 23 v0 |
| LevelViewPvp | 256 | 9.8 | 1.81 | 5 v0 |
| ChallengeTowerLevel | 171 | 9.4 | 2.15 | |
| LevelViewArena | 155 | 9.3 | 1.00 | 1v1 only |
| TerminatorLevelView | 153 | 9.3 | 1.00 | 1v1 only |
| LevelViewDraw | 130 | 7.7 | 2.22 | 97% have gates |
| LevelViewDaily | 56 | 9.7 | 1.98 | 95% WT2 houses, no WT3 |
| LevelViewBoss | 32 | 11.8 | 0 | `b_p` + 1 boss tower, 100% |
| Test* | 5 | 2-9 | 1-2 | |

Player-count combos (AI, neutral, boss): (1,1,0) 829, (2,1,0) 750, (3,1,0) 581, (0,1,1) 32, (1,0,0) 3. Buildings per level min 2, median 9, max 18, mean 9.08.
Totals: buildings 22,177 (house 17,094; tower 1,093; resource 2,254; rocket tower 860; selectable fortress 340; capture rocket tower 266; trolley 188; flag 50; boss tower 32). Map objects: Mine 11,602; OBS 8,019; Wall 3,810; Cargo 2,932; ROBS 678; River 693; Sheep 386; Gate 375; Railway 96.
Campaign (RC list, 1,012 levels with JSON): 4-18 buildings, `n_build` mode 8-9; neutral houses are 9,051 of 17,094 houses corpus-wide.
Share of levels containing a feature, by family (excerpt): Daily - Mine 61, Wall 66, Cargo 89, WOD 71; Draw - Gate 97, OBS 98, tower 65, no river/rocket; Arena - River 26, rocket tower 30, WT3 61; Boss - ROBS 35, River 35, s_f 32; Pvp - River 30, rocket tower 35, Cargo 67; ChallengeTower - OBS 94, Mine 33, Wall 40.
Duplicates: 10 content-identical pairs exist across families (e.g. `LevelViewArena 18_SO` = `TerminatorLevelView 52`, `LevelViewDraw 89_ES` = `97_ES`), so 2,185 unique layouts.

---

## 7. What the format does not contain

No win/lose condition, time limit, star thresholds, difficulty number, environment, music, camera, seed or randomisation hook; no explicit lane/graph constraint (ways are drawn at runtime between buildings; obstacles/rivers/gates act physically on the drawn ways - runtime behaviour belongs to the combat/path direction, not here). Hand-built prefab levels (12 of the campaign) carry extra scripted tutorial logic (`BaseTutorial`) that is not data.

---

## 8. Proposed lossless schema for our side: `tw-level-ext` v0.1

Design rules: (1) one-to-one with the game format so nothing is dropped (`extra` buckets catch unknown keys); (2) semantic names instead of 1-3 letter keys, driven by one key table (`KIND_FIELDS` in `p2_tw2na.py`) so reader and writer are generated from the same data; (3) vectors as `[x, y, z]`; (4) building `id` and all cross-references (`ownHouse`, `targetHouse`, `building`, `connectedBuilding`) keep the game ids; (5) engine-neutral: it is the content half of a future data-driven engine, our sim registry (section 10) consumes it through a projection.

```jsonc
{
  "schema": "node-arena/tw-level-ext@0.1",
  "id": "levelview-277-es",            // slug of the asset name, ^[a-z0-9][a-z0-9-]*$
  "name": "LevelView 277_ES",
  "category": "campaign|daily|daily-unlisted|pvp|challengeTower|arena|boss|festival|other",
  "source": { "game": "tower-war", "gameVersion": "1.29.3", "asset": "LevelView 277_ES",
              "family": "LevelView", "number": 277, "author": "ES", "dialect": "v1-short|v1-long|v0" },
  "players": [ { "type": "player|ai|neutral|boss", "pt": 0, "color": "blue", "pc": 0, "slotKey": "p|ai_p|n_p|b_p",
                 "ai": { "actionDelay": 10.0, "reactionDelayMin": 3.0, "reactionDelayMax": 4.0, "behavior": 1,
                         "steps": { "delaySteps": [{"index":0,"delay":3.0}],
                                    "createWaySteps": [{"index":0,"ownHouse":1,"targetHouse":4,"attackDelay":3.0}],
                                    "railwayMoveSteps": [{"index":0,"targetPathPointIndex":1,"building":9}],
                                    "actionSteps": [{"index":0,"action":{"goal":1,"ownHouse":1,"targetHouse":6,"startDelay":3.0,"then":[ /* recursive */ ]}}] } },
                 "nullSlots": [3] } ],           // indices of null BD entries (lossless)
  "buildings": [ { "owner": 0, "kind": "house", "id": 1, "style": 1, "pos": [0.14, 0.0, -3.69],
                   "params": { "warriorType": 1, "level": 10, "maxLevel": 64, "canBeIgnored": false,
                               "spawnWarriorSpeed": 0.5, "coefByWayCount": 0.3, "spawnCoef": 1.7, "growLevelTime": 1.7 },
                   "key": "h", "longKeys": true /* only when the source used the long dialect */ } ],   // owner null = WOD
  "mapObjects": { "obstacles": [{"parentPos":[..],"parentRot":[..],"childPos":[[..]],"childRot":[[..]],"active":[true]}],
                  "riverObstacles": [], "mines": [{"pos":[..],"rot":[..],"active":true}],
                  "walls": [{"pos":[..],"rot":[..],"active":true,"hp":5,"punchStrength":15.0}],
                  "sheep": [{"pos":[..],"rot":[..],"active":true,"delayToReturn":5.0,"isSquare":false}],
                  "rivers": [{"pos":[..],"rot":[..],"type":5,"bridgeWidth":1.014,"distance":0.2}],
                  "cargo": [{"building":4,"points":[[..]]}],
                  "gates": [{"type":0,"coef":2,"pos":[..],"rot":[..]}],
                  "railways": [{"pos":[..],"connectedBuilding":3,"pathPoints":[[..]],"startPathPointIndex":0}] }
}
```

Per-kind `params` keys (generated): house `warriorType level maxLevel canBeIgnored spawnWarriorSpeed coefByWayCount spawnCoef growLevelTime`; tower `level maxLevel canBeIgnored attackDelay attackRadius speedUpByLevel radiusUpByLevel bulletSpeed`; rocket_tower `level maxLevel canBeIgnored delayToShoot coefByLevelUp`; selectable_fortess `warriorType level maxLevel canBeIgnored spawnWarriorSpeed coefByWayCount spawnCoef attackCooldown bulletSpeed spawnedWarriorCount warriorsCountPerParachute delayTimeToSpawnCargo`; capture_rocket_tower `level maxLevel canBeIgnored startChargingPoints maxChargingPoints chargingCooldown`; boss_tower `configuredMovePositions movePositions canBeIgnored`; trolley `level maxLevel`; flag `level maxLevel canBeIgnored`; fortess `level maxLevel canBeIgnored attackCooldown bulletSpeed`; resource `rotation count`.
A full draft-07 JSON Schema generated from the same tables is at `/root/projects/tower-war/_extract/converted/tw-level-ext.schema.json` (13.5 KB; per-kind `params` with `additionalProperties:false`, enums for kind, player type/colour, AI goal/behaviour, recursion via `definitions/aiAction`). All 2,195 converted levels validate (jsonschema, Draft 7).

Content-level ids to keep in mind when we version it: `contentVersion` must move when level hashes move (CONTENT_GUIDE), so the extended schema should live under its own `schemaVersion` family until the sim can consume it.

---

## 9. Converter design and prototype results

Pipeline (`p2_tw2na.py`, plus `p2_levellib.py`):

1. Detect dialect by key presence (`P` -> v1; `BuildingsType`/`Id` inside a building entry -> long; `Player` -> v0).
2. v0 only: `v0_to_v1` (per-type lists `H T R F SF FL CRT TR` -> `BD` with `bt`/`key`, upper-case keys through `V0_KEYMAP`, `Res` -> `WOD`, `Nplayer` -> `n_p`, `B_AI` -> `b_p`).
3. `to_ext`: players, `buildings` (flatten BD per owner index and WOD with owner null), `mapObjects` through the `MAPOBJ` table, AI scripts through `ai_to_ext`. Unknown keys go to `extra`, null BD slots to `nullSlots`, long dialect to `longKeys`.
4. `ext_to_raw` is the exact inverse (same tables), used as the lossless proof.
5. `project_na_v1` is the lossy projection to our `LevelSchema` (section 10) with a per-level report (what was dropped, clamped, auto-scaled).
6. `validate_na` re-checks the projection: JSON Schema (`packages/content/schemas/level.schema.json`), footprint inside bounds, no footprint overlap, 1-3 bots, every player owns a tower. The TypeScript validator (`validate-content.ts`) was not run (kept light).

Results (run with `python3 -I /root/projects/tower-war/_tools/p2_tw2na.py roundtrip|validate|samples`):

- `roundtrip`: 2,195 levels, 2,195 lossless, 0 failed (v1-short 2,089, v1-long 76 exact equal to the raw parsed JSON including list order, null slots, key spelling; v0 30 equal after normalisation; also stable through a JSON text round trip).
- `validate`: 2,195 / 2,195 valid against the generated schema.
- Projection of the 1,012 campaign levels with JSON: 982 valid and playable; 30 not playable (after dropping non-houses fewer than 2 owners remain); 119 clamp a house level above NA's cap 50; 142 levels lose an AI player who owns no house; auto-scale never needed at scale 6.
- Sample set (14 levels, `samples_report.txt`): `LevelView 1, 3_AB, 8_ES, 101_ES, 111_VL, 277_ES, 936_ES, 1143_ES`, `LevelViewDraw 20_VI`, `LevelViewBoss 5_3ES` (not playable: no bot after dropping the boss), `ChallengeTowerLevel 21_ES`, `TerminatorLevelView 36_ES`, `LevelViewPvp 1_ES`, `LevelViewArena 1_ES`: all 14 lossless; 13 valid NA v1 levels, 1 correctly flagged unplayable.

Edge cases the converter handles because they occur in the data: 7 null BD entries; long-dialect rocket tower start level `SL` vs `L` elsewhere; `wt` (short) vs `WT` (long) for selectable fortress; mixed `Id` namespace between BD and WOD (resource ids fill the gaps); `AiSA.OS` recursion to depth 4; boss `B_` prefix and missing `B_AiRM`; empty-list vs null step lists.

---

## 10. Projection to the current Node Arena engine and gaps

Current engine (doc `06a-node-arena-baseline.md`): towers on a flat rectangle, one troop kind of value 1, straight tower-to-tower lines, no obstacles (the validator rejects non-empty `obstacles`/`mapObjects`, `validate-content.ts:144`), 1 human + 1-3 bots, 4 components (garrison, generates, drawsLines, capturable), levels patch only whole-archetype params.

Projection rules implemented (all configurable in `project_na_v1`):

| TW element | NA v1 mapping | Loss |
|---|---|---|
| world (X, Z) | `pos = (X*s, Z*s)`, `s` = 6 (auto-raised only if min distance * s < 2r) | scale is a choice; TW units are < 1 per footprint |
| bounds | fixed 2*(9.8*s+r+1) x 2*(9.2*s+r+1) so framing is consistent | per-level extents |
| PT 0 player | `human p1`, `colorKey player.1` | |
| PT 1 AI | `bot bN` with `botProfile = <personality>-<tier>`: personality from `BT` (0 rusher, 1 turtle, 2 opportunist), tier from `AD` (<=3 hard, <=7 normal, else easy) | `MinRD/MaxRD`, scripted `AiSC/AiCWS/AiDS/AiRM` dropped (601 of 1,012 campaign levels script steps) |
| PT 2 neutral | tower with `owner: null` | |
| PT 3 boss | dropped (boss levels are unplayable in v1) | |
| house | tower archetype `standard`, `garrison = min(l, cap 50)` | `WT` (unit type 1/2/3), `ml`, `ws/cwc/sc/gl`, `cbi` |
| tower, rocket tower, selectable fortress, capture rocket tower, trolley, flag, boss tower | dropped | all shooters and special spawners |
| WOD resource | dropped | |
| OBS, ROBS, Mine, Wall, Sheep, River, Cargo, Gate, Railway | dropped (NA `mapObjects: []`) | all map objects |

What TW levels require that our engine lacks (ranked by how many levels need it, campaign 1,012 levels):

1. Obstacles/decor: 891 levels (R-LIN-04: "V1 has no functional obstacles or map objects"). Needed: static blockers for line drawing (render-only at first: `obstacles` cluster list could ship as presentation data).
2. Scripted AI: 601 levels. Bot schema has no preset action trees; needs a `script` bot kind (step list: wait, create line own->target, capture, railway move) plus per-bot `reactionDelay` range.
3. Cargo points: 600 levels (reward drops); a new component/system, no sim equivalent.
4. Resource piles: 412 levels; carried by troops in TW (collect), needs a collectable component.
5. Walls (397), mines (291), rivers with bridge-building (208), railways (61), gates (Draw only): each needs a new rule (damage/hp, hazard, bridge build, rail movement, arithmetic on passing troop value) with permanent `R-...` ids and a content component registry entry; the sim supports new components and phases (`registerPhase`), the content registry and the validator reject them today.
6. Ranged/active buildings: tower (385), rocket tower (274), selectable fortress (176), capture rocket tower (125), trolley (66), flag, boss tower: need a `shoots` component (sim extensibility test exists) and projectile entities; house `WT` needs multi-troop kinds (`value` 1 only today, `component-registry.ts:29`).
7. Per-instance tower parameters: levels are per-building (`l`, `ml`, `ws` ...), our levels only patch whole archetypes. Needs `tower.params` overrides per instance (garrison cap per tower), or synthesised archetypes.
8. Garrison > cap clamp (119 levels): TW house cap is 64 (RC `max_units_from_house` 30 spawn cap per house is a separate rule); NA standard cap is 50.
9. Neutral towers that shoot (845 neutral towers corpus-wide) and neutral rocket towers: NA neutral is passive.
10. Win/lose per-level details (`cbi` canBeIgnored, per-level time limit) and the dynamic-complexity percentage have no home in our level schema.
11. Per-category selection logic (skip/loop/modulo, per-mode index) lives in code in TW; NA's campaign is a `order`/`band` sort, so a loop-after-last rule would be new app logic.
12. Environment theme by index (20-level cycles of 6 themes) maps cleanly onto `levelVisuals` / `themes` in the NA manifest; no engine work.

Recommendation: keep the extended level as the single content source, add an `export: "na-v1"` build step that regenerates NA levels from it (so the 982 convertible levels ship as an early campaign), and grow the engine one feature at a time in the order of the introduction curve (section 5: second troop kind -> walls/mines -> resources -> rivers -> rocket/selectable towers -> trolley/railway), each time lifting the matching `dropped[...]` counter.

---

## 11. Contradictions, uncertainty and gaps

- Counts differ slightly from doc 01 because I include v0 files and WOD entries (houses 17,094 incl. 30 v0 files vs 16,830 + 593 long + ...; doc 01 counted 2,165 files). Both agree on per-kind keys.
- RC `levels` order is the APK default; the live config may differ (order and count). The loop formula depends on `skip_levels_count` (49) and the tutorial flags read from that same list.
- `challenge_levels` -> Daily is read from `InitializeLevels` disassembly; the name suggests "challenge", the contents are Draw levels. If a live config overrides, behaviour could differ. `LevelViewDaily` (56 files) unreferenced in defaults.
- Meaning of `l` (start level) as garrison count and of `BT` as Attack/Defense/Random is inferred from names (doc 01 treats level as the garrison driver; no body decompilation of `House` growth). Same for river `T`/bridge semantics, sheep `IsS`, `cbi`.
- How the 3 Challenge Tower blocks of 100 are chosen, how Arena/Pvp opponents choose their level, and the exact winning condition were not found (code only).
- Camera: static values read; runtime aspect adaptation not found.
- 12 prefab-only campaign levels (3 tutorials + 9 hand-built) and 2 Draw prefabs are not converted: transforms of the prefab objects are not in `hierarchy/*.json`; a UnityPy pass over the `Transform` objects of those prefabs would recover positions. The tutorials also carry `BaseTutorial` scripts that are not data.
- RC defaults for `dynamic_complexity` differ from another blob embedded in the binary (step 25, upperBound 1000), so the effective values are server-side.
- Not verified by running the TS validator or the sim on projected levels; `p2_tw2na.py validate_na` replicates the geometry rules only.

## 12. Reproduce

```
cd /root/projects/tower-war/_tools
python3 -I p2_tw2na.py roundtrip     # 2195/2195 lossless
python3 -I p2_tw2na.py validate      # ext schema validation, writes tw-level-ext.schema.json
python3 -I p2_tw2na.py samples       # 14 sample levels -> _extract/converted/{ext,na-v1}, samples_report.txt
python3 -I p2_stats.py; python3 -I p2_campaign.py; python3 -I p2_tables.py; python3 -I p2_params.py campaign
```
Disassembly helpers (scratch, not kept): capstone in a throw-away venv, `file offset = RVA - 0x4000`, symbol map from `il2cpp/script.json`.
