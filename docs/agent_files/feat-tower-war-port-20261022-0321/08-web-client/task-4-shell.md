---
status: done
summary: Save v2, five-screen controller, public-frame runtime and campaign picker implemented.
date: 2026-10-23
---

Task 4 replaces the shell with `boot|picker|playing|result|error`. Loading stays on boot; restart is an overlay flag. Campaign `common` supplies all 20 cards, displayed `position-3`. Unlocks compare previous level completion; human victory compares winner index, never outcome alone. Save remains at `nodearena:save`, version 2, with backup/reset/storage notices and no migration.

Runtime awaits scene readiness, discards late generations safely, reuses the public troop buffer/frame, forwards events and attaches the Task 6 input controller. Buffer capacity is house count × per-house aliveCap. Ordinary HUD publications are capped at 10 Hz; events/result updates are immediate. Minimal driver integration changes use `sim.view.tick` and opt in to `step(...,{events:true})`.

Verification: 16 targeted tests pass (save validation/persistence, human-only unlocks, restart overlay, generation cancellation/restart/disposal/failure, public driver ticks/events, publication throttle, troop capacity/frame reuse, picker states/focus, credits). `tsc -p tsconfig.sp08-shell.json`, scoped ESLint and `vite build` pass. Build retains existing Three.js dynamic import/chunk-size warnings.

Actual Chromium at 1600×900: 20 cards, one enabled, first focused; first battle loads one canvas with zero page errors; reload restores last-played focus. Screenshot: `../ref/out/sp08-picker.png`.

Follow-on ownership: Task 5 replaces the minimal empty playing HUD slot; Task 8 reconnects audio to v2 assets/events and finalizes driver integration; Task 9 replaces stale legacy tests/harness. No legacy compatibility methods were retained. Full CI and review intentionally deferred until SP08 completion.
