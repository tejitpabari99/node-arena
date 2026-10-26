import { useEffect, useRef } from 'preact/hooks';
import { shouldAutosave, type AutosaveState } from './save-core.js';

export const AUTOSAVE_MS = 30000;

/** 30s interval tick reading the latest state; fires `save` only when shouldAutosave allows. Never locks or finalizes. */
export function useAutosave(read: () => AutosaveState, save: () => void) {
  const latest = useRef({ read, save });
  latest.current = { read, save };
  useEffect(() => {
    const timer = setInterval(() => { if (shouldAutosave(latest.current.read())) latest.current.save(); }, AUTOSAVE_MS);
    return () => clearInterval(timer);
  }, []);
}
