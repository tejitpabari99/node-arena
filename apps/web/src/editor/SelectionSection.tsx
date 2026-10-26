import { LevelSchema, type NextBuilding, type NextElement } from '@node-arena/content';
import { contentFiles } from '../app/boot.js';
import { useEffect, useState } from 'preact/hooks';
import type { LevelDoc } from './document.js';
import { useEditor } from './EditorContext.js';
import { HIDDEN_PARAMS, itemLabels, paramLabel, playerLabel } from './labels.js';
import { snapYaw } from './model.js';
import type { Selection } from './picking.js';
import { LiveFieldError, useLiveField } from './useLiveField.js';

const archetypes = Object.fromEntries(Object.entries(contentFiles()).filter(([path]) => path.startsWith('data/buildings/')).map(([, value]) => {
  const item = JSON.parse(value as string) as NextBuilding; return [item.id, item];
}));
const elementArchetypes = Object.fromEntries(Object.entries(contentFiles()).filter(([path]) => path.startsWith('data/elements/')).map(([, value]) => {
  const item = JSON.parse(value as string) as NextElement; return [item.id, item];
}));

type Building = LevelDoc['buildings'][number];
type Obstacle = LevelDoc['elements'][number];
type SchemaField = { type: string; minimum?: number; maximum?: number; exclusiveMinimum?: number };
const keyOf = (s: Selection) => `${s.kind}:${s.id}`;

