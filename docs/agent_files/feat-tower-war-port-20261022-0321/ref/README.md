# BF/ref — reference images + capture output

**PRIMARY compare source: `tw-yt/INDEX.md`** (owner-supplied frames from the all-levels walkthrough, file -> level). Use those first.
Everything below is SECONDARY (store promo shots + playlist frames), seeded from `feat-visual-mechanics-overhaul-20261017-2318/ref/` (PRD R6). `citytakeover_*` intentionally not copied (other game).
All refs are portrait phone frames; our game is landscape. Compare art/colours/building+unit looks/labels/HUD/effects, not layout.

| image | level / env | what it shows / use for |
|---|---|---|
| towerwar_01.jpg | grass (L1-5 look) | promo "Conquer all": blue factory+tanks on line, gray neutrals, red/yellow towers, lookout hut (gun tower "5") + white range circle, pine rows, X3 BOOST btn, canyon rocks/tires/crates border. L4 Green art ref |
| towerwar_02.jpg | desert/mine | blue factory w/ smoke, 3 teams, crate blockades, rails border (desert env) |
| towerwar_03.jpg | snow | promo "Epic battles": many blue lines+tanks, "Max" labels, gold bars (24), rocket launcher, ice-block barriers, igloo-less rocks, snowman. L21 Snow art ref |
| towerwar_06.jpg | snow, wide | red vs blue lines crossing on ice |
| towerwar_07.jpg | cave | promo "Use tactics": 4 teams (green/yellow/blue), many coloured lines, purple crystals, rails, barrels/warning sign, cracked maroon ground |
| towerwar_09.jpg | grass | same as 01 with HUD top: progress bar blue/red/yellow + undo btn (HUD ref) |
| towerwar_10.jpg | desert/mine | same as 02, clean (no overlay) |
| towerwar_yt1.jpg | L6 grass | in-play: 4 teams, lines+troops, red gun hut w/ range circle, level pill progress bar; right/left panels = zoom crops (tower "38"/"44" digit+pip look, lane texture) |
| towerwar_yt2.jpg | L17 grass | blue factories with smoke + "↑29" label, red tower stack, tanks on lines, tower zoom crops |
| towerwar_yt3.jpg | L28 snow | ice-floe ground, ice-block barriers, igloo/campfire/snowman props, red/yellow factories (zoom: factory + lane) |
| towerwar_yt4.jpg | L47 desert mine | rails border, crystals, crate/wood barricades, landmine clusters (black discs), gray gun hut |
| towerwar_yt5.jpg | L67 jungle | palm/tiki/waterfall/pyramid props, yellow factory, wooden barricades, blue gun hut + range circle, bomb powerup btn |
| towerwar_yt6.jpg | L93 cave | purple crystals, minecart rails, cracked maroon ground, crate walls, blue factory (158) w/ tanks |
| towerwar_yt7.jpg | L105 lava | lava rivers, dino skeleton, ice-block-style barriers, gray gun hut, green factory firing, two range circles |
| towerwar_yt8.jpg | L116 lava | lava env, blue factory hub, gun huts (yellow/green) + large range circles, barrier lines |

Note: the older `REFERENCE.md` yt level guesses (yt2=L6, yt3=L17...) were off by one; the table above is from viewing the frames (HUD "LEVEL N"). 02/06/09/10 descriptions carried over from the prior REFERENCE.md (not re-viewed).

## Capture / compare loop (R6, D8)
- Run: `pnpm assets:capture [--scene stub|l4-green|l21-snow|unit-lineup|stage-ladder|fx|a,b|all] [--compare] [--out dir]`
- Harness: `tools/assets/capture/` (own Vite dev page, 1600x900 headless Chromium/SwiftShader via apps/web's Playwright; not in the production bundle). Scenes = entries in `tools/assets/capture/scenes/index.js` (`load()` -> module whose default export draws a frame; optional `ref` = path under this folder). All are currently the stub; renderer tasks swap in real ones.
- Output: `ref/out/<scene>.png`; `--compare` also writes `<scene>.compare.png` (capture | reference).
- `ref/out/` is gitignored (scratch/stub outputs). Tasks that need a committed acceptance capture `git add -f` the specific named PNG.
- Default scene->ref pairing: l4-green -> tw-yt/L04.jpg, l21-snow -> tw-yt/L21.jpg, fx -> tw-yt/d-tower-firing.jpg.
