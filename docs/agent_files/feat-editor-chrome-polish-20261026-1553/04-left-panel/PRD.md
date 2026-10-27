---
status: draft
summary: Left-panel polish: read-only level id above Level name, human labels + tooltips for building Parameters (label map in labels.ts keyed module.field), read-only troop, SP01 restyle.
date: 2026-10-26
---
# PRD: Editor left panel (SP04)

Repo/branch: node-arena · `feat/editor-chrome-polish` · Depends on: SP01 (tokens/primitives) · Owns: `apps/web/src/editor/{LevelSection.tsx,SelectionSection.tsx,labels.ts}`, left-panel block of `style.css` (`.ed-level*`, `.ed-hint`, params/selection rules), `apps/web/test/editor/labels*.test.ts`, label-selector updates in `apps/web/e2e/editor-{level-section,selection,forms}.spec.ts`

## TL;DR
Three content changes, no layout restructure: (1) show immutable level id read-only above "Level name"; (2) replace raw `{module} {field}` Parameters labels with human labels + native-`title` tooltips from one table in `labels.ts`; (3) make `spawns.troop` a read-only display of the effective unit (override shown as "(override)", never dropped). Then restyle with SP01 primitives only.

## Problem
- Level id invisible in the panel; `LevelSection.tsx` renders only name/theme/time limit. Id lives in `doc.id`; [verified] `document.ts:5` regex `^na-[a-z0-9-]{1,40}$`.
- Parameters labels are code identifiers: "level maxLevel", "spawns troop", "grows growTime" (`SelectionSection.tsx:56`, `{module} {field}`). Meanings unexplained.
- `spawns.troop` is a free-text input; typo => content validation error (`packages/content/src/level.ts:101-102` "Unknown unit"). Building type already implies the unit.
- "Ignore for win" checkbox (`SelectionSection.tsx:34`) is cryptic.

## Goals / Non-Goals
**Goals**
- Id visible, copyable, un-editable.
- Every param has plain-English label + one-line tooltip; no module/field identifiers in UI text.
- No way to type an invalid troop; existing overrides survive save.
- Left panel uses SP01 tokens (`.ed-section*`, fields, `.ed-btn*`, `.ed-field-hint`).

**Non-Goals**
- Rename/delete level, id change, schema/content/rules changes (none needed), game UI.
- Layout restructure, new tokens, custom tooltip component (SP01 D11: native `title`).
- Editing troop via dropdown ([DEFERRED]).

## Requirements
1. **Level id row** in `LevelSection`, first row above "Level name": label "Level id", value `doc.id` as read-only selectable text, `title` "Fixed when the level is created". Not part of the draft/Apply (`toDraft`/`LevelProperties` untouched).
2. **Param label table** (below) in `labels.ts`: `PARAM_LABELS: Record<'module.field', {label, tooltip}>`; helper `paramLabel(module, field)` returns the entry, falling back to humanized camelCase (`growTime` -> "Grow time") so new defs never show raw ids.
3. `ParamsGroup` renders `label` and sets `title=tooltip` on the `<label>`; boolean selects keep "Default (Yes/No)" text (not `true`/`false`).
4. **ignoreForWin** checkbox in `OwnerGroup`: label "Optional target (not needed to win)" with tooltip; accessible name = label.
5. **Troop** (`spawns.troop`): read-only row (no input; excluded from the params edit path): label "Unit produced", value = effective `params.spawns.troop ?? archetype default`, humanized. If `params.spawns.troop` is set (golden levels override to `tank`, `packages/sim/test/golden/levels.ts:53`) append "(override)" + tooltip "This level overrides the building's default unit". Params state keeps `structuredClone(item.params)` and `change()` never touches `troop`, so the override round-trips on save. Clearing an override is out of scope.
6. Keep field order = archetype module order; keep hint "Leave blank to use the archetype default." (`.ed-field-hint`).
7. Update selectors using old labels: `editor-forms.spec.ts:42` ("Ignore for win"), `:44` ("spawns spawnSpeed"), plus any in editor-selection/level-section.
8. Restyle (SP01): delete bespoke button/chip/input rules in the left-panel block; Apply buttons `.ed-btn-primary`; secondary (`Add AI`, `Delete`, confirm) `.ed-btn`; panel width stays 300px (pinned by `editor-shell.spec.ts`).

## Architecture
`labels.ts` already hosts display helpers (`playerLabel`, `itemLabels`); the label table lives there as pure data plus one function, unit-testable without DOM. Rendering stays generic: `ParamsGroup` still iterates `archetypes[...].modules x LevelSchema params properties`; only the text source and the troop special-case change. Level id comes from `useEditor().doc.id`.

