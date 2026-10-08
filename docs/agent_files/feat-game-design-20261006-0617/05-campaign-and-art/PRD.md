---
status: draft
summary: 20-level campaign (4 bands x 5) as pure data using standard/small/large tower archetypes, authoring + balance-tuning workflow with per-band targets, Kenney CC0 art + palette + audio via manifest, and greybox -> slice -> full phasing
date: 2026-10-07
---
# PRD: Campaign + Art (SP05)

Repo/branch: node-arena · feat/game-design · Depends on: SP01 (level/archetype schema), SP02 (sim), SP03 (manifest contract), SP04 (bots, validate:levels, balance)
Owns: `packages/content/data/levels/01..20-*.json`, values of campaign archetype variants (`data/archetypes/{small,large}.json`; files hosted by SP01), `tools/balance-targets.json` values, `apps/web/assets/manifest.json` *content* (SP03 owns loader), `apps/web/assets/{models,audio}/`, `docs/CREDITS.md`. No code beyond an optional layout-generator script.

## TL;DR
- 4 bands x 5 levels, all selectable. Gradual teaching uses only v1 mechanics: line slots, capacity, neutrals, head-on clash, multi-enemy, cuts.
- Variety via **data variants** of the one tower: `standard` (cap 50, 1.0/s), `small`, `large` (both `extends standard`, param changes only, no new components). Campaign uses **no `overrides`**.
- Levels hand-authored JSON; optional mirror/rotate helper emits JSON. Tuning loop = `validate:levels` (gate) + `balance` (targets per band) + owner playtest.
- Art: Kenney CC0 City Kit (Commercial + Roads) + Mini Characters; one family = consistent look. Reskin is manifest-only.

## Problem
The sim and tools are only a game once there are 20 fair, readable, progressively harder levels and art that looks like a city, not blocks. Without a shared authoring + acceptance process, levels drift in difficulty and assets in style/licensing.

## Goals / Non-Goals
| Goals | Non-Goals |
|---|---|
| 20 levels, per-level table, design guidelines | New mechanics, tower types, obstacles, power-ups (v2) |
| Reproducible tuning loop with numeric band targets | Stars/medals, difficulty toggle, unlock gating |
| CC0 art + palette + colourblind palette + audio, tracked in CREDITS.md | Custom/commissioned art, AI-generated assets, Mixamo (non-redistributable) |
| Greybox -> slice -> full phasing | Level editor, procedural levels |

## Requirements
1. 20 level files, `order` 1-20, `band` 1-4, ids `NN-slug`; each passes `validate:content` + `validate:levels --seeds 4` + `check:manifest`.
2. Every tower, owner, garrison, bot, time limit, theme is data. Art swap = manifest edit only; no code change.
3. Each level introduces/exercises one teaching focus (table); no level needs an unseen mechanic.
4. Layout rules (see Architecture) enforced by validator where mechanical, by screenshot review otherwise.
5. Balance targets in `tools/balance-targets.json`; runner flags out-of-range levels.
6. All shipped assets CC0, listed in `docs/CREDITS.md` with licence copy; `check:manifest` fails otherwise.
7. Three themes + shared palette material; colourblind palette + team glyphs verified on slice screenshots.

## Architecture

### Tower variants (data only)
| Archetype | Params vs standard | Slots | Visual | Used from |
|---|---|---|---|---|
| `standard` | cap 50, rate 1.0, thresholds [10,30] | up to 3 | mid office block | L1 |
| `small` | cap 20, rate 0.6, thresholds [10] | up to 2 | low shop | L6 |
| `large` | cap 80, rate 1.5, thresholds [10,30] | up to 3 | skyscraper | L7 |
Footprint radius scales with size (a skyscraper reads as "big and valuable"). SP01 hosts the files and confirms `extends` may change any component param incl. `drawsLines.extraSlotAbove` (arrays replaced whole; no adding/removing components) [ACCEPTED]. Exact numbers are starting guesses, tuned in greybox. Rationale for variants over standard-only: cheap, differentiates levels, size doubles as a readable stat cue.

