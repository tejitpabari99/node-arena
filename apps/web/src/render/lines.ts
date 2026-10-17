import { BufferGeometry, Float32BufferAttribute, Color, Mesh, ShaderMaterial, DoubleSide, Vector3, Vector2, type Camera, type Scene } from 'three';
import type { Manifest } from '@node-arena/content';
import type { SimEvent, SimView } from '@node-arena/sim';
import { createManifestResolver } from '../manifest/resolve.js';
import { Disposables } from './disposables.js';
export interface LineSegment { readonly channel: number; readonly owner: number; readonly from: number; readonly to: number; readonly start: Vector3; readonly end: Vector3 }
export interface ProjectedLineSegment { readonly channel: number; readonly owner: number; readonly start: Vector2; readonly end: Vector2 }
export interface LineRendererOptions { view: SimView; manifest: Manifest; scene: Scene; scope: Disposables; width?: number; palette?: keyof Manifest['palettes']; reducedMotion?: boolean }
/** Directed ribbons have source-relative UVs. The same clock uniform scrolls every ribbon without geometry edits. */
export function createLineRenderer(options: LineRendererOptions) {
  const resolver = createManifestResolver(options.manifest), clock = { value: 0 }, scope = new Disposables();
  const width = options.width ?? .4;
  let view = options.view, palette = options.palette ?? 'default', reducedMotion = options.reducedMotion ?? false, disposed = false;
  let highlighted: number | null = null, highlightedOwner: number | undefined;
  const meshes: Mesh<BufferGeometry, ShaderMaterial>[] = [], segments: LineSegment[] = [];
  const materials = new Map<number, ShaderMaterial>();
  function material(owner: number) {
    let m = materials.get(owner);
    if (!m) {
      m = scope.add(new ShaderMaterial({ side: DoubleSide, transparent: true, depthWrite: false,
        uniforms: { time: clock, motion: { value: reducedMotion ? 0 : 1 }, team: { value: new Color(resolver.color(view.players[owner]?.colorKey ?? 'neutral', palette)) }, highlight: { value: 0 } },
        vertexShader: 'varying vec2 ribbonUV; void main(){ ribbonUV=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `uniform float time; uniform float motion; uniform vec3 team; uniform float highlight; varying vec2 ribbonUV;
          void main(){ float lane=abs(ribbonUV.y-.5)*2.; float phase=fract(ribbonUV.x-time*motion*1.4-lane*.28);
          float arrow=1.-smoothstep(.12,.17,phase); vec3 color=mix(team,vec3(1.),arrow*.65+highlight*.2);
          gl_FragColor=vec4(color,.72+arrow*.28); }`,
      })); materials.set(owner, m);
    }
    return m;
  }
  function clear() { for (const mesh of meshes) { mesh.removeFromParent(); mesh.geometry.dispose(); } meshes.length = segments.length = 0; }
  function applyHighlight() {
    for (let i = 0; i < meshes.length; i++) {
      const segment = segments[i]!, mesh = meshes[i]!;
      // Highlight is per ribbon; ordinary ribbons share the owner material.
      if (mesh.userData.highlightMaterial) { (mesh.userData.highlightMaterial as ShaderMaterial).dispose(); delete mesh.userData.highlightMaterial; }
      mesh.material = material(segment.owner);
      if (segment.channel === highlighted && (highlightedOwner === undefined || segment.owner === highlightedOwner)) {
        const copy = mesh.material.clone(); copy.uniforms.time = clock; copy.uniforms.highlight!.value = 1;
        mesh.userData.highlightMaterial = copy; mesh.material = copy;
      }
    }
  }
  function rebuild() {
    for (const mesh of meshes) if (mesh.userData.highlightMaterial) (mesh.userData.highlightMaterial as ShaderMaterial).dispose();
    clear();
    for (const line of view.lines) {
      const a = view.towerStatic[line.from]!, b = view.towerStatic[line.to]!, dx = (b.x - a.x) / 1000, dz = (b.y - a.y) / 1000, length = Math.hypot(dx, dz);
      if (!length) continue;
      const nx = -dz / length, nz = dx / length;
      // Offset to each direction's left: reversed direction gets the opposite side.
      const start = new Vector3(a.x / 1000 + nx * width * .6, .035, a.y / 1000 + nz * width * .6);
      const end = new Vector3(b.x / 1000 + nx * width * .6, .035, b.y / 1000 + nz * width * .6);
      const geometry = new BufferGeometry(), half = width / 2;
      geometry.setAttribute('position', new Float32BufferAttribute([
        start.x-nx*half,start.y,start.z-nz*half, start.x+nx*half,start.y,start.z+nz*half,
        end.x-nx*half,end.y,end.z-nz*half, end.x+nx*half,end.y,end.z+nz*half], 3));
      geometry.setAttribute('uv', new Float32BufferAttribute([0,0,0,1,length/1.2,0,length/1.2,1], 2)); geometry.setIndex([0,1,2,2,1,3]);
      const mesh = new Mesh(geometry, material(line.owner)); mesh.renderOrder = 1; options.scene.add(mesh); meshes.push(mesh);
      segments.push({ channel: line.channel, owner: line.owner, from: line.from, to: line.to, start, end });
    }
    applyHighlight();
  }
  function highlight(channel: number | null, owner?: number) { if (disposed || (highlighted === channel && highlightedOwner === owner)) return; highlighted = channel; highlightedOwner = owner; applyHighlight(); }
  function dispose() { if (disposed) return; disposed = true; for (const mesh of meshes) if (mesh.userData.highlightMaterial) (mesh.userData.highlightMaterial as ShaderMaterial).dispose(); clear(); scope.dispose(); }
  options.scope.defer(dispose); rebuild();
  return { get meshes(): readonly Mesh<BufferGeometry, ShaderMaterial>[] { return meshes; }, get segments(): readonly LineSegment[] { return segments; },
    consumeEvents(events: readonly SimEvent[], nextView = view) { if (disposed) return; view = nextView; if (events.some(e => e.type === 'LineDrawn' || e.type === 'LineCut')) rebuild(); },
    update(seconds: number) { if (!disposed) clock.value = seconds; },
    setPalette(value: keyof Manifest['palettes']) { if (disposed) return; palette = value; for (const [owner, m] of materials) m.uniforms.team!.value.set(resolver.color(view.players[owner]?.colorKey ?? 'neutral', palette)); rebuild(); },
    setReducedMotion(value: boolean) { reducedMotion = value; for (const mesh of meshes) mesh.material.uniforms.motion!.value = value ? 0 : 1; for (const m of materials.values()) m.uniforms.motion!.value = value ? 0 : 1; },
    highlight, setHighlighted: highlight,
    /** Caller may cache this until line changes or camera resize. Coordinates are CSS pixels. */
    projectSegments(camera: Camera, viewportWidth: number, viewportHeight: number): ProjectedLineSegment[] {
      return segments.map(segment => { const a = segment.start.clone().project(camera), b = segment.end.clone().project(camera); return { channel: segment.channel, owner: segment.owner,
        start: new Vector2((a.x+1)*viewportWidth/2,(1-a.y)*viewportHeight/2), end: new Vector2((b.x+1)*viewportWidth/2,(1-b.y)*viewportHeight/2) }; });
    }, dispose,
  };
}
