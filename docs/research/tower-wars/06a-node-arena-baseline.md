# 06a - Node Arena baseline (our side)

Purpose: document how Node Arena models towers, troops, lines, content, bots and art today, so a later agent can build a gap map and a modular architecture proposal for the Tower War port.

Scope: worktree `/root/projects/node-arena-wt-tower-war-research`, branch `research/tower-war-teardown`, HEAD `17374c8` over `641604e` (v1.1). All paths below are relative to the worktree. "not stated" means no source says it; nothing is inferred unless labelled **Observation**.

Versions at HEAD: `contentVersion 1.1.6`, `schemaVersion 1.0.0`, `rulesVersion 1.0.0` (`packages/content/content.json:3-5`); `RULES_VERSION = '1.0.0'` (`packages/content/src/versioning.ts:7`); manifest schema `1.2.0` (`packages/content/src/manifest.schema.ts:6`); `BOT_VERSION = '1.6.1'` (`packages/bots/src/version.ts:2`).

---

## 0. Architecture in one paragraph

Content JSON (`packages/content/data/**`) is validated and compiled (`compileLevel`, `packages/content/src/compile.ts:73`) into a `CompiledLevel`. This is the only boundary the sim, bots and web client share (`compile.ts:65-69`). The sim (`packages/sim`) is a deterministic integer engine. Its behaviours are named components registered in a `ComponentRegistry` (`packages/sim/src/registry.ts:32`). Rules live in `docs/GAME_RULES.md` with permanent `R-AREA-NN` IDs. The web client (`apps/web`) reads only the public sim view. It binds visuals through a separate presentation manifest (`apps/web/assets/manifest.json`), keyed by a `visual` string on archetypes and troops. The render code carries no archetype or troop IDs (`apps/web/README.md:19`). I grepped `apps/web/src` for archetype and troop ids, and the only hits are in `dev/` and `test-harness/`.

---

## 1. Entity model

### 1.1 Tower / node ("archetype" + components)

- A tower has a stable ID, position, owner (or neutral), garrison and an archetype composed of supported components (R-ENT-01, `docs/GAME_RULES.md:65`). Unknown components are content errors (same rule).
- Level instance fields: `id, archetype, pos{x,y}, owner|null, garrison` (`packages/content/src/core.schema.ts:59-61`).
- Archetype fields: `id, extends?, visual, footprintRadius, components{name: params}` (`core.schema.ts:36-38`). Shipped archetypes: `standard`, `small`, `large` (`packages/content/data/archetypes/*.json`).

| Archetype | footprintRadius | garrison.cap | generates.ratePerSec | extraSlotAbove | visual |
|---|---|---|---|---|---|
| standard | 3 | 50 | 1 | [10,30] | tower.standard |
| small | 2 | 20 | 0.6 | [10] | tower.small |
| large | 4 | 80 | 1.5 | [10,30] | tower.large |

(`small` and `large` `extends` `standard`; the CONTENT_GUIDE calls their values placeholders, `docs/CONTENT_GUIDE.md:33`.)

- The four components and their params are defined twice.
  - Content registry: `COMPONENT_REGISTRY` (`packages/content/src/component-registry.ts:22-30`). `garrison{cap}`, `generates{troop,ratePerSec}`, `drawsLines{extraSlotAbove[]}`, `capturable{}`, each with `ruleIds`.
  - Sim registry: `createComponentRegistry()` (`packages/sim/src/registry.ts:74-87`) registers the same four names, with per-tower integer columns such as `garrison.count`, `garrison.cap`, `generates.acc`, `generates.ratePerSec`, `generates.troop`, `drawsLines.cursor`.
  - Parity is asserted at sim creation (`registry.ts:64`, called at `packages/sim/src/state.ts:137`). A mismatch throws.
- Sim extension API exists: `SimComponent{name,state,setup,initialize,systems[phase],hooks{validateDraw,onCapture,onArrive,onHit}}` (`registry.ts:10-27`). `registerPhase(name,{after})` inserts new phases (`registry.ts:36`). Default phases are `commands, generation, departures, clash, arrivals, slots, win` (`registry.ts:8`).
- The sim test `packages/sim/test/extensibility.test.cjs` installs a fake `shoots` component with a new `ranged` phase after `clash`, using a tank kind of value 2. So the engine is shown to take a new component at the sim layer. The content registry and validator still reject it (see §6).

### 1.2 Troop

- A troop has an owner fixed at departure, a kind, remaining value and progress in a directed channel (R-ENT-02, `GAME_RULES.md:75`). Speed and visual come from the kind.
- Troop file: `id, visual, value (int >=1), speed (fx3, <=100)` (`packages/content/src/troop.schema.ts:5-13`). Shipped: only `regular`, `value 1`, `speed 10` (`packages/content/data/troops/regular.json`).
- V1 hard limit: `troopValue {minimum:1, maximum:1}` (`component-registry.ts:29`; `validateTroopValue` at `component-registry.ts:74`).
- Sim already carries per-troop value. The ring stores `value` and supports partial consumption (`packages/sim/src/state.ts:10-12,73-80`). Clash uses `min(frontA.value, frontB.value)` (`packages/sim/src/combat.ts:24-37`). Arrival damage is `min(value, count)` (`combat.ts:65-85`). **Observation:** tanks (value 2) are blocked only by the content validator and rules text, not by sim code.
- Each tower generates exactly one troop kind (`generates.troop`, compiled to a dense index into `kinds`, `compile.ts:92`). There is no per-player or per-hero troop skin. Players carry only `id, kind(human|bot), colorKey, team?, botProfile?` (`core.schema.ts:55-58`).
- Movement is lazy and analytic: `progress = p0 + (tick - t0) * speedPerTick` (`combat.ts:11-13`; R-TCK-04, `GAME_RULES.md:43`). Troops are not updated per tick. All lines are straight tower-to-tower segments; lengths are precomputed per pair (`state.ts:180-187`).