### Campaign table
Map = `bounds` 120x80 for all levels (fixed camera, auto-fit); shape describes layout. Tiers (SP04 owns the names): band1 `easy`, band2 `normal`, band3 `hard`, band4 `expert`; bot profile id = `<personality>-<tier>`; "mixed" = a distinct personality per bot, each `<personality>-<tier>`. Time limit 300 s unless noted.
| # | Name | Teaching focus | Towers | Bots (profile) | Map shape |
|---|---|---|---|---|---|
| **Band 1 Rookie (day)** | | | | | |
| 1 | First Steps | draw 1 line, capture neutrals | 5 | 1 (idle) , limit 180 | line of 5, you left |
| 2 | Neutral Ground | neutrals cost garrison; take cheap first | 6 | 1 turtle-easy | 2x3 grid |
| 3 | Full Tank | capacity cap wastes troops; spend before cap | 6 | 1 turtle-easy | diamond |
| 4 | Two Streams | 2nd line slot at >10 | 7 | 1 rusher-easy | hub + spokes |
| 5 | Head On | head-on clash midway | 7 | 1 rusher-easy | mirrored, 2 lanes |
| **Band 2 Skirmish (golden hour)** | | | | | |
| 6 | Snip | cut lines, redirect; first `small` towers | 8 | 1 economist-normal | mirrored ring |
| 7 | Skyscraper | `large` tower, 3rd slot at >30 | 8 | 1 opportunist-normal | central large neutral |
| 8 | Fork | split pressure over 2 targets | 9 | 1 rusher-normal | Y-fork |
| 9 | Chain Link | reinforce chain to front | 9 | 1 turtle-normal | long snake |
| 10 | Two Foes | first 2-bot level (bots fight each other too) | 10 | 2 (rusher, economist)-normal | triangle |
| **Band 3 Rivals (overcast)** | | | | | |
| 11 | Triple Threat | 3 bots, rotational symmetry | 12 | 3 mixed-hard | 3-fold rotational |
| 12 | Underdog | start with 1 small tower vs bigger bot | 10 | 1 opportunist-hard | asymmetric |
| 13 | Crossfire | crossing lines, many clashes | 11 | 2 rusher/turtle-hard | X lanes |
| 14 | Beat the Clock | tempo, limit 180 | 9 | 1 rusher-hard | open field |
| 15 | Hub | contested `large` centre, 2 bots | 11 | 2 economist/opportunist-hard | hub |
| **Band 4 Warlords (night)** | | | | | |
| 16 | Fortress | break `large` turtle, cut-and-flood | 10 | 1 turtle-expert | walled ring |
| 17 | Pincer | defend 2 fronts | 11 | 2 rusher-expert | flank |
| 18 | Free-for-All | 3 bots, densest (14 towers; label stress test), limit 360 | 14 | 3 mixed-expert | 4-fold rotational |
| 19 | Siege | race for central `large`s, limit 360 | 12 | 2 opportunist/turtle-expert | mirrored |
| 20 | Finale | everything: 3 bots, mixed sizes, limit 360 | 14 | 3 mixed-expert | irregular, near-symmetric |
Towers/bot counts are targets; the golden numbers live in the files.

### Level-design guidelines
- **Fairness**: 1v1 = mirror; 3-4 seats = rotational; bands 1-2 may tilt toward the player on purpose (more neutrals nearer you); bands 3-4 within +-10% start-garrison-sum of bots.
- **Readability**: min tower centre distance >= 18 u (count-label chips >= 14 px at 1080p laptop); <= 14 towers; no tower outside `bounds`; avoid collinear tower triples (lines pass through towers visually); line length 20-90 u (shorter than ~3 s trip is invisible, longer than ~30 s is boring).
- **Camera**: all levels fit 120x80 so one camera pitch/fov serves all; the player seat starts left/bottom consistently.
- **Starts**: garrisons <= cap/2; neutral garrisons 8-25; time limit comfortably above reference median seconds-to-win (>= 1.5x).

### Authoring + tuning workflow
1. Sketch on paper -> hand-write JSON (editor autocompletes via `$schema`). Optional `tools/layout` helper takes half a map + symmetry (`mirror|rot3|rot4`) and **emits JSON**; output is committed, JSON stays the source of truth.
2. `pnpm validate:content && pnpm validate:levels --levels <id>` (fast gate).
3. `pnpm balance --levels <id> --proxy reference,human-proxy --seeds 200`; adjust garrisons/positions/archetypes/tier (never code, never overrides); `pnpm content:lock`; commit per level or small batch.
4. Owner playtest per band; changes logged in a campaign tuning note.

