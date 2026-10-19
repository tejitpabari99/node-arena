---
status: done
summary: Deep research — node-capture games (Galcon, Mushroom Wars 2, Auralux, Eufloria, Tentacle Wars, Planet Wars, tower-war mobiles) mechanics + how their AI handles difficulty, commitment/oscillation, per-level tuning; recommendations for Node Arena bots
date: 2026-10-19
---
# Node-capture games: mechanics and AI setup (research for SP02 bot commitment)

Depth: exhaustive (4 directions). Public sources are thin: no shipped node game has published its AI internals. Many points come from reviews, store pages, open-source clones and general game-AI literature. Items marked *(snippet)* rest on search-result summaries, not a full page read.

## TL;DR
- **No node-capture game found exposes named AI personalities.** Difficulty is a numeric tier (Galcon bot levels ramp "at level 11" [5]), Easy..Hard with hidden info on hard (Mushroom Wars 2 [7]), or a **handicap** (Galcon `-handicap player+100,enemy+0` [4]). Node Arena's personality x tier split is richer than anything documented.
- **Difficulty levers in practice:** handicaps (production/ships/win margin: Galcon [4][19], Spring/AoE), info hiding (MW2 [7]), reaction speed / decision interval (Enemy Masses toolkit: 0.1–2 s, 0.5 s default, 0.2 s competitive [22]), strategy choice (PlanetWarsWebWorkers bots differ by strategy, not by a skill param [16]).
- **Anti-oscillation in the literature is score-based or tied to the decision cycle, not fixed seconds:** weight on the current action, cooldown with a high stay-weight that decays, or deferring re-decision until the action completes (Game AI Pro ch. 9 §9.7 [20]); "commitment bonus" on the last decision (Game AI Pro 3 ch. 13 [21]). Neither source says to vary these by difficulty.
- **Open-source node bots mostly have no commitment at all**: Galcon `classic.lua` re-picks every fleet's target every tick and redirects on any change, which invites flip-flopping (classic.lua:98-107 [14]). The Planet Wars 2010 winner replanned every turn using simulation; stickiness is not stated [11].
- **Implication:** our tier-aware scaling (windows scale with `decisionIntervalSec`) matches the "count in decisions" view. If bands still fail, the documented pattern is **per-level handicaps**, not per-level AI rewrites (inferred from [4][7][19]).

## Findings

### 1. Fleet/send games — mechanics
- **Galcon** [1]:
  - Planet number = ships held. The player sends a chosen % of ships, can redirect fleets mid-flight, and larger planets produce faster. Win by eliminating the enemy.
  - The iPhone release has bots of varying difficulty [1]. Galcon 2's practice AI is "fast and aggressive" with selectable difficulty *(snippet)* [3].
  - A Steam player: "At level 11, the bots seem to ramp upward in skill" [5].
  - The gbots dev tool ships bots `rand`, `sqrt` and `classic`. Difficulty there is handicap-only [4].
  - Galcon Legends later required the player to have 50% more ships than the bot to win, a rules-level handicap *(snippet)* [19].
- **Mushroom Wars 2** [7][8]:
  - Three building types. Villages produce units; forges boost attack/defense with diminishing returns; towers shoot and don't produce.
  - Upgrades cost troops: "5 to get to level 2, then 10, 20 and so on" [7]. You send a % of a building's units.
  - Each mission is playable at several difficulties (four in campaign [23]). Hard means a stronger AI **and** hidden information: Easy shows enemy troop counts and attack warnings [7].
  - Reviewers note an early difficulty spike [24].
- **Auralux: Constellations** [9][10]:
  - 150 levels. Each "constellation" is a level pack with one twist (nebulas, fog of war, etc.). Snowball: owning more stars makes capture easier.
  - Players report the AI focusing the player ("feels 2v1") and high difficulty feeling "artificially hard" [10] (aggregator, low reliability).
- **Eufloria** [18]:
  - Seedlings plant trees on asteroids, 1–5 per asteroid. Dyson trees shoot; defense trees lay mines. Seedling stats come from the asteroid.
  - Patch 2.06 says "the AI was updated to think more carefully" *(snippet)* [25]. No numbers given.

