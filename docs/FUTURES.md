# Futures

Ideas deferred from current work. Not scheduled.

## From Node Arena PRD resolution (2026-10-22)
- **Port TW resource piles (AI pile targets).** Dropped from 06; shifts weakest-first order on 412 levels.
- **`validate:content --fix-requires`.** Auto-fill level `requires`; manual until then.
- **Optional campaign `loop`.**
- **Web bundle/size budget gate** beyond per-model budgets.

## From SP06 AI port (2026-10-22)
- **Resource piles as AI targets (dropped).** Not ported; see the pile entry above (weakest-first order shifts on 412 levels).
- **Reaction/under-attack handler.** Not implemented (inert as compiled in TW); revisit only if a level needs it.
- **Boss, rocket-tower aiming and railway AI.** Not ported (no params, no behaviour).
- **`seatPower` / difficulty scaling.** TW Common bots start at 80% of player power; ours are 100%. Needs a meta/difficulty design first.
- **Useless-attack behaviour.** Disabled in TW RC; not ported.

## From SP07 review (2026-10-23)
- **Environment dressing pass.** Ref bands carry rocks/crates/tyres/sandbags/trees (green) and cliffs/igloo/snowmen (snow); dropped for the `ground` 500-tri budget. Add as instanced low-poly props with a new budget class (`top_part_2`/`bottom_part_2` are 5.3k/4.2k green, 3.7k/1.8k snow tris).
- **Persistent lane + cannonball tower beam.** Ref shows a solid green lane line plus a visible cannonball for tower shots; ours is a short-lived beam flash (`tower-shot` fx).
- **Tower range ring polish.** Ring is a translucent disc + brighter edge tuned by eye against JPEG refs; revisit colours/opacity if a real-device pass shows a mismatch.

## From SP09 documentation refresh (2026-10-23)

Source facts below describe Tower War; they are deferred in Node Arena. Research proposals are not shipped contracts.

- **Walls and mines.** Campaign introductions at positions 24/36; implement damage/HP and hazards before importing those levels. [Level evidence](research/tower-wars/02-levels.md), [mechanics](research/tower-wars/03-core-mechanics.md).
- **Rivers/water and bridges.** First river at position 103; bridge resources and river obstacles need modules. [Level evidence](research/tower-wars/02-levels.md), [mechanics](research/tower-wars/03-core-mechanics.md).
- **Rocket towers, capture rocket towers and fortress.** Distinct aiming/charging, turrets and reinforcement behaviour; capture rocket tower appears at 89, selectable fortress at 182, rocket tower at 216. [Buildings](research/tower-wars/01-characters-units-towers.md), [mechanics](research/tower-wars/03-core-mechanics.md).
- **Trolley and railway.** Introductions at 267/330; moving explosives, movable buildings and AI rail steps need explicit rules. [Levels](research/tower-wars/02-levels.md), [mechanics](research/tower-wars/03-core-mechanics.md), [AI](research/tower-wars/04-ai-bots.md).
- **Shield/ranged unit modules.** Source warriors support shielding/artillery. Current units use flat data; module/schema extension remains future work. [Source combat](research/tower-wars/03-core-mechanics.md), [architecture proposal](research/tower-wars/06-gap-map-and-architecture.md).
- **Boosters: bomb and speed.** Deferred by owner. Record APK-default config: bomb = 3 aims per use; speed = 1.3× unit speed and 1.7× spawn rate; first availability at level 4, 15 s initial bomb-button delay and 20 s after-reload cooldown. The RC also lists a 10 s next delay; these timings concern the bomb button, not an established speed duration. [Meta §4.6](research/tower-wars/05-meta-modes-ux.md), [speed parameters and mechanics §8.10](research/tower-wars/03-core-mechanics.md). Research mechanics reports a conflicting bomb default of 1; the RC/meta evidence supplies 3, as recorded in the research index's contradictions.
- **Tutorials.** Source positions 1–3 and prefab tutorial scripts need a deliberate onboarding design. [Level formats](research/tower-wars/02-levels.md), [UX](research/tower-wars/05-meta-modes-ux.md).
- **Meta, coins, skins, garage and shop.** Source progression/economy and 43 skins are research evidence, not implemented systems. [Units/skins](research/tower-wars/01-characters-units-towers.md), [meta](research/tower-wars/05-meta-modes-ux.md).
- **PvP follow-ups.** Matchmaking/ranked, accounts + Firebase Auth (`hello.auth` slot exists), in-match chat, mobile/portrait, server-side replay storage/sharing, fog of war, per-PR Fly staging, multiple machines/regions and cosmetics.
- **Cargo.** Source crates/drops exist; all shipped imported levels drop cargo. [Source objects](research/tower-wars/02-levels.md), [meta](research/tower-wars/05-meta-modes-ux.md), [current fidelity ledger](LEVELS_GUIDE.md).
- **Levels 24+ and generated coverage census.** Use the static tracker in [LEVELS_GUIDE.md](LEVELS_GUIDE.md) and [source feature curve](research/tower-wars/02-levels.md); the snapshot is not a recomputed census.
- **Portrait/mobile and new themes beyond Green/Snow.** Source UI is portrait 1080×1920; source environments include Lava, Mine, Jungle and DarkMine. Landscape is current scope. [UX](research/tower-wars/05-meta-modes-ux.md), [environments](research/tower-wars/02-levels.md).
- **CrossingSource seam.** SP04 used direct geometry/crossing handling; a generic crossing-source abstraction was deferred. Revisit when new path modifiers demand it. [Source crossing/rivers/gates](research/tower-wars/03-core-mechanics.md), [SP04 settled design](agent_files/feat-tower-war-port-20261022-0321/04-geometry-shooters/PRD.md).
- **Web bundle budget gate.** Still deferred beyond asset triangle/texture budgets (earlier port entry above); size the gate from actual client output. [Asset/architecture evidence](research/tower-wars/06-gap-map-and-architecture.md), [SP09 gate scope](agent_files/feat-tower-war-port-20261022-0321/09-gates-tooling-docs/PRD.md).

## From level editor v1 (2026-10-24)

- **Bot script editing.** Current editor removes a player's script when a referenced building is deleted; authoring scripts remains deferred.
- **Level deletion UI (v1.1 or later).** No editor delete flow; future work must remove the `na-*` file and custom entry, removing `custom.json` when empty, then refresh versions/locks.
- **Campaign/custom level reorder UI.** Positions remain authored data; no ordering tool in v1.
- **Hot reload of external level edits.** No live reconciliation into an open draft; reload/reopen deliberately. [Current editor workflow](LEVELS_GUIDE.md#4-author-an-original-level).

## From PvP M2 play-test (2026-10-29)

- **Cross balance.** FFA and adjacent-team imbalance observed in bot play; cause unproven. Investigate before tuning; no balance/content changes in this M2 run.
- **Host-drop readiness.** Host disconnect leaves ready flags uncleared. Revisit lobby readiness policy and behavior; deferred from this M2 run.

## From PvP M2 re-review (2026-10-30)

- **Per-IP limiter scaling and NAT sharing.** Per-IP limit maps prune O(n) once past 10k entries; the 30/min connection and 20/min catch-up caps are shared by all clients behind one NAT. Consider amortized pruning and revisit caps/keying. [Review](agent_files/feat-pvp-20261028-1435/review-2026-10-30-1617.md).
- **Absolute cap on paused rooms.** GC skips paused rooms, so a sole human with unlimited pause holds a room indefinitely while connected. Consider a 1 h absolute cap. [Review](agent_files/feat-pvp-20261028-1435/review-2026-10-30-1617.md).
