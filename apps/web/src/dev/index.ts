import { CoreSchemas, ComponentParamsSchema, COMPONENT_REGISTRY, type ContentFileMap } from '@node-arena/content';
type Json = Record<string, any>;
export interface TuningField { file: string; pointer: string; type: 'number'|'integer'|'boolean'; value: number|boolean; minimum?: number; maximum?: number; step: string; inherited: boolean; array?: {pointer:string; values:any[]} }
export function cloneFiles(files: ContentFileMap): Record<string,string> {
  return Object.fromEntries(Object.entries(files).map(([path,value])=>[path,typeof value==='string'?value:JSON.stringify(value)]));
}
const escape = (key:string)=>key.replace(/~/g,'~0').replace(/\//g,'~1');
export function tuningFields(files: ContentFileMap): TuningField[] {
  const authored=Object.entries(cloneFiles(files)).map(([file,raw])=>({file,value:JSON.parse(raw) as Json}));
  const troops=authored.filter(e=>'speed' in e.value), archetypes=authored.filter(e=>'components' in e.value);
  const result:TuningField[]=[];
  function inheritedComponents(archetype:Json, seen=new Set<string>()):Json {
    if(seen.has(archetype.id)) return {}; seen.add(archetype.id);
    const parent=archetypes.find(a=>a.value.id===archetype.extends)?.value;
    const base=parent?inheritedComponents(parent,seen):{};
    for(const [name,params] of Object.entries(archetype.components??{})) base[name]={...base[name],...(params as Json)};
    return base;
  }
  function walk(file:string,schema:Json,value:any,path:string,fallback:any=value, array?: {pointer:string;values:any[]}) {
    if(schema.$ref) {
      const [id,fragment]=schema.$ref.split('#');
      let resolved:any=Object.values(CoreSchemas).find(s=>(s as Json).$id===id);
      if(fragment) for(const key of fragment.split('/').slice(1)) resolved=resolved?.[key];
      if(resolved) walk(file,resolved,value,path,fallback); return;
    }
    if(['number','integer','boolean'].includes(schema.type)) {
      const actual=value??fallback;
      if(typeof actual!=='number' && typeof actual!=='boolean') return;
      result.push({file,pointer:path,type:schema.type,value:actual,minimum:schema.minimum??schema.exclusiveMinimum,maximum:schema.maximum,step:schema.type==='integer'?'1':'any',inherited:value===undefined, ...(array?{array}:{})}); return;
    }
    if(schema.type==='array') { (value??fallback??[]).forEach((v:any,i:number)=>walk(file,schema.items,value?.[i],`${path}/${i}`,v,{pointer:path,values:value??fallback??[]})); return; }
    if(schema.type==='object') {
      for(const [key,child] of Object.entries(schema.properties??{})) walk(file,child as Json,value?.[key],`${path}/${escape(key)}`,fallback?.[key]);
      for(const [key,childValue] of Object.entries(value??fallback??{})) {
        if(schema.properties?.[key]) continue;
        const pattern=Object.entries(schema.patternProperties??{}).find(([p])=>new RegExp(p).test(key));
        if(pattern) walk(file,pattern[1] as Json,value?.[key],`${path}/${escape(key)}`,childValue);
      }
    }
  }
  function componentFields(file:string,components:Json,path:string,actual:Json=components) {
    for(const [name,params] of Object.entries(components??{})) {
      const definition=COMPONENT_REGISTRY.components[name]; if(!definition) continue;
      // Closed mechanics registry selects the supported params; schema supplies their shape and authored units.
      for(const param of Object.keys(definition.params)) {
        const shape=(ComponentParamsSchema.properties as Json)[param];
        if(shape) walk(file,shape,actual?.[name]?.[param],`${path}/${escape(name)}/${escape(param)}`,(params as Json)[param]);
      }
    }
  }
  for(const {file,value} of authored) {
    if('defaults' in value) walk(file,CoreSchemas.balance.properties.defaults,value.defaults,'/defaults');
    else if('speed' in value) walk(file,CoreSchemas.troop,value,'');
    else if('components' in value) {
      walk(file,CoreSchemas.archetype.properties.footprintRadius,value.footprintRadius,'/footprintRadius');
      componentFields(file,inheritedComponents(value),'/components',value.components);
    } else if('towers' in value) {
      const overrides=CoreSchemas.level.properties.overrides;
      const balance=authored.find(e=>'defaults' in e.value)?.value;
      walk(file,overrides.properties.globals,value.overrides?.globals,'/overrides/globals',{timeLimitSec:value.timeLimitSec??balance?.defaults.timeLimitSec});
      const troopSchema=Object.values(overrides.properties.troops.patternProperties)[0] as Json;
      for(const troop of troops) walk(file,troopSchema,value.overrides?.troops?.[troop.value.id],`/overrides/troops/${escape(troop.value.id)}`,troop.value);
      for(const archetype of archetypes) componentFields(file,inheritedComponents(archetype.value),`/overrides/archetypes/${escape(archetype.value.id)}/components`,value.overrides?.archetypes?.[archetype.value.id]?.components??{});
    }
  }
  return result;
}
export function editField(files:ContentFileMap,field:TuningField,value:number|boolean) {
  const cloned=cloneFiles(files), document=JSON.parse(cloned[field.file]!);
  const keys=field.pointer.split('/').slice(1).map(k=>k.replace(/~1/g,'/').replace(/~0/g,'~'));
  let target=document;
  for(let i=0;i<keys.length-1;i++) {
    const pointer='/'+keys.slice(0,i+1).map(escape).join('/');
    target=target[keys[i]!]??(target[keys[i]!]=field.array?.pointer===pointer?[...field.array.values]:{});
  }
  target[keys.at(-1)!]=value; cloned[field.file]=JSON.stringify(document,null,2)+'\n'; return cloned;
}
export function exportFiles(files:ContentFileMap,original:ContentFileMap) {
  const baseline=cloneFiles(original);
  return Object.entries(cloneFiles(files)).filter(([path,raw])=>JSON.stringify(JSON.parse(raw))!==JSON.stringify(JSON.parse(baseline[path]??'null'))).map(([path,json])=>({path,json}));
}
export function downloadFiles(files:readonly {path:string;json:string}[]) {
  for(const file of files) {
    const url=URL.createObjectURL(new Blob([file.json],{type:'application/json'}));
    const link=document.createElement('a'); link.href=url; link.download=file.path.replace(/\//g,'__'); link.dataset.contentPath=file.path;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),0);
  }
}
export interface PerfSample {n:number; fpsMean:number; fps1Low:number; frameP95:number; frameP99:number; jsMsMean:number; jsMsP95:number; renderMsMean:number; renderMsP95:number}
export interface PerfSnapshot {fps:number; frameP95:number; frameP99:number; jsMs:number; simStepMs:number; renderMs:number; drawCalls:number; triangles:number; troops:number; frames:number[]; sample:PerfSample}
/** Nearest-rank percentile (q in 0..1) of an ascending-sorted list. */
export function percentile(sorted:readonly number[],q:number) { return sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(sorted.length*q)-1))]??0; }
/** Fixed-size ring (preallocated; push never allocates). */
function ring(size:number) {
  const data=new Float64Array(size); let head=0,count=0;
  return {
    clear() { head=0; count=0; },
    push(v:number) { data[head]=v; head=(head+1)%size; if(count<size) count++; },
    /** Last `n` values (default all), oldest first. */
    last(n=count):number[] { const k=Math.min(n,count),out=new Array<number>(k); for(let i=0;i<k;i++) out[i]=data[(head-k+i+size*2)%size]!; return out; },
  };
}
const meanOf=(list:readonly number[])=>list.length?list.reduce((a,b)=>a+b,0)/list.length:0;
const sortedCopy=(list:readonly number[])=>[...list].sort((a,b)=>a-b);
/**
 * `capacity` = rolling window for the HUD stats; `history` = ring size for `frames[]` and `sample` (R7: 30 s x 240 Hz = 7200).
 * `sample.fps1Low` = 1000 / mean of the worst 1% frame times of the history.
 */