### 1.3 Lanes / links ("lines", "channels")

- Model: a drawn line authorizes departures along a directed channel; the channel keeps its FIFO of in-flight troops after the line is cut (R-ENT-03, `GAME_RULES.md:85`). Channel = `{key,from,to,length,drawn,drawSeq,owner,troops}` (`state.ts:82`).
- Commands: only `DrawLine` and `CutLine` (`packages/sim/src/commands.ts:4-6`).
- Draw constraints (R-LIN-01, `GAME_RULES.md:147`; code `commands.ts:27-38`, `packages/sim/src/economy.ts:28-34`).
  - Source must be owned by the player and must have `drawsLines`.
  - No self-lines and no duplicate directed lines.
  - A free slot is needed.
  - Reject reasons: `not-owner|self|no-slot|duplicate|gameover|unknown-id|no-component` (`commands.ts:7`).
- Slots: 1 base plus 1 per `extraSlotAbove` threshold strictly below the current garrison. The newest line is auto-cut at end of tick until the line count fits (R-LIN-02, `GAME_RULES.md:157`; code `economy.ts:5-27`).
- Same-owner reverse line is replaced on draw (R-LIN-03, `GAME_RULES.md:167`; `economy.ts:28-34`). Hostile reverse lines coexist and clash.
- Geometry: straight lines, free crossings, roads are decoration, "V1 has no functional obstacles or map objects" (R-LIN-04, `GAME_RULES.md:177`).
- Cut: swipe or right-click, same command; in-flight troops continue (R-LIN-05, `GAME_RULES.md:187`). Input code: `apps/web/src/input/index.ts:80`.
- Send model: generation is routed directly into departures round-robin across drawn lines. Stored garrison is never dispatched (R-SND-01/02, `GAME_RULES.md:127,137`; `economy.ts:35-75`).

### 1.4 Combat / clash

- Head-on clash: only opposed channels of the same pair. Only the front (oldest) troops are examined. Hostile fronts whose progress sum >= line length cancel `min(value)`; repeat while the new fronts qualify (R-CMB-01, `GAME_RULES.md:217`; `combat.ts:24-37`).
- Arrivals are ordered by overshoot, then channel, then FIFO. Friendship is re-evaluated per arrival (R-CMB-02, `GAME_RULES.md:227`; `combat.ts:45-63`).
- Hostile hit: `d = min(v, count)`; remainder captures if `capturable` (R-CMB-03, `GAME_RULES.md:237`; `combat.ts:65-85`).
- Neutral is hostile to every owner (`combat.ts:5-7`). There is no tower-shoots-troop mechanic and no neutral attacker (§6 planned).

### 1.5 Growth / production

- An owned tower with `generates` produces `generates.troop` at `ratePerSec`; neutral towers never generate (R-GEN-01, `GAME_RULES.md:107`).
- One integer accumulator per tower, with `ratePerSec` compiled to milli-units (R-GEN-02, `GAME_RULES.md:117`; `economy.ts:35-55`).
- Capacity gates garrison additions only; overflow is lost (R-CAP-01, `GAME_RULES.md:197`). At cap with a drawn line the tower keeps sending; at cap with no line, generation stops with no banking (R-CAP-02, `GAME_RULES.md:207`; `economy.ts:40`).
- Troops are value 1 and the garrison count is the displayed "level". Max cap is data (50, 80, 20).

### 1.6 Capture

- Capture is inline during the arrival that empties a garrison (R-CMB-03). It flips the owner, cancels the previous owner's outgoing lines, and resets the accumulator and send cursor (R-CPT-01, `GAME_RULES.md:247`; `combat.ts:90-110`, hook `registry.ts:80`).
- Incoming lines and in-flight troops persist (R-CPT-02, `GAME_RULES.md:257`).
- The tower archetype does not change on capture (R-CPT-01).

### 1.7 Upgrades

- None in the sim. Tower "level" is only the garrison count driving slot count (R-LIN-02) and visual floor count (`apps/web/src/render/tower-mesh.ts:28-31`, `floorsFor`).
- Campaign completion grants no persistent stat upgrades (R-WIN-02, `GAME_RULES.md:279`).
- The save stores only `completed` levels, settings and last level (`apps/web/src/save/index.ts:14-20`). A grep of `apps/web/src/ui` and `apps/web/src/app` for `unlock` finds no gating logic.
- No currency, unlock, hero or upgrade system exists. Not stated anywhere as planned beyond FUTURES.

### 1.8 Win / lose / time

- A player is alive while they own a tower or have a troop in transit (R-WIN-01, `GAME_RULES.md:267`; `packages/sim/src/tick.ts:6-35`).
- Human eliminated while an opponent lives gives `lost`. No team alive gives `draw`. Only a win marks completion (R-WIN-02, `GAME_RULES.md:277`).
- Time limit: `level.timeLimitSec ?? balance.defaults.timeLimitSec` (default 300). `tick >= limit*20` gives `timeout`, a loss, and takes precedence (R-WIN-03, `GAME_RULES.md:287`; `tick.ts:23`).
- Outcomes: `won|lost|draw|timeout` (`commands.ts:8`).
- Teams: a player's `team` defaults to their ID. V1 validation forces distinct teams and exactly 1 human plus 1-3 bots (`packages/content/src/validate-content.ts:105,111-112`; R-ENT-04, `GAME_RULES.md:95`). Team play is reserved (`GAME_RULES.md:350`).

### 1.9 Tick order and determinism

