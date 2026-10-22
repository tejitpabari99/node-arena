# @node-arena/bots

Tower War bot package (`BOT_VERSION` 2.0.0). The v1 utility bot stack was removed in 06-ai-port Task 1; the new bot is built in Tasks 2-4.

`src/index.ts` exports the guarded `BotContext` (`{ view, canDraw }`) and `Bot` contracts, `guardBotContext`, `createBotDriver` (currently a stub emitting no commands), the headless `runMatch` harness (still v1-shaped; reworked later in 06-ai-port) and `BOT_VERSION`. Core code imports only public sim exports and content types.
