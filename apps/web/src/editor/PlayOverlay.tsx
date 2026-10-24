import { useEffect } from 'preact/hooks';
import { contentFiles } from '../app/boot.js';
import type { LevelDoc } from './document.js';
import { mountEditorPlay } from './play.js';

export function PlayOverlay({ doc, onExit }: { doc: LevelDoc; onExit(): void }) {
  useEffect(() => {
    const play = mountEditorPlay(document.body, contentFiles(), doc, onExit);
    return () => play.dispose();
    // The snapshot and callback belong to this Play lifetime only.
  }, []);
  return null;
}
