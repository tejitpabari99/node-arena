import { useEffect, useRef, useState } from "preact/hooks";
import type { AppController, AppSnapshot } from "../app/state";
import type { TickUpdate } from "../driver";
import { strength, type Strength } from "./strength";

export const TIP_TEXT = "Drag from your tower to connect · swipe across a lane or right-click to cut · Esc to pause";
/** Strength is sampled at the HUD tick, never per frame (PRD R1: <= 10 Hz). */
export const HUD_TICK_MS = 100;
const TIP_FADE_MS = 350;

export function formatTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
/** R3: tip only on the first level (order 1) while it has not been seen. */
export function tipVisible(order: number | undefined, tipSeen: boolean, screen: AppSnapshot["screen"]): boolean {
  return order === 1 && !tipSeen && (screen === "playing" || screen === "paused");
}
/** True when this tick contains a successful DrawLine by the human player (sim emits LineDrawn only on success). */
export function humanDrewLine(update: Pick<TickUpdate, "sim" | "events">): boolean {
  const human = update.sim.view.players.findIndex((p) => p.kind === "human");
  return update.events.some((e) => e.type === "LineDrawn" && e.owner === human);
}
export function meterValueNow(s: Strength): number {
  return s.segments[0]?.pct ?? 0;
}

export interface HudViewProps {
  levelOrder: number | undefined;
  levelName: string;
  time: string;
  strength: Strength;
  /** colorKey -> CSS colour (palette-aware). */
  colors: Readonly<Record<string, string>>;
  colorblind: boolean;
  reducedMotion: boolean;
  speed: 1 | 2;
  canAct: boolean;
  tip: "shown" | "fading" | null;
  onPause: () => void;
  onSpeed: () => void;
  onDismissTip: () => void;
}

/** Stateless HUD markup (unit-testable); `Hud` below feeds it. DOM contract: visual/lib/hud-metrics.mjs header. */
export function HudView(p: HudViewProps) {
  return (
    <div class="hud-root" data-hud="root">
      <button type="button" class="hud-round hud-pause" data-hud="pause" aria-label="Pause" disabled={!p.canAct} onClick={p.onPause}>
        <span class="hud-pause-icon" aria-hidden="true" />
      </button>
      <div class="hud-pill" data-hud="pill">
        <div class="hud-pill-row">
          <strong class="hud-level">
            Level {p.levelOrder} · {p.levelName}
          </strong>
          <span class="hud-timer" role="timer" aria-label="Time remaining">{p.time}</span>
        </div>
        <div
          class={`hud-meter${p.colorblind ? " cb" : ""}${p.reducedMotion ? " still" : ""}`}
          data-hud="meter"
          role="meter"
          aria-label="Team strength"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meterValueNow(p.strength)}
          aria-valuetext={p.strength.ariaText}
        >
          {p.strength.segments.map((s, i) => (
            <span
              key={s.team}
              data-hud-seg=""
              data-team={s.team}
              data-i={i}
              style={{ width: `${s.pct}%`, background: p.colors[s.colorKey] ?? "#888" }}
            />
          ))}
        </div>
      </div>
      <button type="button" class="hud-round hud-speed" data-hud="speed" aria-label="Game speed" aria-pressed={p.speed === 2} disabled={!p.canAct} onClick={p.onSpeed}>
        {p.speed}×
      </button>
      {p.tip && (
        <aside class={`hud-tip${p.tip === "fading" ? " fading" : ""}`} data-hud="tip" role="status">
          <p>{TIP_TEXT}</p>
          <button type="button" onClick={p.onDismissTip}>Dismiss</button>
        </aside>
      )}
    </div>
  );
}

const EMPTY: Strength = { segments: [], total: 0, ariaText: "" };

export function Hud({ app, state }: { app: AppController; state: AppSnapshot }) {
  const settings = state.save.settings;
  const current = state.levels.find((l) => l.id === state.levelId);
  const [s, setS] = useState<Strength>(EMPTY);
  const key = useRef("");
  useEffect(() => {
    const sample = () => {
      const view = app.driver?.sim.view;
      if (!view) return;
      const next = strength(view, { colorblind: settings.colorblind });
      const sig = JSON.stringify(next.segments.map((x) => [x.team, x.pct, x.name]));
      if (sig !== key.current) { key.current = sig; setS(next); }
    };
    sample();
    const timer = setInterval(sample, HUD_TICK_MS);
    return () => clearInterval(timer);
  }, [app, state.levelId, state.screen, settings.colorblind]);

  const visible = tipVisible(current?.order, settings.tipSeen, state.screen);
  const [ghost, setGhost] = useState(false);
  const wasVisible = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (wasVisible.current && !visible && state.screen !== "results" && !settings.reducedMotion && settings.tipSeen) {
      setGhost(true);
      timer = setTimeout(() => setGhost(false), TIP_FADE_MS);
    }
    wasVisible.current = visible;
    return () => timer && clearTimeout(timer);
  }, [visible]);
  // R3: first successful DrawLine by the human fades the tip and records tipSeen.
  useEffect(() => {
    if (!visible) return;
    return app.subscribeEvents((update) => {
      if (humanDrewLine(update)) app.updateSettings({ tipSeen: true });
    });
  }, [app, visible]);

  const palette = app.manifest?.palettes?.[settings.colorblind ? "colorblind" : "default"] ?? {};
  return (
    <HudView
      levelOrder={current?.order}
      levelName={current?.name ?? ""}
      time={formatTime(state.remainingSeconds)}
      strength={s}
      colors={palette}
      colorblind={settings.colorblind}
      reducedMotion={settings.reducedMotion}
      speed={state.speed}
      canAct={state.screen === "playing"}
      tip={visible ? "shown" : ghost ? "fading" : null}
      onPause={() => app.pause()}
      onSpeed={() => app.setSpeed(state.speed === 1 ? 2 : 1)}
      onDismissTip={() => app.updateSettings({ tipSeen: true })}
    />
  );
}
