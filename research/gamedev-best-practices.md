# Node Arena: Game Dev Best Practices Checklist (2026-10-06)

Note: items marked (judgment) are engineering opinion, not directly sourced. Web pages were summarized via fetch/search; verify details before citing externally.

---
## 1. GAME_RULES spec that stays authoritative
**Practices**
- Split into: (a) MECHANICS (fixed rules, prose + pseudocode), (b) TUNABLES (numbers in a separate schema-validated data file), (c) NON-RULES (UX, art; out of spec).
- Every rule gets a stable ID (`R-ROUTE-003`); never renumber, deprecate instead. Each rule: statement, rationale, tunable refs by key (not value), worked example, test IDs.
- Version the spec (`RULES_VERSION` semver); embed in saves, replays, level files. Major bump when sim behavior changes (old replays invalid).
- Worked examples (state -> expected state after N ticks) double as tests.
- Sim code cites IDs in comments; tests named `[R-xxx]`; CI script checks every rule ID has >=1 test and every test ID exists in spec.

**Node Arena**
- `GAME_RULES.md` sections: Tick model, Towers (garrison, capacity cap, spawn rate, slot unlock at 10/30), Routes (create/cut/retarget, slot limits), Troop movement, Clash (midway resolution), Capture, Win/loss/time limit, Speed (1x/2x = ticks per real second only), Bots (same commands).
- Spell out edge cases: simultaneous capture, clash tie, route to own tower (reinforce), garrison falling below slot threshold with active routes (what happens?), cap overflow, 3+ way crossings, same-tick event order (deterministic by id).
- Tunables: `spawnPerSec`, `capacity`, `troopSpeed`, `slotThresholds=[10,30]`, `clashDamage`.

**Sources**
- Command pattern (rules as data/commands): https://gameprogrammingpatterns.com/command.html
- Rules as pure reducer + seeded RNG in state, seed/tuning/actions logged per run: https://github.com/Dungeons-Moles/game-balance-sim
- GDC Vault (design doc talks): https://www.gdcvault.com/

---
## 2. Simulation architecture
**Practices**
- Fixed timestep with accumulator; renderer produces time, sim consumes in fixed chunks; clamp max frame time (avoid spiral of death); render with `alpha = acc/dt` interpolation between prev/current state.
- Sim package: zero DOM/Three imports, no `Date.now`, no `Math.random`, no reliance on unordered iteration.
- Determinism: Gaffer: bit-exact float determinism across compilers/platforms has "no silver bullet". In JS, + - * / sqrt are IEEE-deterministic; transcendental `Math.sin/cos/pow/exp` are implementation-defined (judgment, widely known). Safest: integer / fixed-point state, no trig in sim, own seeded PRNG (mulberry32/sfc32).
- Command/event model: input = `Command{tick, playerId, type, payload}`; sim output = events (`TowerCaptured`, `Clash`...) consumed by render/audio/juice. Bots emit same commands. Gives replays and lockstep/authoritative server later.
- Per-N-tick `hashState` to detect drift/desync.
- Render never mutates sim.

**Node Arena**
- 20 Hz tick (judgment: enough for genre), 60 fps interpolated render. 2x = two ticks per step, not bigger dt. Pause = stop accumulator.
- Model troops along routes as 1D progress (fixed-point) per route lane, not free 2D agents: cheap, deterministic, clash = streams meeting where progress sums to route length. Renderer maps to 3D.
- State = plain serializable objects, int ids.
- Lint: ban `Math.random|Date|performance|Math.sin|Math.cos` in `packages/sim`.

**Sources**
- Fix Your Timestep: https://gafferongames.com/post/fix_your_timestep/
- Deterministic Lockstep: https://gafferongames.com/post/deterministic_lockstep/
- Floating Point Determinism: https://gafferongames.com/post/floating_point_determinism/
- Game Loop: https://gameprogrammingpatterns.com/game-loop.html
- Command pattern (replay, networking via serialized commands): https://gameprogrammingpatterns.com/command.html