- Fixed 20 Hz tick; integer arithmetic only; stable iteration orders; seeded sfc32 PRNG that v1 mechanics do not consume (R-TCK-01..05, `GAME_RULES.md:13-61`; `packages/sim/src/math.ts`).
- Phase order is a table in `GAME_RULES.md:297-312`. The code runs the registry phase list and special-cases `clash` and `arrivals` inline (`commands.ts:83-88`).
- Replays and golden recordings are hashed (`packages/sim/src/replay.ts:79,107`). A replay header needs an exact rules major.minor match.

---

## 2. Content model

### 2.1 Files and schemas

| File / folder | Schema (TypeBox source, generated JSON schema) | Fields |
|---|---|---|
| `packages/content/content.json` | `ContentSchema` (`core.schema.ts:34`), `schemas/content.schema.json` | `schemaVersion, contentVersion, rulesVersion` |
| `data/balance.json` | `BalanceSchema` (`core.schema.ts:35`) | `defaults{timeLimitSec, theme}` (`core.schema.ts:32`) |
| `data/troops/*.json` | `TroopSchema` (`troop.schema.ts:5`) | `id, visual, value, speed` |
| `data/archetypes/*.json` | `ArchetypeSchema` (`core.schema.ts:36`) | `id, extends?, visual, footprintRadius, components` |
| `data/levels/NN-*.json`, `sample.json` | `LevelSchema` (`core.schema.ts:50-68`) | `id, name, order, band, visual?, timeLimitSec?, bounds{w,h}, players[], towers[], obstacles[], mapObjects[], overrides{globals,troops,archetypes}` |
| `data/bots/*.json` (23) + `data/examples/sample-bot.json` | `BotSchema` (`packages/content/src/bot.schema.ts:5`) | `id, kind(utility|idle), params` |
| `apps/web/assets/manifest.json` | `ManifestSchema` (`manifest.schema.ts:28-62`) | palettes, teamMarkers, models, visuals, themes, events, levelVisuals, camera |
| `packages/content/hashes.lock.json` | none (generated) | per-level `simHash`, per-bot `botHash` |

- The generated JSON Schemas are at `packages/content/schemas/*.schema.json`, written by `pnpm content:schemas` and checked by `pnpm check:schemas` (`docs/CONTENT_GUIDE.md:62`).
- Component params are an open flat bag. The named keys `cap, troop, ratePerSec, radius, extraSlotAbove` are typed in `ComponentParamsSchema` (`core.schema.ts:18-30`). Any other `[a-z][a-zA-Z0-9]*` key is accepted as scalar or scalar[] by the pattern rule, then validated by the component registry (`component-registry.ts:54-72`).
- Untagged numeric extension params must be integers. Decimals need an `x-unit: fx3` tag, which only the named fields carry (`docs/CONTENT_GUIDE.md:29`; `core.schema.ts:21-22`).

### 2.2 How a level is defined

Example `packages/content/data/levels/01-first-steps.json`:

- Header: `order 1, band 1, visual "grass", timeLimitSec 180`, `bounds {w:120,h:80}` (lines 5-13).
- `players[]` (human plus bot with `botProfile`, `colorKey "player.N"`).
- `towers[]` with archetype, `pos` in world units (loaded to milli), `owner`, `garrison`.
- `obstacles: []`, `mapObjects: []`, `overrides: {}`.

Geometry rules (`validate-content.ts:117-147`):

- Footprint (center plus radius) inside `bounds` (`2*(|x|+r) <= w`).
- Tower footprints must not overlap; touching is allowed (coincident centers fail).
- Each player owns at least one tower; at least two owners overall.
- Garrison must be `<= cap`.
- Coordinates are bounded to +/-500 (`core.schema.ts:41-42`).
- Map is a flat rectangle with tower discs only. No terrain data, no lane data (any tower pair may be linked), no per-level props (props are theme-scattered render-only).

Campaign: 20 levels, `band` 1-4 (5 per band, `packages/content/test/campaign-invariants.test.ts:51-53`). Shipped levels are 5 to 14 towers, 1-3 bots, all `grass`, all `bounds 120x80`, all `overrides {}`. Campaign authoring policy is "no level overrides" (`docs/CONTENT_GUIDE.md:37`). The helper `tools/layout/` emits symmetric (`mirror|rot3|rot4`) level JSON (`tools/README.md:7`).

### 2.3 Reserved but disabled: `obstacles` and `mapObjects`

- Schema `reservedObject{kind, pos?, footprintRadius?, delta?, hp?}` (`core.schema.ts:44-47`) exists only as a placeholder.
- The validator rejects any entry: `${name} are not implemented in v1` (`validate-content.ts:144`).
- `CompiledLevel` has no field for them (`compile.ts:65-82`), and `hashCompiledLevel` ignores them (`packages/content/src/hash.ts:58-69`).
- The sim has no obstacle code (grep of `packages/sim/src` for obstacle and mapObject returns nothing).
- Planned kinds (`gate{delta}`, `hazard{delta}`, `wall{hp}`, "line-of-sight/blocking rules") are in `docs/GAME_RULES.md:347-349`. They are stated as needing future rules.

### 2.4 Inheritance and overrides

- Archetype `extends`: depth 1 only, no cycles. A variant patches existing component params, `visual` and `footprintRadius`, and cannot add or remove components (`packages/content/src/resolve-archetypes.ts:23-28`; `docs/CONTENT_GUIDE.md:33`). Arrays replace whole.
- Level `overrides` patch existing troop params, archetype component params and `globals.timeLimitSec` on clones (`packages/content/src/resolve-overrides.ts:8-46`). They never add targets or components. Resolved patches enter the level hash.

### 2.5 Units and hashes

