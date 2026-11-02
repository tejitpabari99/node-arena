import * as T from '/root/projects/node-arena/.worktrees/scratch-reart/apps/web/node_modules/three/build/three.module.js';
import {GLTFLoader} from '/root/projects/node-arena/.worktrees/scratch-reart/apps/web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import fs from 'fs';
for (const f of process.argv.slice(2)) {
  const b = fs.readFileSync(f); const ab=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
  const g = await new Promise((res,rej)=>new GLTFLoader().parse(ab,'',res,rej));
  console.log('==',f); g.scene.traverse(o=>{ const bb=new T.Box3().setFromObject(o); console.log(o.type,o.name,o.position.toArray().map(x=>+x.toFixed(2)),o.scale.toArray().map(x=>+x.toFixed(2)),JSON.stringify(o.userData), o.isMesh?o.geometry.attributes.position.count/(o.geometry.index?1:3):'', bb.min.toArray().map(x=>+x.toFixed(2)), bb.max.toArray().map(x=>+x.toFixed(2)));});
}
