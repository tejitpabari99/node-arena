import type { AppController } from '../app/state';
import { createAudio, type AudioOptions } from './index';
/** One application listener scope. Session identity prevents tick publications from restarting music.
 * Music continues through pause/settings/results, and ends on unloading the level. */
export function connectAppAudio(app: AppController, options: AudioOptions = {}) {
  const audio = createAudio(options);
  let session = app.assetSession;
  function sync() {
    audio.settings(app.snapshot().save.settings);
    const next = app.assetSession;
    if (!next || next.state !== 'ready' || !app.driver) {
      session = undefined; audio.clearLevel(); return;
    }
    if (session !== next) { session = next; audio.setLevel(app.manifest, next.audio); }
  }
  // Initial connection also works after a level has finished loading.
  session = undefined;
  const unsubscribe = app.subscribe(sync), unsubscribeEvents = app.subscribeEvents(update => {
    sync(); audio.consumeEvents(update.events, update.sim.view);
  });
  sync();
  return { audio, dispose() { unsubscribe(); unsubscribeEvents(); audio.dispose(); } };
}