- fx3 fields (`x-unit: fx3`) load as milli-ints; counts stay raw (`docs/CONTENT_GUIDE.md:27-29`).
- `simHash` = SHA-256 of canonical resolved sim inputs (`hashCompiledLevel`, `hash.ts:58-69`). It includes id, time limit, bounds, players (id, kind, team), towers (pos, owner, garrison, footprint, resolved components) and kinds (id, value, speedMilli).
- Excluded: names, `visual` keys, themes, bots, schema metadata (`hash.ts:55-57`; `docs/CONTENT_GUIDE.md:74`). A visual-only reskin therefore does not move `simHash`.
- `botHash` is separate per resolved profile (`hash.ts:55`).

### 2.6 Version, lock and manifest gates (what a content change requires)

Table of changes (`docs/CONTENT_GUIDE.md:9-17`):

| Change | Requires |
|---|---|
| Tune values / add level, archetype, troop using supported behaviour | edit JSON; bump `contentVersion` if any level hash moves (strictly increasing semver, `versioning.ts:34-41`); `pnpm content:lock` |
| Change rule semantics | `GAME_RULES.md` text + changelog, rule tests with `covers R-...`, then sim code; update `RULES_VERSION` in `GAME_RULES.md:3` + `versioning.ts:7` + `content.json:5` together (`versioning.ts:43-47`) |
| Add a component / troop kind with new behaviour / widen a range | schema contract + `component-registry.ts` + permanent rule IDs + sim impl + tests together; regenerate schemas and lock |
| Change schema shape | TypeBox sources, `SCHEMA_VERSION` (`troop.schema.ts:3`) + every file's `schemaVersion`, `pnpm content:schemas`, lock |
| Reskin / rename | `name`, visual/theme/color keys; `apps/web/assets/manifest.json`; no sim bump |
| Tune bots | `data/bots/*`, `bot-params.ts` or bot algorithms; bump `BOT_VERSION` when bot hashes or algorithms change; `bots:golden --update` |

Gate commands (root `package.json:9-34`):

- `pnpm check:content --base <rev>` compares against baseline metadata and hashes, so regenerating the lock cannot hide a missing bump.
- `pnpm validate:content` checks content, lock, versions and `BOT_VERSION`.
- `pnpm check:manifest` checks visual, theme and palette keys, asset safety, triangle and texture budgets, and credits (`tools/README.md`; `apps/web/README.md`, Manifest API section).
- `pnpm check:rules` requires every active rule heading to have a test titled `covers R-...`.
- `pnpm validate:levels` runs `reference` and `idle` bots through each level. Bands 1-3 need all K reference wins, band 4 needs K-1, and idle must never win (`tools/src/levels.ts:19-24`).
- `pnpm balance` and the bands in `tools/balance-targets.json` (informational flags only).
- `pnpm replay:verify golden`, `pnpm sim:golden`, `pnpm bots:golden`.

Runtime loading in the web client uses Vite `import.meta.glob` over `packages/content/content.json` and `data/**/*.json` (`apps/web/src/app/boot.ts:6-12`). `campaignFiles` drops `sample.json` (`boot.ts:24-30`). A new level file is therefore auto-discovered. The level list is sorted by `order` (`apps/web/src/app/state.ts:240,295`). The app validates content together with the manifest at load (`state.ts:237,281`).

---

## 3. Bot model

- Contract: `Bot{player, decide(ctx, tick): Command[]}`. `BotContext` exposes only `view`, `canDraw`, `readTroops`, and is wrapped in a Proxy that throws on any other property (`packages/bots/src/index.ts:4-31`). Bots issue the same `DrawLine`/`CutLine` commands as humans (R-ENT-04).
- Bot data: `BotSchema.kind` is `utility | idle` (`bot.schema.ts:8`). Utility `params`: `skill{decisionIntervalSec,noise,actionsPerDecision}`, `bias{attack,reinforce,cut}`, `holdThreshold`, `maxTargetsPerSource`, `cooldownSec`, `componentValue{<component name>:weight}`, `commitment{7 fields}`, `weights{attack|reinforce|cut: 10 considerations}` (`packages/content/src/bot-params.ts:48-70`).
- Hard-coded closed enums: `BOT_CONSIDERATIONS` (10 names, `bot-params.ts:5-8`) and `BOT_ACTIONS = attack|reinforce|cut` (`bot-params.ts:9`). The scorer registry must match the list (`packages/bots/src/considerations.ts:28-37`).
- `componentValue` keys come from `Object.keys(COMPONENT_REGISTRY.components)` (`bot-params.ts:56`), so a new content component extends the bot schema automatically. A positive weight with no extractor throws at scorer creation (`considerations.ts:151`).
- Extractors map component name to a scalar from visible columns: generates is rate, garrison is cap, drawsLines and capturable are presence (`considerations.ts:17-22`). The README says "adding `shoots` needs one extractor and a profile component weight" (`packages/bots/README.md`, extractors bullet).
- **Observation:** scoring also reads literal columns `garrison.count`, `garrison.cap`, `generates.ratePerSec`, `generates.troop` directly (`considerations.ts:200-201`). A tower type without those components is not first-class in scoring. The hit/capture model assumes the four existing components.
- Difficulty is data. Four personalities (`rusher, turtle, economist, opportunist`) with full parameters, plus 16 skill-only tier files (`<name>-{easy,normal,hard,expert}`). A tier is `{extends, skill}` only (`packages/content/data/bots/rusher-hard.json`; tiers table `packages/content/data/bots/README.md`).

| Tier | Decision interval | Noise | Actions per decision |
|---|---|---|---|
| easy | 3.5 s | 0.35 | 1 |
| normal | 2.2 s | 0.2 | 1 |
| hard | 1.4 s | 0.1 | 2 |
| expert | 0.8 s | 0.03 | 2 |