export function createPerfMetrics(capacity=120,history=7200) {
  const size=Math.max(capacity,history);
  let previous:number|undefined;
  const frames=ring(size),cpu=ring(size),steps=ring(size),renders=ring(size);
  let counters={drawCalls:0,triangles:0,troops:0};
  return {
    /** Drop collected history (end of warm-up). */
    reset() { previous=undefined; for(const r of [frames,cpu,steps,renders]) r.clear(); },
    frame(now:number,jsMs:number,simStepMs:number,drawCalls:number,triangles:number,troops:number,renderMs=0) {
      if(previous!==undefined && now>previous) frames.push(now-previous); previous=now;
      cpu.push(jsMs); steps.push(simStepMs); renders.push(renderMs); counters={drawCalls,triangles,troops};
    },
    snapshot():PerfSnapshot {
      const all=frames.last(),win=frames.last(capacity),sorted=sortedCopy(win),allSorted=sortedCopy(all);
      const worst=allSorted.slice(Math.max(0,allSorted.length-Math.max(1,Math.ceil(allSorted.length*.01)))),cpuAll=sortedCopy(cpu.last()),renderAll=renders.last();
      const renderSorted=sortedCopy(renderAll);
      return {fps:meanOf(win)?1000/meanOf(win):0,frameP95:percentile(sorted,.95),frameP99:percentile(sorted,.99),jsMs:meanOf(cpu.last(capacity)),simStepMs:meanOf(steps.last(capacity)),renderMs:meanOf(renders.last(capacity)),...counters,frames:all,
        sample:{n:all.length,fpsMean:meanOf(all)?1000/meanOf(all):0,fps1Low:meanOf(worst)?1000/meanOf(worst):0,frameP95:percentile(allSorted,.95),frameP99:percentile(allSorted,.99),jsMsMean:meanOf(cpuAll),jsMsP95:percentile(cpuAll,.95),renderMsMean:meanOf(renderAll),renderMsP95:percentile(renderSorted,.95)}};
    }
  };
}
