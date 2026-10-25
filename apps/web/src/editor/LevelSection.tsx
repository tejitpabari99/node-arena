import type { SeatBot } from '@node-arena/content';
import { useEffect, useState } from 'preact/hooks';
import { useEditor } from './EditorContext.js';
import { canAddAi, canApply, canDeleteAi, delayValid, duplicateColors, MIN_DELAY, ownedCount, toDraft, addAi, deleteAi } from './level-draft.js';
import { playerLabel } from './labels.js';
import type { LevelProperties } from './model.js';

type Player = LevelProperties['players'][number];

/** Level fields and player cards edit a local draft; one Apply dispatches one `level-properties` op. */
export function LevelSection() {
  const { doc, edit, themes, colors, palettes, locked } = useEditor();
  const [draft, setDraft] = useState<LevelProperties>(() => toDraft(doc));
  const [open, setOpen] = useState<string | null>(null), [confirm, setConfirm] = useState<string | null>(null);
  const sync = JSON.stringify(toDraft(doc));
  useEffect(() => { setDraft(toDraft(doc)); setConfirm(null); }, [sync]);
  const patch = (id: string, change: Partial<Player>) => setDraft({ ...draft, players: draft.players.map(p => p.id === id ? { ...p, ...change } as Player : p) });
  const dupes = duplicateColors(draft.players);
  const ok = canApply(doc, draft);
  const del = (p: Player) => <button type="button" class="ed-player-delete" aria-label={`Delete ${playerLabel(draft.players, p.id)}`} disabled={!canDeleteAi(draft.players, p.id)} onClick={() => setConfirm(p.id)}>Delete</button>;
  return <form class="ed-level" aria-label="Level properties" onSubmit={event => { event.preventDefault(); if (ok && !locked) edit({ type: 'level-properties', value: draft }); }}>
    <fieldset disabled={locked}>
      <label>Level name<input required value={draft.name} onInput={event => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
      <label>Level theme<select aria-label="Level theme" value={draft.theme} onChange={event => setDraft({ ...draft, theme: event.currentTarget.value })}>{[...new Set([draft.theme, ...themes])].map(theme => <option key={theme}>{theme}</option>)}</select></label>
      <label>Time limit (seconds)<input type="number" min="1" max="107374182" step="1" placeholder="Unlimited" value={draft.timeLimitSec ?? ''} onInput={event => setDraft({ ...draft, timeLimitSec: event.currentTarget.value === '' ? null : Number(event.currentTarget.value) })} /></label>
      <div class="ed-players">
        {draft.players.map(p => {
          const label = playerLabel(draft.players, p.id), expanded = open === p.id, bot = p.bot as SeatBot | undefined, ai = p.kind !== 'human';
          const count = ownedCount(doc, p.id);
          return <div key={p.id} class="ed-player" data-player={p.id} data-open={expanded}>
            <div class="ed-player-head">
              <button type="button" class="ed-player-toggle" aria-expanded={expanded} aria-label={`${label} card`} onClick={() => setOpen(expanded ? null : p.id)}>
                <span class="ed-chip">{label}</span>
                <span class="ed-swatch" data-testid={`swatch-${p.id}`} style={{ background: palettes[p.colorKey] ?? '#ccc' }} title={p.colorKey} />
              </button>
              {ai && !expanded && del(p)}
            </div>
            {expanded && <div class="ed-player-body">
              <label>{label} color<select aria-label={`${label} color`} value={p.colorKey} onChange={event => patch(p.id, { colorKey: event.currentTarget.value })}>{[...new Set([p.colorKey, ...colors])].map(color => <option key={color}>{color}</option>)}</select></label>
              {ai && bot && <>
                <label>{label} action delay (ms)<input type="number" required min={MIN_DELAY} max="2147483647" step="1" value={bot.actionDelayMs} aria-invalid={!delayValid(p)} onInput={event => patch(p.id, { bot: { ...bot, actionDelayMs: Number(event.currentTarget.value) } })} /></label>
                <label>{label} behavior<select aria-label={`${label} behavior`} value={bot.behavior} onChange={event => patch(p.id, { bot: { ...bot, behavior: event.currentTarget.value as 'full' | 'attackOnly' } })}><option value="full">Full</option><option value="attackOnly">Attack only</option></select></label>
              </>}
              {ai && del(p)}
            </div>}
            {confirm === p.id && <div class="ed-confirm" role="alertdialog" aria-label={`Confirm delete ${label}`}>
              <p>Delete {label}?{count > 0 && ` Its ${count} building${count === 1 ? '' : 's'} become Neutral.`}</p>
              <button type="button" onClick={() => { setDraft(deleteAi(draft, p.id)); setConfirm(null); setOpen(null); }}>Confirm delete</button>{' '}
              <button type="button" onClick={() => setConfirm(null)}>Cancel</button>
            </div>}
          </div>;
        })}
      </div>
      <button type="button" disabled={!canAddAi(draft.players, colors)} onClick={() => setDraft(addAi(draft, colors, doc.players))}>Add AI</button>
      {dupes.length > 0 && <p class="ed-note" role="status">Each player needs a unique color.</p>}
      <button class="ed-btn-primary ed-apply" disabled={!ok}>Apply level properties</button>
    </fieldset>
  </form>;
}
