/** Closed-by-registry id sets for the manifest (07/08). */
export const RENDER_KINDS = ['unit', 'building', 'element', 'ground', 'lane', 'fx'] as const;
export const ANIM_MODES = ['none', 'node-tracks'] as const;
export const TEAM_MODES = ['textureSwap'] as const;
export const FX_KINDS = ['sprite-burst', 'ring', 'beam'] as const;
/** Triangle budgets per class (R7). */
export const BUDGET_CLASSES = { unit: 1100, building: 1200, obstacle: 300, ground: 500 } as const;

export const VISUAL = { RENDER_KINDS, ANIM_MODES, TEAM_MODES, FX_KINDS, BUDGET_CLASSES } as const;

export type RenderKind = (typeof RENDER_KINDS)[number];
export type AnimMode = (typeof ANIM_MODES)[number];
export type TeamMode = (typeof TEAM_MODES)[number];
export type FxKind = (typeof FX_KINDS)[number];
export type BudgetClass = keyof typeof BUDGET_CLASSES;
