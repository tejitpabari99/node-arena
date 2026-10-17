import type { Page } from '@playwright/test';
declare global { interface Window { __lifetime: () => { listeners: number; raf: number } } }
/** Test-side census of application listeners and pending rAFs, including detached canvases. */
export async function installLifetimeCensus(page: Page) {
  await page.addInitScript(() => {
    const listeners = new Map<EventTarget, Map<string, Set<EventListenerOrEventListenerObject>>>();
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    const relevant = (target: EventTarget, type: string) =>
      (target === window && type === 'resize') || (target === document && type === 'visibilitychange') ||
      (target instanceof HTMLCanvasElement && ['pointerdown','pointermove','pointerup','pointercancel','contextmenu','pointerleave','webglcontextlost','webglcontextrestored','webglcontextcreationerror'].includes(type));
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if(listener && relevant(this,type)) {
        let target = listeners.get(this); if(!target) { target=new Map();listeners.set(this,target); }
        let set=target.get(type);if(!set){set=new Set();target.set(type,set);}set.add(listener);
      }
      return add.call(this,type,listener,options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      if(listener)listeners.get(this)?.get(type)?.delete(listener);
      return remove.call(this,type,listener,options);
    };
    const pending=new Set<number>(),request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame=callback=>{const id=request(time=>{pending.delete(id);callback(time);});pending.add(id);return id;};
    window.cancelAnimationFrame=id=>{pending.delete(id);cancel(id);};
    window.__lifetime=()=>({listeners:[...listeners.values()].reduce((n,m)=>n+[...m.values()].reduce((n,s)=>n+s.size,0),0),raf:pending.size});
  });
}