- Tooling-only profiles `reference` (0.5 s, 0 noise, 3 actions) and `human-proxy` cannot be used in levels (`validate-content.ts:114`). `idle` is legal.
- Driver: `createBotDriver(level, matchSeed)` builds one seat per `level.bots` entry. It uses a per-seat seed from the match seed, player index and an FNV-1a hash of the profile id, plus a phase offset (`packages/bots/src/driver.ts:11-75`). Decision cadence is `decisionIntervalSec * 20` ticks.
- Line commitment (SP02, `BOT_VERSION` 1.6.x): bot-side anti-churn filter (min line lifetime, cut margin, redraw block, slot guard and pre-empt) that keeps sim rules unchanged (`packages/bots/README.md`, Line commitment section; `utility.ts:23-50`).
- Levels select a bot per player by `botProfile` (`core.schema.ts:57`). Campaign mixes 1-3 bots. There is no per-level bot override and no map-aware bot input (no obstacle data exists).

---

## 4. Rendering and art binding

### 4.1 How visuals attach to content (data-driven)

- Content owns only opaque `visual` string keys: archetype `visual`, troop `visual`, level `visual` (theme key), player `colorKey` (`core.schema.ts:8,37,53,56`; `troop.schema.ts:9`).
- The manifest maps keys to presentation (`manifest.schema.ts:28-62`):
  - `models{key: {src: glb} | {primitive box|capsule|cylinder, size}}`
  - `visuals{key: {kind tower|troop, model, scale, yOffset?, build?, teamMaterial?, tint?, anim?, label?, fx?, sfx?}}`
  - `themes{key: {ground, sky, light, fog?, palette?, scatter{seed,density}?, props?[]}}`
  - `palettes{default, colorblind}` and `teamMarkers` (glyphs), `events{Captured|Clash|LineCut|LineDrawn|GameOver|Music: {fx?, sfx?}}`
  - `levelVisuals{levelId: {cameraMargin?, troopScale?}}`, `camera{pitchDeg, fov, margin}`
- `validateContent(files, {manifest})` cross-checks that every archetype and troop `visual` key resolves with the right `kind`, every theme key exists, and every `colorKey` exists in every palette (`validate-content.ts:79-87,113-116`). The renderer's resolver throws `ManifestError` on unresolved keys (`apps/web/src/manifest/resolve.ts:23-26,40-72`). `resolveLevelAssets(level)` computes the assets a level needs (`resolve.ts:58-70`).
- Current art, in `apps/web/assets/manifest.json`:
  - `tower.standard|small|large` all use `model: "block"` with `build: "stacked"` (lines 22-24).
  - `troop.regular` uses `character.regular` = `models/troop-regular.glb`, `teamMaterial "Shirt"`, bob anim (line 25).
  - One theme `grass` (lines 27-31).
  - GLBs on disk: `tower-{small,standard,large}.glb`, `troop-regular.glb`, 4 props (`apps/web/assets/models/`). The `building.*` models are declared (manifest lines 11-13) but not referenced by any visual in the shipped manifest. The tower GLB path is a fallback (see below).

### 4.2 Per-element render paths

| Element | Code | Binding |
|---|---|---|
| Towers | `apps/web/src/render/towers.ts` | `visual.build === 'stacked'` takes a code-built instanced stacked-octagon tower (`towers.ts:60`; `tower-mesh.ts`). Otherwise it clones the GLB `models.get(visual.modelKey)` (`towers.ts:82`), tinting the material named `teamMaterial`. |
| Tower number and slot dots | `towers.ts:125-127`, `render/roof-texture.ts` | The `OverlayRegistry` (`render/overlays.ts:7-19`) is keyed by component name: `garrison` gives the number, `drawsLines` gives dots, `capturable` gives nothing. The roof atlas is written only for stacked towers (`towers.ts:127`). **Observation:** a non-stacked (GLB) tower gets no count text. |
| Tower height | `tower-mesh.ts:8,28-31` | `floors = clamp(ceil(5*count/cap),1,5)`, reading `garrison.count` and `garrison.cap`. `MAX_FLOORS = 5` is hardcoded. |
| Troops | `render/troops.ts:78-106` | Iterates `view.kinds`, resolves `kind.visual` (kind `'troop'`), merges the GLB into one instanced geometry, one bucket per (visual, owner), plus a derived low-LOD geometry (`troop-lod.ts`). Team colour by material name via `teamMask` (`render/model.ts:55,84`). |
| Lines / lanes | `render/lines.ts`, `lane-material.js`, `lane-split.ts` | Pair ribbon shader with chevrons, build and retract animation, split-colour shared lane for head-on pairs. Parameters are code constants (`lines.ts:20`; `LANE_WIDTH_FACTOR`). |
| Clash | `render/brawl.ts`, `fx.ts` | Cosmetic brawl at the lane split, deterministic from (pair hash, tick). Event names `Clash|Captured|LineDrawn|LineCut|GameOver` are literal in `fx.ts:17-29`. |
| Ground | `render/ground.ts` | Code-built: sand plane, rounded-rect grass patch, 240 rock instances, colours from `theme.palette` (`ground.ts:13-70`). Not model-driven. |
| Props | `render/props.ts` | `PROP_KINDS` is a hardcoded enum of 6 kinds; 4 map to manifest `prop.*` model keys via `PROP_MODEL`, tyres and barrels are code-built (`props.ts:11,19-22`). They are scattered from `theme.scatter` and avoid towers and near-pair corridors (`props.ts:52-56`). |
| Camera | `render/camera.ts`, manifest `camera`, `levelVisuals` | Fit to bounds plus margin. |
| Input | `input/index.ts:52-58,80` | Pick uses `footprintRadius*1.25` from the view. Raycast on ground plane `y=0`. |
| HUD strength | `ui/strength.ts:45` | Reads `garrison.count` plus transit per team. |
| Audio | `audio/index.ts:82` | Event key to `sfx` path; `Captured` falls back to the tower visual's `sfx`. |

