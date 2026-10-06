# Engine / Tech Stack Research - node-arena (browser route-strategy game)

Date: 2026-10-06. Neutral evaluation; prior PlayCanvas recommendation ignored.
Confidence tags: [V] verified from a source searched/fetched this session; [K] background knowledge, not re-verified (check before committing).

## 1. Verdict

- **Top pick: Three.js (plain vanilla TS) + Colyseus 0.17/0.18 + shared pure-TS sim package.** Best AI-agent friendliness (largest training-data presence: ~12.2M weekly npm downloads vs Babylon ~315K, PlayCanvas ~57K [V]), smallest bundle (~185 kB gz [V]), fully code-first, easy to verify in headless Chromium.
- **Runner-up: Babylon.js 9** (batteries included: GUI, particles, shadows, glTF, inspector; Apache-2.0; but ~1.8 MB gz core [V], smaller corpus). Choose if you prefer "an engine" over assembling pieces.
- PlayCanvas (code-only engine) is viable (MIT engine, TS types, official Editor MCP [V]) but its main strengths (cloud editor, splats) are unused here; its MCP drives the Editor, not a code-only repo; ecosystem ~1/215 of Three.js by downloads [V].
- Reject: Unity WebGL (8 MB+ empty build [V], C# not shared TS), Godot web (GDScript only; C# cannot export to web [V]), Defold/Cocos (Lua/own tooling, editor-centric, thin AI corpus).
- Phaser 4 (stable Apr 2026, new render-node WebGL renderer [V]) is the best 2D/2.5D option but needs pre-rendered isometric sprites to fake 3D; fallback only.

Key insight: ~20-60 buildings + hundreds to ~2k marching units is a *light* 3D scene. The sim is engine-independent already, so physics/ECS/editor features are irrelevant. A thin renderer wins on bundle, control, AI-friendliness. The real perf risk is animated marchers (section 3), solved by instancing/VAT, not by engine choice.

## 2. Comparison table (1-5, 5 best, for this project)

| Criterion | Three.js | Babylon.js 9 | PlayCanvas (code-only) | Phaser 4 | PixiJS | Godot 4 web | Unity WebGL | Defold / Cocos |
|---|---|---|---|---|---|---|---|---|
| Visual ceiling (low-poly 3D, shadows, particles) | 5 (you assemble) | 5 (built-ins) | 4-5 | 2-3 (2D/iso sprites) | 2 | 4-5 heavy | 5 heavy | 3-4 |
| Web perf / size | 5 (~185 kB gz [V]; WebGPU w/ WebGL2 fallback since r171 [V]) | 3 (~1.8 MB gz core [V]; modular pkgs) | 4 (~615 kB gz [V]) | 5 | 5 | 2 (35 MB optimized example [V]) | 1 (8 MB+ empty [V]) | 4 |
| TS / code-first DX | 4 (no engine structure) | 5 | 4 | 4 | 4 | 1 (GDScript) | 1 (C#) | 2 |
| AI-agent friendliness | 5 (huge corpus, llms.txt-style docs [V]) | 4 | 3 | 4 | 4 | 2 | 2 | 1-2 |
| MCP | Community: threejs-devtools-mcp (59 tools, live scene inspect/edit [V]), docs MCPs | Community babylonjs-mcp (basic scene creation [V]) | Official editor-mcp-server (MIT, 0.7.x [V]) but Editor-bound | none notable | none | community | community | none |
| Multiplayer integration | 5 (Colyseus client ~58 kB gz in 0.18 [V]) | 5 | 5 | 5 | 5 | 3 (Colyseus Godot SDK [V]) | 3 | 3 |
| glTF asset pipeline | 5 | 5 | 4 | n/a | n/a | 5 | 4 | 3 |
| License | MIT | Apache-2.0 [V] | Engine MIT; Editor commercial (unneeded) [V] | MIT | MIT | MIT | Proprietary | MIT / mixed |
| Maturity | Biggest (~116K stars [V]); r186 Sep 2026 [V] | 9.27 Sep 2026 [V] | 2.22 Sep 2026 [V] | 4.2 Jun 2026 [V] | mature | huge, web 2nd-class | huge | small-mid |
| Headless visual test | Easy | Easy | Easy | Easy | Easy | Hard | Hard | Medium |
| Main risk | Build own structure; no native instanced skinning [V] | Bundle size; older-version snippets | Editor-centric docs; small corpus | 2D limit | 2D limit | wrong language/stack | size/language | AI gap |

## 3. Per-candidate notes

### Three.js (r186, Sep 2026 [V])
- Pros: smallest, largest corpus => best Claude output; every low-poly pack ships glTF; GLTFLoader + meshopt/Draco/KTX2; WebGPURenderer with WebGL2 fallback (r171+ [V]); big example set (shadows, instancing, CSS2D labels, outline/postFX).
- Cons: library, not engine. You write asset manager, picking (Raycaster), camera controller, mixer management, scene lifecycle, particles (three.quarks or hand-rolled). Needs a clear ARCHITECTURE.md for agents.
- Animated crowd: SkinnedMesh per unit = draw call each and CPU-bound bones; instanced skinning is not native [V]. InstancedMesh2 community lib handles ~3k animated instances with culling/LOD [V]. Prefer vertex-animation textures (VAT) or procedural step-bob on InstancedMesh of tiny figures (4-8 frame baked cycle is enough at this scale).
- R3F: good for React-declarative scenes, but per-frame reconciliation of hundreds of units is a trap and adds an abstraction between agent and WebGL. Recommendation: vanilla Three.js canvas, imperative render layer fed by sim snapshots; React/Preact only for DOM UI. R3F acceptable but not needed.
- MCP: community-grade only [V]; Playwright + `window.__game` debug hook is a better verification backbone.

### Babylon.js 9 (9.0 Mar 26 2026; 9.27.1 Sep 18 2026 [V])
- Pros: all-in-one (GUI, particles, shadow generators, glow, thin instances, animation groups, Inspector, Havok), TS-native, great playground/docs, Apache-2.0.
- Cons: ~1.8 MB gz full core [V] (tree-shaking can cut it [K]); smaller corpus; agents may mix old v5/v6 API.
- Fallback if Three.js agent output sprawls.

### PlayCanvas engine (2.22 [V])
- npm code-only use is real, MIT, ~615 kB gz [V], ECS, glTF, TS types. Official MCP automates the cloud Editor [V] (no benefit for code-only repo). Docs/community centre on Editor; smaller LLM corpus. Not wrong, just not advantaged here.

### Phaser 4 (4.0 Apr 10 2026; 4.1.0 Apr 30; 4.2.x Jun-Jul [V])
- Excellent 2D; SpriteGPULayer renders 1M sprites in one draw call [V], marchers trivial. But 3D low-poly/shadows would require offline-baked isometric sprite sheets (extra pipeline, direction art). Fallback style option.

### PixiJS
- 2D only; skip (maybe for overlays).

### Godot 4 web
- Single-thread export default since 4.3 [V]; C# cannot export to web [V]; large wasm payload [V]. Sim cannot be shared TS. Skip.

### Unity WebGL / Defold / Cocos
- Unity: 8 MB+ empty [V], C#. Defold/Cocos: editor-centric, Lua/own tooling, weak AI story. Skip.

## 4. Multiplayer layer

Needs: private rooms (code/link), lobby, authoritative server, reconnect <= 30 s, rematch, 2-4 players, shared TS sim.

| Option | Fit | Notes |
|---|---|---|
| **Colyseus 0.17 (Feb 6 2026) / 0.18 (Aug 20 2026)** | Best | Rooms, matchmaking, MIT, TS end-to-end. 0.17: client auto-reconnect + server `onDrop()`/`onReconnect()` [V] (maps to 30 s hold; `allowReconnection(client, 30)` pattern [K]). 0.18: client prediction/lag compensation, Schema 5 (~2.4x faster encode), client ~58 kB gz (from ~191), request/response messaging, admin console [V]. Solo maintainer [V] = bus-factor risk; frequent breaking changes. Needs long-lived Node process. |
| Plain `ws`/uWebSockets.js + own rooms | Good, more work | Max control; for 2-4 players ~300 lines (rooms, reconnect tokens, lobby). Valid minimal fallback. |
| PartyServer (PartyKit) on Cloudflare Durable Objects | Good, cheap | 1 DO = 1 room, WebSocket hibernation, idle DOs not billed for duration [V]; PartyKit acquired by Cloudflare Apr 2024, MIT [V]; paid plan min $5/mo [V]. Tick loop needs alarms/care in workerd; reconnect/lobby DIY; harder local debug; platform lock-in. |
| Nakama | Overkill | Apache-2.0, accounts/leaderboards/matchmaking [V]; heavier ops. |
| Socket.IO | Transport only | Rooms/state DIY; Colyseus better. |
| Geckos.io (WebRTC UDP) | Unneeded | Low message rate; WebSocket fine. |
| Playroom Kit | Unsuitable | Not own authoritative server [K]. |

Netcode pattern: deterministic fixed-tick sim (10-20 Hz), server authoritative. Clients send commands (`setRoute`, `cutRoute`); server broadcasts accepted commands with tick numbers + periodic snapshots/state hash; clients interpolate unit positions at 60 fps. Units follow routes, so position = f(route, spawnTick, speed): tiny bandwidth. Use Colyseus for rooms/reconnect/transport; sending messages (not Schema) is simpler and keeps sim engine-independent. Reconnect: server holds seat 30 s, resends snapshot on rejoin. Rematch: reset room state with same members.

## 5. Hosting and cost (friends-only)

| Option | Approx cost | Notes |
|---|---|---|
| Static client: Cloudflare Pages / GitHub Pages / Netlify | $0 | Vite build |
| Server on Fly.io | shared-cpu-1x 256 MB ~$2.19/mo; memory now $6/GB-mo since 2026-10-01 [V]; 512 MB-1 GB ~$3-6/mo | No free tier [V]; auto-stop possible |
| Railway Hobby | $5/mo incl. $5 usage; $20/vCPU, $10/GB-mo [V] | Easy GitHub deploy |
| Render | free sleeps; paid ~$7/mo [K] | Cold start hurts "send link and play" |
| VPS (Hetzner etc.) | ~EUR 4-5/mo [K] | Self-managed (Docker + Caddy wss) |
| Cloudflare DO (PartyServer) | $5/mo min + usage [V] | scale-to-zero |
| Colyseus Cloud | from $15/mo [V] | not needed |

Recommendation: client on Cloudflare Pages ($0) + one Colyseus Node container on Fly.io or Railway (~$3-6/mo). Total ~ $5/mo.

## 6. Assets

- Kenney (CC0): Castle Kit, 75+ objects (walls, towers, gates, flags, characters), OBJ/glTF [V] - https://kenney.nl/assets/castle-kit
- KayKit (CC0): Medieval Hexagon Pack, 200+ low-poly tiles/buildings/props, single gradient atlas [V] - https://kaylousberg.itch.io/kaykit-medieval-hexagon
- Quaternius (CC0): Universal Base Characters, Universal Animation Library (120+ anims, universal humanoid rig, GLB/FBX/Blend, Mixamo-compatible) [V] - https://quaternius.com/packs/universalanimationlibrary.html
- Poly Pizza: mixed licenses, check per model [K].
- Mixamo: free, royalty-free incl. commercial, no standalone redistribution [V]; FBX -> GLB via Blender/FBX2glTF [K]. Adobe license, not CC0; keep out of public repo.
- Synty: paid; redistribution of raw assets restricted [K]; skip.
- AI 3D (Meshy/Tripo): Meshy free = CC BY 4.0, ~10 Lite downloads/mo; Tripo free = non-commercial [V]; paid needed for clean rights; messy topology. One-off hero pieces only.
- Style tip: marchers need ~100-300 tris; decimate or use simple capsule+head figures, instanced.

Loading: Three.js `GLTFLoader` (+ Meshopt/Draco/KTX2 decoders), `AnimationMixer`; optimize with `gltf-transform` (dedupe, prune, meshopt, texture resize) via a reproducible `pnpm assets:build`. Babylon: `ImportMeshAsync`, AnimationGroups. PlayCanvas: GLB container assets.

## 7. Recommended full stack

- Tooling: TypeScript strict, pnpm workspaces, Vite, Vitest, ESLint.
- Packages: `packages/sim` (pure TS, no DOM/Three/Node APIs, fixed tick, seeded RNG, data-driven levels validated with zod, bots as pure `(state) => commands`), `packages/protocol` (commands/snapshots, zod), `apps/client`, `apps/server`.
- Renderer: Three.js vanilla; imperative render layer from interpolated snapshots; InstancedMesh for units (VAT/procedural walk), instanced/merged buildings; Raycaster for drag-to-route; one directional shadow light; route as animated-dash tube/Line2; capture effects via instanced particles (three.quarks optional); count labels via CSS2DRenderer (crisp) or SDF sprites; fixed isometric-ish perspective camera; outline/bloom/color-grade pass for polish.
- UI: DOM overlay with Preact or React (menus, lobby, level picker, HUD).
- Sim/netcode: Colyseus 0.17+ (0.18 if stable at build start) rooms + reconnect (30 s), command+snapshot messages; server runs same `packages/sim`. Solo runs sim on client (optionally Web Worker).
- Persistence: localStorage with schema version.
- Hosting: Cloudflare Pages + Fly.io/Railway container (~$5/mo).
- Assets: Kenney Castle Kit + KayKit Medieval Hexagon + Quaternius characters/animations (CC0), processed with gltf-transform; track in `assets/LICENSES.md`.
- Testing: Vitest (determinism: same seed+commands => same state hash; bots; level validation). Playwright Chromium with SwiftShader flags (`--use-gl=swiftshader` / ANGLE swiftshader, `--ignore-gpu-blocklist`) [V] for screenshots with fixed seed, paused sim, `window.__game` debug API (setTick, getState, ready flag). Multi-context Playwright tests: two players join room, create route, drop socket, reconnect < 30 s. Headless uses software GL, so CI perf numbers are not representative; do a real-GPU frame-time check separately.
- Agent workflow: CLAUDE.md + ARCHITECTURE.md; thin render layer; golden screenshots per level.

## 8. Risks and mitigations

1. Animated crowd perf: no native instanced skinning in Three.js [V]. Spike first: 2000 instanced marchers at 60 fps on integrated GPU; mitigate with VAT, stacking groups into one model with count, distance LOD.
2. Three.js assembly burden: strict architecture doc; Babylon as fallback.
3. Determinism: Math.sin/cos/pow can differ across JS engines [K]; server authoritative + snapshots tolerates it; avoid transcendentals in sim or use lookup tables.
4. Colyseus solo maintainer and fast churn (0.16 -> 0.17 -> 0.18, breaking changes [V]): pin versions, thin adapter; `ws` fallback is a small rewrite.
5. Headless WebGL relies on SwiftShader [V]; pixel diffs flaky: tolerances, fixed seeds, test-mode quality settings.
6. Asset licensing: Mixamo non-redistributable [V]; AI-gen free tiers attribution/non-commercial [V].
7. WebGPU variability: use WebGLRenderer default now, WebGPU later.
8. Hosting price changes (Fly memory price rose 2026-10-01 [V]): keep Dockerfile portable.
9. Three.js MCPs are community-grade [V]; do not depend on them.
10. "Visually rich" depends on art direction (lighting, grading, bloom, outlines), not engine; budget a polish pass.

## 9. Sources

- Engine comparison/sizes/downloads: https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison
- Versions/strengths: https://app.cinevva.com/blog/2026-06-09-web-game-engines-2026-comparison
- Three.js vs Babylon: https://app.cinevva.com/guides/threejs-vs-babylonjs ; https://www.pkgpulse.com/guides/threejs-vs-react-three-fiber-vs-babylonjs-3d-webgl-2026
- Babylon 9.0: https://forum.babylonjs.com/t/welcome-to-babylon-js-9-0/62940 ; https://babylonjs.medium.com/welcome-to-babylon-js-9-0-c3edc9ee6428
- Three.js 2026: https://www.utsubo.com/blog/threejs-2026-what-changed
- PlayCanvas: https://www.npmjs.com/package/playcanvas ; https://github.com/playcanvas/editor-mcp-server ; https://developer.playcanvas.com/user-manual/editor/mcp-server/
- Three.js/Babylon MCPs: https://github.com/DmitriyGolub/threejs-devtools-mcp ; https://github.com/deya-0x/ThreeJSMCP ; https://github.com/davidvanstory/babylonjs-mcp
- Phaser 4: https://gamefromscratch.com/phaser-4-released/ ; https://phaser.io/news/2026/04/phaser-4-renderer-faster-cleaner-and-built-for-modern-games ; https://github.com/phaserjs/phaser/releases
- Godot web: https://docs.godotengine.org/en/latest/tutorials/export/exporting_for_web.html ; https://godotengine.org/article/progress-report-web-export-in-4-3/ ; https://best-games.io/blog/godot-web-export-optimization-guide
- Colyseus: https://colyseus.io/blog/colyseus-017-is-here/ ; https://colyseus.io/blog/colyseus-018-is-here/ ; https://docs.colyseus.io/room/reconnection ; https://docs.colyseus.io/migrating/0.17
- PartyKit/Cloudflare: https://redmonk.com/kholterhoff/2024/04/26/whither-serverless-compute/ ; https://npmx.dev/package/partyserver ; https://developers.cloudflare.com/durable-objects/platform/pricing
- Multiplayer landscape: https://app.cinevva.com/guides/multiplayer-browser-game ; https://www.dragonflydb.io/game-dev/multiplayer
- Hosting: https://fly.io/docs/about/pricing/ ; https://github.com/robhunter/agentdeals/pull/2246 ; https://www.budgetforge.dev/tools/railway-pricing-2026
- Assets: https://kenney.nl/assets/castle-kit ; https://kaylousberg.itch.io/kaykit-medieval-hexagon ; https://quaternius.com/packs/universalanimationlibrary.html ; https://app.cinevva.com/guides/game-assets-guide ; https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html
- AI 3D licensing: https://www.tripo3d.ai/blog/commercial-use-ai-3d-models (vendor-authored, bias) ; https://app.cinevva.com/guides/ai-3d-model-generators
- Skinned instancing: https://discourse.threejs.org/t/optimization-of-large-amounts-100-1000-of-skinned-meshes-cpu-bottlenecks/58196 ; https://discourse.threejs.org/t/animated-instanced-skinned-meshes-gltf/41958
- Headless WebGL: https://barthpaleologue.github.io/Blog/posts/webgl-webgpu-playwright-setup/ ; https://www.createit.com/blog/headless-chrome-testing-webgl-using-playwright/

Caveats: many comparison articles are blog/vendor content (cinevva, utsubo); sizes/popularity indicative. [K] items unverified this session. Tower War / City Takeover mechanics not researched further.
