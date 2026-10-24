import type { ContentFiles } from '@node-arena/content';
const raw=import.meta.glob<string>(['../../../../packages/content/data/levels/na-kane.json','../../../../packages/content/data/campaigns/kane.json'],{eager:true,query:'?raw',import:'default'});
/** Test/dev-only: kane files are excluded from boot.ts's glob so production never bundles them. Keys match boot.ts. */
export function kaneContentFiles(): ContentFiles {
  return Object.fromEntries(Object.entries(raw).map(([path,value])=>[path.replace('../../../../packages/content/',''),value]));
}
