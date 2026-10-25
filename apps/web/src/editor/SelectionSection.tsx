import { LevelSchema, type NextBuilding } from '@node-arena/content';
import { contentFiles } from '../app/boot.js';
import { useEffect, useState } from 'preact/hooks';
import type { LevelDoc } from './document.js';
import { useEditor } from './EditorContext.js';
import { itemLabels, playerLabel } from './labels.js';
import { snapYaw } from './model.js';
import type { Selection } from './picking.js';

const archetypes = Object.fromEntries(Object.entries(contentFiles()).filter(([path]) => path.startsWith('data/buildings/')).map(([, value]) => {
  const item = JSON.parse(value as string) as NextBuilding; return [item.id, item];
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
  const [draft, setDraft] = useState({ owner: item.owner, level: item.level, ignoreForWin: item.ignoreForWin });
  const maxLevel = Number((item.params as { level?: { maxLevel?: number } } | undefined)?.level?.maxLevel ?? (archetypes[item.archetype]?.modules?.level as { maxLevel?: number } | undefined)?.maxLevel ?? 64);
  return <form aria-label="Owner and level" onSubmit={event => { event.preventDefault(); edit({ type: 'building-properties', id: item.id, value: { owner: draft.owner, level: draft.level, ignoreForWin: draft.ignoreForWin } }); }}><fieldset disabled={locked}>
    <label>Owner<select aria-label="Owner" value={draft.owner ?? ''} onChange={event => setDraft({ ...draft, owner: event.currentTarget.value || null })}>
      <option value="">Neutral</option>
      {doc.players.map(p => <option key={p.id} value={p.id}>{playerLabel(doc.players, p.id)}</option>)}
      {draft.owner && !doc.players.some(p => p.id === draft.owner) && <option value={draft.owner}>Unknown owner: {draft.owner}</option>}
    </select></label>
    <label>Level<input type="number" required min="1" max={maxLevel} step="1" value={draft.level} onInput={event => setDraft({ ...draft, level: Number(event.currentTarget.value) })} /></label>
    <label>Ignore for win<input type="checkbox" checked={draft.ignoreForWin} onChange={event => setDraft({ ...draft, ignoreForWin: event.currentTarget.checked })} /></label>
    <button class="ed-btn-primary" aria-label="Apply owner and level">Apply</button>
  </fieldset></form>;
}

function ParamsGroup({ item }: { item: Building }) {
  const { edit, locked } = useEditor();
  const [params, setParams] = useState<Record<string, Record<string, string | number | boolean>>>(() => structuredClone((item.params ?? {}) as Record<string, Record<string, string | number | boolean>>));
  const defaults = archetypes[item.archetype]?.modules ?? {};
  const schema = LevelSchema.properties.buildings.items.properties.params!.properties as Record<string, { properties: Record<string, SchemaField> }>;
  return <form aria-label="Parameters" onSubmit={event => { event.preventDefault(); edit({ type: 'building-properties', id: item.id, value: { params: Object.keys(params).length ? params : undefined } as never }); }}><fieldset disabled={locked}>
    <p class="ed-hint">Leave blank to use the archetype default.</p>
    {Object.entries(defaults).flatMap(([module, values]) => Object.entries(schema[module]?.properties ?? {}).map(([field, spec]) => {
      const current = params[module]?.[field];
      const fallback = (values as Record<string, unknown>)[field];
      function change(value: string) {
        const next = { ...params, [module]: { ...params[module] } };
        if (value === '') delete next[module]![field];
        else next[module]![field] = spec.type === 'boolean' ? value === 'true' : spec.type === 'string' ? value : Number(value);
        if (!Object.keys(next[module]!).length) delete next[module];
        setParams(next);
      }
      return <label key={`${module}.${field}`}>{module} {field}{spec.type === 'boolean'
        ? <select value={current === undefined ? '' : String(current)} onChange={event => change(event.currentTarget.value)}><option value="">Default ({String(fallback)})</option><option value="true">Yes</option><option value="false">No</option></select>
        : <input type={spec.type === 'string' ? 'text' : 'number'} min={spec.exclusiveMinimum !== undefined ? spec.exclusiveMinimum + .001 : spec.minimum} max={spec.maximum} step={spec.type === 'integer' ? '1' : '.001'} placeholder={String(fallback ?? '')} value={current === undefined ? '' : String(current)} onInput={event => change(event.currentTarget.value)} />}</label>;
    }))}
    <button class="ed-btn-primary" aria-label="Apply parameters">Apply</button>
  </fieldset></form>;
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

function ShapeGroup({ item }: { item: Obstacle }) {
  const { edit, locked } = useEditor();
  const [draft, setDraft] = useState({ variant: item.variant, yawDeg: item.yawDeg, footprint: item.footprint });
  return <form aria-label="Shape" onSubmit={event => { event.preventDefault(); const yawDeg = snapYaw(draft.yawDeg, true); setDraft({ ...draft, yawDeg }); edit({ type: 'obstacle-properties', id: item.id, value: { variant: draft.variant, yawDeg, footprint: draft.footprint } }); }}><fieldset disabled={locked}>
    <label>Obstacle variant<select aria-label="Obstacle variant" value={draft.variant ?? ''} onChange={event => setDraft({ ...draft, variant: (event.currentTarget.value || undefined) as typeof draft.variant })}><option value="">Default</option><option value="small">Small</option><option value="big">Big</option></select></label>
    <label>Yaw (degrees)<input type="number" required min="-360" max="360" step=".001" value={draft.yawDeg} onInput={event => setDraft({ ...draft, yawDeg: Number(event.currentTarget.value) })} /></label>
    <label>Footprint shape<select aria-label="Footprint shape" value={draft.footprint?.shape ?? ''} onChange={event => setDraft({ ...draft, footprint: event.currentTarget.value === '' ? undefined : event.currentTarget.value === 'circle' ? { shape: 'circle', radius: 1 } : { shape: 'box', w: 1, d: 1 } })}><option value="">Archetype default</option><option value="circle">Circle</option><option value="box">Box</option></select></label>
    {draft.footprint && (draft.footprint.shape === 'circle' ? ['radius'] : ['w', 'd']).map(field => <label key={field}>Footprint {field === 'w' ? 'width' : field === 'd' ? 'depth' : 'radius'}<input type="number" required min=".001" max="100" step=".001" value={draft.footprint![field as 'radius' | 'w' | 'd']} onInput={event => setDraft({ ...draft, footprint: { ...draft.footprint!, [field]: Number(event.currentTarget.value) } as typeof draft.footprint })} /></label>)}
    <button class="ed-btn-primary" aria-label="Apply shape">Apply</button>
  </fieldset></form>;
}

/** Friendly-label dropdown (synced both ways with canvas selection) plus per-group Apply forms. */
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
    <button type="button" disabled={locked || !selection.length} onClick={copy}>Copy</button>{' '}
    <button type="button" disabled={locked || !clipboard} onClick={paste}>Paste</button>{' '}
    <button type="button" disabled={locked || !selection.length} onClick={deleteSelection}>Delete</button>
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
      <button type="button" onClick={() => select([...doc.buildings.map(b => ({ kind: 'building' as const, id: b.id })), ...doc.elements.map(e => ({ kind: 'obstacle' as const, id: e.id }))])}>Select all</button>{' '}
      <button type="button" onClick={() => select([])}>Clear</button>
      {actions}
    </div>}
    {building && <div key={building.id}>
      <Group title="Owner and level"><OwnerGroup key={JSON.stringify({ o: building.owner, l: building.level, i: building.ignoreForWin })} item={building} /></Group>
      <Group title="Parameters"><ParamsGroup key={JSON.stringify(building.params ?? null)} item={building} /></Group>
      <Group title="Line of sight"><LosGroup item={building} labels={labels} /></Group>
      {actions}
    </div>}
    {obstacle && <div key={obstacle.id}>
      <Group title="Shape"><ShapeGroup key={JSON.stringify({ v: obstacle.variant, y: obstacle.yawDeg, f: obstacle.footprint ?? null })} item={obstacle} /></Group>
      {actions}
    </div>}
    {!isMulti && !single && <p class="ed-hint">Click an item or choose one above.</p>}
  </div>;
}
