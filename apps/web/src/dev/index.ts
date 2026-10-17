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
export interface PerfSnapshot {fps:number; frameP95:number; jsMs:number; simStepMs:number; drawCalls:number; triangles:number; troops:number}
export function createPerfMetrics(capacity=120) {
  let previous:number|undefined;
  const frames:number[]=[],cpu:number[]=[],steps:number[]=[];
  let counters={drawCalls:0,triangles:0,troops:0};
  const push=(list:number[],value:number)=>{list.push(value); if(list.length>capacity) list.shift();};
  const mean=(list:number[])=>list.length?list.reduce((a,b)=>a+b,0)/list.length:0;
  return {
    frame(now:number,jsMs:number,simStepMs:number,drawCalls:number,triangles:number,troops:number) {
      if(previous!==undefined && now>previous) push(frames,now-previous); previous=now;
      push(cpu,jsMs); push(steps,simStepMs); counters={drawCalls,triangles,troops};
    },
    snapshot():PerfSnapshot { const sorted=[...frames].sort((a,b)=>a-b); return {fps:mean(frames)?1000/mean(frames):0,frameP95:sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]??0,jsMs:mean(cpu),simStepMs:mean(steps),...counters}; }
  };
}
