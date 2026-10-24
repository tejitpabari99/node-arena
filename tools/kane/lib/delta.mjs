/**
 * Shipped summary rejections carry only {command, reason}, not pair or tick.
 * Counters are authoritative. Emit exact rows only when all new commands of a
 * type are known accepted; mixed accepted/rejected batches remain ambiguous.
 * Consumers MUST use acceptedCount (not accepted.length) to detect progress.
 */
export function acceptedMoveDelta(before, after) {
  const previous = before.human, current = after.human;
  const drawn = current.drawn - previous.drawn, cut = current.cut - previous.cut;
  if (drawn < 0 || cut < 0 || current.commands.length < previous.commands.length
    || current.rejected.length < previous.rejected.length
    || previous.commands.some((row, index) => JSON.stringify(row) !== JSON.stringify(current.commands[index]))
    || previous.rejected.some((row, index) => JSON.stringify(row) !== JSON.stringify(current.rejected[index]))) {
    throw new Error('Summary history reset; cannot compare different matches');
  }
  const rows = current.commands.slice(previous.commands.length)
    .filter(row => row.cmd.player === 0 && (row.cmd.type === 'DrawLine' || row.cmd.type === 'CutLine'));
  const counts = { DrawLine: drawn, CutLine: cut };
  const candidates = { DrawLine: 0, CutLine: 0 };
  for (const row of rows) candidates[row.cmd.type]++;
  // Before-snapshot submissions may still be queued. Their eventual acceptance
  // must not be assigned to a new command that happens to have the same type.
  const pending = { DrawLine: 0, CutLine: 0 };
  for (const row of previous.commands) {
    if (row.cmd.player === 0 && Object.hasOwn(pending, row.cmd.type)) pending[row.cmd.type]++;
  }
  for (const row of previous.rejected) {
    if (Object.hasOwn(pending, row.command)) pending[row.command]--;
  }
  pending.DrawLine -= previous.drawn;
  pending.CutLine -= previous.cut;
  const accepted = rows.filter(row => pending[row.cmd.type] <= 0
    && counts[row.cmd.type] > 0 && counts[row.cmd.type] === candidates[row.cmd.type])
    .map(({ tick, cmd }) => ({ tick, type: cmd.type, from: cmd.from, to: cmd.to }));
  const rejected = current.rejected.slice(previous.rejected.length).map(({ reason }) => ({ reason }));
  const acceptedCount = drawn + cut;
  return { accepted, rejected, drawn, cut, acceptedCount, ambiguous: accepted.length !== acceptedCount };
}
