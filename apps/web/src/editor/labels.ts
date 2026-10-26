import type { LevelDoc } from './document.js';

type Players = LevelDoc['players'];

/** Editor-only copy: keep display labels outside the hashed module/content registries. */
export const PARAM_LABELS: Record<string, { label: string; tooltip: string }> = {
  'level.maxLevel': { label: 'Max level (garrison cap)', tooltip: 'Highest level this building reaches; extra troops are forwarded or lost. (R-CAP-01)' },
  'spawns.troop': { label: 'Unit produced', tooltip: 'The unit this building sends out; the building type sets the default.' },
  'spawns.spawnSpeed': { label: 'Spawn speed', tooltip: 'Higher = troops leave each line faster, scaling with level. (R-SPN-01)' },
  'spawns.lineSpawnPenalty': { label: 'Per-extra-line slowdown', tooltip: "Each extra outgoing line slows every line's spawning; 0 = none. (R-SPN-01)" },
  'grows.growTime': { label: 'Regrow time multiplier', tooltip: 'Scales time to regain a level; only ticks with no outgoing lines. Higher = slower. (R-GRW-01)' },
  'shoots.attackDelay': { label: 'Fire-rate gain per level', tooltip: 'Makes shots more frequent as level rises; higher = faster. (R-TWR-01)' },
  'shoots.attackRadius': { label: 'Attack radius', tooltip: 'Base shooting range at stage 1.' },
  'shoots.speedUpByLevel': { label: 'Shot delay multiplier', tooltip: 'Scales time between shots; higher = slower. (R-TWR-01)' },
  'shoots.radiusUpByLevel': { label: 'Range gain per stage', tooltip: 'Extra range added for each stage above 1.' },
  'shoots.radiusUnit': { label: 'Range scale', tooltip: 'Multiplier converting range values into map distance.' },
  'shoots.minRadius': { label: 'Minimum range', tooltip: 'Troops at or within this distance are not shot (dead zone). (R-TWR-02)' },
  'shoots.neutralFires': { label: 'Fires while neutral', tooltip: 'If yes, an unowned tower still shoots.' },
  'shoots.troopPad': { label: 'Troop hit margin', tooltip: 'Extra reach added to range when targeting troops.' },
  'shoots.hitsNeutralHouses': { label: 'Shoots neutral houses', tooltip: 'If yes, the tower also lowers unowned houses in range.' },
  'shoots.bulletSpeed': { label: 'Bullet speed (visual)', tooltip: 'Shot animation speed only; no gameplay effect.' },
};

/** Unknown fields remain readable until dedicated editor copy is added. */
export function paramLabel(module: string, field: string): { label: string; tooltip: string } {
  const known = PARAM_LABELS[`${module}.${field}`];
  if (known) return known;
  const words = field.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  const label = words.charAt(0).toUpperCase() + words.slice(1);
  return { label, tooltip: label };
}

/** Human, or AI{k} where k is the 1-based position among AI players. Ids stay stable; labels are derived. */
export function playerLabel(players: Players, id: string): string {
  const player = players.find(p => p.id === id);
  if (!player || player.kind === 'human') return 'Human';
  return `AI${players.filter(p => p.kind !== 'human').findIndex(p => p.id === id) + 1}`;
}

/** Labels by item id, in doc order: `{Owner} {noun} {n}`; obstacles `{Small|Big} obstacle {n}` per variant. */
export function itemLabels(doc: Pick<LevelDoc, 'players' | 'buildings' | 'elements'>): Map<string, string> {
  const labels = new Map<string, string>(), counts = new Map<string, number>();
  const next = (key: string) => { const n = (counts.get(key) ?? 0) + 1; counts.set(key, n); return n; };
  for (const item of doc.buildings) {
    const owner = item.owner === null || !doc.players.some(p => p.id === item.owner) ? 'Neutral' : playerLabel(doc.players, item.owner);
    const noun = item.archetype === 'tower' ? 'tower' : 'house';
    labels.set(item.id, `${owner} ${noun} ${next(`${owner}|${noun}`)}`);
  }
  for (const item of doc.elements) {
    const name = item.variant === 'small' ? 'Small obstacle' : item.variant === 'big' ? 'Big obstacle' : 'Obstacle';
    labels.set(item.id, `${name} ${next(`obstacle|${name}`)}`);
  }
  return labels;
}

/** Lowest unused `pN`, N >= 2. */
export function nextPlayerId(players: Players): string {
  const used = new Set(players.map(p => p.id));
  let n = 2; while (used.has(`p${n}`)) n++;
  return `p${n}`;
}

/** First palette key (manifest order) not used by any player; undefined if all are used. */
export function firstUnusedColor(players: Players, paletteKeys: readonly string[]): string | undefined {
  const used = new Set(players.map(p => p.colorKey));
  return paletteKeys.find(key => !used.has(key));
}
