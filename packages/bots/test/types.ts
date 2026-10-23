import type { CompiledLevel } from '@node-arena/content';
import type { Command, ReplayRecorder, Sim, SimView } from '@node-arena/sim';
import { guardBotContext, createBotDriver, runMatch, type MatchResult, type BotDriver, type Bot, type BotContext } from '../src/index.js';

declare const sim: Sim;
declare const level: CompiledLevel;
const ctx: BotContext = guardBotContext(sim);
const view: SimView = ctx.view;
const bot: Bot = { player: 0, decide(context, tick) {
  const commands: Command[] = [];
  if (context.view.tick === tick && !context.canDraw(this.player, 0, 1)) {
    commands.push({ type: 'DrawLine', player: this.player, from: 0, to: 1 });
  }
  return commands;
} };
const driver: BotDriver = createBotDriver(level, 42);
const commands: Command[] = driver.commands(sim);
void [view, bot, level, commands];
// @ts-expect-error Hidden sim state is absent from the bot contract.
ctx.snapshot();
// @ts-expect-error Events/stepping are absent from the bot contract.
ctx.step([]);
// @ts-expect-error Read capabilities cannot be replaced.
ctx.view = sim.view;
// @ts-expect-error Browser globals are unavailable in the core contract.
void document;
// @ts-expect-error Node globals are unavailable in the core contract.
void process;

const match: MatchResult = runMatch({ level, seed: 42, controllers: [bot, {
  player: 1, commands: [{ tick: 0, cmd: { type: 'DrawLine', player: 1, from: 0, to: 1 } }],
}], record: { rulesVersion: '1.0.0', schemaVersion: '1.0.0', contentVersion: '1.0.0' } });
if (match.outcome.outcome === 'truncated') {
  const winner: null = match.outcome.winner;
  void winner;
}
// @ts-expect-error Replay headers require explicit authoritative versions, not a boolean opt-in.
runMatch({ level, seed: 42, record: true });

// @ts-expect-error Authoritative rejection diagnostics stay outside BotContext.
void ctx.rejected;
const rejected: number = sim.rejected;
// @ts-expect-error Rejection diagnostics are read-only.
sim.rejected = 0;
declare const recorder: ReplayRecorder;
const recordedRejected: number = recorder.rejected;
// @ts-expect-error Recorder diagnostics are also read-only.
recorder.rejected = 0;
void [rejected, recordedRejected];
