import { AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, MeshBasicMaterial, type PerspectiveCamera } from 'three';

const CAPACITY = 128, FADE_MS = 250, REDUCED_FADE_MS = 60;
interface TrailOptions { now(): number; reducedMotion?(): boolean }
/** Two camera-facing strips share one indexed mesh and fixed buffers. All coordinates are world-space. */
export function createCutTrail(camera: PerspectiveCamera, options: TrailOptions) {
  const points = new Float32Array(CAPACITY * 3), births = new Float64Array(CAPACITY), starts = new Uint8Array(CAPACITY);
  const positions = new BufferAttribute(new Float32Array(CAPACITY * 4 * 3), 3).setUsage(DynamicDrawUsage);
  const colors = new BufferAttribute(new Float32Array(CAPACITY * 4 * 4).fill(1), 4).setUsage(DynamicDrawUsage);
  const indices = new BufferAttribute(new Uint16Array((CAPACITY - 1) * 12), 1).setUsage(DynamicDrawUsage);
  const geometry = new BufferGeometry(); geometry.setAttribute('position', positions); geometry.setAttribute('color', colors); geometry.setIndex(indices); geometry.setDrawRange(0, 0);
  const material = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false });
  const mesh = new Mesh(geometry, material); mesh.visible = false; mesh.frustumCulled = false; mesh.renderOrder = 4;
  let count = 0, newStroke = true, disposed = false;
  function append(point: { x: number; y: number; z: number }) {
    if (disposed) return;
    const last = (count - 1) * 3;
    if (count && !newStroke && (point.x - points[last]!) ** 2 + (point.y - points[last + 1]!) ** 2 + (point.z - points[last + 2]!) ** 2 < 1e-10) return;
    if (count === CAPACITY) { points.copyWithin(0, 3); births.copyWithin(0, 1); starts.copyWithin(0, 1); count--; }
    const at = count * 3;
    points[at] = point.x; points[at + 1] = point.y; points[at + 2] = point.z;
    births[count] = options.now(); starts[count] = newStroke ? 1 : 0; count++; newStroke = false;
  }
  function release() { newStroke = true; }
  function refresh() {
    if (disposed) return;
    const now = options.now(), reduced = options.reducedMotion?.() ?? false, fade = reduced ? REDUCED_FADE_MS : FADE_MS;
    let expired = 0;
    while (expired < count && now - births[expired]! >= fade) expired++;
    if (expired) { points.copyWithin(0, expired * 3, count * 3); births.copyWithin(0, expired, count); starts.copyWithin(0, expired, count); count -= expired; }
    if (count < 2) { mesh.visible = false; geometry.setDrawRange(0, 0); return; }
    camera.updateMatrixWorld();
    const m = camera.matrixWorld.elements;
    for (let i = 0; i < count; i++) {
      const previous = (i > 0 && !starts[i] ? i - 1 : i) * 3;
      const next = (i + 1 < count && !starts[i + 1] ? i + 1 : i) * 3;
      const dx = points[next]! - points[previous]!, dy = points[next + 1]! - points[previous + 1]!, dz = points[next + 2]! - points[previous + 2]!;
      const sx = dx * m[0]! + dy * m[1]! + dz * m[2]!, sy = dx * m[4]! + dy * m[5]! + dz * m[6]!;
      const length = Math.hypot(sx, sy), right = length > 1e-8 ? -sy / length : 0, up = length > 1e-8 ? sx / length : 1;
      const ox = right * m[0]! + up * m[4]!, oy = right * m[1]! + up * m[5]!, oz = right * m[2]! + up * m[6]!;
      const at = i * 3, alpha = Math.max(0, Math.min(1, 1 - (now - births[i]!) / fade));
      for (let layer = 0; layer < 2; layer++) {
        const halfWidth = layer === 0 ? .125 : .04, opacity = alpha * (layer === 0 ? (reduced ? 0 : .25) : 1), vertex = i * 4 + layer * 2;
        positions.setXYZ(vertex, points[at]! - ox * halfWidth, points[at + 1]! - oy * halfWidth, points[at + 2]! - oz * halfWidth);
        positions.setXYZ(vertex + 1, points[at]! + ox * halfWidth, points[at + 1]! + oy * halfWidth, points[at + 2]! + oz * halfWidth);
        colors.setW(vertex, opacity); colors.setW(vertex + 1, opacity);
      }
    }
    for (let i = 0; i < count - 1; i++) {
      const at = i * 12, base = i * 4;
      if (starts[i + 1]) { for (let k = 0; k < 12; k++) indices.setX(at + k, base); continue; }
      for (let layer = 0; layer < 2; layer++) {
        const a = base + layer * 2, b = a + 1, c = a + 4, d = c + 1, offset = at + layer * 6;
        indices.setX(offset, a); indices.setX(offset + 1, c); indices.setX(offset + 2, b);
        indices.setX(offset + 3, b); indices.setX(offset + 4, c); indices.setX(offset + 5, d);
      }
    }
    positions.needsUpdate = true; colors.needsUpdate = true; indices.needsUpdate = true;
    geometry.setDrawRange(0, (count - 1) * 12); mesh.visible = true;
  }
  function dispose() { if (disposed) return; disposed = true; mesh.visible = false; mesh.removeFromParent(); geometry.dispose(); material.dispose(); }
  return { mesh, append, release, refresh, dispose };
}
