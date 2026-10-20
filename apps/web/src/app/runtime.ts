import { createPerfMetrics } from "../dev";
import { TICK_RATE } from "@node-arena/sim";
import type { SaveSettings } from "../save";
import type { LevelRuntime, RuntimeContext } from "./state";
import { Disposables } from "../render/disposables";
import { createLevelScene } from "../render/scene";
import { createTowerRenderer } from "../render/towers";
import { createTroopRenderer, troopSizeFactor } from "../render/troops";
import { roofNumberPx } from "../render/roof-texture";
import { parseLodMode } from "../render/troop-lod";
import { createLineRenderer } from "../render/lines";
import { createFxRenderer } from "../render/fx";
import { createBrawlRenderer } from "../render/brawl";
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
      roofNumberPx: roofNumberPx(level.id),
      colorblind: settings.colorblind,
    });
    const troops = createTroopRenderer({
      sim: driver.sim,
      manifest,
      models: session.models,
      scene: scene.scene,
      scope,
      sizeFactor: troopSizeFactor(level.id, level.towers.filter((t) => t.owner >= 0).map((t) => towers.visualWidth(t.id) ?? NaN)),
      reducedMotion: settings.reducedMotion,
      palette: settings.colorblind ? "colorblind" : "default",
      now: () => performance.now(),
      lod: parseLodMode(new URLSearchParams(window.location.search).get("lod")), // ?lod=low|high forces a set (visual harness); default auto
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
    const brawl = createBrawlRenderer({
      view: driver.sim.view,
      manifest,
      scene: scene.scene,
      scope,
      lines,
      figureHeight: troops.meshes[0]?.userData.heightWorld as number | undefined,
      reducedMotion: settings.reducedMotion,
      palette: settings.colorblind ? "colorblind" : "default",
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
      get inspection() { return { scene:scene.scene, camera:scene.camera, renderer:scene.renderer, towers, troops, lines, fx, brawl, scope }; },
      frame(update) {
        const start = performance.now();
        const seconds = (update.sim.tick + update.alpha) / TICK_RATE;
        towers.animate(seconds);
        troops.update(update.alpha, seconds);
        lines.update(seconds, troops);
        brawl.update(seconds, scene.camera, troops);
        fx.update(seconds);
        input?.refresh();
        scene.render();
        metrics.frame(start,performance.now()-start+(update.preparationMs??0),driver.lastStepMs,scene.renderer.info.render.calls,scene.renderer.info.render.triangles,
          troops.count);
      },
      tick(update) {
        towers.update(update.sim.view);
        lines.consumeEvents(update.events, update.sim.view);
        brawl.consumeEvents(update.events, update.sim.view);
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
        brawl.setPalette(palette);
        troops.setReducedMotion(value.reducedMotion);
        lines.setReducedMotion(value.reducedMotion);
        fx.setReducedMotion(value.reducedMotion);
        brawl.setReducedMotion(value.reducedMotion);
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
