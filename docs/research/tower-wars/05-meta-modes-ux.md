# 05 - Tower War meta, modes and UX teardown (direction P5)

Source: Tower War - Tactical Conquest v1.29.3 (`games.vaveda.militaryoverturn`). All paths below are under `/root/projects/tower-war/_extract` (local only, nothing copied). Sibling docs: `01-characters-units-towers.md` (skins, rarity per-level increments, rage prefabs, artefact table), `02-levels.md` (level categories, RC unlock gates, campaign order, difficulty). This doc does not repeat them; it adds the meta layer around a match.

Citation shorthand: `RC:<key>` = key inside `game_settings` of `assets/data_unity3d/TextAsset/saykit_mlltrna_1.29.3_98.json` (the shipped remote-config defaults; every `game_settings` value is itself a JSON string, parse twice). `LOC:<key>` = `raw/saykit_localization_en.json` -> `strings` (1,713 keys). `dump.cs:Lnnn` = `il2cpp/dump.cs`. "(inferred from names)" = no code or data proves it. "Disasm" = hand-read ARM64 of one function (capstone), method bodies are otherwise not decompiled.

## 0. TL;DR

1. Everything economic is data: the shipped RC defaults hold 261 `game_settings` keys (573,872 bytes) covering prices, reward lists, mode configs, event schedules, quest tables. That is the single richest meta source and it is JSON, directly portable.
2. Progression axes: **unit level 1..110** per skin (gold cost curve, token gates every 5 levels from 15, evolve gates at 35/60/85), **rarity** 1..6 (Grey..Relict) of unit skins, **artefacts** (24 equipment items x 6 rarities, merge + upgrade to level 100 with gold+hammers), **Research Center** (global upgrades; rank thresholds are in the APK, the per-upgrade table is not), plus **campaign index**.
3. A unit level does NOT raise base attack/HP (see 01 sec 2.2): it adds small percentage bonuses (move speed, resurrection chance, double-unit chance, gold, rage chance). Real power comes from owning higher-rarity skins, artefact talents and Research Center upgrades. "Combat Power" is a display/matchmaking number derived from those stats (sec 3.4).
4. Modes: Campaign (Common), Secret Mission (Draw, `LoadLevelType.Daily`), PvP (async league vs AI-driven levels, not live netcode as far as found), Arena (weekly season, 33-slot bot-filled leaderboard groups, challenge others), Challenge Tower (3 x 100 floors with a power gate and keycards), Boss "Helios" (damage race, daily attempts), Festival/event family (Terminator + 4 seasonal clones sharing one config shape), Island Race, Front Line Supply, Battle Pass(es), Clan Wars (server-driven strategic map, not a match mode).
5. In-match HUD is small: progress bar of owners, Bomb (Air Support) button, two Speed (2x) buttons, emotes, optional boss HUD. Control = drag from your building to a target to create a path, swipe across a path to cut it, long-press a railway tower to move it. Thresholds are exact (sec 6.3).
6. Worth porting first: reward/currency data model, unit-level price curve, deterministic summon queue, campaign result flow, HUD skeleton + input thresholds, tutorial hint set. Worth skipping: ads, IAP/offers/battle-pass monetisation, clans/clan wars (need a server), festival variants (until a core loop exists).

## 1. Sources and verification

| Source | What it gave | Confidence |
|---|---|---|
| `assets/data_unity3d/TextAsset/saykit_mlltrna_1.29.3_98.json` | all RC defaults (6 top-level keys: `ads_groups`, `ads_places`, `ads_settings`, `game_settings`, `runtime`, `settings`) | high: read directly |
| `raw/saykit_localization_en.json` | feature wording, rules text, tutorial strings | high |
| `assets/defaultlocalgroup_scenes/MonoBehaviour/*` (ScriptableObjects, 202 files) | `HumanPlayerInputConfig`, `PvpRankSettings`, `RailwayConfig`, `LockstepConfig`, installers | high (the scene-bundle pathID collision bug affects Material/AnimationClip and hierarchy labels, not these plain SO values, which I cross-checked against dump.cs field names) |
| `assets/navigationscreens/hierarchy/*.json` (260 prefab trees) | screens and HUD layout (names + attached script class) | medium: names and script labels only, no transforms/values; script labels in this bundle looked consistent, but I did not verify against the scene-bundle collision bug |
| `il2cpp/dump.cs` | enums, class fields (e.g. `UniWrapperGameConfig` dump.cs:L726181 shows the RC key -> field mapping), storage data classes | high for names/offsets, nothing for logic |
| Disassembly of `RaritySkinsDataInfo.CalculateCurrentPrice` (RVA 0x3012B18, dump.cs:L125626) | exact unit upgrade price formula (sec 3.2) | medium-high: read by hand, field identities confirmed from dump.cs offsets, `stage` meaning inferred |

Not in the APK (searched `stringliteral.json`, all JSON/text assets, `base/assets`): the Research Center upgrade table (`upgrades_data`, `max_number_upgrades_in_branch` exist only as string literals), the per-level gold reward constants (`gold_bonus_data`, `bonus_on_win`, `vip_bonus_on_win` exist only as string literals), matchmaking/server logic. These come from the live server config.

## 2. Currencies and reward vocabulary

### 2.1 Currency enum (`CurrencyType`, dump.cs:L155214) and where each is earned/spent

| id | name | UI name (LOC) | earned from | spent on |
|---|---|---|---|---|
| 1 | Gold | gold / coins | level wins, spin, daily reward, chests, quests | unit upgrades, artefact upgrades, Bomb booster (900), clan creation (1000), unique avatar (10000) |
| 2 | Ruby | crystals | quests, battle pass, arena/pvp/boss ranks | unit summon (`summon_unit_price` 25), silver chest 15, gold chest 60, `open_ten_chests_price` 540, extra arena attempts, Challenge Tower pass (5, x2 scale) |
| 3 | Medals | medals | Challenge Tower floors/spin, RC rank milestones | Research Center upgrades (inferred: LOC `research_popup_get_medals` = "EARN MEDALS!", `not_enough_medal`) |
| 4 | SilverKey | silver key | race/arena/boss/BP rewards | Challenge Tower "keycards" (`challenge_tower_ticket` = "Keycards") (inferred from names) |
| 5 | GoldKey | gold key | top ranks, race stage 3 | (inferred) premium chests |
| 6 | Bomb | air support | starter pack (4), first-IAP gift | Bomb booster in match |
| 7 | ArenaCoin | arena coins | arena/PvP wins and ranks (`levelVictoryReward` 10, rank rewards) | Arena Shop (units, tokens, artefacts, "premiumGem") |
| 8 | EventsCoin | event coins | boss damage milestones, Challenge Tower top floors | Event Shop |
| 9 | UnitEvolveToken | evolve tokens | special summon levels, arena shop | evolve unit at level 35/60/85 (`evolve_token_hint_description`) |
| 10 | PremiumGem | mythic gem | special summon levels, arena shop (10000 arena coins) | special ("mythic") summon (`premium_gem_hint_description` "Used for mythic summons") |
| 11 | Hammer | hammers | chests (`additionalHammers`), Challenge Tower floors | artefact upgrades (`hammer_hint_description` "Used for upgrading equipment") |
| 101/102 | ClanExp / ClanCoin | - | clan activity | Clan Shop |
| 201 | Fuel | - | Clan Wars brawl | Clan Wars squad moves |
Festival event currencies use their own reward keys (`fCur`, `fCurP`, `festival_currency`), see sec 4.7.

`SpinRewards` (dump.cs:L155538) = Gold 1, Ruby 2, Medal 3, Bomb 4, Artefact 5. `DailyRewardType` (L102049) = Gold 1, Ruby 2, FreeGold 3. `RewardsForPopUp` (L155426) adds DefaultSkin/AttackSkin/Clone/Life/Vip/Skin/Artefact/UnitEvolveToken/PremiumGem/Hammer/ClanCoin.

### 2.2 Reward/price JSON dialects (all in RC)

