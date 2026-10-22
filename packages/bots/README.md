# @node-arena/bots

Tower War bot package (`BOT_VERSION` 2.0.0). The v1 utility bot stack was removed in 06-ai-port Task 1; the new bot is built in Tasks 2-4 (Task 2: `createSeatBot` + `decideDefault`).

`src/index.ts` exports the guarded `BotContext` (`{ view, canDraw }`) and `Bot` contracts, `guardBotContext`, `createBotDriver` (currently a stub emitting no commands), the headless `runMatch` harness (ported to the v2 sim in Task 2) and `BOT_VERSION`. Core code imports only public sim exports and content types.
