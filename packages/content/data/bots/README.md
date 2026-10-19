# Bot profiles

The production corpus has **23 profiles**: four personalities (`rusher`, `turtle`,
`economist`, `opportunist`), sixteen skill-only tiers, and `reference`, `human-proxy`,
`idle`. The task's stated count of 24 was an arithmetic error; the named set is 23.
The separate `data/examples/sample-bot.json` remains the sample level's supporting
profile, so the complete content hash lock contains 24 bots.

Each personality supplies every utility parameter and all ten consideration keys
for attack, reinforce and cut. These are starting values for SP05 tuning, not
campaign balance claims. Difficulty changes only `skill`; the committed tier files
have three lines each.

| Tier | Decision interval (seconds) | Noise | Actions |
|---|---:|---:|---:|
| easy | 3.5 | 0.35 | 1 |
| normal | 2.2 | 0.2 | 1 |
| hard | 1.4 | 0.1 | 2 |
| expert | 0.8 | 0.03 | 2 |

`reference` uses a 0.5 second interval, zero noise and three actions. `human-proxy`
inherits its personality with 1.8 seconds, 0.2 noise and one action. Both profiles
and their aliases are restricted to tooling; levels cannot select them. `idle`
is legal in levels and issues no commands. Campaign levels use personality tiers
or idle; production campaign authoring belongs to SP05.

## Line commitment (SP02)

Base profiles carry an optional `commitment` block (fx3 milli-units, bot-side only,
sim rules unchanged): `minLineLifetimeSec`, `dangerOverride`, `cutMargin`,
`redrawBlockSec`, `tieHysteresis`, `slotGuardMargin`, `slotPreemptMargin`. Shipped
values: rusher, turtle, economist and opportunist use (8, 0.7, 0, 10, 0.05, 3, 1), except
turtle `minLineLifetimeSec` 6 and opportunist `redrawBlockSec` 0, `slotGuardMargin` 2.
`reference`, `human-proxy` and `idle` carry no block (v1 path). Tiers may not set
`commitment` (they inherit it). Profiles without the block behave exactly as v1. Field
semantics: `packages/bots/README.md`.