- Reward: `{"key":"currency","currencyType":N,"amount":A,"rarity":R}` (rarity here is a *visual tier* 0..6 for the reward popup, not an item rarity). Also `{"key":"token","warriorType":W,"rarity":R,"amount":A}`, `{"key":"unit","unitId":ID,"unitType":W,"rarity":R}`, `{"key":"artefact","artefactType":T,"rarity":R,"amount":A}`, `{"key":"avatar","id":N}`, `{"key":"vipD","d":900,"r":5}` (VIP duration; unit of `d` not verified), `{"key":"battle_pass_event_reward",...}`. Compressed variants in event configs: `{"key":"fCur","cT":1,"a":5,"r":2}` (`cT` currency type, `a` amount, `r` rarity).
- Price: `{"key":"cur","type":N,"amount":A}`, `{"key":"free"}`, `{"key":"ads"}` (rewarded ad), `{"key":"inapp","productId":...}`.
- Rarity ints: `SkinRarity` Grey 1, Green 2, Blue 3, Violet 4 (UI "epic"), Gold 5 ("legendary"), Relict 6 ("Mythic") (dump.cs:L155485; UI rarity words from `LOC:garage_header_common/rare/unique/epic/legendary/mythic`; artefact rarity points in `LOC:bpe_artefact_info_popup_description`: Common 1, Rare 2, Unique 4, Epic 8, Legendary 16, Mythic 32).
- `WarriorType` Default 1 (soldier), Attack 2 (tank), Artillery 3 (dump.cs:L155583). `UnitBattleBannerRewardType` Default/Attack/Artillery/Random (L95577).

## 3. Progression

### 3.1 Persistent player state (`PlayerStorageData`, dump.cs:L123562)

Fields (offset): `levelIndex` 0x48, `dailyLevelIndex` 0x4C, `money` 0x50, `ruby` 0x54, `premiumGems` 0x58, `medals` 0x5C, `arenaCoins` 0x60, `eventCoins` 0x64, `amountOfBombs` 0x68, `curGameType` 0x6C, `curEnvironmentNumber` 0x70, `pvpLevelIndex` 0x74, `bossLevelIndex` 0x78, `silverKey` 0x7C, `goldKey` 0x80, `battlePassScore` 0x84, `challengeTowerLevelIndex` 0x88, `unitEvolveTokens` 0xA8, `clanCoins` 0xAC, `hammers` 0xB0, `firstIapStatus` 0xB4, `spinRewardCounter` 0xB8, `challengeTowerSpinRewardCounter` 0xBC, `pvpVictoryCount` 0xC0, `enemyLeaderboardScore` 0xC4, `curLeadBoardScore` 0xC8, `curLeaderboardPosition` 0xCC, `curLeaderboardRank` 0xD0, `rateUsShowedValue` 0xE0. So the whole economy is ~12 integers + a per-mode level index; a port can model it as a flat wallet + counters.

### 3.2 Unit (skin) level 1..110

- `max_unit_level` RC = **110** (`MaxLevel` set in `RaritySkinsDataInfo.Initialize(tokenUpgradeStats, remote, maxUnitLevel, ...)`, dump.cs:L125557..L125626). `max_units_from_house` = 30 (name only: cap on units spawned per building action, inferred).
- Per-level stat gain by rarity: see 01 sec 2.2 (move speed 0.35..1.00, resurrect 0.15..0.40, double-unit 0.15..0.40, gold 0.25..0.80 per level, rage +0.20 only for Relict).
- **Gold price per level step** (`RC:rarity_upgrade_data`, `RemoteRaritySkinDataInfo` dump.cs:L126394): Grey start 25 / +25 per level, Green 65/+35, Blue 150/+50, Violet 185/+65, Gold 220/+80, Relict 240/+110; `AddPercentToPriceByStage` 20, `StartAddPercentPriceByStage` 60 for all.
- **Exact formula** (disassembly of `CalculateCurrentPrice(int skinLevel, int skinStage)`; `t[i]` = `NeedLevel` list from `RC:tokens_upgrade_list` = 15, 20, ..., 105 (19 entries); fields at offsets 0x40 start, 0x44 add, 0x48 pct step, 0x4C pct start, 0x50 maxLevel):
  ```
  if t[0] > L: price = start + add*L
  else:
    price = start + add*(t[0]-1)
    for i in 0..stage-1:
      extra = trunc(add/100 * (pctStep*i + pctStart))      // float math
      extra = round to nearest 10 (remainder >= 5 rounds up)
      next  = (i+1 < stage) ? t[i+1] : maxLevel
      count = (next < L) ? next - t[i] : min(L + 1 - t[i], next - t[i])
      price += (add + extra) * count
  ```
  I computed with `stage` = number of thresholds <= L (stage meaning is inferred; the gather/garage code that supplies it was not read). Results (gold to buy the step at level L): Grey L1 50, L14 375, L15 420, L35 1,440, L60 3,285, L100 7,525, L109 8,700; Green L1 100, L35 1,990, L100 10,305; Blue L1 200, L35 2,870, L100 14,700; Violet L1 250, L35 3,750, L100 19,145; Gold L1 300, L35 4,580, L100 23,490; Relict L1 350, L35 6,240, L60 14,050, L100 32,280, L109 37,330. Roughly linear-then-gentle-quadratic; a port can use the formula as data (`startPrice, addPerLevel, stagePctStart, stagePctStep, thresholds`).
- **Token gates** (`RC:tokens_upgrade_list`, class `SkinTokenUpgradeStats` dump.cs:L126470): at levels 15, 20, 25, 30, 35, 40, 45, 50 you need 1,2,3,4,5,6,7,8 tokens, then 8 tokens at every 5th level to 105 (`NeedToken`); levels 35, 60, 85 carry `EvolveFactor` 1/2/3 (stage/grade markers). Garage UI: "Tap to unlock further unit levels", "Tap to autofill", "Tap to upgrade" (`LOC:garage_upgrade_tutor_text_1..3`), "Choose tokens to upgrade", token button "Auto"/"Accept". Token "value" for merging/auto-fill (`RC:tokens_score_data`): Grey 1, Green 5, Blue 40, Violet 200, Gold 1000, Relict 5000 (so higher-rarity tokens substitute for lower ones by value, inferred from names).
- **Evolve** (`RC:evolve_tokens_upgrade_config`): at levels 35/60/85 spend evolve tokens: Grey 2/3/4, Green 3/4/5, Blue 4/5/6, Violet 5/6/7, Gold 6/7/8, Relict 6/7/8 (`GetEvolveTokenPrice`, `GetNextGradeLevel` dump.cs:L125627..). Evolve = "Ascended" header (`LOC:garage_header_ascended`); what it changes visually/stat-wise was not found (01 lists 3 visual tiers per skin).
- `RC:unit_evolve_tokens_available` 1, `red_units_available`/`red_items_available` 1 (Relict content on).
- **Free upgrade / free unit**: garage tutorial variants (`GarageTutorialVariant`, dump.cs:L50680): FreeSummon, FreeUpgrade, ChangeUnit, ArtefactPutOn, ArtefactMerge, UpgradeByTokens, UpgradeArtefact, UnitBattleBanner.
- **Unit Battle Banner** (clan-shop-gated): `RC:unit_battle_banner_config`: `enableLevelIndex` 51; per class `startHpBonus`/`hpBonusPerLevel` Default 100/25, Attack 200/50, Artillery 100/25; abilities at unit level 10..80 (+100..+1,500 for Default, +200..+3,000 Attack, bonus type 13); `upgradeConfig` lists `gP`/`bP` pairs (price vs banners per level). Unlock needs a Clan-Shop purchase (`LOC:unit_b_b_activation_popup_description_in_clan`). HP bonus is a battle stat, one of the few direct HP boosts in the meta.

### 3.3 Artefacts (equipment)

