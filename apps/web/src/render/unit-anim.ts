import { AnimationMixer, LoopOnce, LoopRepeat, Matrix4, type AnimationClip, type Mesh, type Object3D } from 'three';

/** Bake rate (D3/D4): glTF tracks sampled at 30 fps into per-frame part matrices. */
export const BAKE_FPS = 30;

/** A rigid part: shared geometry/material slot index, and its per-frame matrices. */
export interface BakedClip {
  readonly name: string;
  readonly loop: boolean;
  readonly frames: number;
  readonly parts: number;
  readonly duration: number;
  /** Float32Array[frames][parts][16], column-major, root-relative. */
  readonly data: Float32Array;
}

export interface UnitParts { meshes: Mesh[]; rest: Float32Array }

/** Meshes of a unit model in traversal order + their root-relative rest matrices (`parts*16`). */
export function collectParts(root: Object3D): UnitParts {
  root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  root.traverse(o => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
  return { meshes, rest: partMatrices(root, meshes) };
}

const inv = new Matrix4(), rel = new Matrix4();
function partMatrices(root: Object3D, meshes: readonly Mesh[], out = new Float32Array(meshes.length * 16), at = 0): Float32Array {
  inv.copy(root.matrixWorld).invert();
  meshes.forEach((m, p) => { rel.multiplyMatrices(inv, m.matrixWorld).toArray(out, at + p * 16); });
  return out;
}

/**
 * Samples `clip` on a clone of `root` at 30 fps. Loop clips take `round(duration*30)` frames (t = f*duration/frames, so frame 0 follows the
 * last: no seam); one-shot clips take `ceil(duration*30)+1` frames ending exactly at `duration` (clamped).
 */
export function bakeClip(root: Object3D, clip: AnimationClip, loop: boolean, fps = BAKE_FPS): BakedClip {
  const work = root.clone(true);
  const { meshes } = collectParts(work);
  const frames = loop ? Math.max(1, Math.round(clip.duration * fps)) : Math.max(2, Math.ceil(clip.duration * fps - 1e-3) + 1);
  const data = new Float32Array(frames * meshes.length * 16);
  const mixer = new AnimationMixer(work), action = mixer.clipAction(clip);
  action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity); action.clampWhenFinished = true; action.play();
  for (let f = 0; f < frames; f++) {
    const t = loop ? (f * clip.duration) / frames : Math.min(clip.duration, f / fps);
    mixer.setTime(t); work.updateMatrixWorld(true);
    partMatrices(work, meshes, data, f * meshes.length * 16);
  }
  return { name: clip.name, loop, frames, parts: meshes.length, duration: clip.duration, data };
}

/** Single-frame table for models with no clip (tank): the rest pose. */
export function bakeRest(rest: Float32Array, parts: number, name = 'rest'): BakedClip {
  return { name, loop: true, frames: 1, parts, duration: 1, data: rest.slice() };
}

const g = new Matrix4(), r = new Matrix4(), s = new Matrix4(), p = new Matrix4();
/**
 * Fallback death (topple about X + sink + shrink) applied to the rest pose, one-shot. Used for models without a death clip and
 * when a baked Death is judged broken.
 */
export function proceduralDeath(rest: Float32Array, parts: number, durationSec = 0.8, fps = BAKE_FPS): BakedClip {
  const frames = Math.ceil(durationSec * fps) + 1, data = new Float32Array(frames * parts * 16);
  for (let f = 0; f < frames; f++) {
    const k = f / (frames - 1), e = k * k;
    g.makeTranslation(0, -0.35 * e, 0);
    r.makeRotationX(-1.3 * e);
    const sc = 1 - 0.85 * e; s.makeScale(sc, sc, sc);
    g.multiply(r).multiply(s);
    for (let q = 0; q < parts; q++) {
      p.fromArray(rest, q * 16); rel.multiplyMatrices(g, p).toArray(data, (f * parts + q) * 16);
    }
  }
  return { name: 'proceduralDeath', loop: false, frames, parts, duration: durationSec, data };
}

/** Deterministic 32-bit integer hash (lowbias32). */
export function hash32(x: number): number {
  x = x | 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}
/** Per-unit animation phase in [0,1), from the troop identity (channel key, seq). Stable across frames/runs. */
export function phaseOf(channel: number, seq: number): number {
  return hash32(Math.imul(channel | 0, 0x9e3779b1) ^ hash32(seq)) / 4294967296;
}

/** Frame index of a looping clip at `timeSec` for a unit with `phase` in [0,1). */
export function loopFrame(clip: BakedClip, timeSec: number, phase: number): number {
  const u = timeSec / clip.duration + phase;
  return Math.floor((u - Math.floor(u)) * clip.frames) % clip.frames;
}
/** Frame index of a one-shot clip `ageSec` after it started (clamped to the last frame). */
export function oneShotFrame(clip: BakedClip, ageSec: number): number {
  return Math.min(clip.frames - 1, Math.max(0, Math.floor((ageSec / clip.duration) * (clip.frames - 1))));
}

/** out = a * b for column-major 4x4 stored at offsets; `out` must not alias inputs. */
export function mul4(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, out: Float32Array, oo: number): void {
  for (let c = 0; c < 4; c++) {
    const b0 = b[bo + c * 4]!, b1 = b[bo + c * 4 + 1]!, b2 = b[bo + c * 4 + 2]!, b3 = b[bo + c * 4 + 3]!;
    for (let r2 = 0; r2 < 4; r2++) {
      out[oo + c * 4 + r2] = a[ao + r2]! * b0 + a[ao + 4 + r2]! * b1 + a[ao + 8 + r2]! * b2 + a[ao + 12 + r2]! * b3;
    }
  }
}
