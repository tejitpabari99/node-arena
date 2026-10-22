export const OBJECTIVES = {
  captureAll: { id: 'captureAll', ruleIds: ['R-WIN-01', 'R-WIN-02', 'R-WIN-03'], seats: { human: 1, aiMax: 3 } },
} as const;

export type ObjectiveId = keyof typeof OBJECTIVES;
