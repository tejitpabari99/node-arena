---
status: approved
summary: Owner-art override layer (assets/art/ + manifest.art.json merged after the TW fragment), tintMask team mode, relaxed credits check, art:status, and two playable showcase levels.
date: 2026-10-24
---
# PRD: Art overrides

Repo/branch: node-arena, `feat/custom-level-contract` · Depends on: 01-level-editor (soft: custom-levels list; see Interface assumption) · Feeds: none
Owns: `apps/web/assets/art/**`, `apps/web/assets/manifest.art.json`, `tools/src/assets-tw/{manifest-fragment,merge-cli}.ts` (art merge), `tools/src/manifest-assets.ts` (art checks), `tools/src/credits.ts` + the credits call in `tools/src/cli.ts`, new `tools/src/art-status.ts`, `packages/defs/src/visual.ts` (`TEAM_MODES`), manifest TypeBox source in `packages/content/src/manifest.schema.ts` (+ generated schema), `apps/web/src/render/{materials,unit-renderer,building}.ts` (tintMask only), `packages/content/data/levels/na-showcase-{green,snow}.json`, `docs/CONTENT_GUIDE.md` art section.
Shared with 01 (coordinate): custom list file + loader + level-select section, `tools/unsolved-by-proxy.json`, `hashes.lock.json`, `content.json`, `packages/bots/src/version.ts`, 20-level test exclusions, `tools/README.md`.

## TL;DR
Owner drops own GLB/PNG/OGG into `apps/web/assets/art/` and declares field-level overrides in `manifest.art.json`. `pnpm assets:manifest` merges it over the TW fragment into the single `manifest.json`. The importer, hash lock and TW files are untouched. Game-compat checks still run on art files. Two playable showcase levels show every visual. `pnpm art:status` lists what is still original TW.

## Problem
- Visuals/themes/fx are wholly fragment-owned: `mergeManifest` sets `visuals: fragment.visuals, themes: ..., fx: ...` [verified: manifest-fragment.ts:143-ish]. Hand edits fail the merge check [verified: manifest-assets.ts "manifest.json is not the merge of itself"]; files under `models/tw`, `textures/tw`, `fx` fail the lock ("not an importer output (stale or hand-added)") [verified: manifest-assets.ts:15,84].
- No legal path to replace Vaveda art, which must go before anything goes public. Credits check hard-fails on any uncredited asset [verified: cli.ts `Asset files missing from CREDITS.md`], wrong for owner-made art.
- No way to see all art together: stages, 5 colours, obstacles per theme.

## Goals
1. Replace any existing model / team skin / theme ground, sky, obstacle / fx / sound without touching importer output.
2. Overrides survive `assets:tw` re-runs and break loudly when their target disappears.
3. Art stays game-compatible (budgets, nodes, clips, texture size).
4. See everything in play via two showcase levels; reload to refresh.
5. Know what is still TW (`art:status`).

## Non-Goals
UI images (own pipeline: `assets:ui`) · new unit/building/obstacle types · live hot-swap · preview/turntable page · licensing beyond a warning · editing `models/tw`/`textures/tw`/`fx` in place · new renderer features beyond `tintMask`.

## Requirements
| # | Requirement |
|---|---|
| R1 | `apps/web/assets/art/{models,textures,fx,audio}/` is owner-owned; importer, lock walk (`OWNED`) and `assets:tw` never read or write it. |
| R2 | `manifest.art.json` = sparse patch over `visuals`/`themes`/`fx`/`events.<id>.sfx`; applied after the TW fragment inside `assets:manifest`. |
| R3 | Field-level: objects deep-merge; arrays and scalars replace whole. |
| R4 | Overrides may target only keys/fields the TW fragment already has; unknown key, node, or clip fails (no new types). |
| R5 | `check:manifest` runs budget/stage-node/clip/PNG<=256 checks on art files; art files exempt from the lock; orphan art files warn. |
| R6 | Credits check becomes a warning for all assets. |
| R7 | `team.mode: "tintMask"` (one skin + mask) in addition to `textureSwap`. |
| R8 | Showcase levels `na-showcase-green`, `na-showcase-snow` in the custom list. |
| R9 | `pnpm art:status`. |

