/** Synthetic triangle GLB, authored solely for manifest pipeline browser tests. */
export function syntheticGlb(): Buffer {
  const bin = Buffer.alloc(36);
  [-2,0,0,2,0,0,0,6,0].forEach((v,i)=>bin.writeFloatLE(v,i*4));
  const gltf={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],materials:[{name:'Accent',pbrMetallicRoughness:{baseColorFactor:[0.4,0.8,0.4,1],metallicFactor:0,roughnessFactor:1},doubleSided:true}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-2,0,0],max:[2,6,0]}]};
  const json=Buffer.from(JSON.stringify(gltf));const padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);
  const out=Buffer.alloc(12+8+padded.length+8+bin.length);out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(padded.length,12);out.writeUInt32LE(0x4e4f534a,16);padded.copy(out,20);const offset=20+padded.length;out.writeUInt32LE(bin.length,offset);out.writeUInt32LE(0x004e4942,offset+4);bin.copy(out,offset+8);return out;
}