---
## 3. Testing
**Practices**
- Rule-level unit tests by rule ID using state builders (`makeState({towers:[...]})`).
- Golden/replay tests: (seed, level, commands) -> final state hash + event log committed; golden change requires RULES_VERSION bump or explicit justification.
- Property tests (fast-check, seeded): troops never negative, garrison <= capacity, conservation (created - lost = delta), routes only from owned towers, determinism (same input twice -> same hash).
- Level validation: per level run N headless bot-vs-bot games over seeds; assert no crash, terminates, reference bot wins within time limit (solvable), idle bot and random bot lose (not trivial).
- Visual regression: Playwright `toHaveScreenshot` on a few scenes only; deterministic camera, fixed seed/tick, animations off, `?test=1` freeze flag; WebGL varies by GPU so use software renderer in CI and tolerant `maxDiffPixelRatio`. Playwright retakes until two consecutive shots match.
- E2E: simulate drag via `page.mouse`; assert on `window.__game.getState()` test hook, not pixels.

**Node Arena CI layers**: (1) vitest unit + property (seconds), (2) goldens, (3) `validate:levels` sweep (on level/balance change), (4) Playwright smoke + <=10 screenshots. Spec-coverage script gate.

**Sources**
- fast-check + Vitest: https://fast-check.dev/blog/2025/03/28/beyond-flaky-tests-bringing-controlled-randomness-to-vitest/ , https://www.npmjs.com/package/@fast-check/vitest
- Vitest features/snapshots: https://vitest.dev/guide/features
- Playwright snapshots: https://playwright.dev/docs/test-snapshots ; WebGL/canvas notes: https://github.com/testdino-hq/playwright-skill/blob/main/core/canvas-and-webgl.md ; https://bug0.com/knowledge-base/playwright-visual-regression-testing
- Replay validation practice: https://github.com/Dungeons-Moles/game-balance-sim

---
## 4. Balancing & tuning
**Practices**
- Tunables in JSON validated by schema (zod/valibot); zero magic numbers in sim.
- Headless bot-vs-bot Monte Carlo over seeds x levels x bot pairs; report win-rate matrix, median duration, timeouts, snowball index. Set target bands (e.g. reference bot wins 40-70% on mid levels); indie example: tuned from 0-3% win to 37.8% within 25-40% band.
- Dev panel (lil-gui/tweakpane) behind `?dev`: live tunables, tick step, seed picker, replay load, debug overlays (route graph, garrison, tick/hash); Vite HMR for config reload.
- Log seed + tuning + commands for every run.

**Node Arena**
- `balance.json` hot-reloads in dev (restart level on change). `pnpm balance:sim --levels all --bots a,b --runs 200` prints markdown table. Watch for dominant strategy (route spam from big tower), stalemates, side advantage (swap sides).
- Any balance change re-runs level validation.

**Sources**
- Simulation-driven balancing: https://github.com/Dungeons-Moles/game-balance-sim ; https://github.com/PirateKingInc/test-m3/pull/12
- Metagame autobalancing: https://arxiv.org/pdf/2006.04419

---
## 5. Level design
**Practices**
- One new idea per level: introduce -> practice -> twist -> mastery. Tutorial level makes the new mechanic the only sensible move.
- Sawtooth difficulty: new mechanic eases difficulty briefly, then ramps; breather levels.
- Level data: versioned JSON (`levelFormatVersion`, `rulesVersion`, stable string `id`, name, timeLimit, towers[{id,pos,owner,garrison,capacity}], bots[{id,profile,difficulty}], hints[]). Schema + semantic checks (graph connected, no overlap, garrison <= cap, valid owners).
- Editor: not in v1. Hand-edit JSON with Vite HMR live preview + validator on save. Later: in-game editor exporting JSON.

**Node Arena 20-level arc (suggested)**: 1-3 routes + capture vs passive bot; 4-5 capacity cap; 6-8 slot unlock at 10 + route cutting/clash; 9-10 first real bot; 11-14 multi-enemy/neutrals + time pressure; 15-17 slot 30, chokepoints; 18-20 hard bots + combined mechanics. Use validation sweep to check the bot win-rate curve trends downward with breathers.

