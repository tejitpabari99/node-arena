# Bot difficulties

Online lobby presets come from [BOT_PRESETS](../../packages/bots/src/difficulty.ts). Each uses kind `tw`, full behaviour and an empty script.

| Preset | `actionDelayMs` | Source key |
|---|---:|---|
| Easy | 3000 | `BOT_PRESETS.easy` |
| Normal | 1500 | `BOT_PRESETS.normal` |
| Hard | 1000 | `BOT_PRESETS.hard` |

Lower configured delay gives the bot more frequent decision opportunities. It is a simulation-time parameter, with seeded PvP phase selection in [the seat controller](../../packages/bots/src/seat.ts); it is not a wall-clock performance budget. Server bots use the [PvP bot driver](../../packages/bots/src/pvp.ts) and the same legal command interface as humans.

The [human proxy](../../packages/bots/src/driver.ts) is a headless stand-in for test/validation runs: kind `tw`, full behaviour, no script, `actionDelayMs: 2000`. It is separate from online lobby difficulty selection. Campaign seats use their authored bot blocks, including optional scripts; selecting a lobby preset does not retune campaign data.

`BOT_VERSION` is currently 1.0.0 in [version.ts](../../packages/bots/src/version.ts). Algorithm changes require a deliberate bump; a changed resolved bot-hash map requires an increase against the committed baseline even after lock regeneration. See [version policy](versions.md) and [content authoring](../implementation/content-authoring.md#versions-and-hashes).
