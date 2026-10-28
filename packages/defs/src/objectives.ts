export const OBJECTIVES = {
  captureAll: { id: 'captureAll', ruleIds: ['R-WIN-01', 'R-WIN-02', 'R-WIN-03'], seats: { human: 1, aiMax: 3 } },
  pvp: { id: 'pvp', ruleIds: ['R-SEA-01', 'R-TEM-01', 'R-TEM-02', 'R-TEM-03', 'R-ELM-01', 'R-WIN-04', 'R-WIN-05', 'R-WIN-06', 'R-WIN-07'], seats: { min: 2, max: 4 } },
} as const;

export type ObjectiveId = keyof typeof OBJECTIVES;
