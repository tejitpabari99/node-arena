import type { RejectReason } from '@node-arena/defs';
import { refreshCrossings } from './crossings.js';
import { IMPLS, MODULE_ORDER } from './modules/index.js';
import type { LineCutReason, SimState } from './types.js';

/** Module hook dispatch in sorted module-id order (the SP04 seams). */
export function firstDrawRejection(state: SimState, from: number, to: number): RejectReason | null {
  for (const id of MODULE_ORDER) {
    const reason = IMPLS[id].hooks?.validateDraw?.(state, from, to);
    if (reason) return reason;
  }
  return null;
}

export function fireLineDrawn(state: SimState, from: number, to: number, drawSeq: number): void {
  refreshCrossings(state);
  for (const id of MODULE_ORDER) IMPLS[id].hooks?.onLineDrawn?.(state, from, to, drawSeq);
}

export function fireLineCut(state: SimState, from: number, to: number, reason: LineCutReason): void {
  refreshCrossings(state);
  for (const id of MODULE_ORDER) IMPLS[id].hooks?.onLineCut?.(state, from, to, reason);
}

export function fireCapture(state: SimState, building: number, from: number, to: number): void {
  for (const id of MODULE_ORDER) IMPLS[id].hooks?.onCapture?.(state, building, from, to);
}
