import { it,expect } from 'vitest';
import { ResultPopup } from '../../src/ui/ResultPopup';
function texts(node:unknown,out:string[]=[]):string[]{if(Array.isArray(node))node.forEach(n=>texts(n,out));else if(typeof node==='string')out.push(node);else if(node&&typeof node==='object'&&'props' in node)texts((node as {props:{children?:unknown}}).props.children,out);return out;}
const base={won:false,hasNext:false,onNext(){},onReplay(){},onLevels(){}};
it('normal result shows Levels, editor-launched result shows Edit level instead',()=>{
  const normal=texts(ResultPopup(base));expect(normal).toContain('Levels');expect(normal).not.toContain('Edit level');
  const editor=texts(ResultPopup({...base,onEditLevel(){}}));expect(editor).toContain('Edit level');expect(editor).not.toContain('Levels');expect(editor).toContain('Retry');
});