### Acceptance thresholds (balance runner; seeds 200)
`human-proxy` = `reference` extended with a slower skill block (SP04 request); `reference` itself = zero-noise strong play.
| Band | reference wins | human-proxy wins | timeout % | idle wins |
|---|---|---|---|---|
| 1 | 100% | >= 90% | <= 2 | 0 |
| 2 | >= 98% | 65-85% | <= 5 | 0 |
| 3 | >= 90% | 40-65% | <= 8 | 0 |
| 4 | >= 80% | 20-45% | <= 10 | 0 |
Owner sign-off: clears each band's levels in <= 3 attempts median (B1 first try; B4 may need ~5), no level feels "unwinnable" or "autopilot". `validate:levels` (K=4 seeds) applies SP04's per-band rule: bands 1-3 win all K, band 4 win >= K-1 or a committed solution replay; the 200-seed thresholds above are the balance runner's targets [RESOLVED].

### Art
| Role | Pack (source) | Licence verified | Use |
|---|---|---|---|
| Towers (3 sizes) | Kenney City Kit (Commercial) v2.1, 50 buildings, GLB: https://kenney.nl/assets/city-kit-commercial | Y, CC0 (page) | standard/small/large visual keys; scaled up for prominence |
| Ground, roads, signs, props | Kenney City Kit (Roads), 90 pieces: https://kenney.nl/assets/city-kit-roads | Y, CC0 | themed ground + decorative roads |
| Troops | Kenney Mini Characters, 25 animated models: https://kenney.nl/assets/mini-characters | Y, CC0 | `troop.regular`; `bob` anim, not skinning |
| SFX | Kenney UI Audio, 50 clicks/switches: https://kenney.nl/assets/ui-audio | Y, CC0 | UI + generic cues |
| SFX (clash/capture) | Kenney Impact Sounds / Interface Sounds | **N**, verify at download | clash, capture, cut |
| Music (1 track) | candidates: Kenney Music Jingles; OpenGameArt filtered to CC0 | **N** | one looping track |
| Fallback chars | Quaternius Universal Animation Library: https://quaternius.com/packs/universalanimationlibrary.html | Y, CC0 | only if Kenney characters fail the look/budget |
Mixamo excluded (Adobe licence, no redistribution).
- **Team colour**: Kenney models use one shared colormap, so no per-team named material is expected. Plan: SP03 fallback (tinted base plate + roof marker) first; `teamMaterial` only if a one-off Blender/gltf-transform step splits a material [RESOLVED: base plate + roof marker first; teamMaterial only if a split works]. Characters: shirt recolour via `teamMaterial` ("Shirt") or `tint`.
- **Palettes** (`palettes` in manifest; every key in both). Default: player.1 #2E86FF, player.2 #FF4D4D, player.3 #FFC933, player.4 #35C46B, neutral #A0A7B0. Colourblind (Okabe-Ito): #0072B2, #D55E00, #F0E442, #009E73, neutral #999999. `teamMarkers`: circle/triangle/square/diamond.
- **Themes** (`level.visual`): `city.day` (B1), `city.dusk` (B2), `city.overcast` (B3), `city.night` (B4); same models/palette material, differing ground tint, light, fog, props. Cheap variety without new art.
- **Budgets** (SP03 `check:manifest`): troop <= 300 tris, tower <= 5k, texture <= 1024^2; initial load <= ~10 MB; music lazy-loaded; models through gltf-transform (meshopt, dedupe, texture resize) at import.
- **CREDITS.md process**: per file row: file, pack, author, URL, licence, download date, modifications; licence text copy under `assets/licenses/`; re-verify licence on the pack page at download time, record in the row. `check:manifest` fails if a `src` is missing from CREDITS. In-game credits screen reads the same doc.

