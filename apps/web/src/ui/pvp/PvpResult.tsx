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
  /** SP09: server restart notice received; Rematch is disabled. */ draining?: boolean;
  onLeave(): void; onRematch?(): void;
}
export function PvpResult({ outcome, seat, ranking = null, seats, draining = false, onLeave, onRematch }: PvpResultProps) {
  const nicks = seatNicks(seats), teamWin = outcome.winners.length > 1;
  return <div class="pvp-result" data-testid="pvp-result"><BattlePopup title={resultTitle(outcome, seat, nicks)}>
    {teamWin && seat !== null && <p data-testid="result-team">{outcome.winners.includes(seat) ? 'Your team won' : `${names(outcome.winners, nicks)} won`}</p>}
    {ranking && ranking.length > 0 && <table class="result-table" data-testid="result-placements">
      <thead><tr><th scope="col">Team</th><th scope="col">Buildings</th><th scope="col">Troops</th></tr></thead>
      <tbody>{ranking.map((p, i) =>
        <tr key={p.team} class={p.eliminatedAt !== null ? 'out' : p.seats.some(s => outcome.winners.includes(s)) ? 'winner' : undefined} data-testid={`result-placement-${i}`}>
          <td>{`Team ${p.team + 1} (${names(p.seats, nicks)})`}</td>
          {p.eliminatedAt !== null ? <td colSpan={2}>Eliminated</td> : <><td>{`${p.buildings} ${p.buildings === 1 ? 'building' : 'buildings'}`}</td><td>{`${p.troops} ${p.troops === 1 ? 'troop' : 'troops'}`}</td></>}
        </tr>)}</tbody>
    </table>}
    {seat !== null && onRematch && <button class="battle-action primary" data-testid="pvp-rematch" disabled={draining} onClick={onRematch}>Rematch</button>}
    <button class="battle-action primary" data-testid="pvp-result-leave" onClick={onLeave}>Leave</button>
  </BattlePopup></div>;
}
