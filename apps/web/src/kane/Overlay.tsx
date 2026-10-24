import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { AppController } from '../app/state';
import type { Speed } from '../driver';
import type { TestApi } from '../test-harness';

const speeds: readonly Speed[] = [0.25, 0.5, 1, 2];

export function Overlay({ app, api }: { app: AppController; api: TestApi }) {
  const read = () => ({
    visible: app.kaneMode && (app.snapshot().screen === 'playing' || app.snapshot().screen === 'result'),
    speed: app.driver?.speed ?? 0.25,
    phase: app.driver?.sim.view.over ? 'over' : app.driver?.paused ? 'paused' : 'playing',
  });
  const [state, setState] = useState(read);
  const refresh = useRef<() => void>();
  useLayoutEffect(() => {
    let frame: number | null = null, signature = JSON.stringify(state);
    const update = () => {
      const next = read(), nextSignature = JSON.stringify(next);
      if (nextSignature === signature) return;
      signature = nextSignature; setState(next);
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; update(); });
    };
    refresh.current = schedule;
    const unsubscribe = app.subscribe(schedule), unsubscribeEvents = app.subscribeEvents(schedule);
    // Cover a driver change between first render and subscription setup.
    schedule();
    return () => {
      unsubscribe(); unsubscribeEvents();
      refresh.current = undefined;
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [app]);
  if (!state.visible) return null;
  const cycle = () => {
    const driver = app.driver; if (!driver) return;
    api.setSpeed(speeds[(speeds.indexOf(driver.speed) + 1) % speeds.length]!); refresh.current?.();
  };
  return <div class="kane-overlay" data-testid="kane-overlay" data-speed={state.speed} data-phase={state.phase}>
    <button class="kane-speed" data-testid="kane-speed" data-speed={state.speed} onClick={cycle}>Speed {state.speed}x</button>
  </div>;
}
