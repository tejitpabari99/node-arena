import { describe, expect, it } from 'vitest';
import { createTroopGeometry, createTroopMaterial, distribution, writeInstances } from '../src/dev/spike/troops.js';
import { InstancedBufferAttribute } from 'three';

describe('instanced troop spike', () => {
  it('keeps primitive troops within the 300 triangle budget', () => {
    const geometry = createTroopGeometry();
    expect(geometry.index!.count / 3).toBeLessThanOrEqual(300);
    geometry.dispose();
  });
  it('updates the packed x/z/yaw/phase attribute without reallocating', () => {
    const data = new Float32Array(8);
    const attribute = new InstancedBufferAttribute(data, 4);
    writeInstances(attribute, 2, 1, 0);
    expect(attribute.array).toBe(data);
    expect([...data].every(Number.isFinite)).toBe(true);
    expect(data[7]).toBe(1);
    const before = data[0];
    writeInstances(attribute, 2, 2, 0);
    expect(data[0]).not.toBe(before);
    expect(attribute.version).toBe(2);
  });
  it('patches both position and normals and shares the time uniform', () => {
    const clock = { value: 0 };
    const material = createTroopMaterial(0xffffff, 'bob', clock);
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>' };
    material.onBeforeCompile(shader as never, {} as never);
    expect(shader.vertexShader).toContain('attribute vec4 troopPose');
    expect(shader.vertexShader).toContain('objectNormal.xz = troopYaw * objectNormal.xz');
    expect(shader.vertexShader).toContain('transformed.xz += troopPose.xy');
    expect(shader.uniforms).toHaveProperty('troopTime', clock);
    expect(material.customProgramCacheKey()).not.toBe(createTroopMaterial(0xffffff, 'none', clock).customProgramCacheKey());
  });
  it('reports nearest-rank distributions and rejects empty samples', () => {
    expect(distribution([5, 1, 3, 2, 4])).toEqual({ samples: 5, min: 1, median: 3, p95: 5, max: 5 });
    expect(() => distribution([])).toThrow();
  });
});
