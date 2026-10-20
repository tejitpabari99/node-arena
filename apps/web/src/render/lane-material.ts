import { Color, DoubleSide, ShaderMaterial } from 'three';
/** Tower War style translucent team ribbon (dotted fill, darker edges) with City Takeover style white chevrons on top.
 * Lane space: uv.x runs 0..1 from the lower-index tower A to B, uv.y spans the width. `split` is the A/B colour boundary
 * (fraction of lane length); the A half scrolls chevrons A->B, the B half B->A. */
export const LANE_WIDTH_FACTOR = .35, LANE_FILL_ALPHA = .58, LANE_TINT = .42, LANE_DRAIN_ALPHA = .4, LANE_CHEVRON_SPEED = 2.5, LANE_CHEVRON_PITCH = 1.3;
const vertexShader = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
const fragmentShader = `
uniform float laneLen; uniform float laneW; uniform float split; uniform float buildT; uniform float fade;
uniform float hoverA; uniform float hoverB; uniform float drainA; uniform float drainB; uniform float time; uniform float motion;
uniform vec3 colA; uniform vec3 colB; varying vec2 vUv;
void main(){
  float x=vUv.x; if(x>buildT) discard;
  float d=x*laneLen, c=(vUv.y-.5)*2., ac=abs(c);
  bool inB=x>split;
  vec3 col=inB?colB:colA; float drain=inB?drainB:drainA, hover=inB?hoverB:hoverA;
  float dir=inB?-1.:1.;
  float q=dir*d-${LANE_CHEVRON_SPEED.toFixed(2)}*(1.+.6*hover)*time*motion+ac*laneW*.45;
  float ph=fract(q/(${LANE_CHEVRON_PITCH.toFixed(2)}*laneW));
  // Tower War: sparse team-coloured dots on a centre row, thin crisp darker edge, low-alpha fill.
  float ph0=fract((q-ac*laneW*.45)/(${LANE_CHEVRON_PITCH.toFixed(2)}*laneW));
  vec2 f=vec2((fract(ph0+.95)-.5)*${LANE_CHEVRON_PITCH.toFixed(2)}*laneW, c*laneW*.5);
  float dots=1.-smoothstep(.1*laneW,.15*laneW,length(f));
  vec3 base=mix(mix(col,vec3(1.),${LANE_TINT.toFixed(2)}),col,dots*.35);
  float alpha=${LANE_FILL_ALPHA.toFixed(2)}+.2*dots;
  float edge=smoothstep(.86,.94,ac);
  base=mix(base,mix(col,vec3(0.),.1),edge); base=mix(base,vec3(1.),hover*edge*.8);
  alpha=mix(alpha,.72,edge);
  alpha=mix(alpha,min(alpha,${LANE_DRAIN_ALPHA.toFixed(2)}),drain);
  alpha*=mix(.4,1.,smoothstep(0.,fade*.6,min(d,laneLen-d)));
  float band=smoothstep(0.,.04,ph)*(1.-smoothstep(.11,.16,ph));
  float chev=band*(1.-smoothstep(.44,.54,ac))*smoothstep(0.,fade,d)*smoothstep(0.,fade,laneLen-d)*(1.-drain);
  gl_FragColor=vec4(mix(base,vec3(1.),chev*.88),mix(alpha,.97,chev));
}`;
/** One material per lane (per-lane uniforms); `time`/`motion` are shared clock objects. */
export function createLaneMaterial(clock: { value: number }, motion: { value: number }) {
  return new ShaderMaterial({
    side: DoubleSide, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { laneLen: { value: 1 }, laneW: { value: 2 }, colA: { value: new Color() }, colB: { value: new Color() }, split: { value: .5 }, buildT: { value: 1 }, fade: { value: 1.5 },
      hoverA: { value: 0 }, hoverB: { value: 0 }, drainA: { value: 0 }, drainB: { value: 0 }, time: clock, motion },
    vertexShader, fragmentShader,
  });
}
