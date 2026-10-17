import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileLevel, loadContent, validateContent } from '@node-arena/content';
import { fixtureFiles } from '../src/test-harness/fixtures';
const root=resolve(import.meta.dirname,'../../../packages/content');
const files: Record<string,string> = {};
function read(dir:string) { for(const entry of readdirSync(resolve(root,dir),{withFileTypes:true})) { const p=`${dir}/${entry.name}`;if(entry.isDirectory())read(p);else if(entry.name.endsWith('.json'))files[p]=readFileSync(resolve(root,p),'utf8'); } }
read('data');files['content.json']=readFileSync(resolve(root,'content.json'),'utf8');
describe('authored harness fixtures',()=>{for(const mode of ['normal','visual','cut','capture','victory','timeout','stress']) it(`${mode} validates and compiles 20 levels`,()=>{
 const f=fixtureFiles(files,mode);expect(validateContent(f).errors).toEqual([]);const loaded=loadContent(f);for(let i=1;i<=20;i++)expect(compileLevel(loaded,`fixture-${i}`).id).toBe(`fixture-${i}`);
});});
