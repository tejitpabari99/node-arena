// Minimal preact/hooks stand-in for node tests: state/ref persist per mounted component, effects run after render with dep comparison.
interface Effect { deps: unknown[] | undefined; cleanup: (() => void) | void }
interface Inst { slots: unknown[]; effects: Effect[]; i: number; ei: number; dirty: boolean; rendering: boolean; pending: Array<() => void>; render(): unknown }
let cur: Inst | null = null;
const same = (a: unknown[] | undefined, b: unknown[] | undefined) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

export function useState<T>(initial: T | (() => T)): [T, (v: T | ((p: T) => T)) => void] {
  const inst = cur!, i = inst.i++;
  if (!(i in inst.slots)) inst.slots[i] = typeof initial === 'function' ? (initial as () => T)() : initial;
  const set = (v: T | ((p: T) => T)) => {
    const next = typeof v === 'function' ? (v as (p: T) => T)(inst.slots[i] as T) : v;
    if (Object.is(next, inst.slots[i])) return;
    inst.slots[i] = next; inst.dirty = true;
    if (!inst.rendering) inst.render();
  };
  return [inst.slots[i] as T, set];
}
export function useRef<T>(initial: T): { current: T } {
  const inst = cur!, i = inst.i++;
  if (!(i in inst.slots)) inst.slots[i] = { current: initial };
  return inst.slots[i] as { current: T };
}
function effect(fn: () => void | (() => void), deps?: unknown[]) {
  const inst = cur!, i = inst.ei++, prev = inst.effects[i];
  if (prev && same(prev.deps, deps)) return;
  inst.pending.push(() => {
    const p = inst.effects[i];
    if (p && typeof p.cleanup === 'function') p.cleanup();
    inst.effects[i] = { deps, cleanup: fn() };
  });
}
export const useEffect = effect, useLayoutEffect = effect;

export interface Mounted<P> { readonly output: unknown; update(props: P): void; unmount(): void }
export function mount<P>(component: (p: P) => unknown, initialProps: P): Mounted<P> {
  let props = initialProps, output: unknown;
  const inst: Inst = { slots: [], effects: [], i: 0, ei: 0, dirty: false, rendering: false, pending: [], render() {
    if (inst.rendering) return output;
    do {
      inst.dirty = false; inst.rendering = true; cur = inst; inst.i = 0; inst.ei = 0;
      try { output = component(props); } finally { cur = null; }
      const run = inst.pending.splice(0);
      run.forEach((f) => f());
      inst.rendering = false;
    } while (inst.dirty);
    return output;
  } };
  inst.render();
  return {
    get output() { return output; },
    update(p) { props = p; inst.render(); },
    unmount() { inst.effects.forEach((e) => { if (typeof e.cleanup === 'function') e.cleanup(); }); inst.effects = []; },
  };
}
