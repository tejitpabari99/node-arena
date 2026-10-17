import type { CompiledLevel, Manifest } from '@node-arena/content';
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Disposables } from '../render/disposables.js';
import { createPrimitiveModel, normalizeModel } from '../render/model.js';
import { AssetError, createManifestResolver } from './resolve.js';
export type LevelAssetKeys = ReturnType<ReturnType<typeof createManifestResolver>['resolveLevelAssets']>;
export type AssetSessionState = 'idle' | 'loading' | 'ready' | 'error' | 'disposed';
export interface AssetManagerOptions {
  baseURL?: string;
  /** Successful decoded CPU sources retained when idle. Default 8; 0 opts out of reuse. */
  maxIdle?: number;
  loadModel?: (src: string) => Promise<Object3D>;
  loadAudio?: (src: string) => Promise<AudioBuffer>;
  fetcher?: typeof fetch;
  audioContext?: Pick<AudioContext, 'decodeAudioData'>;
}
type Asset = Object3D | AudioBuffer;
type Entry = { kind: 'model' | 'audio'; refs: number; promise: Promise<Asset>; value?: Asset | undefined; idle: number };
type Request = { key: string; src: string; kind: 'model' | 'audio'; primitive?: Extract<Manifest['models'][string], { primitive: string }> };
/** Application-owned cache. Sessions acquire sources once and release them on restart/menu. */
export class AssetManager {
  private cache = new Map<string, Entry>();
  private sessions = new Set<AssetSession>();
  private closed = false;
  private clock = 0;
  private context?: AudioContext;
  private resolver;
  private loadModel: (src: string) => Promise<Object3D>;
  private loadAudio: (src: string) => Promise<AudioBuffer>;
  private maxIdle: number;
  constructor(private manifest: Manifest, options: AssetManagerOptions = {}) {
    this.resolver = createManifestResolver(manifest); this.maxIdle = Math.max(0, Math.floor(options.maxIdle ?? 8));
    const url = (src: string) => `${(options.baseURL ?? '/').replace(/\/$/, '')}/${src}`;
    const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
    this.loadModel = options.loadModel ?? (async src => normalizeModel((await loader.loadAsync(url(src))).scene));
    this.loadAudio = options.loadAudio ?? (async src => {
      const response = await (options.fetcher ?? fetch)(url(src)); if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const context = options.audioContext ?? (this.context ??= new AudioContext());
      return context.decodeAudioData(bytes);
    });
  }
  get cachedSources(): number { return this.cache.size; }
  resolveLevelAssets(level: Pick<CompiledLevel, 'visual' | 'towers' | 'kinds' | 'players'>): LevelAssetKeys { return this.resolver.resolveLevelAssets(level); }
  createSession(keys: LevelAssetKeys): AssetSession {
    if (this.closed) throw new Error('Asset manager is disposed');
    const requests: Request[] = [...keys.models].map(key => {
      const model = this.resolver.model(key);
      return 'src' in model ? { key, src: model.src, kind: 'model' } : { key, src: `primitive:${JSON.stringify(model)}`, kind: 'model', primitive: model };
    });
    requests.push(...[...keys.audio].map(key => ({ key, src: key, kind: 'audio' as const })));
    const session = new AssetSession(this, requests); this.sessions.add(session); return session;
  }
  /** Internal lease API; failures evict their promises so Retry starts a fresh attempt. */
  acquire(request: Request): { promise: Promise<Asset>; release: () => void } {
    if (this.closed) throw new Error('Asset manager is disposed');
    let entry = this.cache.get(request.src);
    if (entry && entry.kind !== request.kind) throw new AssetError(request.key, request.src, new Error('Source used as both model and audio'));
    if (!entry) {
      const fresh: Entry = { kind: request.kind, refs: 0, idle: 0, promise: undefined! }; entry = fresh; this.cache.set(request.src, fresh);
      fresh.promise = this.load(request).then(value => {
        fresh.value = value;
        if (this.closed || this.cache.get(request.src) !== fresh) this.free(fresh);
        else this.trim();
        return value;
      }, error => { if (this.cache.get(request.src) === fresh) this.cache.delete(request.src); throw error; });
    }
    entry.refs++; const leased = entry; let released = false;
    return { promise: entry.promise, release: () => { if (released) return; released = true; leased.refs--; leased.idle = ++this.clock;
      // Cancelled unfinished loads never occupy the successful-source idle cache.
      // Their late resolution frees the value via the cache identity check above.
      if (leased.refs === 0 && !leased.value && this.cache.get(request.src) === leased) this.cache.delete(request.src);
      this.trim(); } };
  }
  private async load(request: Request): Promise<Asset> {
    for (let attempt = 0; ; attempt++) {
      try { return request.primitive ? createPrimitiveModel(request.primitive) : await (request.kind === 'model' ? this.loadModel(request.src) : this.loadAudio(request.src)); }
      catch (cause) { if (attempt === 2) throw new AssetError(request.key, request.src, cause); }
    }
  }
  private free(entry: Entry): void {
    if (entry.kind === 'model' && entry.value) new Disposables().object(entry.value as Object3D).dispose();
    entry.value = undefined;
  }
  private trim(): void {
    // The idle cap bounds models only: a level's few audio buffers (music especially) must survive model churn between levels.
    // maxIdle 0 still opts out of all reuse.
    const idle = [...this.cache.entries()].filter(([, entry]) => entry.refs === 0 && entry.value !== undefined).sort((a, b) => a[1].idle - b[1].idle);
    const idleModels = idle.filter(([, entry]) => entry.kind === 'model');
    while (idleModels.length > this.maxIdle) { const [src, entry] = idleModels.shift()!; this.cache.delete(src); this.free(entry); }
    if (this.maxIdle === 0) for (const [src, entry] of idle) if (entry.kind === 'audio') { this.cache.delete(src); this.free(entry); }
  }
  forget(session: AssetSession): void { this.sessions.delete(session); }
  dispose(): void {
    if (this.closed) return; this.closed = true;
    for (const session of [...this.sessions]) session.dispose();
    for (const entry of this.cache.values()) this.free(entry); this.cache.clear();
    if (this.context) void this.context.close().catch(() => {});
  }
}
/** Error-screen contract: state/error failures supply {key,src,cause}; retryFailed retains successful assets.
 * dispose is Back-to-menu/cancellation. Dispose level render scope before releasing this session. */
