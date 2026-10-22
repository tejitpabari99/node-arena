// Turntable page. window.renderShot(opts) draws one view on the canvas; the runner screenshots it.
// opts: { glb, yaw, pitch, mirror, color: 'srgb'|'gamma', stage, stageNodes, tex, w, h, bg, pose, fov, hideInactive }
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createMirroredWorldRoot } from './world-root.js';

const canvas = document.createElement('canvas');
document.body.append(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const load = url => loader.loadAsync(url); // no cache: pose/texture overrides mutate the scene

function applyColor(gltf, color) {
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const m = o.material;
    if (!m.isMeshLambertMaterial) o.material = new THREE.MeshLambertMaterial({ map: m.map }); // R4: Mobile/Diffuse -> Lambert
    if (m.map) m.map.colorSpace = color === 'gamma' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    m.map && (m.map.needsUpdate = true);
  });
}

window.renderShot = async o => {
  const { w = 512, h = 512, yaw = 0, pitch = 20, mirror = true, color = 'srgb', bg = 0x6f9a3a, fov = 30 } = o;
  renderer.setSize(w, h, false);
  // gamma = Unity "gamma colour space": raw texels, no output encode. srgb = linear workflow.
  renderer.outputColorSpace = color === 'gamma' ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
  const gltf = await load(o.glb);
  const model = gltf.scene;
  if (o.tex) {
    const t = await texLoader.loadAsync(o.tex);
    t.flipY = false; // glTF UV convention (v down), same as the GLB's embedded texture
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    model.traverse(n => { if (n.isMesh) { n.material = n.material.clone(); n.material.map = t; } });
  }
  if (o.clip) {
    // Pose at time `t` of the clip whose name ends with `o.clip` (e.g. "Run"); bind pose otherwise.
    const clip = gltf.animations.find(a => a.name.endsWith(o.clip));
    if (!clip) throw new Error(`no clip ${o.clip}`);
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(clip).play();
    mixer.setTime(o.t ?? 0);
  }
  applyColor(gltf, color);
  // Visibility: honour prefab-inactive nodes; optional stage selection (house stageMesh_N nodes).
  model.traverse(n => {
    n.visible = true;
    if (n.userData && n.userData.activeInPrefab === false) n.visible = false;
  });
  if (o.stage != null) {
    model.traverse(n => {
      if (n.name.startsWith('stageMesh_')) n.visible = n.userData.houseArtStageIndex === o.stage;
      if (n.isMesh && n.children.some(c => c.name.startsWith('stageMesh_'))) n.material.visible = false; // parent keeps children visible
    });
  }
  if (o.stage != null) {
    // Importer output (Task 3): stage0..N nodes; hide the others.
    model.traverse(n => { if (/^stage\d+$/.test(n.name)) n.visible = n.name === `stage${o.stage}`; });
  }
  if (o.stageNodes != null) {
    // Importer output: show only the nodes of extras.stageNodes[stageNodes] (enable-list stages, e.g. the factory).
    let rootNode = null;
    model.traverse(n => { if (!rootNode && n.userData?.stageNodes) rootNode = n; });
    const list = new Set(rootNode.userData.stageNodes[o.stageNodes]);
    model.traverse(n => { if (n.isMesh) n.visible = list.has(n.name); });
  }
  if (o.showAll) model.traverse(n => { n.visible = true; });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);
  const root = mirror ? createMirroredWorldRoot() : new THREE.Group();
  const pivot = new THREE.Group();
  pivot.rotation.y = THREE.MathUtils.degToRad(yaw);
  pivot.add(model);
  root.add(pivot);
  scene.add(root);
  if (o.rig === 'tw') {
    // Tower War scene rig, read from the game's own scene (Light 286 + RenderSettings 285, defaultlocalgroup_scenes):
    // directional white intensity 0.2 (rotation quat below), flat ambient 0.8962. Lights sit inside the mirrored
    // root so Unity-space directions apply to RAW assets. three's physical lights need x PI to match Lambert-era output.
    scene.add(new THREE.AmbientLight(0xffffff, 0.8962264 * Math.PI));
    const sun = new THREE.DirectionalLight(0xffffff, 0.2 * Math.PI);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(0.5015914, 0.3785961, -0.2588906, 0.7335166));
    sun.position.copy(fwd).multiplyScalar(-10);
    root.add(sun, sun.target);
    window.__lightForward = fwd.toArray();
  } else {
    scene.add(new THREE.HemisphereLight(0xffffff, 0x888866, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(3, 6, 4);
    scene.add(sun);
  }
  if (o.ground) {
    const gt = await texLoader.loadAsync(o.ground);
    gt.colorSpace = color === 'gamma' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    gt.repeat.set(0.3, 0.3); gt.offset.set(0.35, 0.35); gt.wrapS = gt.wrapT = THREE.RepeatWrapping;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ map: gt }));
    g.rotation.x = -Math.PI / 2;
    root.add(g);
  }
  // Fit: bounding sphere of the visible model in world space (includes mirror), pivot recentred.
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const ctr = box.getCenter(new THREE.Vector3());
  const rad = box.getSize(new THREE.Vector3()).length() / 2;
  const cam = new THREE.PerspectiveCamera(fov, w / h, 0.01, 100);
  const dist = rad / Math.sin(THREE.MathUtils.degToRad(fov / 2)) * 1.05;
  const p = THREE.MathUtils.degToRad(pitch);
  // Camera stays fixed in world (outside the mirror), looking down -z... placed on +z side.
  cam.position.set(ctr.x, ctr.y + Math.sin(p) * dist, ctr.z + Math.cos(p) * dist);
  cam.lookAt(ctr);
  renderer.render(scene, cam);
  scene.remove(root);
  return { size: box.getSize(new THREE.Vector3()).toArray(), center: ctr.toArray() };
};
window.__ready = true;
