import { render } from "preact";
import { useEffect, useLayoutEffect, useState } from "preact/hooks";
import type { AppController } from "../app/state";
import type { SaveSettings } from "../save";
import { editField, downloadFiles, type PerfSnapshot } from "../dev";
import { AssetError } from "../manifest/resolve";
import { Credits } from "./Credits";
const outcomes = {
  won: "Victory",
  lost: "Defeat",
  timeout: "Time is up",
  draw: "Mutual defeat — not completed",
};
function errorText(error: unknown): string {
  if (Array.isArray(error)) return error.map(errorText).join("\n");
  if (error instanceof AssetError)
    return `${error.key}: ${error.src}\n${String(error.cause)}`;
  return error instanceof Error ? error.message : String(error);
}
function PerfHud({ app }: {app:AppController}) {
  const [metrics,setMetrics]=useState<PerfSnapshot|undefined>(app.runtime?.metrics);
  useEffect(()=>{ const timer=setInterval(()=>setMetrics(app.runtime?.metrics),250); return ()=>clearInterval(timer); },[app]);
  if(!metrics) return null;
  return <output class="perf" aria-label="Performance metrics">
    {metrics.fps.toFixed(1)} fps · frame p95 {metrics.frameP95.toFixed(2)} ms<br/>
    JS {metrics.jsMs.toFixed(2)} ms/frame · sim step {metrics.simStepMs.toFixed(2)} ms<br/>
    {metrics.drawCalls} draw calls · {metrics.triangles} triangles · {metrics.troops} troops
  </output>;
}
function DevPanel({app}:{app:AppController}) {
  const [draft,setDraft]=useState(app.contentFiles);
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const fields=app.tuningFields;
  const state=app.snapshot();
  return <details class="dev-panel">
    <summary>Live tuning {state.devTuned ? '· Tuned' : ''}</summary>
    <p>Apply restarts the arena. Tuned matches do not record completion.</p>
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);try {if(await app.applyDevFiles(draft)){setDraft(app.contentFiles);setDirty(false);}} finally {setBusy(false);} }}>
      {fields.map(field=> {
        const value=field.pointer.split('/').slice(1).reduce((v,k)=>v?.[k.replace(/~1/g,'/').replace(/~0/g,'~')],JSON.parse(draft[field.file] as string))??field.value;
        return <label class="tuning-field" key={field.file+field.pointer}>
          <span>{field.file}{field.pointer}{field.inherited?' (inherited)':''}</span>
          <input aria-label={field.file+field.pointer} type={field.type==='boolean'?'checkbox':'number'}
            value={field.type==='boolean'?undefined:value} checked={field.type==='boolean'?value:undefined}
            min={field.minimum} max={field.maximum} step={field.step}
            onInput={e=>{setDraft(editField(draft,field,field.type==='boolean'?e.currentTarget.checked:e.currentTarget.valueAsNumber));setDirty(true);}} />
        </label>;
      })}
      {state.devError && <p class="error" role="alert">{state.devError}</p>}
      <button type="submit" disabled={!dirty||busy}>{busy?'Applying…':'Apply and restart'}</button>
      <button type="button" disabled={busy} onClick={()=>{setDraft(app.contentFiles);setDirty(false);}}>Reset pending edits</button>
      <button type="button" disabled={!app.exportedFiles.length} onClick={()=>downloadFiles(app.exportedFiles)}>Export JSON</button>
      <ul>{app.exportedFiles.map(file=><li key={file.path}>{file.path}</li>)}</ul>
    </form>
  </details>;
}
export function App({ app }: { app: AppController }) {
  const [state, setState] = useState(app.snapshot());
  const [showCredits, setShowCredits] = useState(false);
  useLayoutEffect(() => app.subscribe(() => setState(app.snapshot())), [app]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        app.escape();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [app]);
  useEffect(() => {
    if (state.screen === "playing" || state.screen === "boot") return;
    document.querySelector<HTMLElement>(".panel button, .panel input")?.focus();
  }, [state.screen]);
  const current = state.levels.find((l) => l.id === state.levelId),
    hasNext =
      state.levels.findIndex((l) => l.id === state.levelId) <
      state.levels.length - 1;
  const settings = state.save.settings;
  const toggle = (
    key: "musicMute" | "sfxMute" | "colorblind" | "reducedMotion",
    name: string,
  ) => (
    <label class="setting">
      <span>{name}</span>
      <input
        type="checkbox"
        checked={settings[key]}
        onChange={(e) => app.updateSettings({ [key]: e.currentTarget.checked })}
      />
    </label>
  );
  const game =
    ["playing", "paused", "results"].includes(state.screen) ||
    (state.screen === "settings" && !!app.driver);
  return (
    <main
      data-screen={state.screen}
      class={game ? "game-screen" : "menu-screen"}
    >
      <header class="brand">
        <span class="brand-mark" aria-hidden="true">
          ▲
        </span>
        <h1>Node Arena</h1>
        <span class="brand-subtitle">Connect. Capture. Conquer.</span>
      </header>
      {state.notices.length > 0 && (
        <aside class="notice" role="status">
          {state.notices.map((text) => (
            <p key={text}>{text}</p>
          ))}
          <button onClick={() => app.dismissNotices()}>Dismiss</button>
        </aside>
      )}
      {game && (
        <div class="hud">
          <strong>{current?.name}</strong>
          <span role="timer" aria-label="Time remaining">
            {Math.floor(state.remainingSeconds / 60)}:
            {String(state.remainingSeconds % 60).padStart(2, "0")}
          </span>
          <button
            disabled={state.screen !== "playing"}
            onClick={() => app.setSpeed(state.speed === 1 ? 2 : 1)}
            aria-label="Game speed"
          >
            {state.speed}×
          </button>
          <button
            disabled={state.screen !== "playing"}
            onClick={() => app.pause()}
          >
            Pause
          </button>
          <button aria-pressed={state.perf} onClick={() => app.togglePerf()}>
            Performance
          </button>
        </div>
      )}
      {state.perf && app.driver && <PerfHud app={app} />}
      {state.devEnabled && state.screen !== "boot" && <DevPanel app={app} />}
      {state.devTuned && <span class="tuned-badge" role="status">Tuned · completion disabled</span>}
      {state.screen === "boot" && (
        <section class="panel">
          <h2>Preparing the arena</h2>
          <p role="status">Loading content and visual manifest…</p>
        </section>
      )}
      {state.screen === "menu" && showCredits && <Credits onBack={() => setShowCredits(false)} />}
      {state.screen === "menu" && !showCredits && (
        <section class="panel">
          <p class="eyebrow">A city worth fighting for</p>
          <h2>Your next move starts here</h2>
          <p>
            Build routes between your towers. Keep troops moving and take the
            city.
          </p>
          <button class="primary" onClick={() => app.openPicker()}>
            Play
          </button>
          <button onClick={() => app.openSettings()}>Settings</button>
          <button onClick={() => setShowCredits(true)}>Credits</button>
          <p class="subtle">
            {state.levels.length}{" "}
            {state.levels.length === 1 ? "arena" : "arenas"} available
          </p>
        </section>
      )}
      {state.screen === "picker" && (
        <section class="panel picker">
          <h2>Choose an arena</h2>
          <div class="level-grid">
            {state.levels.map((level) => (
              <button
                class="level"
                key={level.id}
                onClick={() => void app.startLevel(level.id)}
              >
                <span class="level-order">{level.order}</span>
                <strong>{level.name}</strong>
                <span>
                  {state.save.completed[level.id]
                    ? "✓ Completed"
                    : "Ready to play"}
                </span>
              </button>
            ))}
          </div>
          <button onClick={() => app.menu()}>Back to menu</button>
        </section>
      )}
      {state.screen === "loading" && (
        <section class="panel">
          <h2>Entering {current?.name}</h2>
          <p role="status">Preparing the arena…</p>
          <button onClick={() => app.menu()}>Back to menu</button>
        </section>
      )}
      {state.screen === "playing" && (
        <p class="instructions">
          Drag from your tower to connect · Swipe across a route or right-click
          to cut · Esc to pause
        </p>
      )}
      {state.screen === "paused" && (
        <section class="panel overlay">
          <h2>Paused</h2>
          <button class="primary" onClick={() => app.resume()}>
            Resume
          </button>
          <button onClick={() => void app.restart()}>Restart</button>
          <button onClick={() => app.openSettings()}>Settings</button>
          <button onClick={() => app.menu()}>Quit to menu</button>
        </section>
      )}
      {state.screen === "results" && state.result && (
        <section class="panel overlay" data-outcome={state.result.outcome}>
          <p class="eyebrow">{current?.name}</p>
          <h2>{outcomes[state.result.outcome]}</h2>
          {state.result.winnerTeam && (
            <p>Winning team: {state.result.winnerTeam}</p>
          )}
          <button class="primary" onClick={() => void app.restart()}>
            Retry
          </button>
          {hasNext && (
            <button onClick={() => void app.next()}>Next arena</button>
          )}
          <button onClick={() => app.menu()}>Back to menu</button>
        </section>
      )}
      {state.screen === "settings" && (
        <section class="panel settings overlay">
          <h2>Settings</h2>
          {(["musicVol", "sfxVol"] as const).map((key) => (
            <label class="setting" key={key}>
              <span>
                {key === "musicVol" ? "Music volume" : "Sound effects volume"}
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings[key]}
                onInput={(e) =>
                  app.updateSettings({ [key]: Number(e.currentTarget.value) })
                }
              />
            </label>
          ))}
          {toggle("musicMute", "Mute music")}
          {toggle("sfxMute", "Mute sound effects")}
          {toggle("colorblind", "Colourblind palette")}
          {toggle("reducedMotion", "Reduced motion")}
          <label class="setting">
            <span>Quality</span>
            <select
              aria-label="Quality"
              value={settings.quality}
              onChange={(e) =>
                app.updateSettings({
                  quality: e.currentTarget.value as SaveSettings["quality"],
                })
              }
            >
              <option value="low">Low</option>
              <option value="med">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label class="setting"><span>Performance HUD</span><input type="checkbox" checked={state.perf} onChange={()=>app.togglePerf()}/></label>
          <button onClick={() => app.closeSettings()}>Done</button>
        </section>
      )}
      {state.screen === "error" && (
        <section class="panel">
          <h2>Unable to load the arena</h2>
          <p class="error" role="alert">
            {errorText(state.error)}
          </p>
          <button class="primary" onClick={() => void app.retry()}>
            Retry
          </button>
          <button onClick={() => app.menu()}>Back to menu</button>
        </section>
      )}
    </main>
  );
}

export function mountApp(app: AppController, parent: HTMLElement) {
  render(<App app={app} />, parent);
}