**Sources**
- GDC Vault Level Design Fundamentals & Techniques: https://www.gdcvault.com/play/1022451/Level-Design-Fundamentals
- GDC Vault Level Design Workshop: Solving Puzzle Design: https://www.gdcvault.com/play/1023549/Level-Design-Workshop-Solving-Puzzle
- Level Design Tips and Tricks: https://www.gamedeveloper.com/design/level-design-tips-and-tricks
- Difficulty curves: http://www.davetech.co.uk/difficultycurves
- Generating levels that teach mechanics: https://arxiv.org/pdf/1807.06734

---
## 6. Bot AI
**Practices**
- Utility/heuristic scoring: candidate actions (create route A->B, cut route, retarget); considerations: target garrison vs incoming, distance, target value (spawn rate/capacity), threat to own towers, spare troops. Pick best or weighted-random top-k via seeded RNG.
- Difficulty via decision interval (e.g. 2.0 s easy ... 0.4 s hard), reaction delay to events, scoring noise, max concurrent routes, estimate accuracy. NOT resource bonuses or hidden info.
- Fairness: same Commands through same validation; no hidden multipliers. Human reaction ~200-250 ms as floor for hard.
- Weights/profiles in JSON so bot-vs-bot sims compare profiles. Bots deterministic (seeded, tick-based timers). Bots live outside sim core, read-only state in, commands out (reusable on server).

**Node Arena**: profiles `rusher`, `turtle` (defend/cut), `economist` (prioritize high-spawn towers), `opportunist` (hits towers depleted by clashes). Plus a strong reference-solver bot for solvability checks.

**Sources**
- Dave Mark & Mike Lewis, Building a Better Centaur (IAUS), GDC 2015: https://www.gdcvault.com/play/1021848/Building-a-Better-Centaur-AI
- Utility system: https://en.wikipedia.org/wiki/Utility_system ; intro https://shaggydev.com/2023/04/19/utility-ai/
- RTS AI problems & techniques: https://www.researchgate.net/publication/311176051_RTS_AI_Problems_and_Techniques
- Reaction-time delay for fairness (secondary source): https://aicompetence.org/train-ai-for-perfect-game-difficulty-balancing/

---
## 7. Game feel / juice
**Practices**
- Feedback within one frame of input: hover highlight, drag-start ping, route line follows cursor with slight easing, magnetic snap to valid targets (screen-space radius), invalid target = red + small shake.
- Capture: scale punch (squash/stretch), ring pulse, colour sweep to new owner, particle burst, pitch-varied sound, tiny decaying camera shake (toggle in settings).
- Clash: sparks at meeting point, throttled tick sounds.
- No hit-stop on the sim (real-time); visual-only micro-freeze at most.
- Easing: ease-out for appear, ease-in-out for move, 80-250 ms; damped springs for UI.
- Input: Pointer Events (mouse + trackpad), pointer capture during drag, 4-6 px drag threshold, no right-click/hover-only dependence (trackpads), cancel with Esc or drag back to origin.
- Swipe to cut: sample pointer path segments, segment-vs-route-polyline intersection each pointermove; highlight route before cut; min swipe length/speed to avoid accidents; cuts are commands.
- Audio: one AudioContext unlocked on first gesture, voice limit, pooled sounds, music/sfx sliders, persisted mute.

**Sources**
- "Juice it or Lose it" (Jonasson & Purho 2012) and "The Art of Screenshake" (Nijman 2013): https://alakajam.com/post/232/juice-up-your-games
- Game feel on the web: https://valdemird.com/blog/game-feel-on-the-web/
- Game Feel overview: https://eolt.org/articles/game-feel/
- Game Maker's Toolkit, "Secrets of Game Feel and Juice" (YouTube)

