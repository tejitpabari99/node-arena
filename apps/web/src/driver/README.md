# Fixed-step game driver

`GameDriver` owns a simulation and bot adapter for one match. Construct with `{level, matchSeed}`; the same compiled level and seed go to both factories. Browser construction starts rAF by default. Set `autoStart: false` for test mode.

- `sim` exposes the public SP02 interface for rendering/queries/hash. Route all steps through the driver.
- `submit(command)` copies/freezes input and returns `{tick: sim.tick, cmd}`, or `null` while paused, hidden, disposed or gameover. Multiple commands between ticks retain their order and execute once. Each tick merges player commands followed by `bot.commands(sim)`, then calls `sim.step`.
- Submission stamps are **zero-based**, before `step` increments the sim tick. The sim `Command` and replay contracts remain unchanged: the envelope stays in the driver, and only its `cmd` is passed to sim/replay recorder. `createSim` can supply `createReplayRecorder`; recordings include player and bot commands exactly once, with the recorder's existing stamps.
- `onTick({tick, sim, submissions, events})` fires after every completed tick, including GameOver. `tick` is the completed tick; submission stamps refer to the previous tick. Use the hook for audio/events and recording diagnostics. `onFrame({sim, alpha, steps, paused})` provides renderer interpolation and renders paused frames too. Hooks are synchronous; do not step the sim from them.
- `setSpeed(1|2)`, `pause()`, `resume()`, `paused`, `pauseReason`, `speed`, `alpha` support HUD/state integration. Hidden tabs pause with reason `hidden`; becoming visible requires an explicit resume. `onPauseChange(reason)` is the pause-screen hook.
- A frame accumulates `min(dt,250ms)*speed`, steps at 50ms, and executes at most five ticks. Overdue whole ticks are dropped after that cap; the fractional interval is retained (`0 <= alpha < 1`). No hidden, paused or stopped interval catches up. Pause, stop and restart clear queued input and interpolation.
- `restart(level?, matchSeed?)` recreates sim/bots, clears timing and input, and starts unpaused unless hidden; it preserves the chosen speed and rAF lifecycle. `start()`/`stop()` control rAF independently of pause. `dispose()` cancels rAF and unregisters visibility listeners.
- `step(n)` performs manual fixed ticks and emits a frame afterward, respecting pause/hidden/gameover/disposal. It resets the wall-clock baseline so mixing test stepping with rAF cannot catch up elapsed time. Nonnegative safe integers only. `advanceFrame(timestamp)` accepts finite rAF timestamps for deterministic scheduling tests.
- `environment` injects `requestFrame`, `cancelFrame`, `isHidden` and `onVisibilityChange` (returns unsubscribe). In Node the default environment is absent and manual/frame APIs still work.

## SP04 integration

The default exported `createBotDriver` comes from `@node-arena/bots`. `GameDriver` passes the same compiled level and match seed to the sim and bot factories, and calls `bot.commands(sim)` before every fixed step. The bot package owns resolved profiles, seeded decision cadence, and legal command selection; web never reads profiles or feeds events to bots. The sample level's idle profile still emits no commands.

`BotDriver { commands(sim): readonly Command[] }` and `CreateBotDriver = (level, matchSeed) => BotDriver` remain compatible injection contracts for tests and alternative controllers. Restart creates a fresh match-local bot driver. Pause prevents fixed steps; 2× changes only wall-clock accumulation, so decision ticks and command recordings stay deterministic. Vite resolves the public bot entrypoint from source, like content and sim, for clean-checkout development and HMR.

Run `pnpm --filter @node-arena/web test test/driver.test.ts` from the repository root. Tests use the real public content compiler and sim, including utility-bot captures, pause/2× cadence, and recorder/playback hash checks across different frame splits.
