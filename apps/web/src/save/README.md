# Versioned progress and settings

Import `createSaveStore`, `SaveData`, `SaveSettings` and `MatchResult` from this directory. Create one store for the app session; menus/audio consume `snapshot()` and apply `updateSettings(patch)` or `setLastLevel(id | null)`. Snapshots are independent copies. Volumes range from 0 to 1; quality is `low | med | high`.

At results, call `recordResult(levelId, {outcome, devTuned, replay})` with explicit match provenance. Only ordinary wins record completion, and repeated wins preserve `firstAt`. The caller must supply the authoritative match flags. Completion keys are content ids, with arbitrary strings handled safely, so campaign reordering cannot change progress.

`consumeNotice()` returns the next `{kind, message}` or null. Present it once to the player: reset and unavailable-storage notices are each emitted at most once per store session. The UI lifecycle will wire this module in the later screen task.

`nodearena:save` stores v1 `{v, completed: {[id]: {firstAt}}, settings, lastLevel}`. The pure `migrations[n]` upgrades n to n+1; `decodeSave(raw)` validates all fields and returns current data or throws. The v0 compatibility fixture has completion-date strings and predates reduced-motion settings; its migration wraps those dates and defaults reduced motion to false. Fixtures for both supported versions live in `../../test/fixtures/save/`; no versions beyond v1 are defined.

Malformed JSON, invalid schemas/settings and unsupported versions reset to fresh defaults after trying to preserve the exact raw string at `nodearena:save.bak`. Browser storage lookup, reads, backup writes and save writes are guarded. If storage is blocked, session edits/progress remain available in memory. Failed storage reads disable persistence for that session to avoid overwriting an unreadable save. Write failures can recover on a later edit. Backup is best effort when the browser refuses writes.

Tests can inject `{storage}` (`getItem`/`setItem` only), `{storageProvider}` (including a throwing getter), and `{now: () => Date}`. Browser storage access is deferred until store creation and caught even if obtaining `window.localStorage` throws.

Run `pnpm --filter @node-arena/web exec vitest run test/save.test.ts` from the repo root.
