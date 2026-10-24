import type { CompiledLevel } from '@node-arena/content';
import type { SimView } from '@node-arena/sim';
import type { AppController } from '../app/state';
import type { GameDriver } from '../driver';
import { DRAW_REASON_TEXT } from '../input/reasons';
import { addPending, clearPending, computeBlocked, decidePairAction, derivePairs, pairKey, type Group, type Pair, type PendingPairs } from './pairs';

export interface KaneBanner { text: string; reason: string; kind: 'error' | 'gameover' }
export interface KaneSnapshot {
  visible: boolean;
  speed: GameDriver['speed'];
  phase: 'playing' | 'paused' | 'over';
  locked: boolean;
  groups: Group[];
  banner: KaneBanner | null;
  result: SimView['over'];
}

/** One source for rendered pairs and feedback, also consumed by the Kane summary. */
export function createKaneController(app: AppController) {
  const listeners = new Set<() => void>();
  let boundDriver: GameDriver | null = null, blocked: ReadonlySet<string> = new Set();
  let pending: PendingPairs = new Map(), drawnAt = new Map<string, number>();
  let banner: KaneBanner | null = null, timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const read = (): KaneSnapshot => {
    const state = app.snapshot(), driver = app.driver, view = driver?.sim.view;
    const result = view?.over ?? state.result;
    return {
      visible: app.kaneMode && (state.screen === 'playing' || state.screen === 'result'),
      speed: driver?.speed ?? 0.25,
      phase: result ? 'over' : driver?.paused ? 'paused' : 'playing',
      locked: !!result || state.screen === 'result',
      groups: view && driver === boundDriver ? derivePairs(view, (from, to) => driver.sim.canDraw(0, from, to), blocked) : [],
      banner, result,
    };
  };
  let snapshot = read(), signature = JSON.stringify(snapshot);
  const refresh = () => {
    if (disposed) return;
    if (boundDriver && app.driver !== boundDriver) {
      boundDriver = null; blocked = new Set(); pending = new Map(); drawnAt = new Map(); banner = null; clearTimer();
    }
    if (app.driver?.sim.view.over || app.snapshot().screen === 'result') {
      clearTimer(); banner = { text: 'Game over', reason: 'gameover', kind: 'gameover' };
    }
    const next = read(), nextSignature = JSON.stringify(next);
    // Refresh the accessor every tick, even when no render is needed.
    snapshot = next;
    if (nextSignature !== signature) { signature = nextSignature; listeners.forEach(fn => fn()); }
  };
  const showBanner = (text: string, reason: string) => {
    clearTimer(); banner = { text, reason, kind: 'error' };
    timer = setTimeout(() => { timer = undefined; banner = null; refresh(); }, 12000);
    refresh();
  };
  const unsubscribe = app.subscribe(refresh);
  const unsubscribeEvents = app.subscribeEvents(update => {
    pending = clearPending(pending, update.tick);
    for (const event of update.events) {
      if (event.type === 'LineDrawn') drawnAt.set(pairKey(event.from, event.to), performance.now());
      if (event.type === 'LineCut') drawnAt.delete(pairKey(event.from, event.to));
      if (event.type === 'CommandRejected' && event.player === 0) showBanner(DRAW_REASON_TEXT[event.reason], event.reason);
    }
    refresh();
  });
  const visibility = () => {
    if (!document.hidden && app.kaneMode && app.driver?.pauseReason === 'hidden'
      && !app.snapshot().restartPopup && !app.driver.sim.view.over) app.resume();
    refresh();
  };
  const visibilityTarget = typeof document === 'undefined' ? undefined : document;
  visibilityTarget?.addEventListener('visibilitychange', visibility);
  return {
    snapshot: () => snapshot,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    refresh,
    /** Called by runtime wiring once for each new level/driver, before play begins. */
    bindLevel(level: CompiledLevel, driver: GameDriver) {
      if (driver === boundDriver) return;
      boundDriver = driver; blocked = computeBlocked(level); pending = new Map(); drawnAt = new Map(); banner = null; clearTimer(); refresh();
    },
    act(pair: Pair, gesture: 'click' | 'dblclick') {
      if (disposed) return;
      refresh();
      if (snapshot.locked) return;
      if (gesture === 'click') { clearTimer(); banner = null; }
      const driver = app.driver, key = pairKey(pair.from, pair.to);
      const action = decidePairAction(pair.state, gesture, pending.has(key), drawnAt.get(key), performance.now());
      if (action === 'reason' && pair.reason) showBanner(DRAW_REASON_TEXT[pair.reason], pair.reason);
      else if (driver && (action === 'draw' || action === 'cut')) {
        const reason = action === 'draw' ? driver.sim.canDraw(0, pair.from, pair.to) : null;
        if (reason) showBanner(DRAW_REASON_TEXT[reason], reason);
        else {
          const submission = driver.submit({ type: action === 'draw' ? 'DrawLine' : 'CutLine', player: 0, from: pair.from, to: pair.to });
          if (submission) pending = addPending(pending, pair.from, pair.to, submission.tick);
          else showBanner(driver.sim.view.over ? 'Game over' : 'Game paused', driver.sim.view.over ? 'gameover' : 'paused');
        }
      }
      refresh();
    },
    dispose() { if (disposed) return; disposed = true; visibilityTarget?.removeEventListener('visibilitychange', visibility); unsubscribe(); unsubscribeEvents(); clearTimer(); listeners.clear(); },
  };
}
export type KaneController = ReturnType<typeof createKaneController>;
