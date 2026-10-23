import type { ContentFiles } from '@node-arena/content';
const raw=import.meta.glob<string>('../../../../packages/content/data/**/*.json',{eager:true,query:'?raw',import:'default'});
/** Data files include the campaign catalog; card order comes exclusively from its entries. */
export function contentFiles(): ContentFiles {
  return Object.fromEntries(Object.entries(raw).map(([path,value])=>[path.replace('../../../../packages/content/',''),value]));
}
