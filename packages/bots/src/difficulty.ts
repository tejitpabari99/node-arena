import type { SeatBot } from '@node-arena/content';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

function preset(actionDelayMs: number): SeatBot {
  return Object.freeze({
    kind: 'tw', actionDelayMs, behavior: 'full', script: Object.freeze([]) as unknown as [],
  });
}

/** Lobby bot-seat presets (lower actionDelayMs = harder). HUMAN_PROXY is 2000 ms. */
export const BOT_PRESETS: Readonly<Record<BotDifficulty, SeatBot>> = Object.freeze({
  easy: preset(3000),
  normal: preset(1500),
  hard: preset(700),
});
