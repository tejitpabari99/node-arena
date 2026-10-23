import Type from 'typebox';
import { ANIM_MODES, BUDGET_CLASSES, EVENTS, FX_KINDS, RENDER_KINDS, TEAM_MODES } from '@node-arena/defs';

/** Manifest v2 file-format version (presentation only). Independent of the live v1 `MANIFEST_SCHEMA_VERSION`. */
export const MANIFEST_SCHEMA_VERSION = '2.0.0';

const closed = { additionalProperties: false };
const key = () => Type.String({ minLength: 1 });
const path = key;
const color = () => Type.String({ pattern: '^#[0-9a-fA-F]{6}$' });
const vector = () => Type.Array(Type.Number(), { minItems: 3, maxItems: 3 });
const positive = () => Type.Number({ exclusiveMinimum: 0 });
const map = <T extends Type.TSchema>(schema: T) => Type.Record(Type.String({ minLength: 1 }), schema, closed);
const literals = <T extends string>(values: readonly T[]) => Type.Union(values.map((v) => Type.Literal(v)));

/** Team colour keys; `gray` = neutral. */
export const TEAM_KEYS = ['blue', 'green', 'red', 'yellow', 'gray'] as const;
const teamSet = <T extends Type.TSchema>(schema: T) => Type.Object(Object.fromEntries(TEAM_KEYS.map((k) => [k, schema])) as Record<(typeof TEAM_KEYS)[number], T>, closed);
/** Per-visual textures: blue/green/red/yellow required; `gray` (neutral) only where the family has one (buildings, projectile). Units never are neutral; `crossCheckManifest` rejects a level colorKey with no texture. */
const textureSet = () => Type.Object({ blue: path(), green: path(), red: path(), yellow: path(), gray: Type.Optional(path()) }, closed);

const stage = Type.Union([
  Type.Object({ mesh: key() }, closed),
  Type.Object({ enable: Type.Array(key(), { minItems: 1 }) }, closed),
]);
const anim = Type.Union([
  Type.Object({ mode: Type.Literal('none') }, closed),
  Type.Object({ mode: Type.Literal('node-tracks'), clips: Type.Object({ run: key(), death: key() }, closed) }, closed),
]);
const effect = { sfx: Type.Optional(key()), fx: Type.Optional(key()) };

/**
 * Manifest v2 (02 R7 = 07 contract). `stages[]` is indexed by `view.buildings.stage - 1` (sim stage is 1-based)
 * (length = `balance.stageThresholds.length + 1`, checked by `crossCheckManifest`; thresholds are content only).
 * Removed vs v1: tint, bob, build:'stacked', levelVisuals, colorblind, minLevel.
 */
export const ManifestSchema = Type.Object({
  $schema: Type.String({ minLength: 1 }), schemaVersion: Type.Literal(MANIFEST_SCHEMA_VERSION),
  palettes: teamSet(color()),
  visuals: map(Type.Object({
    kind: literals(RENDER_KINDS),
    /** `lod`: optional simplified sibling GLB with the same part nodes (unit renderer swaps geometry when many troops are alive). */
    model: Type.Object({ parts: path(), budget: literals(Object.keys(BUDGET_CLASSES) as Array<keyof typeof BUDGET_CLASSES>), lod: Type.Optional(path()) }, closed),
    stages: Type.Optional(Type.Array(stage, { minItems: 1 })),
    team: Type.Optional(Type.Object({ mode: literals(TEAM_MODES), textures: textureSet() }, closed)),
    anim: Type.Optional(anim),
    scale: positive(), yOffset: Type.Optional(Type.Number()),
    label: Type.Optional(Type.Object({ height: Type.Number({ minimum: 0 }) }, closed)),
    ...effect,
  }, closed)),
  themes: map(Type.Object({
    ground: Type.Object({ mesh: path(), texture: path() }, closed),
    obstacle: Type.Object({ small: path(), big: path(), texture: path() }, closed),
    /** `dir` points toward the light in the RAW asset frame. `ambient` = flat ambient fill (TW rig: directional 0.2 + ambient 0.896). */
    light: Type.Object({ dir: vector(), color: color(), intensity: Type.Number({ minimum: 0 }), ambient: Type.Optional(Type.Object({ color: color(), intensity: Type.Number({ minimum: 0 }) }, closed)) }, closed),
    fog: Type.Optional(Type.Object({ color: color(), near: Type.Number({ minimum: 0 }), far: positive() }, closed)),
    sky: color(),
    /** Ambient fx ids (keys of `fx`). */
    fx: Type.Optional(Type.Array(key())),
  }, closed)),
  fx: map(Type.Object({ texture: path(), kind: literals(FX_KINDS), params: map(Type.Number()) }, closed)),
  /** Keys are `EVENTS` ids (checked by `crossCheckManifest`); fx values are `fx` ids. */
  events: map(Type.Object(effect, closed)),
  camera: Type.Object({ pitchDeg: Type.Number({ minimum: 0, maximum: 90 }), fov: Type.Number({ exclusiveMinimum: 0, exclusiveMaximum: 180 }), margin: Type.Number({ minimum: 0 }) }, closed),
}, {
  ...closed, $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://node-arena.local/schemas/manifest.schema.json', title: 'manifest', 'x-presentation': true,
});
export type ManifestV2 = Type.Static<typeof ManifestSchema>;

