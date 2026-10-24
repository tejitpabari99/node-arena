export interface TestHookRequest { testing: boolean; fixture: 'win' | 'loss' | null; level: string | null; seed: number; speed: 1 | 2; kane: boolean }
/** Production does not import this module; still explicitly inert when disabled. */
export function testHookRequest(search: string, enabled: boolean): TestHookRequest {
  const defaults: TestHookRequest={testing:false,fixture:null,level:null,seed:1,speed:1,kane:false};
  if(!enabled)return defaults;
  const q=new URLSearchParams(search),testing=q.get('test')==='1',fixture=q.get('fixture'),seed=Number(q.get('seed')??1);
  return {testing,fixture:testing&&(fixture==='win'||fixture==='loss')?fixture:null,level:q.get('level'),seed:Number.isSafeInteger(seed)&&seed>=0&&seed<=0xffffffff?seed:1,speed:q.get('speed')==='2'?2:1,kane:q.get('kane')==='1'};
}
