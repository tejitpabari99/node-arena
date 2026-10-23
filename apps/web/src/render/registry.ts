import type { RenderKind } from '@node-arena/defs';
import { RENDER_KINDS } from '@node-arena/defs';
import type { ManifestV2 } from '@node-arena/content';
import type { MaterialCache } from './materials.js';
import type { ModelCache } from './gltf-cache.js';

export type VisualDef = ManifestV2['visuals'][string];

/** What every renderer factory receives; later tasks (7 building, 8 unit, 9 ground/lane, 10 fx) extend via their own factory closure. */
export interface RendererContext {
  visualId: string;
  visual: VisualDef;
  materials: MaterialCache;
  models: ModelCache;
}
/** Minimal renderer contract; kind-specific methods are added by the registering task (hence the open index). */
export interface Renderer { dispose(): void; [method: string]: unknown }
export type RendererFactory = (ctx: RendererContext) => Renderer | Promise<Renderer>;

export class RendererRegistry {
  private factories = new Map<RenderKind, RendererFactory>();
  register(kind: RenderKind, factory: RendererFactory): void {
    if (!(RENDER_KINDS as readonly string[]).includes(kind)) throw new Error(`Unknown renderer kind "${String(kind)}"`);
    if (this.factories.has(kind)) throw new Error(`Renderer for kind "${kind}" already registered`);
    this.factories.set(kind, factory);
  }
  has(kind: string): boolean { return this.factories.has(kind as RenderKind); }
  get(kind: string): RendererFactory {
    const f = this.factories.get(kind as RenderKind);
    if (!f) throw new Error(`No renderer registered for kind "${kind}"`);
    return f;
  }
  kinds(): RenderKind[] { return [...this.factories.keys()]; }
  clear(): void { this.factories.clear(); }
}
/** Process-wide registry used by the app; tests build their own `new RendererRegistry()`. */
export const defaultRegistry = new RendererRegistry();
export const registerRenderer = (kind: RenderKind, factory: RendererFactory): void => defaultRegistry.register(kind, factory);
