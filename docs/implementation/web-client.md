# Web client

Implementation map for contributors changing browser behaviour. [Architecture](../architecture.md) shows workspace boundaries; [mission](../mission.md) defines scope.

## Runtime and presentation

[App state](../../apps/web/src/app/state.ts) loads content and the manifest; [runtime](../../apps/web/src/app/runtime.ts) connects the simulation view to Three.js rendering, input and events. Preact owns picker, dialogs, HUD and online forms. The [world renderer](../../apps/web/src/render/world.ts) supplies projected building anchors and one mirrored world root for imported art.

Local matches use [GameDriver](../../apps/web/src/driver/index.ts) for fixed stepping, bot commands, pause and speed. Online matches use [NetDriver](../../apps/web/src/driver/net-driver.ts) and the [PvP controller](../../apps/web/src/pvp/controller.ts), stepping server tick batches and rebuilding for catch-up. Presentation interpolation never chooses simulation outcomes.

## Picking and cutting

[Input wiring](../../apps/web/src/input/index.ts) tries mesh selection before ground fallback. [Pick geometry](../../apps/web/src/input/geometry.ts) adds a 0.35-world-unit margin to the footprint radius, giving the standard 1.10 radius for the current 1.5-wide footprints; projected selection has a 22 CSS-pixel floor. Nearest projected center resolves overlapping fallback candidates. Non-owned selections retain their ignored-press behaviour.

The [gesture machine](../../apps/web/src/input/gestures.ts) separates pending draw, draw, pending cut, cut and hold eraser. The touch draw delay is 200 ms and eraser hold is 700 ms; swipe cut uses the existing screen-space tolerance. The [cut ribbon](../../apps/web/src/input/trail.ts) uses fixed buffers for up to 128 points and two camera-facing strips in one mesh. Points fade for 250 ms, including after release; reduced motion uses a 60 ms fade and suppresses the glow layer. These are presentation/input values, while [minimum building spacing](../reference/balance-values.md) is shared authored content under R-ENT-05.

## HUD, results and local storage

[Online HUD](../../apps/web/src/ui/pvp/PvpHud.tsx) displays pause holds and Time left for timed matches. Confirmed Leave routes to the existing quit/forfeit flow for active seats; spectators/eliminated seats leave directly. [Result rows](../../apps/web/src/ui/pvp/PvpResult.tsx) group players by team and show building/troop counts, or Eliminated, without a rank column. Attribution lives in the [credits reference](../reference/credits.md); there is no Credits UI.

The [save store](../../apps/web/src/save/index.ts) stores current-format campaign completion and four audio preferences locally. Per-tab PvP identity lives in session storage; nickname storage is shared, as defined by [identity handling](../../apps/web/src/net/identity.ts).

## Local editor and testing

The [editor entry](../../apps/web/src/editor/main.tsx) is enabled for development/test builds. Filesystem/process middleware stays local and development-only; Save writes validated authored content, while Finalize runs the version/lock/golden workflow. The editor shares catalog spacing checks and blocks invalid placement/movement. See [level authoring](level-import.md#4-author-an-original-level) and [browser verification](../testing/e2e-and-campaign-verify.md).