### 4.3 Asset formats and limits

- Models: GLB or glTF, static meshes only (skinned rejected, `apps/web/README.md`, Asset/resource API section). Draco is rejected, Meshopt is used. Budgets: troop <= 300 triangles, tower and props <= 5000, textures <= 1024 px per axis. Credit entry required per external model in `docs/CREDITS.md`. All enforced by `check:manifest`.
- Primitives: `box|capsule|cylinder` with fixed tessellation (`PRIMITIVE_SEGMENTS`, `resolve.ts:17`).
- Animation is limited to `none | bob{hz,amp,sway}` (`manifest.schema.ts:19-22`), implemented in shader (`render/troop-material.ts`). No skeletal animation.
- Audio is OGG at manifest relative paths (`apps/web/assets/audio/*.ogg`). Effects (`fx`) are a closed set `pulse|puff|spark` (`resolve.ts:16`).
- Tooling: `tools/assets/build-troop-chibi.mjs`, `tools/assets/import-art.mjs`. Licences are in `apps/web/assets/licenses/` (Kenney packs, one OpenGameArt track).
- Where to add a new tower skin: a `visuals` entry and `models` entry in `apps/web/assets/manifest.json`; then point an archetype's `visual` at it. A new unit model works the same way, via a `kind: "troop"` visual whose model has a mesh material named by `teamMaterial`.

---

## 5. Extension cost today

Legend: **data** = JSON only; **gate** = version/lock/manifest checks (always required for sim-affecting data); **code** = TypeScript.

### 5.1 (a) Add a new tower type

Case A: same behaviours, new numbers or look (for example a "fortress" with a bigger cap).

- New `packages/content/data/archetypes/<id>.json`. Use `extends` only to patch an existing one (depth 1, no new components); otherwise write a full standalone archetype (`resolve-archetypes.ts:23-28`).
- Visual: new `visuals` and `models` keys in the manifest, or reuse an existing key. If it needs a different silhouette than the stacked tower, it needs a GLB. That path has no roof count text, and there is no second code-built `build` value (**code**, §4.2).
- Gate: if any level uses it, bump `contentVersion` and run `content:lock`. If the manifest changed, run `check:manifest`.
- Hardcoded spots touched: none for data-only.

Case B: new behaviour (watchtower and archer `shoots`, tank factory, gold or boost pickups, "lookout hut").

- `docs/GAME_RULES.md`: new `R-...` rules, changelog, §6 table entry (`GAME_RULES.md:342-350`); `RULES_VERSION` bump in 3 places (`GAME_RULES.md:3`, `versioning.ts:7`, `content.json:5`). Minor if additive, major if replay outcomes change.
- Content `COMPONENT_REGISTRY` entry with params and `ruleIds` (`component-registry.ts:22-30`). Add a TypeBox param in `core.schema.ts:18-30` if it is a decimal or needs a typed name, then `content:schemas`.
- Sim: `registerComponent` with state columns, systems and hooks, plus `registerPhase` if needed (`registry.ts:74-87`; pattern shown in `packages/sim/test/extensibility.test.cjs`). The sim parity check fails until both sides match (`registry.ts:64`).
- Bots: a component extractor (`considerations.ts:17-22`) and `componentValue` weights in profiles (re-hash, `BOT_VERSION` bump, `bots:golden --update`). Scoring still reads literal columns (`considerations.ts:200-201`), so new combat semantics need scorer edits.
- Web: an overlay reader (`overlays.ts:7-19`). Fx or sfx keys for new events (`fx.ts:17-29` is literal per event type; `BUILTIN_FX` is closed). New `SimEvent` variants (`commands.ts:10-19`) need fx.ts handlers. A `radius` display (the Tower War range ring) has no existing renderer.
- Tests: `covers R-...` tests (`check:rules`), golden regeneration.

### 5.2 (b) Add a new blocker or obstacle type

Not supported anywhere beyond a reserved-empty schema slot.

- `core.schema.ts:44-47,62`: `reservedObject` fields are fixed (`kind, pos, footprintRadius, delta, hp`). Any new field needs a schema change plus `content:schemas`.
- `validate-content.ts:144`: remove or relax the reject; add per-kind validation and geometry checks. A reachability hook is only a comment (`validate-content.ts:149`).
- `compile.ts:65-82` and `hash.ts:58-69`: add obstacles to `CompiledLevel` and to the hash (otherwise blockers would not move `simHash`).
- `GAME_RULES.md:177` (R-LIN-04) and `GAME_RULES.md:347-349`: new rules for blocking, crossing and HP, plus a `RULES_VERSION` bump.
- Sim: the sim has no obstacle code. Line validation (`commands.ts:27-38`, `economy.ts:28-34`) and straight-line lengths (`state.ts:180-187`) would need blocking checks. Gate, hazard or wall effects on troops need per-channel crossing logic that fits the lazy `p0/t0` progress model (`combat.ts:11-13`). **Observation:** modifying value mid-lane means the ring's per-troop value must change at computed progress points. Nothing exists for that today.
- Bots: no obstacle input in `BotContext`; distance and line candidates assume any pair can link (`tools/README.md`; `campaign-invariants.test.ts:122` comment).
- Web: render (new mesh path, nothing exists), `props.ts:52-56` (scatter avoidance knows only towers and corridors), `camera.ts` bounds, `input/index.ts` cut and draw hit-tests, manifest (new `visuals.kind` value, `manifest.schema.ts:34`), validation cross-check (`validate-content.ts:79-87`).
- Estimated surface: schema, validator, compiler, hash, sim, rules, bots, renderer, input and manifest all change. Greenfield feature.

