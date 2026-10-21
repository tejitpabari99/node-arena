# Node Arena - Mechanics Research (2026-10-06)

Legend: [V] = verified in fetched source; [S] = search-snippet / secondary source; [U] = unverified / inferred.
Method: WebSearch + WebFetch. Some pages blocked (403/404/truncated); gaps noted at end.

## A. Map objects / map power-ups

| Object | How it works | Games | Src |
|---|---|---|---|
| Multiplier/add gates (blue +N / xN, red -N) | Troops walking through gain or lose units. "+3" turns 1 unit into 4. Red gates are hazards | Tower War [V] | levelwinner Tower War guide |
| Portal | Line through portal duplicates troops sent | Tower Battle: Connect Towers [S] | store listing |
| Breakable walls | Wooden barrier; troops must target/destroy it before crossing | Tower War [V] | levelwinner |
| Bridges | Span gaps; troops build them when route crosses gap | Tower War [V] | levelwinner |
| Land mines | Kill units on contact; delay, not permanent block | Tower War [V] | levelwinner |
| Gold bars | Finite pickups that speed tower level-up | Tower War [V] | levelwinner |
| Railways | New element in an update | Tower War [V] | App Store |
| Screens / walls | Towers invulnerable behind screens; later levels add walls | City Takeover [S] | gamezebo, search snippet |
| Floor tiles | Tiles increase/stop unit production; tiles speed/slow movement | Mushroom Wars 2 [S] | Wikipedia/search summary |
| Wind pushers, caves (teleport) | Alter movement routes | Mushroom Wars 2 [S] | same |
| Wormholes | Teleport units across map | Auralux Constellations [S] | techgage |
| Nebulae | Change speed of passing units | Auralux [S] | same |
| Fog of war, supernovae, white/black holes, gamma bursts, orbiting planets, "fracture" (planet destroyed, later heals) | Per-constellation twists, one new feature per pack | Auralux [S] | same |
| Power-up cells (2x production / attack / speed / defense) | Special node variants | Phage Wars 2 [S] | armorgames |
| Collision | Opposing armies in transit eliminate each other | State.io [V] | mobilegaminghub |
| Tentacle tug-of-war | Opposing routes clash midway, drain each other; cutting a route dumps in-flight units into target at once | Tentacle Wars [V] | gamezebo review |

Takeaways: Auralux's "one new twist per level pack" is a proven content-drip pattern. Gates/portals are the cheapest, most readable "free value" objects for route-drawing games.

## B. Player-activated abilities / boosts

| Game | Ability | Cost model | PvP-fair? |
|---|---|---|---|
| Tower War | Air Support: instantly sets targeted enemy tower to level 0 [V] | Gold (bought); guide: PvP use | Gold-gated; not symmetric |
| Tower War | Ad boost x3 troop gen for a battle after first fail [V]; 3x speed via ad/pay [V App Store] | Rewarded ad / purchase | PvE only |
| City Takeover | Freeze opponents via video on hard levels [V gamezebo] | Rewarded ad | PvE |
| Tower Battle | "Special powers", attacks that reduce enemy tower attack [S] | Unknown [U] | Unknown |
| Mushroom Wars 2 | Hero skills + 5th spell-scroll skill (Poultry Yard, Totem of Rage, BFG9000 portal, Defensive Walls); mythical scrolls ~90s cooldown (Kraken, Titans), Scroll of Ice freeze [V mw2.su] | Cooldown; scroll is equipped artifact (rarity-gated, ~$50 each per review) | Cooldown structure fair; artifact acquisition drove P2W complaints |
| Mushroom Wars 2 | Morale: upgrading buildings raises morale [V mw2.su] | passive | - |

Takeaway: cooldown-based, equal-loadout abilities are the PvP-fair pattern; currency/ad-bought one-shots (Tower War air support) are PvE monetization and unfair in PvP.

## C. Building / tower types

**Tower War: Tactical Conquest** [V levelwinner]
- Barracks: basic, continuously spawns infantry.
- Factory: spawns tanks (tank = 2 soldiers strength).
- Sniper tower: no troops; randomly shoots enemies in range; radius grows at levels 10/20.
- Rocket launcher: player sets target anywhere on map to bombard constantly.
- Fort: large; troops parachute in, levels much faster than others.
- App Store also lists artillery posts, tank factories; obstacles: barriers, blockades, mines.
- No in-match type switching found [U].

