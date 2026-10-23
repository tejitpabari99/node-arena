import type { RejectReason } from '@node-arena/sim';
/** The public API calls this RejectReason (PRD: ReasonCode). Keep the table exhaustive. */
export const DRAW_REASON_TEXT: Record<RejectReason,string> = {
  gameover: 'This battle has ended.',
  malformed: 'This route is invalid.',
  'unknown-id': 'This building is unavailable.',
  'not-owner': 'Start from one of your buildings.',
  self: 'Choose another building.',
  'not-drawer': 'This building cannot send troops.',
  duplicate: 'This route already exists.',
  'no-slot': 'This building has no free routes.',
  'blocked-obstacle': 'An obstacle blocks this route.',
  'blocked-building': 'Another building blocks this route.',
  'no-line': 'This route no longer exists.',
};