Static item table is in 01 sec 2.4 (24 items, 8 per unit class, 6 rarity talent slots each). Acquisition and upgrade, new here:
- **Slots**: `RC:artefact_open_slots_level` = `[0, 10, 20, 40]` (inferred: 4 equip slots per unit class that open at unit/class level 0/10/20/40; LOC `garage_header_choose_to_put_on` "Choose a slot to equip the item"; "Use Best Items" auto-equip button `garage_button_auto_equip`).
- **Sources**: silver chest (free every 86,400 s, else 15 rubies), gold chest (60 rubies, no free timer) - `RC:main_shop_artefact_chests_config`: `silverChestParameter.timeForFreeChest` 86400 `chestPrice` 15; `goldChestParameter.timeForFreeChest` 0 `chestPrice` 60; each has a fixed ordered `artefactChestRewardQuery` list of `{artefactType, rarity}` (silver mostly rarity 1 with some 2; gold rarity 2-4) and `additionalHammers` cycles (silver 4..8 hammers, gold 8..16); x10 open = `open_ten_chests_price` 540. Result-screen spin wheel (`RC:spin_reward_list`, 21 slots: Gold 100/150/200, Ruby 5/10/15, Artefact rarity-1 x1) and `RC:artefact_spin_list` (34 item-type entries, `Loop` 0 for the first 3 pulls = Token, RadioSet, Token, then `Loop` 1 = cycled list) which is the ordered artefact the wheel/free chest hands out. Arena Shop sells artefacts by rarity (`RC:arenaShopConfig.artefactPrices`: Grey 75, Green 200, Blue 600, Violet 1,800, Gold 5,400, Relict 20,000 arena coins). Battle Pass Event "Great Supplying" rewards artefact finds.
- **Merge**: "Select Objects to Merge", `items_reached_max_rarity`, "Merge all" (`garage_button_merge_all`), `garage_merge_return_recources` "Resources returned" (merge refunds upgrade spend). Merge ratio not found in data (no RC key) - not found.
- **Upgrade** (`RC:artefacts_upgrade_data`, `ArtefactUpgradeConfig` dump.cs:L94005): `upgradeData[1..100]` each price = Gold (type 1) + Hammer (type 11): level n gold = 150 + 55*(n-1) (150, 205, ..., 5,595), hammers = 10 + 2*(n-1) (10, 12, ..., 208) (verified at n=1,2,3,100). `statsData` (type = `SkinStatsType`: 0 Gold, 1 MovementSpeed, 2 Resurrection, 3 DoubleUnit): `baseValue`/`upgradeStep` = 10/0.5, 2/0.2, 1/0.1, 1/0.1.
- **Contradiction**: 01 sec 2.4 lists per-item SO main stats Gold 10 (+2), MoveSpeed 2 (+0.4), Resurrection 1 (+0.2), Double 1 (+0.2). RC `statsData` has the same bases but half/quarter steps (Gold +0.5 = SO/4, others SO/2). Which wins at runtime, and whether "step" is per upgrade level or per rarity, is not resolved (RC `isEnabled` true suggests RC overrides the SO; unverified).
- Talents (rarity-gated bonus per item): 01 sec 2.4; UI labels `LOC:talent_header_*` (Wall Breaking, Bridge Building, Mine Protection, Gathering Resources, Tower Defense, Bonus Health, Stronger Against Red/Green/Yellow). They are the *only* link from meta to level mechanics (walls, mines, bridges, resources, colour matchups).

### 3.4 Combat Power (display + matchmaking number)

`RC:player_power_settings`: power = sum over stats of `(value / valueToAddPower) * addPowerPerValue` (formula inferred from field names). With `valueToAddPower` 0.1 (ArmagedonAimCount 1): Gold 1, MovementSpeed 5, Resurrection 10, DoubleUnit 10, TowerSpeed 5, TowerRadius 5, RocketTowerSpeed 5, RocketTowerRadius 5, BuildingsSpawnSpeed 10, SpeedBoostFactor 10, ArmagedonAimCount 75, rage 28, `artefactsTalentPower` 100. Used for: Challenge Tower gate (`LOC:ctower_popup_no_power` "NOT ENOUGH POWER!", `ctower_popup_enemy_power`/`player_power`), Arena/Boss bot scaling (`powerCoefficient` ranges), Start-Level preview, clan join (`not_enough_power`). `RC:combat_members_stats_settings` caps shown stats (player/bot): MovementSpeed 80/100, Resurrection 80/100, DoubleUnit 80/100, RageChance 35/50. `RC:bot_units_level_limit_config`: bots limited to unit level Grey 10, Green 15, Blue 20, Violet 25, Gold 110, Relict 110. `RC:hp_config` `hpCoefficient` unitType 1 -> 1, 2 -> 2, 3 -> 1 (tanks count double HP in the power/clash model; LOC `hp_tutorial_description` "The unit with more Health Points survives the clash", shown at campaign level 11). `RC:levels_power_recommendation_config` (main-menu `RecommendedPowerContainer`): three bands of base power 0-105, 105-115, 115-500, `minStep` 10, `maxStep` 25 (semantics inferred).

### 3.5 Research Center (global upgrades)

- Screen `ResearchCenterWindow` (button "CENTER", `button_research_center`); unlocks with an intro popup (`research_popup_available`), tutorial "PRESS THE BUTTON TO MAKE YOUR TROOPS STRONGER". Scroller rows of connected cells; "UPGRADE REQUIRES:"; "UNLOCK THE PREVIOUS UPGRADE FIRST" (branch lock).
- Upgrade types (`UpgradeType`, dump.cs:L161099; labels `LOC:research_header_*`): Gold ("MONEY: more coins per level completed"), MovementSpeed, Resurrection ("chance of protective field activation"), DoubleUnit, DestroyWallTalent, MineBlockTalent, AddResourceTalent, BridgeSpeedTalent, TowerSpeed, TowerRadius, RocketTowerSpeed, RocketTowerRadius, BuildingsSpawnSpeed ("TROOP SUMMONING SPEED"), ArmagedonAimCount ("AIR SUPPORT hits more structures"), SpeedBoostFactor ("ACCELERATION BOOST even faster"), RageChance. Target filters: ALL TROOPS, SOLDIER, TANK, ARTILLERY, ALL BUILDINGS, TOWER, ROCKET LAUNCHER, AIR SUPPORT, ACCELERATION BOOST (`research_header_type_*`; `UpgradeTargetType`).
- Config classes: `UpgradeConfig {id, rarity, step, maxLevel, targets, priceConfig, condition, params{parameterType, upgradeType, startValue}}` dump.cs:L94701..L94821; `UpgradePriceConfig {count, price[]}`.
- **Rank** (`RC:upgrade_service_rank_config`, `UpgradeServiceRankConfig` dump.cs:L94658): `rankPoints` = [0, 502, 1002, 1502, 1978] (5 ranks; "Upgrade limit increased" popup on rank up), `milestonesReward` = 12 Medal rewards at `pointAim` 125, 250, 375, 625, 750, 875, 1125, 1250, 1375, 1625, 1750, 1875 with amounts 15, 25, ..., 125 (+10 each). `customConfigsLevel` maps upgrade ids to the rank level they need: `bomb_1/2` -> 1; `{art,tank,unit}_{wall_breaking,bridge_building,mine_protection,gathering_resources}_{1,2}` -> 3 (except `tank_mine_protection_2` absent). This tells the branch ids: bomb, plus 4 talents x 3 troop classes.
- **Not found**: the actual per-upgrade values, costs, max levels (live-config `upgrades_data`). A port must invent these; the research-center stat categories and the power weights above bound the design.
- Quest hooks: `QuestTypes.UpgadeRCTimes`, `Upgrade...` (dump.cs:L155351) confirm upgrades are quest targets.

### 3.6 Skin acquisition (summon/gacha) - deterministic queues

- **Summon** (Garage "SUMMON" tab): costs `summon_unit_price` = 25 rubies. Result is read from a **fixed ordered list** `RC:summon_list` (220 entries `{id, key:"s_d", RarityType, WarriorType}`; rarity counts Grey 103, Green 62, Blue 40, Violet 12, Gold 3; WarriorType 1/2/3; `id` = skin id within the class, inferred). First pulls: G1, G1, G2, G2, G3, G1, G3, G1, G2, G1, G2, G3, G3, G2, G3, **B1** (16th) ... i.e. an authored, non-random sequence indexed by pull count (LOC `garage_header_guaranteed_reward` "Guaranteed {1} unit within {2} summon(s)"; behaviour after index 220 not found). Duplicates convert to tokens (`garage_header_get_dublicates`, "DUPLICATE").
- **Special (mythic) summon**: `RC:special_summon_list` (120 entries; Blue 88, Violet 16, Gold 10, Relict 6; key `sS_d`), cost PremiumGem (`special_summon_unit_price` 1), `special_summon_level_progression`: unlock level 2, `specialSummonMaxBeforeGuarantee` 20 and a 15-step "summon level" track (experience 20, 30, 40, 50, 75, 100, 125, 150, 200, 250, 400, 650, 800, 1000, 1500) whose rewards are tokens (rarity 3/5/6 per class), evolve tokens and premium gems.
- Other sources: first-IAP gift (`RC:first_iap_rewards`: Blue Default unit id 11 + 50 rubies + 500 gold + 1 bomb), `iap_offers_config.newUnitConfig` (unit offers per rarity 2..6), Arena Shop unit offers (`legendaryUnitTank` unitId 12 for 15,000 arena coins, `epicUnitSoldier` unitId 11 for 7,000), festival shop and festival summon (Relict unit ids 17 Default and 14 Attack for 20 `fCurP`; Legendary id 16 Default for 12), battle pass `{"key":"unit","r":1}` rows, `main_menu_icon_special_offer` "NEW UNIT" offer buttons for Default/Attack/Artillery.
- Unit ownership starts with unit id 1 per class (avatar config `u_c {id 1, t 1, r 1}`; skin 1 of each class = default). Skins and rarity tables: 01 sec 2.

