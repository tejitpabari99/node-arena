import { loadContent } from '@node-arena/content';
import { contentFiles } from '../src/app/boot';
const loaded=loadContent(contentFiles());
export const identities=Object.fromEntries(Object.entries(loaded.compiled).map(([id,level])=>[id,{simHash:level.simHash,botHash:level.botHash}]));
Object.assign(window,{contentIdentities:identities});
