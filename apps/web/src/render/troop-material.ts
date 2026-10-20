import { Color, type Material } from 'three';
import type { Manifest } from '@node-arena/content';
export function patchTroopMaterial(material: Material, visual: Omit<Manifest['visuals'][string], 'model'>, team: Color, masked: boolean, clock: { value: number }, reducedMotion: boolean, modelHeight = 1) {
  const anim = visual.anim?.type === 'bob' ? visual.anim : undefined;
  const amp = { value: reducedMotion ? 0 : anim?.amp ?? 0 }, sway = { value: reducedMotion ? 0 : (anim?.sway ?? 0) * Math.PI / 180 };
  const original = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${previousKey}:troop-pose-v3:${masked}`;
  material.onBeforeCompile = (shader, renderer) => {
    original(shader, renderer);
    Object.assign(shader.uniforms, { troopTime: clock, troopHz: { value: anim?.hz ?? 0 }, troopAmp: amp, troopSway: sway,
      troopScale: { value: visual.scale }, troopYOffset: { value: visual.yOffset ?? 0 }, troopHeight: { value: modelHeight }, troopTeam: { value: team } });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute vec4 troopPose;
attribute float teamMask;
varying float vTroopTeamMask;
uniform float troopTime, troopHz, troopAmp, troopSway, troopScale, troopYOffset, troopHeight;
mat2 troopRotate(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }
`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
float normalWave = sin(6.28318530718 * troopHz * troopTime + troopPose.w);
objectNormal.xy = troopRotate(troopSway * normalWave) * objectNormal.xy;
objectNormal.xz = troopRotate(troopPose.z) * objectNormal.xz;
#ifdef USE_TANGENT
objectTangent.xy = troopRotate(troopSway * normalWave) * objectTangent.xy;
objectTangent.xz = troopRotate(troopPose.z) * objectTangent.xz;
#endif
`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float poseWave = sin(6.28318530718 * troopHz * troopTime + troopPose.w);
// Procedural gait: lower-half (legs) shear forward/back, opposite sign per side (x), fading to zero at the hips.
float gaitLeg = clamp(1.0 - transformed.y / (0.45 * troopHeight), 0.0, 1.0);
transformed.z += sign(transformed.x + 1e-5) * poseWave * gaitLeg * 0.16 * troopHeight * (troopAmp > 0.0 ? 1.0 : 0.0);
transformed *= troopScale;
transformed.xy = troopRotate(troopSway * poseWave) * transformed.xy;
transformed.y += troopYOffset + troopAmp * abs(poseWave);
transformed.xz = troopRotate(troopPose.z) * transformed.xz;
transformed.xz += troopPose.xy;
vTroopTeamMask = ${masked ? 'teamMask' : '1.0'};
`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 troopTeam;\nvarying float vTroopTeamMask;')
      .replace('#include <color_fragment>', `#include <color_fragment>
// Team-masked parts take the full team colour; unmasked parts (skin, cloth) keep their own colour with a 15% team tint.
vec3 troopUnmasked = diffuseColor.rgb * mix(vec3(1.0), troopTeam * 1.2, 0.15);
diffuseColor.rgb *= mix(vec3(1.0), troopTeam, vTroopTeamMask);
diffuseColor.rgb = mix(troopUnmasked, diffuseColor.rgb, vTroopTeamMask);`);
  };
  if (visual.tint && 'color' in material && material.color instanceof Color) material.color.multiply(new Color(visual.tint));
  return { setTeamColor(color: Color) { team.copy(color); }, setReducedMotion(value: boolean) { amp.value = value ? 0 : anim?.amp ?? 0; sway.value = value ? 0 : (anim?.sway ?? 0) * Math.PI / 180; } };
}