function Group({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return <details class="ed-group"><summary>{title}</summary><div class="ed-group-body">{children}</div></details>;
}

function OwnerGroup({ item }: { item: Building }) {
  const { doc, edit, locked } = useEditor();
  const maxLevel = Number((item.params as { level?: { maxLevel?: number } } | undefined)?.level?.maxLevel ?? (archetypes[item.archetype]?.modules?.level as { maxLevel?: number } | undefined)?.maxLevel ?? 64);
  return <fieldset aria-label="Owner and level" disabled={locked}>
    <label>Owner<select aria-label="Owner" value={item.owner ?? ''} onChange={event => edit({ type: 'building-properties', id: item.id, value: { owner: event.currentTarget.value || null } })}>
      <option value="">Neutral</option>
      {doc.players.map(p => <option key={p.id} value={p.id}>{playerLabel(doc.players, p.id)}</option>)}
      {item.owner && !doc.players.some(p => p.id === item.owner) && <option value={item.owner}>Unknown owner: {item.owner}</option>}
    </select></label>
    <NumberField label="Level" fieldKey={`${item.id}:level`} value={item.level} spec={{ type: 'integer', minimum: 1, maximum: maxLevel }} commit={(value, merge) => edit({ type: 'building-properties', id: item.id, value: { level: value! } }, merge)} />
    <label title="Decoy: no need to capture it to win; at least one building must stay required. (R-WIN-01/02, R-CPT-01)">Optional target (not needed to win)<input type="checkbox" checked={item.ignoreForWin} onChange={event => edit({ type: 'building-properties', id: item.id, value: { ignoreForWin: event.currentTarget.checked } })} /></label>
  </fieldset>;
}

function NumberField({ label, tooltip, fieldKey, value, spec, optional = false, placeholder, normalize, commit }: { label: string; tooltip?: string; fieldKey: string; value: number | undefined; spec: SchemaField; optional?: boolean; placeholder?: string; normalize?(value: number): number; commit(value: number | undefined, merge: string): void }) {
  const { doc, endEditBurst } = useEditor();
  const field = useLiveField({
    value: value === undefined ? '' : String(value), mergeKey: `${doc.id}:${fieldKey}`,
    validate: text => {
      if (!text.trim()) return optional ? undefined : 'Enter a number';
      const number = Number(text);
      if (!Number.isFinite(number)) return 'Enter a number';
      if (spec.type === 'integer' && !Number.isInteger(number)) return 'Enter a whole number';
      if (Math.abs(number * 1000 - Math.round(number * 1000)) > 1e-6) return 'Use at most 3 decimal places';
      if (spec.minimum !== undefined && number < spec.minimum) return `Minimum: ${spec.minimum}`;
      if (spec.exclusiveMinimum !== undefined && number <= spec.exclusiveMinimum) return `Must be greater than ${spec.exclusiveMinimum}`;
      if (spec.maximum !== undefined && number > spec.maximum) return `Maximum: ${spec.maximum}`;
      return undefined;
    },
    normalize: text => normalize && text.trim() ? String(normalize(Number(text))) : text,
    commit: (text, merge) => commit(text.trim() ? Number(text) : undefined, merge), endBurst: endEditBurst,
  });
  return <label title={tooltip}>{label}<input aria-label={label} type="number" required={!optional} min={spec.exclusiveMinimum !== undefined ? spec.exclusiveMinimum + .001 : spec.minimum} max={spec.maximum} step={spec.type === 'integer' ? '1' : '.001'} placeholder={placeholder} {...field.inputProps} /><LiveFieldError field={field} /></label>;
}

function ParamsGroup({ item }: { item: Building }) {
  const { edit, locked } = useEditor();
  const defaults = archetypes[item.archetype]?.modules ?? {};
  const schema = LevelSchema.properties.buildings.items.properties.params!.properties as Record<string, { properties: Record<string, SchemaField> }>;
  function change(module: string, field: string, value: string | number | boolean | undefined, merge?: string) {
    edit(current => {
      const params = structuredClone(current.buildings.find(building => building.id === item.id)?.params ?? {}) as Record<string, Record<string, string | number | boolean>>;
      const values = { ...params[module] };
      if (value === undefined) delete values[field]; else values[field] = value;
      if (Object.keys(values).length) params[module] = values; else delete params[module];
      return { type: 'building-properties', id: item.id, value: { params: Object.keys(params).length ? params : undefined } };
    }, merge);
  }
  return <fieldset aria-label="Parameters" disabled={locked}>
    <p class="ed-field-hint">Leave blank to use the archetype default.</p>
    {Object.entries(defaults).flatMap(([module, values]) => Object.entries(schema[module]?.properties ?? {}).map(([field, spec]) => {
      if (HIDDEN_PARAMS.has(`${module}.${field}`)) return null;
      const { label, tooltip } = paramLabel(module, field);
      const current = (item.params as Record<string, Record<string, string | number | boolean>> | undefined)?.[module]?.[field];
      const fallback = (values as Record<string, unknown>)[field];
      if (module === 'spawns' && field === 'troop') {
        const unit = String(current ?? fallback ?? '');
        return <label key={`${module}.${field}`} title={tooltip}>{label}<span class="ed-field-readonly">{unit.charAt(0).toUpperCase() + unit.slice(1)}{current !== undefined && <> <span title="This level overrides the building's default unit">(override)</span></>}</span></label>;
      }
      return spec.type === 'boolean'
        ? <label key={`${module}.${field}`} title={tooltip}>{label}<select aria-label={label} value={current === undefined ? '' : String(current)} onChange={event => change(module, field, event.currentTarget.value === '' ? undefined : event.currentTarget.value === 'true')}><option value="">Default ({fallback ? 'Yes' : 'No'})</option><option value="true">Yes</option><option value="false">No</option></select></label>
        : <NumberField key={`${module}.${field}`} label={label} tooltip={tooltip} fieldKey={`${item.id}:params:${module}.${field}`} value={current as number | undefined} spec={spec} optional placeholder={String(fallback ?? '')} commit={(value, merge) => change(module, field, value, merge)} />;
    }))}
  </fieldset>;
}

/** Preview only: never touches history. Remounted per building so the target resets. */
function LosGroup({ item, labels }: { item: Building; labels: Map<string, string> }) {
  const { doc, viewport, losStatus } = useEditor();
  const [to, setTo] = useState('');
  useEffect(() => {
    viewport.current?.setLos({ from: item.id, to });
    return () => viewport.current?.setLos({ from: '', to: '' });
  }, [item.id, to]);
  return <>
    <label>Target<select aria-label="LOS target" value={to} onChange={event => setTo(event.currentTarget.value)}>
      <option value="">Choose target</option>
      {doc.buildings.filter(b => b.id !== item.id).map(b => <option key={b.id} value={b.id}>{labels.get(b.id)}</option>)}
    </select></label>
    <p data-testid="los-status">{losStatus}</p>
  </>;
}

function RowShapeGroup({ item, pitch, depth }: { item: Obstacle; pitch: number; depth: number }) {
  const { edit, locked } = useEditor();
  const length = Math.max(1, Math.round((item.footprint?.w ?? pitch) / pitch));
  function rotate(delta: number) {
    edit(current => ({ type: 'obstacle-properties', id: item.id, value: { yawDeg: snapYaw((current.elements.find(element => element.id === item.id)?.yawDeg ?? item.yawDeg) + delta) } }));
  }
  return <fieldset aria-label="Shape" disabled={locked}>
    <label>Variant<select aria-label="Obstacle variant" value={item.variant ?? ''} onChange={event => edit({ type: 'obstacle-properties', id: item.id, value: { variant: (event.currentTarget.value || undefined) as Obstacle['variant'] } })}><option value="">Default</option><option value="small">Small</option><option value="big">Big</option></select></label>
    <NumberField label="Length (tiles)" fieldKey={`${item.id}:rowLength`} value={length} spec={{ type: 'integer', minimum: 1, maximum: 10 }} commit={(value, merge) => edit({ type: 'obstacle-properties', id: item.id, value: { footprint: { shape: 'box', w: Math.round(value! * pitch * 1000) / 1000, d: depth } } }, merge)} />
    <NumberField label="Rotation" normalize={snapYaw} fieldKey={`${item.id}:yawDeg`} value={item.yawDeg} spec={{ type: 'number', minimum: -360, maximum: 360 }} commit={(value, merge) => edit({ type: 'obstacle-properties', id: item.id, value: { yawDeg: snapYaw(value!) } }, merge)} />
    <div class="ed-actions"><button type="button" class="ed-btn" aria-label="Rotate -15 degrees" onClick={() => rotate(-15)}>-15</button><button type="button" class="ed-btn" aria-label="Rotate +15 degrees" onClick={() => rotate(15)}>+15</button></div>
  </fieldset>;
}

function ShapeGroup({ item }: { item: Obstacle }) {
  const { edit, locked } = useEditor();
  const defaults = elementArchetypes[item.archetype]?.footprint;
  if (defaults?.shape === 'box' && defaults.w !== undefined && defaults.d !== undefined && (!item.footprint || item.footprint.shape === 'box' && item.footprint.d === defaults.d)) return <RowShapeGroup item={item} pitch={defaults.w} depth={defaults.d} />;
  return <fieldset aria-label="Shape" disabled={locked}>
    <label>Obstacle variant<select aria-label="Obstacle variant" value={item.variant ?? ''} onChange={event => edit({ type: 'obstacle-properties', id: item.id, value: { variant: (event.currentTarget.value || undefined) as Obstacle['variant'] } })}><option value="">Default</option><option value="small">Small</option><option value="big">Big</option></select></label>
    <NumberField label="Yaw (degrees)" normalize={snapYaw} fieldKey={`${item.id}:yawDeg`} value={item.yawDeg} spec={{ type: 'number', minimum: -360, maximum: 360 }} commit={(value, merge) => edit({ type: 'obstacle-properties', id: item.id, value: { yawDeg: snapYaw(value!) } }, merge)} />
    <label>Footprint shape<select aria-label="Footprint shape" value={item.footprint?.shape ?? ''} onChange={event => edit({ type: 'obstacle-properties', id: item.id, value: { footprint: event.currentTarget.value === '' ? undefined : event.currentTarget.value === 'circle' ? { shape: 'circle', radius: 1 } : { shape: 'box', w: 1, d: 1 } } })}><option value="">Archetype default</option><option value="circle">Circle</option><option value="box">Box</option></select></label>
    {item.footprint && (item.footprint.shape === 'circle' ? ['radius'] : ['w', 'd']).map(field => <NumberField key={`${item.footprint!.shape}:${field}`} label={`Footprint ${field === 'w' ? 'width' : field === 'd' ? 'depth' : 'radius'}`} fieldKey={`${item.id}:footprint:${field}`} value={item.footprint![field as 'radius' | 'w' | 'd']} spec={{ type: 'number', minimum: .001, maximum: 100 }} commit={(value, merge) => edit(current => {
      const footprint = current.elements.find(element => element.id === item.id)?.footprint;
      return { type: 'obstacle-properties', id: item.id, value: footprint?.shape === item.footprint?.shape ? { footprint: { ...footprint, [field]: value } as Obstacle['footprint'] } : {} };
    }, merge)} />)}
  </fieldset>;
}

/** Friendly-label dropdown (synced both ways with canvas selection) plus live property controls. */
export function SelectionSection() {
  const { doc, selection, select, clipboard, copy, paste, deleteSelection, locked } = useEditor();
  const labels = itemLabels(doc);
  const [multi, setMulti] = useState(false);
  const selKey = selection.map(keyOf).join(',');
  useEffect(() => { if (selection.length === 1) setMulti(false); }, [selKey]);
  const isMulti = multi || selection.length >= 2;
  const single = !isMulti && selection.length === 1 ? selection[0]! : undefined;
  const building = single?.kind === 'building' ? doc.buildings.find(b => b.id === single.id) : undefined;
  const obstacle = single?.kind === 'obstacle' ? doc.elements.find(e => e.id === single.id) : undefined;
  const value = isMulti ? 'multi' : single ? keyOf(single) : '';
  const actions = <div class="ed-actions">
    <button type="button" class="ed-btn" disabled={locked || !selection.length} onClick={copy}>Copy</button>{' '}
    <button type="button" class="ed-btn" disabled={locked || !clipboard} onClick={paste}>Paste</button>{' '}
    <button type="button" class="ed-btn" disabled={locked || !selection.length} onClick={deleteSelection}>Delete</button>
  </div>;
  return <div class="ed-selection">
    <label>Selected item<select aria-label="Selected item" value={value} onChange={event => {
      const v = event.currentTarget.value;
      if (v === 'multi') { setMulti(true); return; }
      setMulti(false);
      const [kind, ...rest] = v.split(':');
      select(v ? [{ kind: kind as Selection['kind'], id: rest.join(':') }] : []);
    }}>
      <option value="">Nothing selected</option>
      {doc.buildings.map(b => <option key={b.id} value={`building:${b.id}`}>{labels.get(b.id)}</option>)}
      {doc.elements.map(e => <option key={e.id} value={`obstacle:${e.id}`}>{labels.get(e.id)}</option>)}
      <option value="multi">Multi-select</option>
    </select></label>
    {isMulti && <div class="ed-multi">
      <p data-testid="multi-count">{selection.length} selected</p>
      <button type="button" class="ed-btn" onClick={() => select([...doc.buildings.map(b => ({ kind: 'building' as const, id: b.id })), ...doc.elements.map(e => ({ kind: 'obstacle' as const, id: e.id }))])}>Select all</button>{' '}
      <button type="button" class="ed-btn" onClick={() => select([])}>Clear</button>
      {actions}
    </div>}
    {building && <div key={building.id}>
      <Group title="Owner and level"><OwnerGroup item={building} /></Group>
      <Group title="Parameters"><ParamsGroup item={building} /></Group>
      <Group title="Line of sight"><LosGroup item={building} labels={labels} /></Group>
      {actions}
    </div>}
    {obstacle && <div key={obstacle.id}>
      <Group title="Shape"><ShapeGroup item={obstacle} /></Group>
      {actions}
    </div>}
    {!isMulti && !single && <p class="ed-field-hint">Click an item or choose one above.</p>}
  </div>;
}
