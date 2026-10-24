### R-LIN-01

`DrawLine{from, to}` is valid if and only if: the caller owns the source; the source is a house; the target exists and is not the source; no line from source to target already exists; a free slot exists (after a same-owner reverse-line replacement, R-LIN-03); and the line is not blocked (R-OBS-01). A rejected command changes nothing.

*Source:* 03#3.2.

*Params:* None.

*Examples:* E-LINES, E-BLOCK.

*Since:* 2.0.0.

*Supersedes:* v1 R-LIN-01 (tower sources, slot auto-cut).

### R-LIN-02

A house has `slots = stage(L)` line slots. There is **no auto-cut**: when the level drops (hit, tower shot) a house keeps every drawn line even if `lines > slots`. `free = slots − lines` may be negative; a draw needs `free > 0`. The spawn penalty (R-SPN-01) uses the actual line count.

*Source:* decomp `SetAvailableWays` → `SetAvailableWaysCount` only sets a reactive property; `CalculateFreeWays = avail − count`; no cutter found (03#3.1).

*Params:* `stageThresholds`.

*Examples:* E-STAGE.

*Since:* 2.0.0.

*Supersedes:* v1 R-LIN-02 / v1 slot enforcement (end-of-tick auto-cut of newest lines).

### R-LIN-03

Drawing a line that is the reverse of an existing line of the **same owner** replaces that reverse line: the old line is removed, its troops stay in flight, and the new line starts a fresh timer (R-SPN-03). A reverse line of a **hostile** owner coexists with the new line and creates head-on combat (R-CMB-01).

*Source:* 03#3.2.

*Params:* None.

*Examples:* E-LINES, E-HEADON.

*Since:* 2.0.0.

### R-LIN-04

Lines are straight, centre to centre, free to draw and have no length cap. Line crossings alone do nothing; combat between crossing lines is governed by R-CMB-04 and blocking by R-OBS-01.

*Source:* 03#3.3.

*Params:* None.

*Examples:* E-LINES.

*Since:* 2.0.0.

*Supersedes:* v1 R-LIN-04 (crossings had no effect).

### R-LIN-05

`CutLine{from, to}` by the line's owner removes the line: its spawn timer ceases and no further troops depart. Troops already in flight on the line continue to their target.

*Source:* 03#3.4 (`DestroyWayFrom` stops the spawn timer only).

*Params:* None.

*Examples:* E-LINES.

*Since:* 2.0.0.

### R-WIN-01

The human wins when every building with `ignoreForWin = false` (neutral buildings included) is owned by the human. The remaining ignored buildings then flip to the human.

*Source:* 03#7.2.

*Params:* `ignoreForWin` (TW `cbi`).

*Examples:* E-OUTCOME.

*Since:* 2.0.0.

*Supersedes:* v1 R-WIN-01 (elimination by towers and troops in transit).

### R-WIN-02

The human loses when they own no building with `ignoreForWin = false`. Troops in transit do not count. There is no draw outcome. A win marks the campaign level completed; loss and timeout do not.

*Source:* 03#7.2.

*Params:* `ignoreForWin`.

*Examples:* E-OUTCOME.

*Since:* 2.0.0.

*Supersedes:* v1 R-WIN-02 (mutual-defeat `draw`).

### R-WIN-03

A level may set `timeLimitSec`; when absent there is no limit (no campaign level sets one). At phase 9, `tick >= timeLimitSec × tickRate` ends the match as a timeout loss, evaluated after win and loss in that tick (order win → loss → timeout: a win on the final tick counts as a win). Harness step caps are not outcomes. Once recorded, an outcome is final.

*Source:* v1 R-WIN-03; 03#7.2.

*Params:* `timeLimitSec` (optional).

*Examples:* E-OUTCOME.

*Since:* 2.0.0.

*Supersedes:* v1 R-WIN-03 (300 s default limit).

## Panel UI facts

These facts describe the shipped Kane panel, not additional game rules. Numeric levels, ownership colours and available routes change during play; match live DOM text rather than assuming the examples stay fixed.

- In the test build, `http://localhost:4173/?kane=1&seed=1` opens Kane Arena directly. The short URL `/?kane=1` uses seed 1. Kane controls are unavailable in the production build. Default speed is `0.25x`; the speed button reads `Speed 0.25x` and cycles through 0.25, 0.5, 1 and 2. Keep 0.25 for stable observation; do not reload between actions.
- The bottom panel groups outgoing routes by human-owned source house. A heading has the form `A (blue 15)` (the initial A level is 15, not 20). Source/target letters correspond to the building tags. Towers have no outgoing group. Geometrically blocked routes are omitted from the panel.
- A green ready button has the form `A → C · ready · C: grey 15` in the initial level. The target description is its current colour and level; neutral is `grey`. Click once to draw. Wait for that same button to show `active` before taking the next action.
- A red active button reads `A → C · active`. A single click does not cut it. Double-click the active button to cut its route, at least 700 ms after the route was drawn. Troops already in flight continue. A double-click on a ready button draws once rather than immediately cutting.
- A grey unavailable button uses the route letters followed by its reason, for example the suffix `· no free route` when the source has no free slot. It remains clickable during play. Clicking shows a red alert banner with the full reason; for no free slot the exact text is `This building has no free routes.` This click does not draw or cut a route. Do not assume a particular pair is unavailable until its live text says so.
- The feedback banner has `role="alert"` and `data-testid="kane-banner"`. Error feedback lasts up to 12 seconds and clears on the next pair click. Other reasons have their own messages, such as `An obstacle blocks this route.`
- After the match ends, the panel's buttons are disabled and the banner reads `Game over`. The Kane result text (`data-testid="kane-result"`) shows `Victory!` for a human win, `Defeat` for a loss, or `Time up` for a timeout. These are separate from the result dialog: its title is `Victory!` when another campaign level remains, `All levels complete!` after the single Kane level is won, or `Defeat` after loss. The dialog offers `Replay` on a win or `Retry` on a loss, plus `Levels`.
- Buildings, routes and moving troops are WebGL graphics, not DOM controls. Use the panel's HTML buttons and text for route actions and assertions. Building letter tags are DOM labels, not route controls. A screenshot may show a route, but DOM assertions should use the pair's `ready`/`active` text and the banner/result text.

Sources verified against shipped code: `apps/web/src/kane/{pairs.ts,controller.ts,Overlay.tsx,kane.css}`, `apps/web/src/input/reasons.ts`, `apps/web/src/test-harness/{gate.ts,index.ts}`, `apps/web/src/ui/{ResultPopup.tsx,Hud.tsx}`, and `packages/content/data/levels/na-kane.json`. Regenerate `excerpt.md` with `node tools/kane/assure/build-excerpt.mjs > tools/kane/assure/excerpt.md` after updating these facts or the selected rules.
