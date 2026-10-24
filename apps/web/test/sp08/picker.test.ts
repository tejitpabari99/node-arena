import { it,expect } from 'vitest';
import type { VNode } from 'preact';
import { Picker } from '../../src/ui/Picker';
import { defaultSave } from '../../src/save';
import type { AppSnapshot } from '../../src/app/state';
function cards(node:unknown,out:VNode<Record<string,unknown>>[]=[]){if(Array.isArray(node))node.forEach(n=>cards(n,out));else if(node&&typeof node==='object'&&'props' in node){const n=node as VNode<Record<string,unknown>>;if(n.props['data-level-id'])out.push(n);cards(n.props.children,out);}return out;}
it('renders completed, available and disabled locked cards, restoring last-played focus',()=>{const save=defaultSave();save.completed.a={firstAt:'2026-10-23'};save.lastLevel='b';const state={save,customLevels:[],pickerView:'campaign',levels:[{id:'a',position:4,number:1,name:'Level 1'},{id:'b',position:5,number:2,name:'Level 2'},{id:'c',position:6,number:3,name:'Level 3'}]} as unknown as AppSnapshot;const nodes=cards(Picker({state,onStart:()=>{},onMute:()=>{},onCredits:()=>{}}));expect(nodes.map(n=>n.props['data-state'])).toEqual(['completed','unlocked','locked']);expect(nodes.map(n=>n.props.disabled)).toEqual([false,false,true]);const focus=()=>{focused=true;};let focused=false;(nodes[1]!.ref as (e:unknown)=>void)({focus});expect(focused).toBe(true);});

it('shows main menu, campaign without edit links, and custom cards named with edit links',()=>{
  const save=defaultSave(),callbacks={onStart:()=>{},onMute:()=>{},onCredits:()=>{}};
  const base={save,levels:[{id:'a',position:4,number:1,name:'Level 1'}],customLevels:[{id:'na-test',position:1,number:1,name:'My battle'}]};
  function find(node:unknown,test:(n:VNode<Record<string,unknown>>)=>boolean,out:VNode<Record<string,unknown>>[]=[]):VNode<Record<string,unknown>>[]{if(Array.isArray(node))node.forEach(n=>find(n,test,out));else if(node&&typeof node==='object'&&'props' in node){const n=node as VNode<Record<string,unknown>>;if(test(n))out.push(n);find(n.props.children,test,out);}return out;}
  const cls=(n:VNode<Record<string,unknown>>)=>String(n.props.class??'');
  const main=Picker({state:{...base,pickerView:'main'} as unknown as AppSnapshot,...callbacks});
  expect(find(main,n=>cls(n).includes('menu-button')).length).toBe(2);expect(find(main,n=>cls(n).startsWith('level-grid')).map(cls)).toEqual(['level-grid menu']);
  const campaign=Picker({state:{...base,pickerView:'campaign'} as unknown as AppSnapshot,...callbacks});
  expect(find(campaign,n=>cls(n).startsWith('level-grid')).map(cls)).toEqual(['level-grid campaign']);expect(find(campaign,n=>cls(n)==='level-edit')).toHaveLength(0);
  const custom=Picker({state:{...base,pickerView:'custom'} as unknown as AppSnapshot,...callbacks}),nodes=cards(custom);
  expect(find(custom,n=>cls(n).startsWith('level-grid')).map(cls)).toEqual(['level-grid custom']);
  expect(nodes[0]!.props['aria-label']).toBe('My battle');expect(nodes[0]!.props.disabled).toBe(false);
  expect((nodes[0]!.props.children as VNode[])[0]!.props.children).toBe('My battle');
  expect(find(custom,n=>cls(n)==='level-edit')).toHaveLength(1);expect(find(custom,n=>cls(n).includes('create-card'))).toHaveLength(1);
});