---
## 8. Three.js performance for many units
**Practices**
- InstancedMesh: one draw call per unit type/team; set `count` to live instances; update only changed matrices; `DynamicDrawUsage`; team colour via `instanceColor`; mind bounding sphere/`frustumCulled`.
- BatchedMesh for varied geometry with a single material.
- Budget (guideline): <100 draw calls, <100k vertices.
- Skip skeletal animation/VAT for troops in v1; use vertex-shader bob/scale keyed by instance id + time. VAT later if needed.
- Shadows: one directional light, one 1024-2048 map, tight frustum, casters = towers/buildings only; troops get blob decals or none.
- Static scenery: merge or instance; `matrixAutoUpdate=false`.
- Cap pixel ratio (`min(dpr,2)`), avoid post-processing initially; dispose resources on level change.
- Labels: CSS2DRenderer fine for tens of labels, but costly with hundreds/per-frame updates; troika-three-text (SDF, worker-based, batched) for larger; instanced digit-quad atlas cheapest for numbers. Update text only when value changes.
- Perf HUD: stats.js + `renderer.info`; measure sim tick cost separately; stress level (~2000 troops) in perf smoke.

**Node Arena**: start with CSS2D digits (<~30 towers), measure; switch to instanced digit sprites if labels exceed ~8% frame time (judgment threshold). One InstancedMesh per team.

**Sources**
- InstancedMesh docs: https://threejs.org/docs/#api/en/objects/InstancedMesh
- Optimize lots of objects: https://threejs.org/manual/#en/optimize-lots-of-objects
- Tips: https://www.utsubo.com/blog/threejs-best-practices-100-tips ; https://discourse.threejs.org/t/best-way-to-reduce-draw-calls/25186
- Instancing devlog: https://vrmeup.com/devlog/devlog_10_threejs_instancedmesh_performance_optimizations.html
- Labels: https://discourse.threejs.org/t/how-to-create-lots-of-optimized-2d-text-labels/66927 ; https://protectwise.github.io/troika/troika-three-text/

---
## 9. UX: readability, onboarding, settings, saves
**Practices**
- Never colour alone: team = colour + shape/icon/pattern (player = ring + blue, enemy = square + orange, neutral = grey hex); troop streams get different silhouettes/arrow markers; blue/orange base palette; colourblind palette option; check with DevTools vision-deficiency emulation.
- High-contrast labels, text scaling, UI independent of 3D lighting.
- Onboarding: early levels as tutorials, one-line contextual prompts, highlighted targets, show-once, replayable help; no wall-of-text modals.
- Pause: resume/restart/settings/quit; auto-pause on `visibilitychange`; 1x/2x toggle always visible.
- Settings: music/sfx volume, mute, quality (shadows/pixel ratio), screen shake, colourblind mode, reduced motion; persisted.
- Saves: one key, `{schemaVersion, rulesVersion, completed:{levelId:{bestTime}}, settings}`; chained migrations; validate on load; on corrupt data back up to second key and reset; try/catch (private mode); stable string level ids (not indices).

**Sources**
- Game Accessibility Guidelines: https://gameaccessibilityguidelines.com/
- Redundant encoding in games (Among Us example): https://eureka.patsnap.com/report-research-on-the-accessibility-gap-between-color-coding-and-color-blind-safe-palettes
- Designing for colorblindness: https://www.smashingmagazine.com/2024/02/designing-for-colorblindness/
- MDN localStorage: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage

---
## 10. Asset pipeline
**Practices**
- Raw packs in `assets-src/` untouched with license files; processed output in `public/assets/`; reproducible `pnpm assets:build` with glTF-Transform (dedup, prune, weld, quantize, meshopt; KTX2 only for large textures; palette-textured low-poly may skip).
- `ASSETS.md`/`CREDITS.md`: asset, pack, author, URL, license (CC0), download date, modifications. CC0 needs no attribution, but record provenance, store license copy, verify each pack's license at download, add in-game credits.
- Style consistency: one flat/palette look; shared palette material or vertex colours; consistent scale (1 unit ~ 1 m), pivots (base-centre), lighting; 1-2 packs for buildings; reject mismatched one-offs.
- Audio: CC0 only (Kenney audio), loudness-normalize, compress ogg/mp3; credit in same file.
- Budget (judgment): initial load < ~10 MB; lazy-load music.

