// Stub scene: a lit three.js cube + label proving WebGL + the capture loop work end-to-end.
import * as THREE from 'three';

export default async function stub({ canvas, name, width, height }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7aa860);
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
  camera.position.set(3, 3, 5);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(2, 5, 3);
  scene.add(sun);
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), new THREE.MeshStandardMaterial({ color: 0x3a7bd5 })));
  renderer.render(scene, camera);
  const label = document.createElement('div');
  label.textContent = `stub scene: ${name}`;
  label.style.cssText = 'position:fixed;left:16px;top:12px;font:20px monospace;color:#fff;text-shadow:0 1px 2px #000';
  document.body.append(label);
}
