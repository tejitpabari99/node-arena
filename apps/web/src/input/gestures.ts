import type { Point2 } from './geometry.js';
export interface GesturePoint extends Point2 { x: number; y: number; building: number | null }
export interface GestureOptions {
  now(): number; diagonal(): number; own(building: number): boolean;
  canDraw(from: number, to: number): boolean;
  draw(from: number, to: number): void;
  blocked?(from: number): void;
  stroke(from: Point2, to: Point2, seen: Set<number>): void;
  preview(from: number, point: GesturePoint): void;
  clear(): void; eraser(active: boolean): void; trail(point: Point2): void;
}
export type GestureMode = 'idle' | 'pending-draw' | 'draw' | 'pending-cut' | 'cut' | 'eraser';
/** Pointer-independent transitions. Clock units are milliseconds; all points are canvas CSS pixels. */
export function createGestureMachine(options: GestureOptions) {
  let mode: GestureMode = 'idle', pointer = -1, source = -1, started = 0, delay = 0;
  const start: GesturePoint = { x:0,y:0,building:null }, current: GesturePoint = { ...start }, previous = { x:0,y:0 };
  const seen = new Set<number>();
  const copy = (a: GesturePoint, b: GesturePoint) => { a.x=b.x; a.y=b.y; a.building=b.building; };
  function cancel() { const active=mode!=='idle'; mode='idle'; pointer=-1; seen.clear(); options.clear(); options.eraser(false); return active; }
  function refresh() {
    if (mode==='idle') return;
    const moved=Math.hypot(current.x-start.x,current.y-start.y)>=options.diagonal()*.01;
    if (mode==='pending-draw' && moved && options.now()-started>=delay) mode='draw';
    if (mode==='pending-cut') {
      if (moved) mode='cut';
      else if (options.now()-started>=700) { mode='eraser'; options.eraser(true); options.trail(current); }
    }
    if (mode==='draw') options.preview(source,current);
  }
  function down(id: number, type: string, button: number, point: GesturePoint) {
    if (mode!=='idle' || (button!==0 && button!==2)) return false;
    if (button===0 && point.building!==null && !options.own(point.building)) return false;
    pointer=id; source=point.building ?? -1; started=options.now(); delay=type==='mouse'?0:200;
    copy(start,point); copy(current,point); previous.x=point.x; previous.y=point.y; seen.clear();
    mode=button===2 || source===-1 ? 'pending-cut' : 'pending-draw'; return true;
  }
  function move(id: number, point: GesturePoint) {
    if (pointer!==id || mode==='idle') return;
    copy(current,point); refresh();
    if (mode==='cut' || mode==='eraser') { options.stroke(previous,current,seen); options.trail(current); }
    previous.x=current.x; previous.y=current.y;
  }
  function up(id: number, point: GesturePoint) {
    if (pointer!==id || mode==='idle') return;
    move(id,point);
    if (mode==='draw') {
      if (current.building!==null && options.own(source) && options.canDraw(source,current.building)) options.draw(source,current.building);
      else options.blocked?.(source);
    }
    cancel();
  }
  return { down,move,up,cancel,refresh,get mode() { return mode; },get pointer() { return pointer; } };
}
