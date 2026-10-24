import { computeRequires, loadCatalog, type ContentFiles } from '@node-arena/content';
import type { AppOptions } from '../app/state.js';
import { createSaveStore } from '../save/index.js';
import { isDraftId, type LevelDoc } from './document.js';

/** Normal app inputs, with a private save and the unsaved working copy in its real slot. */
export function editorPlayOptions(files: ContentFiles, doc: LevelDoc): Pick<AppOptions, 'files' | 'campaignId'> & { save: ReturnType<typeof createSaveStore> } {
  if (!isDraftId(doc.id)) throw new Error('Play requires a real na- level id.');
  const level = structuredClone(doc);
  level.requires = computeRequires(loadCatalog(files), level);
  const memory = new Map<string, string>();
  return {
    files: {
      ...files,
      [`data/levels/${level.id}.json`]: JSON.stringify(level),
      'data/campaigns/custom.json': JSON.stringify({ $schema: '../../schemas/campaign.schema.json', schemaVersion: '2.0.0', id: 'custom', entries: [{ level: level.id, position: 1 }] }),
    },
    campaignId: 'custom',
    save: createSaveStore({ storage: { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); } } }),
  };
}