### 5.3 (c) Add a level

Mostly data-only.

- New `packages/content/data/levels/NN-<slug>.json`. It is auto-discovered by the web glob (`boot.ts:6-12`) and the picker (`state.ts:240`).
- Hard limits to relax if going past 20 levels or 4 bands:
  - `level.order > 20` rejects (`validate-content.ts:154`).
  - Campaign test pins exactly 20 levels, 5 per band (`campaign-invariants.test.ts:51-53`).
  - Bands are 1..4 (`tools/src/levels.ts:21`; `tools/balance-targets.json`; its schema).
  - Players: exactly 1 human and 1-3 bots (`validate-content.ts:105`). Only 4 palette colours exist, `player.1..4` (manifest line 5).
- Map: a rectangle plus tower discs only. Bounds, footprints and +/-500 limits apply (§2.2). A theme with other ground needs a manifest `themes` entry (`level.visual`).
- Gate: bump `contentVersion` (a level add changes the lock hash map, `versioning.ts:34-41`), `content:lock`, `validate:levels` (reference bot wins by band), `balance` (informational), optional `levelVisuals` in the manifest and `solutions/` replay for hard band-4 levels (`tools/README.md`).
- Policy: no `overrides` in campaign levels; use a new archetype variant instead (`CONTENT_GUIDE.md:37`).

### 5.4 (d) Reskin units and characters

Data plus assets; no sim effect.

- Replace or add GLB in `apps/web/assets/models/` and in manifest `models` (`manifest.json:9-19`). Edit the `visuals.troop.*` entry (scale, teamMaterial, tint, anim). Keep the material name equal to `teamMaterial` (currently `"Shirt"`, `manifest.json:25`), or the whole model falls back to team-coloured base (`render/model.ts:84`; `apps/web/README.md`).
- Constraints: static mesh only (no skeleton); <=300 triangles; textures <=1024; only the `bob` or `none` animation presets; credits entry. A low-LOD stand-in is auto-derived from the bounding box (`render/troop-lod.ts`, `troops.ts:87-95`).
- Per-player or per-faction troop skins do not exist: skin is per troop kind, and teams differ by colour only (`troops.ts:88-96`). A character-per-faction design needs content changes (`players[].skin` or per-player kind mapping) and renderer bucket changes.
- Reskin of towers: manifest `visuals` entry. Stacked look is code (`tower-mesh.ts`: colours `BODY_COLOR` etc. as constants, lines 11-17). Changing the stacked tower's geometry, floors or colours is a code edit. `build` has one enum value (`manifest.schema.ts:37`).
- Presentation changes need no content version bump (`CONTENT_GUIDE.md:16`), but do need `check:manifest`.

### 5.5 (e) Add a new unit type

- Same behaviour as regular (different speed or look): new `data/troops/<id>.json` (`id, visual, value: 1, speed`) and a tower archetype whose `generates.troop` names it (`compile.ts:92`). Add a manifest visual (`kind: troop`) and model. Gate: `contentVersion` and lock. Rendering already buckets per kind (`troops.ts:78-106`), so no renderer change.
- Different value (tank = 2): blocked by `troopValue max 1` (`component-registry.ts:29`) and R-ENT-02 text (`GAME_RULES.md:75`). Lifting it is a rules minor or major bump, edits to the rule texts R-ENT-02/CMB-01/CMB-03 and the E-V2-TANK example (`GAME_RULES.md:352`), new tests, and a golden refresh. The sim data path already stores value (`state.ts:10-12`, `economy.ts:56-75`, `combat.ts:24-85`), and the sim test already exercises a value-2 kind. The renderer reads `view.kinds[].value` nowhere visible. Tank size or count rendering would be new work.
- Different behaviour (ranged troop, parachute, hero): there is no troop-behaviour component system. Troops are plain `{owner, kind, value, progress}` in channels (`state.ts:8`). Any new behaviour needs new sim logic (`combat.ts`, `commands.ts` phases), rules, and compile and hash plumbing.

### 5.6 Summary table

| Change | Data-only? | Files that must change beyond data |
|---|---|---|
| (a1) tower type, existing behaviours | Yes, plus manifest | none, unless a new silhouette needs GLB (loses roof number) or a new `build` |
| (a2) tower type, new behaviour | No | `GAME_RULES.md`, `versioning.ts`, `content.json`, `component-registry.ts`, `core.schema.ts`, sim `registry.ts` + system files, bots `considerations.ts` + profiles + `version.ts`, web `overlays.ts`, `fx.ts`, tests, goldens |
| (b) blocker | No | `core.schema.ts`, `validate-content.ts`, `compile.ts`, `hash.ts`, `GAME_RULES.md`, sim (new), bots, web render/input/props/manifest |
| (c) level | Yes | none within 20 levels, 4 bands, 1 human + 1-3 bots, 4 colours; else `validate-content.ts:105,154`, `campaign-invariants.test.ts:51`, `tools/src/levels.ts:21` and balance targets |
| (d) reskin | Yes (assets + manifest) | none for static-mesh troops; code for skinned animation, new tower build, per-faction skins |
| (e1) unit, value 1 | Yes | none |
| (e2) unit, value > 1 or new behaviour | No | `component-registry.ts:29`, rules text, tests, sim for behaviour |

### 5.7 Hardcoded spots (index)