| Key (`module.field`) | Label | Tooltip (one line) |
|---|---|---|
| `level.maxLevel` | Max level (garrison cap) | Highest level this building reaches; extra troops are forwarded or lost. (R-CAP-01) |
| `spawns.troop` | Unit produced | The unit this building sends out; the building type sets the default. |
| `spawns.spawnSpeed` | Spawn speed | Higher = troops leave each line faster, scaling with level. (R-SPN-01) |
| `spawns.lineSpawnPenalty` | Per-extra-line slowdown | Each extra outgoing line slows every line's spawning; 0 = none. (R-SPN-01) |
| `grows.growTime` | Regrow time multiplier | Scales time to regain a level; only ticks with no outgoing lines. Higher = slower. (R-GRW-01) |
| `shoots.attackDelay` | Fire-rate gain per level | Makes shots more frequent as level rises; higher = faster. (R-TWR-01) |
| `shoots.attackRadius` | Attack radius | Base shooting range at stage 1. |
| `shoots.speedUpByLevel` | Shot delay multiplier | Scales time between shots; higher = slower. (R-TWR-01) |
| `shoots.radiusUpByLevel` | Range gain per stage | Extra range added for each stage above 1. |
| `shoots.radiusUnit` | Range scale | Multiplier converting range values into map distance. |
| `shoots.minRadius` | Minimum range | Troops at or within this distance are not shot (dead zone). (R-TWR-02) |
| `shoots.neutralFires` | Fires while neutral | If yes, an unowned tower still shoots. |
| `shoots.troopPad` | Troop hit margin | Extra reach added to range when targeting troops. |
| `shoots.hitsNeutralHouses` | Shoots neutral houses | If yes, the tower also lowers unowned houses in range. |
| `shoots.bulletSpeed` | Bullet speed (visual) | Shot animation speed only; no gameplay effect. |
| `ignoreForWin` (owner form) | Optional target (not needed to win) | Decoy: no need to capture it to win; at least one building must stay required. (R-WIN-01/02, R-CPT-01) |

## Decisions
| # | Decision | Choice | Alternatives | Why |
|---|---|---|---|---|
| D1 | Label home | `labels.ts` table + humanize fallback | `x-label` metadata in defs/schema | Defs/content are hashed; label edits must not move content identity or schemas |
| D2 | Tooltips | Native `title` | Info-icon popover | SP01 D11; no new primitive |
| D3 | Troop | Read-only row, effective unit, "(override)" when set | Hide when default; dropdown; free text | Honest effective value, safe round-trip, no invalid input |
| D4 | Clear troop override | Not supported now | Reset button | Rare (fixtures only) |
| D5 | Level id | Read-only row outside draft | Editable with warning | Ids immutable |
| D6 | Old labels | Hard rename, update e2e selectors | Keep old aria aliases | Aliases keep jargon in a11y tree; only two known selectors |
| D7 | Unknown module/field | Humanized fallback | Raw id | Future defs stay presentable |
| D8 | Verified firing semantics | `attackDelay` = fire-rate gain per level; `speedUpByLevel` = shot delay multiplier | Original reversed descriptions | Factual correction verified against `docs/GAME_RULES.md:425` and `packages/sim/src/modules/shoots.ts:19`; no mechanics/defs/rules change. Minimum dead-zone equality is inclusive; building type sets the default troop, while level overrides remain supported |

## Risks / Open Questions
- [RESOLVED: humanized unit id (e.g. "Soldier", "Tank").]
- [RESOLVED: tooltip semantics verified against GAME_RULES:425 / sim shoots.ts:19; D8 corrects reversed firing descriptions, inclusive minRadius and default-vs-override troop wording. No mechanics change.]
- [RESOLVED: plain read-only text, no copy button.]
- [RESOLVED: spawns.def.ts + level.ts:101] troop = unit id validated against `catalog.units`.
- [RESOLVED: golden levels.ts:53] override exists in fixtures; preserved via untouched params clone.
- [DEFERRED] Troop dropdown, clear-override, rich tooltips, i18n.
- Merge risk: shared `style.css`; land after SP01, edit only the left-panel block. e2e label selectors may overlap SP03 specs.

## Acceptance Criteria
- Level section shows "Level id" = `doc.id` above "Level name"; not editable; Apply payload unchanged.
- No Parameters label matches the `module field` identifier pattern; every table key renders label + `title`; unit test asserts every field of every archetype module has a table entry.
- "Max level (garrison cap)", "Per-extra-line slowdown", "Regrow time multiplier", "Optional target (not needed to win)" appear verbatim.
- Troop row has no input; with `params.spawns.troop='tank'` it shows Tank "(override)", and saved JSON still contains the override.
- `pnpm -C apps/web test` editor suite and Playwright `editor-*.spec.ts` green after selector updates; 300px width assertion passes.
- 1440x900 screenshots of Level section and building Parameters match SP01 look (no Coiny, tokens only).
