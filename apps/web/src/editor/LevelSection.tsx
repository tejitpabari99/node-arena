import type { NextBuilding, SeatBot } from '@node-arena/content';
import { useState } from 'preact/hooks';
import { contentFiles } from '../app/boot.js';
import { useEditor } from './EditorContext.js';
import { canAddAi, canDeleteAi, MIN_DELAY, ownedCount, toDraft, addAi, deleteAi } from './level-draft.js';
import { isHouseArchetype } from './houses.js';
import { playerLabel } from './labels.js';
import type { LevelProperties } from './model.js';
import { LiveFieldError, useLiveField } from './useLiveField.js';

type Player = LevelProperties['players'][number];
const houseTypes = new Set(Object.entries(contentFiles()).filter(([path]) => path.startsWith('data/buildings/')).map(([, value]) => JSON.parse(value as string) as NextBuilding).filter(isHouseArchetype).map(arch => arch.id));
const integerIn = (text: string, min: number, max: number) => text.trim() !== '' && Number.isInteger(Number(text)) && Number(text) >= min && Number(text) <= max;

function LevelFields() {
  const { doc, edit, themes, endEditBurst } = useEditor();
  const name = useLiveField({ value: doc.name, mergeKey: `${doc.id}:name`, validate: text => text.trim() ? undefined : 'Level name is required.', commit: (text, merge) => edit(current => ({ type: 'level-properties', value: { ...toDraft(current), name: text } }), merge), endBurst: endEditBurst });
  const time = useLiveField({ value: String(doc.timeLimitSec ?? ''), mergeKey: `${doc.id}:timeLimitSec`, validate: text => text === '' || integerIn(text, 1, 107374182) ? undefined : 'Enter a whole number from 1 to 107374182, or leave blank.', commit: (text, merge) => edit(current => ({ type: 'level-properties', value: { ...toDraft(current), timeLimitSec: text === '' ? null : Number(text) } }), merge), endBurst: endEditBurst });
  return <>
    <label>Level id<output aria-label="Level id" title="Fixed when the level is created">{doc.id}</output></label>
    <label>Level name<input required {...name.inputProps} /><LiveFieldError field={name} /></label>
    <label>Level theme<select aria-label="Level theme" value={doc.theme} onChange={event => { const theme = event.currentTarget.value; edit(current => ({ type: 'level-properties', value: { ...toDraft(current), theme } })); }}>{[...new Set([doc.theme, ...themes])].map(theme => <option key={theme}>{theme}</option>)}</select></label>
    <label>Time limit (seconds)<input type="number" min="1" max="107374182" step="1" placeholder="Unlimited" {...time.inputProps} /><LiveFieldError field={time} /></label>
  </>;
}

