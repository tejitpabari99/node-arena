// In-memory "RAW importer" candidate: turns a prototype GLB (UnityPy-exported, x-negated, reversed faces) back into
// RAW Unity geometry so it can be judged under the mirrored worldRoot. Task 3's importer must do exactly this when
// reading the extract. Prototype GLBs on disk are never edited; output goes to the caller's temp dir.
import { NodeIO } from '@gltf-transform/core';

const conjQuat = ([x, y, z, w]) => [x, -y, -z, w]; // involution: same map the prototype writer applied

export async function toRaw(srcPath, dstPath) {
  const io = new NodeIO();
  const doc = await io.read(srcPath);
  const root = doc.getRoot();
  const seen = new Set();
  const once = (acc, fn) => { if (acc && !seen.has(acc)) { seen.add(acc); fn(acc); } };
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const sem of ['POSITION', 'NORMAL']) {
        once(prim.getAttribute(sem), a => {
          const arr = a.getArray();
          for (let i = 0; i < arr.length; i += 3) arr[i] = -arr[i]; // undo UnityPy's x negate
          a.setArray(arr);
        });
      }
      once(prim.getIndices(), a => {
        const arr = a.getArray();
        for (let i = 0; i + 2 < arr.length; i += 3) { const t = arr[i]; arr[i] = arr[i + 2]; arr[i + 2] = t; } // undo UnityPy's (c,b,a) face order
        a.setArray(arr);
      });
    }
  }
  for (const node of root.listNodes()) {
    const [x, y, z] = node.getTranslation();
    node.setTranslation([-x, y, z]);
    node.setRotation(conjQuat(node.getRotation()));
  }
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const out = ch.getSampler().getOutput();
      once(out, a => {
        const arr = a.getArray();
        if (ch.getTargetPath() === 'translation') for (let i = 0; i < arr.length; i += 3) arr[i] = -arr[i];
        else if (ch.getTargetPath() === 'rotation') for (let i = 0; i < arr.length; i += 4) { arr[i + 1] = -arr[i + 1]; arr[i + 2] = -arr[i + 2]; }
        a.setArray(arr);
      });
    }
  }
  root.getExtras(); // keep as-is
  await io.write(dstPath, doc);
}
