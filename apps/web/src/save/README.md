# Versioned progress and settings

One `createSaveStore()` per app session. `snapshot()` returns independent copies. Settings contain only `musicVol`, `sfxVol` (0..1), `musicMute`, and `sfxMute`.

`nodearena:save` stores `{v:2, completed:{[levelId]:{firstAt}}, settings, lastLevel}`. Call `recordResult(levelId,{winner,human})` with public simulation winner and the human player index. Only a human winner records completion; repeated victories preserve the first timestamp. Campaign positions never become save keys.

`decodeSave(raw)` strictly validates v2. Historical versions are discarded without migration. Invalid data is backed up unchanged to `nodearena:save.bak`, then reset. Storage access/read/write errors preserve session progress and settings in memory. Failed reads disable writes to avoid overwriting unreadable data.

`consumeNotice()` emits each reset/storage notice once per session. Inject storage, a storage provider, or a date provider for deterministic tests.

Run `pnpm --filter @node-arena/web exec vitest run test/sp08/save-v2.test.ts`.
