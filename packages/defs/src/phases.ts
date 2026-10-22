/** 9 tick phases, GAME_RULES.md section 4 (R-TCK-05). Phase 2 is reserved/unused, numbering stays stable. */
export const PHASES = ['commands', 'reserved', 'growth', 'spawn', 'movement', 'contacts', 'towers', 'arrivals', 'outcome'] as const;
export type Phase = (typeof PHASES)[number];
