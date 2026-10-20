import { loadContent, type ContentFileMap, type CompiledLevel } from '@node-arena/content';
import { createReplayRecorder, playReplay, type Command, type ReplayRecorder, type SimEvent } from '@node-arena/sim';
import { TICK_RATE } from '@node-arena/sim';
import { Color, Mesh, ShaderMaterial, Vector3, type Scene, type WebGLRenderer } from 'three';
import { buildVisualProbe, type HarnessRendererHooks } from './probe';
import type { AppController } from '../app/state';
import { strength } from '../ui/strength';
import type { createTowerRenderer } from '../render/towers';
import type { createFxRenderer } from '../render/fx';
import type { PerspectiveCamera } from 'three';
import type { createLineRenderer } from '../render/lines';
export function createTestHarness(files: ContentFileMap) {
  loadContent(files);
  const metadata = JSON.parse(files['content.json'] as string);
  let level: CompiledLevel, recorder: ReplayRecorder;
  const events: SimEvent[] = [];
  const retired: WebGLRenderer[] = [];
  return {
    createSim(compiled: CompiledLevel, seed: number) {
      level = compiled; recorder = createReplayRecorder(compiled, seed, metadata); events.length = 0;
      return recorder;
    },
    connect(app: AppController) {
      app.subscribeEvents(update => events.push(...update.events));
      const inspect = () => app.runtime!.inspection as {
        renderer: WebGLRenderer; camera: PerspectiveCamera; scene: Scene; lines: ReturnType<typeof createLineRenderer>;
        towers: ReturnType<typeof createTowerRenderer>; fx: ReturnType<typeof createFxRenderer>; troops: unknown;
      };
      /** Renderer modules may expose optional `settle()` / `advance(dt)` (see probe.ts); v1 modules define neither. */
      let savedBackground: { value: Scene['background'] } | undefined;
      const hooks = (): HarnessRendererHooks[] => { if (!app.runtime) return []; const i = inspect(); return [i.towers, i.troops, i.lines, i.fx] as HarnessRendererHooks[]; };
      const render = ({ settle = true }: { settle?: boolean } = {}) => {
        if (settle) for (const module of hooks()) module.settle?.();
        return app.driver?.step(0);
      };
      /** Renderer-local timers advance by a fixed dt per stepped tick, never by wall clock. */
      const step = (n = 1) => {
        const timed = hooks().filter(module => typeof module.advance === 'function');
        if (!timed.length) return app.step(n);
        let steps = 0;
        for (let i = 0; i < n; i++) { const done = app.step(1); if (!done) break; steps += done; for (const module of timed) module.advance!(1 / TICK_RATE); }
        return steps;
      };
      return {
        step, hash: () => app.driver?.sim.hash(),
        get view() { return app.driver?.sim.snapshot(); },
        get events() { return events; },
        get screen() { return app.snapshot().screen; },
        async load(id: string, seed?: number) { savedBackground = undefined; if (app.runtime) retired.push(inspect().renderer); await app.startLevel(id, seed); },
        menu() { if (app.runtime) retired.push(inspect().renderer); app.menu(); },
        submit: (cmd: Command) => app.driver?.submit(cmd),
        /** SP05 HUD harness: pause like the Pause button / Esc (screen becomes `paused`). */
        pause() { app.pause(); },
        /** SP05 HUD harness (H06): the pure `strength()` of the current view, for comparing with the meter segments. */
        strength() { return strength(app.driver!.sim.view, { colorblind: app.snapshot().save.settings.colorblind }); },
        render,
        replay() { const record = recorder.record(); const result = playReplay({ level, metadata }, record); return { ok: result.ok, hash: result.sim.hash(), record }; },
        project(id: string) {
          const tower = app.driver!.sim.view.towerStatic[app.driver!.sim.view.ids.towers.indexOf(id)]!;
          const canvas = inspect().renderer.domElement.getBoundingClientRect();
          const p = new Vector3(tower.x / 1000, 0, tower.y / 1000).project(inspect().camera);
          return { x: canvas.x + (p.x + 1) * canvas.width / 2, y: canvas.y + (1 - p.y) * canvas.height / 2 };
        },
        presentation() {
          const preview = inspect().scene.children.find(node => node instanceof Mesh && node.userData.inputPreview === true);
          return {
            inputPreview: preview instanceof Mesh && preview.material instanceof ShaderMaterial
              ? { visible: preview.visible, color: (preview.material.uniforms.colA!.value as Color).getHexString() } : null,
            lines: inspect().lines.meshes.map(mesh => ({ color: mesh.material.uniforms.team!.value.getHexString() as string })),
            towers: inspect().towers.towers.map(t => ({ modelScale: t.model.scale.x, color: t.base.material.color.getHexString(), glyph: t.roofMarker.userData.glyph })),
            fx: inspect().fx.meshes.filter(m => m.visible).map(m => ({ position: m.position.toArray(), opacity: m.material.opacity })) };
        },
        memory() { return { current: app.runtime ? { ...inspect().renderer.info.memory } : null, retired: retired.map(r => ({ ...r.info.memory, contextLost: r.getContext().isContextLost() })), labels: document.querySelectorAll('[data-tower-index]').length, summaries: document.querySelectorAll('[data-tower-summary]').length, canvases: document.querySelectorAll('#arena canvas').length }; },
        async sample(count = 120) {
          const values: number[] = [], calls: number[] = [];
          for (let i = 0; i < 20; i++) render();
          for (let i = 0; i < count; i++) {
            // Give software GL its frame; measure actual complete driver/tick/render CPU work.
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            const start = performance.now(); app.step(1); values.push(performance.now() - start);
            calls.push(inspect().renderer.info.render.calls);
          }
          const sorted = [...values].sort((a,b) => a-b);
          return { values, calls, p95: sorted[Math.ceil(sorted.length * .95)-1], troops: app.driver!.sim.snapshot().channels.reduce((n,c) => n+c.troops.length,0), memory: this.memory() };
        },
        /** Plain-JSON scene probe (PRD SP01 "Probe"); rects in CSS px of the canvas viewport. */
        visualProbe() {
          const { scene, camera, renderer, fx } = inspect(), canvas = renderer.domElement.getBoundingClientRect();
          const clear = scene.background instanceof Color ? scene.background : renderer.getClearColor(new Color());
          return buildVisualProbe({ scene, camera, view: app.driver!.sim.view, events, viewport: { w: canvas.width, h: canvas.height }, clearColor: `#${clear.getHexString()}`,
            hasCard: i => document.querySelector(`[data-tower-index="${i}"]`) !== null, fx: fx.meshes });
        },
        /** M07 magenta pass (SP01): force the scene clear/background colour; `null` restores the theme background. */
        clearColor(hex: string | null) {
          const { scene } = inspect();
          if (hex === null) { if (savedBackground) { scene.background = savedBackground.value; savedBackground = undefined; } return; }
          savedBackground ??= { value: scene.background };
          scene.background = new Color(hex);
        },
        /** renderer.info.render of the last rendered frame (M13 drawCalls). */
        renderInfo() { const { calls, triangles } = inspect().renderer.info.render; return { calls, triangles }; },
        settings: (patch: Parameters<AppController['updateSettings']>[0]) => app.updateSettings(patch),
      };
    },
  };
}
export type TestApi = ReturnType<ReturnType<typeof createTestHarness>['connect']>;
declare global { interface Window { __na?: TestApi } }
