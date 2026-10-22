// Node-side R2 analysis of one GLB: per-mesh winding/UV/texel/bbox, handedness, Run frame 0 vs bind.
import { NodeIO } from '@gltf-transform/core';
import fs from 'node:fs';
import sharp from 'sharp';
import {
  MIRROR_Z, bbox, centroid, det3, isOpaqueTexel, mergeBbox, mulMat4, muzzleSide, nearestVertex, normalAgreement,
  poseDelta, signedVolume, signedVolumeAsSeen, texelAt, transformPoint, uvRange,
} from '../../src/assets-validate/checks.ts';

const r3 = x => Math.round(x * 1000) / 1000;
const centerOf = b => b.min.map((v, k) => (v + b.max[k]) / 2);
const round = a => [...a].map(r3);
const activeInPrefab = node => {
  for (let n = node; n; n = n.getParentNode()) if (n.getExtras()?.activeInPrefab === false) return false;
  return true;
};

async function decode(texture) {
  if (!texture) return null;
  const { data, info } = await sharp(Buffer.from(texture.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: data, w: info.width, h: info.height };
}

/** Set node TRS from the first keyframe of animation `name` (suffix match). Returns {frame, restore}. */
function applyFirstFrame(root, suffix) {
  const anim = root.listAnimations().find(a => a.getName().endsWith(suffix));
  if (!anim) return null;
  const saved = new Map();
  const frame = {};
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode(), path = ch.getTargetPath();
    const out = ch.getSampler().getOutput();
    const n = path === 'rotation' ? 4 : 3;
    const v = [...out.getArray().slice(0, n)];
    if (!saved.has(node)) saved.set(node, { t: node.getTranslation(), r: node.getRotation(), s: node.getScale() });
    (frame[node.getName()] ??= {})[path === 'translation' ? 't' : path === 'rotation' ? 'r' : 's'] = v;
    if (path === 'translation') node.setTranslation(v); else if (path === 'rotation') node.setRotation(v); else node.setScale(v);
  }
  return { anim, frame, restore: () => { for (const [n, s] of saved) { n.setTranslation(s.t); n.setRotation(s.r); n.setScale(s.s); } } };
}

function meshParts(root, tex) {
  const parts = [];
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = node.getWorldMatrix();
    const asSeen = mulMat4(MIRROR_Z, world);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION').getArray(), idx = prim.getIndices().getArray();
      const nor = prim.getAttribute('NORMAL')?.getArray();
      const uv = prim.getAttribute('TEXCOORD_0')?.getArray();
      const c = centroid(pos);
      const ur = uv ? uvRange(uv) : null;
      let texel = null;
      if (uv && tex) {
        const vi = nearestVertex(pos, c);
        texel = texelAt(tex.rgba, tex.w, tex.h, uv[2 * vi], uv[2 * vi + 1]);
      }
      parts.push({
        name: node.getName(), active: activeInPrefab(node), tris: idx.length / 3,
        volAuthored: signedVolume(pos, idx, world) * Math.sign(det3(world)), // unmirrored root
        volSeen: signedVolumeAsSeen(pos, idx, asSeen), // under the mirrored worldRoot
        normalAgree: nor ? normalAgreement(pos, nor, idx) : null,
        uv: ur && { min: round(ur.min), max: round(ur.max), inRange: ur.inRange, outOfRange: ur.outOfRange },
        texel, texelOpaque: texel ? isOpaqueTexel(texel) : null,
        bboxSeen: bbox(pos, asSeen), pos, idx, asSeen, world,
      });
    }
  }
  return parts;
}

const worldPos = (node, m = MIRROR_Z) => transformPoint(mulMat4(m, node.getWorldMatrix()), 0, 0, 0);

