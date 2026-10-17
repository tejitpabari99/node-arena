import { loadContent, type ContentFileMap, type CompiledLevel } from '@node-arena/content';
import { createReplayRecorder, playReplay, type Command, type ReplayRecorder, type SimEvent } from '@node-arena/sim';
import { Mesh, MeshBasicMaterial, Vector3, type Scene, type WebGLRenderer } from 'three';
import type { AppController } from '../app/state';
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
        towers: ReturnType<typeof createTowerRenderer>; fx: ReturnType<typeof createFxRenderer>;
      };
      const render = () => app.driver?.step(0);
      return {
        step: (n = 1) => app.step(n), hash: () => app.driver?.sim.hash(),
        get view() { return app.driver?.sim.snapshot(); },
        get events() { return events; },
        get screen() { return app.snapshot().screen; },
        async load(id: string) { if (app.runtime) retired.push(inspect().renderer); await app.startLevel(id); },
        menu() { if (app.runtime) retired.push(inspect().renderer); app.menu(); },
        submit: (cmd: Command) => app.driver?.submit(cmd),
        render,
        replay() { const record = recorder.record(); const result = playReplay({ level, metadata }, record); return { ok: result.ok, hash: result.sim.hash(), record }; },
        project(id: string) {
          const tower = app.driver!.sim.view.towerStatic[app.driver!.sim.view.ids.towers.indexOf(id)]!;
          const canvas = inspect().renderer.domElement.getBoundingClientRect();
          const p = new Vector3(tower.x / 1000, 0, tower.y / 1000).project(inspect().camera);
          return { x: canvas.x + (p.x + 1) * canvas.width / 2, y: canvas.y + (1 - p.y) * canvas.height / 2 };
        },
        presentation() {
          const preview = inspect().scene.children.find(node => node instanceof Mesh && node.renderOrder === 3);
          return {
            inputPreview: preview instanceof Mesh && preview.material instanceof MeshBasicMaterial
              ? { visible: preview.visible, color: preview.material.color.getHexString() } : null,
            lines: inspect().lines.meshes.map(mesh => ({ color: mesh.material.uniforms.team!.value.getHexString() as string })),
            towers: inspect().towers.towers.map(t => ({ modelScale: t.model.scale.x, color: t.base.material.color.getHexString(), glyph: t.roofMarker.userData.glyph, label: t.label?.element.textContent })),
            fx: inspect().fx.meshes.filter(m => m.visible).map(m => ({ position: m.position.toArray(), opacity: m.material.opacity })) };
        },
        memory() { return { current: app.runtime ? { ...inspect().renderer.info.memory } : null, retired: retired.map(r => ({ ...r.info.memory, contextLost: r.getContext().isContextLost() })), labels: document.querySelectorAll('[data-tower-index]').length, canvases: document.querySelectorAll('#arena canvas').length }; },
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
        settings: (patch: Parameters<AppController['updateSettings']>[0]) => app.updateSettings(patch),
      };
    },
  };
}
export type TestApi = ReturnType<ReturnType<typeof createTestHarness>['connect']>;
declare global { interface Window { __na?: TestApi } }
