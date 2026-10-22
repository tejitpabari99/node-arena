# Tower War v1.29.3 - characters, units, towers and art teardown (direction P1)

Scope: how Vaveda built warriors/units and buildings (stats, skins, factions, visual tiers, prefab composition, keying/modularity) plus a porting asset catalog and GLB conversion path for Node Arena.
Date 2026-10-21. All paths below are under `/root/projects/tower-war/_extract` unless absolute. Nothing was copied into this repo.
Machine-readable companion: `/root/projects/tower-war/_extract/catalog/units_buildings.json` (outside repo). Helper scripts: `/root/projects/tower-war/_tools/p1_*.py`.
Citation key: `dump.cs:Lnnn` = `il2cpp/dump.cs`; `CFG:` = `assets/defaultlocalgroup_scenes/MonoBehaviour/...`; `HIER:` = `.../hierarchy/...`; `RC:` = SayKit remote-config defaults `assets/data_unity3d/TextAsset/saykit_mlltrna_1.29.3_98.json` (key `game_settings`).

## 0. Headline findings

1. **Only 3 warrior archetypes** (enum `WarriorType` Default=1, Attack=2, Artillery=3, dump.cs:L155583). Base stats are tiny integers in three ScriptableObjects (`WarriorParamsConfig`); everything else (power, HP scaling, speed/resurrect/double-unit/gold bonuses, rage skills) comes from the chosen **skin** (`WarriorSkinData`, 43 assets) plus level/artefact upgrades computed at runtime (`InGameWarriorSkinData`, dump.cs:L125992).
2. **Skins are the art + bonus unit**: 17 Default ("soldier"), 13 Attack ("tank"), 13 Artillery. Each skin = data asset -> battle prefab (`WarriorSkinModel`, rigid-part meshes, NOT skinned) + garage/shop prefab (separate, higher-poly, soldiers are skinned with 34 bones) + 4 team textures.
3. **Team colouring is by texture swap, not tint**: skin prefab carries a placeholder `Default-Material`; at spawn `WarriorSkinModel.SetMaterial(Material)` (dump.cs:L124415) swaps in one of 4 per-colour Mobile/Diffuse materials, each with its own 256x256 colour-atlas PNG (same mesh/UV). Buildings use the same pattern via `PlayerMaterialsData` (5 assets, one per `PlayersColors`).
4. **Buildings**: 11-value enum `BuildingsType` (dump.cs:L166431); 10 have prefabs in the APK (plain Fortess prefab exists but is used in 0 saved levels); SpeedTower has class + materials only, no prefab. All gameplay numbers are serialized fields on the prefab MonoBehaviours and are **overridden per-instance by short JSON keys in the level files** (`l`, `ml`, `ws`, `sc`, `gl`, `ad`, `ar`, ...).
5. **Visual tiers**: buildings have 3 art stages (mesh swap and/or child enable-lists) driven by `HouseArt.meshesByLevelHouse` + `enableArtByLevel`; unit skins have no tiers. Stage thresholds (which house level maps to stage 0/1/2) are **not serialized** (not found; code).
6. **Animation**: no skinned meshes in battle models. Battle soldiers = ~8-18 rigid mesh nodes driven by Unity Animator with only 3-4 baked clips (Run, Death, ParachuteFly (+Dash, RageForsage)); tanks/artillery have no animator (parts such as turrets rotated by code). I decoded the generic-clip StreamedClip data into per-node TRS tracks (`catalog/anim_unit_clips.json`) and wrote prototype GLB writers; all 43 battle skins and 15 building prefabs now have a prototype GLB (`catalog/glb_proto*`).
7. **Exporter bug found (affects other agents)**: `defaultlocalgroup_scenes` bundle holds two serialized files (`CAB-933d...sharedAssets` 5724 objs + `CAB-933d...` 1271 objs) whose pathIDs 1..1271 collide; `_tools/export_assets.py` keys its typetree cache by pathID only. Consequences: `assets/defaultlocalgroup_scenes/Material/*.json` (203) and `.../AnimationClip/*.json` (57) contain GameObject typetrees (wrong); component `type`/`script` labels in `scenes/hierarchy/*.json` for pathIDs <=1271 are mislabelled (e.g. real MeshFilters shown as RectTransform, see `10_CowboyDefaultWarriorSkin_2656.json` node `body` comps `Transform#1738, RectTransform#723, MeshRenderer#4221`). Re-read correctly into `catalog/scenes_shared_reread.json` (materials, clips, controllers, PlayerMaterialsData) and `catalog/prefab_parts_scenes.json`. Meshes (pid>1271), PNG textures and the MonoBehaviour settings JSON checked here are fine.

## 1. Units (warrior archetypes)

### 1.1 Base stats (`WarriorParamsConfig`, class dump.cs:L125669; list `CFG:Game.Main.Settings.Warriors.WarriorSettings/WarriorSettings_5314.json` -> pids 5340, 5365, 5332)

| warriorType | asset (path under `CFG:Game.Main.Settings.Warriors.WarriorParamsConfig/`) | attack | defense | hitPoints | speed | countSpawned | speedUpCoefficient | maxSpeed |
|---|---|---|---|---|---|---|---|---|
| 1 Default | `DefaultWarriorData_5340.json` | 1 | 1 | 1 | 5 | 1 | 1.2999999523162842 | 7.5 |
| 2 Attack (tank) | `AttackWarriorData_5365.json` | 2 | 1 | 2 | 5 | 1 | 1.2999999523162842 | 7.5 |
| 3 Artillery | `ArtilleryWarriorData_5332.json` | 1 | 1 | 1 | 5 | 1 | 1.2999999523162842 | 7.5 |

Note: stats are almost identical; the combat identity of the types is in prefabs/behaviours (artillery fires projectiles, tank is tougher/bigger), not in this table. The runtime HP is further scaled by remote-config `hp_config` = `{"isEnabled": true, "hpParameters": [{"unitType": 1, "hpCoefficient": 1}, {"unitType": 2, "hpCoefficient": 2}, {"unitType": 3, "hpCoefficient": 1}], "showTutorialLevel": 11}` (RC key `hp_config`). Caps: `max_unit_level` 110, `max_units_from_house` 30 (RC). Per-unit `InGameWarriorSkinData` also carries `_power`, `_hpBasedOnPower`, `_level`, artefact bonuses (dump.cs:L125992); the formula is code (not found).

### 1.2 Unit entity prefabs (battle) - same composition for all three
- Default: `HIER:scenes/hierarchy/1_MilitaryDefaultWarrior_2489.json`; Attack: `1_MilitaryAttackWarrior_2478.json`; Artillery: `1_MilitaryArtilleryWarrior_2467.json`.
- Root components: `WarriorBase` (artillery: `WarriorArtillery`, dump.cs:L121738) with `warriorType`, links to `WarriorPhysics`, `WarriorArt`, `WarriorRageSkillController`, `SpeedBoosterUpgradeHandler` (`CFG:Game.Main.Warriors.WarriorBase/1_MilitaryDefaultWarrior_5422.json`); collider (Sphere for soldier/tank, Box for artillery).
- Children: `UnitContainer` (skin model is instantiated here at runtime), `UnitShieldSpawnPoint`, `HpBarSpawnPoint`; soldiers also have an inactive `CargoParachute` (6 meshes + Animator) for air-drop.
- `WarriorPhysics` values (CFG:`Game.Main.Warriors.WarriorPhysics/`): Default `pushForce 125.0, delayToDeath 1300, bonusDelayToDeath 4000`; Attack `150.0, 1250, 0`; Artillery `125.0, 1300, 4000`.
- `WarriorArt` (dump.cs:L120694): `_appearAnimationDuration 0.15`, `_appearAnimationDelay 0.2`, `coefficientDelayBetweenResource 0.15`, appear curve 0->1 linear-ish.
- Artillery attack component `ArtilleryWarriorComponent` (`WarriorArtilleryController`, dump.cs:L121757): `bulletSpeed 9.5, firstAttackDelay 0.4000000059604645, nextAttackDelay 1.2000000476837158, sphereColliderRadius 4.0` (`CFG:Game.Main.Warriors.WarriorArtilleryController/ArtilleryWarriorComponent_5509.json`).
- HP bar prefab `HIER:scenes/hierarchy/WarriorHpBarBack_2471.json` (3 SpriteRenderers; colours green/yellow/red in `WarriorHpBarView` MB `..._5411.json`). Shield VFX `ImmrotalShiled_2442.json` with per-colour shield tint (`WarriorShieldColorChanger`: Blue (0.337,0.820,1.0,0.90), Green (0.384,1.0,0.345,0.90), Red (1.0,0.267,0.212,0.80), Yellow...).
- Group wrapper `WarriorGroup_2494.json` (empty MB; groups units spawned together). Skydiver `Skydiver_2470.json` (fake air-drop unit for the trooper booster, `FakeSkydiverUnit`).

