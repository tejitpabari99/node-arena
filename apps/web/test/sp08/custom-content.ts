import type { ContentFiles } from '@node-arena/content';
/** Synthetic files exercise the normal loader without changing shipped content or locks. */
export function withoutCustomLevels(files:ContentFiles):ContentFiles {
  const copy={...files};delete copy['data/campaigns/custom.json'];return copy;
}
export function withCustomLevels(files:ContentFiles):ContentFiles {
  const copy=withoutCustomLevels(files),source=files['data/levels/levelview-1.json']!;
  const base=typeof source==='string'?JSON.parse(source):source;
  for(const [id,name] of [['na-first','First custom battle'],['na-last','Last custom battle']])
    copy[`data/levels/${id}.json`]=JSON.stringify({...base,id,name,source:undefined});
  copy['data/campaigns/custom.json']=JSON.stringify({$schema:'../../schemas/campaign.schema.json',schemaVersion:'2.0.0',id:'custom',entries:[{level:'na-last',position:8},{level:'na-first',position:2}]});
  return copy;
}
