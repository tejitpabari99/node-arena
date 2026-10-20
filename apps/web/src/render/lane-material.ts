import { Color, DoubleSide, ShaderMaterial } from 'three';
/** Tower War style translucent team ribbon (dotted fill, darker edges) with City Takeover style white chevrons on top.
 * Lane space: uv.x runs 0..1 from the lower-index tower A to B, uv.y spans the width. `split` is the A/B colour boundary
 * (fraction of lane length); the A half scrolls chevrons A->B, the B half B->A. */
export const LANE_WIDTH_FACTOR = .35, LANE_FILL_ALPHA = .58, LANE_TINT = .42, LANE_DRAIN_ALPHA = .4, LANE_CHEVRON_SPEED = 2.5, LANE_CHEVRON_PITCH = 1.0;
/** Seconds: build-out ease-out, cut flash, cut retract. */
export const LANE_BUILD_S = .35, LANE_FLASH_S = .08, LANE_RETRACT_S = .3;
const vertexShader = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
const fragmentShader = `
uniform float laneLen; uniform float laneW; uniform float split; uniform float buildT; uniform float fade;
uniform float hoverA; uniform float hoverB; uniform float drainA; uniform float drainB; uniform float buildSrc; uniform float retractA; uniform float retractB; uniform float keepA; uniform float keepB; uniform float flashA; uniform float flashB; uniform float time; uniform float motion;
uniform vec3 colA; uniform vec3 colB; varying vec2 vUv;
void main(){
  float x=vUv.x;
  // Build-out grows from the source tower; retract shrinks each half toward its own source tower (A = lo at x=0, B = hi at x=1).
  if(buildSrc<.5?x>buildT:x<1.-buildT) discard;
  bool gone=x>split?x<1.-(1.-split)*(1.-retractB):x>split*(1.-retractA);
  if(gone&&(x>split?keepB:keepA)<.5) discard;
  float d=x*laneLen, c=(vUv.y-.5)*2., ac=abs(c);
  bool inB=x>split;
  vec3 col=inB?colB:colA; float drain=inB?drainB:drainA; if(gone) drain=1.; float hover=inB?hoverB:hoverA;
  float dir=inB?-1.:1.; float flash=gone?0.:(inB?flashB:flashA);
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
  float band=smoothstep(0.,.04,ph)*(1.-smoothstep(.1,.15,ph));
  float chev=band*(1.-smoothstep(.42,.52,ac))*smoothstep(0.,fade,d)*smoothstep(0.,fade,laneLen-d)*(1.-drain);
  vec3 rgb=mix(base,vec3(.97,.98,1.),chev*.9); float a=mix(alpha,.92,chev);
  // Bright leading edge on the moving build / retract front.
  float df=1e3;
  if(buildT<.999) df=buildSrc<.5?(buildT-x)*laneLen:(x-(1.-buildT))*laneLen;
  if(!inB&&retractA>.001) df=min(df,(split*(1.-retractA)-x)*laneLen);
  if(inB&&retractB>.001) df=min(df,(x-(1.-(1.-split)*(1.-retractB)))*laneLen);
  float lead=gone?0.:1.-smoothstep(0.,laneW*1.1,df);
  rgb=mix(rgb,vec3(1.),lead*.85); a=max(a,lead*.95);
  rgb=mix(rgb,vec3(1.),flash); a=max(a,flash*.95);
  gl_FragColor=vec4(rgb,a);
}`;
/** One material per lane (per-lane uniforms); `time`/`motion` are shared clock objects. */
export function createLaneMaterial(clock: { value: number }, motion: { value: number }) {
  return new ShaderMaterial({
    side: DoubleSide, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    uniforms: { laneLen: { value: 1 }, laneW: { value: 2 }, colA: { value: new Color() }, colB: { value: new Color() }, split: { value: .5 }, buildT: { value: 1 }, fade: { value: 1.5 },
      buildSrc: { value: 0 }, keepA: { value: 0 }, keepB: { value: 0 }, retractA: { value: 0 }, retractB: { value: 0 }, flashA: { value: 0 }, flashB: { value: 0 },
      hoverA: { value: 0 }, hoverB: { value: 0 }, drainA: { value: 0 }, drainB: { value: 0 }, time: clock, motion },
    vertexShader, fragmentShader,
  });
}