## Architecture

### Merge order and ownership
```
manifest.json(base: palettes, camera, event sfx) <- manifest.tw.json (visuals/themes/fx, wholesale) <- manifest.art.json (patch) = manifest.json
```
- `mergeManifest(base, fragment, art?)` gains an optional third arg; `art` missing = no-op. Pure/idempotent, so re-running over its own output is stable (same property as today) [verified: mergeManifest reads fragment, not stale base visuals].
- `merge-cli.ts` and `manifest-assets.ts` step 4 both load `manifest.art.json` if present and compare `stringify(applyArt(mergeManifest(m, frag), art)) === stringify(m)`. Message: "manifest.json is not the merge of itself, manifest.tw.json and manifest.art.json".
- Importer (`assets-tw/cli.ts`) writes only `OWNED` dirs + `manifest.tw.json`; it must not touch `manifest.art.json` [verify in task: `output.ts`/`run.ts` stale-file deletion scope].
- **Art-owned = any manifest path starting `art/`**, plus every field named in `manifest.art.json`. No other registry needed.

### Fragment shape (art patch)
```json
{ "$schema": "...art-manifest.schema.json", "schemaVersion": "2.0.0",
  "visuals": { "building.tower": { "model": { "parts": "art/models/tower.glb" },
      "team": { "textures": { "blue": "art/textures/tower-blue.png" } } },
    "unit.soldier": { "team": { "mode": "tintMask", "base": "art/textures/soldier.png", "mask": "art/textures/soldier-mask.png" } } },
  "themes": { "snow": { "ground": { "texture": "art/textures/snow-ground.png" }, "obstacle": { "small": "art/models/snow-obst.glb#small" } } },
  "fx": { "capture-ring": { "texture": "art/fx/ring.png" } },
  "events": { "Clash": { "sfx": "art/audio/clash.ogg" } } }
```
- **Schema:** yes, a separate TypeBox `ArtManifestSchema` (generated via `pnpm content:schemas`; never hand-edit). Whitelist, closed (`additionalProperties:false`): `visuals.*.{model.parts, model.lod, scale, stages, anim.clips, team.*, label.height}`, `themes.*.{ground.*, obstacle.*, sky, light}`, `fx.*.{texture, params}`, `events.*.sfx`. **Not overridable:** `kind`, `model.budget`, ids. `manifest.schema.json` itself stays the *merged* schema; `team` there becomes a union of `textureSwap` and `tintMask`.
- Arrays (`stages`, `light.dir`) replace whole; `team.textures` is an object so a single colour (`blue`) overrides alone. `null` is not allowed (no deletes).
- Overridden `stages` or `model.parts` must still satisfy `stage0..2` nodes; existing step-3 checks run on the *merged* manifest, so they cover this unchanged [verified: manifest-assets.ts:88-114].

### Check changes (`manifest-assets.ts`, `cli.ts`)
| Check | Change |
|---|---|
| Lock walk | `OWNED` unchanged; `art/` not in it. Art file inside owned dirs (path `models/tw/...` referenced from art.json) = error: art must live under `art/`. |
| Existing refs/budgets/nodes/clips/PNG | Unchanged; run on merged manifest. Add PNG size check to `fx` and `tintMask` base+mask refs. |
| Stale target | For each key/field in art patch: must exist in the fragment, else error `art: visuals.x.team.textures.gray targets a field the importer no longer produces`. |
| Orphans | File under `art/` not referenced by merged manifest = warning. |
| Audio | Exists, `.ogg`/`.mp3`/`.wav`, <=1 MB per file (warning above). No tri/node checks. |
| Credits | `uncreditedAssets` result moved from `throw LocatedError` to a report warning (all assets, not only `art/`); `check:manifest` exit 0. `CREDITED_DIRS` unchanged. |