### 3.7 Rage skills

Rage is **not** pre-selected. Each unit skin carries one rage skill (01 sec 1.3). Triggering is a per-unit chance stat (`SkinStatsType.Rage`/`UpgradeType.RageChance`, capped 35% player / 50% bot via `combat_members_stats_settings`, Relict +0.20 per level) plus a trigger collider (`RageSkillsActivateTriggerCollider` in `defaultlocalgroup_scenes` MBs) near a target. So the meta lever for rage is "own the skin that has it" and RageChance upgrades, not a loadout. `RC:rage_skills_config` (damage coefficient, shield-ignore, immortal-state, attack locations per skill) is in 01 sec 1.3.

### 3.8 Avatars / frames / customization (cosmetic progression)

`RC:avatar_customization_config` (default "1"; each element `{id, sprite_name, receive_condition{u_c unit, r_t, key:"u_o"}, localization}`: avatars unlock by owning a unit), `frame_customization_config`, `personalization_unique_icons` (paid: id 1 = 10,000 Gold, id 2 = 250 Ruby, id 3 = 500 Ruby, id 7 = 1,000 Ruby), `LOC:avatar_*`, `frame_*`, `emblem_*`. Arena/event rewards hand out special avatars (`{"key":"avatar","id":4}` for season rank 1). Pure cosmetics, trivial to port.

## 4. Game modes

`LoadLevelType` (dump.cs:L155281): Common 0, Daily 1, PvP 2, ChallengeTower 3, Arena 4, Boss 5, Festival 6, Test 100. Level lists, indices and wrap rules per mode are in 02 sec 2 and 4.2. Mode gates (completed Common levels) are in 02 sec 4.3; the full list is also in sec 7.

### 4.1 Mode comparison

