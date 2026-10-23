# Task 12 capture notes (SwiftShader, 1600x900; refs are portrait phone shots, compare style/colour/content, not layout)
Regenerate: `pnpm assets:capture --scene all --compare`. Lights: Unity rig x PI (see validation.md "Task 12").

| capture | reference | match | owner-visible diffs |
|---|---|---|---|
| `l4-green.png` / `.compare.png` | `tw-yt/L04.jpg` | building models, team colours, white labels w/ pips, range ring, lane ribbons, grass/sand bands, unit sprites | no canyon rocks/crates/tyres/trees border (dressing dropped, tri budget); our grass ~10% darker; range ring is a thin line, ref is a translucent filled disc; ours landscape and rotated |
| `l21-snow.png` / `.compare.png` | `tw-yt/L21.jpg` (also L22 style) | factories w/ smokestack, gray/blue/green teams, pagoda tower + ring, drag-preview ribbon, ice floor | no cliffs/igloo/campfire/snow trees; ice ground bluer than ref's near-white; no "up N" factory label, no blue selection ring |
| `unit-lineup.png` / `.compare.png` | `tw-yt/d-battle-lanes.jpg` | soldier + tank models, 4 team textures, death ghosts | units are lined up for inspection, no lane context; ref units a bit smaller on screen |
| `stage-ladder.png` / `.compare.png` | `tw-yt/d-house-levels-11.jpg` | 3 stages (5/10/30) x 5 colours x house/factory/tower; pips; labels | ref grass brighter yellow-green; ref has ground shadow blob under buildings (we have none) |
| `fx.png` / `.compare.png` | `tw-yt/d-tower-firing.jpg` | capture ring, stage-up glow, clash burst, death smoke, tower beam | beam is a brief thin flash (ref: persistent green lane + grey cannonball); no ball sprite trail |
| `perf.png` | n/a | 720 troops + 20 buildings, draws 181 (units 52), tris 678k | tris over budget (see validation.md) |
| `obstacles-green.png`, `obstacles-snow.png` | `tw-yt/L22.jpg` (ice blocks) | ice cubes/bushes at correct places, crisp at 256px | ice more saturated blue than ref |