### tintMask contract
- Manifest: `team: { mode: "tintMask", base, mask }`; `TEAM_MODES = ['textureSwap','tintMask']`.
- **Mask:** separate 8-bit PNG, same size as base (<=256), sampled on the **R channel**; white = recolour, black = keep base. Chosen over base-alpha: alpha is also transparency; Krita/Blender export a grey layer trivially.
- **Shader:** `MeshLambertMaterial.onBeforeCompile` after `map_fragment`: `diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uTeam, texture2D(uMask, vMapUv).r)`. One material per (family, team) with `uTeam` from `manifest.palettes[team]`; `gray` = neutral. Instanced grid and draw-call count unchanged (still one InstancedMesh per part x team).
- Touch points [verified by grep]: `materials.ts` `teamMaterial`; `unit-renderer.ts:72-74` (`teamKeys = Object.keys(textures)`, must come from palette teams for tintMask); `building.ts:152,186`; `resolve.ts:39` path assertions; `manifest-assets.ts` `references()` (reads `team.textures` only).
- `textureSwap` stays default; existing visuals untouched. Sim/hashes: **not affected** [verified: `hashes.lock.json` holds only `levels`/`bots`; CONTENT_GUIDE: "Presentation is outside simHash"]. Art alone needs no `contentVersion`/`RULES_VERSION`/`BOT_VERSION` bump.