export class AssetSession {
  state: AssetSessionState = 'idle';
  readonly models = new Map<string, Object3D>();
  readonly audio = new Map<string, AudioBuffer>();
  private errors = new Map<Request, AssetError>();
  private leases = new Map<Request, () => void>();
  private pending: Promise<void> | undefined;
  constructor(private manager: AssetManager, private requests: Request[]) {}
  get failures(): readonly AssetError[] { return [...this.errors.values()]; }
  load(): Promise<void> { return this.run(this.requests); }
  retryFailed(): Promise<void> { return this.run([...this.errors.keys()]); }
  private run(requests: Request[]): Promise<void> {
    if (this.state === 'disposed') return Promise.resolve();
    if (this.pending) return this.pending;
    const remaining = requests.filter(request => !this.leases.has(request));
    if (!remaining.length) { this.state = this.errors.size ? 'error' : 'ready'; return Promise.resolve(); }
    this.state = 'loading';
    this.pending = Promise.all(remaining.map(async request => {
      let release: (() => void) | undefined;
      try {
        const lease = this.manager.acquire(request); release = lease.release; this.leases.set(request, release);
        const value = await lease.promise;
        if (this.state === 'disposed') return;
        this.errors.delete(request);
        if (request.kind === 'model') this.models.set(request.key, value as Object3D); else this.audio.set(request.key, value as AudioBuffer);
      } catch (cause) {
        release?.(); this.leases.delete(request);
        if (this.state !== 'disposed') this.errors.set(request, new AssetError(request.key, request.src, cause instanceof AssetError ? cause.cause : cause));
      }
    })).then(() => { if (this.state !== 'disposed') this.state = this.errors.size ? 'error' : 'ready'; }).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  dispose(): void {
    if (this.state === 'disposed') return; this.state = 'disposed';
    for (const release of this.leases.values()) release(); this.leases.clear(); this.models.clear(); this.audio.clear(); this.errors.clear(); this.manager.forget(this);
  }
}