**Sources**
- glTF Transform: https://gltf-transform.dev/ ; https://www.npmjs.com/package/@gltf-transform/cli
- Draco vs Meshopt: https://polyforge.xyz/learn/draco-vs-meshopt-compression ; https://compress-glb.com/blog/draco-vs-meshopt/
- Kenney: https://kenney.nl/assets ; KayKit: https://kaylousberg.itch.io/ ; Quaternius: https://quaternius.com/
- CC0: https://creativecommons.org/publicdomain/zero/1.0/

---
## 11. Process
**Practices**
- Greybox first (boxes, lines, no art): prove drag-route + clash + capture is fun within days; prototype tests 1-2 mechanics only.
- Vertical slice = 3 levels with final art/UI/sound/juice and full flow (picker -> play -> win -> save) before building the other 17.
- Playtest loop: 3-5 people, observe silently, note hesitation points, fix top 3 per round; replay-file export so testers can send runs.
- Scope control: written "not in v1" list (multiplayer, editor, upgrades, fog of war, story, touch, accounts); freeze rules after slice; rule changes go through spec + version bump.
- Pitfalls: engine before game; polish before core loop proven; over-scope; placeholder leaks; no tutorial; content authored before balance tooling; sim coupled to render (blocks multiplayer).

**Sources**
- https://tonogameconsultants.com/prototyping/ ; https://www.wayline.io/blog/prototype-polished-game-cost
- https://www.wayline.io/blog/indie-game-dev-doom-loop
- https://tonogameconsultants.com/vertical-slice/ ; https://www.wayline.io/blog/the-vertical-slice-deception-a-pact-with-the-devil

---
# MUST DO IN V1 (prioritized, <=15)
1. GAME_RULES.md with stable rule IDs, edge-case section, worked examples; tunables in schema-validated `balance.json`; RULES_VERSION.
2. CI check: every rule ID has a test; tests named by ID.
3. Sim package pure TS: fixed 20 Hz tick, no Date/Math.random/trig, seeded PRNG, lint-banned APIs, no render deps.
4. Command-in / event-out interface; player and bots use identical commands; state hash.
5. Fixed-timestep accumulator with frame clamp and render interpolation; 2x = more ticks, pause = stop.
6. Replay format (seed + level + commands + rulesVersion) and golden-replay tests.
7. Property tests (fast-check) for invariants (conservation, caps, determinism).
8. Level JSON schema + semantic validator + `validate:levels` bot-vs-bot sweep (reference bot solves, idle bot fails).
9. Headless balance runner (win-rate matrix) + dev panel with live tunables.
10. Utility-AI bots with JSON profiles; difficulty via decision interval/noise only; no cheating.
11. Greybox playable first, then 3-level vertical slice with final art before authoring the remaining levels.
12. Readability: colour + shape/icon redundancy, colourblind option; levels 1-8 teach one mechanic each.
13. Three.js: InstancedMesh per team, one shadow light, pixel-ratio cap, perf HUD, disposal on level change.
14. Versioned save with migration, validation, try/catch, stable level ids; settings (volume, shake, quality, colourblind).
15. ASSETS/CREDITS file with provenance + license copies; glTF-Transform build script; 1-2 packs, shared palette material.

# LATER
- In-game level editor; level-share format.
- Vertex animation textures / skeletal troops; BatchedMesh variants; LOD.
- SDF / instanced-digit labels if CSS2D shows cost.
- Full fixed-point conversion if cross-runtime float drift is observed.
- Colyseus authoritative server (v3+): input delay buffer, desync detection via periodic hashes, client prediction.
- Cloud saves, daily challenges, leaderboards via replays.
- Dynamic difficulty; more bot profiles; MCTS bot for hard mode.
- Expanded visual regression; Firefox/Safari perf checks.
- Touch/mobile, gamepad, localisation, remappable input, reduced-motion polish.
