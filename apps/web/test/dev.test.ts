import { describe, it, expect, vi } from 'vitest';
import { tuningFields, editField, createPerfMetrics } from '../src/dev';
import { contentFiles } from '../src/app/boot';
import { createAppController } from '../src/app/state';
import { create } from '@node-arena/sim';
import { NUMBER_FILL, NUMBER_OUTLINE } from '../src/render/roof-texture';
import { createSaveStore, defaultSave } from '../src/save';
import { parseManifest } from '../src/manifest/load';
import manifestJSON from './fixtures/greybox-manifest.json';
import { loadContent, compileLevel } from '@node-arena/content';
describe('schema tuning and telemetry', () => {
  it('generates authored fields and absent level override fields without mutating source', () => {
    const files = contentFiles(), before = JSON.stringify(files), fields = tuningFields(files);
    expect(fields.some(f => f.pointer === '/components/generates/ratePerSec')).toBe(true);
    expect(fields.some(f => f.pointer.includes('/overrides/archetypes/') && f.pointer.endsWith('/ratePerSec'))).toBe(true);
    expect(fields.some(f => f.pointer.includes('/overrides/troops/') && f.pointer.endsWith('/speed'))).toBe(true);
    const field = fields.find(f => f.pointer === '/components/generates/ratePerSec')!;
    const edited = editField(files, field, 7);
    expect(JSON.stringify(files)).toBe(before);
    expect(JSON.parse(edited[field.file] as string).components.generates.ratePerSec).toBe(7);
    expect(compileLevel(loadContent(edited), 'sample')).toBeDefined();
    const array=fields.find(f=>f.pointer==='/overrides/archetypes/standard/components/drawsLines/extraSlotAbove/1')!;
    const arrayEdit=editField(files,array,35);
    expect(JSON.parse(arrayEdit[array.file]!).overrides.archetypes.standard.components.drawsLines.extraSlotAbove).toEqual([10,35]);
    expect(compileLevel(loadContent(arrayEdit),'sample')).toBeDefined();
  });
  it('validates before swapping sim, restarts with edited rate and exports authored units', async () => {
    const files = contentFiles();
    const app = createAppController({files, devEnabled:true, autoStart:false, save:createSaveStore({storage:null}), loadManifest:async()=>parseManifest(manifestJSON)});
    await app.boot(); await app.startLevel('sample');
    app.step(5); const previous = app.driver;
    const field = app.tuningFields.find(f=>f.pointer === '/components/generates/ratePerSec' && f.file.endsWith('/standard.json'))!;
    expect(await app.applyDevFiles(editField(app.contentFiles,field,-1))).toBe(false);
    expect(app.driver).toBe(previous); expect(app.snapshot().devError).toBeTruthy();
    expect(await app.applyDevFiles(editField(app.contentFiles,field,7))).toBe(true);
    expect(app.driver).not.toBe(previous); expect(app.driver!.sim.tick).toBe(0);
    expect(app.snapshot().devTuned).toBe(true);
    expect(JSON.parse(app.contentFiles[field.file] as string).components.generates.ratePerSec).toBe(7);
    app.step(20);
    expect(app.driver!.sim.view.tower.col['garrison.count']![0]).toBe(17);
    app.dispose();
  });
  it('never completes tuned matches, including after restart, next, and menu', async()=> {
    const app=createAppController({files:contentFiles(),devEnabled:true,autoStart:false,save:createSaveStore({storage:null}),loadManifest:async()=>parseManifest(manifestJSON),
      createSim:(level,seed)=>create({...level,towers:level.towers.map(t=>({...t,owner:level.players.findIndex(p=>p.kind==='human')}))},seed)});
    await app.boot(); await app.startLevel('sample');
    const field=app.tuningFields.find(f=>f.pointer==='/components/generates/ratePerSec')!;
    await app.applyDevFiles(editField(app.contentFiles,field,7)); app.step();
    expect(app.snapshot().result?.outcome).toBe('won'); expect(app.snapshot().save.completed).toEqual({});
    app.menu(); await app.startLevel('sample'); app.step(); expect(app.snapshot().save.completed).toEqual({}); app.dispose();
  });
  it('honours system reduced-motion on fresh saves without overriding explicit saved preference',()=> {
    vi.stubGlobal('window',{matchMedia:()=>({matches:true})});
    try {
      expect(createSaveStore({storage:null}).snapshot().settings.reducedMotion).toBe(true);
      const saved=defaultSave(); saved.settings.reducedMotion=false;
      expect(createSaveStore({storage:{getItem:()=>JSON.stringify(saved),setItem:()=>{}}}).snapshot().settings.reducedMotion).toBe(false);
    } finally {vi.unstubAllGlobals();}
  });
  it('records rolling real frame timings and p95', () => {
    const metrics=createPerfMetrics(20);
    for(let i=0;i<20;i++) metrics.frame(i*16,2,1,3,100,12);
    expect(metrics.snapshot().fps).toBeCloseTo(62.5);
    expect(metrics.snapshot().frameP95).toBe(16);
    expect(metrics.snapshot().jsMs).toBe(2);
    expect(metrics.snapshot().simStepMs).toBe(1);
    expect(metrics.snapshot().troops).toBe(12);
  });
  it('roof number fill vs outline has WCAG contrast above 4.5', () => {
    const linear=(v:number)=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
    const luminance=(rgb:number[])=>rgb.map(v=>linear(v/255)).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i]!,0);
    const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
    expect((luminance(rgb(NUMBER_FILL))+.05)/(luminance(rgb(NUMBER_OUTLINE))+.05)).toBeGreaterThanOrEqual(4.5);
  });
});