**Mushroom Wars 2** [V mw2.su, fandom]
- Village (produces units): 5 tiers (tier 5 only as map start); each upgrade = faster production, more defense, higher capacity.
- Tower: shoots enemies in radius, tougher to capture; 4 tiers (mw2.su; fandom says 3 upgrades); each upgrade costs constant 20 units, time grows per tier.
- Forge: tier 1 only; global attack/defense bonus per forge; caps at 4 forges (5th adds nothing); attack bonus > defense; guide ~1 forge per 4 producers.
- Switching: any building converts to another type for 30 units; village/tower reset to level 1. Hotkeys A/S/D.
- Exact production/capacity numbers: not found in text.

**City Takeover** [S/V gamezebo]: grey neutral, normal towers, "triangle" towers (more damage to attackers and buildings), shielded invulnerable towers. Nothing more found.

**Tower Battle** [S]: units runners, engineers, bombers, mercenaries, tanks, commanders (units, not building types).

**State.io**: regions only; regen to cap ~120 [S]; no building types.

**Auralux** [S]: planets upgraded into larger bodies by absorbing units; size sets production. **Galcon** [V wiki]: planets produce ships; size = production; no upgrades. **Nano War** [S]: cell sizes small to XL, bigger = faster production and more capacity. **Tentacle Wars** [V/S]: cells with fixed spawn; later world adds absorber cells; tentacle range tied to cell power. **Phage Wars 2** [S]: virus stats strength/speed/defense/agility/reproduction, power-up cells. **Eufloria** [S]: asteroids host limited trees; 10 seedlings -> Dyson tree (produces) or Defensive tree (explosive fruit); planet attributes transfer to units. **Cell Expansion Wars** [S, thin]: "cells have specific roles"; details unverified [U].

## D. In-match upgrade models

**Tower War** [V levelwinner / S]
- Tower number = level = garrison. Idle soldiers (no path drawn) accumulate and raise level; range 0-63.
- Capture: reduce enemy tower to 0.
- Milestones: level 10 = 2 outgoing paths, level 20 = 3 paths; sniper radius at 10/20.
- Gold bars on map boost leveling. Upgrade is "troops = level", not a spend action; routes drain garrison.
- Meta gold buys tower upgrades pre-battle [V].

**City Takeover** [S]: App Store: "connect your buildings together to grow them taller, grow a bigger army". Buildings grow taller with population (inferred thresholds) [U]. Exact thresholds, caps, route limits not found [U].

**Mushroom Wars 2** [V]: explicit spend-units upgrade: tower 20 units/tier; village tiers raise capacity+production+defense; conversion 30 units.

**Auralux** [S]: upgrade planet by absorbing units; sending reinforcements to the planet being upgraded speeds it; per-planet force cap [S].

**State.io** [V]: no in-match upgrade; spawn cap ~120 [S]; meta upgrades only.

**Pattern:** two proven models: (1) garrison-as-level (Tower War: number = health = level, thresholds unlock route count), (2) explicit spend (MW2, Auralux).

## E. Meta-progression and reception

- **Tower War:** gold (upgrades, air support), gems (25/summon), troop rarity gray-gold, equipment (merge 3 -> higher grade, 4 slots unlocked at troop levels 5/15/25), league points PvP, clans, battle pass, arena [V]. Reviews: aggressive monetization, progress beyond ~level 15 needs real money, troop-level tokens only via cash, ads ~70% of playtime, rigged-seeming summons, some characters ~$100 [V App Store/review search]. 4.6 stars / 182K ratings.
- **City Takeover:** 4.5 stars / 61K; cosmetics (shields, animal heads, weapons) [S]; reviews: "no ads" purchase still shows ads, booster issues; IAP $1.99-$23.99 [V].
- **Tower Battle:** 4.0 Play (39K) / 4.6 iOS; ads after every level, $13/mo ad removal, enemies scale beyond free progression [V/S].
- **Mushroom Wars 2:** 4.5/27K; P2W: artifacts ~$50, need spend to compete at top; players tank matches to get weak opponents [V].
- **State.io:** 3 coin upgrades: start units, production speed, offline earnings (production speed = priority) [V].
- **Phage Wars Live:** stat points between matches strongly affect outcomes [S].
- Pattern: persistent power upgrades in PvP drive P2W complaints; cosmetics-only is uncontroversial.