### 2. Line/tentacle games — mechanics (closest to Node Arena)
- **Tentacle Wars** (FDG iOS, from a Lumarama Flash game) [26][27]:
  - Drawing a tentacle drains the target until it flips. Range scales with cell power, the stronger cell wins, and several attackers combine.
  - **Cut:** a mid-tentacle cut means "half the resources return to the attacking cell" and the rest hits as a burst; cutting near an end sends all units one way [27].
  - **Slots:** "Each cell type can extend only a set number of tentacles at once" [27]. Numbers not stated.
  - Tentacles that meet head-on fight it out *(snippet)* [28].
  - Cells gain power per second up to a cap. There are cell types, neutrals and a purple "superior intelligence" faction.
  - Campaign: 80 missions with 3-star goals plus a random-level mode [26]. A 2012 review says 40 levels [27], probably an older version.
  - Players: some levels are "literally impossible" for 3 stars; one asked to "make opponent chains slower"; one liked random levels with "a particularly aggressive AI opponent" [26]. **No reports of AI flip-flopping found.**
  - AI count per level and how difficulty ramps: not stated. The store pitch only says the enemy "fights back without ever giving up" [29].
- **Phage Wars** (only a JavaFX student clone was found): "As you advance to higher levels the enemies get stronger and stronger" [30]. No detail on how.
- **Tower War – Tactical Conquest (SayGames)**: multiple enemies, barriers, blockades and mines; a reviewer says progress is slow without paying [31][32]. No info on line or AI mechanics.
- **State.io**: only a tip page (upgrade unit power and production first) [33].
- **City Takeover, Cell Expansion Wars**: not covered.

### 3. AI in code
- **Planet Wars 2010 winner** (Gábor Melis) [11]:
  - Simulation-based, with a per-turn future owner/ship vector. Candidate moves are scored, sorted and combined greedily.
  - Uses 4-ply alpha-beta in the opening, until the third planet is captured.
  - A "very slight positional penalty every simulated turn for every enemy ship" pulls ships toward threats.
  - Replans every turn. Commitment or stickiness: not stated.
- **Other Planet Wars bots** [12][13]: GreenTea plays in "rigid phases"; wagstaff plays cautious when ahead and desperate when behind; oddshrimp "often change targets" ("tacking"), the opposite of stickiness.
- **Galcon gbots** [14]:
  - `classic.lua` acts on every `/TICK` with no throttle. It picks the source with the most ships (>= 17) and sends a fixed 65%.
  - Target value: `return -target.ships + target.production - dist * 0.20` (classic.lua:65).
  - `redirect_fleets` re-targets every in-flight fleet whenever the best target changes (classic.lua:98-107): no hysteresis.
  - `bluemax.lua` is stateless. It sends 42.5% repeatedly and keeps `HOLD_PROP` × production at home.
- **PlanetWarsWebWorkers** [16]:
  - Fixed step `stepInterval = 80` (planet_wars.js:193), with `think()` called once per step.
  - Difficulty comes from choosing a strategy (about 17 bots). `AttackBestPlanetPlayer` keeps `reserveFactor = 10`× production at home and shuffles ties randomly every turn, again the opposite of stickiness.
- **No open-source Tentacle Wars, Auralux, Mushroom Wars or State.io AI found.** No open-source node bot implements timing-based difficulty (reaction delay, noise, actions per decision).

### 4. Difficulty and balance in practice
- **Game AI Pro ch. 9 §9.7 "Inertia"** [20]:
  - "add a weight to any action that you are already currently engaged in", or use a cooldown where the stay-weight is "extremely high" and then reverts or decays.
  - Or don't re-decide until the action ends (The Sims Medieval).
  - Which fits "really depends on the type of game."
- **Game AI Pro 3 ch. 13** [21]: a "commitment bonus" on the last decision. Warning: such fixes "do not eliminate the possibility of two decisions oscillating—they simply shift where the scores will land."
- Unity Utility Intelligence has a "momentum bonus" on the last decision-target pair *(snippet)* [34].
- **Enemy Masses RTS toolkit** (the only per-difficulty parameter structure found) [22]:
  - Difficulty 0–5. Decision interval 0.1–2 s (0.5 s default, 0.2 s competitive) and decision variance 0–0.5 s.
  - Beginner: "slow reactions"; Nightmare: "instant reactions". No commitment parameter and no handicaps.
- **RTS hard modes commonly cheat** (economy or fog), per player forums and a dissertation *(snippet)* [35][36]. Players complain about cliffs between tiers (AoE Hard to Hardest) [36].
- Self-play tuning: Planet Wars papers tuned bot constants with genetic algorithms and coevolution [37]. Our `pnpm balance` matrix is the same idea.

