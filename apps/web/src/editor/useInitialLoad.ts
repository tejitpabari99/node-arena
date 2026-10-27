import { useEffect, useState } from 'preact/hooks';
import { type LevelDoc } from './document.js';
import { listLevels, readLevel, type LevelListing } from './api.js';

export interface InitialLoad {
  levels: LevelListing[];
  setLevels(items: LevelListing[]): void;
  loading: boolean;
  /** Load/URL failure; shown inside the standalone file modal. */
  error: string;
  /** Level id the URL asked for, preselected as the copy source. */
  copyHint: string;
  /** Game-menu handoff; an explicit level URL always takes precedence. */
  create: boolean;
}

/** Lists levels once and applies `?create=1` / `?level=` URL flows. `onOpen(doc, saved)` installs the document. */
export function useInitialLoad(onOpen: (doc: LevelDoc, saved: boolean) => void): InitialLoad {
  const [levels, setLevels] = useState<LevelListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copyHint, setCopyHint] = useState('');
  const [create] = useState(() => { const params = new URLSearchParams(window.location.search); return params.get('create') === '1' && !params.has('level'); });
  useEffect(() => {
    void listLevels().then(async items => {
      setLevels(items);
      const params = new URLSearchParams(window.location.search);
      const requested = params.get('level');
      if (requested === null) return;
      // Only server-listed ids reach the API. Imported levels always require a new copy id.
      if (!items.some(item => item.id === requested)) throw new Error('Unknown level requested. Choose a level below.');
      setCopyHint(requested);
      if (requested.startsWith('na-')) onOpen(await readLevel(requested), true);
    }).catch(reason => setError(String(reason))).finally(() => setLoading(false));
  }, []);
  return { levels, setLevels, loading, error, copyHint, create };
}