### 1.3 Rage skills (per-skin ultimate), `RageSkillsType` dump.cs:L155512
| id | type | prefab MB values (CFG:`Game.Main.Warriors.Rage*Skill/`) | RC `rage_skills_config` |
|---|---|---|---|
| 1 | RageDash (loc "Frenzy") | `_percentBonusSpeed 15.0, _durationTime 0.5` | damageCoefficient 2, shield-ignore, immortal state |
| 2 | RageFlamethrower ("Napalm") | `_attackDistance 5, _durationTime 2.0` | damageCoefficient 1 |
| 3 | BurningEarth | `_burningEarthSkillParams {_attackCooldownTime 0.5, _startAttackDelay 0.5, _lifeTime 1.5, _damageableTypes [0,1,3,98]}` | damageCoefficient 1, stop-damage 1 s per target type |
| 4 | Forsage ("Afterburner") | `_percentBonusSpeed 25.0, _bonusDamage 1, _bonusDefence 1` | damageCoefficient 2 |
| 5 | Hail | `_bonusAimsCount 1` | damageCoefficient 2 |
| 6 | Annihilation | `_bonusSpeed 5.0, _stopWarriorMoveTime 0.1, _minTriggerDistance 1.0` | damageCoefficient 99999 |
| 7 | LaserCannon | `_bonusSpeed 5.0` | damageCoefficient 0.5 |
Localization also lists `rage_skill_frost_drill`, `rage_skill_hurricane` (raw/saykit_localization_en.json) with **no matching enum/prefab in this APK** (live-ops content not shipped; inferred from names).
Skin->skill: see `rageSkillsType` column in 2.2. The `rageSkill` ref on the skin's `WarriorSkinModel` MB (verified non-zero only for 11_Attack->5602 Flamethrower, 14_Attack->5608 Laser, 12_Fire(default 12)->5609 Dash, 15_Girl->5580 Forsage, 17_T800->5591 Annihilation, 11_Artillery->2349 BurningEarth, 12_Artillery->5613 Hail) matches `rageSkillsType` on the `WarriorSkinData`.