### Showcase levels
- Files `packages/content/data/levels/na-showcase-green.json` (`theme: green`) and `na-showcase-snow.json` (`theme: snow`).
- **Interface assumption (01):** 01 ships `packages/content/data/campaigns/custom.json` (or equivalent) + loader + level-select section, always unlocked, excluded from 20-level assertions; saves levels as `na-<id>.json` in `data/levels/`. **Fallback:** if 02 lands first, 02 adds a minimal `custom.json` + loader matching that contract; 01 then adopts it. Recommend 01 first.
- Content: 15 buildings = 3 types (`house-wt1`, `house-wt2`, `tower`) x 5 owners (human blue; 3 AI green/red/yellow; neutral gray, `owner: null`), levels cycling 1 / 15 / 40 so each type shows stage0/1/2 (thresholds `[10,30]`, `maxLevel` 64 [verified: balance.json, buildings/*.json]). 2 small + 2 big obstacles. A few lines so troops, tower shots, clashes and capture fx occur.
- Seats: human + 3 AI (`bot.kind: tw`, copy a stock block); AI seats are required to show 4 colours.
- Version/lock consequences [verified: CONTENT_GUIDE:48,75,77]: new levels move `levels` and `bots` locks -> `pnpm content:lock`, `contentVersion` bump (2.3.1 -> next), `BOT_VERSION` bump (AI seats added), `pnpm levels:lock`. Add both ids to `tools/unsolved-by-proxy.json` unless proxy wins (3 AIs likely stalemate); `position` is required there today [verified: unsolved.ts schema] -> made optional for custom levels (see [RESOLVED] in Risks; owned by 01 P0).
- Ship both in one commit so versions bump once.

### `art:status`
`pnpm art:status [--strict]` (`tools/src/art-status.ts`), report-only; reads merged `manifest.json`; lists every file-valued field whose path is not under `art/`:
```
unit.soldier        model.parts   models/tw/soldier.glb          TW
unit.soldier        team.blue     textures/tw/soldier-blue.png   TW
theme snow          ground.mesh   models/tw/ground-snow.glb      TW
event Clash         sfx           audio/clash.ogg                stock
12 of 41 fields on art/ (29 original)
```
`--strict` exits 1 if any remain (pre-public gate; mirrors `check:parked --strict`). Scalars (sky, light) not listed.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| D1 | Art location | `assets/art/`, outside lock | edit `models/tw` | in-place edits fail lock, overwritten |
| D2 | Merge site | `assets:manifest`, third layer | browser-side merge | one manifest for game + checks (brief) |
| D3 | Merge semantics | deep-merge objects, replace arrays | replace whole visual | smallest swap; arrays have no sane merge |
| D4 | Patch schema | whitelisted closed schema | free-form patch | blocks `kind`/budget changes and new types |
| D5 | Art-owned detection | `art/` path prefix | registry/list | zero state |
| D6 | Mask format | separate PNG, R channel | base alpha; vertex colour | alpha clashes with transparency; simple authoring |
| D7 | Tint shader | `onBeforeCompile` on Lambert | custom ShaderMaterial | keeps lighting/fog; small diff |
| D8 | Credits | warning for all | warning for `art/` only | brief decision |
| D9 | Showcase | two levels in custom list | preview page | brief decision |
| D10 | Audio override | `events.<id>.sfx` patch | new audio registry | matches current manifest |

## Manual steps (owner)
- Author GLB in Blender: unit/building/obstacle/ground within budgets; building stages as nodes `stage0..2`; unit clips named `Run`/`Death`; obstacle file with nodes `small`/`big`. Textures in Krita <=256px PNG; tintMask grey mask.
- Run `pnpm assets:manifest`, `pnpm check:manifest`, reload the showcase level; the owner commits.

## Risks
| Risk | Mitigation |
|---|---|
| Owner node/clip names wrong | errors name the missing node; Blender export note in CONTENT_GUIDE |
| tintMask colour shifts vs palette (linear vs sRGB multiply) | tune once on showcase; keep textureSwap fallback |
| 01/02 both touch custom list | sequence 01 first |
| Importer change later renames a key | stale-target check fails loudly (R4) |
| Showcase fx depend on AI fighting | seed bots to engage early; verify visually |

## Open Questions
- [RESOLVED: `position` optional in unsolved-by-proxy.json schema for custom (na-*) levels; owned by 01 P0; 02 follows] `unsolved-by-proxy.json` requires integer `position`; custom levels have none. 01 should decide (make optional, or exclude `na-*` from solvability). 02 follows.
- [RESOLVED: validate:levels and levels:lock cover custom levels (all custom levels have ≥1 AI seat); owned by 01 P0; showcase levels included, allowlisted in unsolved-by-proxy.json if proxy can't win] Does `validate:levels`/`levels:lock` glob all of `data/levels/` (then showcase is included) or only campaign entries? Verify in `tools/src/levels.ts`; adjust if custom levels need an opt-out.
- [RESOLVED: move default event sfx map into the fragment/merge defaults so merge = base <- TW <- art; removing an art override restores the default] Event sfx are hand-owned in base `manifest.json`: removing an art sfx override would leave the art path stale. Proposed: move default sfx map into `manifest-fragment.ts` constants so merge = defaults <- art (small change); else owner restores manually.
- [RESOLVED: implementer verifies stage thresholds in code and picks showcase levels so each stage is visible at start; in-play growth changing stage is acceptable] Does stage depend only on level (no decay)? Confirm buildings seeded at level 40 stay stage2 and `maxLevel` is not exceeded by in-play growth.
- [RESOLVED: verify cleanup only touches OWNED dirs; if not, restrict it to OWNED so art/ is never touched] Does `assets:tw` stale-file cleanup only touch `OWNED` dirs? Confirm in `output.ts`.
- [DEFERRED] Whether the mask needs a per-visual `tintStrength`; first cut: no.
- [RESOLVED: not needed; neutral buildings don't spawn units, no gray unit skin] Whether `gray` is rendered for non-neutral units (soldier has no gray texture today; tintMask gives one for free).
- [DEFERRED] Per-theme light/lane overrides beyond `sky`/`light`; UI images; hot-swap.
- [RESOLVED: verified grep] Manifest is not part of `hashes.lock.json`; art-only change needs no version bumps.
- [RESOLVED: brief] No preview page; reload to see changes.

## Acceptance Criteria
- Fixture override (replacement GLB + PNG for one visual and one theme field) passes `check:manifest`; `assets:manifest --check` clean; `assets:tw` re-run leaves `art/` and `manifest.art.json` intact.
- Fixtures fail loudly: unknown key, missing stage node, missing clip, over-budget tris, PNG >256px, art file under `models/tw`.
- Unit tests: merge order, array-replace/object-merge, idempotence, no-art no-op; orphan warning.
- Missing CREDITS row yields a warning, exit 0.
- tintMask: render test recolours masked region per palette; textureSwap screenshots unchanged (`campaign:verify`).
- Both showcase levels load from the custom list, show 3 types x 3 stages x 5 colours and both obstacle sizes; units/projectiles/fx appear in play; `validate:content --base HEAD`, `content:lock`, `levels:lock` pass with bumps; 20-level tests unaffected.
- `pnpm art:status` lists remaining TW fields; `--strict` exits 1 until none remain.
- `sim:golden`, `replay:verify golden`, simHash unchanged by art/tint changes.
