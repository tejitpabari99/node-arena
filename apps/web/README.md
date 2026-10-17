# Web client

SP03 Task 1 scaffold: an empty boot screen imports the public content and simulation APIs, compiles the current authored sample, and constructs a deterministic simulation. Three.js is linked for the renderer tasks. No gameplay loop or bot driver runs yet.

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm --filter @node-arena/web test
pnpm --filter @node-arena/web build
pnpm --filter @node-arena/web exec playwright install chromium
pnpm test:web:e2e
pnpm --filter @node-arena/web test:e2e:dev
```

The Vite and TypeScript configurations resolve only the packages' public entrypoints from source, allowing clean-checkout dev/tests without dependency builds and enabling HMR. Package internals stay private. `assets/` is Vite's public directory; files such as the later `manifest.json` are served at `/manifest.json` and copied into the production build.

- `src/app/` — boot probe and state boundary.
- `src/driver/` — fixed-step driver (later task).
- `src/render/` — scene, towers, troops, lines, labels, effects and camera. Visual keys must resolve via the manifest; sim columns and component names must resolve via registries. No archetype/troop ids here.
- `src/input/` — pointer gestures; the same registry boundary applies.
- `src/manifest/` — browser loader/key resolution and a separate Node-only validator.
- `src/{ui,audio,save,dev}/` — later SP03 modules.
- `assets/{models,audio}/` — asset locations; `manifest.json` currently uses budgeted primitives and the existing sample content's visual/theme keys. SP05 supplies final art.
- `test/` — Vitest smoke tests; `e2e/` — Chromium boot checks against production preview by default, or dev server via `test:e2e:dev`.

Playwright uses Chromium's SwiftShader software GL flags. Its browser test checks actual content compilation and sim construction without Node globals. SP04 production bots and SP05 campaign/art remain external dependencies; the existing sample data is sufficient for this scaffold.

The isolated Task 2 performance harness is `/spike.html?mode=bob` (also `static-bob` or `none`) in dev and production preview. It renders 2,000 primitive troops across four visual × team meshes, then displays measured JS distributions, rAF pacing, draws and triangles. Reproduce it with `pnpm --filter @node-arena/web exec playwright test e2e/spike.spec.ts --workers=1` after building. Software GL fps does not establish laptop GPU performance; see [the committed spike report](../../docs/agent_files/feat-game-design-20261006-0617/03-web-client/spike-2026-10-08.md) for results and the remaining owner check.

Manifest API (SP03 Task 3):

- Browser code imports `loadManifest`/`parseManifest` from `src/manifest/load.ts` and `createManifestResolver` from `src/manifest/resolve.ts`. Loading retries transport failures twice; schema/reference failures throw typed `ManifestError`; transport/JSON failures use `AssetError {key, src, cause}`. The resolver exposes `visual(key, expectedKind?)`, `model`, `theme`, `color(key, palette)`, `marker`, `event`, `camera`, and `resolveLevelAssets(compiledLevel)` returning sets of visual/model/audio/source keys. An unmapped sim event has no presentation effect. Palette names are `default` and `colorblind`.
- Audio convention: every `sfx` string is its relative audio source path (for example `audio/captured.wav`), since SP01 defines no separate audio map. The downstream audio loader must use the same convention. Greybox events omit audio. `fx` ids use the generic `BUILTIN_FX` registry (`pulse`, `puff`, `spark`); renderer implementations register those effects without archetype ids.
- Primitive renderers must use `PRIMITIVE_SEGMENTS` for budget parity: capsule cap 2/radial 6, cylinder radial 8, and unsegmented boxes. Capsule size uses Three.js radius/length in its first two entries; cylinder size uses top radius/height/bottom radius. Runtime applies visual scale and offsets, and centres the primitive at its base.
- SP04 imports **only in Node** `validateManifest` from `src/manifest/validate.ts`. Call `validateContent(fileMap, {manifest})` first to cross-check content visual/theme keys and palette colours, then `await validateManifest(manifest, {assetsDir, credits})`, where `credits` is CREDITS.md text. The latter validates schema/internal references, every model and audio file, external glTF buffer/image files, credit entries, actual default-scene triangle totals (all merged primitives and repeated mesh nodes), and PNG/JPEG/WebP/KTX2 dimensions. Limits are troop 300 triangles, tower/props 5,000, textures 1,024 on each axis. Shared models use the stricter applicable budget; unused models receive the tower budget. Embedded buffers/images are covered by the model's credit entry. File paths reject traversal/URLs and symlinks escaping the asset root. Draco models and uninspectable image formats fail closed; use ordinary glTF/GLB with inspectable buffers. Primitive-only greybox requires no asset credits.
- Keep the Node validator out of browser imports/barrels; it uses Node filesystem APIs. The `check:manifest` command belongs to SP04 and is not implemented here.

Asset/resource API (SP03 Task 6):

- `AssetManager(manifest, options?)` in `src/manifest/assets.ts` owns an application-lifetime cache keyed by source. `resolveLevelAssets(level)` returns the resolver keyset; `createSession(keyset)` creates a level lease. `await session.load()` loads model/audio sources concurrently with two retries per source; GLTFLoader uses MeshoptDecoder, and audio uses WebAudio decoding. `session.models` maps model keys to base-centred `Object3D`; `session.audio` maps relative audio paths to `AudioBuffer`. Multiple keys/sessions for the same source share one pending load and resource.
- `session.state` is `idle|loading|ready|error|disposed`; `session.failures` contains typed `AssetError {key,src,cause}`. Loading resolves even on asset errors: the UI reads this contract to show failed assets, calls `await session.retryFailed()` for Retry, and calls `session.dispose()` for Back to menu. Successful sources stay leased through Retry. Disposal cancels publication of stale pending results and eventually frees their resources; failed promises are evicted. Task 12 wires the error screen.
- `Disposables` in `src/render/disposables.ts` has `add(resource)`, `defer(cleanup)`, `object(ownedObject)`, `material(ownedMaterial,textures=true)`, `label(element)`, and idempotent `dispose()`. `object()` frees geometry, material, textures and instanced buffers, and removes its root from the scene. Register only resources the scope owns.
- `createPrimitiveModel(model)` uses budgeted tessellation and a base-centre pivot. Default GLTF loads use `normalizeModel(scene)` to wrap their default scene at that pivot. `cloneModel(cachedModel,scope)` in `src/render/model.ts` returns a tower/prop scene clone with owned materials and scope-owned geometry/texture wrappers. `mergeModel(cachedModel,teamMaterial,scope)` returns owned `{geometry,materials,hasTeamMaterial}` for troop instancing, baking mesh transforms and adding a `teamMask` vertex attribute. Material groups preserve GLTF material/texture splits; no matching material returns `hasTeamMaterial:false` for a team-coloured base fallback. Static mesh models are supported; skinned models are rejected.
- Dispose the render scope **before** the asset session on restart/level change. Never register a cached model or its shared geometry/textures as owned level resources. Merged geometry/materials belong to their provided scope; their texture wrappers are also scope-owned; owner bucket material clones borrow those wrappers. `manager.dispose()` releases all sessions/resources and closes an internally created audio context at application end; injected contexts remain caller-owned. Idle cache retention defaults to eight successfully decoded CPU sources in LRU order; explicit `maxIdle:0` releases sources immediately. Active sources never count toward that idle bound. Restart and same-source level switches reuse decoded models/audio without transport or decoding. Geometry and texture wrappers are memoized per scope (50 tower clones share one wrapper), so cached CPU originals never acquire WebGL renderer listeners. Texture wrappers share decoded `Source`/image data and dispose without closing that borrowed data. Active/pending leases are refcounted independently of idle retention. Cancelled unfinished loads are removed and late values freed.
- Verify isolated real-browser loading and lifetime with `WEB_TEST_SERVER=dev pnpm --filter @node-arena/web exec playwright test e2e/assets.spec.ts --workers=1`. It forces audio transport failure, verifies three attempts and failed-only Retry, decodes a real WAV, loads a real embedded-buffer glTF, and checks GPU memory returns to its warmed baseline after 20 switches. Three.js's lazy fallback environment texture is renderer-owned and included in that baseline. Source-import tests run on Vite development mode; production acceptance exercises the wired application. `e2e/cache-regressions.spec.ts` exercises the actual application controller/runtime with real textured GLB and WAV, disables transport after warming, and proves restart plus twenty shared-source switches reuse one fetch/decode while retired contexts free their scope resources.


Task 15 acceptance harness: `/?test=1` uses seed 1, disables the driver's rAF loop,
and exposes `window.__na.step(n)`, `hash()`, and a serializable `view`. The API is
absent for normal URLs. Query-gated fixture files (`&fixture=normal|capture|victory|cut|timeout|stress|visual`)
are authored content validated/compiled through the real controller, with twenty
selectable arenas. They are test campaign data, not the SP05 campaign. GLB test
assets are synthetic route responses; production manifest/art is unchanged.

`pnpm test:web:all` builds once, then runs every browser test against preview and
dev sequentially, with one worker and SwiftShader. Acceptance scenes use real
shell DOM, pointer gestures, driver replay recording, asset loaders, and full
render scopes in both servers. Screenshot baselines use <=1% pixel tolerance at
960x600/DPR1/low; stress/lifetime uses 640x360/DPR1/low and at least 2,000 actual
simulation troops. CPU samples include one fixed step, app subscribers, renderer
updates, and WebGL submission; JSON attachments contain every raw sample and draw
count. Software-GL pacing is not a real-GPU laptop 60fps sign-off.

Leak assertions compare equally warmed scenes after line cuts, census window/
document/canvas listeners and pending rAF, and inspect all retired renderers plus
menu DOM. The Three.js renderer-owned fallback environment texture remains in
retired `renderer.info.memory` as one texture; geometry counts return to zero and
those contexts are explicitly lost. This known internal count is distinct from
leaked application textures. SP04 bots, SP05 CC0 art/campaign, and laptop owner
playtest remain their respective later/manual work.

## Slice verification (owner-run)

Opt-in evidence for slice approval (SP05 Task 10 / Acceptance 7). Not part of default e2e runs: the spec `e2e/slice.spec.ts` is skipped unless `SLICE=1`.

```sh
pnpm slice:verify                      # from repo root: build + run at 1920x1080 with the shipped (real-art) manifest
SLICE_OUT=/some/dir pnpm slice:verify  # optional output dir (default apps/web/test-results/slice/, uncommitted)
SLICE_RUN_MS=4000 SLICE_PERF_MS=10000  # optional: pre-capture run time / perf sampling window
# headed, real GPU (recommended for the 60 fps judgement): cd apps/web && pnpm build:test && SLICE=1 pnpm exec playwright test e2e/slice.spec.ts --headed
```

For L1 (01-first-steps), L10 (10-two-foes) and L18 (18-free-for-all), each in default and colourblind palettes, it writes `<level>.<palette>.png` and `<level>.<palette>.labels.json`, and asserts count-label chips (and their text) are >= 14 px and that each seat colour has one distinct marker (>= seat count of distinct colours). For L18 it also writes `18-free-for-all.<palette>.perf.json` (+ `.perf.png`): rAF frame-time p50/p95/p99/max, mean fps, and the SP03 perf HUD text. The 60 fps call is the owner's; the spec only records it (software GL is far slower than a laptop GPU).
