import type { EndOutcome, StartSeat } from '@node-arena/net';
import type { Placement } from '@node-arena/sim';
import { BattlePopup } from '../PausePopup';
const seatNicks = (seats: ReadonlyArray<StartSeat> | undefined): Record<number, string> => Object.fromEntries((seats ?? []).map((s) => [s.player, s.nick]));
const names = (seats: number[], nicks: Record<number, string>) => seats.map((s) => nicks[s] ?? `Seat ${s + 1}`).join(' & ');
export function resultTitle(outcome: EndOutcome, seat: number | null, nicks: Record<number, string> = {}): string {
  if (outcome.winner === null && outcome.winners.length === 0) return 'Draw';
  if (seat === null) return Object.keys(nicks).length ? `${names(outcome.winners, nicks)} won` : 'Match over';
  return outcome.winners.includes(seat) ? 'Victory!' : 'Defeat';
}
export interface PvpResultProps {
  outcome: EndOutcome; seat: number | null; ranking?: Placement[] | null; seats?: ReadonlyArray<StartSeat> | undefined;
  onLeave(): void; onRematch?(): void;
}
export function PvpResult({ outcome, seat, ranking = null, seats, onLeave, onRematch }: PvpResultProps) {
  const nicks = seatNicks(seats), teamWin = outcome.winners.length > 1;
  return <div data-testid="pvp-result"><BattlePopup title={resultTitle(outcome, seat, nicks)}>
    {teamWin && seat !== null && <p data-testid="result-team">{outcome.winners.includes(seat) ? 'Your team won' : `${names(outcome.winners, nicks)} won`}</p>}
    {ranking && ranking.length > 0 && <ol class="result-placements" data-testid="result-placements">{ranking.map((p, i) =>
      <li key={p.team} data-testid={`result-placement-${i}`}>
        <span class="rank">{p.rank}</span> <span class="nick">{names(p.seats, nicks)}</span> <span class="team">{`Team ${p.team + 1}`}</span>
        {' '}<span class="buildings">{`${p.buildings} buildings`}</span> <span class="troops">{`${p.troops} troops`}</span>{p.eliminatedAt !== null && <span class="out"> out</span>}
      </li>)}</ol>}
    {seat !== null && onRematch && <button class="battle-action primary" data-testid="pvp-rematch" onClick={onRematch}>Rematch</button>}
    <button class="battle-action primary" data-testid="pvp-result-leave" onClick={onLeave}>Leave</button>
  </BattlePopup></div>;
}