## Decisions
| # | Decision | Choice | Alternatives considered | Why |
|---|---|---|---|---|
| 1 | Tower variety | `standard` + `small` + `large` via `extends` | Standard only; per-level overrides | Differentiates levels, no new components; overrides hide balance in levels |
| 2 | Overrides in campaign | None | Allow ad-hoc | Resolves SP01 open question: new archetype instead; runner list stays empty |
| 3 | Authoring | Hand JSON + optional emit-JSON symmetry helper | Pure hand; layout DSL in-game | Data stays source of truth; symmetry helper saves time on 3-4 seat maps |
| 4 | Map size | 120x80 all levels | Variable big maps | Fixed camera, label legibility |
| 5 | Art packs | Kenney family (Commercial, Roads, Mini Characters) | Mixed Kenney/KayKit/Quaternius | One style family, all CC0 verified |
| 6 | Variety across bands | 4 themes (light/fog/ground) | Per-band new asset sets | Zero extra assets |
| 7 | Difficulty proof | reference + human-proxy win-rate bands + owner playtest | reference only | Reference too strong to represent a human |
| 8 | Slice levels | 1, 10, 18 | 1-3 | Spans easy/open, mid 2-bot, densest 3-bot (label + perf stress) |

## Manual steps (owner-only)
1. Playtest greybox; sign off feel and rule/balance numbers (gate to slice).
2. Approve slice art (look, prominence, colourblind palette) before 17 more levels.
3. Pick music track; sign off per band playtest.
4. Final campaign sign-off (all 20 completable, difficulty ramp).

Cross-PRD asks: **SP01** [ACCEPTED] hosts `small`/`large`; `extends` may change `drawsLines.extraSlotAbove`. **SP04** [ACCEPTED] `human-proxy` tooling profile, tier names `easy|normal|hard|expert`, `balance-targets.json` schema. **SP03** base-plate team-colour fallback must be good enough as primary (open with SP03).

## Risks / Open Questions
- [RESOLVED: check on import; fallback base plate] Kenney buildings: tris within 5k and any splittable team material? Check on import; fallback base plate.
- [RESOLVED: check on import; fallback order decimate → capsule → Quaternius] Mini Characters tris vs 300 budget; fallback decimate, capsule primitive troop, or Quaternius.
- [RESOLVED: SP04 per-band rule: band 4 needs >= K-1 of K seeds or a committed solution replay] band 4 vs reference-wins-all-seeds.
- [RESOLVED: agents pick CC0 audio (Kenney audio packs for SFX; a CC0 music track), verify licence at download, record in docs/CREDITS.md; user may swap at slice sign-off] Music + clash/capture SFX source and licence not yet verified.
- [DEFERRED: greybox playtest] All numbers (tower variants, tier skill, thresholds) are guesses until greybox playtest.
- [RESOLVED: tier ids `easy|normal|hard|expert` owned by SP04] tier naming.
- [DEFERRED: test on L18 at greybox] Are 120x80 and 18 u spacing sufficient for 14-tower level at laptop resolutions; test on L18 first.
- [DEFERRED: check at greybox; tune bot aggression if needed] Do 3-bot levels end with bots killing each other too fast (FFA balance)?
- [RESOLVED: no overrides in campaign] SP01 overrides question.
- [DEFERRED] Per-band music, v2 tower art, in-game level preview thumbnails.

## Acceptance Criteria
1. 20 level files validate (`validate:content`, `validate:levels --seeds 4`, `check:manifest`); `order` contiguous, 4 bands x 5.
2. Per-level table matches files for tower count, bot profile, limit, teaching focus (spot-checked).
3. Balance report within band thresholds; every out-of-range level has a logged waiver.
4. No level uses `overrides`; only `standard|small|large` archetypes; no level uses a variant before its intro level.
5. Swapping all models via manifest edit only (e.g. back to primitives) works with zero code change.
6. `docs/CREDITS.md` lists every shipped asset with licence; `check:manifest` green; no non-CC0 asset in repo.
7. Slice (1, 10, 18) screenshots: readable labels, glyphs and colourblind palette distinct, 60 fps on L18 per SP03 perf HUD.
8. Owner signed off greybox, slice, and final campaign.

## Phasing
1. **Greybox**: L1-L5 plus L10 draft with primitives, 1 bot, real rules. 2. **Owner playtest + tune** (numbers, tier values, variant stats). 3. **Slice L1, L10, L18** with Kenney art, themes, audio, CREDITS; owner approval. 4. **Remaining 17** in band order, runner-tuned, per-band owner playtest.
