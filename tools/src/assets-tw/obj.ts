// OBJ (UnityPy export) -> RAW Unity geometry. UnityPy's MeshExporter writes v=(-x,y,z), vn=(-nx,ny,nz), faces (c,b,a), vt as
// Unity v-up. RAW means: undo the x negate and the face reversal; glTF UV is v-down, so v is flipped (1-v).
// Executable spec of the same maths: tools/assets/validate/candidate.mjs (operates on prototype GLBs instead).
export interface RawGeometry {
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

/** Negate without producing -0 (keeps output bytes free of sign-of-zero noise). */
const negX = (x: number): number => (x === 0 ? 0 : -x);

export function parseObj(text: string, label = 'obj'): RawGeometry {
  const v: number[] = [], vt: number[] = [], vn: number[] = [], faces: number[] = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) { const p = line.trim().split(/\s+/); v.push(Number(p[1]), Number(p[2]), Number(p[3])); }
    else if (line.startsWith('vt ')) { const p = line.trim().split(/\s+/); vt.push(Number(p[1]), Number(p[2])); }
    else if (line.startsWith('vn ')) { const p = line.trim().split(/\s+/); vn.push(Number(p[1]), Number(p[2]), Number(p[3])); }
    else if (line.startsWith('f ')) {
      const p = line.trim().split(/\s+/).slice(1);
      if (p.length !== 3) throw new Error(`${label}: only triangles supported, got a ${p.length}-gon`);
      const idx = p.map((tok) => {
        const [a, b, c] = tok.split('/');
        const i = Number(a) - 1;
        // UnityPy writes v/vt/vn with one shared index; anything else would need vertex splitting.
        if ((b !== undefined && b !== '' && Number(b) - 1 !== i) || (c !== undefined && c !== '' && Number(c) - 1 !== i)) throw new Error(`${label}: face indices v/vt/vn differ`);
        return i;
      }) as [number, number, number];
      faces.push(idx[2], idx[1], idx[0]); // restore Unity's original (a,b,c) order from UnityPy's (c,b,a)
    }
  }
  const n = v.length / 3;
  if (vt.length && vt.length / 2 !== n) throw new Error(`${label}: vt count != v count`);
  if (vn.length && vn.length / 3 !== n) throw new Error(`${label}: vn count != v count`);
  const positions = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 3) { positions[i] = negX(v[i]!); positions[i + 1] = v[i + 1]!; positions[i + 2] = v[i + 2]!; }
  let normals: Float32Array | null = null;
  if (vn.length) {
    normals = new Float32Array(vn.length);
    for (let i = 0; i < vn.length; i += 3) { normals[i] = negX(vn[i]!); normals[i + 1] = vn[i + 1]!; normals[i + 2] = vn[i + 2]!; }
  }
  let uvs: Float32Array | null = null;
  if (vt.length) {
    uvs = new Float32Array(vt.length);
    for (let i = 0; i < vt.length; i += 2) { uvs[i] = vt[i]!; uvs[i + 1] = 1 - vt[i + 1]!; }
  }
  for (const i of faces) if (!(i >= 0 && i < n)) throw new Error(`${label}: face index out of range`);
  return { positions, normals, uvs, indices: Uint32Array.from(faces), vertexCount: n, triangleCount: faces.length / 3 };
}
