import { useEffect, useState } from 'preact/hooks';
import { useEditor } from './EditorContext.js';
import type { LibraryItem } from './model.js';
import { getThumbnails, LIBRARY_ITEMS, type Thumbnails } from './thumbnails.js';

const LABELS: Record<LibraryItem, string> = { 'house-wt1': 'House 1', 'house-wt2': 'House 2', tower: 'Tower', 'obstacle-small': 'Small obstacle', 'obstacle-big': 'Big obstacle' };

/** Drag-to-place tiles; thumbnails render lazily and fall back to a text tile. */
export function LibrarySection() {
  const { viewport, locked } = useEditor();
  const [thumbs, setThumbs] = useState<Thumbnails>({});
  useEffect(() => {
    let live = true;
    void getThumbnails().then(result => { if (live) setThumbs(result); });
    return () => { live = false; };
  }, []);
  return <div class="ed-library">
    <div class="ed-library-grid">
      {LIBRARY_ITEMS.map(item => <button key={item} type="button" class="ed-btn ed-library-tile" data-item={item} disabled={locked} aria-label={`Place ${item}`} onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); viewport.current?.beginPlacement(item, event.pointerId);
      }}>
        {thumbs[item] ? <img src={thumbs[item]} alt="" draggable={false} /> : <span class="ed-library-fallback" aria-hidden="true">{LABELS[item]}</span>}
        <span class="ed-library-label" aria-hidden="true">{LABELS[item]}</span>
      </button>)}
    </div>
    <p class="ed-field-hint">Drag an item onto the view.</p>
  </div>;
}