## Recommendations for Node Arena
1. **Keep tier-aware commitment (current Task 5 fix)** and express the time windows in decision cycles. `minLineLifetimeSec` and `redrawBlockSec` scale with `decisionIntervalSec`, consistent with the decision-cycle commitment above [20][21]. Score-based levers (`cutMargin`, `tieHysteresis`) stay unscaled; they are already interval-independent.
2. **Consider a decaying stay-bonus** (cooldown whose weight decays) as a future softer alternative to the hard lifetime lock [20]. Log it in `docs/FUTURES.md`, not this SP.
3. **If bands still fail, prefer per-level handicaps over AI changes.** Starting garrison, production multiplier, or seat assignment in level JSON is the Galcon, MW2 and RTS pattern [4][7][19]. It keeps bot behaviour uniform. Needs an owner decision: SP02 forbids level edits.
4. **Optional per-variant commitment override**, default none and used only for logged exceptions. No node game documents this; it's an escape hatch.
5. **Difficulty beyond skill params:** MW2-style information hiding (hide enemy counts on hard) is a player-facing lever, not a bot lever. Candidate future idea.
6. **Keep self-play tuning** (`pnpm balance`) as the loop. A param grid or GA search over commitment and handicap matches the Planet Wars practice [37].

## Contradictions & uncertainty
- Tentacle Wars campaign size: 40 levels [27] vs 80 missions [26], probably different versions. Mushroom Wars 2 mission count: 100+ vs 300+ [7][8].
- Planet Wars winner: the search snippet mentions UCT, while the fetched post-mortem says alpha-beta [11]. Unresolved.
- Hysteresis vs momentum vs cooldown: all offered, with no rule for when to use which [20][21].
- Cheating in hard modes: forums say common; one commenter says SC2 doesn't cheat [35].

## Gaps
- No shipped node game documents AI internals, per-difficulty commitment, or per-level AI params.
- No numbers for slot limits, line costs, production rates or combat formulas.
- Not covered: City Takeover, Cell Expansion Wars, the original Phage Wars, YouTube and wikis (some 402/403 errors).
- No GDC or Supercell talks on hyper-casual tower-war level tuning found.
- Next sources to try: Melis's Planet Wars source, Phil Hassey's Galcon bot posts, a decompiled tower-war mobile config (owner decision).

## Sources
1. https://en.wikipedia.org/wiki/Galcon
2. https://giantbomb.com/wiki/Games/Galcon
3. https://gamingonlinux.com/2014/11/galcon-2-strategy-game-launched-its-free-2-play
4. https://www.galcon.com/bots/tutorial.php
5. https://steamcommunity.com/app/294160/discussions/0/617321352370668812
6. https://www.galcon.com/bots/
7. https://www.keengamer.com/articles/reviews/mushroom-wars-2-review/
8. http://www.gamingonlinux.com/2017/10/some-thoughts-on-the-fast-paced-strategy-game-mushroom-wars-2
9. https://www.gamedeveloper.com/game-platforms/auralux-constellations
10. https://vaporlens.app/app/444130/auralux_constellations
11. https://quotenil.com/planet-wars-post-mortem.html
12. https://satirist.org/ai/planetwars/playing-styles.html
13. https://www.satirist.org/ai/planetwars
14. https://github.com/haller33/gbots (classic.lua, bluemax.lua)
15. https://github.com/haller33/gbots/blob/main/docs/protocol.md
16. https://github.com/mkaydev/PlanetWarsWebWorkers
17. https://benzedrine.ch/planetwars.html
18. https://www.vice.com/en/article/sheppard-s-video-game-pie-eufloria/
19. https://www.philhassey.com/blog/2013/10/
20. https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter09_An_Introduction_to_Utility_Theory.pdf
21. https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf
22. https://arawn-software-publishing.gitbook.io/enemy-masses/rts/rts-opponent-ai
23. https://www.digitallydownloaded.net/?p=43678
24. https://www.cubed3.com/games/reviews/nintendo-switch/mushroom-wars-2
25. https://www.fileplanet.com/archive/p-46203/Eufloria-Patch-v2-06
26. https://apps.apple.com/app/id1065786902
27. https://toucharcade.com/?p=96673
28. https://www.appspy.com/tentacle-wars-review
29. https://www.fdg-entertainment.com/?p=694
30. https://ssw.jku.at/Teaching/Lectures/SpezialLVA/JavaFX/Games/PhageWarsFXRolandHacklClemensBirklbauer/PhageWarsFX.html
31. https://apps.apple.com/US/app/id1579356887
32. https://justuseapp.com/en/app/1579356887/tower-war-tactical-conquest/reviews
33. https://www.gamezebo.com/2021/04/26/state-io-strategy-guide-win-every-state-with-these-5-best-hints-tips-and-cheats/
34. https://uintel-go.utilityworlds.com/Documentation/UtilityIntelligence/Decisions/
35. https://steamcommunity.com/app/1486920/discussions/0/603030907426769441
36. https://forums.ageofempires.com/t/please-introduce-a-new-ai-level-between-hard-and-hardest/288759 ; https://gradex.staffs.ac.uk/wp-content/uploads/2025/05/5226_Dissertation-on-Creating-Challenging-AI-in-Games.docx
37. https://riuma.uma.es/xmlui/handle/10630/7697
