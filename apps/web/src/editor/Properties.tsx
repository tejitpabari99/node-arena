import { LevelSchema, type NextBuilding, type SeatBot } from '@node-arena/content';
import { useEffect, useState } from 'preact/hooks';
import { contentFiles } from '../app/boot.js';
import type { LevelDoc } from './document.js';
import type { DocOp, LevelProperties } from './model.js';
import type { Selection } from './picking.js';

type Edit = (op: DocOp) => void;
export const archetypes = Object.fromEntries(Object.entries(contentFiles()).filter(([path]) => path.startsWith('data/buildings/')).map(([, value]) => {
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
