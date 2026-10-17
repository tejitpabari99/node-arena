import { createAjv, ManifestJsonSchema, type Manifest } from '@node-arena/content';
import { AssetError, assertManifestReferences, ManifestError } from './resolve.js';
const schema = createAjv().compile<Manifest>(ManifestJsonSchema);
export function parseManifest(value: unknown): Manifest {
  if (!schema(value)) throw new ManifestError('schema', 'manifest', schema.errors?.map(error => `${error.instancePath} ${error.message}`).join('; ') ?? 'Invalid schema');
  assertManifestReferences(value); return value;
}
/** Transport failures retry twice; malformed JSON/schema fails immediately with typed context. */
export async function loadManifest(src = '/manifest.json', fetcher: typeof fetch = fetch): Promise<Manifest> {
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { response = await fetcher(src); if (!response.ok) throw new Error(`HTTP ${response.status}`); break; }
    catch (cause) { if (attempt === 2) throw new AssetError('manifest', src, cause); }
  }
  try { return parseManifest(await response!.json()); }
  catch (cause) { if (cause instanceof ManifestError) throw cause; throw new AssetError('manifest', src, cause); }
}
