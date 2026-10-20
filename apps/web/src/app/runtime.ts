import { createPerfMetrics } from "../dev";
import { TICK_RATE } from "@node-arena/sim";
import type { SaveSettings } from "../save";
import type { LevelRuntime, RuntimeContext } from "./state";
import { Disposables } from "../render/disposables";
import { createLevelScene } from "../render/scene";
import { createTowerRenderer } from "../render/towers";
import { createTroopRenderer } from "../render/troops";
import { createLineRenderer } from "../render/lines";
import { createFxRenderer } from "../render/fx";
import { createInputController } from "../input";
/** Construction failures dispose the partially populated scope before the controller releases assets. */
export function createBrowserRuntime(
  context: RuntimeContext,
  parent: HTMLElement,
  settings: SaveSettings,
): LevelRuntime {
  const scope = new Disposables();
  try {
    const { level, manifest, session, driver } = context;
    let input: ReturnType<typeof createInputController> | undefined;
    const scene = createLevelScene({
      level,
      manifest,
      models: session.models,
      parent,
      scope,
      quality: settings.quality,
      onCanvasChange: (canvas) => input?.setCanvas(canvas),
    });
    const towers = createTowerRenderer({
      view: driver.sim.view,
      manifest,
      models: session.models,
      scene: scene.scene,
      camera: scene.camera,
      parent,
      scope,
      colorblind: settings.colorblind,
    });
    const troops = createTroopRenderer({
      sim: driver.sim,
      manifest,
      models: session.models,
      scene: scene.scene,
      scope,
      reducedMotion: settings.reducedMotion,
      palette: settings.colorblind ? "colorblind" : "default",
    });
    const lines = createLineRenderer({
      view: driver.sim.view,
      visualWidth: (id) => towers.visualWidth(id),
      manifest,
      scene: scene.scene,
      scope,
    });
    const fx = createFxRenderer({
      view: driver.sim.view,
      manifest,
      scene: scene.scene,
      scope,
    });
    input = createInputController({
      canvas: scene.canvas,
      sim: driver.sim,
      camera: scene.camera,
      scene: scene.scene,
      manifest,
      scope,
      submit: (command) => driver.submit(command),
      isEnabled: () => context.enabled() && !driver.paused,
      lines,
      palette: settings.colorblind ? "colorblind" : "default",
    });
    const resize = () => {
      towers.resize();
      input?.refresh();
    };
    window.addEventListener("resize", resize);
    scope.defer(() => window.removeEventListener("resize", resize));
    const metrics = createPerfMetrics();
    return {
      get metrics() { return metrics.snapshot(); },
      get inspection() { return { scene:scene.scene, camera:scene.camera, renderer:scene.renderer, towers, troops, lines, fx, scope }; },
      frame(update) {
        const start = performance.now();
        const seconds = (update.sim.tick + update.alpha) / TICK_RATE;
        towers.animate(seconds);
        troops.update(update.alpha, seconds);
        lines.update(seconds, troops);
        fx.update(seconds);
        input?.refresh();
        scene.render();
        metrics.frame(start,performance.now()-start+(update.preparationMs??0),driver.lastStepMs,scene.renderer.info.render.calls,scene.renderer.info.render.triangles,
          troops.count);
      },
      tick(update) {
        towers.update(update.sim.view);
        lines.consumeEvents(update.events, update.sim.view);
        fx.consumeEvents(update.events, update.sim.view);
        input?.refresh();
      },
      settings(value) {
        scene.setQuality(value.quality);
        towers.update(driver.sim.view, { colorblind: value.colorblind });
        const palette = value.colorblind ? "colorblind" : "default";
        troops.setPalette(palette);
        lines.setPalette(palette);
        fx.setPalette(palette);
        troops.setReducedMotion(value.reducedMotion);
        lines.setReducedMotion(value.reducedMotion);
        fx.setReducedMotion(value.reducedMotion);
        input?.setPalette(palette);
        scene.render();
      },
      refresh() {
        input?.refresh();
      },
      cancel() {
        return input?.cancel() ?? false;
      },
      dispose() {
        scope.dispose();
      },
    };
  } catch (error) {
    scope.dispose();
    throw error;
  }
}
