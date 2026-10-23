import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY, MIRROR_Z, bbox, bboxWithin, det3, isOpaqueTexel, mulMat4, muzzleSide, nearestVertex, normalAgreement,
  poseDelta, quatAngle, signedVolume, signedVolumeAsSeen, texelAt, uvRange,
} from '../src/assets-validate/checks.js';

// Unit tetrahedron, outward-CCW winding => +1/6.
const pos = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
const ccw = [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3];
const cw = [0, 1, 2, 0, 3, 1, 0, 2, 3, 1, 3, 2];

test('signedVolume: sign follows winding', () => {
  assert.ok(Math.abs(signedVolume(pos, ccw) - 1 / 6) < 1e-9);
  assert.ok(Math.abs(signedVolume(pos, cw) + 1 / 6) < 1e-9);
});
test('signedVolumeAsSeen: mirror root flips raw-world sign but three.js flips winding back', () => {
  assert.equal(det3(MIRROR_Z), -1);
  assert.equal(det3(IDENTITY), 1);
  // A mesh that is front-facing (>0) unmirrored: under the mirror root the world-space volume is negative,
  // and as-seen volume (x sign(det)) stays positive because three.js flips the winding too.
  assert.ok(signedVolume(pos, ccw, MIRROR_Z) < 0);
  assert.ok(signedVolumeAsSeen(pos, ccw, MIRROR_Z) > 0);
  assert.ok(signedVolumeAsSeen(pos, cw, MIRROR_Z) < 0);
  // A non-uniform scale with negative determinant composed with the mirror is a proper (positive) transform.
  const m = mulMat4(MIRROR_Z, [-0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 1]);
  assert.ok(det3(m) > 0);
  assert.ok(signedVolumeAsSeen(pos, ccw, m) > 0);
});
test('normalAgreement: detects reversed winding vs authored normals', () => {
  // Outward normals of the tetra at each vertex (approx: vertex minus centroid).
  const c = [0.25, 0.25, 0.25];
  const nor: number[] = [];
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) nor.push(pos[3 * i + k]! - c[k]!);
  assert.equal(normalAgreement(pos, nor, ccw), 1);
  assert.equal(normalAgreement(pos, nor, cw), 0);
});
test('uvRange flags out-of-range and tolerates epsilon', () => {
  assert.equal(uvRange([0, 0, 1, 1, 0.5, 0.25]).inRange, true);
  assert.equal(uvRange([1.00001, 0]).inRange, true);
  const r = uvRange([0, 0, 1.2, -0.3]);
  assert.equal(r.inRange, false);
  assert.equal(r.outOfRange, 1);
  assert.deepEqual(r.max, [1.2, 0]);
});
test('bbox applies transform; bboxWithin is tolerance + axis-order based', () => {
  const b = bbox(pos, [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 1, 1, 1, 1]);
  assert.deepEqual(b.size, [2, 3, 4]);
  assert.deepEqual(b.min, [1, 1, 1]);
  assert.equal(bboxWithin([0.94, 1.0, 1.6], [1.6, 0.94, 1.0]), true);
  assert.equal(bboxWithin([0.94, 1.0, 2.2], [0.94, 1.0, 1.6]), false);
});
test('texel probe: nearestVertex, texelAt (v down, clamped), opacity', () => {
  assert.equal(nearestVertex(pos, [0.9, 0.1, 0]), 1);
  const rgba = [255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 255, 9, 9, 9, 9]; // 2x2: R, G(transparent) / B, ?
  assert.deepEqual(texelAt(rgba, 2, 2, 0.1, 0.1), [255, 0, 0, 255]);
  assert.deepEqual(texelAt(rgba, 2, 2, 0.1, 0.9), [0, 0, 255, 255]);
  assert.deepEqual(texelAt(rgba, 2, 2, 5, -5), [0, 255, 0, 0]);
  assert.equal(isOpaqueTexel([0, 255, 0, 0]), false);
  assert.equal(isOpaqueTexel([0, 255, 0, 255]), true);
});
test('poseDelta/quatAngle: seam metric between bind and frame 0', () => {
  assert.ok(Math.abs(quatAngle([0, 0, 0, 1], [0, 1, 0, 0]) - Math.PI) < 1e-9);
  assert.ok(quatAngle([0, 0, 0, 1], [0, 0, 0, -1]) < 1e-9); // q and -q are the same rotation
  const d = poseDelta(
    { a: { t: [0, 0, 0], r: [0, 0, 0, 1] }, b: { t: [0, 1, 0], r: [0, 0, 0, 1] } },
    { a: { t: [0, 0, 0.5] }, b: { r: [0, 0.7071068, 0, 0.7071068] } },
  );
  assert.ok(Math.abs(d.maxPos - 0.5) < 1e-9);
  assert.ok(Math.abs(d.maxAngle - Math.PI / 2) < 1e-6);
  assert.equal(d.worst, 'b');
});
test('muzzleSide: far end of weapon relative to the body, projected on the right axis', () => {
  const gun = [0, 0, 0, 1, 0, 0, 0.5, 0, 0]; // x 0..1, grip at x=0
  assert.equal(muzzleSide(gun, [0, 0, 0], [0.2, 0, 0], [1, 0, 0]), 1);
  assert.equal(muzzleSide(gun, [0, 0, 0], [0.2, 0, 0], [-1, 0, 0]), -1);
  assert.equal(muzzleSide([], [0, 0, 0], [0, 0, 0], [1, 0, 0]), 0);
});
