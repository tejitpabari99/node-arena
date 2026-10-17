import { InstancedMesh, Material, Mesh, Texture, type Object3D } from 'three';
/** A scope owns only resources explicitly registered in it. dispose is idempotent. */
export class Disposables {
  private cleanup = new Map<object, () => void>();
  private disposed = false;
  add<T extends { dispose(): void }>(resource: T): T { this.track(resource, () => resource.dispose()); return resource; }
  defer(cleanup: () => void): void { this.track(cleanup, cleanup); }
  label<T extends { remove(): void }>(element: T): T { this.track(element, () => element.remove()); return element; }
  private track(key: object, cleanup: () => void) { if (this.disposed) cleanup(); else if (!this.cleanup.has(key)) this.cleanup.set(key, cleanup); }
  material(material: Material, textures = true): void {
    if (textures) for (const value of Object.values(material)) if (value instanceof Texture) this.add(value);
    this.add(material);
  }
  /** Only call with owned resources. Shared cache geometry/textures require cloneModel instead. */
  object<T extends Object3D>(root: T, options: { geometry?: boolean; materials?: boolean; textures?: boolean } = {}): this {
    root.traverse(node => {
      if (node instanceof Mesh) {
        if (options.geometry !== false) this.add(node.geometry);
        if (options.materials !== false) for (const material of Array.isArray(node.material) ? node.material : [node.material]) this.material(material, options.textures !== false);
      }
      if (node instanceof InstancedMesh) this.add(node);
    });
    this.defer(() => root.removeFromParent()); return this;
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    const cleanups = [...this.cleanup.values()].reverse(); this.cleanup.clear();
    const errors: unknown[] = []; for (const cleanup of cleanups) { try { cleanup(); } catch (error) { errors.push(error); } }
    if (errors.length) throw new AggregateError(errors, 'Resource disposal failed');
  }
}
