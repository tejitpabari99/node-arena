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
    return `${opening} Double-click one red "active" button in the bottom panel to free a route; that is the only move. Never click "Speed", the canvas, or outside the bottom panel. Do not retry if a red banner appears; read it and stop. Do not wait. Reply with the exact text of the button clicked.`;
  }
  const hint = phase === 'capture'
    ? 'Prefer targets that are grey (neutral) with the lowest level.'
    : 'Prefer targets that are red-owned.';
  return `${opening} Make up to ${moves} moves, then stop. Each move: single-click a different green "ready" button in the bottom panel. Red "active" is already running; grey is unavailable; do not click either. Never click "Speed", the canvas, or outside the bottom panel. ${hint} If a red banner appears, read it; do not retry that button; choose another green one. Stop after ${moves} clicks or when no green button exists. Do not wait. Reply with the exact text of each button clicked.`;
}
