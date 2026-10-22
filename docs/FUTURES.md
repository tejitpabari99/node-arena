# Futures

Ideas deferred from current work. Not scheduled.

## From v1.1 visual overhaul (2026-10-17)
- **Use Tower War as the style reference for v2.** When building v2 tower types and power-ups, look at how Tower War: Tactical Conquest (SayGames) does it: tank factory (tanks = 2 troops), watchtower/archer (neutral watchtower attacks everyone, radius circle), boosts (x3 boost). References in `docs/agent_files/feat-visual-mechanics-overhaul-*/ref/` and the playlist in `ref/playlist.txt`.
- **More themes:** desert, snow, cave, lava dioramas (Tower War rotates these); the theme is already a level data field.
- **Per-band themes:** assign a theme per difficulty band.
- **New SFX** matching the Tower War style.
- **Level layout/balance pass** after the new visuals settle.

## From Tower War port PRD resolution (2026-10-22)
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
