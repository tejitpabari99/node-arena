import { useLayoutEffect, useState } from 'preact/hooks';
import type { Speed } from '../driver';
import type { TestApi } from '../test-harness';
import type { KaneController } from './controller';
import type { Pair } from './pairs';
import { panelHeight } from './layout';

const speeds: readonly Speed[] = [0.25, 0.5, 1, 2];

function PairButton({ pair, locked, controller }: { pair: Pair; locked: boolean; controller: KaneController }) {
  const [press, setPress] = useState(0);
  const click = (button: HTMLButtonElement) => {
    button.animate([{ transform: 'scale(.96)' }, { transform: 'scale(1)' }], { duration: 400 });
    setPress(n => n + 1); controller.act(pair, 'click');
  };
  return <button class="kane-pair" data-testid="kane-pair" data-from={pair.fromLetter} data-to={pair.toLetter}
    data-from-index={pair.from} data-to-index={pair.to} data-state={pair.state} data-reason={pair.reason ?? ''}
    disabled={locked} onClick={event => click(event.currentTarget)} onDblClick={() => controller.act(pair, 'dblclick')}>
    {pair.text}{press > 0 && <span key={press} class="kane-ripple" aria-hidden="true"/>}
  </button>;
}

export function Overlay({ controller, api }: { controller: KaneController; api: TestApi }) {
  const [state, setState] = useState(controller.snapshot);
  const [height, setHeight] = useState(() => panelHeight(window.innerHeight));
  useLayoutEffect(() => {
    const resize = () => setHeight(panelHeight(window.innerHeight));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useLayoutEffect(() => {
    let frame: number | null = null;
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; setState(controller.snapshot()); });
    };
    const unsubscribe = controller.subscribe(schedule); schedule();
    return () => { unsubscribe(); if (frame !== null) cancelAnimationFrame(frame); controller.dispose(); };
  }, [controller]);
  if (!state.visible) return null;
  const cycle = () => {
    api.setSpeed(speeds[(speeds.indexOf(state.speed) + 1) % speeds.length]!); controller.refresh();
  };
  return <div class="kane-overlay" style={{ '--kane-panel-h': `${height}px` }} data-testid="kane-overlay" data-speed={state.speed} data-phase={state.phase}>
    <button class="kane-speed" data-testid="kane-speed" data-speed={state.speed} onClick={cycle}>Speed {state.speed}x</button>
    <section class="kane-panel" data-testid="kane-panel" data-locked={String(state.locked)} aria-label="Outgoing routes">
      {state.groups.map(group => <section class="kane-group" data-testid="kane-group" data-source={group.letter} key={group.from} role="group" aria-label={`House ${group.letter} outgoing routes`}>
        <h2 aria-label={`House ${group.letter} routes`} aria-description={group.text}>{group.text}</h2><div class="kane-pairs">{group.pairs.map(pair => <PairButton key={pair.to} pair={pair} locked={state.locked} controller={controller}/>)}</div>
      </section>)}
    </section>
    <div class="kane-banner" data-testid="kane-banner" role="alert" data-kind={state.banner?.kind ?? 'error'} data-reason={state.banner?.reason ?? ''} hidden={!state.banner}>{state.banner?.text}</div>
    {state.result && <div class="kane-result" data-testid="kane-result" data-outcome={state.result.outcome} data-winner={state.result.winner ?? ''}>
      {state.result.outcome === 'timeout' ? 'Time up' : state.result.winner === 0 ? 'Victory!' : 'Defeat'}
    </div>}
  </div>;
}