### 1.4 Unit animation (battle soldiers)
- Controllers (`CFG scenes AnimatorController`, re-read in `catalog/scenes_shared_reread.json` `ctrls`): `1_BaseWarriorAnimations`, `12_FireWarriorAnimations`, `15_GirlWarriorAnimations`, `17_T800WarriorAnimations` + 13 `AnimatorOverrideController`s (`N_OverridedWarriorAnimations`) that swap clips onto the base graph. States (m_TOS): Default(idle), Run, ParachuteFly, Death (+Forsage state in #15; an extra `Annihilation` name in #17). Parameters (dump.cs:L124351 static ids `animate, resetTrigger, death, parachuteIdle`; m_TOS also lists `GravityWeight`, inferred a float).
- 53 unit clips decoded (+4 Cargo clips not decoded): Run 0.533-0.567 s loop, Death 1.13-1.72 s no loop, ParachuteFly 0.5-1.17 s loop, `12_Dash` 0.5 s, `15_RageForsage` 0.333 s. 30 fps sampling, tracks = per-node position/rotation(quat)/scale only (`catalog/anim_unit_clips.json`).
- Oddity: skin 2 (Swat) uses `8_OverridedWarriorAnimations` and skin 8 (Aviator) uses `2_OverridedWarriorAnimations` (and materials `8_SwatGarageWarriorSkin` / `2_AviatorGarageWarriorSkin`): naming swapped, harmless.
- Tanks and artillery: `animator` pid is 0 in all 13+13 Attack/Artillery `WarriorSkinModel` MBs (verified by script over `CFG:Game.Main.Skins.WarriorSkinModel/*` and `...ArtilleryWarriorSkinModel/*`) -> static rigid parts; artillery has `tower` and `bulletSpawnPoints[]` refs (dump.cs:L124314) so the gun is aimed/spawned by code. Wheels/tracks are not animated by clips.

## 2. Skins (43 `WarriorSkinData`)

### 2.1 Data model
`WarriorSkinData` (ScriptableObject, dump.cs:L125754; assets `CFG:Game.Main.Settings.Warriors.WarriorSkinData/*.json`, 43 files; registry `.../WarriorSkinSettings/_WarriorSkinsSettings_5325.json` fields `defaultWarriorSkinsData` (3 = the three `1_Military*` skins), `warriorSkinsData` (43), `raritySkinsDataInfo` (6)).
Fields: `warriorSkinType` (WarriorType) | `warriorSkinRarity` (`SkinRarity` dump.cs:L155485: Grey=1 Green=2 Blue=3 Violet=4 Gold=5 Relict=6) | `warriorSkinId` | `skinName.value` (localization key `garage_name_<unit|tank|artillery><id>`) | `warriorSkinPrefab` (PPtr to `WarriorSkinModel` MB = battle prefab, same bundle) | `garageWarriorSkinPrefab` (Addressables `AssetReference` GUID = garage/shop prefab) | `warriorSkinIcon` (Sprite in assets bundle) | bonuses `movementSpeedBonus, resurrectionChance, doubleUnitChance, goldBonus` | `rageSkillsType, rageChance` | `skinExtraStatsType` (`SkinStatsType` dump.cs:L155499: Gold=0 MovementSpeed=1 Resurrection=2 DoubleUnit=3 Rage=4 None=5) + `addExtraStatBonusPerStep` | `isAvailableToSummon, isAvailableFromInApps, isLimited` | `warriorSkinMaterialsData[4]` = {`playerColor` (PlayersColors Blue=0 Green=1 Red=2 Yellow=3, dump.cs:L155318), `skinMaterial`} | `skinsDataInfo` -> `RaritySkinsDataInfo`.
Bonus units are percent-like numbers (e.g. `resurrectionChance 0.8`, `goldBonus 10.0`); semantics (percent vs fraction) are code (not found).

### 2.2 Rarity progression (`RaritySkinsDataInfo`, dump.cs:L125557; `CFG:Game.Main.Settings.Warriors.RaritySkinsDataInfo/`)
Per-level increments added on top of the skin's base bonus:
| rarity | asset | +moveSpeed/lvl | +resurrect/lvl | +doubleUnit/lvl | +gold/lvl | +rage/lvl |
|---|---|---|---|---|---|---|
| 1 Grey | `1_GreyRaritySkinsDataInfo_5364` | 0.35 | 0.15 | 0.15 | 0.25 | 0 |
| 2 Green | `2_Green..._5338` | 0.40 | 0.25 | 0.25 | 0.40 | 0 |
| 3 Blue | `3_Blue..._5381` | 0.50 | 0.30 | 0.30 | 0.50 | 0 |
| 4 Epic/Violet | `4_Epic..._5343` | 0.60 | 0.35 | 0.35 | 0.60 | 0 |
| 5 Legendary/Gold | `5_Legendary..._5337` | 0.70 | 0.35 | 0.35 | 0.70 | 0 |
| 6 Relict | `6_Relict..._5375` | 1.00 | 0.40 | 0.40 | 0.80 | 0.20 |
Upgrade costs/tokens are not in the asset (non-serialized fields) but in RC: `rarity_upgrade_data` (StartPrice/AddPriceByLevel: Grey 25/25, Green 65/35, Blue 150/50, Violet 185/65, Gold 220/80, Relict 240/110; AddPercentToPriceByStage 20, StartAddPercentPriceByStage 60), `tokens_upgrade_list`, `evolve_tokens_upgrade_config` (stage unlock at levels 35/60/85).

### 2.3 All 43 skins
Columns: spd/res/dbl/gold = `movementSpeedBonus/resurrectionChance/doubleUnitChance/goldBonus`; S/I/L = isAvailableToSummon / isAvailableFromInApps / isLimited; tris/parts = battle model total triangles / mesh parts (from OBJ, `catalog/skins.json`); Garage prefab is **inferred from names** (1:1 pattern, GUID not resolved - see section 9); "GWS"=GarageWarriorSkin.
Names are from `raw/saykit_localization_en.json` (`garage_name_*`). Source asset for each row: `CFG:Game.Main.Settings.Warriors.WarriorSkinData/<id>_<...>.json` (full list with file names in `catalog/units_buildings.json` `skins[].skinDataAsset`).

| Type | id | Name (loc) | Rarity | Battle model prefab (hier.) | tris/parts | spd/res/dbl/gold | rage (type, chance) | extra stat (type,step) | S/I/L | Garage prefab (inferred) tris |
|---|---|---|---|---|---|---|---|---|---|---|
| Default | 1 | John Doe | Grey | 1_DefaultWarriorSkin | 1036/9 | 1/0/0/0 | -, 0 | MoveSpd, 3 | SI- | 1_DefaultGWS 3898 |
| Default | 2 | Fast Howard | Grey | 2_SwatDefaultWarriorSkin | 1296/11 | 0/0/0.5/0 | -, 0 | Double, 2 | SI- | 2_SwatDefaultGWS 5112 |
| Default | 3 | Toxic Flamel | Green | 3_ChemistDefaultWarriorSkin | 1404/12 | 0/1/0/0 | -, 0 | Resurr, 2 | SI- | 3_ChemistDefaultGWS 5982 |
| Default | 4 | Vegas | Green | 4_GangstarDefaultWarriorSkin | 1264/11 | 0/0.5/0/3 | -, 0 | Gold, 4 | SI- | 4_GangstarDefaultGWS 4406 |
| Default | 5 | Flint | Blue | 5_PunkDefaultWarriorSkin | 1188/12 | 4/1/0/0 | -, 0 | MoveSpd, 3 | SI- | 5_PunkDefaultGWS 3112 |
| Default | 6 | Sgt. James | Blue | 6_RamboDefaultWarriorSkin | 1462/10 | 0/1/1/0 | -, 0 | Double, 2 | SI- | 6_RamboDefaultGWS 6306 |
| Default | 7 | Richard Sorge | Blue | 7_SpyDefaultWarriorSkin | 1450/13 | 4/0/0/10 | -, 0 | MoveSpd, 4 | SI- | 7_SpyDefaultGWS 4738 |
| Default | 8 | Lt. Hondo | Violet | 8_AviatorDefaultWarriorSkin | 1230/12 | 2/0.8/0/10 | -, 0 | MoveSpd, 4 | SI- | 8_AviatorDefaultGWS 4470 |
| Default | 9 | Demon Hanzo | Violet | 9_SwordsmanDefaultWarriorSkin | 1104/10 | 2/0.5/0.5/0 | -, 0 | MoveSpd, 4 | SI- | 9_SwordsmanDefaultGWS 3316 |
| Default | 10 | Cowboy Bob | Gold | 10_CowboyDefaultWarriorSkin | 1282/14 | 5/1/1/10 | -, 0 | MoveSpd, 5 | SI- | 10_CowboyDefaultGWS 4986 |
| Default | 11 | Joffrey | Violet | 11_HunterDefaultWarriorSkin | 1435/13 | 2/0.5/0.5/0 | -, 0 | MoveSpd, 4 | --- | 11_HunterDefaultGWS 6003 |
| Default | 12 | Berserk | Relict | 12_FIreDefaultWarriorSkin | 2330/13 | 0/1/1/10 | Dash, 2 | MoveSpd, 5 | SI- | 12_FireDefaultGWS 13870 |
| Default | 13 | Comrade Ivan | Gold | 13_RocketmanDefaultWarriorSkin | 1754/11 | 5/1/1/10 | -, 0 | Double, 5 | SI- | 13_RocketmanDefaultGWS 5702 |
| Default | 14 | Space Gi | Gold | 14_FutureDefaultWarriorSkin | 1676/10 | 2.5/1.5/1.5/12.5 | -, 0 | Resurr, 5 | --- | 14_FutureDefaultGWS 6176 |
| Default | 15 | Captain Aurelia | Relict | 15_FlyGirlDefaultWarriorSkin | 1552/8 | 0/1.1/1.1/8 | Forsage, 2 | MoveSpd, 5 | --- | 15_FlyGirlDefaultGWS 5006 |
| Default | 16 | Sarah Connor | Gold | 16_SarahConorDefaultWarriorSkin | 1190/7 | 3/1/1/10 | -, 2 | Gold, 5 | --L | 16_SarahConorDefaultGWS 6821 |
| Default | 17 | T-800 | Relict | 17_T800DefaultWarriorSkin | 1336/8 | 3/1.2/1.2/0 | Annih, 3 | Resurr, 5 | --L | 17_T800DefaultGWS 7024 |
| Attack | 1 | T-72 | Grey | 1_BaseAttackSkin | 408/4 | 1/0/0/0 | -, 0 | MoveSpd, 2 | SI- | 1_GarageTank 8020 |
| Attack | 2 | Abrams | Grey | 2_AttackSkin | 844/5 | 0/0/0.5/0 | -, 0 | Double, 2 | SI- | 2_GarageTank 12360 |
| Attack | 3 | M-51 Supersherman | Green | 3_AttackSkin | 768/5 | 0/0.7/0/0 | -, 0 | Resurr, 2 | SI- | 3_GarageTank 14216 |
| Attack | 4 | Leclerc | Green | 4_AttackSkin | 828/5 | 2/0/0/3 | -, 0 | Gold, 5 | SI- | 4_GarageTank 13512 |
| Attack | 5 | M46 Patton | Blue | 5_AttackSkin | 816/4 | 3/0/0/5 | -, 0 | Gold, 5 | SI- | 5_GarageTank 13784 |
| Attack | 6 | M551 Sheridan | Blue | 6_AttackSkin | 922/5 | 3/0/0.8/0 | -, 0 | MoveSpd, 3 | SI- | 6_GarageTank 11468 |
| Attack | 7 | FV 4030 Challenger | Blue | 7_AttackSkin | 754/4 | 3/0.8/0/0 | -, 0 | MoveSpd, 3 | SI- | 7_GarageTank 11264 |
| Attack | 8 | Merkava | Violet | 8_AttackSkin | 654/4 | 1/0/0.6/5 | -, 0 | Gold, 5 | SI- | 8_GarageTank 11704 |
| Attack | 9 | M41 Walker Bulldog | Violet | 9_AttackSkin | 1002/5 | 4/0.5/0/5 | -, 0 | Resurr, 2 | SI- | 9_GarageTank 13428 |
| Attack | 10 | Dominator | Gold | 10_AttackSkin | 1008/6 | 5/0.8/0.7/10 | -, 0 | Resurr, 5 | SI- | 10_GarageTank 18034 |
| Attack | 11 | M67 Zippo | Relict | 11_AttackSkin | 2732/15 | 0/0.6/0.7/10 | Flame, 2 | Resurr, 5 | SI- | 11_GarageTank 12066 |
| Attack | 12 | Titan | Gold | 12_AttackSkin | 1416/15 | 5/0.8/0.7/10 | -, 0 | Resurr, 5 | --- | 12_GarageTank 2596 |
| Attack | 14 | HK-Aerial | Relict | 14_AttackSkin | 436/5 | 6/0.8/0.9/0 | Laser, 2.5 | MoveSpd, 5 | --L | 14_GarageTank 3010 |
| Artillery | 1 | T17 Mosquito | Grey | 1_BaseArtillerySkin | 1610/13 | 1/0/0/0 | -, 0 | MoveSpd, 2 | SI- | 1_GarageArtillery 6290 |
| Artillery | 2 | A8 Tatra | Grey | 2_ArtillerySkin | 1268/11 | 0/0/0.6/0 | -, 0 | Double, 2 | SI- | 2_GarageArtillery 3939 |
| Artillery | 3 | Bataleur 100 | Green | 3_ArtillerySkin | 780/11 | 0/0.7/0/0 | -, 0 | Resurr, 2 | SI- | 3_GarageArtillery 1788 |
| Artillery | 4 | Y83 Pampero | Green | 4_ArtillerySkin | 1296/9 | 2/0/0/4 | -, 0 | Gold, 5 | SI- | 4_GarageArtillery 4174 |
| Artillery | 5 | JP7 Faule Gretel | Blue | 5_ArtillerySkin | 1314/8 | 3/0/0/5 | -, 0 | Gold, 5 | SI- | 5_GarageArtillery 3236 |
| Artillery | 6 | MB 660 | Blue | 6_ArtillerySkin | 1896/14 | 3/0.8/0/0 | -, 0 | MoveSpd, 3 | SI- | 6_GarageArtillery 4966 |
| Artillery | 7 | M68 Ordos | Blue | 7_ArtillerySkin | 1994/18 | 3/0/0.8/0 | -, 0 | MoveSpd, 4 | SI- | 7_GarageArtillery 4676 |
| Artillery | 8 | R12 Mantis | Violet | 8_ArtillerySkin | 1824/11 | 3/0/0.5/6 | -, 0 | Gold, 5 | SI- | 8_GarageArtillery 4988 |
| Artillery | 9 | Astorus B2 | Violet | 9_ArtillerySkin | 2142/14 | 4/0.6/0/7 | -, 0 | Resurr, 2 | SI- | 9_GarageArtillery 4566 |
| Artillery | 10 | WM-88 | Gold | 10_ArtillerySkin | 2200/14 | 4/0.8/0.7/10 | -, 0 | Resurr, 5 | SI- | 10_GarageArtillery 6762 |
| Artillery | 11 | Hellfire | Relict | 11_ArtillerySkin | 2348/17 | 0/0.7/0.6/10 | BurnEarth, 2 | Resurr, 5 | SI- | 11_GarageArtillery 3962 |
| Artillery | 12 | Squall-M | Relict | 12_ArtillerySkin | 1900/15 | 0/0.8/0.7/8 | Hail, 2 | Resurr, 5 | --- | 12_GarageArtillery 3164 |
| Artillery | 13 | Kate 2X | Violet | 13_ArtillerySkin | 1626/15 | 2/0/2/8 | -, 0 | Double, 4 | --- | 13_GarageArtillery 5288 |

Observations (all from the table above / CFG):
- Naming-vs-data mismatches: `warriorSkinId` 13 has Default (Rocketman) and Artillery but **no Attack skin data** although `13_GarageTank` prefab, `garage_name_tank13` ("M90 Hurricane") and icon `13_tank_...png` exist; likewise `14_GarageArtillery` prefab + `artillery14_g_*.png` icon exist with no skin data; `garage_name_tank15` (Icebreaker) and `garage_name_unit18` (Eliza) strings exist with no assets. Interpreted (inferred from names) as content staged for later live-ops, not active in 1.29.3.
- Skin 12 Default is named `12_RelictDefaultWarriorSkinDara` in the data but its prefab is `12_FIreDefaultWarriorSkin` (typo `FIre`); its textures are `12_DefaultFireSkinTexture*`.
- Skins with `isLimited=1`: 14 Attack, 16 Default (Sarah Connor), 17 Default (T-800) (Terminator festival). Non-summonable & non-IAP skins (festival/reward only): Default 11 (Joffrey/Hunter), 14, 15, 16, 17; Attack 12, 14; Artillery 12, 13.
- `skinExtraStatsType` + `addExtraStatBonusPerStep` is the "evolve/stage" bonus (RC `tokens_upgrade_list` `EvolveFactor` at levels 35/60/85).

### 2.4 Artefacts (equipment that boosts a unit class) - brief (meta is direction P5)
`ArtefactsData` (dump.cs:L131443; 24 assets `CFG:Game.Main.Settings.Artefacts.ArtefactsData/*`, registry `.../ArtefactSettings/_ArtefactSettings_5306.json`): per item `artefactType` (`ArtefactsType` dump.cs:L155150), `warriorType` it equips to, `mainStatType` (SkinStatsType) with `mainStatBaseValue`/`mainStatUpgradeStep`, and 6 rarity-gated talent bonuses (`TalentsType` enum: DestroyWall, MineBlock, AddResource, BridgeSpeed, TowerShootBlock, vsRed/Yellow/Green, Gold, MoveSpeed, Resurrection, DoubleUnit, BonusHealth). Each class has 8 items; main stat is one of Gold/MoveSpd/Resurr/Double; talents unlock per rarity 1..6 (values below are the talent amounts). Source rows: `CFG:Game.Main.Settings.Artefacts.ArtefactsData/<Name>ArtefactData_*.json`.

| class | item | main stat base (+step) | rarity1..6 talent=value |
|---|---|---|---|
| Default | Token | Double 1 (+0.2) | Gold=3; vsRed=1; MoveSpeed=5; Resurrection=4; vsRed=2; DoubleUnit=6 |
| Default | Axe | Gold 10 (+2) | MoveSpeed=2; DestroyWall=1; DoubleUnit=3; Gold=12; DestroyWall=2; Resurrection=6 |
| Default | Belt | Resurr 1 (+0.2) | DoubleUnit=1; vsGreen=1; Gold=8; DoubleUnit=4; vsGreen=2; Gold=20 |
| Default | Berets | MoveSpd 2 (+0.4) | Resurrection=1; DestroyWall=1; MoveSpeed=5; Gold=12; DestroyWall=2; MoveSpeed=12 |
| Default | Backpack | Double 1 (+0.2) | Gold=3; AddResource=1; MoveSpeed=5; Resurrection=4; AddResource=2; Resurrection=6 |
| Default | Hammer | Gold 10 (+2) | Resurrection=1; BridgeSpeed=1; DoubleUnit=3; Gold=12; BridgeSpeed=2; DoubleUnit=6 |
| Default | RabbitFoot | MoveSpd 2 (+0.4) | Gold=3; MineBlock=1; Gold=8; Gold=12; MineBlock=2; Gold=20 |
| Default | Flask | Resurr 1 (+0.2) | DoubleUnit=1; vsYellow=1; Resurrection=3; DoubleUnit=4; vsYellow=2; Resurrection=6 |
| Attack | RadioSet | Double 1 (+0.2) | Gold=3; vsRed=1; MoveSpeed=5; Resurrection=4; vsRed=2; DoubleUnit=6 |
| Attack | Canister | Gold 10 (+2) | MoveSpeed=2; DestroyWall=1; DoubleUnit=3; Gold=12; DestroyWall=2; Resurrection=6 |
| Attack | Optics | Resurr 1 (+0.2) | DoubleUnit=1; vsGreen=1; Gold=8; DoubleUnit=4; vsGreen=2; Gold=20 |
| Attack | ImprovedRunningGear | MoveSpd 2 (+0.4) | Resurrection=1; DestroyWall=1; MoveSpeed=5; Gold=12; DestroyWall=2; MoveSpeed=12 |
| Attack | Antenna | Double 1 (+0.2) | Gold=3; AddResource=1; MoveSpeed=5; Resurrection=4; AddResource=2; Resurrection=6 |
| Attack | AdditionalContainersForCargo | Gold 10 (+2) | Resurrection=1; BridgeSpeed=1; DoubleUnit=3; Gold=12; BridgeSpeed=2; DoubleUnit=6 |
| Attack | AdditionalBlocking | Resurr 1 (+0.2) | DoubleUnit=1; vsYellow=1; Resurrection=3; DoubleUnit=4; vsYellow=3; Resurrection=6 |
| Attack | RacingWheel | MoveSpd 2 (+0.4) | Gold=3; MineBlock=1; Gold=8; Gold=12; MineBlock=2; Gold=20 |
| Artillery | Rocket | Double 1 (+0.2) | Gold=3; vsRed=1; MoveSpeed=5; Resurrection=4; vsRed=2; DoubleUnit=6 |
| Artillery | RepairKit | Gold 10 (+2) | MoveSpeed=2; DestroyWall=1; DoubleUnit=3; Gold=12; DestroyWall=2; Resurrection=6 |
| Artillery | RadarTablet | Resurr 1 (+0.2) | DoubleUnit=1; vsGreen=1; Gold=8; DoubleUnit=4; vsGreen=3; Gold=20 |
| Artillery | HandBrake | MoveSpd 2 (+0.4) | Resurrection=1; DestroyWall=1; MoveSpeed=5; Gold=12; DestroyWall=2; MoveSpeed=12 |
| Artillery | Gear | Double 1 (+0.2) | Gold=3; AddResource=1; MoveSpeed=5; Resurrection=4; AddResource=2; Resurrection=6 |
| Artillery | FuelBarrel | Gold 10 (+2) | Resurrection=1; BridgeSpeed=1; DoubleUnit=3; Gold=12; BridgeSpeed=2; DoubleUnit=6 |
| Artillery | Engine | Resurr 1 (+0.2) | DoubleUnit=1; vsYellow=1; Resurrection=3; DoubleUnit=4; vsYellow=3; Resurrection=6 |
| Artillery | Camouflage | MoveSpd 2 (+0.4) | Gold=3; MineBlock=1; Gold=8; Gold=12; MineBlock=2; Gold=20 |

## 3. Buildings / towers

### 3.1 Type table (`BuildingsType`, dump.cs:L166431; base class `Building` dump.cs:L166052; `SelectableBuilding` L169233)
Prefab files are in `assets/defaultlocalgroup_assets/hierarchy/` (address in `assets/_manifest/container_all.tsv`, all under `Assets/Addressables/Prefabs/Houses/`). "usage" = number of building entries of that type across the 2165 saved level JSONs (`TextAsset/*.json` `P[].BD[]`, counted by me; JSON key in `key`).

| BuildingsType | class (dump.cs) | prefab address / hierarchy file | level-JSON `key` / usage | purpose (inferred from names + fields) |
|---|---|---|---|---|
| 0 House | `House` L167729 (+`HouseArt` L167975) | `House (None).prefab` (Default soldiers: `House_Default _None__6957818880885456009.json`), `HouseArtillery (None).prefab` (`House_Artillery _None__7898684014195133855.json`), `House_Attack (None).prefab` (`House_Attack _None__-1401147551139371376.json`); festival: `Terminator/Terminator_House_Default.prefab` (`Festival_House_Default__None__8913...`), `Terminator_House_Attack.prefab` | `h` / 16,830 (259 festival style) | unit spawner; `spawnedWarrior` = WarriorType |
| 1 Tower | `Tower` L169780 | `Tower.prefab` (`Tower_-9019211759056274228.json`); `Terminator/Terminator_Tower.prefab` | `to` / 1,076 | auto-shooting tower (radius + bullet) |
| 2 Resource | `Resource` | `Items/Resources{6,12,14,18,24,32,60,100,154,224}.prefab` + `Gold.prefab` (collectibles) | - | gold packs on cargo (P2/P3) |
| 3 RocketTower | `RocketTower` L168925 (+`RocketTowerArt` L169136) | `MissileLauncher (None).prefab` (`MissileLauncher _None__-7131874820602603870.json`) | `rt` / 856 | player-aimed missile launcher; "disabled" duration after capture |
| 4 Fortess | `Fortess` L170722 | `Fortess/Fortess (None).prefab` | **0** in saved levels | static fort with 8 `FortessTower` guns (unused in levels) |
| 5 Flag | `Flag` L167162 | `Flag.prefab` | `flag` / 50 | capture point / goal marker, no combat |
| 6 SpeedTower | `SpeedTower` L169981 (+`SpeedTowerArt` L170128) | **no prefab/MB instance in APK** (only materials/textures `SpeedTower_*_color`, `SpeedTower{Blue,Green,Red,Yellow,Neutral}` in PlayerMaterialsData) | 0 | speed-buff aura (fields `warriorSpeedUpStartValue`, `houseSpeedUpStartValue`, `radiusUpByStage`) - removed/unused |
| 7 SelectableFortess | `SelectableFortess` L170526 (+`FortessCargoWithWarriors` L170335) | `Fortess/SelectableFortess (None).prefab` (`SelectableFortess _None__-8487648211068049622.json`); `Terminator/Terminator_SelectableFortess.prefab` | `s_f` / 335 (8 festival) | fortress that also spawns units, flies units to a target (`SpawnFlyWarriors`) |
| 8 CaptureRocketTower | `CaptureRocketTower` L166505 (+Params L166697, Art L166639) | `CaptureRocketTower.prefab` | `c_rt` / 251 | charges (points) then fires a capture projectile |
| 9 BossTower | `BossTower` L171154 (+Art L171365) | `BossTower.prefab` (helicopter "Helios") | `b_t` / 32 | boss-event enemy; moves between spots (`cmp`,`mp` in JSON) |
| 10 Trolley | `TrolleyBuilding` L169394 | `Trolley.prefab` (+ `WayTrolley`, `Game/Railway/*`) | `tr` / 187 | rail-cart that carries power on a track (railway mode; P3) |
Other `Prefabs/Houses` entries: `Flag.prefab` above. Player ownership prefabs `Assets/Addressables/Prefabs/Players/{PlayerController,AI_Red,AI_Green,AI_Yellow,Neutral}.prefab` (PlayerType Player=0, AI=1, Neutral=2, Boss=3, dump.cs:L155307).

### 3.2 Prefab-level defaults (serialized fields; from the MB referenced by each house prefab root)
Common (`Building` L166052): `_levelStyleType` (LevelStyleTypes Common=1, Festival=2, dump.cs:L146952), `buildingType`, `initialOwner`, `startRotation`, `canBeIgnoredToWin`, `canBeDestroyedInGame`, `coefficientByRocketTowerAttack` (rocket-tower damage multiplier vs that building).

| prefab | startLevel | maxLevel | key numbers | coefficientByRocketTowerAttack |
|---|---|---|---|---|
| House Default (`House (None)`) | 25 | 64 | spawnedWarrior 1, spawnWarriorSpeed 0.5, spawnCoefficient 1.7000000476837158, coefficientByWayCount 0.30000001192092896, defaultGrowLevelTime 1.7000000476837158, uiPositionStep y 0.8 | 1.0 |
| House Attack | 25 | 64 | spawnedWarrior 2, same spawn numbers, defaultGrowLevelTime 2.0 | 3.0 |
| House Artillery | 25 | 64 | spawnedWarrior 3, defaultGrowLevelTime 2.0 | 3.0 |
| Festival house Default / Attack | 25 | 64 | `_levelStyleType 2`, otherwise as non-festival | 1.0 / 3.0 |
| Tower | 5 | 64 | defaultAttackDelay 2.0, defaultAttackRadius 1.600000023841858, coefficientSpeedByLevelUp 1.75, coefficientRadiusByLevelUp 0.8999999761581421, bulletSpeed 12.0, minRadius 1.0; `DEFAULT_SPHERE_COLLIDER_RADIUS 2.4` | 1.0 |
| Fortess | 25 | 64 | attackCooldown 2.0, bulletSpeed 15.0, 8x FortessGun | 3.0 |
| SelectableFortess | 26 | 64 | spawnWarriorSpeed 0.5, spawnCoefficient 1.7, coefficientByWayCount 0.2, attackCooldown 2.0, bulletSpeed 15.0 | 3.0 |
| RocketTower (MissileLauncher) | 25 | 64 | rocketMoveTime 1.0, defaultDelayToShoot 0.5, coefficientShootByLevelUp 4.0, disabledDuration 5.0 | 2.0 |
| CaptureRocketTower | (params) 10 | (params) 64 | projectileAttack 64, projectileSpeed 0.5, params: startChargingPoints 58, maxChargingPoints 1000, chargingCooldown 3.0 | 3.0 |
| BossTower | 1 | 5 | _spawnWarriorSpeed 0.5, _spawnCoefficient 1.7, _coefficientByWayCount 0.2 | 0.0 |
| Flag | 5 | 64 | - | 0.0 |
| Trolley | 0 | 0 (levels in JSON; max seen 5-15) | canBeIgnoredToWin 1 | 0.0 |
Sources: `CFG-assets:` `assets/defaultlocalgroup_assets/MonoBehaviour/Game.Main.Buildings.{House,Tower.Tower,BaseFortess.Fortess,SelectableFortess.SelectableFortess,RocketTower,CaptureRocketTower,Flag,TrolleyBuilding}/` and `Game.Main.BossEvent.BossTower/` (looked up through each prefab's root MB pathID in the hierarchy file). The 64 extra `House` MB instances (`House_Default AI_Red`, `...Neutral`, `...PlayerController`, `House_Attack Neutral`) belong to the 12 hand-built tutorial LevelView prefabs, not to the generic prefabs.
Per-level override: every numeric knob above is overridden per instance in the level JSON via `[JsonProperty]` keys (`HouseSavedJsonValues` dump.cs:L143589: `WT, l, ml, cbi, ws, cwc, sc, gl`; `TowerSavedJsonValues` L143823: `l, ml, cbi, ad, ar, supl, rupl, bs`; `FortessSavedJsonValues` L143541: `l, ml, cbi, ac, bs` (+ selectable: `cwc, sc, swc, wcpr, dtsc, wt`); `RocketTowerSavedJsonValues` L143685: `l, ml, cbi, ds, lup`; `CaptureRocketTowerSavedJsonValues` L143451: `l, ml, cbi, scp, mcp, cc`; `BossTowerSavedJsonValues` L143415: `cmp, mp, cbi`) plus `id, lt (level style), bt (BuildingsType), p {X,Y,Z}, key`. Two key dialects exist in the level files (short `bt/l/ml/p` and long `BuildingsType/L/ML/Position`, e.g. 593 long-form house entries) - a loader must accept both. Example entry (`TextAsset/LevelView 277_ES_-9153395149825073087.json`): `{"WT":1,"l":10,"ml":64,"cbi":false,"ws":0.5,"cwc":0.3,"sc":1.7,"gl":1.7,"id":1,"lt":1,"bt":0,"p":{"X":0.14,"Y":0.0,"Z":-3.69},"key":"h"}`. Player blocks: `P[]` with `PT` (PlayerType) and `PC` (PlayersColors; Player = Blue 0, AIs Green/Red/Yellow 1-3, Neutral Gray 4, Boss red).
`WT` usage in levels: House WT1 = 12,497 (+ 2599 WT2 + 1734 WT3 across houses); SelectableFortess WT1 = 335.

### 3.3 Visual tiers (`HouseArt`, dump.cs:L167975; `HouseEnableArtParams` L168055)
`HouseArt.meshesByLevelHouse[3]` (mesh swap on the single `Art` MeshFilter) and `enableArtByLevel[3]` (lists of child GameObjects to enable, plus `objScale`); `UpdateHouseLevelArt(levelIndex)` selects stage 0..2 (`CurrentLevelIndex`). Stage thresholds (house level -> stage index) are NOT serialized (not found; code in `House.OnHouseLevelChanged`/`UpdateHouseLevelArt`, no IL body in dump). Also `stageUpdateParticle` plays on stage change and `PlayDestroyStageParticle` on level drop.

| prefab | stage 0 / 1 / 2 | mesh tris per stage |
|---|---|---|
| House Default | meshes `barrack_level1` / `barrack_level2` / `barrack_level3` | 310 / 470 / 630 |
| House Attack (tank factory) | same `factory_base` mesh; enable: S0 `main_pipe1, windows_`; S1 `SecondLevelSmallPipe x2, main_pipe1, main_pipe2`; S2 `ThirdLevelSmallPipe x3, main_pipe1..3` (S1/S2 lists do not repeat `windows_`; whether unlisted children are disabled is code, not found) | 200 base + pipes |
| House Artillery (garage) | same `artillery garage` mesh; enable `rocket level1` / `+ rocket level2` / `+ rocket level3` | 102 base |
| Tower | `watch_tower_level1/2/3` | 118 / 168 / 182 |
| RocketTower | child enable: S0 none (scale 0.85), S1 `side_launcher2` (0.9), S2 `side_launcher1+2` (0.95) via `RocketTowerArt.enableArtByLevel` | whole prefab 668 |
| Festival House Default | `barrack01/02/03` | 744 / 916 / 1098 |
| Festival House Attack | `tank_factory_base`; pipes `pipe4..6`, `pipes_side3*` as above | 444 base |
| Festival Tower | `watchtower1/2/3` | 638 / 692 / 746 |
| Fortess / SelectableFortess / Capture / Boss / Flag / Trolley | no `meshesByLevelHouse`; Fortess has 4 `towerN` x 2 `FortessGun` and 4 `wallN` always present (level-gating of guns is code, not found) | 2788 / 2788 / 712 / 1950 / 228 / 1740 |
Level text shown on the building: `uiPosition` + `uiPositionStep` (HUD number sits above the building; y 0.8 houses, 0.6 towers, 0.2 forts).

### 3.4 Spawn formations (`SpawnPoints` L169345 + `SpawnWarriorParent` L121564)
Each house has an `ArtWithManyPoints` node with groups `ManyPoints_1..9` (`countWarrior` 1..9; each child `Point_k` = local offset), used to place the group of units emitted per spawn tick. Default house (x,z offsets, from `catalog/prefab_parts_assets.json`): N=1 (0,0); N=2 (0,0)(0.1,0.3); N=3 (0,0)(0.27,0.24)(-0.27,0.24); N=4 (0,0)(0.3,0.18)(0,0.41)(-0.3,0.18); N=5 (0,0)(0.36,0.25)(0.44,0.51)(-0.44,0.51)(-0.36,0.25); N=6 adds a back row; N=7..9 ring of radius ~0.7. Attack/Artillery houses have groups 1..4 plus a 5-point variant (`ManyPoints_4 (1)`). `max_units_from_house = 30` (RC).

## 4. Team colouring / factions
- Colour enum `PlayersColors` Blue 0, Green 1, Red 2, Yellow 3, Gray 4 (neutral) (dump.cs:L155318). Player is always Blue; AI take Green/Red/Yellow (level JSON `P[].PC`); neutral buildings Gray.
- Units: `WarriorSkinData.warriorSkinMaterialsData[colour] -> Material(Mobile/Diffuse, _MainTex = <id>_<Name>SkinTexture<Colour>.png 256x256)`; Gray not provided for units (units are never neutral).
- Buildings: `PlayerMaterialsData` ScriptableObject (class dump.cs:L127396, registry `PlayerMaterialSettings` L127379), 5 assets in the scenes bundle (pids 769.., names `{Blue,Red,Green,Gray,Yellow}MaterialDataMilitrary`): fields `defaultHouse, attackHouse, artilleryHouse, towerMaterial, rocketTowerMaterial, rocketMaterial, captureRocketTowerMaterial, fortessMaterial, fortessFlagMaterial, speedTowerMaterial, parachuteMaterial, _towerBulletMaterial, _trolleyMaterial, playerCaptureRocketTowerUIColors`, plus maps `_houseMaterialSettingsMap` {WarriorType -> [LevelStyleBuildingMaterial]} and `_buildingMaterialSettingsMap` {BuildingsType -> [...]}, entries polymorphic via `[SerializeReference]` (`CommonLevelStyleBuildingMaterial` -> one material; `FestivalLevelStyleBuildingMaterial` -> material per activity id `"Terminator Event_1"/"_2"`). Only Blue and Red have Festival (Terminator) entries.
- So the keying is: `(PlayersColors, BuildingsType | WarriorType, LevelStyleTypes[, activityId]) -> Material -> _MainTex`. Resulting material/texture names per colour are tabulated in `catalog/units_buildings.json` `teamColouring.byColour` (e.g. Blue default house `HouseBlue` -> `MilitaryDefaultHouseBlueTexture`).
- Building prefabs ship with the Neutral/Gray material baked (e.g. `HouseNeutral` -> `MilitaryDefaultHouseNeutralTexture`) or a `Default-Material` placeholder (fortress/flag), and `HouseArt.Material(playerMaterial, anotherColor)` / `FortessArt.SetFlagMaterial(...)` swap at ownership change; `anotherColor` tints stage particles.
- Festival ("Terminator") style = alternate set of 512x512 textures/meshes (`Terminator*Texture`, `watchtower1-3`, `barrack01-03`) - selected by `LevelStyleTypes`/activityId, not a different faction.
- Neutral buildings are the same prefab with the Gray material (inferred: tutorial-prefab MB instances named `... Neutral` reference a Neutral `initialOwner`; saved levels give owner via `P[]`); capture swaps material (`House.ownerChanged` action, dump.cs:L167729).

## 5. Visual composition pattern (how one unit / one building is assembled)

### 5.1 Unit (battle)
```
Base warrior prefab (1 per WarriorType)         HIER:scenes/hierarchy/1_Military{Default,Attack,Artillery}Warrior_*.json
  WarriorBase|WarriorArtillery  (warriorType, refs)   Rigidbody/Sphere|BoxCollider
  WarriorPhysics (pushForce, delayToDeath)  WarriorArt (appear tween, hp bar point, parachute)  WarriorRageSkillController
  UnitContainer  <-- runtime child: instance of skin prefab (WarriorSkinModel)   [WarriorModelsPoolContainer, dump.cs:L184338]
Skin prefab (1 per skin, 43)                    HIER:scenes/hierarchy/<id>_<Name>(Default)WarriorSkin_*.json | <id>_AttackSkin | <id>_ArtillerySkin
  root: WarriorSkinModel (artRenderer[], animator, collisionWithGroundCol[], resourceStartSpawnPoint, resourceAddPos, deathParticle, rageSkill)
        Artillery: ArtilleryWarriorSkinModel (+ tower, bulletSpawnPoints[])
  character/ [Animator=OverrideController]       soldier: body -> belt, collar, hand_left, hand_right -> weapon, head -> head_2 -> hat/glasses, holster, jacket; leg_left, leg_right   (8-18 rigid MeshFilter+MeshRenderer nodes, one shared 256x256 atlas)
  materials = placeholder Default-Material; real material injected by SetMaterial(WarriorSkinData.warriorSkinMaterialsData[colour])
```
- Rigid parts: every part has its own Mesh asset (`assets/defaultlocalgroup_scenes/Mesh/<partname>_<pid>.obj`), local TRS in the node, all parts of a skin sample one `_MainTex` atlas (colour swatches), shader `Mobile/Diffuse` (`Mobile_Diffuse_7758394031877721932.json` in `assets/unitybuiltinassets/Shader`), no normal/spec maps.
- Garage/shop model (separate asset): soldiers = 1 `SkinnedMeshRenderer` (34 bones, T800 41) + weapon mesh + `GarageSkinsAnimator[_2]` (`Assets/Addressables/Prefabs/Warriors/GarageSkins/<id>_<Name>DefaultGarageWarriorSkin.prefab`, 3.1k-13.9k tris); tanks/artillery = static multi-part models (tank 2.3k-18.0k tris, artillery 1.8k-6.8k) with their own materials `<id>_GarageTankSkinMaterial` etc. UI icons are pre-rendered sprites (`Sprite/<id>_tank_*.png`, `artilleryN_g_*.png`, `<id>_<Name>_*.png`).
- VFX not part of the model: spawn appear tween (0.15 s), shield (`ImmrotalShiled`), hp bar, death particle (null for all skins), parachute (4 colour textures `{Blue,Green,Red,Yellow}ParachuteTexture`).

### 5.2 Building
```
House/Tower/... prefab                           HIER:assets/hierarchy/<House_Default (None)|Tower|MissileLauncher|...>.json
  root: Rigidbody + <Building subclass MB> + SpeedBoosterUpgradeHandler
  Physics: BuildingPhysics -> Hit / Selecable / Building BoxColliders (+ SimpleTrigger)
  Art: HouseArt|RocketTowerArt|FortessArt|CaptureRocketTowerArt|FlagArt  (+ MeshFilter/Renderer(s); stage meshes / enable lists)
  ArtWithManyPoints: SpawnPoints -> ManyPoints_1..9 -> SpawnWarriorParent(countWarrior) -> Point_k       (spawner buildings only)
  WayPosition / SpawnPosition / UIPosition / BulletPosition (anchors)
  OnGameStartParticle, StageUpdateParticles, Speed x2 particles (inactive pooled FX)
Meshes come from per-family FBX packs: Assets/Addressables/Models/Military/{artillery garage,fortress,missile launchers optimized,rocket capture,tank factory optimized,watch towers}.fbx (100 sub-assets) and `barrack_level1-3` (house).
```
Team material set by `PlayerMaterialsData` (section 4). Per-stage VFX: `StageUpdateParticles` (evolution rings). Destroyed/low-level VFX `DestroyHouseStageVfx_2496.json`, boom `RocketTowerRocketBoom_2462`.

### 5.3 Projectiles and misc 3D (scenes bundle, all < 400 tris except as noted; `catalog/prefab_parts_scenes.json`)
- `TowerProjectile_2447` (`projectile cannonball` mesh + `TowerProjectile{Blue,Green,Grey,Red,Yellow}Texture`), `RocketTowerProjectile_2456`, `ArtilleryRocketProjectile_2459`, `ArtilleryHailRocketProjectile_2457`, `ArtilleryBurningEarthRocketProjectile_2495` (all use mesh `rocket1_2`, `Default-Material` placeholder + `Rocket{Color}Texture`), `CaptureTowerRocketProjectile_2464` (`rocket` + `rocket details`), `Armagedon_2439` (bomb airstrike).
- Collectibles/world: `Cargo_2433` (crate + parachute + `Resources6` gold bars / `CoinsResources10` / `LifeResource_1`), `Coin_3433`, `Life_3469`, `Mina Effect_2460`, `WayBaseStandard_2472`/`WayRocket_2477`/`WayTrolley_2465` (path line prefabs, P3).

## 6. Data model / modularity pattern (how stats and visuals are keyed)

```
                           ┌────────────────────────────── ScriptableObject registries (scenes bundle) ──────────────────────────────┐
 enum WarriorType(1..3) ──►│ WarriorSettings.warriorParamsConfig[3] -> WarriorParamsConfig{attack,defense,hp,speed,count,...}          │
                           │ HouseSettings.houses[3] -> HouseData{house: PPtr<House prefab MB>, isStacking, isPlayerHouse}             │
                           │ WarriorSkinSettings.warriorSkinsData[43] -> WarriorSkinData ──┬─ warriorSkinPrefab ─► WarriorSkinModel prefab (battle art)
                           │                       raritySkinsDataInfo[6]  ◄── skinsDataInfo┤  garageWarriorSkinPrefab ─► Addressables GUID ─► Garage prefab
                           │                                                                ├─ warriorSkinIcon ─► Sprite (assets bundle)
 enum PlayersColors(0..4) ►│ PlayerMaterialSettings -> PlayerMaterialsData[5]               └─ warriorSkinMaterialsData[colour] ─► Material ─► _MainTex PNG
                           │    {house/building/projectile/flag materials per colour & LevelStyle}                                    │
                           └─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 Level JSON (TextAsset)  P[].PT/PC ; BD[]{bt,key,WT,l,ml,ws,sc,gl,ad,ar,...} ──► LevelElementsCreator ──► instantiate House/Tower/... prefab (by bt + WT + lt)
                                                                                    └► overrides serialized fields on the prefab MB (per instance)
 Remote config (SayKit, defaults embedded in APK): hp_config, rage_skills_config, rarity_upgrade_data, max_unit_level, max_units_from_house,...
 Runtime: InGameWarriorSkinData(skin + upgrade level + artefacts -> power, hp, bonuses) ─► HouseWarriorSpawner ─► WarriorBase pool + WarriorSkinModel pool
```
Key points for porting (modularity):
1. **Archetype (3) x Skin (43) x Colour (4) x Style (2)** are orthogonal axes. Stats live on archetype (tiny table) and skin (bonus table) - visuals live on skin (mesh set + 4 textures). Add a skin = add one data row + one mesh set + 4 PNGs; add a colour = one more texture per skin and one `PlayerMaterialsData` row.
2. **Per-instance tuning lives in the level file**, not in prefabs: the prefab MB numbers are defaults only. Port them as `defaults.json` per building type + per-level overrides.
3. Cross-references are by Unity PPtr/GUID; use stable string ids in our content instead (`skin:<type>:<id>`, `building:<kind>`, `palette:<colour>`).
4. Garage (meta) art and battle art are separate assets; we only need battle art for gameplay, garage art only for a shop/preview.
5. Remote config defaults (embedded) hold the progression numbers; the real game overwrote them live (SayKit), so values here are v1.29.3 defaults (see section 8).

## 7. Porting asset catalog (all paths under `/root/projects/tower-war/_extract`; nothing copied)

### 7.1 Where things are
| need | path | count / note |
|---|---|---|
| battle skin meshes | `assets/defaultlocalgroup_scenes/Mesh/<name>_<pid>.obj` | 456 OBJ (triangulated, v/vt/vn, X negated + winding reversed by UnityPy exporter, UV v NOT flipped) |
| battle skin textures | `assets/defaultlocalgroup_scenes/Texture2D/<id>_<Name>SkinTexture<Colour>_<pid>.png` | 172 = 43 x 4, 256x256 RGBA |
| battle skin materials | not exported correctly (see exporter bug); use `catalog/scenes_shared_reread.json` `mats` or `catalog/skins.json` `materials` (name, shader, `_MainTex`) | 172 |
| battle skin prefab trees | `assets/defaultlocalgroup_scenes/hierarchy/*Skin*_*.json` + resolved parts `catalog/prefab_parts_scenes.json` (node path, mesh, local TRS) | 43 skin + 3 base warrior roots |
| skin data/stats | `assets/defaultlocalgroup_scenes/MonoBehaviour/Game.Main.Settings.Warriors.{WarriorSkinData,RaritySkinsDataInfo,WarriorParamsConfig}/*.json` | 43 / 6 / 3 |
| unit animations | `catalog/anim_unit_clips.json` (decoded tracks, 30 fps) ; raw clips only metadata in `catalog/scenes_shared_reread.json` `clips` | 53 clips |
| unit parachute/shield/hp bar | `HIER:scenes/hierarchy/{Skydiver_2470,ImmrotalShiled_2442,WarriorHpBarBack_2471}.json`, textures `{Blue,Green,Red,Yellow}ParachuteTexture_*.png` | |
| garage soldier/tank/artillery models | `assets/defaultlocalgroup_assets/hierarchy/<id>_*Garage*_*.json` (45) + `Mesh/*.obj` (assets bundle, 372) | skinned meshes lose weights in OBJ |
| garage textures | `assets/defaultlocalgroup_assets/Texture2D/` (addresses `Assets/Addressables/Textures/GarageTextures/{DefaultWarriorTextures 17, AttackWarriorTextures 14, ArtilleryWarriorTextures 14, GunTextures 15}`) | |
| unit icons | `assets/defaultlocalgroup_assets/Sprite/{<id>_tank_*,artilleryN_g_*,<id>_<Name>_*}.png` (path per skin in `catalog/units_buildings.json` `skins[].icon`) | 43 resolved, 0 missing |
| building prefabs | `assets/defaultlocalgroup_assets/hierarchy/{House_*,Tower,MissileLauncher...,Fortess*,SelectableFortess*,Terminator_*,Festival_*,CaptureRocketTower,BossTower,Flag,Trolley}_*.json` + resolved `catalog/prefab_parts_assets.json`; summary `catalog/building_prefabs.json` | 15 prefabs |
| building meshes | `assets/defaultlocalgroup_assets/Mesh/*.obj` | e.g. `barrack_level{1,2,3}`, `watch_tower_level{1,2,3}`, `factory_base`, `artillery garage`, `fortress` parts |
| building textures | `assets/defaultlocalgroup_assets/Texture2D/Military{DefaultHouse,AttHouse,ArtilleryHouse,Tower,Missile,CaptureRocketTower}{Blue,Green,Neutral,Red,Yellow}Texture_*.png` (5 colours x 256x256), Terminator `Terminator*{Red,...}Texture` (512x512), `boss_helicopter` (512), `Trolley_{Blue,Gray,Green,Red,Yellow}` (256), flag `flag_{blue,green,neutral,red,yellow}_*`; scenes bundle: `MilitaryFortess{Blue,Green,Neutral,Red,Yellow}Texture_*.png`, `Rocket*Texture`, `SpeedTower_*_color`, `TowerProjectile*Texture`, `*ParachuteTexture` | |
| building materials | assets bundle `Material/*.json` (OK, single CAB) e.g. `HouseBlue.json`; scenes ones via reread | |
| building level data | `assets/defaultlocalgroup_assets/MonoBehaviour/Game.Main.Buildings.*` | |
| team material table | `catalog/units_buildings.json` `teamColouring` | 5 colours |
| remote defaults | `assets/data_unity3d/TextAsset/saykit_mlltrna_1.29.3_98.json` | |
| prototype GLBs | `catalog/glb_proto/<skin>.glb` (43, 7 MB), `catalog/glb_proto_buildings/*.glb` (15) | generated, not copied |

### 7.2 Triangle budget (battle models)
- Soldiers (Default): 1,036 - 2,330 tris, 7-13 parts (T800 1,336; Relict 2,330; Rocketman 1,754).
- Tanks (Attack): 408 - 2,732 tris, 4-15 parts (skin 11 Zippo 2,732; skin 1 base 408).
- Artillery: 780 - 2,348 tris, 8-18 parts (skin 11 Hellfire 2,348).
- Buildings (all parts): House Default stage0-2 310/470/630; Attack factory 1,072; Artillery garage 498; Tower 118-182; MissileLauncher 668; CaptureRocketTower 712; BossTower 1,950; Flag 228; Trolley 1,740; Fortess 2,788; Festival variants 4-6x heavier (e.g. SelectableFortess Terminator 4,850).
- Whole-scene order of magnitude: even 30 simultaneous units x ~1.3k tris = ~40k tris + a few hundred static; trivially within a WebGL budget. Garage models (up to 18k tris per tank) are only needed for preview UIs.

## 8. GLB conversion recommendation

### 8.1 Pipeline (offline, run once; scripts stay outside repo)
1. **Data**: use `catalog/units_buildings.json` + `catalog/prefab_parts_{scenes,assets}.json` as the node/mesh/material index (fixes the exporter bug; hierarchy order = DFS of the hierarchy JSON).
2. **Per skin -> one GLB** (rigid node hierarchy, not skinned): nodes from the prefab tree (local TRS), one mesh per part from the OBJ, one material with `baseColorTexture` = team-Blue PNG; keep the 4 team textures as external PNGs (`extras.teamTextures`) and swap `material.map` at runtime per owner colour (cheapest; mirrors Unity's per-colour materials; same UV layout across colours - inferred from the shared-prefab + `SetMaterial` design).
3. **Coordinate conversion** (prototype implements it): OBJ from UnityPy already has x negated and reversed face winding (`UnityPy/export/MeshExporter.py` writes `-pos[0]`, faces `c,b,a`), so node transforms must match: translation (x,y,z)->(-x,y,z); quaternion (x,y,z,w)->(x,-y,-z,w); scale unchanged; UV `v -> 1-v` (Unity bottom-left origin, PNG top-left). Verified by bounding boxes: Cowboy ~0.6x0.9x0.85 m, Military tank ~0.94x1.0x1.6 m.
4. **Animations**: decode `StreamedClip` + `ClipBindingConstant.genericBindings` (path = CRC32 of the node path relative to the Animator root GO; attribute 1=position, 2=quaternion, 3=scale) -> sampled TRS tracks -> glTF `animation` with LINEAR samplers. Implemented in `_tools/p1_anim.py` (53/57 clips; the 4 unresolved are `Cargo*`). The `#0` track = the animator root node itself (path hash 0); `12_Dash` also has one float binding (attribute hash, material/custom property) which is skipped. Clip loop flag in `extras.loop`.
5. **Buildings**: one GLB per prefab; HouseArt stage meshes emitted as extra hidden children `stageMesh_N` (`extras.houseArtStageIndex`); inactive nodes flagged `extras.activeInPrefab:false`; enable-lists from `enableArtByLevel` must be mapped by the loader (kept in `catalog/building_prefabs.json` / MB JSON). Colour textures per building listed in 7.1.
6. **Material in Three.js**: `Mobile/Diffuse` = Lambert, no spec: use `MeshLambertMaterial({map})` (or MeshStandard roughness 1 / metalness 0), `colorSpace = SRGBColorSpace`, `flatShading` off (normals present), `Texture.flipY=false` for glTF.
7. **Compress**: run `gltf-transform` (meshopt/quantize) + optionally `ktx2`; models are tiny (80-270 KB each uncompressed incl. 256x256 PNG).

### 8.2 What the prototype proved / did not prove
- `_tools/p1_skin_to_glb.py` (battle skin -> GLB, 43 files) and `_tools/p1_building_to_glb.py` (15 files): structurally validated by my parser (GLB header length, accessor/bufferView bounds, animation node indices, world bounding boxes sane). **Not** validated in a glTF validator or a renderer (no three/Blender available here) - treat as unverified for visual correctness (handedness/winding/UV flip are reasoned from the exporter source, not eyeballed).
- Skinned garage soldiers are **not** converted: OBJ loses bone weights; would need a custom mesh export (UnityPy `Mesh.m_Skin`, `m_BindPose`, 34 bones) + garage clip decode. Recommendation: do not port garage models; render preview icons from battle models (or use the 43 pre-rendered sprites).
- Particle VFX (1,150 ParticleSystems in assets bundle) are not extractable as assets; rebuild with sprite/billboard effects using `Textures/FX` (85 textures).

### 8.3 Recommended web-side data layout (modular)
- `units.json`: archetype table (3 rows from 1.1) + `hpCoefficient`.
- `skins.json`: 43 rows `{id,type,rarity,bonuses,rage,extraStat,flags,model:'skins/<name>.glb',textures:{blue,green,red,yellow},icon}` (generate from `units_buildings.json`).
- `buildings.json`: one entry per kind with defaults from 3.2, `stages[]`, `model`, `palette` keys; level files carry per-instance overrides using the same short keys.
- `palettes.json`: colour -> texture per model family (from `teamColouring`).

## 9. Contradictions, uncertainty, gaps
- **Garage prefab <-> skin GUID** not resolved: `garageWarriorSkinPrefab.m_AssetGUID` (e.g. `5acc8d7fde08e4ef381363cd97dc81ab` for skin 10 Attack) appears in `raw/catalog_bin_strings.txt` but the binary Addressables catalog (`base/assets/aa/catalog.bin`, magic 0x0DE38942 v2, path strings tokenised) was not parsed. Mapping used = naming pattern (confirmed 1:1 counts: 17+14+14 garage prefabs vs 17+13+13 skins; extra `13_GarageTank`, `14_GarageArtillery`), labelled inferred.
- House level -> art stage thresholds, tower/fortress gun level gating, `rocketTowerAttackByStage[]`, unit HP/power formulas, bonus semantics (percent vs fraction): code only, **not found** (no decompilation done).
- `SpeedTower` and `Fortess` (non-selectable): classes + materials exist but no prefab instance/saved-level usage (SpeedTower prefab not in APK; Fortess prefab exists, 0 uses). Inferred as legacy/unused.
- Skin ids 13 Attack / 14 Artillery / tank15 / unit18 / frost_drill / hurricane: strings/prefabs without skin data (inferred future content).
- Remote config defaults in `saykit_mlltrna_1.29.3_98.json` are **defaults**; the live game fetched overrides (SayKit), so balance numbers may differ in production.
- Exporter bug (section 0 item 7): `scenes/Material`, `scenes/AnimationClip`, component labels in `scenes/hierarchy`. Same risk for any other two-CAB bundle (`clanwars_scenes` has 2 assets) - not checked.
- 4 Cargo animation clips and the garage soldier clips (`GarageSkinsAnimator*`, `FireDefaultGarageSkinIdle`, `14_TankIdle`) not decoded; `Animation`/legacy and UI clips ignored.
- Texture alpha: skin PNGs are RGBA; whether alpha is used (cutout) was not checked (Mobile/Diffuse ignores alpha).
- Level style festival material for Green/Yellow/Gray not present (only Blue and Red) - consistent with Terminator levels having only Blue vs Red.