export async function analyze(file, { expected, hands = false, weaponIcon = false, rightPart = null, texFile = null } = {}) {
  const io = new NodeIO();
  const doc = await io.read(file);
  const root = doc.getRoot();
  let tex = await decode(root.listTextures()[0]);
  const embeddedTexture = !!tex;
  if (!tex && texFile) tex = await decode({ getImage: () => fs.readFileSync(texFile) });
  const parts = meshParts(root, tex);
  const vis = parts.filter(p => p.active);
  let box = null;
  for (const p of vis) box = mergeBbox(box, p.bboxSeen);
  const open = p => Math.abs(p.volSeen) < 1e-9; // open/planar mesh: volume sign undefined
  const rep = {
    file: file.split('/').slice(-2).join('/'),
    anims: root.listAnimations().map(a => a.getName()),
    parts: parts.map(p => ({ name: p.name, active: p.active, tris: p.tris, volAuthored: r3(p.volAuthored), volSeen: r3(p.volSeen * 1000) / 1000, normalAgree: p.normalAgree === null ? null : r3(p.normalAgree), uv: p.uv, texel: p.texel, texelOpaque: p.texelOpaque, centerSeen: round(centerOf(p.bboxSeen)), sizeSeen: round(p.bboxSeen.size) })),
    embeddedTexture,
    totalActiveTris: vis.reduce((s, p) => s + p.tris, 0),
    bboxSeen: box && round(box.size),
    checks: {},
  };
  const c = rep.checks;
  c.winding = { pass: parts.every(p => p.volSeen > 0 || open(p)), failing: parts.filter(p => !(p.volSeen > 0 || open(p))).map(p => p.name) };
  c.uvRange = { pass: parts.every(p => !p.uv || p.uv.inRange), failing: parts.filter(p => p.uv && !p.uv.inRange).map(p => p.name) };
  c.centroidTexel = { pass: parts.every(p => p.texelOpaque !== false), failing: parts.filter(p => p.texelOpaque === false).map(p => p.name) };
  if (expected) c.bbox = { pass: box && [...box.size].sort((a, b) => a - b).every((v, k) => Math.abs(v - [...expected].sort((x, y) => x - y)[k]) <= 0.15 * [...expected].sort((x, y) => x - y)[k]), measured: round(box.size), expected };
  const byName = n => root.listNodes().find(x => x.getName() === n);
  if (hands) {
    const hr = byName('hand_right'), hl = byName('hand_left');
    const f = transformPoint(MIRROR_Z, 0, 0, 1).map((v, k) => v - MIRROR_Z[12 + k]); // model +z as seen
    const right = [-f[2], 0, f[0]]; // f x up(0,1,0): the character's right as seen from behind in a RH three scene
    const d = [0, 1, 2].map(k => worldPos(hr)[k] - worldPos(hl)[k]);
    const dot = d[0] * right[0] + d[1] * right[1] + d[2] * right[2];
    c.handedness = { pass: dot > 0, rightMinusLeftAlongRight: r3(dot), note: 'hand_right must lie on the character right (facing = model +z, mirrored root)' };
    const gun = parts.find(p => /gun|weapon/.test(p.name));
    if (gun) {
      const body = centroid(vis.flatMap(p => [...transformPointsFlat(p.pos, p.asSeen)]));
      const seenPos = transformPointsFlat(gun.pos, gun.asSeen);
      const grip = worldPos(hr);
      c.muzzleSideBind = muzzleSide(seenPos, grip, body, right);
      if (weaponIcon) c.weaponSide = { pass: c.muzzleSideBind === -1, muzzleSide: c.muzzleSideBind, note: 'icon 1_Base: grip hand = character right, muzzle toward character left (-1). Far end from hand_right grip, bind pose; corroborates handedness' };
    }
  }
  if (rightPart) {
    const part = parts.find(p => p.name === rightPart);
    const f = [0, 0, -1], right = [-f[2], 0, f[0]];
    const body = centroid(vis.flatMap(p => [...transformPointsFlat(p.pos, p.asSeen)]));
    const pc = centroid(transformPointsFlat(part.pos, part.asSeen));
    c.rightPart = { part: rightPart, pass: [0, 1, 2].reduce((s, k) => s + (pc[k] - body[k]) * right[k], 0) > 0, note: 'asymmetric prop expected on the character right (cowboy holster)' };
  }
  const stages = parts.filter(p => p.name.startsWith('stageMesh_'));
  if (stages.length) rep.stages = stages.map(p => ({ node: p.name, tris: p.tris, size: round(p.bboxSeen.size) }));
  // Run frame 0 vs bind pose
  const run = applyFirstFrame(root, 'Run');
  if (run) {
    run.restore();
    const bind = {};
    for (const n of root.listNodes()) bind[n.getName()] = { t: n.getTranslation(), r: n.getRotation() };
    const delta = poseDelta(bind, run.frame);
    const animated = new Set(Object.keys(run.frame));
    const staticParts = parts.filter(p => p.active && !animated.has(p.name)).map(p => p.name);
    const posed = applyFirstFrame(root, 'Run');
    const parts0 = meshParts(root, tex).filter(p => p.active);
    let box0 = null;
    for (const p of parts0) box0 = mergeBbox(box0, p.bboxSeen);
    if (hands) {
      const hr = byName('hand_right');
      const f = [0, 0, -1], right = [-f[2], 0, f[0]];
      const gun = parts0.find(p => /gun|weapon/.test(p.name));
      if (gun) {
        const body = centroid(parts0.flatMap(p => [...transformPointsFlat(p.pos, p.asSeen)]));
        c.muzzleSideRunFrame0 = muzzleSide(transformPointsFlat(gun.pos, gun.asSeen), worldPos(hr), body, right);
      }
    }
    posed.restore();
    const lastT = Math.max(...run.anim.listChannels().map(ch => { const t = ch.getSampler().getInput().getArray(); return t[t.length - 1]; }));
    c.runFrame0 = {
      pass: delta.maxPos <= 0.01 && delta.maxAngle * 180 / Math.PI <= 2, tolerance: 'max node pos delta <= 0.01, max angle <= 2 deg',
      durationSec: r3(lastT),
      clip: run.anim.getName(), channels: run.anim.listChannels().length, animatedNodes: animated.size,
      maxPosDelta: r3(delta.maxPos), maxAngleDeg: r3(delta.maxAngle * 180 / Math.PI), worstNode: delta.worst,
      staticMeshParts: staticParts, bboxBindSeen: round(box.size), bboxRun0Seen: round(box0.size),
    };
  }
  return rep;
}

function transformPointsFlat(pos, m) {
  const out = new Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) { const p = transformPoint(m, pos[i], pos[i + 1], pos[i + 2]); out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2]; }
  return out;
}
