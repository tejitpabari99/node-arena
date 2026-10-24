import { it,expect } from 'vitest';
import type { VNode } from 'preact';
import { Picker } from '../../src/ui/Picker';
import { defaultSave } from '../../src/save';
import type { AppSnapshot } from '../../src/app/state';
function cards(node:unknown,out:VNode<Record<string,unknown>>[]=[]){if(Array.isArray(node))node.forEach(n=>cards(n,out));else if(node&&typeof node==='object'&&'props' in node){const n=node as VNode<Record<string,unknown>>;if(n.props['data-level-id'])out.push(n);cards(n.props.children,out);}return out;}
it('renders completed, available and disabled locked cards, restoring last-played focus',()=>{const save=defaultSave();save.completed.a={firstAt:'2026-10-23'};save.lastLevel='b';const state={save,customLevels:[],levels:[{id:'a',position:4,number:1,name:'Level 1'},{id:'b',position:5,number:2,name:'Level 2'},{id:'c',position:6,number:3,name:'Level 3'}]} as unknown as AppSnapshot;const nodes=cards(Picker({state,onStart:()=>{},onMute:()=>{},onCredits:()=>{}}));expect(nodes.map(n=>n.props['data-state'])).toEqual(['completed','unlocked','locked']);expect(nodes.map(n=>n.props.disabled)).toEqual([false,false,true]);const focus=()=>{focused=true;};let focused=false;(nodes[1]!.ref as (e:unknown)=>void)({focus});expect(focused).toBe(true);});

it('hides custom section when absent and labels always-open custom cards by name',()=>{
  const save=defaultSave(),callbacks={onStart:()=>{},onMute:()=>{},onCredits:()=>{}};
  const state={save,levels:[{id:'a',position:4,number:1,name:'Level 1'}],customLevels:[]} as unknown as AppSnapshot;
  function grids(node:unknown,out:VNode<Record<string,unknown>>[]=[]):VNode<Record<string,unknown>>[]{if(Array.isArray(node))node.forEach(n=>grids(n,out));else if(node&&typeof node==='object'&&'props' in node){const n=node as VNode<Record<string,unknown>>;if(String(n.props.class).startsWith('level-grid'))out.push(n);grids(n.props.children,out);}return out;}
  expect(grids(Picker({state,...callbacks})).map(n=>n.props.class)).toEqual(['level-grid campaign']);
  const custom={...state,customLevels:[{id:'na-test',position:1,number:1,name:'My battle'}]};
  const tree=Picker({state:custom,...callbacks}),nodes=cards(tree);
  expect(grids(tree).map(n=>n.props.class)).toEqual(['level-grid campaign','level-grid custom']);
  expect(nodes[1]!.props['aria-label']).toBe('My battle');expect(nodes[1]!.props.disabled).toBe(false);
  expect((nodes[1]!.props.children as VNode[])[0]!.props.children).toBe('My battle');
});
