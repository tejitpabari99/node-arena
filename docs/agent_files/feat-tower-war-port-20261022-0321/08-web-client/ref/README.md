# Task 1 — landscape frame check

## Sources

- `L04.jpg`: byte-for-byte copy of `docs/agent_files/feat-tower-war-port-20261022-0321/ref/tw-yt/L04.jpg`. Owner-supplied Tower War video reference, indexed in that folder's `INDEX.md`; original `4.png`, pre-start LEVEL 4. Source provenance/Drive/playlist links remain in that index.
- `soldier-default-vs-icon.png`: byte-for-byte copy of the SP07 `ref/proto-check/soldier-default-vs-icon.png` validation sheet. Top row PROTO (wrong handedness); bottom RAW candidate (accepted); icon on left. This is a renderer validation sheet, not an original video screenshot.

## Outputs and comparison

`out/l4-<width>x<height>.jpg` uses the real SP08 `createLevelScene`, real SP07 world renderer, real L4 sim at tick45 with scripted opening lines. Device DPR3 is capped at2; screenshots saved at CSS resolution for size. `out/l4-unit.png` is a native browser screenshot clip of the blue soldier at1600x900. `frame-check.json` records the six viewport checks; `weapon-check.json` records production GLB handedness/weapon validation.

Inspected L4 and source reference side-by-side. With the required portrait-to-landscape data rotation, blue at bottom becomes left, red at top becomes right; the lower-left neutral becomes upper-left and upper-right neutral becomes lower-right. The pagoda is above/right of blue. Layout is rotated once, never reflected across x. Labels read normally outside `worldRoot`; geometry is inside its sole z mirror. Soldier crop is consistent with accepted RAW/icon weapon placement; production GLB checks under the z mirror give right-hand dot+0.293 and muzzle side-1 (pass), including Run frame0.

All visible building mesh vertices and the four screen-facing corners of each label stay inside left/right36px, top104px, bottom64px at1280x720,1600x900,1920x1080,1366x768,2560x1080,1024x768. Resize keeps the canvas/scene/root, with one canvas throughout and labels as an unmirrored scene sibling. No page errors; disposal removes the canvas. Bounds include public sim bounds and building/label anchors; camera loads no models.

Known SP07 visual differences persist: no border dressing/ground shadow blobs, darker grass. Actual HUD is a later task; these captures reserve its edges. L4 source is pre-start; our tick45 proof adds labels/units/lanes to demonstrate frame handedness. No claim of pixel equality or owner visual approval. Legacy shell remains parked until its SP08 replacement tasks.

## Repeat

From repository root:

```sh
pnpm --filter @node-arena/web exec vitest run test/sp07 test/sp08
pnpm --filter @node-arena/web exec tsc -p tsconfig.sp08.json
node tools/assets/capture/check-frame.mjs docs/agent_files/feat-tower-war-port-20261022-0321/08-web-client/ref/out
pnpm --filter @node-arena/web exec vite build --config ../../tools/assets/capture/vite.config.mjs --outDir /tmp/sp08-capture-build
```

The standalone Vite capture harness bypasses the stale shell. Full client build/test gates remain parked; root full CI is recorded by the orchestrator. To repeat the GLB checks, call `analyze('apps/web/assets/models/tw/soldier.glb',{hands:true,weaponIcon:true})` from `tools/assets/validate/analyze.mjs`; require both `checks.handedness.pass` and `checks.weaponSide.pass`.

TDD evidence: initial camera import failed on the deleted `tower-mesh.js`; after isolating the math, HUD projection tests failed at all six sizes (e.g.1280x720 bottom687.97 >656), then passed with screen-space fitting/view offset. Tiny-host test failed with center x=-16, passed after margin scaling. Off-centre label test failed before anchor-envelope inclusion. Overlay test failed on the removed `view.tower.slots` before using public building columns. Final SP07+SP08 suite:95 passed; SP08 typecheck and targeted ESLint:exit0.