- Enum or closed lists:
  - `PHASES` (`registry.ts:8`), `Command` and `RejectReason` and `SimEvent` unions (`commands.ts:4-19`), `Outcome` (`commands.ts:8`).
  - `BOT_CONSIDERATIONS` and `BOT_ACTIONS` (`bot-params.ts:5-9`), bot `kind` (`bot.schema.ts:8`).
  - Level player `kind` human|bot (`core.schema.ts:56`).
  - Manifest `visuals.kind` tower|troop (`manifest.schema.ts:34`), `build` stacked (`:37`), `anim` none|bob (`:19-22`), `model.primitive` (`:16`).
  - `BUILTIN_FX` (`resolve.ts:16`), `PROP_KINDS` (`props.ts:11`), `MAX_FLOORS` (`tower-mesh.ts:8`).
- Switch-like literals:
  - Event names in `fx.ts:17-29` and `audio/index.ts:82`.
  - Overlay keys (`overlays.ts:9-17`).
  - Palette names `default|colorblind` (`manifest.schema.ts:30`).
  - Colour names `player.1..4` in `ui/strength.ts` (`DEFAULT_NAMES`).
- Numeric caps: troop value 1 (`component-registry.ts:29`), campaign <=20 and contiguous (`validate-content.ts:154`), bands 1-4, 1 human + 1-3 bots (`validate-content.ts:105`), coordinates +/-500 (`core.schema.ts:41`), `timeLimitSec <= 107374182`.
- Rule text pins: R-LIN-04 "no functional obstacles" (`GAME_RULES.md:177`), R-ENT-02 "unit value" (`:75`), §6 "validator rejects" (`:340-352`).
- Single-theme assumption in assets: ground, rocks and props code-built per theme palette, one `grass` theme (`ground.ts`, manifest `themes`).

---

## 6. Planned but not implemented (per Node Arena docs)

- `docs/GAME_RULES.md:342-350`: `shoots{ratePerSec, radius, targeting}`, archetype `archer`, troop `tank` (value-unit combat), `mapObjects gate{delta}`, `hazard{delta}`, `wall{hp}`, obstacle kinds, V4 teams. All "validator rejects".
- `docs/FUTURES.md:5-10`: use Tower War as the v2 style reference (tank factory = 2 troops, watchtower/archer, x3 boost), more themes (desert, snow, cave, lava; "theme is already a level data field"), per-band themes, new SFX, level layout/balance pass.
- Reference notes about the original game are at `docs/agent_files/feat-visual-mechanics-overhaul-20261017-2318/ref/REFERENCE.md`:
  - Tower War mechanics (lines 55-63): slots 1/2nd at level 10/3rd at 20, barracks/factory/fort, neutral gun towers, crates, mines, bridges, boost, max 63.
  - Visual breakdown (lines 32-41).
  - It marks head-on clash rules as unverified (line 63).
  - It credits the game to SayGames (line 3), while this research brief says Vaveda. **Discrepancy to resolve upstream.**
- Node Arena's own slot thresholds (10, 30) came from "User's Tower War recollection" (`docs/agent_files/feat-game-design-20261006-0617/brainstorm.md:54`). They are not verified against the app.

---

## 7. Known pain points and open issues

From `docs/FUTURES.md` and the latest agent files:

1. **Visual ceiling** (v1.1 final review): blind scorer caps items at 6-7 of 10; towers about 3-4% of frame height; troops read as blobs; roof digits small at 1366 wide; no character art (`docs/agent_files/feat-visual-mechanics-overhaul-20261017-2318/final-review.md:238-245`). Blocked-visual items listed at `final-review.md:212-234`.
2. **Performance open**: L18 60 fps on a real GPU unverified (Perf-open). Stress test `acceptance.spec.ts:95` is a known SwiftShader tail flake; limit relaxed to 5 ms (`final-review.md:244,249,252-255`).
3. **Balance not clean**: v1 itself flags 18 non-idle rows in `pnpm balance`. SP02 Task 5 "every band" is unreachable by bot params alone. Reference win rates drop in 3-4 player levels (`docs/agent_files/feat-visual-mechanics-overhaul-20261017-2318/02-bot-line-commitment/iteration-log.md:38,55,76`). Bands: `tools/balance-targets.json`.
4. **Metric mis-specification** for green and colourblind hues (M11/M20) and l01 roof number threshold (`final-review.md:240-242,257`).
5. **Documentation drift** (**Observation**, doc vs code at HEAD):
   - `docs/CONTENT_GUIDE.md:76` says balance runners, golden regeneration and `check:rules` "are follow-on tooling, not runnable", but they exist in `package.json:25-31`.
   - `CONTENT_GUIDE.md:39` and `README.md:65` describe the pack as only the sample, though 20 campaign levels and 23 bot profiles exist.
   - `apps/web/README.md:3` calls the app an empty scaffold.
6. **Level-count rigidity**: campaign pinned at 20 levels, 4 bands, 4 palette colours, <=3 bots (§5.3).
7. **Two-sided registries**: components are defined in content (`component-registry.ts`) and sim (`registry.ts`) separately, with a runtime parity assert and no codegen. Bots' scorer also hardcodes column names (§3).
8. **Tower art has two paths with different features**: only the code-built stacked path renders count and dots; the GLB path does not (§4.2). `building.*` GLB models are declared but unused (`manifest.json:11-13`).
9. **Only one theme**: ground, rocks and props are code-built per theme palette. Other themes are listed as "already data" in FUTURES (`FUTURES.md:7`) but only palette, light, fog and scatter are data; ground shape and prop kinds are code (`ground.ts`, `props.ts:11`).
10. **No meta layer**: the save file has completions and settings only (`save/index.ts:14-20`). There is no currency, no upgrade shop, no unlock gating and no heroes. R-WIN-02 forbids persistent stat upgrades (`GAME_RULES.md:279`), so a meta layer is also a rules change.
11. **Owner-only items** (not actionable by agents): approve the v1.1 final review, laptop fps check, decision on Blocked-visual items, and the CI threshold (`final-review.md:250-258`).