## F. Recommendation for Node Arena

Principle: symmetric kits; all gameplay power in-match; meta = cosmetics/modes. Avoid Tower War / MW2 P2W trap.

**Tower types (start 3-4)**
1. Barracks (core): baseline spawner; capacity cap; levels via garrison thresholds.
2. Fortress (core): low production, high defense multiplier and cap, fewer out-routes.
3. Turret (core): no spawn; shoots enemy troops passing in radius (Tower War sniper / MW2 tower); costlier to capture.
4. Forge/Beacon (core-late): aura (+attack or +production) stacking cap 4 (MW2).
5. Later: Factory (heavy units, 1 = 2 strength); artillery with player-set target.
- Type conversion (later): fixed troop cost (MW2: 30), resets level, short lockout.

**Map power-ups (start 3-4)**
1. +N / xN gate (core): troops through gain units; visible to both sides.
2. -N hazard gate / mine (core).
3. Breakable wall / barrier (core); bridge optional.
4. Speed pad / slow field (later; Auralux nebula, MW2 tiles).
5. Portal (later; Tower Battle, Auralux wormhole).

**In-match upgrade model**
- Garrison = level (Tower War); auto thresholds: L10 = 2 outgoing routes, L20 = 3 routes (proven), each tier raising production rate, capacity cap, defense. Routes drain garrison so routing is the core tradeoff.
- Capture by depleting garrison to 0; route-vs-route collision/tug-of-war midway (Tentacle Wars); route cut dumps in-flight units into target.
- Later: explicit spend-N-troops tier upgrade (MW2 20-unit style); recapture grace (MW2 1s).

**Abilities (later, PvP-fair):** equal loadout, cooldown-only (~90s): freeze route, shield tower, speed burst. No currency-bought abilities in PvP.

**Meta (later):** cosmetics, ranks, map packs; no stat advantages.

**Core MVP:** Barracks, Fortress, Turret, route-cutting, collision, +N/-N gates, walls, garrison-level thresholds with route count. **Later:** Forge, conversion, portals/pads, abilities, cosmetics.

## Sources
- https://apps.apple.com/us/app/tower-war-tactical-conquest/id1579356887
- https://www.levelwinner.com/tower-war-tactical-conquest-beginners-guide-tips-tricks-strategies/
- https://www.gamezebo.com/walkthroughs/city-takeover-strategy-guide-the-best-hints-tips-and-cheats/
- https://apps.apple.com/us/app/city-takeover/id1538467877
- https://apps.apple.com/us/app/tower-battle-connect-towers/id6745478496
- https://apps.apple.com/us/app/mushroom-wars-2-rts-td-war/id1141358828
- https://mw2.su/en/physics_en/buildings/ (and /villages/, /towers/, /forges/, /artifacts/)
- https://mushroom-wars-2.fandom.com/wiki/Buildings ; https://en.wikipedia.org/wiki/Mushroom_Wars_2
- https://mobilegaminghub.com/state-io-conquer-the-world-beginners-guide/
- https://www.gamezebo.com/reviews/tentacle-wars-review/
- https://www.levelwinner.com/auralux-constellations-tips-tricks-guide-build-forces-take-planets/ ; https://techgage.com/news/the-sounds-of-mass-destruction-auralux-constellations-review/
- https://en.wikipedia.org/wiki/Galcon_2
- https://armorgames.com/community/thread/8567172/ ; https://armorgames.com/news/production-notes-phage-wars-2
- https://www.gamezebo.com/reviews/eufloria-review/
- https://apps.apple.com/us/app/tower-war-tactical-conquest/id1579356887?see-all=reviews
- https://poki.com/en/g/nano-war

## Gaps
Exact City Takeover upgrade numbers; MW2 per-tier stats; Cell Expansion Wars types; Reddit threads not directly retrievable (Reddit not fetched; review complaints from App Store/Play via search); Tower Battle ability costs; State.io wiki 403.
