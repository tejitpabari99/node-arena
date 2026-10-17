/** Static single-sided triangles with UV0 sampling red and TEXCOORD_1 sampling green. */
export function mirroredUvGlb(textureUri: string): Buffer {
  const bin = Buffer.alloc(120);
  [-1, -1, 0, 1, -1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, .25, .5, .25, .5, .25, .5, .75, .5, .75, .5, .75, .5].forEach((value, index) => bin.writeFloatLE(value, index * 4));
  const gltf = {
    asset: { version: '2.0' }, extensionsUsed: ['KHR_materials_unlit'], scene: 0,
    scenes: [{ nodes: [0, 1] }], nodes: [{ mesh: 0, translation: [-1.5, 0, 0] }, { mesh: 0, translation: [1.5, 0, 0], scale: [-1, 1, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TEXCOORD_1: 3 }, material: 0 }] }],
    materials: [{ name: 'Accent', extensions: { KHR_materials_unlit: {} }, pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 1 }, metallicFactor: 0, roughnessFactor: 1 } }],
    textures: [{ source: 0, sampler: 0 }], samplers: [{ magFilter: 9728, minFilter: 9728 }], images: [{ uri: textureUri }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 }, { buffer: 0, byteOffset: 72, byteLength: 24 }, { buffer: 0, byteOffset: 96, byteLength: 24 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] }, { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' }, { bufferView: 3, componentType: 5126, count: 3, type: 'VEC2' }],
  };
  const json = Buffer.from(JSON.stringify(gltf)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
  const out = Buffer.alloc(12 + 8 + padded.length + 8 + bin.length);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(padded.length, 12); out.writeUInt32LE(0x4e4f534a, 16); padded.copy(out, 20);
  const offset = 20 + padded.length; out.writeUInt32LE(bin.length, offset); out.writeUInt32LE(0x004e4942, offset + 4); bin.copy(out, offset + 8);
  return out;
}
