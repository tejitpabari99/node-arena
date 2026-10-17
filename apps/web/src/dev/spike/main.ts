import { AmbientLight, DirectionalLight, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { createTroopGeometry, createTroopMaterial, distribution, writeInstances } from './troops.js';
import type { AnimationMode } from './troops.js';

const parameters = new URLSearchParams(location.search);
const requestedMode = parameters.get('mode') ?? 'bob';
if (!['bob', 'static-bob', 'none'].includes(requestedMode)) throw new Error('Invalid animation mode');
const mode = requestedMode as AnimationMode;
const warmup = 30;
const samples = 120;
const renderer = new WebGLRenderer({ canvas: document.querySelector<HTMLCanvasElement>('#spike')!, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(640, 360);
renderer.setClearColor(0x18202c);
const scene = new Scene();
const camera = new PerspectiveCamera(45, 640 / 360, 0.1, 100);
camera.position.set(0, 28, 30);
camera.lookAt(0, 0, 0);
scene.add(new AmbientLight(0xffffff, 1));
const sun = new DirectionalLight(0xffffff, 2);
sun.position.set(4, 10, 6);
scene.add(sun);
const clock = { value: 0 };
const meshes = Array.from({ length: 4 }, (_, bucket) => {
  const geometry = createTroopGeometry();
  // Two distinct primitive visual proportions; both remain within the same triangle budget.
  if (bucket >= 2) geometry.scale(1.2, 0.8, 1.2);
  const pose = new InstancedBufferAttribute(new Float32Array(500 * 4), 4).setUsage(DynamicDrawUsage);
  geometry.setAttribute('troopPose', pose);
  const mesh = new InstancedMesh(geometry, createTroopMaterial(bucket % 2 ? 0xf0a755 : 0x64b9ee, mode, clock), 500);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  scene.add(mesh);
  return { mesh, pose };
});
const updateMs: number[] = [];
const submissionMs: number[] = [];
const jsMs: number[] = [];
const frameMs: number[] = [];
let frame = 0;
let previous: number | undefined;
let started: number | undefined;
const gl = renderer.getContext();
const debug = gl.getExtension('WEBGL_debug_renderer_info');
const environment = {
  userAgent: navigator.userAgent,
  renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string : gl.getParameter(gl.RENDERER) as string,
  width: 640, height: 360, dpr: 1, troopCount: 2000, buckets: 4,
  trianglesPerTroop: meshes[0]!.mesh.geometry.index!.count / 3,
};
function tick(timestamp: number) {
  const begin = performance.now();
  clock.value = timestamp / 1000;
  for (const [bucket, entry] of meshes.entries()) writeInstances(entry.pose, 500, clock.value, bucket);
  const updated = performance.now();
  renderer.render(scene, camera);
  const submitted = performance.now();
  if (frame >= warmup) {
    started ??= timestamp;
    updateMs.push(updated - begin);
    submissionMs.push(submitted - updated);
    jsMs.push(submitted - begin);
    if (frame > warmup && previous !== undefined) frameMs.push(timestamp - previous);
  }
  previous = timestamp;
  frame++;
  if (frame < warmup + samples) {
    requestAnimationFrame(tick);
    return;
  }
  const report = {
    mode, environment, warmupFrames: warmup,
    updateMs: distribution(updateMs), renderSubmissionMs: distribution(submissionMs),
    jsMs: distribution(jsMs), frameMs: distribution(frameMs),
    // 119 intervals between 120 measured rAF starts, excluding warmup interval.
    fps: (samples - 1) * 1000 / (timestamp - started!),
    drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
  };
  Object.assign(window, { __troopSpike: report });
  document.querySelector('#results')!.textContent = JSON.stringify(report, null, 2);
}
requestAnimationFrame(tick);
