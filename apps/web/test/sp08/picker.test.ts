import { it,expect } from 'vitest';
import type { VNode } from 'preact';
import { Picker } from '../../src/ui/Picker';
import { defaultSave } from '../../src/save';
import type { AppSnapshot } from '../../src/app/state';
function cards(node:unknown,out:VNode<Record<string,unknown>>[]=[]){if(Array.isArray(node))node.forEach(n=>cards(n,out));else if(node&&typeof node==='object'&&'props' in node){const n=node as VNode<Record<string,unknown>>;if(n.props['data-level-id'])out.push(n);cards(n.props.children,out);}return out;}
it('renders completed, available and disabled locked cards, restoring last-played focus',()=>{const save=defaultSave();save.completed.a={firstAt:'2026-10-23'};save.lastLevel='b';const state={save,levels:[{id:'a',position:4,number:1,name:'Level 1'},{id:'b',position:5,number:2,name:'Level 2'},{id:'c',position:6,number:3,name:'Level 3'}]} as unknown as AppSnapshot;const nodes=cards(Picker({state,onStart:()=>{},onMute:()=>{},onCredits:()=>{}}));expect(nodes.map(n=>n.props['data-state'])).toEqual(['completed','unlocked','locked']);expect(nodes.map(n=>n.props.disabled)).toEqual([false,false,true]);const focus=()=>{focused=true;};let focused=false;(nodes[1]!.ref as (e:unknown)=>void)({focus});expect(focused).toBe(true);});