/** Catalog-like input; callers (loader/CUT) project their loaded content into this shape. */
export interface ManifestCatalog {
  archetypes: ReadonlyArray<{ id: string; visual: string }>;
  units: ReadonlyArray<{ id: string; visual: string }>;
  elements: ReadonlyArray<{ id: string; visual: string }>;
  levels: ReadonlyArray<{ id: string; theme: string; colorKeys: readonly string[] }>;
  stageThresholds: readonly number[];
}

const has = (o: object, k: string): boolean => Object.hasOwn(o, k);

/** Pure cross-checks of a schema-valid manifest against content; returns error strings (empty = ok). */
export function crossCheckManifest(m: ManifestV2, c: ManifestCatalog): string[] {
  const errors: string[] = [];
  const groups: Array<[string, string, ReadonlyArray<{ id: string; visual: string }>]> = [
    ['building', 'archetype', c.archetypes], ['unit', 'unit', c.units], ['element', 'element', c.elements],
  ];
  for (const [kind, label, items] of groups) {
    for (const it of items) {
      const v = has(m.visuals, it.visual) ? m.visuals[it.visual] : undefined;
      if (!v) errors.push(`${label} ${it.id}: visual "${it.visual}" not in manifest`);
      else if (v.kind !== kind) errors.push(`${label} ${it.id}: visual "${it.visual}" kind "${v.kind}" != "${kind}"`);
    }
  }
  for (const lv of c.levels) {
    if (!has(m.themes, lv.theme)) errors.push(`level ${lv.id}: theme "${lv.theme}" not in manifest`);
    for (const ck of lv.colorKeys) {
      if (!has(m.palettes, ck)) errors.push(`level ${lv.id}: colorKey "${ck}" has no palette entry`);
      for (const [vid, v] of Object.entries(m.visuals)) {
        if (v.team && !has(v.team.textures, ck)) errors.push(`level ${lv.id}: colorKey "${ck}" has no texture in visual "${vid}"`);
      }
    }
  }
  for (const [vid, v] of Object.entries(m.visuals)) {
    if (v.stages && v.stages.length !== c.stageThresholds.length + 1) {
      errors.push(`visual ${vid}: stages length ${v.stages.length} != stageThresholds.length + 1 (${c.stageThresholds.length + 1})`);
    }
    if (v.fx && !has(m.fx, v.fx)) errors.push(`visual ${vid}: fx "${v.fx}" not in fx registry`);
  }
  for (const [tid, t] of Object.entries(m.themes)) {
    for (const f of t.fx ?? []) if (!has(m.fx, f)) errors.push(`theme ${tid}: fx "${f}" not in fx registry`);
  }
  for (const [ev, e] of Object.entries(m.events)) {
    if (!has(EVENTS, ev)) errors.push(`event "${ev}" is not a known event`);
    if (e.fx && !has(m.fx, e.fx)) errors.push(`event ${ev}: fx "${e.fx}" not in fx registry`);
  }
  return errors;
}
