/** A building archetype is a "house" when it can draw lines. Single definition shared by the editor and Check. */
export const isHouseArchetype = (archetype: { modules: { drawsLines?: unknown } } | undefined): boolean => archetype?.modules.drawsLines !== undefined;
/** Archetype id of the default starting base house placed in blank levels. */
export const BASE_HOUSE = 'house-wt1';
/** A building archetype generates troops when it has the spawns module (houses of any troop kind; towers do not). */
export const spawnsTroops = (archetype: { modules: { spawns?: unknown } } | undefined): boolean => archetype?.modules.spawns !== undefined;
