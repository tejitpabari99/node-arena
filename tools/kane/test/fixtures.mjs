// Mirrors apps/web/test/kane/summary.test.ts and the shipped kaneSummary JSON.
export const initial = {
  tick: 0, speed: 0.25, over: null, result: null,
  letters: [
    { letter: 'A', index: 0, id: 'b0', owner: 0, level: 15 },
    { letter: 'B', index: 1, id: 'b1', owner: -1, level: 5 },
    { letter: 'C', index: 2, id: 'b2', owner: -1, level: 15 },
    { letter: 'D', index: 3, id: 'b3', owner: 1, level: 5 },
    { letter: 'E', index: 4, id: 'b4', owner: -1, level: 3 },
  ],
  human: { commands: [], drawn: 0, cut: 0, rejected: [] }, banner: null,
  pairs: [
    { from: 'A', to: 'C', state: 'ready', reason: null, text: 'A → C · ready · C: grey 15' },
    { from: 'A', to: 'E', state: 'ready', reason: null, text: 'A → E · ready · E: grey 3' },
  ],
};
export const mixed = {
  ...structuredClone(initial), tick: 2,
  human: {
    commands: [
      { tick: 0, cmd: { type: 'DrawLine', player: 0, from: 0, to: 2 } },
      { tick: 0, cmd: { type: 'DrawLine', player: 0, from: 0, to: 1 } },
      { tick: 1, cmd: { type: 'CutLine', player: 0, from: 0, to: 2 } },
    ], drawn: 1, cut: 1,
    rejected: [{ command: 'DrawLine', reason: 'blocked-obstacle' }],
  },
};
