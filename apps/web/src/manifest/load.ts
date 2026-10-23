import { createAjv, ManifestSchema, type ManifestV2 } from '@node-arena/content';
import { RendererRegistry } from '../render/registry.js';
import { registerWorldRenderers } from '../render/world.js';
import { AssetError, assertManifestReferences, ManifestError } from './resolve.js';

const schema = createAjv().compile<ManifestV2>(ManifestSchema);

/**
 * Schema-validates a v2 manifest, then checks its references (renderer kinds, asset paths, fx keys).
 * `registry` defaults to a fresh one populated by `registerWorldRenderers` (all SP07 kinds); pass the world's own
 * registry to validate against exactly the kinds it will use. Never validates against the process-wide registry
 * (renderers register lazily, so it may be empty at load time).
 */
export function parseManifest(value: unknown, registry?: Pick<RendererRegistry, 'has'>): ManifestV2 {
  if (!schema(value)) throw new ManifestError('schema', 'manifest', schema.errors?.map(error => `${error.instancePath} ${error.message}`).join('; ') ?? 'Invalid schema');
  let reg = registry;
  if (!reg) { const fresh = new RendererRegistry(); registerWorldRenderers(fresh, value); reg = fresh; }
  assertManifestReferences(value, reg);
  return value;
}

/** Transport failures retry twice; malformed JSON/schema fails immediately with typed context. */
export async function loadManifest(src = '/manifest.json', fetcher: typeof fetch = fetch, registry?: Pick<RendererRegistry, 'has'>): Promise<ManifestV2> {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { response = await fetcher(src); if (!response.ok) throw new Error(`HTTP ${response.status}`); break; }
    catch (cause) { if (attempt === 2) throw new AssetError('manifest', src, cause); }
  }
  try { return parseManifest(await response!.json(), registry); }
  catch (cause) { if (cause instanceof ManifestError) throw cause; throw new AssetError('manifest', src, cause); }
}
