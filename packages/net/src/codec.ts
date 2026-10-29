import type { Command } from '@node-arena/defs';
import type { ClientMessage, ServerMessage, TickMsg } from './messages.js';

/** JSON text frame. Server encodes once and sends the identical string to every socket. */
export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}
export const encodeClient = (msg: ClientMessage): string => encode(msg);
export const encodeServer = (msg: ServerMessage): string => encode(msg);

/** Compact tick: `c` omitted when empty. */
export function encodeTick(n: number, cmds: readonly Command[] = []): string {
  const msg: TickMsg = cmds.length === 0 ? { t: 'tick', n } : { t: 'tick', n, c: cmds as Command[] };
  return JSON.stringify(msg);
}

/** UTF-8 byte length of a frame without TextEncoder/Buffer. */
export function byteSize(s: string): number {
  let b = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { b += 4; i++; }
    else b += 3;
  }
  return b;
}