function PlayerCard({ player: p, expanded, onToggle, onDelete }: { player: Player; expanded: boolean; onToggle(): void; onDelete(): void }) {
  const { doc, edit, colors, palettes, endEditBurst } = useEditor();
  const label = playerLabel(doc.players, p.id), bot = p.bot as SeatBot | undefined, ai = p.kind !== 'human';
  const color = useLiveField({ value: p.colorKey, mergeKey: `${doc.id}:${p.id}:color`, validate: text => doc.players.some(other => other.id !== p.id && other.colorKey === text) ? 'Each player needs a unique color.' : undefined, commit: text => edit(current => ({ type: 'level-properties', value: { ...toDraft(current), players: current.players.map(player => player.id === p.id ? { ...player, colorKey: text } : player) } })), endBurst: endEditBurst });
  const delay = useLiveField({ value: String(bot?.actionDelayMs ?? ''), mergeKey: `${doc.id}:${p.id}:delay`, validate: text => integerIn(text, MIN_DELAY, 2147483647) ? undefined : `Enter a whole number from ${MIN_DELAY} to 2147483647.`, commit: (text, merge) => edit(current => ({ type: 'level-properties', value: { ...toDraft(current), players: current.players.map(player => player.id === p.id ? { ...player, bot: { ...player.bot as SeatBot, actionDelayMs: Number(text) } } : player) } }), merge), endBurst: endEditBurst });
  const del = <button type="button" class="ed-btn" aria-label={`Delete ${label}`} disabled={!canDeleteAi(doc.players, p.id)} onClick={onDelete}>Delete</button>;
  return <div class="ed-player" data-player={p.id} data-open={expanded}>
    <div class="ed-player-head">
      <button type="button" class="ed-btn ed-btn-ghost" aria-expanded={expanded} aria-label={`${label} card`} onClick={onToggle}>
        <span class="ed-chip">{label}</span><span class="ed-swatch" data-testid={`swatch-${p.id}`} style={{ background: palettes[p.colorKey] ?? '#ccc' }} title={p.colorKey} />
      </button>{ai && !expanded && del}
    </div>
    {expanded && <div class="ed-player-body">
      <label>{label} color<select aria-label={`${label} color`} value={color.value} aria-invalid={color.inputProps['aria-invalid']} aria-describedby={color.inputProps['aria-describedby']} onBlur={color.onBlur} onChange={event => { color.onInput(event); color.flush(); endEditBurst(); }}>{[...new Set([p.colorKey, ...colors])].map(value => <option key={value}>{value}</option>)}</select><LiveFieldError field={color} /></label>
      {ai && bot && <>
        <label>{label} action delay (ms)<input type="number" required min={MIN_DELAY} max="2147483647" step="1" {...delay.inputProps} /><LiveFieldError field={delay} /></label>
        <label>{label} behavior<select aria-label={`${label} behavior`} value={bot.behavior} onChange={event => { const behavior = event.currentTarget.value as 'full' | 'attackOnly'; edit(current => ({ type: 'level-properties', value: { ...toDraft(current), players: current.players.map(player => player.id === p.id ? { ...player, bot: { ...player.bot as SeatBot, behavior } } : player) } })); }}><option value="full">Full</option><option value="attackOnly">Attack only</option></select></label>
      </>}{ai && del}
    </div>}
  </div>;
}

/** Each validated field commits independently; text bursts share one undo step. */
export function LevelSection() {
  const { doc, edit, colors, locked } = useEditor();
  const [open, setOpen] = useState<string | null>(null), [confirm, setConfirm] = useState<string | null>(null);
  function add() {
    const next = addAi(toDraft(doc), colors), player = next.players.at(-1);
    if (next.players.length === doc.players.length || !player) return;
    const eligible = doc.buildings.filter(item => item.owner === null && houseTypes.has(item.archetype));
    const ownBuilding = eligible[Math.floor(Math.random() * eligible.length)]?.id ?? null;
    edit({ type: 'add-ai', player, ownBuilding });
  }
  return <form class="ed-level" aria-label="Level properties" onSubmit={event => event.preventDefault()}><fieldset disabled={locked}>
    <LevelFields key={doc.id} />
    <div class="ed-players">{doc.players.map(p => <div key={`${doc.id}:${p.id}`}>
      <PlayerCard player={p} expanded={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} onDelete={() => setConfirm(p.id)} />
      {confirm === p.id && <div class="ed-confirm" role="alertdialog" aria-label={`Confirm delete ${playerLabel(doc.players, p.id)}`}>
        <p>Delete {playerLabel(doc.players, p.id)}?{ownedCount(doc, p.id) > 0 && ` Its ${ownedCount(doc, p.id)} building${ownedCount(doc, p.id) === 1 ? '' : 's'} become Neutral.`}</p>
        <button type="button" class="ed-btn" onClick={() => { if (canDeleteAi(doc.players, p.id)) edit(current => ({ type: 'level-properties', value: deleteAi(toDraft(current), p.id) })); setConfirm(null); setOpen(null); }}>Confirm delete</button>{' '}
        <button type="button" class="ed-btn" onClick={() => setConfirm(null)}>Cancel</button>
      </div>}
    </div>)}</div>
    <button type="button" class="ed-btn" disabled={!canAddAi(doc.players, colors)} onClick={add}>Add AI</button>
  </fieldset></form>;
}