| Mode | Entry / unlock | Match rules that differ | Reward | Meta structure |
|---|---|---|---|---|
| Campaign (Common) | always; `PlayCommonLevelButton`; level index shown as "LEVEL n" with HARD/SUPER HARD skull header (`main_icon_hard`, `main_icon_super_hard`) | the normal tower-war ruleset; in-match Bomb/Speed boosters; flag/boss objects only in other families | gold from the result screen (+ x-gold ad, `show_xgold_button_first_level` 1), spin wheel, victory progression free reward (`RC:victory_progression_free_reward_config`: 15 rubies every 5 Common wins from level 25, non-payers only), BP/quest progress | `dynamic_complexity` Common 80..200 step 10 (02 sec 4.5), env changes every 20 levels, `skip_levels_count` 49 |
| Secret Mission (Draw, `Daily`) | pops after level 14 then every 3rd (`show_challenge_after_level` 14, `show_challenge_per_level` 3); `SecretMissionsScreen`; Accept (`challenge_button_accept`; ad variant `ad_rewarded_challenge_accept`/`_next`) | "Draw Mode": straight-line / draw-puzzle levels (`LevelViewDraw`, Gate objects; level HUD shows `DrawModeText` + pencil, LOC `challenges_header_draw_mode` "Draw Mode", `new_tactical_mode_description` "Only straight lines available"); 77 ids, 4 tutorial-flagged | "GET SUPER REWARDS", "Chance to get:" (`challenge_header_chance_to_get`); counts for quests (`task_header_secret_missions`) | per-mode index `dailyLevelIndex`; dynamic complexity Daily 80..1000, `increaseStep` 1, random bound 5; new mission timer ("NEW MISSION IN") |
| PvP | `show_multiplayer_after_level` 3 (button) / `enable_multiplayer_after_level` 17 | levels `LevelViewPvp`; 252 ids; **opponent is a level AI with a faked leaderboard rival**: `PvpService` holds attempts + leaderboard-score fields only (dump.cs:L100726), no netcode class; `FakeMultiplayerSelectPopUp` exists (dump.cs:L35253), LOC "Searching for opponents" (inferred from names: async/fake PvP). In-level `BackPvpButton` -> leave popup "If you leave now, you'll lose PvP rating" | rating up/down (`pvp_rules_description`), per-house leaderboard score `minLeaderboardScorePerHouse` 3 .. `max...` 7, league promotion reward, daily rewards by league place, daily milestones ("Win PvP {0}/{1}", unclaimed go to Mail); `PvpRankSettings` `earnedGoldByRank` 300 `earnedRubyByRank` 20 with 18 rank sprites | `RC:pvp_config`: `maxAttemptsCount` 5 per day (extra via ad `ad_rewarded_pvp_battle_attempts`), `maxDaysUpdatePointsAvailable` 3, enemy score range 1..3 (+1 step), enemy score drift +100..150 per day; leagues Bronze/Silver/Gold/Diamond (`LOC:pvp_league_type_1..4`); `dynamic_complexity` PVP 90..150 step 7 |
| Arena | `show_arena_after_level` 10, `enable_arena_after_level` 35 (activity "Arena": 604,800 s, starts day-of-week 1, synced) | levels `LevelViewArena` (155, env fixed `arena_levels_env` 5); you **challenge listed players** (bot-filled); winner of an asymmetric power match; "A player challenged by another player will not gain or lose points" (`arena_info_text`); `isBotPowerLimits` true, `maxBotDisplayPower` 126,989; HUD swaps to `ArenaProgressBar` (player vs bot member with avatar + power) | points: `startPoints` 550, `maxPoints` 500 (names conflict, semantics not resolved), `rewardPoints` 75, `dailyUpPoints` 225 (max 600), `winCoefficient` 1 / `loseCoefficient` 5, `followersCount` 6; ArenaCoin win reward 10; daily rank rewards (#1: 150 coins + 3 silver keys + 10 rubies ... ranks 51-100: 5 coins), season rewards (#1: 2,000 coins + 3 gold keys + 100 rubies + avatar id 4); Arena Shop restocks every 7 days | groups of 33 (`arenaGroupsConfigs` type 0/1/2: 1/2/2 challenges, bot power coefficients 1..2, 1.5..2.2, 1.8..2.5, personal 0.1..0.5, 0.3..0.9, 0.8..1.3); extra attempts cost crystals (`arena_attempts_offer_description`, daily cap) |
| Challenge Tower | `enable_challenge_tower_after_level` 25 / `show_challenge_tower_after_level` 25; activity 1,209,000 s with 600 s cooldown | `ChallengeTowerLevel` floors; **power gate**: each floor has `difficulty_real` (300 .. 38,000) vs `difficulty_fake` shown; if player power < enemy power the popup blocks ("YOU DON'T HAVE ENOUGH POWER", link "UPGRADE YOUR POWER HERE"); factors `challenge_tower_difficulty_step_factor` 0.004, `_max_factor` 5 | per-floor rewards (e.g. floor 21: 100 gold + 1 medal; floor 70: 1,000 gold, 15 medals, 500 event coins, 3 gold keys, 25 hammers); floor spin wheel (`challenge_tower_spin_reward_list`: Medal 2-3, Ruby 5-15, Gold 100-150) | 3 blocks x 100 floors (`challenge_tower_levels_count` 100); **tickets**: `challenge_tower_pass_max` 3, recovery 10,800 s, buy cost 5 rubies x2 scale, `pass_purchase_max` 3, free ticket via ad (`ad_rewarded_free_ct_ticket`) |
| Boss "Helios" | `Boss Event` activity: level 100 (`level` param), 604,800 s | levels `LevelViewBoss` (7 ids); player vs a **boss tower** (`BossTower`, `BossPlayerController`, HUD `BossHud`: damage counter, reward slider, end-level timer `levelDuration` 120 s); goal is damage not capture; 25 troopers; `stunDuration` 20; `lastChanceAdditionalTime` 60; "Last Chance" boosters: Massive Bomb Attack, Stun Helios, Troops Airdrop (LOC `boss_event_last_chance_*`) | damage milestones (2,500 .. 5,000,000) pay EventsCoin 5/10/15/50; `levelRewards` 15 coins; leaderboard ranks (#1: 1,000 event coins + 3 gold keys + 50 rubies) | attempts reset daily ("Attacks reset every day"); AI ramps by `unitsConfig` (`ZTPU/PUA/MPUA/TTU` per unitType/rarity/speed/lines/power: base type 1, rarity 1, speed 2.5, 1 line, power 100; abbreviations unexplained, likely power-up zero/amount/max/time, inferred); leaderboard groups of 33 (3 difficulty tiers) |
| Festival / events | activity configs (sec 4.7); Terminator level 0 start | festival levels = 1 AI + neutral (02 sec 4.2); "Core" tap/boss loop for seasonal clones (taps, boss delay/durability, treasure/jackpot) | festival currency, pass, shop, summon | one config shape reused by 5 events |
| Island Race | `race_event_config.activationLevel` 11; 86,400 s on / 86,400 s cooldown | complete N levels faster than bots (`botCount` 4/3/2, bot difficulty 0.5/0.42/0.35/0.2, `levelToFinishCount` 10/15/20; all level types 0..4 count) | stage rewards Hawaii 125 gold+5 rubies+1 silver key, Iceland 250+15+2, Krakatoa 500+25+1 gold key; lose if bots finish first (`timeToLoose` 3,600/28,800/57,600) | main-menu `OpenRaceEventButton` with place icon and timer |
| Front Line Supply | `enable_front_line_supply_after_level` 30; 172,800 s on / 172,800 s off | meta-only: quest grid (complete a row or column -> Supply Chest, all -> Final Stage Chest) | chests | `RC:front_line_supply_config` (`quests[]` with rewards) |
| Clan Wars | clan level `startLevel` 50 (`RC:clans_config`) | **not a match**: server-run strategic map (sec 4.8) | league/season rewards | needs live server |

### 4.2 Campaign flow and result screen

Main menu -> Play -> `StartLevelPreviewPopUp` (player + up to 3 enemy member rows with avatar, name, power, unit icons, "VS", "TAP TO CONTINUE") -> level (`LevelWindow`) -> `Common_VictoryWindow`/`Common_LooseWindow`. Variants per mode: `Pvp_`, `Arena_`, `BossEvent_Result`, `ChallengeTower_`, `SecretMission_`, `Festival_` victory/loose windows (`navigationscreens/hierarchy`). Result buttons (`ResultScreenButtonType`, dump.cs:L27159): AdsClaim 0, AdsSpin 1, Spin 2, ProgressionReward 3, Vip 4, Next 5, SpeedBoost 6, TapToContinue 7, TryAgain 8, SkipLevel 9. Victory prefab: win warrior art with rotating rays, flying currency, `ResultScreen_SpinnerView` (spin wheel), `NewBiomeAnimation` when the theme changes, `RewardBonusView` ("+{0}") for VIP/ad bonuses, confetti. Delays: `delay_next_button_on_win_screen` 2 s, `delay_restart_button_on_loose_screen` 2 s. Loss screen offers "TRY AGAIN", boost ("BOOST" x2, rewarded ad `ad_rewarded_boost_on_fail`), "SKIP LEVEL" (`button_skip_level`; `ResultScreenButtonType.SkipLevel`), and the "lose_upgrade_your_team"/"text_upgrade_your_team" nudge toward the Garage. Gold per win and the bonus formulas: not found (server `gold_bonus_data`); `earn_gold_by_house` RC = 7 (field `UniWrapperGameConfig.earn_gold_by_house`, dump.cs:L726230; meaning not verified, plausibly gold per captured building, inferred from name).

### 4.3 Secret Mission / Draw mode details

HUD shows `DramModeParent` (sic) with "Draw Mode" text and a pencil; tutorial classes `DrawTutorial` (states Start, PathToNeutral, PathToRed, CaptureNeutral, NeutralPathToRed, NeutralPathToRedTwo; dump.cs:L147824), `DrawTutorialLevel2` (adds ShowErase / ErasePathRightToLeft; L147941), `TanksDrawTutorial` (PathFromAttack2ToAttack1 ... L148076). Straight-line restriction text is `new_tactical_mode_description`. Mechanics of Gate and path restrictions belong to 02 / P3.

### 4.4 PvP / Arena / Boss leaderboards - bots

Leaderboard members are `ILeaderboardMemberRuntimeData` produced by a leaderboard service with `groupsConfigs` (size 33, power/personal/rarity coefficient bands) and drifting bot scores per day (PvP `minEnemyAddLeadScorePerDay` 100 / `max` 150). `RC:leaderboard_with_negative_enabled` 1. Display powers are capped (`maxBotDisplayPower`). Net effect: a **single-player game with an authentic-looking social layer**. No Photon/lockstep use in these modes was found; `Games.Uni.Lockstep.LockstepConfig` (`_historyDurationMs` 5000) and `LifecycleConfig` (`_stepDurationMs` 30, `_stepDurationMinMs` 15) exist in the scene bundle but their consumer (Clan Wars squads or an unused module) was not verified.

### 4.5 Daily/weekly/seven-day quests and passes

- Quest model: `QuestTypes` enum (dump.cs:L155351, 41+ types: CompleteCommonLevel 1, CompletePvpLevel 2, CompleteDailyLevel 3, TakeLeaderboardPlace 4, GetBonusRewardAfterLevel 5, GetFreeCoinsInShop 6, SummonUnit 7, UpgradeUnit 8, WinColorAi 9, EnterTheGame 10, MakeAnyIap 11, GetNewItem 12, MergeItem 13, CompleteTowerChallenge 14, Open Silver/GoldChest 15/16, GetGold 18, GetRuby 19, ActivateBoosters 21, CompleteArenaLevel 28, MakeSpecialSummon 36, ... streak types 23-25, WatchAnyRewardAD 27).
- `RC:daily_and_weekly_quests` (score model): each day picks quests with `questScoreReward` (e.g. 10 Common wins = 20 pts, 5 PvP = 25, 3 Daily = 15, any IAP = 30, ...), and chests at scores 20/40/60/80/100 giving gold (20 per 20 pts) + rubies (1..) (`chestRewards`). `RC:daily_quests`, `RC:weekly_quests`, `RC:seven_day_quests` (7-day onboarding quest chain, gold 25 per quest, activity starts at level 10) are older variants with per-quest rewards. `show_daily_tasks_after_level` 5.
- Battle Pass (main, 14 days = 1,209,600 s, `battle_pass_rewards` free + premium rows, premium product `militaryoverturn_battlepass.premium.012`, `show_battle_pass_after_level` 16, `enable_battle_pass_event_level` 30) and four **Battle Pass Events** (`battle_pass_event_queue`: Victory Campaign, Battle Orders (daily/weekly quests: 2 pts/20 pts), Great Supplying (artefact finds by rarity points 1..32), Crystal Lord (spend rubies)); each has `rows` (points per level), silver/golden columns, `renewableLevelGoal` 25 (after the last row each N points gives another reward), level purchase `battle_pass_event_purchase_level_price` 50 (`cur` type 2). Monetisation-shaped; port only the points-ladder skeleton if wanted.
- Growth Funds (`RC:grow_funds_config`, activation level 70; tabs Main Mode / Challenge Tower / PvP; free vs paid "Golden Line"; `profit_percent` 750): progress by completing levels of that type, thresholds 0,100,150,...,1000.

### 4.6 Boosters and in-match consumables

| Item | Rule (RC) | Source |
|---|---|---|
| Bomb / "Air Support" (`LevelBoosterType.Bomb`, dump.cs:L105173) | price 900 gold (`level_boosters_config` Common/Daily/PvP; Festival bomb is an ad); `defaultBombBoosterAimsCount` 3 (+Research `ArmagedonAimCount`); `bombBoosterPriceByRcLevelCoefficient` 250; `show_bomb_button_first_level` 4, `show_bomb_button_first_delay` 15 s, `_next_delay` 10 s, `_after_reload` 20, `_free_count` 0, `_without_money` 1; tutorial "Use the Air Support to attack the opponent's building" ("Aim at the target anywhere") | `LevelWindow/BombBoosterButton` |
| Speed (`LevelBoosterType.Speed`, "BOOST" 2x) | priced as rewarded ad (`{"key":"ads"}`) in Common and Daily only; VIP "x2 SPEED UP" free; two buttons (Left/Right) in HUD; `show_boost_button_first_level` 4; also offered on fail/level screens (`show_boost_button_on_fail_screen` 1) | `LeftSpeedBoosterButton`/`RightSpeedBoosterButton`, `SpeedBoosterActivatedContainer` |
| Trooper Landing (`trooper_booster`) | disabled in defaults (`RC:gameplay_boosters` `{"trooper_booster": false}`); config `boostTime` 300, `boostValue` 2, `levelStart` 5, show-after-accept 350 s / reject 600 s; "For your buildings at the start of the game" (`FakeSkydiverUnit`) | `TrooperBoosterPopup` |
| Cargo drop (in-level crate) | `show_cargo_delay` 30 s, `show_cargo_max_count_on_level` 5, `show_cargo_resources_first_level` 59; tapping a cargo opens it (`CargoTouched`) | `Cargo` level object (see 02) |
| Lives | off by default (`show_lives_after_level` 0, `show_lives_mode` 0, `starter_pack_max_lives` 0); strings exist ("1 Free Life every {1} minutes") | - |

### 4.7 Festival / seasonal events (shared template)

Five instances share one RC shape: `terminator_event_{1,2}`, `halloween_*`, `new_year_*`, `zombie_*`, `beginner_event_*` (same byte sizes per key, e.g. `*_core_loot_config` 12,734 bytes). Activity (`RC:activities`): Halloween 1,296,000 s from fixed date, level >= 80; New Year 1,900,800 s; Beginner Event 1,296,000 s with 94,608,000 s cooldown (effectively once); Zombie same as Halloween; Terminator_1/_2 level 0. Parts:
- **Core** (the tap mini-loop): `*_core_taps_config` (`tapPrice` 5 festival currency, 20 `freeTapConfigs` of 3-6 free taps with 7-14 s refill), `*_core_enemy_config` (`bossDelay`, `bossDurability` 3-6 hits, `snowmanDurability` 10), `*_core_loot_config` (boss loot tables), `*_core_treasure_config` (jackpot triggers: boss attacks 10, core currency spend 15,000/50,000/75,000/100,000/125,000, treasure 15,000; bot jackpot 7,500-18,333), daily chest (500 gold).
- **Meta** (`*_meta_config`): building/decoration progress (`decorationsData` 21 levels needing 10..280 decorations), milestone chests at levels 4, 8, ..., stage rewards (150 festival currency + 500 gold).
- **Levels**: festival-mode matches pay `*_level_reward_config` (5 festival currency). Terminator additionally has summon roulette (`terminator_event_summon_config`: `pityTimerAim` 50, `rouletteList` of 91 slot indexes, `summonPrice` 5, progress pass at 10/25/50/75/100/200/300/400 summons), an event battle pass (`terminator_event_battle_pass_config`, points per 10), limited units (never again after event: `festival_shop_limit_reward_*`), convert-currency (`terminator_convert_currency_config`: type 1 -> gold 1:1, type 2 -> gold 1:1000).
- UI roots: `FestivalCoreWindow`, `FestivalMetaWindow`, `FestivalShopWindow`, `FestivalSummonScreen`, `FestivalQuestsWindow`, `FestivalOffersWindow`, themed prefabs `Pumpkin`, `Snowman_stage_1/2`, `zombie_stage_1/2`, `Dracula`, `HalloweenMetaHouse`, `NewYearMetaTree`, `ZombieMetaHummer`.

### 4.8 Clan features and Clan Wars (server-bound; not portable offline)

- Clans (`RC:clans_config`): `startLevel` 50, create cost 1,000 gold + 1-hour create timer, 50-message chat (`chatMessagesLimit`), donation (paid 10 rubies, +5), power bands `clansPowerValues` [0 .. 50,000], search pool 20, `maxAdminRankHolders` 3; clan activity quests/leaderboard (`ca_*` strings, `clan_activity_config` team activity id), Clan Shop (10,174-byte config), gift/giveaway messages, language picker, emblem picker. Screens: `ClanScreen`, `ClansHub`, `ClanChat`, `ClanShop`, `ClanLeaderboard*`, `ClanCreateScreen`, `ClanDonation`.
- Clan Wars (`Games.Uni.ClanWars.*`, assets in `clanwars_assets`, `clanwars_navigationscreens`): two clans fight on a tile map (`ClanWarsMapSettings`: river tiles 1-6, road tiles 1-13, props t1/t2) with 5 building types (`ClanWarsBuildingsSettings._buildings` x5; LOC `cw_battle_map_rule_*`: Fort = hourly Brawl points, Fuel Rig = fuel bonus, Attack Center = squad attack bonus, Defense Center = squad HP bonus, Citadel = revived squads start there). Phases: **Mobilization** (assemble up to 4 squads, assign defenders free, missions give Brawl points) then **Brawl** (attack buildings; fuel needed; first capture of a building yields more points; squads queue and fight one pair at a time dealing damage = Attack per second, winner keeps HP and meets next; HP regenerates when defending, heal with diamonds, dead squads revive on a timer or by paying). Leagues bronze..diamond I-III (`LeaguesSettings`, 12 tiers); season/daily rewards by rank; tutorial sequences `cw_preparing_sequence` (11 steps) and `cw_brawl_sequence` (5 steps). Needs server matchmaking, 24/7 state - skip.

### 4.9 Event Center / Shop / offers (shape only)

`EventCenterScreen` (unlock level 18) lists time-limited activities; `EventShop` and `ArenaShop`/`ClanShop` are three currency shops that restock weekly (`event_shop_info_description` "Goods renew every 7 days"). Main shop (`RC:shop_offers_queue`) is ordered groups: special offers (no-ads, VIP, battle pass), unit offers, equipment (chest, x10 chest), upgrade-pack offers per class, artefact offers, currency packs (gold: 3,000/10,000/25,000/60,000 for $3/9/20/50 product ids; rubies 50/150/400/1,200), daily reward (Free Gold 50, Gold 300, Ruby 5: `main_shop_daily_rewards_config`). VIP: `vip_account_product` (week 10 days / month 30 days validity, 50 rubies per day, no rewarded ads required, x2 speed free, `enableAfterLevel` 16). Starter pack (`show_starter_pack_after_level` 4: 1,000 gold + 4 bombs + free speed-ups). All monetisation; none shapes combat.

## 5. Screen flow (navigationscreens)

`assets/navigationscreens/hierarchy/` has 260 prefab roots. Flow:

```
Boot (SayKit consent / GDPR / ATT, remote-config + cloud-save sync "local_first")
 -> MainWindow (campaign hub)
     |- Play (PlayButtonTouchZone / PlayCommonLevelButton) -> StartLevelPreviewPopUp -> LevelWindow -> {Common,Pvp,Arena,Boss,Challenge,Secret,Festival}_{Victory,Loose}Window -> MainWindow
     |- Mode buttons: PlayPvpButton, PlayArenaButton, OpenChallangeTowerButton, OpenMissionsButton (secret missions), MainWindow_OpenFestivalButton, OpenEventCenterButton, OpenRaceEventButton, OpenDailyAndWeeklyQuestsButton, OpenSevenDayQuestsButton
     |- Bottom nav (ShopWindowControllerWindow: ControlButtonsGroup) -> Garage (GarageWindow), Shop (DonateShopWindow/SummonWindow), Research Center (ResearchCenterWindow), Clan (ClansHub)
     |- Offer buttons (left/right columns): upgrade packs, new unit offers (Default/Attack/Artillery), triple offer, custom offer ("President Briefcase"), growth funds, battle pass, progressive offers, no-ads paywall
     '- BurgerMenuButton -> Settings, Mailbox
```

Main window composition (names under `View/SafeArea`): `LevelHeaderContainer` (Normal/Hard/SuperHard back + `LevelText`), `OpenBattlePassButton` (slider + level + stars), `Left_Column_1/2`, `Right_Column__1/_2`, `RecommendedPowerContainer`, tutorial containers for PvP, daily quests, seven-day, front line, challenge tower, arena, battle pass, event center, growth fund (each `BaseTutorialView`, default off). Settings window: Music, Sound, Vibration toggles, Authentication, Support, Discord, Restore Purchase, Withdraw Consent, Privacy Policy, Device ID copy. `SettingsWindow`, `MailboxPopup` (`mailbox_config` default lifetime 2,592,000 s = 30 days).

Garage: `GarageWindow` with unit list per class (SOLDIERS / TANKS / artillery), unit detail (stats `UnitStatsFullInfoView`: Movespeed, Resurrection, Double Unit, Gold, Rage), `GarageUpgradeUnitPopUp` (token upgrade), `ArtefactsInventoryPopUp`, `ArtefactInfoPopup`, `SummonWIndow`, `UnitBattleBannerPopup`, "Total Power"/"Equipment Combat Power" headers, "To all units"/"To all skills" bonus rows. Unlock: `show_garage_after_level` 7 / `enable_garage_after_level` 10.

Canvas: all UI canvases use `CanvasScaler` "scale with screen size" (`m_UiScaleMode` 1), reference 1080 x 1920 (portrait), match width 0 for 22 of 23 prefabs (one uses 1.0); `SafeArea` and `OnlyUpSafeArea` helper components; UI camera orthographic size 960 (02 sec 11). 3D gameplay camera: perspective FOV 21, 55 degree pitch, position (0, 53, -36.81) (02, from scene bundle).

## 6. In-match HUD and controls

### 6.1 HUD (`LevelWindow`, hierarchy `navigationscreens/hierarchy/LevelWindow_-1633511282828464109.json`)

Always: `BackButton` (top-left; `BackPvpButton` variant), `LevelProgressBar` (a bar with up to 4 enemy "owner value" markers and icons, i.e. how much each faction controls; plus `AiOpponentEmotionParent` showing the AI's name and emotes, `DramModeParent` for Draw), `CurrencyConatiner` (live gold/coins with `FlyCurrencyController` for pickups), `LevelNameText`. Boosters: `BombBoosterButton` (price view, count, "not enough money"/"no internet" states, highlight), `LeftSpeedBoosterButton` + `RightSpeedBoosterButton` (`BoostFactorValueText` "x2", price or ad), `SpeedBoosterActivatedContainer` banner. `PlayerEmotionButton` opens four emotes (Sad, Amazing/Ohh, Provoke/Cool, Happy) - used against the AI. Mode-specific: `ArenaProgressBar` (player vs bot avatar + power), `BossHud` (damage counter, reward slider with claim states, end-level stopwatch, boss tutorial hand), `HelpHand`, `TrolleyHelpHand` (tutorial hands), `BombTutorialContainer` (dim overlay + free bomb button + hand). `BuildingsUIContainer` holds per-building UI (`buildingsUiView`, `railwayBuildingUiView`, `captureRocketTowerUiView`, `bossUiView`, `trolleyUiView` prefabs listed in `GameData` SO) - e.g. the level number on a house, upgrade bar.

Not on the HUD: no unit list, no minimap, no rage button, no pause menu button (back button opens `RestartLevelPopUp`: "DO YOU WANT TO RESTART THE BATTLE?"; `common_level_restart_window_description`).

### 6.2 Level-start preview

`StartLevelPreviewPopUp`: `PlayerMemberView` + `StartLevelMemberView_1..3`, each with avatar, name, power value and `MemberUnitsViewContainer` (the units each side brings) - "VS" and "TAP TO CONTINUE". Shows only for levels where `common_level_start_preview` (0) / `arena_level_start_preview` (1) allow it; default Common off, Arena on.

### 6.3 Controls (code: `HumanPlayerController` dump.cs:L136445, `HumanPlayerInput` L136648, config SO `HumanPlayerInputConfig_5327`)

- Raw gesture thresholds: long click **0.7 s** (`_longClickTime` 0.699999988), drag detection starts after **0.2 s** (`_delayBeforeDragChecking`), drag threshold **1% of the screen diagonal** (`_dragDeltaPercent` 0.00999999978; `HumanPlayerInput._screenDiagonal` field). Events: MouseButtonDown/Up, Drag, LongClickStarted(time)/Finished/Canceled.
- Path creation: press on an owned `SelectableBuilding` (`StartCreateWay`), drag; line follows the pointer on the ground via a ray (`UpdateWayOnGround`, `RAY_CAST_MAX_DISTANCE` 100) with a cursor/pencil visual (`SwitchCursor(PlayersCursors)`); release over another building commits (`TryCreateLine`/`TryCreateWayPath`); `destinationHouse` target; rocket towers use `StartCreateWayPath` (`WayRocket`, aim anywhere on the field - "Aim at the target anywhere"); boss towers use `TryCreateBossWays`.
- Cut path: swipe across an existing path with the `WayEraser` (`StartMovingWayEraser`/`MoveEraser`/`TurnOffEraser`) - tutorial strings "Swipe to cut the path", "Swipe to change the path", "Swipe to make the path".
- Cargo: tap a crate (`CargoTouched` -> `TryToOpenCargo`).
- Railway (alternate tower-moving mode): "Tap and hold, then move the tower to change its position" (`game_tutor_railway_state_changed`); `RailwayConfig` `_humanMoveDuration` 0.2 s, `_aiMoveDuration` 1.5 s, `_aiPauseAfterRailwayMove` 0.5 s, `_lockAnimationTime` 0.7 s; `HumanPlayerRailwayController`.
- Level-state gating: `OnLevelStateChanged`; `FocusChanged(bool)` cancels an in-progress gesture on app focus loss.
- Path/limit rules (max paths per building, two-path unlock "You now have 2 paths available", straight-line mode): see P3 doc.

## 7. Meta gating and pacing (RC, by completed Common levels)

Collected from `game_settings` (see 02 sec 4.3 for the subset it already lists): `show_daily_tasks_after_level` 5, `show_garage_after_level` 7, `enable_garage_after_level` 10, `show_multiplayer_after_level` 3, `enable_multiplayer_after_level` 17, `show_arena_after_level` 10, `enable_arena_after_level` 35, `enable_arena_shop_after_level` 35, `show_challenge_after_level` 14 (+ every 3), `show_challenge_tower_after_level` 25, `enable_challenge_tower_after_level` 25, `enable_event_center_after_level` 18, `enable_event_shop_after_level` 25, `enable_front_line_supply_after_level` 30, `enable_progressive_offers_after_level` 28, `enable_battle_pass_event_level` 30, `show_battle_pass_after_level` 16, `show_shop_after_level` 10, `show_starter_pack_after_level` 4, `show_rateus_after_level` 6 (`rate_us_level_delay` 50), `show_artillery_offer_after_level` 45, `show_inter_after_level` 10, `force_change_env_after_level` 20, `race_event_config.activationLevel` 11, `hp_config.showTutorialLevel` 11, Boss level 100, festival levels 80, growth funds 70, clans 50, seven-day quests 10, VIP 16, unit battle banner `enableLevelIndex` 51. Net effect: tutorial campaign levels 1-3, then a new system roughly every 3-8 levels for the first 30, which is the intended onboarding curve. Interstitial ads: `level_interstitial_first_level` 14, `level_interstitial_delay` 30 s, max 2 per level, only between 20% and 80% progress; `ads_places` have per-place status (interstitials mostly `off`/`skip`, all rewarded `always`: bonus, boost, coins, spin, chest, ticket, retry attempts); ad group floors `skip_after_start` 30/300 s, `skip_after_interstitial` 35 s, `skip_after_rewarded` 45 s. These shape *when* rewards are offered, not combat.

## 8. Tutorial

- Campaign tutorial levels are hand-built prefabs (`2TutorLevel`, `3TutorLevel`, `4TutorLevel`, played in index order 0,1,2 = 3TutorLevel, 4TutorLevel, 2TutorLevel per 02 sec 4.1) with scripted steps (`TutorLevelBase`, dump.cs:L148639: hand image, three localized step texts, step list, observers for "capture goal", "create way", "correct way created"; `TutorialLevel2`/`TutorialLevel3`, `TutorialLevel2`'s `eraserPointFrom/To` demonstrates cut, `level_tutorial_2_variant` RC = 1 selects `anotherVariantTutorSteps`).
- Text script (`LOC:tutor_*`, `game_tutor_*`), in teaching order: "Swipe to make the path" -> "Capture the tower" / "Capture the tower to help you with shooting" / "Capture the factory" / "Capture the building on the right" -> "Swipe to change the path" / "Swipe to cut the path" -> "You now have 2 paths available" -> "Conquer all buildings to win" -> "Upgrade the building to level 10" -> "Tanks have double attack" / "Tanks deal 2 damage to enemy buildings" -> "Attack buildings" -> later: Walls ("prevent passage, but can be destroyed"), Mines ("One mine destroys one unit"), Resources ("Collect resources to improve buildings faster"), Bridges ("You can build bridges across rivers", "Destroy the opponent's bridge"), Sheep ("Scattering sheep interrupt the path"), Flag ("Capture the flag! If we capture the flag, all the buildings of this opponent will become ours! If the enemy captures our flag, we will lose! Protect the flag!"), Capture rocket launcher, Trolley ("Capture and activate the trolley", "Destroy the building. It will be removed from the level"), Air Support (bomb), railway hold-and-move. This is a ready-made rule summary of the game for our own tutorial; it also confirms the **flag** win condition and **tank double damage to buildings**.
- Persistence: `TutorialsStorageData` fields (dump.cs:L123671): `_dailyTutorLevelComplete`, `_bombTutorialAvailableValue`, daily-quest tutorial, battle pass, `_pvpPopupShownValue`, challenge tower, boss event, `_changeGameStylePopUpShownValue` (the "NEW TACTICAL MODE" popup), artefact tutorial + merge + `_upgradeArtefactCompletedStageValue`, research center, clan, arena, `_isRailwayHintTutorialShown`, `_isTrolleyTutorialShown`, `_isDiscordShown`, `_isGrowthFundsTutorialShown`. Pattern: one boolean/int per tutorial so each fires once.
- Meta tutorials: Garage (`GarageTutorialVariant`, popups "Now we have a Base!", "Summon troops!", "Upgrade!", "Get stronger!"), Research Center (button hand), artefact upgrade stages (`ArtefactUpgradeTutorialStage` Garage/Inventory/Popup), each main-menu feature has a `*TutorialContainer` hand/arrow overlay.
- Story dialogue (15 beats, `LOC:story_*`, speakers Commander / Sgt. Lesley / Air Officer) frames the campaign as a time-machine plot with a T-800 unit; not needed for gameplay.

## 9. RC keys table (meta-relevant; values are shipped defaults)

| Key | Default / shape | Drives |
|---|---|---|
| `max_unit_level` | 110 | unit level cap |
| `rarity_upgrade_data` | 6 rows start/add/stage pct | unit gold curve (sec 3.2) |
| `tokens_upgrade_list` | 19 rows level 15..105, tokens 1..8 | token gates |
| `evolve_tokens_upgrade_config` | per rarity levels 35/60/85 | evolve |
| `tokens_score_data` | 1/5/40/200/1000/5000 | token value |
| `summon_list`, `summon_unit_price` | 220-entry queue, 25 | gacha |
| `special_summon_list`, `special_summon_level_progression`, `special_summon_unit_price` | 120 queue, unlock lvl 2, 1 gem | mythic summon |
| `artefacts_upgrade_data` | 100 levels gold+hammer, 4 stat types | artefact upgrade |
| `artefact_open_slots_level` | [0,10,20,40] | slots |
| `artefact_spin_list`, `spin_reward_list`, `main_shop_artefact_chests_config`, `open_ten_chests_price` | queues/prices | artefact/gold sources |
| `upgrade_service_rank_config` | rank points, milestones, `customConfigsLevel` | research-center rank |
| `player_power_settings`, `combat_members_stats_settings`, `hp_config`, `bot_units_level_limit_config`, `levels_power_recommendation_config` | power weights/caps | combat power |
| `unit_battle_banner_config` | enable level 51, per-class HP bonus | banners |
| `level_boosters_config`, `gameplay_boosters(_configs)`, `show_bomb_*`, `show_boost_*`, `show_cargo_*` | prices/timers | boosters |
| `levels`, `challenge_levels`, `multiplayer_levels`, `arena_levels`, `boss_levels`, `challenge_tower_levels`, `terminator_event_levels_config`, `skip_levels_count`, `dynamic_complexity`, `force_change_env_after_level` | level lists + scaling | see 02 |
| `pvp_config`, `arenaConfig`, `arenaShopConfig`, `boss_event_config`, `challenge_tower_*`, `race_event_config`, `front_line_supply_config` | mode configs | sec 4 |
| `activities` (+ `*_activities`) | schedule DSL: `parameters` (duration, cooldown, from_today, from_day_of_week, level, from_datetime), `activateConditions`/`deactivateConditions` | event scheduling |
| `battle_pass_*`, `grow_funds_config`, `daily_and_weekly_quests`, `daily_quests`, `weekly_quests`, `seven_day_quests`, `victory_progression_free_reward_config` | reward ladders | engagement |
| `shop_offers_queue`, `iap_offers_config`, `triple_offer_config`, `custom_offer_config`, `progressive_offers_config`, `black_friday_config`, `vip_account_product`, `*_product_price` | offers | monetisation |
| `clans_config`, `clans_shop_config`, `clan_activity_config` | clan | social |
| `enable_*_after_level`, `show_*_after_level` (~40 keys) | gates | pacing (sec 7) |
| `level_interstitial_*`, `ads_places`, `ads_groups`, `ads_settings` | ad pacing | skip |
| `cloud_sync_*`, `runtime`, `settings` | sync/analytics | skip |
| `dev_debug`, `no_power_limits_for_bots` (1), `generate_units_power_in_proportion_config` (disabled), `static_grow_complexity` (disabled), `boss_towers_dynamic_difficulty` (0), `bot_useless_attack_behaviours` (disabled) | AI/difficulty knobs that ship **off** | note for P4 |

Notable: `no_power_limits_for_bots` 1 means in Common levels the AI is not clamped to the player's power; the disabled `generate_units_power_in_proportion_config`/`static_grow_complexity` are alternate difficulty systems left in the build (names only).

## 10. Port notes for Node Arena (what to do first)

Priority 1 (cheap, data-driven, high value):
1. **Wallet + reward/price model**: `{key, currencyType, amount}` reward and price schemas (sec 2.2) in content JSON; ~10 currencies are enough (Gold, Ruby, Medal, Hammer, ArenaCoin, EventCoin, EvolveToken, PremiumGem, Bomb, keys). Put per-level result gold in content (the original constant is server-side, we choose it).
2. **Unit upgrade curve**: implement `price(level, stage)` per rarity exactly as sec 3.2; token gates (15..105) and evolve gates (35/60/85) as content tables; cap 110. Per-level bonuses from 01 sec 2.2. Keep base combat stats independent of meta level, as the original does, so balance stays in rules/content.
3. **Combat Power number** from the `player_power_settings` weights; use it for a start-level preview and a "recommended power" hint. It is the simplest difficulty-communication tool in the game.
4. **Deterministic summon queue** (`summon_list`): authored sequence + pity guarantee beats RNG for tests and replays (fits our deterministic sim).
5. **HUD skeleton and gestures** (sec 6): progress bar of ownership, 1 consumable button (Air Support/Bomb) and a 2x speed button, emotes optional; exact input thresholds (0.7 s long press, 0.2 s drag delay, 1% screen-diagonal drag). Portrait 1080x1920 reference, safe-area aware.
6. **Tutorial as data**: reuse the string script (sec 8) as a step table (hand target, text key, completion predicate); persist one flag per tutorial.

Priority 2: campaign result flow (victory -> reward fly-out -> spin wheel -> next), Challenge Tower (power-gated floors + tickets), Secret Mission/Draw mode (if Gate/straight-line mechanic from 02/P3 is ported), quests (event-counter model over a `QuestTypes`-like enum), research-center-style global upgrades (we must author the numbers; use the `UpgradeType` list and power weights as the design envelope), artefacts (merge/upgrade; start with the 24-item table from 01 and the sec 3.3 price lines).

Priority 3 / skip: Arena/PvP/Boss need a leaderboard-bot generator (33-slot groups + daily score drift; doable offline: `groupsConfigs` coefficients are all in RC) - build only after core loops; festivals (one template, five skins) after quests; battle passes, shops, offers, VIP, ads, IAP: monetisation, skip; clans and Clan Wars: server-dependent, skip.

Architecture suggestions: keep meta in a new `packages/meta` (pure TS, deterministic where it touches sim inputs: power, bonuses) with content JSON under `packages/content` (schemas for reward, price, activity, quest); the sim should only receive the *resolved* per-player stat bonuses (move speed, resurrection chance, double-unit chance, gold, rage chance, talent flags, bomb aim count, tower radius/speed) as match setup, exactly like the original's `combat members stats`. This keeps replays reproducible and the rules authority untouched.

## 11. Contradictions, uncertainty and gaps

- Artefact main-stat steps differ between SO (01 sec 2.4) and RC `artefacts_upgrade_data.statsData` (sec 3.3); unresolved which applies.
- `arenaConfig.startPoints` 550 > `maxPoints` 500 (semantics of the two names not resolved).
- Meaning of `earn_gold_by_house` (7), boss `PwUp` abbreviations, `vipD.d`, `artefact_open_slots_level` (slot count/what level), `levels_power_recommendation_config` bands, and the `stage` argument of the price formula are inferred from names only.
- Per-win gold, VIP/ad bonus multipliers, Research Center upgrade table, artefact merge ratios, summon behaviour after pull 220, and PvP/Arena server matchmaking: not found in the APK (server/live config or unread code).
- PvP is concluded to be asynchronous/AI-driven from the absence of netcode classes and the presence of fake-multiplayer UI, leaderboard drift constants and attempt counters. Not proven; `LockstepConfig` exists unused-by-name.
- Hierarchy exports give names and script labels only; HUD element positions/anchors were not read (only prefab tree membership). Pixel layout would need the RectTransform values (not in the hierarchy JSON; MonoBehaviour/RectTransform JSON not examined).
- I did not view sprite PNGs for screen identification (names were sufficient); no screenshots exist in the APK.
- Rage "Frost Drill" and "Hurricane" strings exist (`LOC:rage_skill_frost_drill`, `rage_skill_hurricane`) with no enum value/prefab (live-ops content, same as 01).
- Ads/IAP SDK internals deliberately not examined.
