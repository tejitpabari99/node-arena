/** Node-only entrypoint. Never re-export this file from a browser-facing barrel. */
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { BoxGeometry, CapsuleGeometry, CylinderGeometry } from 'three';
import { isCredited, type Manifest } from '@node-arena/content';
import { parseManifest } from './load.js';
import { assertAssetPath, ManifestError, PRIMITIVE_SEGMENTS } from './resolve.js';

export interface ValidateManifestOptions { assetsDir: string; /** CREDITS.md contents, not a filename. */ credits: string }
interface Gltf {
  asset?: { version?: string };
  buffers?: Array<{ uri?: string; byteLength: number; extensions?: Record<string, unknown> }>;
  bufferViews?: Array<{ buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; extensions?: Record<string, unknown> }>;
  accessors?: Array<{ count: number; type: string; componentType: number; bufferView?: number; byteOffset?: number; sparse?: unknown }>;
  meshes?: Array<{ primitives: Array<{ attributes: Record<string,number>; indices?: number; mode?: number; extensions?: Record<string,unknown> }> }>;
  nodes?: Array<{ mesh?: number; children?: number[] }>;
  scenes?: Array<{ nodes?: number[] }>; scene?: number;
  images?: Array<{ uri?: string; bufferView?: number; byteOffset?: number; sparse?: unknown }>;
}
export async function validateManifest(value: unknown, options: ValidateManifestOptions): Promise<Manifest> {
  const manifest = parseManifest(value);
  let root: string;
  try { root = await realpath(options.assetsDir); }
  catch (cause) { throw new ManifestError('file', options.assetsDir, 'Missing assets directory', { cause }); }
  const cache = new Map<string, Buffer>();
  async function asset(src: string): Promise<Buffer> {
    assertAssetPath(src); if (cache.has(src)) return cache.get(src)!;
    let file: string;
    try {
      file = await realpath(resolve(root, src)); const rel = relative(root, file);
      if (rel === '..' || rel.startsWith('../') || isAbsolute(rel) || !(await stat(file)).isFile()) throw new Error('Unsafe or missing file');
    } catch (cause) { throw new ManifestError('file', src, 'Missing or unsafe asset file', { cause }); }
    if (!isCredited(src, options.credits)) throw new ManifestError('credits', src, 'Asset must be listed in CREDITS.md');
    const data = await readFile(file); cache.set(src, data); return data;
  }
  for (const [key, model] of Object.entries(manifest.models)) {
    let triangles: number;
    if ('src' in model) {
      try { triangles = await inspect(model.src, await asset(model.src), asset); }
      catch (cause) { if (cause instanceof ManifestError) throw cause; throw new ManifestError('asset', key, `Invalid model ${model.src}`, { cause }); }
    } else {
      const [x,y,z] = model.size as [number,number,number];
      const geometry = model.primitive === 'box' ? new BoxGeometry(x,y,z) : model.primitive === 'capsule' ? new CapsuleGeometry(x,y,PRIMITIVE_SEGMENTS.capsule.cap,PRIMITIVE_SEGMENTS.capsule.radial) : new CylinderGeometry(x,z,y,PRIMITIVE_SEGMENTS.cylinder.radial);
      triangles = (geometry.index?.count ?? geometry.getAttribute('position').count) / 3; geometry.dispose();
    }
    const used = Object.values(manifest.visuals).filter(visual => visual.model === key);
    // Props and unused models receive the tower limit; a shared troop model gets the stricter limit.
    const limit = used.some(visual => visual.kind === 'troop') ? 300 : 5000;
    if (triangles > limit) throw new ManifestError('budget', key, `${triangles} triangles exceeds ${limit}`);
  }
  for (const effect of [...Object.values(manifest.visuals), ...Object.values(manifest.events)]) if (effect.sfx) await asset(effect.sfx);
  return manifest;
}
async function inspect(src: string, data: Buffer, asset: (src: string) => Promise<Buffer>): Promise<number> {
  let doc: Gltf; let binary: Buffer | undefined;
  if (data.length >= 12 && data.readUInt32LE(0) === 0x46546c67) {
    if (data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length) throw new Error('Invalid GLB header');
    let json: Buffer | undefined;
    for (let offset = 12; offset < data.length;) {
      if (offset + 8 > data.length) throw new Error('Truncated GLB');
      const length = data.readUInt32LE(offset), type = data.readUInt32LE(offset + 4); offset += 8;
      if (offset + length > data.length || length % 4) throw new Error('Invalid GLB chunk');
      if (type === 0x4e4f534a) json = data.subarray(offset, offset + length);
      if (type === 0x004e4942) binary = data.subarray(offset, offset + length);
      offset += length;
    }
    if (!json) throw new Error('Missing JSON'); doc = JSON.parse(json.toString()) as Gltf;
  } else { doc = JSON.parse(data.toString()) as Gltf; }
  if (doc.asset?.version !== '2.0') throw new Error('Expected glTF 2.0');
  const uriData = async (uri: string) => {
    if (uri.startsWith('data:')) {
      const match = /^data:[\w/+.-]+;base64,([A-Za-z0-9+/=]+)$/.exec(uri);
      if (!match) throw new Error('Invalid embedded URI'); return Buffer.from(match[1]!, 'base64');
    }
    assertAssetPath(uri); const prefix = dirname(src); return asset(prefix === '.' ? uri : `${prefix}/${uri}`);
  };
  const buffers = await Promise.all((doc.buffers ?? []).map(async (buffer, index) => {
    // EXT_meshopt_compression fallback buffers describe decompressed data and carry no bytes.
    if (!buffer.uri && index > 0 && (buffer.extensions?.EXT_meshopt_compression as { fallback?: boolean } | undefined)?.fallback) return Buffer.alloc(0);
    const bytes = buffer.uri ? await uriData(buffer.uri) : index === 0 ? binary : undefined;
    if (!bytes || bytes.length < buffer.byteLength) throw new Error('Missing/truncated buffer'); return bytes;
  }));
  const viewBytes = (index: number) => {
    const view = doc.bufferViews?.[index]; if (!view) throw new Error('Missing buffer view');
    const bytes = buffers[view.buffer]; const offset = view.byteOffset ?? 0;
    if (!bytes || offset < 0 || view.byteLength < 0 || offset + view.byteLength > bytes.length) throw new Error('Invalid buffer view');
    return bytes.subarray(offset, offset + view.byteLength);
  };
  // Meshopt views store compressed bytes elsewhere; the view itself only declares the decompressed length.
  const viewLength = (index: number): number => {
    const ext = doc.bufferViews?.[index]?.extensions?.EXT_meshopt_compression as { buffer: number; byteOffset?: number; byteLength: number } | undefined;
    if (!ext) return viewBytes(index).length;
    const bytes = buffers[ext.buffer], offset = ext.byteOffset ?? 0;
    if (!bytes || !Number.isSafeInteger(ext.byteLength) || offset < 0 || ext.byteLength < 0 || offset + ext.byteLength > bytes.length) throw new Error('Invalid compressed buffer view');
    return doc.bufferViews![index]!.byteLength;
  };
  // Inspect all referenced buffers/images, even if a scene currently hides a mesh.
  for (let index = 0; index < (doc.bufferViews?.length ?? 0); index++) viewLength(index);
  for (const image of doc.images ?? []) {
    const bytes = image.uri ? await uriData(image.uri) : image.bufferView !== undefined ? viewBytes(image.bufferView) : undefined;
    if (!bytes) throw new Error('Missing image'); const [width,height] = dimensions(bytes);
    if (width < 1 || height < 1) throw new Error('Invalid texture dimensions');
    if (width > 1024 || height > 1024) throw new ManifestError('budget', src, `${width}×${height} texture exceeds 1024×1024`);
  }
  function checkAccessor(index: number, position: boolean): number {
    const accessor = doc.accessors?.[index];
    if (!accessor || !Number.isSafeInteger(accessor.count) || accessor.count < 0) throw new Error('Invalid geometry accessor');
    if (position && accessor.type !== 'VEC3') throw new Error('Invalid position accessor');
    if (!position && (accessor.type !== 'SCALAR' || ![5121,5123,5125].includes(accessor.componentType))) throw new Error('Invalid index accessor');
    const componentBytes = ({ 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 } as Record<number,number>)[accessor.componentType];
    if (!componentBytes) throw new Error('Invalid accessor component type');
    if (accessor.bufferView !== undefined) {
      const view = doc.bufferViews?.[accessor.bufferView]; const length = viewLength(accessor.bufferView);
      const itemBytes = componentBytes * (position ? 3 : 1); const stride = view?.byteStride ?? itemBytes; const offset = accessor.byteOffset ?? 0;
      if (offset < 0 || stride < itemBytes || offset + (accessor.count ? (accessor.count - 1) * stride + itemBytes : 0) > length) throw new Error('Truncated geometry accessor');
    } else if (!accessor.sparse) throw new Error('Missing geometry data');
    return accessor.count;
  }
  const meshCounts = (doc.meshes ?? []).map(mesh => mesh.primitives.reduce((sum, primitive) => {
    const position = doc.accessors?.[primitive.attributes.POSITION!];
    const accessor = primitive.indices === undefined ? position : doc.accessors?.[primitive.indices];
    if (!position || !accessor || !Number.isSafeInteger(accessor.count) || accessor.count < 0) throw new Error('Invalid geometry accessor');
    // Draco compression changes topology independently of accessor metadata; reject rather than undercount.
    if (primitive.extensions?.KHR_draco_mesh_compression) throw new Error('Draco geometry unsupported by budget inspector');
    checkAccessor(primitive.attributes.POSITION!, true);
    if (primitive.indices !== undefined) checkAccessor(primitive.indices, false);
    const mode = primitive.mode ?? 4;
    if (mode === 4) { if (accessor.count % 3) throw new Error('Invalid triangle list'); return sum + accessor.count / 3; }
    if (mode === 5 || mode === 6) return sum + Math.max(0, accessor.count - 2);
    if (mode >= 0 && mode <= 3) return sum;
    throw new Error('Invalid primitive mode');
  }, 0));
  const walk = (index: number, parents: Set<number>): number => {
    const node = doc.nodes?.[index]; if (!node || parents.has(index)) throw new Error('Invalid scene graph');
    const next = new Set(parents).add(index);
    const count = node.mesh === undefined ? 0 : meshCounts[node.mesh]; if (count === undefined) throw new Error('Missing mesh');
    return count + (node.children ?? []).reduce((sum, child) => sum + walk(child, next), 0);
  };
  // Runtime GLTFLoader loads the default scene and merges every primitive, including repeated mesh nodes.
  const scene = doc.scenes?.[doc.scene ?? 0];
  if (scene) return (scene.nodes ?? []).reduce((sum,index) => sum + walk(index, new Set()), 0);
  return meshCounts.reduce((sum,count) => sum + count, 0);
}
function dimensions(bytes: Buffer): [number,number] {
  if (bytes.length >= 24 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) && bytes.toString('ascii',12,16) === 'IHDR') return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
  if (bytes.length >= 28 && bytes.subarray(0,12).equals(Buffer.from('ab4b5458203230bb0d0a1a0a','hex'))) return [bytes.readUInt32LE(20),bytes.readUInt32LE(24)];
  if (bytes.length >= 30 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') {
    const format = bytes.toString('ascii',12,16);
    if (format === 'VP8X') return [1 + bytes.readUIntLE(24,3),1 + bytes.readUIntLE(27,3)];
    if (format === 'VP8 ') return [bytes.readUInt16LE(26) & 0x3fff,bytes.readUInt16LE(28) & 0x3fff];
    if (format === 'VP8L') { const bits = bytes.readUInt32LE(21); return [1 + (bits & 0x3fff),1 + ((bits >>> 14) & 0x3fff)]; }
  }
  if (bytes.length >= 4 && bytes.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) throw new Error('Invalid JPEG');
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++]!; if (marker === 0xd9 || marker === 0xda) break;
      const length = bytes.readUInt16BE(offset); if (length < 2 || offset + length > bytes.length) throw new Error('Truncated JPEG');
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 7) return [bytes.readUInt16BE(offset + 5),bytes.readUInt16BE(offset + 3)];
      offset += length;
    }
  }
  throw new Error('Unsupported or malformed texture (PNG/JPEG/WebP/KTX2 required)');
}
