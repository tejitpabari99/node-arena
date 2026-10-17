import { CapsuleGeometry, MeshStandardMaterial } from 'three';
import type { InstancedBufferAttribute } from 'three';

export type AnimationMode = 'bob' | 'static-bob' | 'none';
export const createTroopGeometry = () => new CapsuleGeometry(0.14, 0.35, 2, 6);

/** Spike-only shader: identity instance matrices; the packed attribute supplies placement. */
export function createTroopMaterial(color: number, mode: AnimationMode, clock: { value: number }) {
  const material = new MeshStandardMaterial({ color, roughness: 0.85 });
  material.customProgramCacheKey = () => `troop-spike-${mode}`;
  material.onBeforeCompile = shader => {
    shader.uniforms.troopTime = clock;
    const angle = mode === 'bob' ? '13.823 * troopTime + troopPose.w' : 'troopPose.w';
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec4 troopPose;
uniform float troopTime;
mat2 troopRotate(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }
`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
float troopWave = ${mode === 'none' ? '0.0' : `sin(${angle})`};
mat2 troopSway = troopRotate(0.10472 * troopWave);
mat2 troopYaw = troopRotate(troopPose.z);
objectNormal.xy = troopSway * objectNormal.xy;
objectNormal.xz = troopYaw * objectNormal.xz;
`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed.y += 0.315;
transformed.xy = troopSway * transformed.xy;
transformed.y += 0.12 * abs(troopWave);
transformed.xz = troopYaw * transformed.xz;
transformed.xz += troopPose.xy;
`);
  };
  return material;
}

/** Deterministic marching lanes; equivalent hot loop writes four floats per troop. */
export function writeInstances(attribute: InstancedBufferAttribute, count: number, seconds: number, bucket: number) {
  const data = attribute.array;
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    data[offset] = ((i % 25) * 0.7 + seconds * 0.8) % 18 - 9;
    data[offset + 1] = Math.floor(i / 25) * 0.35 - 14 + bucket * 7;
    data[offset + 2] = bucket % 2 ? Math.PI : 0;
    data[offset + 3] = i;
  }
  attribute.needsUpdate = true;
}

export function distribution(values: number[]) {
  if (!values.length) throw new Error('No samples');
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction: number) => sorted[Math.ceil(sorted.length * fraction) - 1]!;
  return { samples: sorted.length, min: sorted[0]!, median: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1)! };
}
