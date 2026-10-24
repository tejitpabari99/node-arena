/** Strategy only: Kane chooses actual buttons from the page. */
export function objectivePhase(summary) {
  const ready = summary.pairs.some(pair => pair.state === 'ready');
  if (!ready && summary.pairs.some(pair => pair.state === 'active')) return 'cut';
  return summary.letters.some(row => row.owner < 0) ? 'capture' : 'attack';
}

export function buildObjective(summary, { moves = 3 } = {}) {
  if (!Number.isSafeInteger(moves) || moves < 1) throw new RangeError('moves must be a positive integer');
  const phase = objectivePhase(summary);
  const opening = 'A game page is already open; do not navigate or reload.';
  if (phase === 'cut') {
    return `${opening} Double-click one red "active" button in the bottom panel to free a route; that is the only move. Prefer a less useful route; keep attacks supplied. Never click "Speed", the canvas, or outside the bottom panel. Read any red banner and stop without retrying. Do not wait. Reply with the exact text of the button clicked.`;
  }
  const hint = phase === 'capture'
    ? 'Prefer targets that are grey (neutral) with the lowest level.'
    : 'Prefer enemy-owned yellow or red targets and keep attacks supplied.';
  return `${opening} Make up to ${moves} moves, then stop. Each move: single-click a different green "ready" button in the bottom panel. Red "active" is already running; grey is unavailable; do not click either. Never click "Speed", the canvas, or outside the bottom panel. ${hint} Read any red banner, skip its rejected choice, and choose another ready button. Stop after ${moves} clicks or when no suitable green button exists. Do not wait. Reply with the exact text of each button clicked.`;
}
