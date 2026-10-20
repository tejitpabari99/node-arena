import type { SimView } from '@node-arena/sim';

export interface StrengthSegment {
  team: string;
  colorKey: string;
  /** Display colour name for aria text (palette-aware). */
  name: string;
  troops: number;
  /** Integer percent; segments sum to exactly 100. */
  pct: number;
}
export interface Strength { segments: StrengthSegment[]; total: number; ariaText: string }

const DEFAULT_NAMES: Record<string, string> = { 'player.1': 'Blue', 'player.2': 'Red', 'player.3': 'Yellow', 'player.4': 'Green' };
const COLORBLIND_NAMES: Record<string, string> = { 'player.1': 'Blue', 'player.2': 'Vermillion', 'player.3': 'Yellow', 'player.4': 'Bluish green' };

function teamName(colorKey: string, team: string, colorblind: boolean): string {
  return (colorblind ? COLORBLIND_NAMES : DEFAULT_NAMES)[colorKey] ?? team;
}

/** Largest-remainder rounding so integer percentages sum to exactly 100. */
function percents(weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map(w => (w / sum) * 100);
  const out = exact.map(Math.floor);
  let rest = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - out[i]!, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (rest <= 0) break; out[i]!++; rest--; }
  return out;
}

/**
 * Per-team share of owned troops: tower garrisons plus troops in transit. Neutral towers are excluded.
 * Zero total gives an equal split. Pure and read-only on the view.
 */
export function strength(view: SimView, options: { colorblind?: boolean } = {}): Strength {
  const colorblind = options.colorblind ?? false;
  const teams = new Map<string, { colorKey: string; troops: number }>();
  const order: string[] = [];
  view.players.forEach((player, i) => {
    let entry = teams.get(player.team);
    if (!entry) { entry = { colorKey: player.colorKey, troops: 0 }; teams.set(player.team, entry); order.push(player.team); }
    entry.troops += player.transit;
    const owner = view.tower.owner;
    const count = view.tower.col['garrison.count'];
    if (count) for (let t = 0; t < owner.length; t++) if (owner[t] === i) entry.troops += count[t] ?? 0;
  });
  const total = order.reduce((a, team) => a + teams.get(team)!.troops, 0);
  if (order.length === 0) return { segments: [], total: 0, ariaText: '' };
  const pcts = percents(total > 0 ? order.map(team => teams.get(team)!.troops) : order.map(() => 1));
  const segments = order.map((team, i) => {
    const { colorKey, troops } = teams.get(team)!;
    return { team, colorKey, name: teamName(colorKey, team, colorblind), troops, pct: pcts[i]! };
  });
  return { segments, total, ariaText: segments.map(s => `${s.name} ${s.pct}%`).join(', ') };
}
