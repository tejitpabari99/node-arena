import { LevelSchema, type NextBuilding, type SeatBot } from '@node-arena/content';
import { useEffect, useState } from 'preact/hooks';
import { contentFiles } from '../app/boot.js';
import type { LevelDoc } from './document.js';
import type { DocOp, LevelProperties } from './model.js';
import type { Selection } from './picking.js';

type Edit = (op: DocOp) => void;
const archetypes = Object.fromEntries(Object.entries(contentFiles()).filter(([path]) => path.startsWith('data/buildings/')).map(([, value]) => {
  const item = JSON.parse(value as string) as NextBuilding; return [item.id, item];
}));

/** Explicit Apply submits every field together, so typing never creates history entries. */
export function LevelPropertiesForm({ doc, onEdit, themes, colors, disabled }: { doc: LevelDoc; onEdit: Edit; themes: string[]; colors: string[]; disabled: boolean }) {
  const [draft, setDraft] = useState(doc);
  useEffect(() => setDraft(doc), [doc]);
  function player(index: number, change: Partial<LevelDoc['players'][number]>) {
    setDraft({ ...draft, players: draft.players.map((p, i) => { if (i !== index) return p; const next = { ...p, ...change }; if (next.kind === 'human') delete next.bot; return next; }) });
  }
  return <details class="editor-properties"><summary>Level properties</summary><form onSubmit={event => {
    event.preventDefault(); const { name, theme, timeLimitSec, players } = draft;
    onEdit({ type: 'level-properties', value: { name, theme, timeLimitSec, players } as LevelProperties });
  }}><fieldset disabled={disabled}>
    <label>Level name<input required value={draft.name} onInput={event => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
    <label>Level theme<select aria-label="Level theme" value={draft.theme} onChange={event => setDraft({ ...draft, theme: event.currentTarget.value })}>{[...new Set([draft.theme, ...themes])].map(theme => <option key={theme}>{theme}</option>)}</select></label>
    <label>Objective<input value="captureAll" readOnly /></label>
    <label>Time limit (seconds)<input type="number" min="1" max="107374182" step="1" placeholder="Unlimited" value={draft.timeLimitSec ?? ''} onInput={event => setDraft({ ...draft, timeLimitSec: event.currentTarget.value === '' ? null : Number(event.currentTarget.value) })} /></label>
    <p>Exactly one human, first in the list; at least one AI. Player ids remain fixed so building owners stay valid.</p>
    {draft.players.map((p, i) => { const bot = p.bot as SeatBot | undefined; return <fieldset key={p.id}><legend>{p.id}</legend>
      <label>{p.id} color<select aria-label={`${p.id} color`} value={p.colorKey} onChange={event => player(i, { colorKey: event.currentTarget.value })}>{[...new Set([p.colorKey, ...colors])].map(color => <option key={color}>{color}</option>)}</select></label>
      <label>{p.id} kind<select aria-label={`${p.id} kind`} value={p.kind} onChange={event => {
        const kind = event.currentTarget.value as 'human' | 'ai';
        const next = { ...p, kind };
        if (kind === 'human') delete next.bot;
        else next.bot ??= { kind: 'tw', actionDelayMs: 4000, behavior: 'full' };
        player(i, next);
      }}><option value="human">Human</option><option value="ai">AI</option></select></label>
      {bot && <>
        <label>{p.id} action delay (ms)<input type="number" required min="50" max="2147483647" step="1" value={bot.actionDelayMs} onInput={event => player(i, { bot: { ...bot, actionDelayMs: Number(event.currentTarget.value) } })} /></label>
        <label>{p.id} behavior<select aria-label={`${p.id} behavior`} value={bot.behavior} onChange={event => player(i, { bot: { ...bot, behavior: event.currentTarget.value as 'full' | 'attackOnly' } })}><option value="full">Full</option><option value="attackOnly">Attack only</option></select></label>
      </>}
    </fieldset>; })}
    <button>Apply level properties</button>
  </fieldset></form></details>;
}

export function ItemProperties({ doc, selection, onEdit, disabled }: { doc: LevelDoc; selection: Selection[]; onEdit: Edit; disabled: boolean }) {
  const target = selection.length === 1 ? selection[0] : undefined;
  const building = target?.kind === 'building' ? doc.buildings.find(item => item.id === target.id) : undefined;
  const obstacle = target?.kind === 'obstacle' ? doc.elements.find(item => item.id === target.id) : undefined;
  // Remount on each immutable document revision, including Undo, to discard stale form drafts.
  if (building) return <BuildingForm key={JSON.stringify(building)} item={building} doc={doc} onEdit={onEdit} disabled={disabled} />;
  if (obstacle) return <ObstacleForm key={JSON.stringify(obstacle)} item={obstacle} onEdit={onEdit} disabled={disabled} />;
  return null;
}

function BuildingForm({ item, doc, onEdit, disabled }: { item: LevelDoc['buildings'][number]; doc: LevelDoc; onEdit: Edit; disabled: boolean }) {
  const [draft, setDraft] = useState(item);
  const defaults = archetypes[item.archetype]?.modules ?? {};
  const schema = LevelSchema.properties.buildings.items.properties.params!.properties as Record<string, { properties: Record<string, { type: string; minimum?: number; maximum?: number; exclusiveMinimum?: number }> }>;
  const params = (draft.params ?? {}) as Record<string, Record<string, string | number | boolean>>;
  return <form class="editor-properties" aria-label={`Building ${item.id} properties`} onSubmit={event => {
    event.preventDefault(); const { owner, level, ignoreForWin, params } = draft;
    onEdit({ type: 'building-properties', id: item.id, value: { owner, level, ignoreForWin, params } });
  }}><fieldset disabled={disabled}><legend>Building {item.id}</legend>
    <label>Building owner<select aria-label="Building owner" value={draft.owner ?? ''} onChange={event => setDraft({ ...draft, owner: event.currentTarget.value || null })}><option value="">Neutral</option>{doc.players.map(p => <option key={p.id} value={p.id}>{p.id} ({p.colorKey})</option>)}{draft.owner && !doc.players.some(p => p.id === draft.owner) && <option value={draft.owner}>Unknown owner: {draft.owner}</option>}</select></label>
    <label>Building level<input type="number" required min="1" max={Number(params.level?.maxLevel ?? (defaults.level as { maxLevel?: number } | undefined)?.maxLevel ?? 64)} step="1" value={draft.level} onInput={event => setDraft({ ...draft, level: Number(event.currentTarget.value) })} /></label>
    <label>Ignore for win<input type="checkbox" checked={draft.ignoreForWin} onChange={event => setDraft({ ...draft, ignoreForWin: event.currentTarget.checked })} /></label>
    <p>Parameter overrides: leave blank to use the archetype default.</p>
    {Object.entries(defaults).flatMap(([module, values]) => Object.entries((schema[module] as { properties: Record<string, { type: string; minimum?: number; maximum?: number; exclusiveMinimum?: number }> }).properties).map(([field, spec]) => {
      const current = params[module]?.[field] as string | number | boolean | undefined;
      const fallback = (values as Record<string, unknown>)[field];
      function change(value: string) {
        const nextParams = { ...params, [module]: { ...params[module] } };
        if (value === '') delete nextParams[module]![field];
        else nextParams[module]![field] = spec.type === 'boolean' ? value === 'true' : spec.type === 'string' ? value : Number(value);
        if (!Object.keys(nextParams[module]!).length) delete nextParams[module];
        const next: typeof draft = { ...draft, params: nextParams }; if (!Object.keys(nextParams).length) delete next.params; setDraft(next);
      }
      return <label key={`${module}.${field}`}>{module} {field}{spec.type === 'boolean' ? <select value={current === undefined ? '' : String(current)} onChange={event => change(event.currentTarget.value)}><option value="">Default ({String(fallback)})</option><option value="true">Yes</option><option value="false">No</option></select> : <input type={spec.type === 'string' ? 'text' : 'number'} min={spec.exclusiveMinimum !== undefined ? spec.exclusiveMinimum + .001 : spec.minimum} max={spec.maximum} step={spec.type === 'integer' ? '1' : '.001'} placeholder={String(fallback ?? '')} value={current === undefined ? '' : String(current)} onInput={event => change(event.currentTarget.value)} />}</label>;
    }))}
    <button>Apply building properties</button>
  </fieldset></form>;
}

function ObstacleForm({ item, onEdit, disabled }: { item: LevelDoc['elements'][number]; onEdit: Edit; disabled: boolean }) {
  const [draft, setDraft] = useState({ ...item, variant: item.variant, footprint: item.footprint });
  return <form class="editor-properties" aria-label={`Obstacle ${item.id} properties`} onSubmit={event => {
    event.preventDefault(); const { variant, yawDeg, footprint } = draft;
    onEdit({ type: 'obstacle-properties', id: item.id, value: { variant, yawDeg, footprint } });
  }}><fieldset disabled={disabled}><legend>Obstacle {item.id}</legend>
    <label>Obstacle variant<select aria-label="Obstacle variant" value={draft.variant ?? ''} onChange={event => setDraft({ ...draft, variant: (event.currentTarget.value || undefined) as typeof draft.variant })}><option value="">Default</option><option value="small">Small</option><option value="big">Big</option></select></label>
    <label>Yaw (degrees)<input type="number" required min="-360" max="360" step=".001" value={draft.yawDeg} onInput={event => setDraft({ ...draft, yawDeg: Number(event.currentTarget.value) })} /></label>
    <label>Footprint shape<select aria-label="Footprint shape" value={draft.footprint?.shape ?? ''} onChange={event => setDraft({ ...draft, footprint: event.currentTarget.value === '' ? undefined : event.currentTarget.value === 'circle' ? { shape: 'circle', radius: 1 } : { shape: 'box', w: 1, d: 1 } })}><option value="">Archetype default</option><option value="circle">Circle</option><option value="box">Box</option></select></label>
    {draft.footprint && (draft.footprint.shape === 'circle' ? ['radius'] : ['w', 'd']).map(field => <label key={field}>Footprint {field === 'w' ? 'width' : field === 'd' ? 'depth' : 'radius'}<input type="number" required min=".001" max="100" step=".001" value={draft.footprint![field as 'radius' | 'w' | 'd']} onInput={event => setDraft({ ...draft, footprint: { ...draft.footprint!, [field]: Number(event.currentTarget.value) } })} /></label>)}
    <button>Apply obstacle properties</button>
  </fieldset></form>;
}
