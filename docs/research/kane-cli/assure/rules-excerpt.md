# Node Arena - Rules excerpt (win/loss and line drawing)

Conventions: rule ids are `R-<AREA>-<NN>`. A *building* is a house or tower, owned by a player or neutral. *Hostile* = different owner. *Line* = owner-drawn directed channel from a source house to a target building.

### R-LIN-01

`DrawLine{from, to}` is valid if and only if: the caller owns the source; the source is a house; the target exists and is not the source; no line from source to target already exists; a free slot exists (after a same-owner reverse-line replacement, R-LIN-03); and the line is not blocked (R-OBS-01). A rejected command changes nothing.

*Source:* 03#3.2.

*Params:* None.

*Examples:* E-LINES, E-BLOCK.

*Since:* 2.0.0.

*Supersedes:* v1 R-LIN-01 (tower sources, slot auto-cut).

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

### Retired ids

These ids are tombstones. They stay known so stale references are caught, are never reused, and are not active rules.


## Appendix: observable UI facts
- Level picker at http://localhost:4173/ shows heading "Choose your battle" and level buttons (e.g. "Level 1").
- http://localhost:4173/?level=1 loads level 1 in real time.
- HUD has a button "Back to battle options"; clicking it opens a dialog "Do you want to restart the battle?" with buttons Restart, Continue, Levels.
- When a battle ends a result dialog shows "Victory!" or "Defeat" with buttons Next level, Replay, Retry, Levels.
- A control share bar has aria-label "Control share: N%".
- The battle map is drawn on a WebGL canvas; buildings and lines are not DOM elements.
