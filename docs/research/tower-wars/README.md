# Tower War (Vaveda) teardown research

Source: `/root/projects/tower-war` (Tower War - Tactical Conquest 1.29.3, `games.vaveda.militaryoverturn`, Unity 6000.0.82f1 IL2CPP).

Local-only artefacts (never committed):
- `/root/projects/tower-war/_extract`: `INDEX.md`, `CLASS_MAP.md`, il2cpp dump, assets, `decomp/`, `converted/` levels, `catalog/`.
- `/root/projects/tower-war/_tools`: Il2CppDumper, UnityPy venv, Ghidra 12.1.4 + JDK21, `decomp.sh`, `p2_tw2na.py` (level converter), `p2_prefab_levels.py`, GLB prototype writers.

Note: the remote-config defaults file was renamed by an exporter fix from `saykit_mlltrna_1.29.3_98.json` to `saykit_mlltrna_1.29.3_98@resourcesassets.json` (same dir, `assets/data_unity3d/TextAsset/`). Docs 01 and 05 still cite the old name.

## Doc index

| File | Covers | Read when |
|---|---|---|
| [01-characters-units-towers.md](01-characters-units-towers.md) | Warrior types, 43 skins, buildings, team colour, art composition, asset catalog, GLB pipeline | Porting units/towers/art, skins |
| [02-levels.md](02-levels.md) | Level JSON format, campaign order, feature-introduction curve, lossless converter, NA projection | Importing levels, ordering campaign |
| [03-core-mechanics.md](03-core-mechanics.md) | Lines, spawn, combat, capture, towers, map modifiers, win/lose, determinism | Implementing sim rules |
| [04-ai-bots.md](04-ai-bots.md) | Default + scripted AI, difficulty scaling, fake PvP, mapping to `packages/bots` | Porting bots |
| [05-meta-modes-ux.md](05-meta-modes-ux.md) | Currencies, progression, modes, HUD/controls, 261 RC keys | Meta/HUD/mode scope |
| [06a-node-arena-baseline.md](06a-node-arena-baseline.md) | Node Arena side: entities, content, bots, rendering, extension cost | Before reading 06 |
| [06-gap-map-and-architecture.md](06-gap-map-and-architecture.md) | Gap map, target modular architecture, SP-A..SP-H roadmap, open decisions | Planning the port |

## TL;DR

- Units: 3 warrior types (Default=soldier, Attack=tank, Artillery); 43 skins (17/13/13); team colour = per-team texture swap, not tint (01#0).
- Levels: 2,165 current-format levels (30 legacy v0) of 2,195 files; Default family 1,241 files (02#0, 02#1).
- Campaign order = RC `levels` list (1,024 ids), plays by index then loops positions 53..1024 (02#4.1).
- Features appear by list position: walls 24, mines 36, ..., railway 330 (02#5).
- Lossless converter round-trips 2,195/2,195 assets, plus 14 prefab-only levels via `p2_prefab_levels.py` (02#9, 02#12).
- Rules: lines are free; slots 1/2/3 at level <10 / 10-29 / >=30; per-line spawn interval `K*60/(ws*L+60)`; growth only with zero lines; capture when damage > level, overshoot discarded; win = own every non-ignored building (03#1).
- Sim is real-time Unity, non-deterministic (`deltaTime`, unseeded RNG); lockstep only in Clan Wars (03#1, 03#11, 04#11).
- AI: one action per tick, weakest-first targeting, never cuts lines, scripted step queues; difficulty = bot power percentage (80..200), not AI rules (04#0, 04#8).
- Meta is data-driven by 261 RC `game_settings` keys (05#0).
- Port (06): one `packages/defs`-style module registry, rules profiles (`na-v1` / `tw-1.29`), content packs; roadmap SP-A..SP-H; campaign coverage ladder 38 -> 1,012 levels (3.8% -> 100%) across M1..M6 (06#0, 06#3, 06#4).
- Art pipeline GLB prototypes (`catalog/glb_proto*`) are unvalidated in a renderer (01#8.2).

## Contradictions / unresolved

- Rage-chance caps: 35% player / 50% bot (05#3.7) vs 30 / 200 in `statsParameter` config (03#5.10). Unresolved: different RC keys or live overrides.
- Artefact Gold main-stat step: +2 (01#2.4 ScriptableObject) vs +0.5 (RC `statsData`, 05#3.3; others SO/2).
- `BT` (AiBehavior): 02#3.3/02#10 and 06a treat as personality (rusher/turtle/opportunist); 04#0 shows 1 and 2 behave identically and are an attack-only subset of 0. 04 is decomp-backed; trust 04.
- Scripted-AI level count: 601 of 1,012 (02#10) vs 621 of 1,024 (04#6.3); list sizes differ.
- Bomb booster default aim count: 1 (03#8.10) vs 3 (05#4.6).
- AI under-attack reaction handler appears inert (inverted owner check; medium-high confidence; 04#4). `MinRD/MaxRD` effectively unused.
- RC values are APK defaults; live SayKit server may override balance/meta numbers (01#9, 05#1).

## Open decisions for owner (06#5)

- D1 Where imported TW content lives (repo / private pack / generate locally).
- D2 Fidelity target: exact feel numbers + native units vs gameplay-equivalent retune.
- D3 One ruleset or two (opt-in profiles vs replace v1).
- D4 Fate of NA-native game (`na-core` pack kept or retired).
- D5 Unit HP model: flat 1/2/1 vs power-derived.
- D6 Tick rate (20 Hz vs 30/60; major bump).
- D7 Meta scope (garage, research, artefacts, summon, quests, tower, arena, boss, festivals; skip ads/IAP/clans).
- D8 Building art-stage thresholds (not serialized; default 10/30?).
- D9 AI fidelity: exact simple TW AI vs keep NA utility bots (and inert reaction handler).
- D10 Layout/camera: TW portrait 1080x1920 FOV 21 vs landscape diorama.
- D11 Level-family scope (Common only vs Daily/PvP/Arena/Tower/Boss/Festival).
- D12 Surplus lines when building level drops (`slotLoss: keep` vs auto-cut; needs decomp check).
- D13 Tutorials: data-driven step table vs skip.
