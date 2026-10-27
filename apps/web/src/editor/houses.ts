/** A building archetype is a "house" when it can draw lines. Single definition shared by the editor and Check. */
export const isHouseArchetype = (archetype: { modules: { drawsLines?: unknown } } | undefined): boolean => archetype?.modules.drawsLines !== undefined;
/** Archetype id of the default starting base house placed in blank levels. */
export const BASE_HOUSE = 'house-wt1';
